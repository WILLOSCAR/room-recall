# ADR 0001: V1 wedge is moving/unpacking + kits, delivered as an operations console

Date: 2026-07-07

Status: accepted

## Context

The V40 prototype proved that 3D, 2D, scan proposals, layout planning, kit retrieval, and commit-ledger corrections can work together (247 assertions, 47/47 self-loop probes at `rr-47241ff3013b`). The open product question was which V1 surface should become real: moving/unpacking, kits/equipment, or small-space storage planning. A pure "find my object" product risks maintenance cost exceeding the pain.

## Decision

1. V1 = **moving/unpacking + kits**, shipped as a **Home Memory Operations Console** (`prototype-v2/`), with find-and-correct as the trust core. Daily finding is a side effect, not the pitch.
2. 3D, real scanning, and layout planning are **deferred**; the V40 prototype is frozen as their proof archive. They return later by importing V40's patterns (proposal-only capture, commit gates), not its code.
3. The Place Graph stays the source of truth, derived from an append-only record ledger. The durable update rule is unchanged: `Input -> Observation -> Proposal or Draft -> User Review -> Commit -> Place Graph`.

Canonical scope and acceptance criteria: `docs/nestory-v1-prd.md`.

## Consequences

- New product work happens in `prototype-v2/` against the V1 PRD; `prototype/` is not extended.
- `docs/product-requirements.md` is superseded for V1 scope but kept as the scan/3D/privacy contract archive.
- The verification gate for V1 changes is `node prototype-v2/src/verify.ts` (strict tsc gate + PRD-mapped assertions + browser smoke).
- Small-space layout planning and real reconstruction need a new ADR before re-entering scope.
