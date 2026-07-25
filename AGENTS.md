# AGENTS.md

## Agent skills

### Issue tracker

Work is tracked as local markdown under `.scratch/`; there is no GitHub or GitLab remote for this idea yet. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five Matt workflow labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project. Read `CONTEXT.md` first, then ADRs in `docs/adr/` when product direction, data model, or architecture matters. See `docs/agents/domain.md`.

## Development workflow

The canonical flow is:

```text
ask-matt -> grill-with-docs -> (handoff -> prototype -> handoff, if a question needs a runnable answer)
         -> to-spec -> to-tickets -> implement (drives tdd, closes with code-review) -> commit
```

`wayfinder` is the on-ramp when the effort is too large and foggy to spec in one sitting; it merges back onto the flow at `to-spec`.

- Start by routing through `ask-matt`.
- Use `wayfinder` when the destination spans more than one focused session and the route is still unclear. Its local map lives at `.scratch/<effort>/map.md`; resolve decision tickets before synthesizing a build spec.
- For a bounded idea in this codebase, use `grill-with-docs` so settled language and durable decisions update `CONTEXT.md` and `docs/adr/`.
- Use `handoff -> prototype -> handoff` when a state, interaction, 2D/3D view, or capture flow needs a runnable answer before it can be specified.
- Once the decision path is clear, use `to-spec` to publish `.scratch/<feature>/spec.md`, then `to-tickets` to create one tracer-bullet file per implementation ticket with explicit blocking edges.
- Work only the current frontier. Start each `implement` ticket in a fresh context; drive it through agreed public seams with `tdd`, run the full verification suite, then use `code-review` against a fixed Git baseline before committing.
- Use `triage` only for raw incoming bugs or requests. Tickets produced by `to-tickets` are already `ready-for-agent`.
- Keep visual scanning proposal-first and keep 2D/3D as capture, correction, planning, and trust layers over the Place Graph rather than independent sources of truth.

## Runtime compatibility

- Treat this file, `docs/agents/`, and `.scratch/` as the durable workflow contract. A client may not expose every orchestration skill named above even when its local skill file still exists.
- When `ask-matt`, `wayfinder`, `grill-with-docs`, `to-spec`, `to-tickets`, or `implement` is unavailable, continue the same protocol directly from the tracker: choose and claim the frontier, use `grilling`, `prototype`, or `research` according to ticket type, publish the agreed spec/tickets in the configured shapes, then use `tdd` and `code-review` for implementation.
- Never pretend an unavailable skill was invoked, and never let skill-registry drift block work that the repo-local protocol makes unambiguous.
