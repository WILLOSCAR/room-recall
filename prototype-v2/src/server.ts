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
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { catalog, buildSeedRecords, emptyCatalog } from "./data.ts";
import { createStore, DomainInputError, StoreConflictError } from "./store.ts";
import { AgentInputError, createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import { DECISION_TOOLS } from "./agent-runtime.ts";
import type { StorageLike, Store } from "./types.ts";

// StorageLike over a JSON file: the same seam the browser's localStorage uses,
// so the store code does not know whether it persists to disk or the browser.
export function fileStorage(path: string): StorageLike {
  const load = (): Record<string, string> => {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Corrupt Nestory data file at ${path}: invalid JSON`, { cause: error });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
      throw new Error(`Corrupt Nestory data file at ${path}: expected a string-valued storage object`);
    }
    return parsed as Record<string, string>;
  };

  // The local service is deliberately single-writer. Cache the parsed image so
  // each Store write pays one serialization and one atomic replacement, not a
  // synchronous read/parse/write cycle on the request path.
  let image = load();
  return {
    getItem: (key) => image[key] ?? null,
    setItem: (key, value) => {
      const next = { ...image, [key]: value };
      const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        writeFileSync(tempPath, JSON.stringify(next), { encoding: "utf8", flag: "wx" });
        renameSync(tempPath, path);
        image = next;
      } catch (error) {
        try { unlinkSync(tempPath); } catch { /* temp may not have been created */ }
        throw error;
      }
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
  maxBodyBytes: number;
  maxImportBytes: number;
  idempotency: IdempotencyGuard;
}

interface HttpReply {
  status: number;
  text: string;
}

function jsonText(res: ServerResponse, status: number, text: string): void {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.writeHead(status);
  res.end(text);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  jsonText(res, status, JSON.stringify(body));
}

class HttpProblem extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpProblem(400, "Path segment must use valid percent-encoded UTF-8");
  }
}

type IdempotencyEntry =
  | { kind: "pending"; fingerprint: string; reply: Promise<HttpReply> }
  | { kind: "complete"; fingerprint: string; reply: HttpReply; bytes: number };

class IdempotencyGuard {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private completedBytes = 0;
  private readonly maxEntries: number;
  private readonly maxCompletedBytes: number;

  constructor(maxEntries = 256, maxCompletedBytes = 8 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxCompletedBytes) || maxCompletedBytes < 512) {
      throw new Error("maxIdempotencyResponseBytes must be an integer of at least 512 bytes");
    }
    this.maxEntries = maxEntries;
    this.maxCompletedBytes = maxCompletedBytes;
  }

  run(key: string, fingerprint: string, work: () => Promise<HttpReply> | HttpReply): Promise<HttpReply> {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.resolve(httpReply(409, { error: "Idempotency key was already used for a different request" }));
      return existing.kind === "pending" ? existing.reply : Promise.resolve(existing.reply);
    }

    while (this.entries.size >= this.maxEntries && this.evictOldestComplete()) { /* bounded FIFO */ }
    if (this.entries.size >= this.maxEntries) {
      return Promise.resolve(httpReply(503, { error: "Too many idempotent requests are still in progress; retry later" }));
    }

    let settle!: (reply: HttpReply) => void;
    const pendingReply = new Promise<HttpReply>((resolveReply) => { settle = resolveReply; });
    this.entries.set(key, { kind: "pending", fingerprint, reply: pendingReply });
    queueMicrotask(async () => {
      let result: HttpReply;
      try {
        result = await work();
      } catch (error) {
        result = problemReply(error);
      }
      const storedReply = this.boundedReply(result);
      const bytes = Buffer.byteLength(storedReply.text);
      this.entries.set(key, { kind: "complete", fingerprint, reply: storedReply, bytes });
      this.completedBytes += bytes;
      while (this.completedBytes > this.maxCompletedBytes && this.evictOldestComplete(key)) { /* bounded response memory */ }
      settle(storedReply);
    });
    return pendingReply;
  }

  private boundedReply(reply: HttpReply): HttpReply {
    const originalBytes = Buffer.byteLength(reply.text);
    if (originalBytes <= this.maxCompletedBytes) return reply;
    const successful = reply.status >= 200 && reply.status < 300;
    const receipt = httpReply(reply.status, {
      ok: successful,
      ...(!successful ? { error: "Request completed; the original response was too large to retain for safe replay." } : {}),
      idempotency: {
        requestCompleted: true,
        responseOmitted: true,
        originalStatus: reply.status,
        originalBytes,
        responseSha256: createHash("sha256").update(reply.text).digest("hex")
      }
    });
    if (Buffer.byteLength(receipt.text) > this.maxCompletedBytes) {
      // Keep completion non-throwing even if future receipt metadata grows.
      return httpReply(reply.status, {
        ok: successful,
        idempotency: { requestCompleted: true, responseOmitted: true }
      });
    }
    return receipt;
  }

  private evictOldestComplete(exceptKey?: string): boolean {
    for (const [key, entry] of this.entries) {
      if (key === exceptKey || entry.kind !== "complete") continue;
      this.entries.delete(key);
      this.completedBytes -= entry.bytes;
      return true;
    }
    return false;
  }
}

interface StoreIdempotency {
  guard: IdempotencyGuard;
  maxCompletedBytes: number;
}

const DEFAULT_IDEMPOTENCY_RESPONSE_BYTES = 8 * 1024 * 1024;
const idempotencyByStore = new WeakMap<Store, StoreIdempotency>();

function idempotencyForStore(store: Store, requestedMaxCompletedBytes?: number): IdempotencyGuard {
  const existing = idempotencyByStore.get(store);
  if (existing) {
    if (requestedMaxCompletedBytes !== undefined && requestedMaxCompletedBytes !== existing.maxCompletedBytes) {
      throw new Error("Servers sharing one Store must use the same maxIdempotencyResponseBytes");
    }
    return existing.guard;
  }
  const maxCompletedBytes = requestedMaxCompletedBytes ?? DEFAULT_IDEMPOTENCY_RESPONSE_BYTES;
  const guard = new IdempotencyGuard(256, maxCompletedBytes);
  idempotencyByStore.set(store, { guard, maxCompletedBytes });
  return guard;
}

const MUTATION_TOOLS = new Set([
  "start_operation",
  "mark_not_there",
  "snapshot_container",
  "accept_proposal",
  "reject_proposal",
  "set_kit_row_status"
]);

function httpReply(status: number, body: unknown): HttpReply {
  return { status, text: JSON.stringify(body) };
}

function durabilityStatus(err: unknown): number | null {
  const code = err && typeof err === "object" && "code" in err ? String((err as NodeJS.ErrnoException).code ?? "") : "";
  if (code === "ENOSPC" || code === "EDQUOT") return 507;
  if (["EIO", "EROFS", "EBUSY", "EMFILE", "ENFILE", "EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR"].includes(code)) return 503;
  return null;
}

function asInputProblem(err: unknown, status = 400): never {
  if (err instanceof DomainInputError || err instanceof AgentInputError) {
    throw new HttpProblem(status, err.message);
  }
  throw err;
}

function problemReply(err: unknown): HttpReply {
  const message = err instanceof Error ? err.message : String(err);
  const durability = durabilityStatus(err);
  const status = err instanceof HttpProblem ? err.status
    : err instanceof StoreConflictError ? 409
      : durability ?? 500;
  const publicMessage = status < 500 ? message
    : durability !== null ? "Home memory could not be durably updated."
      : "Home memory request failed safely.";
  return httpReply(status, { error: publicMessage });
}

function idempotencyKey(req: IncomingMessage): string | null {
  const raw = req.headers["idempotency-key"];
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(raw)) {
    throw new HttpProblem(400, "Idempotency-Key must be 1-128 URL-safe characters");
  }
  return raw;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  const scalar = JSON.stringify(value);
  if (scalar === undefined) throw new HttpProblem(400, "Request body contains a value that JSON cannot fingerprint");
  return scalar;
}

function requestFingerprint(path: string, body: Record<string, unknown>): string {
  return createHash("sha256").update(`POST\n${path}\n${canonicalJson(body)}`).digest("hex");
}

function idempotentMutation(
  req: IncomingMessage,
  path: string,
  body: Record<string, unknown>,
  ctx: RouteContext,
  work: () => HttpReply | Promise<HttpReply>
): Promise<HttpReply> | HttpReply {
  const key = idempotencyKey(req);
  return key ? ctx.idempotency.run(key, requestFingerprint(path, body), work) : work();
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const declaredBytes = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    req.resume();
    throw new HttpProblem(413, `Request body is too large; limit is ${maxBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let tooLarge = false;
  for await (const rawChunk of req) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    receivedBytes += chunk.byteLength;
    if (receivedBytes > maxBytes) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }
  if (tooLarge) throw new HttpProblem(413, `Request body is too large; limit is ${maxBytes} bytes`);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new HttpProblem(400, `Body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpProblem(400, "Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function handleGet(path: string, url: URL, ctx: RouteContext, res: ServerResponse): boolean {
  const { store, toolkit } = ctx;
  const q = url.searchParams.get("q") ?? "";
  if (path === "/health") {
    json(res, 200, { ok: true, service: "nestory-sync", records: store.recordCount, tools: toolkit.tools.length });
    return true;
  }
  if (path === "/export") { jsonText(res, 200, store.exportJsonText()); return true; }
  if (path === "/locate") { json(res, 200, store.locate(q)); return true; }
  if (path === "/search") {
    const limitParam = url.searchParams.get("limit");
    if (limitParam === null) {
      // Preserve the original full-array contract for existing local clients.
      // New callers should opt into the bounded envelope below.
      json(res, 200, store.searchBelongings(q));
      return true;
    }
    const offsetParam = url.searchParams.get("offset") ?? "0";
    const limit = Number(limitParam);
    const offset = Number(offsetParam);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new HttpProblem(400, "Search limit must be an integer from 1 to 200");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new HttpProblem(400, "Search offset must be a non-negative integer");
    }
    const page = store.searchBelongingsPage(q, offset, limit);
    const items = page.items.map((item) => ({
      id: item.id,
      name: item.name,
      importance: item.importance,
      state: item.state,
      chainText: item.chainText,
      atDefaultHome: item.atDefaultHome,
      confidence: item.confidence,
      daysSinceUpdate: item.daysSinceUpdate,
      score: item.score
    }));
    const nextOffset = offset + items.length < page.total ? offset + items.length : null;
    json(res, 200, {
      items,
      page: { offset, limit, returned: items.length, total: page.total, hasMore: nextOffset !== null, nextOffset, projection: "summary" },
      revision: store.revision
    });
    return true;
  }
  if (path === "/containers") { json(res, 200, store.containersView()); return true; }
  const contentsMatch = path.match(/^\/containers\/([^/]+)\/contents$/);
  if (contentsMatch) {
    const contents = store.containerContents(decodePathSegment(contentsMatch[1] ?? ""));
    if (!contents) { json(res, 404, { error: "unknown container" }); return true; }
    json(res, 200, contents);
    return true;
  }
  if (path === "/operations") { json(res, 200, store.operationsView()); return true; }
  const planMatch = path.match(/^\/operations\/([^/]+)\/retrieval-plan$/);
  if (planMatch) { json(res, 200, store.retrievalPlan(decodePathSegment(planMatch[1] ?? ""))); return true; }
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

async function handlePost(path: string, req: IncomingMessage, ctx: RouteContext): Promise<HttpReply | null> {
  const { store, toolkit } = ctx;
  if (path === "/import") {
    const expectedRevision = store.revision;
    const body = await readBody(req, ctx.maxImportBytes);
    return idempotentMutation(req, path, body, ctx, () => {
      try {
        store.importJson(body, expectedRevision);
      } catch (error) {
        if (error instanceof StoreConflictError) throw error;
        asInputProblem(error);
      }
      return httpReply(200, { ok: true, records: store.recordCount });
    });
  }
  if (path === "/ask") {
    const body = await readBody(req, ctx.maxBodyBytes);
    const text = typeof body["text"] === "string" ? body["text"] : "";
    if (!text.trim()) return httpReply(400, { error: "Body needs { text }" });
    return idempotentMutation(req, path, body, ctx, () => {
      try {
        return httpReply(200, ask(store, toolkit, text));
      } catch (error) {
        return asInputProblem(error);
      }
    });
  }
  const toolMatch = path.match(/^\/tools\/([^/]+)$/);
  if (toolMatch) {
    const name = decodePathSegment(toolMatch[1] ?? "");
    const body = await readBody(req, ctx.maxBodyBytes);
    const args = (body["args"] && typeof body["args"] === "object" && !Array.isArray(body["args"]))
      ? body["args"] as Record<string, unknown>
      : {};
    if (!toolkit.tools.some((t) => t.name === name)) {
      return httpReply(404, { error: `Unknown tool: ${name}` });
    }
    const dispatch = (): HttpReply => {
      if (DECISION_TOOLS.includes(name) && body["confirmed"] !== true) {
        return httpReply(403, { error: `Decision tool ${name} needs { "confirmed": true } — the user must explicitly approve.` });
      }
      try {
        return httpReply(200, { ok: true, result: toolkit.dispatch(name, args) });
      } catch (error) {
        return asInputProblem(error);
      }
    };
    return MUTATION_TOOLS.has(name) ? idempotentMutation(req, path, body, ctx, dispatch) : dispatch();
  }
  return null;
}

export async function startNestoryServer(options: {
  store: Store;
  port?: number;
  host?: string;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  maxImportBytes?: number;
  /** Completed idempotency response-body budget. Defaults to 8 MiB. */
  maxIdempotencyResponseBytes?: number;
}): Promise<NestoryServer> {
  const { store } = options;
  const host = options.host ?? "127.0.0.1";
  const toolkit = createAgentToolkit(store);
  const ctx: RouteContext = {
    store,
    toolkit,
    maxBodyBytes: options.maxBodyBytes ?? 256 * 1024,
    maxImportBytes: options.maxImportBytes ?? 8 * 1024 * 1024,
    idempotency: idempotencyForStore(store, options.maxIdempotencyResponseBytes)
  };
  const configuredOrigins = new Set(options.allowedOrigins ?? []);

  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : options.port ?? 0;
      const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
      const sameOrigin = typeof origin === "string" && origin === `http://${urlHost}:${boundPort}`;
      const corsAllowed = typeof origin === "string" && (sameOrigin || configuredOrigins.has(origin));
      if (corsAllowed) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "origin");
      }
      if (origin && !corsAllowed) {
        req.resume();
        json(res, 403, { error: "Cross-origin access is not allowed" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (req.method === "OPTIONS") {
        if (origin && !corsAllowed) {
          json(res, 403, { error: "Cross-origin access is not allowed" });
          return;
        }
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type,idempotency-key");
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-content-type-options", "nosniff");
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && handleGet(path, url, ctx, res)) return;
      if (req.method === "POST") {
        const reply = await handlePost(path, req, ctx);
        if (reply) { jsonText(res, reply.status, reply.text); return; }
      }
      json(res, 404, { error: `No route: ${req.method} ${path}` });
    } catch (err) {
      const reply = problemReply(err);
      jsonText(res, reply.status, reply.text);
    }
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : options.port ?? 0);
    });
  });

  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return {
    url: `http://${urlHost}:${port}`,
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
  console.log(`Data file: ${resolve(dataPath)} (${store.recordCount} records, ${empty ? "own home" : "demo home"} seed)`);
  console.log(`Read:  GET /health /locate?q= /search?q= /containers /containers/:id/contents /operations /operations/:id/retrieval-plan /proposals /attention /activation /export /tools`);
  console.log(`Write: POST /tools/:name { args, confirmed? } · POST /ask { text } · POST /import`);
  console.log(`Decision tools (${DECISION_TOOLS.join(", ")}) require { "confirmed": true }. Ctrl+C to stop.`);
}
