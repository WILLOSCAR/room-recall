// Nestory agent toolkit: the deterministic answer contract exposed as typed
// tool functions, ready to be bound to an LLM runtime (handoff §19 Next 3).
//
// Rules the toolkit enforces (same as the store):
// - Capture tools (snapshot_container, mark_not_there) return proposals; they
//   never mutate the Place Graph directly.
// - accept_proposal / reject_proposal are the only decision tools, and they
//   commit through the ledger like every other mutation.
// - Read tools return the same evidence/confidence/freshness views the UI uses.

import type { PlaceRef, RowStatus, Store } from "./types.ts";

export interface AgentToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: readonly string[];
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, AgentToolParameter>;
    required: readonly string[];
  };
}

export interface AgentToolkit {
  tools: AgentToolDescriptor[];
  /** Execute a tool by name. Throws on unknown tools or missing required args. */
  dispatch(name: string, args?: Record<string, unknown>): unknown;
}

interface ToolImpl {
  descriptor: AgentToolDescriptor;
  run(args: Record<string, unknown>): unknown;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Tool argument "${key}" must be a non-empty string.`);
  return value;
}

function optionalStr(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`Tool argument "${key}" must be a string.`);
  return value;
}

export function createAgentToolkit(store: Store): AgentToolkit {
  const tools: ToolImpl[] = [
    {
      descriptor: {
        name: "locate_item",
        description: "Answer 'where is X?' with place chain, default home, evidence, confidence, freshness, and an uncertainty admission when stale. Never guesses silently.",
        parameters: { type: "object", properties: { query: { type: "string", description: "Item name or kind, e.g. 'water bottle'." } }, required: ["query"] }
      },
      run: (args) => store.locate(str(args, "query"))
    },
    {
      descriptor: {
        name: "which_container_has",
        description: "Find which container (including moving boxes) holds a belonging.",
        parameters: { type: "object", properties: { query: { type: "string", description: "Item name or kind." } }, required: ["query"] }
      },
      run: (args) => store.whichContainerHas(str(args, "query"))
    },
    {
      descriptor: {
        name: "container_contents",
        description: "List what a container is believed to hold, with freshness. Stale containers say 'unknown is not empty'.",
        parameters: { type: "object", properties: { container_id: { type: "string", description: "Container id." } }, required: ["container_id"] }
      },
      run: (args) => {
        const contents = store.containerContents(str(args, "container_id"));
        if (!contents) throw new Error("Unknown container.");
        return contents;
      }
    },
    {
      descriptor: {
        name: "list_containers",
        description: "List all containers with item counts and freshness, so the agent can pick ids for other tools.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      run: () => store.containersView()
    },
    {
      descriptor: {
        name: "list_attention",
        description: "What needs the user's attention: stale containers, uncertain placements, missing items, pending proposals.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      run: () => store.attention()
    },
    {
      descriptor: {
        name: "start_operation",
        description: "Start an operation from a template (move, gym, travel). Kit templates expand into a merged checklist against real belongings.",
        parameters: { type: "object", properties: { template_id: { type: "string", description: "Operation template id.", enum: ["move", "gym", "travel"] } }, required: ["template_id"] }
      },
      run: (args) => {
        const opId = store.startOperation(str(args, "template_id"));
        const op = store.operationView(opId);
        if (!op) return null;
        // Slim summary: full operation views are heavy for model context;
        // retrieval_plan / unpack_priority give the details on demand.
        return op.type === "kit"
          ? { id: op.id, name: op.name, type: op.type, readiness: op.readiness, rows: op.rows.length }
          : { id: op.id, name: op.name, type: op.type, readiness: op.readiness, boxes: op.boxes.length };
      }
    },
    {
      descriptor: {
        name: "retrieval_plan",
        description: "Compile a kit operation into pickup stops grouped by furniture/room, with a needs-review group for unresolved rows.",
        parameters: { type: "object", properties: { operation_id: { type: "string", description: "Kit operation id." } }, required: ["operation_id"] }
      },
      run: (args) => store.retrievalPlan(str(args, "operation_id"))
    },
    {
      descriptor: {
        name: "unpack_priority",
        description: "Order moving boxes by unpack priority (essentials first).",
        parameters: { type: "object", properties: { operation_id: { type: "string", description: "Optional move operation id to scope to." } }, required: [] }
      },
      run: (args) => store.unpackPriority(optionalStr(args, "operation_id"))
    },
    {
      descriptor: {
        name: "mark_not_there",
        description: "Record the user's report that an item is NOT at its answered place. Creates negative evidence and opens a correction proposal — never overwrites history.",
        parameters: { type: "object", properties: { item_id: { type: "string", description: "Belonging id." } }, required: ["item_id"] }
      },
      run: (args) => store.markNotThere(str(args, "item_id"))
    },
    {
      descriptor: {
        name: "snapshot_container",
        description: "Record what a container appears to hold (text note). Produces a reviewable contents proposal — it never writes placements directly.",
        parameters: {
          type: "object",
          properties: {
            container_id: { type: "string", description: "Container id." },
            seen_text: { type: "string", description: "Comma-separated things seen inside." }
          },
          required: ["container_id", "seen_text"]
        }
      },
      run: (args) => ({ proposalId: store.snapshotContainer(str(args, "container_id"), str(args, "seen_text")) })
    },
    {
      descriptor: {
        name: "pending_proposals",
        description: "List proposals waiting for the user's review decision.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      run: () => store.proposals("pending")
    },
    {
      descriptor: {
        name: "accept_proposal",
        description: "Accept a pending proposal on the user's behalf (only after the user explicitly agrees). Placement corrections need place_container_id.",
        parameters: {
          type: "object",
          properties: {
            proposal_id: { type: "string", description: "Pending proposal id." },
            place_container_id: { type: "string", description: "Target container id for corrections that ask 'where is it actually?'." }
          },
          required: ["proposal_id"]
        }
      },
      run: (args) => {
        const placeId = optionalStr(args, "place_container_id");
        const extra = placeId ? { placeRef: { type: "container", id: placeId } as PlaceRef } : {};
        return store.acceptProposal(str(args, "proposal_id"), extra);
      }
    },
    {
      descriptor: {
        name: "reject_proposal",
        description: "Reject a pending proposal (only after the user explicitly decides). The rejection itself is ledgered.",
        parameters: {
          type: "object",
          properties: {
            proposal_id: { type: "string", description: "Pending proposal id." },
            reason: { type: "string", description: "Why the user rejected it." }
          },
          required: ["proposal_id"]
        }
      },
      run: (args) => store.rejectProposal(str(args, "proposal_id"), optionalStr(args, "reason") ?? "rejected by user"),
    },
    {
      descriptor: {
        name: "set_kit_row_status",
        description: "Update one kit checklist row after the user reports progress (found, packed, skipped, substituted, missing, uncertain, to_get).",
        parameters: {
          type: "object",
          properties: {
            operation_id: { type: "string", description: "Kit operation id." },
            row_id: { type: "string", description: "Checklist row id." },
            status: { type: "string", description: "New row status.", enum: ["to_get", "found", "packed", "skipped", "substituted", "missing", "uncertain"] }
          },
          required: ["operation_id", "row_id", "status"]
        }
      },
      run: (args) => store.setRowStatus(str(args, "operation_id"), str(args, "row_id"), str(args, "status") as RowStatus)
    }
  ];

  const byName = new Map(tools.map((t) => [t.descriptor.name, t]));

  return {
    tools: tools.map((t) => t.descriptor),
    dispatch(name, args = {}) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      for (const required of tool.descriptor.parameters.required) {
        if (args[required] === undefined || args[required] === null) {
          throw new Error(`Tool ${name} requires argument "${required}".`);
        }
      }
      return tool.run(args);
    }
  };
}
