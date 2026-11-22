import type { PendingBracketSeed, RoundAssignment, TournamentRound, WinTarget } from './types';

/**
 * The wins a unit of a WINS round needs, stamped on its seat (`RoundAssignment.winsNeeded`) when the round is drawn:
 * the target of the round the unit comes from (`PendingBracketSeed.from`, `TournamentRound.winTargets`). Seat order
 * and seeds play no part. A unit whose source matches no target (a pool that no longer fits the round) gets no stamp
 * and reads the round's larger target (`roomMatch`).
 */

/** The wins each unit of the pool needs in `round`, by name; null when the round plays no WINS. */
export function winsNeededByName(
  round: TournamentRound | undefined,
  pool: PendingBracketSeed[],
): Map<string, number> | null {
  const targets = round?.winTargets;
  if (!targets) return null;
  const wins = new Map<string, number>();
  for (const entry of pool) {
    const target = targets.find((candidate) => candidate.from === entry.from);
    if (target) wins.set(entry.name, target.wins);
  }
  return wins;
}

/** The assignment with the unit's `winsNeeded`, when it has one. */
export function withWinsNeeded(
  entry: RoundAssignment,
  wins: ReadonlyMap<string, number> | null,
): RoundAssignment {
  const needed = wins?.get(entry.name);
  return needed === undefined ? entry : { ...entry, winsNeeded: needed };
}

/** Whether two target lists name the same sources with the same wins, whatever their order. */
export function sameWinTargets(first: WinTarget[] | undefined, second: WinTarget[] | undefined): boolean {
  const key = (targets: WinTarget[] | undefined) =>
    targets && JSON.stringify([...targets].sort((a, b) => a.from - b.from));
  return key(first) === key(second);
}
