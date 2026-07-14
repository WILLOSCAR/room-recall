// Nestory agent runtime: a provider-agnostic tool-calling loop.
// The LLM is an injected async function shaped like the Anthropic Messages
// API (content blocks with tool_use / tool_result), so the loop is testable
// with scripted mocks and bindable to a real model without changes.
//
// Guarantees enforced here, independent of the model:
// - Decision tools (accept_proposal / reject_proposal) are blocked unless the
//   caller explicitly allows them for this turn — the model gets an
//   instructive error instead of a silent mutation.
// - A bounded tool-round budget stops runaway loops.
// - Tool results are serialized with a size cap so context stays sane.

import type { AgentToolkit } from "./agent.ts";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
}

export interface LlmReply {
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  content: ContentBlock[];
}

export type LlmFn = (req: LlmRequest) => Promise<LlmReply>;

export type AgentTurnEvent =
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_call"; name: string; input: Record<string, unknown>; result: string; isError: boolean };

export interface AgentTurnResult {
  history: ChatMessage[];
  events: AgentTurnEvent[];
  finalText: string;
  toolRoundsUsed: number;
}

export const DECISION_TOOLS: readonly string[] = ["accept_proposal", "reject_proposal"];

export const AGENT_SYSTEM_PROMPT = `You are Nestory, a memory system for the user's home.
Answer questions about belongings, containers, boxes, kits, and operations using ONLY the provided tools — never invent placements.
Every location answer must carry: the place chain, the default home if different, evidence, confidence, freshness, and an honest admission when the record is stale or uncertain.
Unknown is not empty: if a container has not been confirmed recently, say so instead of treating it as empty.
Capture tools (snapshot_container, mark_not_there) create reviewable proposals — tell the user to decide them in the Review inbox.
Never call accept_proposal or reject_proposal unless the user has explicitly confirmed that exact decision in this conversation; by default those tools are blocked for you.
When you cannot answer, say what capture or setup step would teach the memory the answer.`;

const RESULT_CHAR_CAP = 4000;

function serializeResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "null";
  } catch {
    text = String(value);
  }
  return text.length > RESULT_CHAR_CAP ? `${text.slice(0, RESULT_CHAR_CAP)}…(truncated)` : text;
}

/** Bind the loop to a real Claude model via the Messages API. No SDK needed. */
export function claudeLlm(apiKey: string, model: string): LlmFn {
  return async (req) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: req.system,
        messages: req.messages,
        tools: req.tools
      })
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json() as { stop_reason: string; content: ContentBlock[] };
    return { stopReason: data.stop_reason === "tool_use" ? "tool_use" : "end_turn", content: data.content };
  };
}

export async function runAgentTurn(options: {
  toolkit: AgentToolkit;
  llm: LlmFn;
  userText: string;
  history?: ChatMessage[];
  maxToolRounds?: number;
  allowDecisionTools?: boolean;
}): Promise<AgentTurnResult> {
  const { toolkit, llm, userText } = options;
  const maxToolRounds = options.maxToolRounds ?? 6;
  const allowDecisionTools = options.allowDecisionTools ?? false;

  const history: ChatMessage[] = [...(options.history ?? [])];
  history.push({ role: "user", content: [{ type: "text", text: userText }] });

  const events: AgentTurnEvent[] = [];
  const texts: string[] = [];
  const tools = toolkit.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  let rounds = 0;
  for (;;) {
    const reply = await llm({ system: AGENT_SYSTEM_PROMPT, messages: history, tools });
    history.push({ role: "assistant", content: reply.content });

    for (const block of reply.content) {
      if (block.type === "text" && block.text.trim()) {
        texts.push(block.text.trim());
        events.push({ kind: "assistant_text", text: block.text.trim() });
      }
    }

    const toolUses = reply.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (!toolUses.length || reply.stopReason === "end_turn") break;

    rounds += 1;
    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      let resultText: string;
      let isError = false;
      if (!allowDecisionTools && DECISION_TOOLS.includes(use.name)) {
        isError = true;
        resultText = "Blocked: decision tools need the user's explicit confirmation. Ask the user to confirm, or point them to the Review inbox.";
      } else {
        try {
          resultText = serializeResult(toolkit.dispatch(use.name, use.input));
        } catch (err) {
          isError = true;
          resultText = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      events.push({ kind: "tool_call", name: use.name, input: use.input, result: resultText, isError });
      results.push({ type: "tool_result", tool_use_id: use.id, content: resultText, ...(isError ? { is_error: true } : {}) });
    }
    history.push({ role: "user", content: results });

    if (rounds >= maxToolRounds) {
      texts.push(`I stopped after ${maxToolRounds} tool rounds for this turn — ask again to continue.`);
      break;
    }
  }

  return {
    history,
    events,
    finalText: texts.join("\n\n") || "I had nothing to add.",
    toolRoundsUsed: rounds
  };
}
