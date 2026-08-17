# Nestory browser performance report

Generated: 2026-08-17T14:18:43.913Z
Result: surface budget passed
Runtime: node v26.3.1
Chrome: Chrome/151.0.7922.138 · protocol 1.3
Viewport: 1440 × 960 @ 1x
Seed fixture: 66 records / 21 belongings
Persisted household fixture: 10066 records / 2021 belongings / 2584731 localStorage characters

## Measurements

| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget | result |
|---|---|---:|---:|---:|---:|---:|---|
| seed | cache-bypassed reload → first contentful paint | 72.000 | 172.000 | 172.000 | 172.000 | diagnostic | not gated |
| seed | cache-bypassed reload → app ready (controller-observed) | 105.155 | 168.869 | 168.869 | 168.869 | diagnostic | not gated |
| seed | interaction → DOM + forced layout critical path | 1.300 | 2.200 | 2.300 | 2.300 | diagnostic | not gated |
| seed | raw headless rAF callback latency | 8.300 | 10.400 | 10.400 | 10.400 | diagnostic | not gated |
| seed | interaction → captured compositor surface upper bound | 57.990 | 61.570 | 62.072 | 62.072 | < 100 | pass |
| persisted household | cache-bypassed reload → first contentful paint | 68.000 | 80.000 | 80.000 | 80.000 | diagnostic | not gated |
| persisted household | cache-bypassed reload → app ready (controller-observed) | 137.870 | 161.239 | 161.239 | 161.239 | diagnostic | not gated |
| persisted household | interaction → DOM + forced layout critical path | 6.200 | 8.100 | 9.300 | 9.300 | diagnostic | not gated |
| persisted household | raw headless rAF callback latency | 8.300 | 8.400 | 8.400 | 8.400 | diagnostic | not gated |
| persisted household | interaction → captured compositor surface upper bound | 56.523 | 62.755 | 64.540 | 64.540 | < 100 | pass |

The only <100 ms pass/fail decision is the controller-observed interaction-to-captured-surface metric. It starts before CDP asks a real navigation button to click and ends only after `Page.captureScreenshot({fromSurface:true})` returns. The value therefore includes two CDP command roundtrips, DOM work, style/layout, compositor-surface readback, PNG encoding, Base64 transfer, and controller overhead. It is intentionally a conservative upper bound for this headless setup, not a claim about physical-display presentation time.

The DOM/layout metric runs in the renderer with `performance.now()`, clicks the public navigation control, and forces layout by reading geometry. It explicitly excludes paint and is not used as a next-paint proxy. Raw rAF callback latency is reported only as a headless scheduler diagnostic. Cache-bypassed FCP is Chrome's `PerformancePaintTiming` entry relative to navigation start; app-ready starts before `Page.reload({ignoreCache:true})` and ends when the controller observes a ready Nestory store with the expected record count.

## Limits

- `captureScreenshot` proves that Chrome returned pixels from its compositor surface; neither it nor the FCP entry can prove scan-out to a physical monitor.
- PNG readback/encoding and CDP transport make the surface metric conservative, but controller scheduling means it is not a mathematical bound under arbitrary machine contention.
- Reload samples bypass Chrome's HTTP cache but reuse one Chrome process, OS file cache, renderer code cache, and one local static server. They are not cold machine or cold browser-start measurements.
- The household is loaded through the public `window.nestory.store.importJson` seam, persisted to the app's normal localStorage key, then verified after reload before measurement.
- Headless Chrome runs with its default frame scheduler. No frame-rate, begin-frame, background-timer, or display-frequency override is enabled.
- Chrome flags: `--headless=new`, `--no-sandbox`, `--no-first-run`, `--no-default-browser-check`, `--disable-background-networking`, `--disable-sync`, `--disable-extensions`, `--disable-dev-shm-usage`, `--hide-scrollbars`, `--remote-debugging-port=0`.
