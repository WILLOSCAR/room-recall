# 01 — Choose The Durable Product Promise

Type: grilling
Status: resolved
Claimed by: Codex
Claimed on: 2026-07-21
Resolved on: 2026-08-18
Blocked by: None

## Question

Which single user segment has the clearest recurring or high-stakes Home Memory job, what outcome do they value enough to change behavior for, and is moving/unpacking the durable core product, the acquisition event, or one Operation inside a broader system?

Resolve the primary user segment before assuming a payer. Then resolve the painful trigger, promised outcome, repeat-use or high-value moment, existing workaround, why structured Home Memory is meaningfully better, who benefits and who might pay, and the first evidence that would disprove the promise. Keep the accepted V1 moving/unpacking + Intent Kits wedge intact while deciding the V1.x direction.

## Working Notes

### Confirmed: first target segment

Urban renters who are moving within the next three months or have just moved, live in a small home, and have enough boxes, bags, and activity gear that location memory becomes unreliable.

This segment has an acute reason to capture Home Memory, a bounded event in which to test activation, and a credible path from moving into recurring kits and container memory.

### Needs hypotheses to validate

- Before packing: decide what matters, group belongings into boxes, and record contents without creating a full inventory.
- While packing: capture a box or bag in seconds using photo, voice, or text; mark essentials, fragile belongings, destination Room, and uncertainty.
- In transit or just after arrival: find a high-priority Belonging without opening many boxes and know which box is missing or still in transit.
- During unpacking: get a first-night and first-week unpacking order, route each box to the right Room, and restore useful Default Homes.
- After settling: keep only valuable, easy-to-forget, or Operation-related memory fresh through small corrections rather than repeated whole-home scans.
- Across every stage: trust uncertainty, undo wrong proposals, protect Sensitive Evidence, and avoid maintenance that costs more than the memory saves.

Perfect 3D reconstruction, tracking every cheap Item, and operating an interior-design tool are not assumed needs.

### New hypothesis: long-term Ownership Recall

The moving wedge may be an acquisition and activation event rather than the durable product promise. After a user has lived in one home for a long time, belongings become invisible inside deep drawers, cabinets, boxes, and rarely visited storage. The user may remember neither the Current Place nor that the Belonging exists.

This creates three related jobs:

1. **Location recall** — "I know I own this; where is it?"
2. **Ownership recall** — "Do I already own something in this category?"
3. **Pre-purchase recall** — "Before I buy this, do I already have the same thing or a usable substitute?"

The consumption failure is not simply overspending. It is purchasing under incomplete household memory: low visibility makes dormant inventory feel absent, causing duplicate purchases, unused substitutes, clutter, and later disposal.

Potential recurring outcomes:

- answer category-level questions such as "Do I have spare batteries, tape, an adapter, or a repair tool?"
- surface substitutes when the exact requested Item is absent;
- show quantity, condition, expiry or freshness only for categories where those facts affect the decision;
- rediscover dormant belongings during seasonal reset or decluttering;
- reduce duplicate purchases without requiring a manually maintained exhaustive inventory.

Ownership Recall and pre-purchase recall are confirmed as the first long-term retention loop after the moving wedge. Their main risk remains behavioral: the value disappears if capture and correction cost more than occasional duplicate purchases.

### New hypothesis: Declutter Review

Home Memory can support letting go by making dormant inventory visible. The product can surface duplicate, long-hidden, low-use, expired, broken, or space-expensive belongings and place them into a user-controlled review flow.

The goal is not to maximize the number of discarded Items. It is to help the user reclaim useful space and make a deliberate decision:

- keep in the current Place;
- move to a more appropriate Default Home;
- use up or rotate into active use;
- sell or donate;
- recycle or discard;
- defer because evidence is insufficient or the Item has emotional value.

Moving, seasonal reset, an overloaded Container, a duplicate purchase, and a failed retrieval are natural triggers for a Declutter Review. Each resolved decision also improves the Place Graph, creating a recurring maintenance loop:

`remember -> find -> use or avoid buying -> review -> release or re-home -> remember better`

This should remain decision support rather than moral pressure. The system must expose why an Item was surfaced, avoid inferring low value from weak usage evidence, and never auto-dispose or shame the user.

Confirmed hierarchy: treat decluttering as a secondary recurring Operation built on Home Memory, not as the first acquisition promise or the first retention loop.

### Confirmed product hierarchy

- Moving and forgotten-item recovery are the first high-motivation entry points.
- Remember and Retrieve are the foundation; Ownership Recall and pre-purchase recall are the confirmed first long-term retention loop.
- Intent Kits and Declutter Review are secondary Operations built on trusted Home Memory.
- Home Capability remains the longer-term expansion of Intent Kits, not a separate product promise.
- The shared product vision is drafted in `docs/nestory-product-vision.zh-CN.md`; it remains directional until payer, willingness, and falsification evidence are resolved.

## Answer

Resolved 2026-08-18. The working notes had already converged; this records the decision the question demands.

**Segment (confirmed):** urban renters moving within ~3 months or just moved, small home, enough boxes/bags/activity gear that location memory is unreliable. Not reopened.

**Is moving the durable core, the acquisition event, or one Operation?**
→ **Moving/unpacking is the acquisition & activation event, NOT the durable product promise.** It is the high-motivation on-ramp where the first trusted Home Memory is cheap to build (packing is already a natural Capture); it is not what keeps a user for a year.

**The durable promise (what earns retention):** **Ownership Recall + pre-purchase recall** — "do I already own this / a usable substitute, where is it, is it still good?" — sitting on the Remember+Retrieve foundation. This is the confirmed first long-term retention loop; moving feeds it its first data. Intent Kits and Declutter Review are secondary Operations on top, not the promise.

**Outcome the user changes behavior for:** a **trusted recall outcome** — finding a stored belonging without opening many boxes, and (post-move) checking the home before buying and avoiding a duplicate / choosing a substitute. The North Star is **Monthly Trusted Recall Outcomes** per active home, not item count (vision §14).

**Who benefits / who might pay:** the individual renter/owner is the beneficiary and the likely first payer, willing to pay for *saved money + reclaimed space + less "I know I have one somewhere"*, once the loop is proven. Payment model is deliberately left to a later fog item — identifying the beneficiary and valued outcome is enough for this decision.

**Why structured Home Memory beats the workarounds** (box labels, camera roll, notes, spreadsheets): those store fragments and rot; a Place Graph understands containment, state, freshness, and confidence, and stays trustworthy through life change because every real action (find / not-there / re-home / release) corrects it as a side effect — no periodic inventory labor.

**First evidence that would DISPROVE the promise (falsification):**
1. Moving users do NOT return after ~3 months for any Ownership/pre-purchase recall (the acquisition event acquires nobody durable).
2. Capture/correction cost exceeds the cost of occasional duplicate purchases (maintenance > value — the core behavioral risk named in the notes).
3. Users cannot reach a first useful, trusted answer within five minutes (activation fails — hands off to ticket 02).

**Boundaries kept intact:** V1 moving/unpacking + Intent Kits wedge unchanged (ADR-0001). Room Scan / 2D / 3D stay evidence-gated (2026-07-21 correction). This decision sets *direction* for the V1.x contract; it does not publish a spec.

**Hands off to:** ticket 02 (five-minute activation path) — now unblocked — must let this segment reach a trusted recall outcome in ≤5 min; and later tickets carry the falsification metrics above into field testing (ticket 03).
