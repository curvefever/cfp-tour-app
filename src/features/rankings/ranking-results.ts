import { getAllTies, isTieResolved } from '../../domain/tournament/advancement';
import { roundExitRule } from '../../domain/tournament/room-exits';
import type { ActiveRanking } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { placeInRoom } from '../bracket/folded-round';
import { roomRowResult } from '../bracket/room-row-result';
import type { RowResult } from '../tournament/components/result-row';

/** Names in a tie of the round that the organiser has not resolved yet. */
function pendingTieNames(state: TournamentState, roundIndex: number): Set<string> {
  return new Set(
    Object.entries(getAllTies(state, roundIndex))
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
}

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
  const rule = roundExitRule(state, lastRoundIndex);
  const round = state.rounds[lastRoundIndex];
  const luckyNames = state.luckyLosers[round.winnersTo ?? lastRoundIndex + 1] ?? [];
  const pending = pendingTieNames(state, lastRoundIndex);
  const results = new Map<string, RowResult>();
  for (const entry of active) {
    if (entry.waitingFor !== undefined) {
      results.set(entry.name, 'advance');
    } else if (rule.kind !== 'per-room') {
      results.set(entry.name, '');
    } else if (entry.room === null) {
      results.set(entry.name, 'advance');
    } else {
      const place = placeInRoom(state, lastRoundIndex, entry.room, entry.name);
      const bands = rule.rooms[entry.room - 1] ?? [];
      results.set(
        entry.name,
        roomRowResult({
          rule,
          bands,
          rank: place ?? 1,
          lucky: luckyNames.includes(entry.name),
          pendingTie: place !== null && pending.has(entry.name),
          roomComplete: place !== null,
          roundDecided: lastRoundIndex < state.curRound,
        }).result,
      );
    }
  }
  return results;
}
