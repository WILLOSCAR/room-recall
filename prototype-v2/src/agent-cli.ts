// Nestory agent CLI: chat with your home memory in the terminal.
//
//   node src/agent-cli.ts [export.json]
//
// With ANTHROPIC_API_KEY set, the 14 Nestory tools are bound to a real Claude
// model through the Messages API (no SDK dependency). Without a key, the same
// questions route through the deterministic Ask router — identical contract,
// no model. Pass an export from the app (Ledger -> Export JSON) to chat with
// your own records instead of the demo seed.

import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";

import { catalog, buildSeedRecords } from "./data.ts";
import { createStore } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import { claudeLlm, runAgentTurn } from "./agent-runtime.ts";
import type { ChatMessage } from "./agent-runtime.ts";

const apiKey = process.env["ANTHROPIC_API_KEY"] ?? null;
const model = process.env["NESTORY_MODEL"] ?? "claude-sonnet-5";

const exportPath = process.argv[2] ?? null;
const store = createStore({ catalog, seedFactory: () => buildSeedRecords(Date.now()), storage: null });
if (exportPath) {
  store.importJson(JSON.parse(readFileSync(exportPath, "utf8")));
  console.log(`Loaded records from ${exportPath}`);
} else {
  console.log("Using the demo home (pass an app export JSON to use your own records).");
}
const toolkit = createAgentToolkit(store);

console.log(apiKey
  ? `Nestory agent · Claude (${model}) bound to ${toolkit.tools.length} tools. Decision tools stay blocked — decide proposals in the app's Review inbox.`
  : `Nestory agent · deterministic router (set ANTHROPIC_API_KEY to bind a real Claude model). ${toolkit.tools.length} tools available.`);
console.log(`Try: "where is my water bottle?", "which box has the winter jacket?", "prepare my gym kit", "what needs attention?". Ctrl+C or "exit" to quit.\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => { console.log("\nbye."); process.exit(0); });
const llm = apiKey ? claudeLlm(apiKey, model) : null;
let history: ChatMessage[] = [];

for (;;) {
  const line = (await rl.question("you · ")).trim();
  if (!line) continue;
  if (line === "exit" || line === "quit") break;

  if (llm) {
    try {
      const turn = await runAgentTurn({ toolkit, llm, userText: line, history });
      history = turn.history;
      for (const event of turn.events) {
        if (event.kind === "tool_call") console.log(`  → ${event.name}(${JSON.stringify(event.input)})${event.isError ? " ✗" : ""}`);
      }
      console.log(`nestory · ${turn.finalText}\n`);
    } catch (err) {
      console.error(`error · ${err instanceof Error ? err.message : String(err)}\n`);
    }
  } else {
    const reply = ask(store, toolkit, line);
    for (const call of reply.toolCalls) console.log(`  → ${call.name}(${JSON.stringify(call.input)})`);
    console.log(`nestory · ${reply.text}\n`);
  }
}

rl.close();
