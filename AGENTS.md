# AGENTS.md

## Agent skills

### Issue tracker

Work is tracked as local markdown under `.scratch/`; there is no GitHub or GitLab remote for this idea yet. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five Matt workflow labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project. Read `CONTEXT.md` first, then ADRs in `docs/adr/` when product direction, data model, or architecture matters. See `docs/agents/domain.md`.

## Development workflow

Aligned to the current `mattpocock/skills` flow (`ask-matt` is the router over every skill; consult it when unsure which fits).

### Main flow: idea → ship

```text
grill-with-docs -> (handoff -> prototype -> handoff, if a question needs a runnable answer)
                -> multi-session? -> yes: to-spec -> to-tickets -> implement (per ticket)
                                     no:  implement (here)
                -> implement drives tdd, closes with code-review -> commit
```

- **Start with `grill-with-docs`** for a bounded idea in this codebase, so settled language and durable decisions land in `CONTEXT.md` and `docs/adr/`.
- Detour through **`handoff -> prototype -> handoff`** when a state, interaction, 2D/3D view, or capture flow needs a runnable answer before it can be specified. A prototype is throwaway code kept as a primary source, not promoted straight into `prototype-v2/`.
- **Branch on size.** Multi-session build → **`to-spec`** publishes `.scratch/<feature>/spec.md`, then **`to-tickets`** creates one tracer-bullet file per implementation ticket with explicit blocking edges; work them blockers-first, **starting each `implement` in a fresh context**. Single-session → `implement` right here.
- Every `implement` ticket drives **`tdd`** (one red-green slice at a time) and closes by running **`code-review`** (two-axis: Standards + Spec) against a fixed Git baseline before committing. Reach for `tdd` or `code-review` on their own when you just want one behaviour test-first, or to review a branch/PR.
- **Context hygiene:** keep grill → to-spec → to-tickets in one unbroken context window (they build on the same thinking); each `implement` then starts fresh. Compact at a phase boundary if the session approaches the model's smart zone before `to-tickets`.

### On-ramps (a starting situation that generates work, then merges onto the main flow)

- **`wayfinder`** — a huge, foggy effort spanning more than one focused session. It charts a shared map of **decision tickets** (`.scratch/<effort>/map.md`) and resolves them one at a time, producing **decisions, not deliverables**, until the fog clears — then hands off to `to-spec`. Save it for exactly that; never a well-scoped feature.
- **`triage`** — only for raw incoming bugs or requests you did not create. Tickets produced by `to-tickets` are already `ready-for-agent`; don't triage them.
- **`diagnosing-bugs`** — the hard bug, the flake, the regression. It refuses to theorise until it has a tight feedback loop that already goes red on this bug, then fixes with a regression test.

### Codebase health and vocabulary

- **`improve-codebase-architecture`** — spare-moment survey for deepening opportunities; a chosen one becomes an idea taken into `grill-with-docs`.
- **`domain-modeling`** (domain language, `CONTEXT.md`, ADRs) and **`codebase-design`** (deep-module shape) are the vocabulary references the skills above pull in; reach for them directly when the *words*, not the process, are the problem.

### Repo-specific constraints

- Keep visual scanning proposal-first, and keep 2D/3D as capture, correction, planning, and trust layers over the Place Graph rather than independent sources of truth.
- `design-an-interface` was retired upstream (v1.2); UI work belongs inside a claimed `prototype` or `implement` ticket.

## Runtime compatibility

- Treat this file, `docs/agents/`, and `.scratch/` as the durable workflow contract. A client may not expose every orchestration skill named above even when its local skill file still exists.
- When `wayfinder`, `grill-with-docs`, `to-spec`, `to-tickets`, or `implement` is unavailable, continue the same protocol directly from the tracker: choose and claim the frontier, use `grilling`, `prototype`, or `research` according to ticket type, publish the agreed spec/tickets in the configured shapes, then use `tdd` and `code-review` for implementation.
- Never pretend an unavailable skill was invoked, and never let skill-registry drift block work that the repo-local protocol makes unambiguous.
