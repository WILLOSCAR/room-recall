// Nestory local sync service (PRD P0.10): a zero-dependency HTTP API over the
// same Store contract the browser uses, persisted to a JSON file.
//
//   node src/server.ts [data.json] [--empty] [--port 8788]
//
// Design rules:
// - Read endpoints return the same derived views the UI renders.
// - The agent toolkit is the ONLY write path (POST /tools/:name) — no second
//   write model to keep consistent.
// - Decision tools (accept_proposal / reject_proposal) require
//   { "confirmed": true } in the body and 403 otherwise — the same consent
//   guard as the agent runtime.
// - GET /export and POST /import stay schema-compatible with the app's
//   Ledger export (record schema version 2).

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { catalog, buildSeedRecords, emptyCatalog } from "./data.ts";
import { createStore } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import { DECISION_TOOLS } from "./agent-runtime.ts";
import type { StorageLike, Store } from "./types.ts";

// StorageLike over a JSON file: the same seam the browser's localStorage uses,
// so the store code does not know whether it persists to disk or the browser.
export function fileStorage(path: string): StorageLike {
  const readAll = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch { return {}; }
  };
  return {
    getItem: (key) => readAll()[key] ?? null,
    setItem: (key, value) => {
      const all = readAll();
      all[key] = value;
      writeFileSync(path, JSON.stringify(all));
    }
  };
}

export interface NestoryServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface RouteContext {
  store: Store;
  toolkit: AgentToolkit;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function handleGet(path: string, url: URL, ctx: RouteContext, res: ServerResponse): boolean {
  const { store, toolkit } = ctx;
  const q = url.searchParams.get("q") ?? "";
  if (path === "/health") {
    json(res, 200, { ok: true, service: "nestory-sync", records: store.exportJson().records.length, tools: toolkit.tools.length });
    return true;
  }
  if (path === "/export") { json(res, 200, store.exportJson()); return true; }
  if (path === "/locate") { json(res, 200, store.locate(q)); return true; }
  if (path === "/search") { json(res, 200, store.searchBelongings(q)); return true; }
  if (path === "/containers") { json(res, 200, store.containersView()); return true; }
  const contentsMatch = path.match(/^\/containers\/([^/]+)\/contents$/);
  if (contentsMatch) {
    const contents = store.containerContents(decodeURIComponent(contentsMatch[1] ?? ""));
    if (!contents) { json(res, 404, { error: "unknown container" }); return true; }
    json(res, 200, contents);
    return true;
  }
  if (path === "/operations") { json(res, 200, store.operationsView()); return true; }
  const planMatch = path.match(/^\/operations\/([^/]+)\/retrieval-plan$/);
  if (planMatch) { json(res, 200, store.retrievalPlan(decodeURIComponent(planMatch[1] ?? ""))); return true; }
  if (path === "/proposals") {
    const statusParam = url.searchParams.get("status");
    const filter = statusParam === "all" ? null
      : statusParam === "accepted" || statusParam === "rejected" || statusParam === "pending" ? statusParam
      : "pending";
    json(res, 200, store.proposals(filter));
    return true;
  }
  if (path === "/attention") { json(res, 200, store.attention()); return true; }
  if (path === "/activation") { json(res, 200, store.activation()); return true; }
  if (path === "/tools") { json(res, 200, toolkit.tools); return true; }
  return false;
}

async function handlePost(path: string, req: IncomingMessage, ctx: RouteContext, res: ServerResponse): Promise<boolean> {
  const { store, toolkit } = ctx;
  if (path === "/import") {
    const body = await readBody(req);
    store.importJson(body);
    json(res, 200, { ok: true, records: store.exportJson().records.length });
    return true;
  }
  if (path === "/ask") {
    const body = await readBody(req);
    const text = typeof body["text"] === "string" ? body["text"] : "";
    if (!text.trim()) { json(res, 400, { error: "Body needs { text }" }); return true; }
    json(res, 200, ask(store, toolkit, text));
    return true;
  }
  const toolMatch = path.match(/^\/tools\/([^/]+)$/);
  if (toolMatch) {
    const name = decodeURIComponent(toolMatch[1] ?? "");
    const body = await readBody(req);
    const args = (body["args"] && typeof body["args"] === "object" && !Array.isArray(body["args"]))
      ? body["args"] as Record<string, unknown>
      : {};
    if (DECISION_TOOLS.includes(name) && body["confirmed"] !== true) {
      json(res, 403, { error: `Decision tool ${name} needs { "confirmed": true } — the user must explicitly approve.` });
      return true;
    }
    if (!toolkit.tools.some((t) => t.name === name)) {
      json(res, 404, { error: `Unknown tool: ${name}` });
      return true;
    }
    json(res, 200, { ok: true, result: toolkit.dispatch(name, args) });
    return true;
  }
  return false;
}

export async function startNestoryServer(options: { store: Store; port?: number; host?: string }): Promise<NestoryServer> {
  const { store } = options;
  const host = options.host ?? "127.0.0.1";
  const toolkit = createAgentToolkit(store);
  const ctx: RouteContext = { store, toolkit };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type"
        });
        res.end();
        return;
      }
      if (req.method === "GET" && handleGet(path, url, ctx, res)) return;
      if (req.method === "POST" && await handlePost(path, req, ctx, res)) return;
      json(res, 404, { error: `No route: ${req.method} ${path}` });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : options.port ?? 0);
    });
  });

  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise<void>((resolveClose) => { server.close(() => resolveClose()); })
  };
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
  const args = process.argv.slice(2);
  const empty = args.includes("--empty");
  const portFlag = args.indexOf("--port");
  const port = portFlag >= 0 ? Number(args[portFlag + 1] ?? "8788") : Number(process.env["NESTORY_PORT"] ?? "8788");
  const dataPath = args.find((a) => !a.startsWith("--") && a !== String(port)) ?? "./nestory-data.json";

  const store = createStore(
    empty
      ? { catalog: emptyCatalog, seedFactory: () => [], storage: fileStorage(dataPath), persistKey: "nestory-v2-own" }
      : { catalog, seedFactory: () => buildSeedRecords(Date.now()), storage: fileStorage(dataPath), persistKey: "nestory-v2" }
  );

  const running = await startNestoryServer({ store, port });
  console.log(`Nestory sync service · ${running.url}`);
  console.log(`Data file: ${resolve(dataPath)} (${store.exportJson().records.length} records, ${empty ? "own home" : "demo home"} seed)`);
  console.log(`Read:  GET /health /locate?q= /search?q= /containers /containers/:id/contents /operations /operations/:id/retrieval-plan /proposals /attention /activation /export /tools`);
  console.log(`Write: POST /tools/:name { args, confirmed? } · POST /ask { text } · POST /import`);
  console.log(`Decision tools (${DECISION_TOOLS.join(", ")}) require { "confirmed": true }. Ctrl+C to stop.`);
}
