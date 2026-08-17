import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { buildSeedRecords, catalog } from "./data.ts";
import { fileStorage, startNestoryServer } from "./server.ts";
import { buildHouseholdRecords, HOUSEHOLD_ITEM_COUNT, SCALE_NOW } from "./scale-fixture.ts";
import { createStore } from "./store.ts";
import type { AnyRecord, Store, StoreOptions } from "./types.ts";

const NOW = SCALE_NOW;
const HTTP_CONCURRENCY = 32;
const outputDir = fileURLToPath(new URL("../renders/", import.meta.url));

interface Distribution {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  samples: number;
}

interface Metric extends Distribution {
  budgetMs: number;
  pass: boolean;
}

interface HttpMeasurement extends Distribution {
  budgetMs: number | null;
  pass: boolean | null;
  throughputRps: number;
  meanResponseBytes: number;
  maxResponseBytes: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

function distribution(samples: number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    samples: sorted.length
  };
}

function metric(samples: number[], budgetMs: number): Metric {
  const result = distribution(samples);
  return { ...result, budgetMs, pass: result.p95 < budgetMs };
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

function storeFrom(records: AnyRecord[], overrides: Partial<StoreOptions> = {}): Store {
  const baselineRecords = buildSeedRecords(NOW);
  const store = createStore({ catalog, seedFactory: () => baselineRecords, now: () => NOW + 99_000, storage: null, ...overrides });
  if (records.length !== baselineRecords.length || records.some((record, index) => record.id !== baselineRecords[index]?.id)) {
    store.importJson({ version: 2, exportedAt: new Date(NOW).toISOString(), records, baselineRecords });
  }
  return store;
}

function queryMetrics(store: Store, iterations: number): { locate: Metric; attention: Metric; containers: Metric } {
  for (let index = 0; index < 50; index += 1) store.locate("scale item 1999");
  const locate: number[] = [];
  const attention: number[] = [];
  const containers: number[] = [];
  let sink = 0;
  for (let index = 0; index < iterations; index += 1) {
    const a = timed(() => store.locate(index % 2 ? "scale item 1999" : "water bottle"));
    sink += a.value.ok ? a.value.item.length : 0;
    locate.push(a.ms);
    const b = timed(() => store.attention());
    sink += b.value.pendingProposals;
    attention.push(b.ms);
    const c = timed(() => store.containersView());
    sink += c.value.length;
    containers.push(c.ms);
  }
  if (sink < 0) throw new Error("unreachable benchmark sink");
  return { locate: metric(locate, 5), attention: metric(attention, 5), containers: metric(containers, 5) };
}

function memoryWriteMetric(records: AnyRecord[], iterations: number): Metric {
  const store = storeFrom(records);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(timed(() => store.createBelonging({
      name: `Benchmark memory write ${index}`,
      defaultHome: { type: "container", id: "entry-tray" }
    })).ms);
  }
  return metric(samples, 10);
}

function coldStartMetric(records: AnyRecord[], iterations: number, budgetMs: number): Metric {
  const baselineRecords = buildSeedRecords(NOW);
  const persisted = JSON.stringify({ version: 2, records, baselineRecords });
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(timed(() => createStore({
      catalog,
      seedFactory: () => buildSeedRecords(NOW),
      now: () => NOW + 99_000,
      storage: { getItem: () => persisted, setItem: () => undefined }
    })).ms);
  }
  return metric(samples, budgetMs);
}

function exportMetrics(records: AnyRecord[], iterations: number): {
  compactText: Metric;
  transferClone: Metric;
  compactBytes: number;
  prettyBytes: number;
} {
  const store = storeFrom(records);
  const compact: number[] = [];
  const clone: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    compact.push(timed(() => store.exportJsonText()).ms);
    clone.push(timed(() => store.exportJson()).ms);
  }
  return {
    compactText: metric(compact, 10),
    transferClone: metric(clone, 25),
    compactBytes: Buffer.byteLength(store.exportJsonText()),
    prettyBytes: Buffer.byteLength(store.exportJsonText({ pretty: true }))
  };
}

async function fileWriteMetric(records: AnyRecord[], iterations: number, directory: string): Promise<Metric> {
  const path = join(directory, "home-memory.json");
  const store = storeFrom(records, { storage: fileStorage(path) });
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(timed(() => store.createBelonging({
      name: `Benchmark file write ${index}`,
      defaultHome: { type: "container", id: "entry-tray" }
    })).ms);
  }
  return metric(samples, 25);
}

async function httpMetric(
  records: AnyRecord[],
  queries: readonly string[],
  options: { warmupQueries?: readonly string[]; budgetMs?: number; route?: "locate" | "search-bounded" | "search-full" } = {}
): Promise<HttpMeasurement> {
  const server = await startNestoryServer({ store: storeFrom(records), port: 0 });
  const requestUrl = (query: string): string => options.route === "search-bounded"
    ? `${server.url}/search?q=${encodeURIComponent(query)}&limit=100`
    : options.route === "search-full"
      ? `${server.url}/search?q=${encodeURIComponent(query)}`
    : `${server.url}/locate?q=${encodeURIComponent(query)}`;
  try {
    for (const query of options.warmupQueries ?? []) {
      const response = await fetch(requestUrl(query));
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`HTTP benchmark warmup received ${response.status}`);
    }
    const samples: number[] = [];
    const responseBytes: number[] = [];
    const started = performance.now();
    for (let offset = 0; offset < queries.length; offset += HTTP_CONCURRENCY) {
      await Promise.all(Array.from({ length: Math.min(HTTP_CONCURRENCY, queries.length - offset) }, async (_, batchIndex) => {
        const query = queries[offset + batchIndex] ?? "";
        const requestStarted = performance.now();
        const response = await fetch(requestUrl(query));
        const payload = await response.arrayBuffer();
        if (!response.ok) throw new Error(`HTTP benchmark received ${response.status}`);
        responseBytes.push(payload.byteLength);
        samples.push(performance.now() - requestStarted);
      }));
    }
    const elapsed = performance.now() - started;
    const measured = distribution(samples);
    const budgetMs = options.budgetMs ?? null;
    return {
      ...measured,
      budgetMs,
      pass: budgetMs === null ? null : measured.p95 < budgetMs,
      throughputRps: queries.length / (elapsed / 1_000),
      meanResponseBytes: responseBytes.reduce((sum, value) => sum + value, 0) / Math.max(1, responseBytes.length),
      maxResponseBytes: Math.max(0, ...responseBytes)
    };
  } finally {
    await server.close();
  }
}

const scaledRecords = buildHouseholdRecords();
const seedRecords = buildSeedRecords(NOW);
const tempDirectory = await mkdtemp(join(tmpdir(), "nestory-benchmark-"));
const httpRequestCount = 320;
const repeatedHttpQueries = Array.from(
  { length: httpRequestCount },
  (_, index) => index % 2 ? "scale item 1999" : "water bottle"
);
const distinctHttpQueries = Array.from(
  { length: httpRequestCount },
  (_, index) => `scale item ${String(index).padStart(4, "0")}`
);
const fullSearchCompatibilityQueries = Array.from({ length: 64 }, () => "shared term");

try {
  const report = {
    generatedAt: new Date().toISOString(),
    runtime: `node ${process.version}`,
    fixture: {
      seedRecords: seedRecords.length,
      householdRecords: scaledRecords.length,
      householdBelongings: catalog.belongings.length + HOUSEHOLD_ITEM_COUNT
    },
    httpMethodology: {
      concurrency: HTTP_CONCURRENCY,
      samplesPerWorkload: httpRequestCount,
      warmRepeated: "two keys explicitly prewarmed before measurement",
      distinct: "320 unique exact fixture names; query cache cold; lazy search-index construction included",
      boundedSearch: "320 unique exact fixture names; legacy partial-token semantics make each a broad match set; opt-in /search?limit=100 returns 100 summaries",
      fullSearchResidual: "64 broad repeated /search?q=shared%20term requests preserve the original full bare-array compatibility response"
    },
    durability: "same-directory atomic rename acknowledged by the OS page cache; no fsync claim",
    budgetsAreCiGates: false,
    seed: {
      query: queryMetrics(storeFrom(seedRecords), 250),
      memoryWrite: memoryWriteMetric(seedRecords, 250),
      coldStart: coldStartMetric(seedRecords, 40, 25),
      export: exportMetrics(seedRecords, 80)
    },
    household: {
      query: queryMetrics(storeFrom(scaledRecords), 250),
      memoryWrite: memoryWriteMetric(scaledRecords, 160),
      coldStart: coldStartMetric(scaledRecords, 16, 100),
      export: exportMetrics(scaledRecords, 30),
      fileWrite: await fileWriteMetric(scaledRecords, 60, tempDirectory),
      httpWarmRepeatedAt32: await httpMetric(scaledRecords, repeatedHttpQueries, {
        warmupQueries: ["water bottle", "scale item 1999"],
        budgetMs: 50
      }),
      httpDistinctAt32: await httpMetric(scaledRecords, distinctHttpQueries, { budgetMs: 50 }),
      httpBoundedSearchAt32: await httpMetric(scaledRecords, distinctHttpQueries, { budgetMs: 50, route: "search-bounded" }),
      httpFullSearchCompatibilityAt32: await httpMetric(scaledRecords, fullSearchCompatibilityQueries, { route: "search-full" })
    }
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "performance-report.json"), JSON.stringify(report, null, 2));
  const number = (value: number): string => value.toFixed(3);
  const rows: string[] = [];
  const add = (scope: string, name: string, value: Distribution & { budgetMs: number | null; pass: boolean | null }): void => {
    const budget = value.budgetMs === null ? "not budgeted" : `< ${value.budgetMs}`;
    const result = value.pass === null ? "compatibility residual" : value.pass ? "pass" : "fail";
    rows.push(`| ${scope} | ${name} | ${number(value.p50)} | ${number(value.p95)} | ${number(value.p99)} | ${number(value.max)} | ${budget} | ${result} |`);
  };
  add("seed", "locate", report.seed.query.locate);
  add("seed", "attention", report.seed.query.attention);
  add("seed", "containers", report.seed.query.containers);
  add("seed", "memory write", report.seed.memoryWrite);
  add("seed", "cold Store start", report.seed.coldStart);
  add("seed", "compact export text", report.seed.export.compactText);
  add("seed", "export transfer clone", report.seed.export.transferClone);
  add("household", "locate", report.household.query.locate);
  add("household", "attention", report.household.query.attention);
  add("household", "containers", report.household.query.containers);
  add("household", "memory write", report.household.memoryWrite);
  add("household", "cold Store start", report.household.coldStart);
  add("household", "compact export text", report.household.export.compactText);
  add("household", "export transfer clone", report.household.export.transferClone);
  add("household", "atomic file write", report.household.fileWrite);
  add("household", "HTTP locate warm repeated @32", report.household.httpWarmRepeatedAt32);
  add("household", "HTTP locate 320 distinct @32", report.household.httpDistinctAt32);
  add("household", "HTTP bounded search 320 distinct @32", report.household.httpBoundedSearchAt32);
  add("household", "HTTP full search compatibility residual @32", report.household.httpFullSearchCompatibilityAt32);
  const markdown = [
    "# Nestory performance report",
    "",
    `Generated: ${report.generatedAt}`,
    `Runtime: ${report.runtime}`,
    `Fixture: ${report.fixture.householdRecords} records / ${report.fixture.householdBelongings} belongings`,
    `Durability: ${report.durability}`,
    `HTTP workloads: ${report.httpMethodology.warmRepeated}; ${report.httpMethodology.distinct}; ${report.httpMethodology.boundedSearch}; ${report.httpMethodology.fullSearchResidual}.`,
    "",
    "Performance budgets are reported locally and are not deterministic correctness gates.",
    "",
    "| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget ms | result |",
    "|---|---|---:|---:|---:|---:|---:|---|",
    ...rows,
    "",
    `HTTP warm-repeated throughput: ${number(report.household.httpWarmRepeatedAt32.throughputRps)} requests/s`,
    `HTTP 320-distinct throughput: ${number(report.household.httpDistinctAt32.throughputRps)} requests/s`,
    `HTTP bounded-search throughput: ${number(report.household.httpBoundedSearchAt32.throughputRps)} requests/s`,
    `HTTP response bytes (mean / max): bounded search ${number(report.household.httpBoundedSearchAt32.meanResponseBytes)} / ${report.household.httpBoundedSearchAt32.maxResponseBytes}; full compatibility search ${number(report.household.httpFullSearchCompatibilityAt32.meanResponseBytes)} / ${report.household.httpFullSearchCompatibilityAt32.maxResponseBytes}.`,
    `HTTP full-search compatibility throughput: ${number(report.household.httpFullSearchCompatibilityAt32.throughputRps)} requests/s`,
    "Compatibility note: GET /search without limit still returns the original full bare array and may exceed the 50 ms budget for broad household queries.",
    `Household export bytes: compact ${report.household.export.compactBytes} / pretty ${report.household.export.prettyBytes}`,
    ""
  ].join("\n");
  await writeFile(join(outputDir, "performance-report.md"), markdown);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
