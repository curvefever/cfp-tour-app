# Open items

Known gaps, accepted limitations and undecided questions. Read when planning a feature, diagnosing a bug, or closing out a build (update it when a build closes or changes an item). Larger future projects are in `ROADMAP.md`.

## Known gaps
- **Partial automated test coverage** — React components, hooks and server functions have no direct tests (`@testing-library/react`/`jsdom` installed, not configured). See `AGENTS.md`, "Testing". Current count: 1105 tests.
- **A roster loaded under one format can be generated under another.** `SetupView`'s `changeFormat()` never touches `state.players`; `rosterKeys()`/`generateTournament` accept whatever shape the roster already has (string or `TournamentTeam`) regardless of the selected format, so switching game format after loading a roster — by hand, or via "Copy settings from a past tournament" changing the format — and generating without reloading produces a schedule of the wrong unit type. The Setup panel already warns "load the roster again" when a copy changes the format; nothing currently blocks generating anyway. Noticed during the copy-settings live check (see the log entry).

## Accepted limitations (not building without an organiser request)
- **FFA counts that can't fill rooms of 6–8 are seated in smaller rooms** (9 → [5,4], 17 → [6,6,5]), by the organiser's decision; planned counts avoid this, organiser-entered counts can't. A few Shared-Final FFA configurations (17–19 entrants with 3–4 LB qualifiers) also fall back to it.
- **A removal can leave the current Kings Valley round, and rarely the next, below the minimum** (holding fallback; e.g. 7 [4,3] with a removal from room 2 has no seatable cut). The organiser can fill the room with a reserve.
- **Anonymous Finals exclude grand-final (race) Finals and team formats.** Race progression (`progressGrandFinalRace`, `finals.ts`) reads the two real finalists' score keys, so a placeholder-scored game would stall it; team Finals read a real `TournamentTeam` via `buildTeamMap()`, which a placeholder never has. See "Anonymous Finals matches, v1" in the log.
- **Live corrections have gaps by design** (mid-tournament corrections): no edit history or undo; no live edits of seeding method, pooling round count, Semis/Final sizes or LB qualifiers; no mid-bracket advancement edits for shared-Final double elimination; no line-up edits of scored rounds, fixed-draw pooling rounds, or in group stage, either double elimination, Kings Valley or waterfall; no moving into or out of byes. Details: `docs/rules.md`, "Line-up corrections".

## Awaiting organiser feedback
- **Scoreboard as an admin tool vs user-focused** — views.md describes Scoreboard as "admin tooling, not viewer destination". This is misleading; the scoreboard features information that players need to have, e.g. standings in qualifiers or in a Swiss tournament. Its purpose needs to be re-evaluated and it needs to be re-integrated with a viewer perspective. (Note added by the organizer 04-10-26)
- **Rankings' rank badge vs Scoreboard's standings table** — two levels of detail for "where do I stand" (Rankings: one line `#rank · X.XXX FP`; Scoreboard: full table). Both judged fine; open only if the organiser finds them inconsistent or wants one view.

## UX ideas, organiser-interested but not requested
- **Waterfall graph editor** (current editor: click-to-route table):
  - reusable saved templates (a named copy of the graph text plus a storage place) — partly served now: "Copy settings from a past tournament" (Setup panel) copies a past tournament's whole graph text (and every other setting) onto a new one, from the shared Archive or a pasted link/id; still no named-template list independent of a past tournament;
  - starter-template wizard (pick a shape and a player count, get a graph that adds up);
  - drag-and-drop canvas (largest option, not discarded);
  - showing every validation problem at once (`validateAndOrderWaterfallGraph` reports only the first);
  - rooms of different sizes inside one round (the text format only allows `N x size`).
