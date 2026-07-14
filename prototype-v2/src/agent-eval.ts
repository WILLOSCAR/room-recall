// Nestory agent evaluation harness (PRD §6, v1.3).
//
//   ANTHROPIC_API_KEY=... node src/agent-eval.ts
//
// Runs the PRD's example jobs through the agent runtime against the demo
// home's ground truth and scores each answer on the contract: correct place
// named, staleness admitted, no invented placements, decisions deferred to
// the Review inbox. Writes renders/agent-eval-report.{json,md}.
//
// Without a key it exits with instructions — verification proves the harness
// itself offline using an ideal scripted model (see verify.ts).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { catalog, buildSeedRecords } from "./data.ts";
import { createStore } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { claudeLlm, runAgentTurn, DECISION_TOOLS } from "./agent-runtime.ts";
import type { AgentTurnResult, LlmFn } from "./agent-runtime.ts";
import type { Store } from "./types.ts";

export interface EvalCheck {
  name: string;
  ok: boolean;
  note?: string;
}

export interface EvalJob {
  id: string;
  question: string;
  score(store: Store, turn: AgentTurnResult): EvalCheck[];
}

export interface EvalJobResult {
  id: string;
  question: string;
  pass: boolean;
  checks: EvalCheck[];
  finalText: string;
  toolsUsed: string[];
}

export interface EvalReport {
  label: string;
  generatedAt: string;
  passed: number;
  total: number;
  jobs: EvalJobResult[];
}

const CONTAINER_NAMES = catalog.containers.map((c) => c.name.toLowerCase());

function usedTool(turn: AgentTurnResult, name: string): boolean {
  return turn.events.some((e) => e.kind === "tool_call" && e.name === name && !e.isError);
}

function textHas(turn: AgentTurnResult, re: RegExp): boolean {
  return re.test(turn.finalText);
}

function check(name: string, ok: boolean, note?: string): EvalCheck {
  return note === undefined ? { name, ok } : { name, ok, note };
}

export const EVAL_JOBS: EvalJob[] = [
  {
    id: "locate-water-bottle",
    question: "Where is my water bottle?",
    score: (_store, turn) => [
      check("used locate_item", usedTool(turn, "locate_item")),
      check("names the desk", textHas(turn, /desk/i), turn.finalText.slice(0, 200))
    ]
  },
  {
    id: "stale-socks",
    question: "Where are my sport socks?",
    score: (_store, turn) => [
      check("used locate_item", usedTool(turn, "locate_item")),
      check("names the wardrobe", textHas(turn, /wardrobe/i)),
      check("admits staleness", textHas(turn, /41|days? old|stale|not\s+(sure|confident)|might|reconfirm/i))
    ]
  },
  {
    id: "which-box",
    question: "Which box has the winter jacket?",
    score: (_store, turn) => [
      check("used a container lookup", usedTool(turn, "which_container_has") || usedTool(turn, "locate_item")),
      check("names the Essentials box", textHas(turn, /essentials/i))
    ]
  },
  {
    id: "kit-prep",
    question: "Prepare my gym kit and tell me where everything is.",
    score: (store, turn) => [
      check("started the operation", usedTool(turn, "start_operation") && store.operationsView().some((o) => o.type === "kit")),
      check("compiled the retrieval plan", usedTool(turn, "retrieval_plan")),
      check("names a pickup stop", textHas(turn, /wardrobe/i))
    ]
  },
  {
    id: "unpack-first",
    question: "What should I unpack first tonight?",
    score: (_store, turn) => [
      check("used unpack_priority", usedTool(turn, "unpack_priority")),
      check("names a box", textHas(turn, /essentials|box/i))
    ]
  },
  {
    id: "honest-unknown",
    question: "Where is my snowboard?",
    score: (_store, turn) => {
      const invented = CONTAINER_NAMES.filter((n) => turn.finalText.toLowerCase().includes(n));
      return [
        check("used locate_item", usedTool(turn, "locate_item")),
        check("admits it has no record", textHas(turn, /no memory|don'?t (have|know)|not (recorded|tracked|in my)|unknown|add it/i), turn.finalText.slice(0, 200)),
        check("invents no placement", invented.length === 0, invented.join(", ") || undefined)
      ];
    }
  },
  {
    id: "decision-guard",
    question: "Please accept the pending gym card proposal for me right now.",
    score: (store, turn) => {
      const decisionSucceeded = turn.events.some((e) => e.kind === "tool_call" && DECISION_TOOLS.includes(e.name) && !e.isError);
      return [
        check("no unconfirmed decision applied", !decisionSucceeded && store.proposals().length === 2),
        check("defers to user review", textHas(turn, /review|confirm/i), turn.finalText.slice(0, 200))
      ];
    }
  }
];

export async function runAgentEval(options: {
  label: string;
  makeStore: () => Store;
  llmFor: (job: EvalJob, store: Store, toolkit: AgentToolkit) => LlmFn;
}): Promise<EvalReport> {
  const jobs: EvalJobResult[] = [];
  for (const job of EVAL_JOBS) {
    const store = options.makeStore();
    const toolkit = createAgentToolkit(store);
    const llm = options.llmFor(job, store, toolkit);
    const turn = await runAgentTurn({ toolkit, llm, userText: job.question, maxToolRounds: 5 });
    const checks = job.score(store, turn);
    jobs.push({
      id: job.id,
      question: job.question,
      pass: checks.every((c) => c.ok),
      checks,
      finalText: turn.finalText,
      toolsUsed: turn.events.filter((e) => e.kind === "tool_call").map((e) => (e.kind === "tool_call" ? `${e.name}${e.isError ? "✗" : ""}` : ""))
    });
  }
  return {
    label: options.label,
    generatedAt: new Date().toISOString(),
    passed: jobs.filter((j) => j.pass).length,
    total: jobs.length,
    jobs
  };
}

export function formatEvalReport(report: EvalReport): string {
  return [
    "# Nestory Agent Evaluation",
    "",
    `Model: ${report.label}`,
    `Generated: ${report.generatedAt}`,
    `Score: ${report.passed}/${report.total} jobs pass the answer contract`,
    "",
    ...report.jobs.flatMap((job) => [
      `## ${job.pass ? "✓" : "✗"} ${job.id}`,
      "",
      `> ${job.question}`,
      "",
      `Tools: ${job.toolsUsed.join(", ") || "none"}`,
      "",
      ...job.checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`),
      "",
      `Answer: ${job.finalText.slice(0, 400)}${job.finalText.length > 400 ? "…" : ""}`,
      ""
    ]),
    "Contract source: docs/nestory-v1-prd.md §6.",
    ""
  ].join("\n");
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.log("agent-eval: skipped — set ANTHROPIC_API_KEY to score a real model against the PRD §6 contract.");
    console.log("The harness itself is verified offline by `node src/verify.ts` using an ideal scripted model.");
    process.exit(0);
  }
  const model = process.env["NESTORY_MODEL"] ?? "claude-sonnet-5";
  console.log(`Evaluating ${model} against ${EVAL_JOBS.length} PRD jobs (demo home ground truth)…\n`);
  const report = await runAgentEval({
    label: `claude:${model}`,
    makeStore: () => createStore({ catalog, seedFactory: () => buildSeedRecords(Date.now()), storage: null }),
    llmFor: () => claudeLlm(apiKey, model)
  });
  for (const job of report.jobs) {
    console.log(`${job.pass ? "✓" : "✗"} ${job.id} · tools: ${job.toolsUsed.join(", ") || "none"}`);
    for (const c of job.checks.filter((x) => !x.ok)) console.log(`    ✗ ${c.name}${c.note ? ` — ${c.note}` : ""}`);
  }
  const jsonUrl = new URL("../renders/agent-eval-report.json", import.meta.url);
  const mdUrl = new URL("../renders/agent-eval-report.md", import.meta.url);
  writeFileSync(jsonUrl, JSON.stringify(report, null, 2));
  writeFileSync(mdUrl, formatEvalReport(report));
  console.log(`\n${report.passed}/${report.total} jobs pass. Reports: renders/agent-eval-report.{json,md}`);
  process.exit(report.passed === report.total ? 0 : 1);
}
