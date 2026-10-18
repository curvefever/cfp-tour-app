import { pendingTieNames } from '../../domain/tournament/advancement';
import { roundExitRule } from '../../domain/tournament/room-exits';
import type { ActiveRanking } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { placeInRoom } from '../bracket/folded-round';
import { luckyLoserNames } from '../bracket/room-row-inputs';
import { roomRowResult } from '../bracket/room-row-result';
import type { RowResult } from '../tournament/components/result-row';
import { isRoundDone } from '../../domain/tournament/round-columns';

/**
 * The stripe of every unit still in, as its row in the Bracket would draw it in the last drawn round: green once
 * its place in a complete room leads on (yellow or purple for a second or third destination), dashed while the
 * room is still being played, a tie is pending or it is a lucky-loser candidate. Units already routed on (waiting
 * for a round, or on a bye) are through. A pooling round or the Final has no stripe of its own.
 */
export function stillInResults(
  state: TournamentState,
  lastRoundIndex: number,
  active: ActiveRanking[],
): Map<string, RowResult> {
  // A unit is judged by the round it is drawn into (a column holds several); the rule of each is read once.
  const rounds = new Map<
    number,
    { rule: ReturnType<typeof roundExitRule>; lucky: string[]; pending: Set<string> }
  >();
  const roundOf = (roundIndex: number) => {
    const known = rounds.get(roundIndex);
    if (known) return known;
    const read = {
      rule: roundExitRule(state, roundIndex),
      lucky: luckyLoserNames(state, roundIndex),
      pending: pendingTieNames(state, roundIndex),
    };
    rounds.set(roundIndex, read);
    return read;
  };
  const results = new Map<string, RowResult>();
  for (const entry of active) {
    const roundIndex = entry.ri ?? lastRoundIndex;
    const { rule, lucky, pending } = roundOf(roundIndex);
    if (entry.waitingFor !== undefined) {
      results.set(entry.name, 'advance');
    } else if (rule.kind !== 'per-room') {
      results.set(entry.name, '');
    } else if (entry.room === null) {
      results.set(entry.name, 'advance');
    } else {
      const place = placeInRoom(state, roundIndex, entry.room, entry.name)?.place ?? null;
      const bands = rule.rooms[entry.room - 1] ?? [];
      results.set(
        entry.name,
        roomRowResult({
          rule,
          bands,
          rank: place ?? 1,
          lucky: lucky.includes(entry.name),
          pendingTie: place !== null && pending.has(entry.name),
          roomComplete: place !== null,
          roundDecided: isRoundDone(state, roundIndex),
        }).result,
      );
    }
  }
  return results;
}
