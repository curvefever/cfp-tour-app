# Room seeding

How units land in rooms from round to round (`src/domain/tournament/seeding.ts`, plus `fixed-draws.ts`). Read when a task touches transitions between rounds, reseeding, or Bracket's future-round projections, or when explaining "how did this player end up in this room". Build history and reasoning: search `HANDOFF_LOG.md` for "Diversity + rematch-aware room reseeding" and the entries named below.

## Which mechanism runs where
| Mechanism | Used for |
|---|---|
| `randomSeed` | Round 1 only: a shuffle via the injectable `RandomSource`. |
| `swissFoldPair` | Adaptive Swiss rounds: fold-pairs by rank (1 vs `half+1`, …), with a rematch-avoidance swap when one clears both pairs. |
| `tieredSeed` | Every ordinary room-based transition: no-elim warm-up, qual-table, single-elimination and team-format cuts, up to the round that seeds Semis. |
| `tieredBracketSeed` | Double elimination's winners/losers-bracket routing (race and shared-Final variants). |
| `sequentialSeed` | Kings Valley's ladder moves, including the first hop into Kings Valley: slices an ordered list into declared room sizes, no reordering. |
| Fixed draws | Qual-table/Swiss with draw publication `fixed`: the whole pooling schedule is computed at generation. |
| `distributeTierMajorPool` | Bracket's future-round **display** projection only (`projectFutureRoundSlots`). |
| `snakeSeed` | Not called by the app; kept as a tested primitive. |

## `tieredSeed`
Survivors are grouped into rank tiers across all rooms (tier 0 = every room's winner, tier 1 = every runner-up, …). A room's dominance margin (`pct`, score share) only breaks ties inside a tier. The next round's rooms are filled one wave (a tier, or part of one) at a time; each wave is assigned to rooms by minimising a weighted cost of:
- repeat pairings against everyone already placed and all prior rounds, recency-weighted (a pair that met last round costs ~10% more than one that met long ago), and
- how far each room's running total lands from balanced.

The weighting tapers from diversity-heavy (warm-up and early cuts) to balance-heavy by the round that seeds Semis. Match history is kept in `state.roomHistory` (pair key → last round index shared), also written by double elimination. A re-draw ("Next Round" after "Previous") first rewinds the discarded draws' entries, and entries at or after the round being drawn are ignored, so a stale or planned entry is never treated as a past repeat.

Behaviour worth knowing when explaining it to players: the balance term is often an exact tie (whenever a wave's candidates share a tier, and for any two-room destination starting from zero), so the taper acts almost like pure diversity in common shapes; balance only visibly matters with 3+ destination rooms. A pure `balance` seeding override (diversity weight exactly 0) ignores repeat history entirely, so it can produce more repeat opponents than a balance-heavy blend. Details: "Seeding system explainer + seeding-behavior findings" in the log.

## `tieredBracketSeed`
The same wave/cost/taper approach for double elimination, where a target round can pool units from several source rounds (a losers-bracket round mixes fresh winners-bracket drops with the previous losers-bracket round's survivors). Each contribution is tagged with its room-rank tier when pushed, so the pooled entries are directly comparable. The taper (`doubleEliminationApproachProgress`) is computed per bracket side, with the terminal round at 1.

## Fixed draws (`fixed-draws.ts`)
Computed once from roster order, never from results. Swiss uses `circleMethodSchedule` (zero repeat pairings); qual-table uses a greedy wave fill with `assignWaveToRooms` and all tiers equal. Stored per round on `TournamentRound.fixedRoomAssignments` (not in `state.assignments`, which means "round reached"); `transitions.ts` uses it directly. `roomHistory`/`poolingByeCounts` for the whole schedule are folded in at generation, and rebuilt after a removal or swap patches the unreached rounds.

## Future-round projection (Bracket display only)
`projectFutureRoundSlots` (`bracket.ts`) labels future slots with their expected origin ("Room 2A, Rank 1", "Winner of Room B", "★ Lucky loser (any room)", "Dropped from WB Round 6", "Qualifier from standings (seed TBD)"). The candidate pool is built tier-major and spread across target rooms by `distributeTierMajorPool` (round-robin with a rotating start), so every projected room shows exactly its declared size and a spread of ranks and source rooms. Accepted trade-off: the real transition (`tieredSeed`/`tieredBracketSeed`) can place units differently once the round is reached. Where the origin can't be known ahead of time the slot shows "—", and every round built on it does too. Group Stage and fixed-draw rounds show their real pairings; Kings Valley future rounds show room sizes only.
