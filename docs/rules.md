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
In an elimination round with `luckyCount > 0`, each room's best non-advancing unit is a candidate, ranked by its score as a share of its room's total; the top `luckyCount` advance (`advancement.ts`).

## Scoring (pooling standings only)
Selectable per tournament when `poolingPhase !== 'none'`; applies to qual-table, Swiss and Group Stage standings. Semis/Final use raw score sums.
- **Fair Points** (default): `fairPoints(rank, score) = rank − score / 100_000`, lower is better, so a higher score wins a same-rank tie. The standing is the **average** across rounds played. Averaging has no volume discount — a settled design trade-off: a unit with only 2 rounds (the minimum a reserve can have) competes on equal footing with one that played every round. Bayesian shrinkage was rejected as too opaque.
- **Positional Points**: an organiser table (`positionalPointsTable`, highest rank first, e.g. `10,8,6,5,4,3,2,1`, must cover the largest room and never increase), higher is better, **summed** across rounds.
- **Team scoring** (team formats, chosen in Setup, fixed at generation): *Sum of all members* adds the members' scores; *Save your Buddy* reads only the designated defender's score; *Survival Teams* stores one score per team under the individual key (`r{ri}-rm{room}-p{pos}`, `game{n}-{team}` in the Final). `scoredTeamSize()` (`scoring.ts`) is the single switch between per-member and per-unit score keys.
- **Uncontested rooms**: a room with exactly one assigned unit (opponent removed, or an odd unit left alone) is not a match. Like a bye, it's left out of standings (`isUncontestedRoom`); the unit still advances.
- **Tie-breaker: average room share.** Units with equal standing points are ordered by higher *average room share* (`roomShare` on `TournamentStanding`): per counted round, the unit's score ÷ the total of its room's scored entries (an all-zero room splits equally), averaged over the unit's counted rounds. It is the lucky-loser measure, fair across room sizes and rounds played (raw score totals favour bigger rooms and more rounds). It changes who qualifies and Swiss/qual reseeding order. Absent in standings snapshots saved before 2026-10-05, where equal points count as equal. The legacy app had no such tie-breaker.
- **Shared ranks and cut-off ties.** `rankStandings()` gives units a shared rank only when points **and** share are equal (`sameStanding()`, share tolerance 1e-9); points stay a strict `===`. A cut-off tie cluster (the entries `sameStanding` with the boundary unit) exists, and needs the admin's pick in Bracket, only then. A unit the admin placed never shares a rank with a neighbour (A, B, C tied, only A picked: A first, B and C share the next rank).
- **Displays count a current-round room only once it's fully scored.** `describeStandings()` (the single source for the Standings tab, Bracket column, follow banner and Rankings badge) computes standings with `liveRound: curRound`: a contested room of the current round counts only when every assigned unit has a score; past rounds count as scored. Real advancement is unchanged and still uses whatever is scored.

## Line-up corrections
The Admin "Correct current round" panel (`lineup-edit.ts`) fixes the round about to be played: **move** a unit to another room, **eliminate** a unit by hand, **reinstate** a unit eliminated in the previous round. Applied as one draft (`applyLineupEdit`), validated as a whole, so a head-to-head room of 2 is corrected by "eliminate X + reinstate Y" together.
- **Scope**: only the current round and only while it has no score (scores are keyed by room position; history stays as played). Pooling rounds (qual-table, Swiss, no-pooling warm-ups) of any bracket format: moves only, no elimination (use Remove), nobody reinstatable; fixed-draw pooling rounds and group stage are refused. Bracket rounds (elimination, Semis, Final): single elimination only.
- **Rules**: the round's `advTotal` and room count never change; no room is emptied; byes can be eliminated but nobody moves into or out of a bye; a room is refused only if the edit made it too small (under 2, or no more than `advPerRoom`) or too big (over `roomSize.max`), so existing odd states (a lone room after a removal, an over-cap reserve) don't block unrelated edits; in an elimination round the total must stay above `advTotal` (otherwise lower the count via the advancement edit); the Final keeps at least 2. Reinstating is limited to units present in the previous round's line-up, absent from this one and still in the roster (`computeRankings` derives elimination from "not in the next round's assignments", so rankings follow with no change).
- **Marker**: a unit placed, moved or reinstated this way carries `RoundAssignment.manual: true` and shows a ✋ badge in Bracket ("Set by organiser"). `roomHistory` for the round is rewound and re-recorded.

## Roster changes during a tournament
Rename, swap, remove and reserve fill live in Rankings (`mutations.ts`). Duplicate player and team names are refused everywhere a name is entered (team member names excepted). A removed or swapped-out unit that played at least one match shows as "DNF" in final standings (`state.withdrawnUnits`); one that never played appears only in the admin "No-shows" panel. In a fixed-draw tournament, a removal or swap patches the unreached published rounds (an orphaned opponent gets a bye, rooms are renumbered).
