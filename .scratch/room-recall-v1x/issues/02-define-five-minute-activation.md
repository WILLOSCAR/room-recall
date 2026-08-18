# 02 — Define The Five-Minute Activation Path

Type: prototype
Status: resolved
Claimed by: Claude
Claimed on: 2026-08-18
Resolved on: 2026-08-18
Blocked by: None (01 resolved 2026-08-18)

## Question

What is the shortest first-session path that lets the chosen user experience useful Home Memory within five minutes, and where, if anywhere, should Room Scan, Container Snapshot, Product Intake, or operation-first setup enter that path?

Prototype the competing entry paths, including a Container Snapshot fast lane, at enough fidelity to compare time to first trusted memory, amount of manual work, correction burden, privacy surprise, and whether the user can immediately retrieve or prepare something they care about. Resolve the activation event and field-test metric without reopening the decided V1 wedge.

## Answer

Resolved 2026-08-18 via a runnable prototype: [`activation-prototype/`](activation-prototype/) (README has run + design notes). It is a feel-and-time harness comparing all four entry paths on the five named axes; verified end-to-end in-browser (capture → proposal → review → commit → answer → confirm → scorecard).

**Activation event chosen:** the **Container Snapshot fast lane** is the five-minute on-ramp — one photo + one sentence + a destination room → a reviewable contents proposal → commit → a trusted answer to "where is my charger?". It reaches a trusted recall outcome with the fewest taps and **no privacy surprise**, and it embodies progressive precision (record "the box → Bedroom" now, exact slot never required).

**Where each entry path belongs:**
- **Container Snapshot** → the default first-session path (fast lane). Evidence-bearing, proposal-first, lowest cost.
- **Operation-first (Start a Move)** → offered as the structured alternative for users who think in boxes; more trustworthy (labelled box = high confidence) but front-loads setup before the first answer, so it is not the ≤5-min default.
- **Product Intake** → a supporting path for a specific known item; precise, camera-free, but no discovery and no evidence photo — not an activation path on its own.
- **Room Scan** → **NOT** in the activation path. It pays a privacy tax (raw room video: faces, screens, address) and reconstructs geometry the recall question does not need yet; the item still needs manual placement afterward. Consistent with ADR-0002 and the 2026-07-21 correction — it enters only if ticket 04/05 field evidence proves it lowers total cost.

**Field-test metric (hands to ticket 03):** time from first app open to the first *confirmed* trusted recall outcome, target **≤5 min**; secondary axes = taps, pre-commit corrections, privacy surprises (target 0 on the default path), and whether the user retrieved the thing they actually cared about. The prototype's live clock + scorecard define exactly what to measure with real users.

**Boundary kept:** V1 moving/unpacking + Intent Kits wedge unchanged. This resolves the activation *event and metric*; it does not publish a V1.x build spec (still gated on ticket 03 field evidence).

**Caveat:** this is a prototype *signal*, not proof. Willingness to do even the lightweight Snapshot capture, and whether the memory still pays off at 3 months, remain for ticket 03 field evidence — the falsification conditions set in ticket 01.

## Working notes

The prototype deliberately makes the costs *felt*, not argued: the clock runs, taps count, the Room Scan path throws its privacy warning up front, and the Snapshot path forces a Review step before anything is trusted. Running two paths back-to-back makes the trade-off legible in the scorecard.
