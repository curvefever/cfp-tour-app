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
- Single elimination and the shared-Final variant below accept optional explicit round targets and per-round seeding overrides (Setup → "Advanced round overrides"), read only at generation.
- **`double-elimination`** — head-to-head race bracket (winners bracket, losers bracket, grand final). Not available with Flex.
- **`double-elimination-shared-final`** — multi-unit double elimination feeding one shared Final. A unit dropped from the winners bracket reaches a losers-bracket round within at most 2 winners-bracket rounds (`MAX_WB_ROUNDS_BEFORE_LB`, `double-elimination.ts`).
- **`kings-valley`** — see below.
- **`waterfall-bracket`** — see below.

### Kings Valley (`kings-valley.ts`)
A room ladder: rooms are ranked top to bottom. Each round, a room's top finishers promote to the room above, its bottom finishers demote to the room below, the rest stay; the lowest room with a real match eliminates its bottom finishers instead of demoting them. Room 1's promote band stays in room 1.
- Band sizes: `bandCount(size, fraction) = max(1, round(size × fraction))`, with `KINGS_VALLEY_MOVE_FRACTION = 0.25` for moves and `KINGS_VALLEY_ELIMINATION_FRACTION = 0.5` for the cut. One function, `kingsValleyRoomBandCounts`, computes the bands from each room's **real** size and drives generation, the real advance and the Bracket exit chips.
- A room with fewer than 2 units **holds**: nobody in it moves or is cut, and the cut comes from the lowest room that still has a real match.
- Room sizes are recomputed each round from the survivor count via `distributeRooms()`; the ladder ends in a single-room Final, capped at `MAX_KINGS_VALLEY_ROUNDS = 14` rounds.
- If a removal or reserve makes the survivor count differ from the plan, the rest of the ladder (Final included) is re-planned at the next advance (`fitKingsValleyTail`, `transitions.ts`); room movement uses `sequentialSeed`.
- **Unavailable for head-to-head formats** (`individual-1v1`, `team-3v3` including Flex): with rooms of 2 it cuts one unit per round and can't reach a Final within the cap above 16 units. Hidden in Setup and refused by generation; head-to-head Kings Valley tournaments generated earlier still play out.
- No Setup fields: the organiser tunes nothing.

### Waterfall bracket (`waterfall-bracket.ts`)
Organiser-authored rank-band routing: a graph (a `ROUNDS:`/`ROUTES:` text format, edited through a click-to-route table in Setup, `src/features/admin/waterfall/`) in which each room's finishers split by rank into bands, each routed to any later round or eliminated. Fixed at generation: no live reseeding, no byes or lucky losers, reserves blocked once started. Known behaviour: Rankings can show a still-alive unit as "eliminated" for one round until its destination round is reached (same timing as double elimination's deferred losers-bracket targets).

## Semis and Final
Both support 1–4 games, summed ("Semis format"/"Finals format"). Final scores live in `finalScores`; multi-game Semis use room score keys with a `-g{n}` segment. A plain (non-grand-final) Final can have games flagged anonymous (`round.anonymousGames`): those games are scored under `Finalist-N` placeholders, then "Connect & reveal" merges them onto the real finalists. Not available for grand-final race Finals or team formats.

## Lucky losers
In an elimination round with `luckyCount > 0`, each room's best non-advancing unit is a candidate, ranked by its score as a share of its room's total; the top `luckyCount` advance (`advancement.ts`).

## Scoring (pooling standings only)
Selectable per tournament when `poolingPhase !== 'none'`; applies to qual-table, Swiss and Group Stage standings. Semis/Final use raw score sums.
- **Fair Points** (default): `fairPoints(rank, score) = rank − score / 100_000`, lower is better, so a higher score wins a same-rank tie. The standing is the **average** across rounds played. Averaging has no volume discount — a settled design trade-off: a unit with only 2 rounds (the minimum a reserve can have) competes on equal footing with one that played every round. Bayesian shrinkage was rejected as too opaque.
- **Positional Points**: an organiser table (`positionalPointsTable`, highest rank first, e.g. `10,8,6,5,4,3,2,1`, must cover the largest room and never increase), higher is better, **summed** across rounds.
- **Uncontested rooms**: a room with exactly one assigned unit (opponent removed, or an odd unit left alone) is not a match. Like a bye, it's left out of standings (`isUncontestedRoom`); the unit still advances.
- Ties at a cutoff are resolved by the admin in Bracket; standings use dense ranking (`rankStandings()`).

## Roster changes during a tournament
Rename, swap, remove and reserve fill live in Rankings (`mutations.ts`). Duplicate player and team names are refused everywhere a name is entered (team member names excepted). A removed or swapped-out unit that played at least one match shows as "DNF" in final standings (`state.withdrawnUnits`); one that never played appears only in the admin "No-shows" panel. In a fixed-draw tournament, a removal or swap patches the unreached published rounds (an orphaned opponent gets a bye, rooms are renumbered).
