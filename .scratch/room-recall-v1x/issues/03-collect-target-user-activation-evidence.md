# 03 — Collect Target-User Activation Evidence

Type: task
Status: resolved-by-simulation
Claimed by: Claude
Claimed on: 2026-08-18
Resolved on: 2026-08-18
Blocked by: 01 (resolved); 02 (resolved)

## Question

Does the chosen five-minute path produce a trusted and memorable outcome for representative target users, with low enough setup and correction cost that they would return for the durable job?

Run the agreed prototype with at least five representative users. Record completion time, first trusted Home Memory created, retrieval or Operation outcome, correction burden, privacy surprise, stated return trigger, existing workaround, and disconfirming evidence. The answer must recommend proceed, revise, or stop. Downstream room-reconstruction work remains blocked unless the evidence shows it is necessary rather than merely impressive.

## Answer (resolved-by-simulation — NOT field evidence)

Real users were unavailable; the user authorised a simulation/desk-research **evidence proxy** instead. This does **not** satisfy the ticket as written — it is a proxy that lets the map advance one notch while flagging exactly what still needs real users. Method: 3 high-trust desk-research sweeps (belonging loss + re-purchase behavior; inventory-app retention + abandonment; activation/privacy benchmarks — the privacy sweep failed on a vendor disconnect and is a gap) + a synthetic 5-persona walkthrough of the activation prototype. Full artifact captured in this session's workflow output.

**Verdict: REVISE** — advance the Container Snapshot on-ramp to a *real field test*, but fix the protocol first; do NOT proceed to a V1.x build spec on this proxy.

### Proxy evidence — supports (all secondary/PR-commissioned, directional)
- Pain is recurring & high-frequency: ~2.5 days/yr searching (US, Pixie 2016); ~140 days/lifetime + 55–56% "lose–replace–lose again" (UK, Samsung/OnePoll 2020).
- Moving is the right capture window: 26% forget a beloved item while packing (eBay 2017); ~half of movers unpack over months.
- Activation design fits the two dominant churn levers (time-to-value + manual-entry tax): one photo + one sentence + room attacks both. Aim felt first-value ~3 min, not 5.

### Proxy evidence — challenges (disconfirming, not hidden)
- **Activation success ≠ retention.** The skeptic persona finishes the fast lane in <70s and still states no return trigger. The 5-min metric is structurally blind to this.
- The durable loop (Ownership/pre-purchase recall) is **intrinsically episodic** — the exact mechanism that caps utility-app D30 at ~4–10%. The retention engine (Ownership Recall + Declutter) is entirely untested; Snapshot is only the on-ramp.
- **Correction-cost trap = the category killer.** 44% of US adults (57% boomers) have NEVER made a home inventory. Nestory's bet that real actions correct the graph as a side effect is the single most important thing to prove and is currently unproven.
- The on-point metric ("bought a duplicate because I forgot I owned it") has **no clean high-trust statistic** — should be commissioned first-party, not borrowed.

### Five-axis read (simulated, caveated)
- **Time:** under 5 min for fluent users (~1 min); low-tech/small-screen/secondary-language tail lands ~3–4.5 min, at the bar.
- **Manual work:** ~5–6 taps floor hides typing burden (taps don't count free-text); voice capture named in ticket 01 is absent from the prototype.
- **Correction burden:** artificially low — the harness retrieval is deterministic and cannot produce its own wrong answer.
- **Privacy surprise:** Room Scan exclusion validated (personas hard-refuse raw video); but "zero surprise" on the fast lane is unearned — storage/retention ("where does my photo go, can I delete it") is never addressed.
- **Retrieved something they care about:** only the just-arrived personas get a real retrieval; the 3 packing-stage personas can't confirm recall in-session — the headline metric mis-fits the majority moving-stage.

### What STILL requires ≥5 real representative users (unchanged by this proxy)
- **Falsification #1** — do movers return ~3 months later, unprompted, for recall? (benchmarks predict *no* by default)
- **Falsification #2** — does ongoing capture+correction cost stay below the duplicate-purchases it prevents, over real weeks with un-staged retrieval failures?
- **Falsification #3** — can real users (incl. low-tech / privacy-sensitive / secondary-language) reach a first *confirmed* recall of a *genuinely forgotten* item in ≤5 min?
- Willingness to start AND repeat capture unprompted; real correction accuracy with items NOT in the photographed box; real storage/retention privacy reaction; a packing-stage variant of the metric.

### Protocol revisions required before the real field test
1. Packing-stage metric variant (capture now → verify post-arrival, or a same-session "which box is X in?" probe against just-packed boxes).
2. A genuinely un-staged forgotten item, and cases where the item is in a *different* box than photographed (so wrong answers can occur).
3. A storage/retention privacy disclosure probe on the fast lane.
4. A voice-capture option (ticket 01 named it; prototype lacks it).
5. A deliberately non-high-tech sample (low-tech, small-screen, secondary-language, privacy-sensitive), not the easy-to-recruit fluent middle.

### Consequence for the map
Because the verdict is **revise, not proceed**, the downstream room-reconstruction chain stays blocked as designed. Ticket 04 (visual reconstruction route) is **NOT** unblocked by a simulation — its precondition is *real* evidence that reconstruction is necessary, which this proxy explicitly cannot provide. The effort's honest state: the on-ramp is promising enough to field-test, the durable promise is unproven and sits on the category's dominant failure mode, and a real ≥5-user test with the revised protocol is the true next step.
