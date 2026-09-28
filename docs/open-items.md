# Open items

Known gaps, accepted limitations and undecided questions. Read when planning a feature, diagnosing a bug, or closing out a build (update it when a build closes or changes an item). Larger future projects are in `ROADMAP.md`.

## Known gaps
- **Partial automated test coverage** — React components, hooks and server functions have no direct tests (`@testing-library/react`/`jsdom` installed, not configured). See `AGENTS.md`, "Testing". Current count: 1050 tests.

## Accepted limitations (not building without an organiser request)
- **Anonymous Finals exclude grand-final (race) Finals and team formats.** Race progression (`progressGrandFinalRace`, `finals.ts`) reads the two real finalists' score keys, so a placeholder-scored game would stall it; team Finals read a real `TournamentTeam` via `buildTeamMap()`, which a placeholder never has. See "Anonymous Finals matches, v1" in the log.

## Awaiting organiser feedback
- **Rankings' rank badge vs Scoreboard's standings table** — two levels of detail for "where do I stand" (Rankings: one line `#rank · X.XXX FP`; Scoreboard: full table). Both judged fine; open only if the organiser finds them inconsistent or wants one view.

## UX ideas, organiser-interested but not requested
- **Waterfall graph editor** (current editor: click-to-route table):
  - reusable saved templates (a named copy of the graph text plus a storage place) — partly served now: "Copy settings from a past tournament" (Setup panel) copies a past tournament's whole graph text (and every other setting) onto a new one, from the local Archive or a pasted link/id; still no named-template list independent of a past tournament;
  - starter-template wizard (pick a shape and a player count, get a graph that adds up);
  - drag-and-drop canvas (largest option, not discarded);
  - showing every validation problem at once (`validateAndOrderWaterfallGraph` reports only the first);
  - rooms of different sizes inside one round (the text format only allows `N x size`).
