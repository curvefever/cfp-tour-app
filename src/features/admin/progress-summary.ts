import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { computeRankings } from '../../domain/tournament/rankings';
import { getFinalUnitScore, getUnitScore, roundHasAnyScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { plural } from './setup/plural';

export type StageState = 'done' | 'now' | 'upcoming';

export interface ProgressStage {
  name: string;
  state: StageState;
}

export interface RoomProgress {
  name: string;
  players: number;
  /** How many of the room's places have every score in. */
  scored: number;
  /** True once any score of the room is in: its line-up is then locked. */
  hasScores: boolean;
}

export interface ProgressSummary {
  /** The current round's name ("Round 5", "Semis", "Final"). */
  roundName: string;
  /** "Round 5 · 2 of 3 rooms scored". */
  text: string;
  /** How much of the current round is scored, 0 to 1. */
  fraction: number;
  stages: ProgressStage[];
  /** The current round's rooms, empty for a round with no rooms to list (the race Grand Final). */
  rooms: RoomProgress[];
}

/** The Final is scored per game under `finalScores`, every other round per room position under `scores`. */
function roomsOf(state: TournamentState, roundIndex: number): RoomProgress[] {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (round.bracket === 'grand-final') return [];
  if (round.isFinal) {
    const games = round.numGames ?? 1;
    const complete = (name: string) =>
      Array.from({ length: games }, (_, game) => getFinalUnitScore(state, name, game + 1, null)).every(
        (value) => value !== null,
      );
    return [
      {
        name: 'Final',
        players: assignments.length,
        scored: assignments.filter((entry) => complete(entry.name)).length,
        hasScores: roundHasAnyScore(state, roundIndex, round),
      },
    ];
  }
  const rooms = [...new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])))];
  return rooms
    .sort((first, second) => first - second)
    .map((room) => {
      const members = assignments.filter((entry) => entry.room === room);
      const scores = members.map((_, position) => getUnitScore(state, roundIndex, room, position, null));
      return {
        name: `Room ${roomLetter(room)}`,
        players: members.length,
        scored: scores.filter((value) => value !== null).length,
        hasScores: Object.entries(state.scores).some(
          ([key, value]) => key.startsWith(`r${roundIndex}-rm${room}-`) && value !== null,
        ),
      };
    });
}

function roundProgress(rooms: RoomProgress[]): { text: string; fraction: number } {
  if (rooms.length === 0) return { text: 'in progress', fraction: 0 };
  if (rooms.length === 1) {
    const [room] = rooms;
    return {
      text: room.scored === room.players ? 'all scores in' : `${room.scored} of ${room.players} scores in`,
      fraction: room.players ? room.scored / room.players : 0,
    };
  }
  const full = rooms.filter((room) => room.scored === room.players).length;
  return {
    text:
      full === rooms.length
        ? `all ${plural(rooms.length, 'room')} scored`
        : `${full} of ${rooms.length} rooms scored`,
    fraction: full / rooms.length,
  };
}

/** Where a running tournament stands: each round's state, and how far the current round is scored. */
export function progressSummary(state: TournamentState): ProgressSummary {
  const labels = bracketRoundLabels(state).map((entry) => entry.label);
  const finished = computeRankings(state)?.finalComplete ?? false;
  const rooms = roomsOf(state, state.curRound);
  const stages = labels.map((name, index): ProgressStage => {
    if (index < state.curRound) return { name, state: 'done' };
    if (index > state.curRound) return { name, state: 'upcoming' };
    return { name, state: finished ? 'done' : 'now' };
  });
  const roundName = labels[state.curRound] ?? '';
  if (finished) return { roundName, text: `${roundName} · complete`, fraction: 1, stages, rooms };
  const { text, fraction } = roundProgress(rooms);
  return { roundName, text: `${roundName} · ${text}`, fraction, stages, rooms };
}
