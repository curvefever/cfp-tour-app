import { unitsAwaitingAnswer } from './absences';
import { bestPlaceTie, bestPlaceTieKey } from './best-place';
import { matchResultSettings } from './match-results';
import { type ScoredUnit, scoreRoom } from './room-results';
import { compareRankScores, groupByScore, readTieResolution, roomKeyPrefix, roomTieKey } from './scoring';
import type { TournamentRound, TournamentState } from './types';

/** The ties inside a room (and the best-place race): which scores are level, and which stored tie decisions still hold. */

export interface RoomTieCluster {
  players: ScoredUnit[];
  rm: number;
  score: number;
}

export function detectTieBreaks(
  roundIndex: number,
  round: TournamentRound,
  state: TournamentState,
): Record<string, RoomTieCluster> {
  if (round.isFinal) return {};
  // Equal scores are a defined result under match results (a Tie), and the place in the room feeds no points: no room tie.
  if ((round.isGroupStage || round.isQual || round.isSwiss) && matchResultSettings(state)) return {};
  const ties: Record<string, RoomTieCluster> = {};
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const scored = scoreRoom(state, roundIndex, room, null).sort(compareRankScores);
    const awaiting = unitsAwaitingAnswer(state, roundIndex, room);
    for (const cluster of groupByScore(scored)) {
      if (cluster.length < 2) continue;
      // Units at 0 may have been absent: a tie there waits for the bar's answers.
      if (cluster[0].score === 0 && cluster.some((entry) => awaiting.has(entry.name))) continue;
      const key = roomTieKey(roundIndex, room, cluster[0]);
      ties[key] = { players: cluster, rm: room, score: cluster[0].score };
    }
  }
  return ties;
}

/** What a stored tie decision is checked against: the units that are tied now. */
interface TiedUnits {
  players: ReadonlyArray<{ name: string }>;
}

/** A shared place holds only while the recorded names are exactly the tied units. */
function coversCluster(recorded: string[], cluster: TiedUnits): boolean {
  const names = new Set(recorded);
  return names.size === cluster.players.length && cluster.players.every((player) => names.has(player.name));
}

/**
 * Drop room tie decisions whose recorded names no longer belong to the same
 * score cluster.
 */
export function invalidateStaleTieResolutions(
  state: TournamentState,
  roundIndex: number,
  room: number,
): TournamentState {
  const round = state.rounds[roundIndex];
  if (!round) return state;
  const currentTies: Record<string, TiedUnits> = detectTieBreaks(roundIndex, round, state);
  const bestTie = bestPlaceTie(state, roundIndex);
  if (bestTie) currentTies[bestTie.key] = bestTie;
  const prefix = roomKeyPrefix(roundIndex, room);
  const bestKey = bestPlaceTieKey(roundIndex);
  const tieResolutions = { ...state.tieResolutions };
  let changed = false;
  for (const key of Object.keys(tieResolutions)) {
    if (!key.startsWith(prefix) && key !== bestKey) continue;
    if (!decisionHolds(state, key, currentTies[key])) {
      delete tieResolutions[key];
      changed = true;
    }
  }
  return changed ? { ...state, tieResolutions } : state;
}

/** Whether a stored decision still names only units of the cluster, and a shared place still covers all of it. */
function decisionHolds(state: TournamentState, key: string, cluster: TiedUnits | undefined): boolean {
  if (!cluster) return false;
  const { ranked, shared } = readTieResolution(state, key);
  const named = [...ranked, ...shared];
  const inCluster = named.every((name) => cluster.players.some((player) => player.name === name));
  return inCluster && (shared.length === 0 || coversCluster(named, cluster));
}
