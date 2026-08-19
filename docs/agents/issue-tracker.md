# Issue tracker: Local Markdown

New issues and specs (you may know a spec as a PRD) for this repo live privately as markdown files in `.scratch/`. The repository has a GitHub remote for source control, but that does not make GitHub Issues the tracker: do not create, update, or publish remote issues unless the user explicitly changes this configuration.

This checkout excludes `.scratch/` through `.git/info/exclude`, so newly created tracker files stay local by default. Existing `.scratch` files already tracked by Git remain historical repository content; this setup does not rewrite or remove them.

## Conventions

- One feature or planning effort per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Implementation ticket numbers follow dependency order, with blockers first
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Destination / Notes / Decisions-so-far / Fog / Out-of-scope body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `open`/`claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
- **Fog**: decisions that are visibly coming but cannot yet be stated as a precise question. Something leaves fog and becomes a ticket when the question can be stated exactly, not when it can be answered.
- **Research**: link the cited research artifact from the ticket instead of pasting the whole report into the map.

## Repo-local notes

- Superseded planning documents do not live in `.scratch/`. `.scratch/` holds only live tracker state; retired material moves to `docs/archive/` (see `docs/archive/README.md`).
