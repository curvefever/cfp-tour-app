# Tournament rules

Current rules of the app's tournament engine (`src/domain/tournament/`). Read when a task touches generation, advancement, scoring, formats or phases. Build history and reasoning: search `HANDOFF_LOG.md` for the entry names cited below.

## Game formats
`formats.ts`, `GAME_FORMATS`. A "unit" is a player (individual formats) or a team.

| Format | Unit | Room size | Odd-count strategies (default) |
|---|---|---|---|
| `ffa-individual` | player | 6–8, ideal 8 | — |
| `team-2v2v2v2` | team of 2 | 3–4, ideal 4 | — |
| `team-3v3v3` | team of 3 | 2–3, ideal 3 | — |
| `team-3v3` | team of 3 | 2 (head-to-head) | `none`/`bye`/`flex` (`bye`) |
| `individual-1v1` | player | 2 (head-to-head) | `none`/`bye` (`bye`) |

FFA counts that can't fill rooms of 6–8 are seated in smaller rooms by design (9 → [5,4], 17 → [6,6,5]). Planned advancement counts (what a schedule chooses itself) are always seatable; counts the organiser enters are seated as they come.

An unset odd-count strategy means the format's default. "Flex" lets `team-3v3` seat a 3-team room (room size 2–3). "None" refuses to generate on a count that can't be split evenly.

Room counts and sizes for any headcount come from `distributeRooms()` (`room-distribution.ts`); a round's advancement target splits into `advPerRoom` per room plus `luckyCount` lucky-loser slots (`splitAdvancement`). When removals leave a round with a different headcount than planned, `fitRoundToPool` reshapes it at advance time.

## Pooling phases (`poolingPhase`)
- `none` — 2 no-elimination warm-up rounds.
- `qual-table` — qualification rounds (3 by default) feeding one cumulative standings table; the top `qualAdv` advance.
- `swiss` — 3–7 fold-paired rounds, same standings engine as `qual-table`. Every Swiss round is `floor(n/2)` rooms of 2 plus `n % 2` byes, whatever the odd-count strategy.
- `group-stage` — round-robin groups (single or double), top N per group advance. Pairings are known at generation (`round.matches`/`round.groupByes`).

Rules:
- Swiss and Group Stage are **head-to-head only** (`individual-1v1`, `team-3v3`), gated in Setup and in `generateTournament()`: fold-pairing and round-robin always pair exactly 2 units.
- **Non-counting rounds** (qual-table/Swiss only): a tournament can mark its leading N rounds `excludeFromStandings`; they're played and reseed normally but `computeQualificationStandings` skips them.
- **Reserve admission** (qual-table/Swiss): a reserve can join only while at most one qualifying round is complete (`addReserveUnit`, `mutations.ts`), so a reserve always plays at least two counted rounds.
- **Draw publication** (qual-table/Swiss, Setup "Draw publication"): `adaptive` (default) reseeds from live results; `fixed` publishes the whole pooling schedule at generation — see `docs/seeding.md`.

## Bracket phases (`scheduleLogic`)
- **`single-elimination`** — room-based cuts to Semis and a Final.
- Single elimination and the shared-Final variant below accept optional explicit round targets and per-round seeding overrides (Setup → "Advanced round overrides"). The targets (and "Advance to bracket", `qualAdv`) stay editable live, in the Admin "Correct current round" panel (`live-advancement-edit.ts`):
  - **While pooling runs** (qual-table, Swiss, no-pooling warm-ups; single elimination and shared-Final): the bracket is rebuilt from scratch like Setup does, pooling rounds untouched (fixed draws included). The targets list is fully editable, length included (blank = automatic); with seeding overrides its length must stay the same (they are index-aligned). `qualAdv` (qual-table/Swiss only) is refused, not clamped, outside the format minimum and the roster count. A stale standings-cutoff tie resolution (`qual-cutoff`) is dropped when `qualAdv` changes.
  - **Single elimination mid-bracket**: values only, from the current round (until advanced, scores allowed) to the last round before Semis; the number of rounds never changes. The current round keeps its rooms; later rounds are rebuilt (`eliminationRound`, existing seeding overrides kept) and Semis is refitted to the last value. Tie resolutions stay (they order equal scores, wherever the cut moves).
  - Shared-Final double elimination is editable only until its bracket starts; race double elimination, Kings Valley, waterfall and group stage are not editable. A saved edit writes the settings snapshot (`settings.qualAdv`, `settings.eliminationRoundTargets`, `gamemodeConfig.explicitTargets`) so "Copy settings" copies what was played; an automatic curve edited mid-bracket becomes an explicit list.
- **`double-elimination`** — head-to-head race bracket (winners bracket, losers bracket, grand final). Not available with Flex.
- **`double-elimination-shared-final`** — multi-unit double elimination feeding one shared Final. A unit dropped from the winners bracket reaches a losers-bracket round within at most 2 winners-bracket rounds (`MAX_WB_ROUNDS_BEFORE_LB`, `double-elimination.ts`).
  - **Losers-bracket round sizes are always seatable.** When a losers round's count (previous survivors plus pending drops) can't be seated, three levers are tried in order: (1) the previous losers round's survivor target moves; (2) the round is deferred, up to the 2-round limit above; (3) the feeding winners round's target moves, keeping the curve strictly decreasing and the next winners round seatable. Each takes the nearest value that works, the smaller cut on a tie; organiser-set targets (`eliminationRoundTargets`) are never changed. A few small FFA configurations (17–19 entrants with 3–4 LB qualifiers) can't be fixed by any lever and fall back to smaller rooms by design.
- **`kings-valley`** — see below.
- **`waterfall-bracket`** — see below.

### Kings Valley (`kings-valley.ts`)
A room ladder: rooms are ranked top to bottom. Each round, a room's top finishers promote to the room above, its bottom finishers demote to the room below, the rest stay; the lowest room with a real match eliminates its bottom finishers instead of demoting them. Room 1's promote band stays in room 1.
- Promotions are `max(1, round(size × 0.25))` per room (`KINGS_VALLEY_MOVE_FRACTION`). The bottom room's cut is the one nearest half of it (`KINGS_VALLEY_ELIMINATION_FRACTION = 0.5`) that leaves a **seatable** total (every room within the format's minimum and maximum), the smaller cut on a tie. Demotions are then sized top-down so the moves land exactly on the next round's rooms (promotions are only lowered when a room couldn't supply its demotions). One function, `kingsValleyRoundMoves` (bands plus next room sizes), drives generation, the real advance and the Bracket exit chips, so chips, placeholders and the real seating agree. Room sizes are the `distributeRooms()` layout of the survivors; a room below the format's minimum is never planned.
- A room with fewer than 2 units (only after a removal) **holds**: nobody in it moves or is cut, and the cut comes from the lowest room that still has a real match (the plain per-room maths, no seatable-cut solving).
- The ladder ends in a single-room Final, capped at `MAX_KINGS_VALLEY_ROUNDS = 14` rounds.
- **Size limit.** Past the cap the forced Final would exceed the room maximum, so generation refuses a field above `kingsValleyMaxEntrants(roomSize)`: 32 teams in 2v2v2v2, 24 in 3v3v3, 60 players in FFA. The message names the limit and the 14 rounds, and suggests lowering "Advance to bracket" or adding a qualification phase. The re-plan after a reserve (`fitKingsValleyTail`) is not refused: it may still force a larger Final.
- **Accepted:** a removal can leave the current round (and rarely the next) with a room below the minimum; the organiser can fill it with a reserve.
- If a removal or reserve makes the survivor count differ from the plan, the rest of the ladder (Final included) is re-planned at the next advance (`fitKingsValleyTail`, `transitions.ts`); room movement uses `sequentialSeed`.
- **Unavailable for head-to-head formats** (`individual-1v1`, `team-3v3` including Flex): with rooms of 2 it cuts one unit per round and can't reach a Final within the cap above 16 units. Hidden in Setup and refused by generation; head-to-head Kings Valley tournaments generated earlier still play out.
- No Setup fields: the organiser tunes nothing.

### Waterfall bracket (`waterfall-bracket.ts`)
Organiser-authored rank-band routing: a graph (a `ROUNDS:`/`ROUTES:` text format, edited through a click-to-route table in Setup, `src/features/admin/waterfall/`) in which each room's finishers split by rank into bands, each routed to any later round or eliminated. No byes or lucky losers; reserves blocked once started.

The graph can still be corrected from the Admin tab while the tournament runs (`RunningWaterfallPanel.tsx`, `waterfall-live-edit.ts`): any round's routing can change, including already-played rounds, as long as replaying the edited routing reproduces every played round's recorded line-up exactly. A reached round (index ≤ the current round) keeps its label, room count, room size and Final flag -- only its routing can change; an unreached round can be freely resized, renamed, added or removed. If the current round's own line-up would change under the new routing, its rooms are re-drawn -- but only while it has no score yet; once a score is entered there, a line-up-changing edit is refused. `state.rounds` is the source of truth for what's actually running, not the `settings.waterfallGraph` snapshot (kept in sync on every save, so "Copy settings from a past tournament" still copies the corrected graph). No edit history -- a mistaken edit can only be corrected with another edit, not undone.

Known behaviour: Rankings can show a still-alive unit as "eliminated" for one round until its destination round is reached (same timing as double elimination's deferred losers-bracket targets).

## Semis and Final
Both support 1–4 games, summed ("Semis format"/"Finals format"). Final scores live in `finalScores`; multi-game Semis use room score keys with a `-g{n}` segment. A plain (non-grand-final) Final can have games flagged anonymous (`round.anonymousGames`): those games are scored under `Finalist-N` placeholders, then "Connect & reveal" merges them onto the real finalists. Not available for grand-final race Finals or team formats.

## Lucky losers
In an elimination round with `luckyCount > 0`, each room's best non-advancing unit is a candidate, ranked by its score relative to its room's average (score ÷ room total × units in the room, 1.00 = average), so room size gives no head start; the top `luckyCount` advance (`advancement.ts`). A room whose scores are all zero offers no candidate. Candidates with equal shares are split by room order.

## Scoring (pooling standings only)
Selectable per tournament when `poolingPhase !== 'none'`; applies to qual-table, Swiss and Group Stage standings. Semis/Final use raw score sums.
- **Standard points** (default; `'fairpoints'` in persisted state): each counted round a unit earns `standardPoints(place, maxRoomSize)` = `maxRoomSize + 1 − place` (floored at 0), with `maxRoomSize` the tournament's `gamemodeConfig.roomSize.max`: 8, 7, …, 1 in FFA, 4, 3, 2, 1 in 2v2v2v2, 3, 2, 1 in 3v3v3, win 2 / loss 1 head-to-head. The same place earns the same points whatever the size of the room (last of a room of 3 in 2v2v2v2 earns 2, like 3rd of 4). Points are **summed** over the counted rounds, higher is better; a counted round the unit didn't play earns 0, so a late arrival is not compensated.
- **Custom points table** (`'positional-points'`): an organiser table (`positionalPointsTable`, highest place first, e.g. `10,8,6,5,4,3,2,1`, must cover the largest room and never increase), summed like Standard points, higher is better. Its first value is also what a bye earns.
- **Names**: players only ever see "Points" / "Pts" (the totals are whole numbers under both systems). Setup and the Admin settings recap name the two options "Standard points (1st = largest room size, −1 per place)" and "Custom points table" (`SCORING_SYSTEM_OPTION_LABELS`, `scoring.ts`). The persisted keys `'fairpoints'` / `'positional-points'` and the `totalFP` field keep their old names. The points rule is not versioned: every tournament, archived ones included, recomputes with the current rule.
- **A bye counts as a win.** Each counted round, a unit with a bye (`state.byes[round]`, or `round.groupByes` in Group Stage) and a unit alone in a room (`isUncontestedRoom`: its opponent was removed, or an odd unit was left alone) earns 1st-place points under both systems, with no score and no share entry (`walkoverNames`, `advancement.ts`). Only once the round has begun (`roundHasBegun`: an earlier round, or the current one once the tournament has started), so a schedule that hasn't started has no points. A Group Stage bye goes to the unit's own group, and only when that group plays a match that round (a group whose round robin ran out is idle, not on a bye). Advancement is unaffected: a lone unit already advances.
- **Team scoring** (team formats, chosen in Setup, fixed at generation): *Sum of all members* adds the members' scores; *Save your Buddy* reads only the designated defender's score; *Survival Teams* stores one score per team under the individual key (`r{ri}-rm{room}-p{pos}`, `game{n}-{team}` in the Final). `scoredTeamSize()` (`scoring.ts`) is the single switch between per-member and per-unit score keys.
- **Tie-breaker: room share relative to the room average.** Units with equal points are ordered by the higher average *relative room share* (`roomShare` on `TournamentStanding`): per round played in a room, the unit's score ÷ its room's total × the number of scored units in the room (1.00 = an average score in that room; an all-zero room gives everyone 1.00), averaged over those rounds; byes and lone-room wins add no entry. A raw room share (score ÷ room total) would favour small rooms (about 33% against 25% on average), so it is not used. It changes who qualifies and Swiss/qual reseeding order. Older saved standings snapshots have no `roomShare`; there, equal points count as equal. The legacy app had no such tie-breaker.
- **Per-round detail.** `TournamentStanding.rounds` (`StandingRoundResult`: `roundIndex`, `score`, `rank` (the place in the room), `points`, `bye`) lists every counted round with a result, in round order; a bye has a null score and rank. A counted round without a result has no entry. The Standings table is built from it (`docs/views.md`).
- **Shared ranks and cut-off ties.** `rankStandings()` gives units a shared rank only when points **and** share are equal (`sameStanding()`, share tolerance 1e-9); points stay a strict `===`. A cut-off tie cluster (the entries `sameStanding` with the boundary unit) exists, and needs the admin's pick in Bracket, only then. A unit the admin placed never shares a rank with a neighbour (A, B, C tied, only A picked: A first, B and C share the next rank).
- **Displays count a current-round room only once it's fully scored.** `describeStandings()` (the single source for the Standings tab, Bracket column, follow banner and Rankings badge) computes standings with `liveRound: curRound`: a contested room of the current round counts only when every assigned unit has a score; past rounds count as scored. Real advancement is unchanged and still uses whatever is scored.

## Line-up corrections
The Admin "Correct current round" panel (`lineup-edit.ts`) fixes the round about to be played: **move** a unit to another room, **eliminate** a unit by hand, **reinstate** a unit eliminated in the previous round. Applied as one draft (`applyLineupEdit`), validated as a whole, so a head-to-head room of 2 is corrected by "eliminate X + reinstate Y" together.
- **Scope**: only the current round and only while it has no score (scores are keyed by room position; history stays as played). Pooling rounds (qual-table, Swiss, no-pooling warm-ups) of any bracket format: moves only, no elimination (use Remove), nobody reinstatable; fixed-draw pooling rounds and group stage are refused. Bracket rounds (elimination, Semis, Final): single elimination only.
- **Rules**: the round's `advTotal` and room count never change; no room is emptied; byes can be eliminated but nobody moves into or out of a bye; a room is refused only if the edit made it too small (under 2, or no more than `advPerRoom`) or too big (over `roomSize.max`), so existing odd states (a lone room after a removal, an over-cap reserve) don't block unrelated edits; in an elimination round the total must stay above `advTotal` (otherwise lower the count via the advancement edit); the Final keeps at least 2. Reinstating is limited to units present in the previous round's line-up, absent from this one and still in the roster (`computeRankings` derives elimination from "not in the next round's assignments", so rankings follow with no change).
- **Marker**: a unit placed, moved or reinstated this way carries `RoundAssignment.manual: true` and shows a ✋ badge in Bracket ("Set by organiser"). `roomHistory` for the round is rewound and re-recorded.

## Going back a round
"← Previous" only moves the view back one round; nothing is undone, so the later round stays drawn. "Next Round" from the earlier round then does one of two things (`drawnAheadStatus()`, `redraw.ts`), and the Bracket says which in a note above the action bar:
- **Re-draw**: when the next round is drawn and nothing in any drawn later round has a score, Next Round discards those draws and seeds the next round again from the current results. With nothing changed the result is identical; after a score correction it is exactly the draw a first advance from the corrected results would have made. `discardDrawsAfter()` first undoes the discarded draws' `roomHistory` entries (not those of a fixed-draw round, which are folded in at generation), pooling-bye counts, byes, lucky losers and tie resolutions.
- **Steps forward unchanged** ("locked"): when any drawn later round has a score, or a double elimination or waterfall round from the current one up to the one before the last drawn round has been advanced from (it already pushed its units into the bracket pools). Nothing is re-drawn or re-routed, so a correction in the earlier round does not change the later draw. A bracket round that is only drawn, not yet advanced from, still re-draws: the first bracket round after pooling re-draws when the last pooling round is corrected.

Pending ties in the current round still block Next Round in both cases.

## Roster changes during a tournament
Rename, swap, remove and reserve fill live in Rankings (`mutations.ts`). Duplicate player and team names are refused everywhere a name is entered (team member names excepted). A removed or swapped-out unit that played at least one match shows as "DNF" in final standings (`state.withdrawnUnits`); one that never played appears only in the admin "No-shows" panel. In a fixed-draw tournament, a removal or swap patches the unreached published rounds (an orphaned opponent gets a bye, rooms are renumbered).
