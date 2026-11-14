import { finalsProgressState } from '../finals';
import { normalizeLiveTournamentState } from '../../../lib/persistence/live-state';
import { unmarshalFromFirebase } from '../../../features/sync/firebase-marshal';
import { computeRankings, tournamentWinners } from '../rankings';
import { roundExitRule } from '../room-exits';
import { describeStandings } from '../standings-display';
import type { TournamentState } from '../types';

/**
 * What the screens show for a stored tournament, as plain data: the Rankings rows, the winners, the Standings rows
 * with their points and tie-break, the exit rule of each round on the Bracket and the Final's order. The pins of
 * `old-tournaments.test.ts` are these values for the finished tournaments in `old-tournaments/`.
 */

/** A stored tournament as the app reads it: the marshalled form of Firebase, through the app's own loader. */
export function loadStored(stored: unknown): TournamentState {
  return normalizeLiveTournamentState(unmarshalFromFirebase(stored), {
    tournamentId: () => 'old-tournament',
  });
}

const rounded = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value * 10_000) / 10_000;

function rankingRows(state: TournamentState) {
  const rankings = computeRankings(state);
  if (!rankings) return null;
  return {
    finalComplete: rankings.finalComplete,
    stillActive: rankings.stillActive.map((unit) => [unit.label, unit.room]),
    finalists: rankings.finalists.map((unit) => [unit.rank, unit.label, unit.total]),
    eliminated: rankings.eliminatedList.map((unit) => [
      unit.rank,
      unit.place,
      unit.round.roundNum,
      unit.label,
    ]),
    withdrawn: rankings.dnfList.map((unit) => unit.label),
    absentFromStart: rankings.absentFromStart.map((unit) => unit.label),
  };
}

function standingRows(state: TournamentState) {
  const display = describeStandings(state);
  if (!display) return null;
  return {
    phase: display.phase,
    kind: display.kind,
    roundsDone: display.roundsDone,
    roundsTotal: display.roundsTotal,
    tables: display.tables.map((table) => ({
      label: table.label,
      cut: table.cut,
      entries: table.entries.map((entry) => [
        entry.rank,
        entry.name,
        entry.totalFP,
        rounded(entry.roomShare),
        rounded(entry.averagePoints),
        entry.headToHead ?? null,
      ]),
    })),
  };
}

function exitRules(state: TournamentState) {
  return state.rounds.map((_round, index) => {
    const rule = roundExitRule(state, index);
    if (rule.kind === 'per-room') {
      return {
        kind: rule.kind,
        rooms: rule.rooms.map((bands) =>
          bands.map((band) => [
            band.kind,
            'fromRank' in band ? band.fromRank : band.rank,
            'toRank' in band ? band.toRank : band.rank,
            'destination' in band ? band.destination : null,
          ]),
        ),
      };
    }
    if (rule.kind === 'standings-cutoff') {
      return {
        kind: rule.kind,
        advancing: rule.advancing,
        perGroup: rule.perGroup,
        destination: rule.destination,
      };
    }
    return { kind: rule.kind };
  });
}

function finalOrder(state: TournamentState) {
  const index = state.rounds.findIndex((round) => round.isFinal);
  if (index === -1) return null;
  const progress = finalsProgressState(state, index, state.rounds[index]);
  return { complete: progress.complete, order: progress.order };
}

/** Everything a pin of a stored tournament holds. */
export function pinsOf(stored: unknown) {
  const state = loadStored(stored);
  return {
    rankings: rankingRows(state),
    winners: tournamentWinners(state).map((winner) => [winner.label, winner.members]),
    standings: standingRows(state),
    exits: exitRules(state),
    final: finalOrder(state),
  };
}
