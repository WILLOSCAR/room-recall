# 06 — Set The Sensitive Evidence Boundary

Type: grilling
Status: resolved 2026-08-24 (product decision + prototype enforcement; NOT field evidence)
Blocked by: 02 — Define The Five-Minute Activation Path; 03 — Collect Target-User Activation Evidence

## Question

What media may leave the device, what must be redacted or excluded before an Agent or reconstruction job can see it, how long may raw media persist, and what evidence summary can remain after deletion while preserving trustworthy Place Graph provenance?

Resolve defaults for faces, documents, screens, addresses, receipts, labels, and user-initiated deletion, including the visible consent and failure states.

## Answer

Resolved 2026-08-24 as a product decision (grilling / domain-modeling) with the boundary enforced in the prototype by deterministic assertions — `stripSensitiveMedia` at the `dispatch` edge in [`prototype-v2/src/agent.ts`](../../prototype-v2/src/agent.ts), locked by the "issue 06 sensitive-evidence boundary" section of [`prototype-v2/src/verify.ts`](../../prototype-v2/src/verify.ts). This is a privacy/trust *invariant*, not a hypothesis: it does not wait on field evidence, and the field-test protocol's privacy probe now references these defaults.

**Defaults:**

1. **What may leave the device — nothing image-bearing.** Only the evidence SUMMARY `{ kind, summary, at }` plus non-image metadata may cross the device line into an Agent, reconstruction job, LLM context, or export. Raw image bytes never leave. Because no bytes leave, every protected class is covered by one rule — faces, documents, screens, addresses, receipts, and labels are all protected without per-class redaction.

2. **Where the boundary is enforced — centrally, at the toolkit edge.** `createAgentToolkit(store).dispatch(...)` strips every `media` / `photo` / `dataUrl` key (deep; fails closed — a media field is dropped, never passed through) so EVERY consumer — the LLM runtime, the Ask router, the CLI, eval, any future tool — gets the summary only. `boundedProjection` (agent-runtime) is a second layer on the LLM path. The on-device UI reads the store directly and keeps the photos; only the agent-facing projection is redacted.

3. **How long raw media persists — on-device only, no server copy.** Raw photos live in the local store/ledger only. There is no cloud copy, no reconstruction-job upload, no analytics pixel. Retention is bounded by user-initiated local deletion, not by a server TTL.

4. **What survives deletion — provenance, not pixels.** When a user deletes a photo, the `{ kind, summary, at }` evidence record stays (so the Place Graph keeps its trustworthy "why did we believe this?" trail) but the media is replaced by a stub; the pixels do not survive. A deleted photo can never be re-derived from the summary.

5. **Consent — visible, on-device, before the shutter.** The capture flow shows an on-device disclosure before the first photo is taken (what stays on-device; what — only the summary — could ever be seen by an Agent), and the field-test privacy probe asks "where does this photo go?" to confirm the model is understood. No silent capture.

6. **Failure states — fail closed.** If redaction cannot be applied, the media is omitted rather than leaked; an answer degrades to its text summary, never to raw bytes. There is no fallback that passes pixels through.

**Enforcement (prototype class, not field):** the verify suite seeds a real `photo_note` evidence record (a container snapshot with a `PhotoMedia`, cited by a committed placement), proves the store genuinely holds the bytes at the read layer (non-vacuity), then asserts that EVERY agent read-tool's serialized `dispatch` result contains no `media` / `photo` / `dataUrl` key and no `data:image` bytes — while the on-device `store.locate` still returns the photo and the agent still receives the honest `photo_note` summary. Locked across 13 tool calls × 4 leak signatures, plus fixture-non-vacuity, UI-keeps-media, and agent-keeps-summary assertions.

**Honest scope / production requirement:** the byte-deletion WRITE path (default #4) is a documented production requirement, not something the local prototype implements — the append-only ledger makes true byte deletion a side-store / key-rotation refactor, and in the local prototype there is no leak vector to begin with (media never leaves the device). The boundary that CAN be violated in-scope — an Agent or export context seeing raw bytes — is the one enforced and locked here.

**Boundary kept:** this resolves the sensitive-evidence *defaults and their in-scope enforcement*. It does not implement production byte deletion, server-side retention (there is no server), or a real-user consent study; those stay outside this Goal.

**Caveat:** enforcement assertions prove the prototype holds the boundary; they do not prove real users understand or trust it. That is the field-test protocol's privacy probe (waiting-external).
