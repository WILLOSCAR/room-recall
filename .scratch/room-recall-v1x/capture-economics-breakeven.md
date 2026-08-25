# Capture-Economics Break-Even Model (reversible; cost side grounded, value side field-gated)

Status: `analysis` — cost side grounded in deterministic prototype step-counts;
value side is an explicitly-parameterized assumption, `WAITING_EXTERNAL` on real
cost/benefit data. Owner: this Goal session. Date: 2026-08-25.

Binds: ADR-0001 + `docs/nestory-product-framework.md` ("a pure find-my-object
product risks maintenance cost exceeding the pain"); issue 03 ("the correction-cost
trap is the category killer"); issue 01 falsification #2 (capture+correction cost
> avoided-duplicate-purchase cost ⇒ promise falsified). This turns falsification #2
from a vague "measure cost vs benefit" into a concrete numeric TARGET.

This is NOT field evidence. The cost side is a real fact about THIS prototype's
interaction design; the value side is a labelled assumption. A break-even with an
assumed value input is a falsifiable target, not proof.

---

## 1. Cost side — grounded in the prototype's deterministic step-counts

Measured from the live flows (`prototype-v2/src/app.ts`), counting discrete user
actions (a "tap" = one deliberate commit-bearing interaction; typing a field is one
action regardless of characters). These are build facts, not estimates:

- **Container Snapshot fast lane** (`snapshot-submit` → Review → `accept-proposal`):
  open container (1) + enter the sentence listing N items, typed or spoken, in ONE
  field (1) + create proposal (1) + accept in Review (1) = **4 actions to place N
  items** ⇒ **capture cost ≈ 4/N actions per item** (amortizes with box size — the
  container-first bet). Optional photo adds 1 action; not required on the fast lane.
- **Manual per-belonging** (`open-add-belonging` → `add-belonging-submit`): open
  form (1) + fill name/kind/home (1) + submit (1) = **~3 actions per SINGLE item**,
  no amortization. This is the "inventory labor" the mission explicitly rejects as
  the primary path.
- **Correction** (`answer-mark-not-there` → Review → pick place → `accept`): mark
  not-there (1) + pick corrected place (1) + accept (1) = **3 actions per
  correction**.
- **Reaffirm / pre-purchase recall** (`answer-confirm-here` / `reuse-confirm` /
  `recordPrePurchaseRecall`): **1 action** — the trusted-outcome tap itself.

Let:
- `S` = mean items per snapshot box (amortization factor),
- `C_capture(N items)` = `4 + ⌈N/S⌉·0` ... simplified: **≈ 4/S actions per item** via
  snapshot; **3 actions per item** via manual,
- `r` = correction rate (fraction of captured items later corrected),
- `C_correct` = 3 actions per corrected item,
- **Total cost per item** `≈ (4/S) + r·3` actions (snapshot path).

At S=8 (a realistic box), snapshot capture ≈ 0.5 action/item; each 10% of
correction rate adds 0.3 action/item. **Correction cost overtakes capture cost once
`r > (4/S)/3` — at S=8, once `r > ~17%`.** That is the category-killer threshold
issue 03 named, now expressed in the prototype's real units: *the model dies if
more than ~1 in 6 captured items needs a correction.*

## 2. Value side — parameterized assumption (field/market-gated)

NOT measured here — flagged `WAITING_EXTERNAL`. Parameters the field test /
longitudinal arm must supply:
- `V_recall` = value of one trusted retrieval recall (minutes saved not hunting +
  avoided re-buy of a "lost" item),
- `V_avoid` = value of one avoided duplicate purchase (the `pre_purchase` outcome
  from ADR-0004: item price not spent),
- `A_action` = user's effort cost per action (attention/seconds).

## 3. Break-even (the falsification-#2 target)

The promise holds when **value ≥ cost** over a maintenance window:
```
outcomes · (V_recall or V_avoid)  ≥  captured_items · A_action · [(4/S) + r·3]
```
Rearranged to a per-item TARGET (the pre-committed bar for the field test):
> **Each captured item must yield at least `A_action·[(4/S)+r·3] / V̄_outcome`
> trusted outcomes over its maintenance life**, where `V̄_outcome` is the blended
> recall+avoided-purchase value.

Concretely, with the grounded cost side (S=8, r=10% ⇒ ~0.8 action/item) this says:
**if one avoided duplicate purchase is worth ≳ 1 action of effort (it almost
certainly is — a re-bought charger costs far more than 4 taps), the economics clear
EASILY on the avoided-purchase side — PROVIDED the correction rate stays below
~17%.** So the binding constraint is not value magnitude; it is **correction rate**.

## 4. Product judgment produced (what changed)

1. The economic risk is **correction rate, not capture effort** — the snapshot
   fast lane already amortizes capture to ~0.5 action/item, so the category-killer
   is re-corrections, exactly as issue 03 warned. **Product priority: minimize the
   correction rate `r`, not shave capture taps.**
2. The **`pre_purchase` outcome (ADR-0004) is the value keystone** — avoided
   duplicate purchases dominate the value side (a purchase price ≫ minutes saved),
   so making that outcome first-class (Cycle 1) was economically load-bearing, not
   cosmetic.
3. **Falsification-#2 numeric target for the field test:** capture ≈ 4/S actions
   per item; **the promise is falsified if the observed correction rate exceeds
   ~1/6 (17%) at a realistic box size**, OR if avoided-purchase + recall value per
   captured item is worth less than the measured action-effort. This is now a
   pre-committed bar, fed to the field-test analysis plan.

## 5. What stays WAITING_EXTERNAL

- `V_recall`, `V_avoid`, `A_action` — real magnitudes need users/market.
- The actual correction rate `r` in real homes — the single most important unknown;
  the field test's "Not there → correct" path (protocol §4) and the longitudinal
  arm measure it. Until then, ~17% is the falsification threshold, not a finding.
