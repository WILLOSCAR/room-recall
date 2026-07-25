# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

RoomRecall / Nestory is a **single-context** project.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary and product rules. Read it before product, architecture, bug, test, ticket, or prototype work.
- **`docs/adr/`** — read ADRs that touch the area you are about to work in, especially before changing product scope, the Place Graph, privacy posture, visual scanning, coordinates, or Agent behavior.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── CONTEXT.md              ← glossary and product rules
├── AGENTS.md               ← workflow contract
├── docs/
│   ├── adr/                ← durable decisions
│   │   └── 0001-v1-wedge-moving-and-kits.md
│   ├── agents/             ← this configuration
│   └── archive/            ← retired documents, provenance only
├── .scratch/               ← live issue tracker and wayfinder maps
└── prototype-v2/           ← the runnable V1 console
```

## Sources of truth

- `CONTEXT.md` is the domain-language source of truth. Use its exact terms in specs, ticket titles, tests, interfaces, and review findings.
- `docs/adr/` stores durable and hard-to-reverse decisions.
- A resolved `/wayfinder` ticket owns the detail for its decision; the map only links to it.
- `.scratch/<feature>/spec.md` becomes the build contract after the relevant decision map is clear and `/to-spec` publishes it as `ready-for-agent`.
- Documents under `docs/archive/` preserve provenance but never override the current spec, glossary, or ADRs.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (V1 wedge is moving/unpacking + kits) — but worth reopening because…_
