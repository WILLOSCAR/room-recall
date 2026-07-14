# Domain Docs

RoomRecall is a single-context project. These rules tell engineering skills how to consume its domain documentation.

## Before exploring

- Read root `CONTEXT.md` before product, architecture, bug, test, ticket, or prototype work.
- Read relevant ADRs under `docs/adr/` before changing product scope, the Place Graph, privacy posture, visual scanning, coordinates, or Agent behavior.
- If either source is absent, continue silently; `domain-modeling` creates or sharpens it only when a real decision requires it.

## Sources of truth

- `CONTEXT.md` is the domain-language source of truth. Use its exact terms in specs, ticket titles, tests, interfaces, and review findings.
- `docs/adr/` stores durable and hard-to-reverse decisions.
- A resolved `wayfinder` ticket owns the detail for its decision; the map only links to it.
- `.scratch/<feature>/spec.md` becomes the build contract after the relevant decision map is clear and `to-spec` publishes it as `ready-for-agent`.
- Legacy PRDs and prototype notes preserve provenance but do not silently override the current spec, glossary, or ADRs.

## Conflicts and gaps

- If a term conflicts with `CONTEXT.md`, use the canonical term or explicitly propose a `domain-modeling` update.
- If a planned change contradicts an ADR, name that ADR and explain why it may need reopening before implementation.
