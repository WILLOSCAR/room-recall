// Nestory Ask: a deterministic intent router over the agent toolkit.
// It answers only through toolkit calls — the same 14 tools an LLM binds to
// via agent-runtime.ts — so the conversational surface works offline today
// and swaps to a real model without changing the product contract.

import type { AgentToolkit } from "./agent.ts";
import type {
  AttentionSummary, ContainerContentsView, DeclutterReviewResult, LocateAnswer, OwnershipRecallAnswer, RetrievalPlanGroup,
  Store, UnpackPriorityEntry, WhichContainerHit
} from "./types.ts";

export interface AskToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AskReply {
  intent: "locate" | "ownership" | "declutter" | "which_container" | "container_contents" | "kit" | "unpack" | "attention" | "help";
  toolCalls: AskToolCall[];
  text: string;
  answer?: LocateAnswer;
  ownership?: OwnershipRecallAnswer;
  declutter?: DeclutterReviewResult;
  hits?: WhichContainerHit[];
  contents?: ContainerContentsView;
  plan?: RetrievalPlanGroup[];
  operationId?: string;
  attention?: AttentionSummary;
  priority?: UnpackPriorityEntry[];
}

const FILLER = new Set(["where", "wheres", "where's", "is", "are", "my", "the", "a", "an", "please", "now", "again", "find", "locate", "whats", "what's", "what", "in", "of"]);
// Extra fillers to strip when the phrasing is a pre-purchase / ownership question.
const OWNERSHIP_FILLER = new Set(["do", "i", "already", "own", "have", "any", "another", "second", "spare", "extra", "more", "need", "to", "buy", "should", "get", "before", "purchasing", "purchase", "buying", "some"]);

function cleanQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[?!.,;:"'`]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !FILLER.has(t))
    .join(" ")
    .trim();
}

export function ask(store: Store, toolkit: AgentToolkit, raw: string): AskReply {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const toolCalls: AskToolCall[] = [];
  const call = <T>(name: string, input: Record<string, unknown>): T => {
    toolCalls.push({ name, input });
    return toolkit.dispatch(name, input) as T;
  };

  // "what needs attention / review / is stale"
  if (/\b(attention|review inbox|stale|needs review|what needs)\b/.test(lower)) {
    const attention = call<AttentionSummary>("list_attention", {});
    const bits: string[] = [];
    if (attention.staleContainers.length) bits.push(`${attention.staleContainers.length} stale container${attention.staleContainers.length > 1 ? "s" : ""} (${attention.staleContainers.slice(0, 3).map((c) => c.name).join(", ")}…)`);
    if (attention.uncertainItems.length) bits.push(`${attention.uncertainItems.length} uncertain placement${attention.uncertainItems.length > 1 ? "s" : ""}`);
    if (attention.missingItems.length) bits.push(`${attention.missingItems.length} missing item${attention.missingItems.length > 1 ? "s" : ""}`);
    if (attention.pendingProposals) bits.push(`${attention.pendingProposals} proposal${attention.pendingProposals > 1 ? "s" : ""} waiting in Review`);
    return {
      intent: "attention", toolCalls, attention,
      text: bits.length ? `Here is what needs you: ${bits.join("; ")}.` : "Nothing needs attention — everything is fresh and confident."
    };
  }

  // "which box/container has X"
  const whichMatch = lower.match(/which\s+(box|container|bag|drawer)\s+(?:has|holds|contains)?\s*(.*)/);
  if (whichMatch) {
    const query = cleanQuery(whichMatch[2] ?? "");
    if (query) {
      const hits = call<WhichContainerHit[]>("which_container_has", { query });
      const boxOnly = whichMatch[1] === "box" ? hits.filter((h) => h.isBox) : hits;
      const top = boxOnly[0] ?? hits[0];
      return {
        intent: "which_container", toolCalls, hits: boxOnly.length ? boxOnly : hits,
        text: top
          ? `${top.item} is in ${top.container.name}${top.container.box?.destination ? ` (destination: ${top.container.box.destination})` : ""}.`
          : `I have no container record for “${query}”. If it exists, add it as a belonging or run a container snapshot.`
      };
    }
  }

  // "what's in <container>"
  const inMatch = lower.match(/(?:what'?s?|what is)\s+in\s+(?:the\s+)?(.+)/);
  if (inMatch) {
    const target = cleanQuery(inMatch[1] ?? "");
    const containers = store.containersView();
    const found = containers.find((c) => c.name.toLowerCase() === target)
      ?? containers.find((c) => c.name.toLowerCase().includes(target))
      ?? containers.find((c) => target.includes(c.name.toLowerCase()));
    if (found) {
      const contents = call<ContainerContentsView>("container_contents", { container_id: found.id });
      const names = contents.items.map((i) => i.name);
      let reply = names.length
        ? `${found.name} holds: ${names.join(", ")}.`
        : `${found.name} has no recorded contents.`;
      if (contents.stale) reply += " That record is stale — unknown is not empty, so treat it as a hint and reconfirm.";
      return { intent: "container_contents", toolCalls, contents, text: reply };
    }
    return { intent: "container_contents", toolCalls, text: `I do not know a container called “${target}”. Open Spaces to see what exists.` };
  }

  // "prepare/pack the gym|travel kit", bare "gym"/"travel"
  const kitId = /\b(gym|fitness)\b/.test(lower) && /\b(prepare|pack|start|kit|ready|gym|fitness)\b/.test(lower) ? "gym"
    : /\btravel\b/.test(lower) && /\b(prepare|pack|start|kit|ready|trip|travel)\b/.test(lower) ? "travel"
    : null;
  if (kitId && !/\bwhere\b/.test(lower)) {
    const op = call<{ id: string } | null>("start_operation", { template_id: kitId });
    const opId = op?.id ?? "";
    const plan = call<RetrievalPlanGroup[]>("retrieval_plan", { operation_id: opId });
    const stops = plan.filter((g) => !g.needsReview);
    const review = plan.find((g) => g.needsReview);
    const itemCount = plan.reduce((sum, g) => sum + g.items.length, 0);
    let reply = `Started the ${kitId} kit: ${itemCount} items across ${stops.length} pickup stop${stops.length === 1 ? "" : "s"}.`;
    if (stops[0]) reply += ` First stop — ${stops[0].label}: ${stops[0].items.map((i) => i.name).join(", ")}.`;
    if (review) reply += ` ${review.items.length} item${review.items.length > 1 ? "s" : ""} need${review.items.length > 1 ? "" : "s"} review (${review.items.map((i) => i.name).join(", ")}).`;
    return { intent: "kit", toolCalls, plan, operationId: opId, text: reply };
  }

  // "what should I unpack first"
  if (/\bunpack\b/.test(lower)) {
    const priority = call<UnpackPriorityEntry[]>("unpack_priority", {});
    const top = priority[0];
    return {
      intent: "unpack", toolCalls, priority,
      text: top
        ? `Unpack ${top.box.box?.label ?? top.box.name} first${top.essentials.length ? ` — it has essentials: ${top.essentials.join(", ")}` : ""}. ${priority.length - 1 > 0 ? `${priority.length - 1} more box${priority.length - 1 > 1 ? "es" : ""} after that.` : ""}`.trim()
        : "No boxes are waiting to be unpacked."
    };
  }

  // "declutter / what can I get rid of / clean out / let go / sell / donate"
  // — Declutter Review (Release): decision support, never disposal.
  if (/\b(declutter|get rid of|clean out|let go|throw (out|away)|too much stuff|what can i (sell|donate|toss|throw)|review( my)? (clutter|stuff|belongings for))\b/.test(lower)) {
    const declutter = call<DeclutterReviewResult>("declutter_review", {});
    return { intent: "declutter", toolCalls, declutter, text: declutter.sentence };
  }

  // "do I already have / own a ___?", "do I need to buy ___?", "before I buy ___"
  // — pre-purchase / ownership recall, the durable retention loop.
  if (/\b(do i (already )?(have|own)|already (have|own)|need to buy|should i buy|before i buy|another|a spare|a second)\b/.test(lower)) {
    const query = lower
      .replace(/[?!.,;:"'`]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !OWNERSHIP_FILLER.has(t) && !FILLER.has(t))
      .join(" ")
      .trim();
    if (query) {
      const ownership = call<OwnershipRecallAnswer>("ownership_recall", { query });
      return { intent: "ownership", toolCalls, ownership, text: ownership.sentence };
    }
  }

  // Default: locate.
  const query = cleanQuery(text);
  if (!query) {
    return {
      intent: "help", toolCalls,
      text: "Ask me things like “where is my water bottle?”, “which box has the winter jacket?”, “what's in the entry tray?”, “prepare my gym kit”, “what should I unpack first?”, or “what needs attention?”."
    };
  }
  const answer = call<LocateAnswer>("locate_item", { query });
  return {
    intent: "locate", toolCalls, answer,
    text: answer.ok ? `${answer.sentence} ${answer.hint}` : answer.sentence
  };
}
