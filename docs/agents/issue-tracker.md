# Issue tracker: Local Markdown

Issues and specs (previously called PRDs in this repo) live as markdown files in `.scratch/`.

## Conventions

- One feature or planning effort per directory: `.scratch/<feature-slug>/`
- The build spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; never publish a combined tickets file
- Implementation ticket numbers follow dependency order, with blockers first
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append under a `## Comments` heading
- Legacy `PRD.md` files are provenance only and must not be treated as the current build contract

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`, creating the feature directory when needed.

## When a skill says "fetch the relevant ticket"

Read the referenced markdown file directly. The user will normally pass its path or issue number.

## Wayfinding operations

Used by `wayfinder`. A map is an index file with one child file per decision ticket.

- **Map:** `.scratch/<effort>/map.md` contains Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket:** `.scratch/<effort>/issues/<NN>-<slug>.md` contains the question. A `Type:` line records `research`, `prototype`, `grilling`, or `task`; a `Status:` line records `open`, `claimed`, or `resolved`.
- **Blocking:** a `Blocked by: <NN>, <NN>` line records dependencies. A ticket is unblocked only when every referenced ticket is `resolved`.
- **Frontier:** scan the effort's `issues/` directory for open, unblocked, unclaimed files. Lowest ticket number wins when no ticket is named.
- **Claim:** set `Status: claimed` before beginning work so concurrent sessions skip the ticket.
- **Resolve:** append the decision under `## Answer`, set `Status: resolved`, then append a one-line gist and relative link to the map's Decisions so far.
- **Research:** link the cited research artifact from the ticket instead of pasting the whole report into the map.
