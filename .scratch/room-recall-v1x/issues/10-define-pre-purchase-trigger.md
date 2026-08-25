# 10 — Define The Pre-Purchase Recall Trigger

Type: grilling / prototype
Status: open
Blocked by: 03 — Collect Target-User Activation Evidence (which trigger works is field-gated)
Graduated from fog: 2026-08-25 (map "which real trigger makes 'ask the home before buying' a repeat behavior?")

## Question

The durable promise includes **pre-purchase recall**, and ADR-0004 made the
avoided-purchase outcome (`recordPrePurchaseRecall`) a first-class, measurable
trusted outcome. But the prototype only lets a user reach the check by proactively
opening the Reuse tab and typing a category. There is **no trigger surface** that
prompts "ask the home before you buy" at the actual buying moment. Which real,
low-friction trigger converts pre-purchase recall from a feature the user must
remember to use into a repeat behavior — and does any candidate trigger belong in
the product without becoming a nag (trust-contract §: inform, never shame/decide)?

Candidate triggers to weigh (NOT to build speculatively before field evidence):
- a share-target / "check before I buy" entry from a shopping app or browser;
- a manual "about to buy something?" quick-ask on the home screen;
- a moving/unpacking-window prompt (the activation event) that seeds the habit;
- no in-product trigger at all — the behavior is externally cued (the user thinks
  of it while shopping) and the product's job is only to answer fast when asked.

## Why this is stated now but not answered now

Which trigger produces *repeat* behavior is a real-user/behavioral question —
`WAITING_EXTERNAL`, and no prototype can substitute for it (issue 03 discipline: a
simulation is not field evidence). Graduating it from fog to a stated ticket is the
in-authority step: the question can now be stated exactly because ADR-0004 gave the
outcome a measurable representation.

## Safe, in-authority prep this unblocks (no real users needed)

- The **measurement is ready**: `recordPrePurchaseRecall` + the `pre_purchase`
  outcome + the capture-economics break-even (avoided purchase = value keystone)
  mean that when a trigger is tested, its effect on repeat pre-purchase recalls is
  already deterministically countable.
- A field-test arm can be added later: instrument each candidate trigger and
  measure the pre_purchase-outcome rate it produces, scored like the analysis plan.

## Decision rule

Do NOT ship a speculative trigger. Resolve which trigger (if any) earns a place
only with field/behavioral evidence that it produces repeat pre-purchase recalls
without nagging. Until then this ticket stays open, `WAITING_EXTERNAL` on issue 03.
