# ADR 0004: Pre-purchase recall is a distinct trusted-outcome kind

Date: 2026-08-25

Status: accepted

## Context

The durable promise (ADR-0001, wayfinder issue 01) is **Ownership Recall AND
pre-purchase recall**, and the North Star is **Monthly Trusted Recall Outcomes**,
whose economic proof is *avoided duplicate purchases*. The prototype implemented
`store.ownershipRecall(query)` as a pure READ (`do I already own X / a
substitute?`) and `recallOutcomes()` recognized two outcome kinds — `location`
(found where it lives) and `ownership` (still own it) — both tagged by the single
positive commit verb `reaffirmPlacement`.

That left a gap: the economically decisive event of the durable promise — *"I was
about to buy one, asked the home, already own one, and decided NOT to buy"* — had
no distinct committed action and no distinct outcome. The only outcome-recording
affordance on the Reuse surface was "Still own it" → an ownership *existence*
reaffirm. So an avoided purchase was either unrecorded or indistinguishable from a
routine maintenance confirmation, and `recallOutcomes()` could not separate
retrieval recalls from avoided-spend recalls. This does not require real users to
fix — it is a representability gap in the model.

## Decision

1. **A new recall-outcome kind `pre_purchase`** joins `location` and `ownership`
   in `RecallOutcomeKind`. It denotes an AVOIDED-PURCHASE recall, distinct from a
   retrieval/existence recall. This is why a distinct *commit verb alone* is
   insufficient: without a distinct kind, the read-model cannot separate the
   economically decisive event from a maintenance reaffirm.
2. **A new positive commit verb `recordPrePurchaseRecall(itemId, substituteItemId?)`**
   records the user's committed decision not to buy, tagging one
   `user_confirmation` evidence with `recall: { kind: "pre_purchase", itemId }`.
   It appends no placement ops — avoiding a buy changes nothing about where things
   live. When the avoided buy was covered by a substitute rather than an exact
   match, the substitute is recorded in the summary for honest provenance; the
   outcome is tagged to the item the user was about to buy.
3. **Trust-contract boundaries.** The system PROPOSES ("you already own one — reuse
   before buying"); the user COMMITS this verb. It records the user's own decision
   and never nudges, shames, or decides the purchase for them. A released/consumed
   item cannot back an avoided purchase (you no longer own it) and cannot be cited
   as a usable substitute — both fail closed with a `DomainInputError`.
4. **North-Star integrity.** `pre_purchase` outcomes are counted by the same
   `recallOutcomes()` window logic as the other kinds and are cleared by `reset()`
   like every other outcome, so they neither double-count a reaffirm nor survive a
   fresh-home reset. The kind is validated at the ledger edge (`RECALL_KINDS`) so a
   tampered import cannot inject an unknown kind.
5. **This does not redefine the durable promise** (which is outside this Goal's
   authority). It implements a distinction the promise already names, making the
   avoided-purchase outcome representable and measurable in-product.

## Consequences

- `recallOutcomes()` can now report *retrieval* recalls (`location`/`ownership`)
  separately from *avoided-purchase* recalls (`pre_purchase`), so the North Star
  can attribute trusted outcomes to the two halves of the durable promise.
- This is prototype/representability evidence, NOT field evidence. It proves the
  avoided-purchase outcome is now recordable and measurable; it does not prove
  users actually avoid purchases — that stays `WAITING_EXTERNAL` on the field
  test's 3-month longitudinal arm (falsification #2: capture cost vs avoided
  duplicate-purchase cost).
- Locked by 7 deterministic assertions in `verify.ts` (`pre-purchase-*`): distinct
  tagging, distinguishable-from-reaffirm, substitute path, gone-item refusal,
  export/import round-trip, and reset-clears. verify green.
- **Reachable + legible (completed 2026-08-25).** The Reuse card now shows a
  distinct "Won't buy — I have this" affordance wired to this verb (records the
  user's decision, no nudge, distinct from "Still own it"), so the outcome is
  user-producible; and `recallOutcomes()` exposes `byKind.{total,last30Days}` so
  the North Star reads as retrieval recalls vs avoided-purchase recalls, with the
  kind counts summing to the flat totals. Locked by
  `dom-reuse-pre-purchase-button-mints-distinct-outcome` and
  `recall-outcomes-bykind-splits-retrieval-vs-avoided-purchase`. verify 685.
- Still open: the Agent/Ask surface cannot yet mint a pre_purchase outcome; the
  in-product metric stays moderator/export-readable (no user-facing counter, per
  the trust contract's no-streaks/minimum-collection rule).
