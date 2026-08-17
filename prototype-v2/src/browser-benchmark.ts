import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { performance } from "node:perf_hooks";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { buildSeedRecords, catalog } from "./data.ts";
import { buildHouseholdRecords, HOUSEHOLD_ITEM_COUNT, SCALE_NOW } from "./scale-fixture.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../renders/", import.meta.url));
const defaultChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath = process.env["NESTORY_CHROME_PATH"] ?? defaultChromePath;
const viewport = { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false } as const;
const surfaceBudgetMs = 100;
const chromeFlags = [
  "--headless=new",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-extensions",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--remote-debugging-port=0"
] as const;

interface Distribution {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  samples: number;
}

interface GatedDistribution extends Distribution {
  budgetMs: number;
  pass: boolean;
}

interface BrowserFixtureReport {
  fixture: {
    recordCount: number;
    belongingCount: number;
    persistedLedgerCharacters: number;
  };
  cacheBypassedReloadFirstContentfulPaintMs: Distribution;
  cacheBypassedReloadReadyControllerObservedMs: Distribution;
  interactionDomLayoutCriticalPathMs: Distribution;
  rawHeadlessRafCallbackLatencyMs: Distribution;
  interactionToCapturedCompositorSurfaceUpperBoundMs: GatedDistribution;
  capturedPngBytes: Distribution;
}

interface CdpClient {
  send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T>;
  waitForEvent<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    timeoutMs?: number
  ): Promise<T>;
  close(): void;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    samples: sorted.length
  };
}

function gatedDistribution(samples: readonly number[], budgetMs: number): GatedDistribution {
  const measured = distribution(samples);
  return { ...measured, budgetMs, pass: measured.p95 < budgetMs };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectCdp(webSocketUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  const eventWaiters = new Map<string, Array<{
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>();

  const rejectAll = (message: string): void => {
    const error = new Error(message);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    for (const entries of eventWaiters.values()) {
      for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
    }
    eventWaiters.clear();
  };

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      error?: { message?: string };
      result?: Record<string, unknown>;
    };
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? "CDP command failed"));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    const entries = eventWaiters.get(message.method);
    const entry = entries?.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entries?.length === 0) eventWaiters.delete(message.method);
    entry.resolve(message.params ?? {});
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({
      send: <T extends Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) => {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise<T>((commandResolve, commandReject) => {
          pending.set(id, {
            resolve: (value) => commandResolve(value as T),
            reject: commandReject
          });
        });
      },
      waitForEvent: <T extends Record<string, unknown>>(method: string, timeoutMs = 15_000) =>
        new Promise<T>((eventResolve, eventReject) => {
          const entry = {
            resolve: (value: Record<string, unknown>) => eventResolve(value as T),
            reject: eventReject,
            timer: setTimeout(() => {
              const entries = eventWaiters.get(method);
              if (entries) {
                const index = entries.indexOf(entry);
                if (index >= 0) entries.splice(index, 1);
                if (entries.length === 0) eventWaiters.delete(method);
              }
              eventReject(new Error(`Timed out waiting for CDP event ${method}`));
            }, timeoutMs)
          };
          const entries = eventWaiters.get(method) ?? [];
          entries.push(entry);
          eventWaiters.set(method, entries);
        }),
      close: () => socket.close()
    }));
    socket.addEventListener("error", () => reject(new Error("CDP websocket connection failed")), { once: true });
    socket.addEventListener("close", () => rejectAll("CDP websocket closed"));
  });
}

async function waitForDevToolsPort(userDataDirectory: string): Promise<number> {
  const activePortPath = join(userDataDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [portText] = (await readFile(activePortPath, "utf8")).split(/\r?\n/);
      const port = Number(portText);
      if (Number.isSafeInteger(port) && port > 0) return port;
    } catch {
      // Chrome creates the file after its profile and debugger are ready.
    }
    await sleep(50);
  }
  throw new Error("Chrome did not publish DevToolsActivePort within 15 seconds");
}

async function waitForPageWebSocket(port: number): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json() as Array<{
          type?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Debug endpoint may be listening before the page target is registered.
    }
    await sleep(50);
  }
  throw new Error("Chrome page target did not appear within 10 seconds");
}

function staticServer() {
  const mimeTypes: Record<string, string> = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const requested = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = normalize(join(packageRoot, requested));
      const withinPackage = relative(packageRoot, filePath);
      if (isAbsolute(withinPackage) || withinPackage.startsWith("..")) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    }
  });
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const response = await client.send<{
    exceptionDetails?: { text?: string; exception?: { description?: string } };
    result?: { value?: unknown };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed");
  }
  return response.result?.value as T;
}

async function waitForApp(client: CdpClient, expectedRecordCount?: number): Promise<{
  recordCount: number;
  belongingCount: number;
  persistedLedgerCharacters: number;
}> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await evaluate<{
      ready: boolean;
      recordCount: number;
      belongingCount: number;
      persistedLedgerCharacters: number;
    }>(client, `(() => ({
      ready: Boolean(window.nestory?.version) && document.readyState === "complete",
      recordCount: window.nestory?.store?.recordCount ?? -1,
      belongingCount: window.nestory?.store?.state?.belongings?.size ?? -1,
      persistedLedgerCharacters: localStorage.getItem("nestory-v2")?.length ?? 0
    }))()`).catch(() => ({ ready: false, recordCount: -1, belongingCount: -1, persistedLedgerCharacters: 0 }));
    if (state.ready && (expectedRecordCount === undefined || state.recordCount === expectedRecordCount)) {
      return {
        recordCount: state.recordCount,
        belongingCount: state.belongingCount,
        persistedLedgerCharacters: state.persistedLedgerCharacters
      };
    }
    await sleep(20);
  }
  throw new Error(`App did not become ready${expectedRecordCount === undefined ? "" : ` with ${expectedRecordCount} records`}`);
}

async function cacheBypassedReloadMetric(
  client: CdpClient,
  expectedRecordCount: number,
  sampleCount: number
): Promise<{ firstContentfulPaint: Distribution; readyControllerObserved: Distribution }> {
  const readySamples: number[] = [];
  const firstContentfulPaintSamples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    await client.send("Network.clearBrowserCache");
    const loaded = client.waitForEvent("Page.loadEventFired");
    const started = performance.now();
    await client.send("Page.reload", { ignoreCache: true });
    await loaded;
    await waitForApp(client, expectedRecordCount);
    readySamples.push(performance.now() - started);
    const firstContentfulPaint = await evaluate<number>(client, `new Promise((resolve, reject) => {
      const finish = (entry) => {
        if (entry?.name === "first-contentful-paint" && Number.isFinite(entry.startTime)) {
          observer?.disconnect();
          clearTimeout(timer);
          resolve(entry.startTime);
          return true;
        }
        return false;
      };
      const existing = performance.getEntriesByName("first-contentful-paint", "paint")[0];
      if (existing) { resolve(existing.startTime); return; }
      let observer;
      const timer = setTimeout(() => {
        observer?.disconnect();
        reject(new Error("first-contentful-paint entry did not appear"));
      }, 3000);
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (finish(entry)) return;
      });
      observer.observe({ type: "paint", buffered: true });
    })`);
    firstContentfulPaintSamples.push(firstContentfulPaint);
  }
  return {
    firstContentfulPaint: distribution(firstContentfulPaintSamples),
    readyControllerObserved: distribution(readySamples)
  };
}

function clickAndForceLayoutExpression(view: string): string {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(`[data-testid="nav-${view}"]`)});
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing navigation button for ${view}");
    const started = performance.now();
    button.click();
    const section = document.querySelector(${JSON.stringify(`[data-testid="view-${view}"]`)});
    if (!(section instanceof HTMLElement)) throw new Error("Navigation did not render ${view}");
    const rect = section.getBoundingClientRect();
    void document.documentElement.offsetHeight;
    return { milliseconds: performance.now() - started, width: rect.width, height: rect.height };
  })()`;
}

async function domLayoutMetric(
  client: CdpClient,
  views: readonly [string, string],
  sampleCount: number
): Promise<Distribution> {
  const samples: number[] = [];
  for (let index = 0; index < sampleCount + 6; index += 1) {
    const result = await evaluate<{ milliseconds: number; width: number; height: number }>(
      client,
      clickAndForceLayoutExpression(views[index % views.length] ?? views[0])
    );
    if (result.width <= 0 || result.height <= 0) throw new Error("Rendered view has no layout box");
    if (index >= 6) samples.push(result.milliseconds);
  }
  return distribution(samples);
}

async function rawRafMetric(client: CdpClient, sampleCount: number): Promise<Distribution> {
  const samples = await evaluate<number[]>(client, `new Promise((resolve) => {
    const samples = [];
    let remainingWarmups = 3;
    const step = () => {
      const started = performance.now();
      requestAnimationFrame(() => {
        const elapsed = performance.now() - started;
        if (remainingWarmups > 0) remainingWarmups -= 1;
        else samples.push(elapsed);
        if (samples.length >= ${sampleCount}) resolve(samples);
        else step();
      });
    };
    step();
  })`);
  return distribution(samples);
}

async function compositorSurfaceMetric(
  client: CdpClient,
  views: readonly [string, string],
  sampleCount: number
): Promise<{ latency: GatedDistribution; pngBytes: Distribution }> {
  const samples: number[] = [];
  const pngBytes: number[] = [];
  for (let index = 0; index < sampleCount + 4; index += 1) {
    const view = views[index % views.length] ?? views[0];
    const started = performance.now();
    await evaluate(client, clickAndForceLayoutExpression(view));
    const screenshot = await client.send<{ data?: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    const elapsed = performance.now() - started;
    const data = screenshot.data ?? "";
    if (data.length === 0) throw new Error("Chrome returned an empty compositor screenshot");
    if (index >= 4) {
      samples.push(elapsed);
      const paddingBytes = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
      pngBytes.push(data.length * 3 / 4 - paddingBytes);
    }
  }
  return {
    latency: gatedDistribution(samples, surfaceBudgetMs),
    pngBytes: distribution(pngBytes)
  };
}

async function measureFixture(
  client: CdpClient,
  expectedRecordCount: number,
  views: readonly [string, string]
): Promise<BrowserFixtureReport> {
  const fixture = await waitForApp(client, expectedRecordCount);
  const reload = await cacheBypassedReloadMetric(client, expectedRecordCount, 10);
  const domLayout = await domLayoutMetric(client, views, 48);
  const rawRaf = await rawRafMetric(client, 16);
  const surface = await compositorSurfaceMetric(client, views, 24);
  return {
    fixture,
    cacheBypassedReloadFirstContentfulPaintMs: reload.firstContentfulPaint,
    cacheBypassedReloadReadyControllerObservedMs: reload.readyControllerObserved,
    interactionDomLayoutCriticalPathMs: domLayout,
    rawHeadlessRafCallbackLatencyMs: rawRaf,
    interactionToCapturedCompositorSurfaceUpperBoundMs: surface.latency,
    capturedPngBytes: surface.pngBytes
  };
}

function number(value: number): string {
  return value.toFixed(3);
}

function markdownReport(report: {
  generatedAt: string;
  runtime: string;
  chrome: Record<string, unknown>;
  viewport: typeof viewport;
  chromeFlags: readonly string[];
  seed: BrowserFixtureReport;
  household: BrowserFixtureReport;
  allSurfaceBudgetsPass: boolean;
}): string {
  const rows: string[] = [];
  const add = (fixture: string, name: string, value: Distribution, budget?: number, pass?: boolean): void => {
    rows.push(`| ${fixture} | ${name} | ${number(value.p50)} | ${number(value.p95)} | ${number(value.p99)} | ${number(value.max)} | ${budget === undefined ? "diagnostic" : `< ${budget}`} | ${pass === undefined ? "not gated" : pass ? "pass" : "fail"} |`);
  };
  for (const [fixture, values] of [["seed", report.seed], ["persisted household", report.household]] as const) {
    add(fixture, "cache-bypassed reload → first contentful paint", values.cacheBypassedReloadFirstContentfulPaintMs);
    add(fixture, "cache-bypassed reload → app ready (controller-observed)", values.cacheBypassedReloadReadyControllerObservedMs);
    add(fixture, "interaction → DOM + forced layout critical path", values.interactionDomLayoutCriticalPathMs);
    add(fixture, "raw headless rAF callback latency", values.rawHeadlessRafCallbackLatencyMs);
    const surface = values.interactionToCapturedCompositorSurfaceUpperBoundMs;
    add(fixture, "interaction → captured compositor surface upper bound", surface, surface.budgetMs, surface.pass);
  }
  return [
    "# Nestory browser performance report",
    "",
    `Generated: ${report.generatedAt}`,
    `Result: ${report.allSurfaceBudgetsPass ? "surface budget passed" : "surface budget failed"}`,
    `Runtime: ${report.runtime}`,
    `Chrome: ${String(report.chrome["product"] ?? "unknown")} · protocol ${String(report.chrome["protocolVersion"] ?? "unknown")}`,
    `Viewport: ${report.viewport.width} × ${report.viewport.height} @ ${report.viewport.deviceScaleFactor}x`,
    `Seed fixture: ${report.seed.fixture.recordCount} records / ${report.seed.fixture.belongingCount} belongings`,
    `Persisted household fixture: ${report.household.fixture.recordCount} records / ${report.household.fixture.belongingCount} belongings / ${report.household.fixture.persistedLedgerCharacters} localStorage characters`,
    "",
    "## Measurements",
    "",
    "| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget | result |",
    "|---|---|---:|---:|---:|---:|---:|---|",
    ...rows,
    "",
    "The only <100 ms pass/fail decision is the controller-observed interaction-to-captured-surface metric. It starts before CDP asks a real navigation button to click and ends only after `Page.captureScreenshot({fromSurface:true})` returns. The value therefore includes two CDP command roundtrips, DOM work, style/layout, compositor-surface readback, PNG encoding, Base64 transfer, and controller overhead. It is intentionally a conservative upper bound for this headless setup, not a claim about physical-display presentation time.",
    "",
    "The DOM/layout metric runs in the renderer with `performance.now()`, clicks the public navigation control, and forces layout by reading geometry. It explicitly excludes paint and is not used as a next-paint proxy. Raw rAF callback latency is reported only as a headless scheduler diagnostic. Cache-bypassed FCP is Chrome's `PerformancePaintTiming` entry relative to navigation start; app-ready starts before `Page.reload({ignoreCache:true})` and ends when the controller observes a ready Nestory store with the expected record count.",
    "",
    "## Limits",
    "",
    "- `captureScreenshot` proves that Chrome returned pixels from its compositor surface; neither it nor the FCP entry can prove scan-out to a physical monitor.",
    "- PNG readback/encoding and CDP transport make the surface metric conservative, but controller scheduling means it is not a mathematical bound under arbitrary machine contention.",
    "- Reload samples bypass Chrome's HTTP cache but reuse one Chrome process, OS file cache, renderer code cache, and one local static server. They are not cold machine or cold browser-start measurements.",
    "- The household is loaded through the public `window.nestory.store.importJson` seam, persisted to the app's normal localStorage key, then verified after reload before measurement.",
    "- Headless Chrome runs with its default frame scheduler. No frame-rate, begin-frame, background-timer, or display-frequency override is enabled.",
    `- Chrome flags: ${report.chromeFlags.map((flag) => `\`${flag}\``).join(", ")}.`,
    ""
  ].join("\n");
}

if (!existsSync(chromePath)) {
  throw new Error(`Chrome not found at ${chromePath}; set NESTORY_CHROME_PATH to an installed Chrome binary`);
}

const householdRecords = buildHouseholdRecords(SCALE_NOW, HOUSEHOLD_ITEM_COUNT);
const householdDump = JSON.stringify({
  version: 2,
  exportedAt: new Date(SCALE_NOW).toISOString(),
  records: householdRecords,
  baselineRecords: buildSeedRecords(SCALE_NOW)
});
const seedRecordCount = buildSeedRecords(SCALE_NOW).length;
const userDataDirectory = await mkdtemp(join(tmpdir(), "nestory-browser-benchmark-"));
const server = staticServer();
let client: CdpClient | null = null;
let chrome: ReturnType<typeof spawn> | null = null;

try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  chrome = spawn(chromePath, [...chromeFlags, `--user-data-dir=${userDataDirectory}`, "about:blank"], {
    stdio: "ignore"
  });
  const debuggerPort = await waitForDevToolsPort(userDataDirectory);
  client = await connectCdp(await waitForPageWebSocket(debuggerPort));
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.bringToFront");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await client.send("Emulation.setDeviceMetricsOverride", viewport);

  const initialLoad = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await initialLoad;
  await waitForApp(client);

  const demoLoad = client.waitForEvent("Page.loadEventFired");
  await evaluate(client, `(() => {
    const button = document.querySelector('[data-testid="btn-mode-demo"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Demo mode button is unavailable");
    button.click();
  })()`);
  await demoLoad;
  await waitForApp(client, seedRecordCount);

  const chromeVersion = await client.send("Browser.getVersion");
  const seed = await measureFixture(client, seedRecordCount, ["belongings", "ask"]);

  await evaluate(client, `window.nestory.store.importJson(JSON.parse(${JSON.stringify(householdDump)}))`);
  await waitForApp(client, householdRecords.length);
  const persistedCharacters = await evaluate<number>(client, `localStorage.getItem("nestory-v2")?.length ?? 0`);
  if (persistedCharacters === 0) throw new Error("Household fixture was not persisted to localStorage");

  const persistenceLoad = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.reload", { ignoreCache: true });
  await persistenceLoad;
  await waitForApp(client, householdRecords.length);
  const household = await measureFixture(client, householdRecords.length, ["ledger", "belongings"]);

  const report = {
    generatedAt: new Date().toISOString(),
    methodologyVersion: 1,
    runtime: `node ${process.version}`,
    chrome: chromeVersion,
    viewport,
    chromeFlags,
    measurementPolicy: {
      onlyGatedMetric: "interactionToCapturedCompositorSurfaceUpperBoundMs.p95",
      surfaceBudgetMs,
      surfaceDefinition: "Controller wall time from sending a native navigation-button click through Runtime.evaluate until Page.captureScreenshot(fromSurface) returns PNG pixels, including CDP roundtrips, DOM/style/layout/compositing, readback, encoding, Base64 transfer, and controller overhead.",
      domLayoutDefinition: "Renderer performance.now time for a native navigation-button click plus a forced geometry/layout read; excludes paint and presentation.",
      rafDefinition: "Renderer performance.now latency from requestAnimationFrame registration to its callback; scheduler diagnostic only.",
      firstContentfulPaintDefinition: "Chrome PerformancePaintTiming first-contentful-paint startTime relative to navigation start after cache bypass; browser paint signal, not physical-display scan-out.",
      reloadDefinition: "Controller wall time from Page.reload(ignoreCache) through Page.loadEventFired and observing the expected ready Store record count after Network.clearBrowserCache.",
      physicalDisplayPresentationClaim: false
    },
    sampleCounts: { reload: 10, domLayout: 48, rawRaf: 16, compositorSurface: 24 },
    fixtureSource: {
      seedFactoryRecordCount: seedRecordCount,
      householdItemCount: HOUSEHOLD_ITEM_COUNT,
      householdRecordCount: householdRecords.length,
      catalogBelongingCount: catalog.belongings.length
    },
    seed,
    household,
    allSurfaceBudgetsPass:
      seed.interactionToCapturedCompositorSurfaceUpperBoundMs.pass
      && household.interactionToCapturedCompositorSurfaceUpperBoundMs.pass
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "browser-performance-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(outputDirectory, "browser-performance-report.md"), markdownReport(report));
  console.log(JSON.stringify(report, null, 2));
  if (!report.allSurfaceBudgetsPass) process.exitCode = 1;
} finally {
  try { client?.close(); } catch { /* nothing to close */ }
  if (chrome) {
    const exited = chrome.exitCode === null
      ? new Promise<void>((resolve) => chrome?.once("exit", () => resolve()))
      : Promise.resolve();
    chrome.kill();
    await Promise.race([exited, sleep(3_000)]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(userDataDirectory, { recursive: true, force: true });
}
