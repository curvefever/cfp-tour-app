import { roomMatch, type RoomMatch } from './match-format';
import type { TournamentState } from './types';

/**
 * A column of a room's score table: one game played, or the games not played yet, which share one column
 * (`from`-`to`; `decided` once the match is over, so they will never be played).
 */
export type GameColumn =
  { kind: 'game'; game: number } | { kind: 'rest'; from: number; to: number; decided: boolean };

/** The label over a column: "G2", "G4–5" for the games left, "G3" when only one is left. */
export function gameColumnLabel(column: GameColumn): string {
  if (column.kind === 'game') return `G${column.game}`;
  return column.from === column.to ? `G${column.from}` : `G${column.from}–${column.to}`;
}

const gameColumns = (from: number, to: number): GameColumn[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => ({ kind: 'game', game: from + index }));

/** The last game with a score typed, whichever units have it: the game being played shows its column. */
function lastTypedGame(match: RoomMatch): number {
  let last = 0;
  for (const unit of match.units) {
    unit.perGame.forEach((score, index) => {
      if (score !== null) last = Math.max(last, index + 1);
    });
  }
  return last;
}

/** How many games of a Best-of room count as played: up to the deciding game, else every game with a score. */
function playedGames(match: RoomMatch): number {
  return match.decidingGame ?? Math.max(match.countedGames, lastTypedGame(match));
}

/**
 * The columns a room's score table shows (the Final is one room, `room` 1): none for a round of one game (a Final of
 * one game shows its game). A round of summed games has all its games planned, so all show. A Best-of room shows a
 * column per game played and the games after them in one column, none when every game was played.
 */
export function roomGameColumns(state: TournamentState, roundIndex: number, room: number): GameColumn[] {
  const round = state.rounds[roundIndex];
  const games = round?.numGames ?? 1;
  if (games <= 1) return round?.isFinal ? gameColumns(1, 1) : [];
  const match = roomMatch(state, roundIndex, room);
  if (!match) return gameColumns(1, games);
  const played = playedGames(match);
  if (played >= games) return gameColumns(1, games);
  return [
    ...gameColumns(1, played),
    { kind: 'rest', from: played + 1, to: games, decided: match.decidingGame !== null },
  ];
}
