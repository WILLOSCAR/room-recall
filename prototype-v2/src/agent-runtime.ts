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
  signal?: AbortSignal;
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

export interface DecisionGrant {
  toolName: "accept_proposal" | "reject_proposal";
  proposalId: string;
}

export const AGENT_SYSTEM_PROMPT = `You are Nestory, a memory system for the user's home.
Answer questions about belongings, containers, boxes, kits, and operations using ONLY the provided tools — never invent placements.
Every location answer must carry: the place chain, the default home if different, evidence, confidence, freshness, and an honest admission when the record is stale or uncertain.
Unknown is not empty: if a container has not been confirmed recently, say so instead of treating it as empty.
Capture tools (snapshot_container, mark_not_there) create reviewable proposals — tell the user to decide them in the Review inbox.
Never call accept_proposal or reject_proposal unless the user has explicitly confirmed that exact decision in this conversation; by default those tools are blocked for you.
When you cannot answer, say what capture or setup step would teach the memory the answer.`;

const RESULT_CHAR_CAP = 4000;

interface ProjectionBudget {
  nodes: number;
  chars: number;
  truncated: boolean;
}

function boundedProjection(
  value: unknown,
  budget: ProjectionBudget,
  seen: WeakSet<object>,
  depth = 0,
  key = ""
): unknown {
  if (key === "dataUrl") {
    budget.truncated = true;
    return "[image media omitted]";
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const allowed = Math.max(0, Math.min(512, budget.chars));
    budget.chars -= Math.min(value.length, allowed);
    if (value.length <= allowed) return value;
    budget.truncated = true;
    return `${value.slice(0, allowed)}…`;
  }
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) {
    budget.truncated = true;
    return "[circular]";
  }
  if (depth >= 5 || budget.nodes <= 0 || budget.chars <= 0) {
    budget.truncated = true;
    return "[summary limit reached]";
  }
  seen.add(value);
  budget.nodes -= 1;

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    const length = Math.min(value.length, 24);
    for (let index = 0; index < length && budget.nodes > 0 && budget.chars > 0; index += 1) {
      result.push(boundedProjection(value[index], budget, seen, depth + 1, String(index)));
    }
    if (length < value.length || result.length < length) {
      budget.truncated = true;
      result.push({ truncatedItems: value.length - result.length });
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  let included = 0;
  let hasMore = false;
  for (const entryKey in value) {
    if (!Object.prototype.hasOwnProperty.call(value, entryKey)) continue;
    if (included >= 30 || budget.nodes <= 0 || budget.chars <= 0) {
      hasMore = true;
      break;
    }
    result[entryKey] = boundedProjection((value as Record<string, unknown>)[entryKey], budget, seen, depth + 1, entryKey);
    included += 1;
  }
  if (hasMore) {
    budget.truncated = true;
    result["_truncatedFields"] = "additional fields omitted";
  }
  return result;
}

function serializeResult(value: unknown): string {
  const budget: ProjectionBudget = { nodes: 160, chars: 2_800, truncated: false };
  const projected = boundedProjection(value, budget, new WeakSet());
  let text: string;
  try {
    text = JSON.stringify(budget.truncated && projected && typeof projected === "object" && !Array.isArray(projected)
      ? { ...projected as Record<string, unknown>, _truncated: true }
      : projected) ?? "null";
  } catch (error) {
    text = JSON.stringify({ error: `Tool result could not be serialized: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (text.length <= RESULT_CHAR_CAP) return text;

  let preview = text.slice(0, RESULT_CHAR_CAP - 160);
  let envelope = JSON.stringify({ _truncated: true, preview });
  while (envelope.length > RESULT_CHAR_CAP && preview.length > 0) {
    preview = preview.slice(0, Math.max(0, preview.length - (envelope.length - RESULT_CHAR_CAP) - 16));
    envelope = JSON.stringify({ _truncated: true, preview });
  }
  return envelope;
}

/** Bind the loop to a real Claude model via the Messages API. No SDK needed. */
export function claudeLlm(apiKey: string, model: string): LlmFn {
  return async (req) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: req.signal,
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
  maxToolCallsPerRound?: number;
  maxToolCallsPerTurn?: number;
  decisionGrant?: DecisionGrant;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AgentTurnResult> {
  const { toolkit, llm, userText } = options;
  const maxToolRounds = options.maxToolRounds ?? 6;
  const maxToolCallsPerRound = options.maxToolCallsPerRound ?? 8;
  const maxToolCallsPerTurn = options.maxToolCallsPerTurn ?? 24;
  let decisionGrantAvailable = options.decisionGrant !== undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Agent LLM timeout must be a positive number of milliseconds");
  if (!Number.isInteger(maxToolCallsPerRound) || maxToolCallsPerRound <= 0) throw new Error("Agent per-round tool-call budget must be a positive integer");
  if (!Number.isInteger(maxToolCallsPerTurn) || maxToolCallsPerTurn <= 0) throw new Error("Agent turn tool-call budget must be a positive integer");

  const callLlm = async (request: Omit<LlmRequest, "signal">): Promise<LlmReply> => {
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort(options.signal?.reason ?? new Error("Agent turn aborted"));
    if (options.signal?.aborted) onExternalAbort();
    else options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`LLM request timed out after ${timeoutMs} ms`)), timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? new Error("Agent turn aborted")), { once: true });
      if (controller.signal.aborted) reject(controller.signal.reason ?? new Error("Agent turn aborted"));
    });
    try {
      return await Promise.race([llm({ ...request, signal: controller.signal }), aborted]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  };

  const history: ChatMessage[] = [...(options.history ?? [])];
  history.push({ role: "user", content: [{ type: "text", text: userText }] });

  const events: AgentTurnEvent[] = [];
  const texts: string[] = [];
  const tools = toolkit.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  let rounds = 0;
  let toolCallsUsed = 0;
  for (;;) {
    const reply = await callLlm({ system: AGENT_SYSTEM_PROMPT, messages: history, tools });
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
    for (const [toolIndex, use] of toolUses.entries()) {
      let resultText: string;
      let isError = false;
      if (toolIndex >= maxToolCallsPerRound || toolCallsUsed >= maxToolCallsPerTurn) {
        isError = true;
        resultText = serializeResult({
          error: "Tool call budget exceeded",
          limit: toolIndex >= maxToolCallsPerRound ? maxToolCallsPerRound : maxToolCallsPerTurn,
          scope: toolIndex >= maxToolCallsPerRound ? "round" : "turn"
        });
        events.push({ kind: "tool_call", name: use.name, input: use.input, result: resultText, isError });
        results.push({ type: "tool_result", tool_use_id: use.id, content: resultText, is_error: true });
        continue;
      }
      toolCallsUsed += 1;
      const proposalId = typeof use.input["proposal_id"] === "string" ? use.input["proposal_id"] : null;
      const grantedDecision = decisionGrantAvailable
        && options.decisionGrant?.toolName === use.name
        && options.decisionGrant.proposalId === proposalId;
      if (DECISION_TOOLS.includes(use.name) && !grantedDecision) {
        isError = true;
        resultText = serializeResult({ error: "Blocked: this exact proposal decision was not granted. Ask the user to confirm this proposal, or point them to the Review inbox." });
      } else {
        if (grantedDecision) decisionGrantAvailable = false;
        try {
          resultText = serializeResult(toolkit.dispatch(use.name, use.input));
        } catch (err) {
          isError = true;
          resultText = serializeResult({ error: `Tool error: ${err instanceof Error ? err.message : String(err)}` });
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
