# Views and viewer design

What each tab does today, and the principles viewer-facing work is judged against. Read when a task touches the UI (`src/features/*`).

## Design intent for viewer-facing tabs
The standard for new viewer-facing work:
- **No live events, no audience, no stream overlay.** Every player plays online, alone, at their own computer.
- **Two success criteria for a viewer**: (1) **convenience** — instantly seeing, with zero clicks, which room you're in and who you're facing; (2) **fun/engagement** — seeing how the rest of the tournament is doing.
- **Scoreboard serves neither**: it's admin tooling, not a viewer destination.
- **No staggered reveal**: every score reaches every connected viewer at the same instant.
- **"Follow a player," never "who are you."** Anyone can follow any name.
- **A collapsed round is a display state, not a data reduction.** Reopening shows exactly the detail the current round's display uses.
- **Future rounds default to fully visible**, not collapsed or faded; a viewer may fold any round, but the app never does so by default.

## Tabs
1. **Setup** (`SetupView.tsx`, before start only) — game format, schedule logic, pooling phase, odd-count strategy, team scoring, scoring system, draw publication, Semis/Final game counts and size overrides, advanced round overrides, waterfall graph editor, roster and reserves ("↺ Clear roster" keeps the config), and a schedule preview before "Confirm & Start". Fields and options that don't fit the chosen format are hidden. A hidden field's stored value is ignored by generation; a schedule logic or pooling phase that no longer fits is reset on a format change, and generation refuses a stale one with a message.
2. **Admin** (`RunningAdmin.tsx`, `RunningAdminStatus.tsx`, plus the "Admin Access" panel in `AppShell.tsx`) — signed-in status and sign out, tournament name, a read-only settings recap (`TournamentSettingsRecap`), the "Tournament progress" timeline, and Save to Archive / Reset / Save & Start New with title-collision and unsaved-changes prompts.
3. **Scoreboard** (`ScoreboardView.tsx`) — standings only: the qual-table/Swiss table or per-group tables (`TournamentStandings`), with dense ranking and any resolved cutoff ties applied. Its title gets " (Final)" once the bracket phase has started. Tournaments with no pooling standings get a short explanation instead.
4. **Bracket** (`BracketView.tsx`) — every round as a collapsible column (past rounds collapsed by default). Double elimination groups a winners-bracket round with the losers-bracket rounds that follow it in one box (`bracketBoxes()`, `bracket.ts`); labels come from `bracketRoundLabels()`. Rooms are shown as letters (`roomLetter()`); logic keeps 1-indexed numbers. Contents:
   - "Follow a player/team" search, scrolling to their current round.
   - Score entry for the current round (admins), including per-game tabs and a Total tab for multi-game rounds; lone units get a "No opponent" note instead of an input where that's a bye.
   - Tie-break cards at the top (admins) and "⚠ TB?" / "⚖ TB" badges.
   - **Exit chips** under each room ("1–4 → Final", "5 ★ lucky loser?", "6–8 out", "1–2 ↑ Room A", "1 stay") and a round summary where no per-room split applies, all from one domain description, `roundExitRule` (`room-exits.ts`). Scored rows are coloured from the same bands (advance, lucky, drop, promote, stay, demote, eliminate); waterfall and double-elimination rows also get a destination tag ("→ SemiB", "→ LB Round 4").
   - Lucky-loser explanation plus live "who's leading" standings on rounds with lucky-loser slots; a one-sentence Kings Valley footnote.
   - Future-round slots labelled with their projected origin (see `docs/seeding.md`).
   - Anonymous Finals: a "🎭 Anonymous matches" card beside the Final, and "🔓 Connect & reveal" once all games are scored.
5. **Rankings** (`RankingsView.tsx`, `RankingsRoster.tsx`) — the player-information tab from roster list to live ranking: still-active units with pool-rank badges, finalists and eliminated units, final standings (with DNF), PNG export (`rankings-image.ts`). For admins it also holds roster management (`ManageRoster`: rename, swap, remove, designated defender, fill a vacant slot from reserves), the reserve window (`ReservePanel`, smallest-room placement) and the "No-shows" panel.
6. **Archive** (`ArchiveView.tsx`) — local, Firebase-independent archive: import/export of one entry or a bundle, id-collision handling (overwrite/new/skip), annotations, and a read-only detail view reusing the live Bracket/Rankings renderers.
