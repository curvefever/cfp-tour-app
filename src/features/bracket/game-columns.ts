import { roomGameColumns } from '../../domain/tournament/game-columns';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { isCurrentRound } from '../../domain/tournament/round-columns';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';

/** The width of a round column without game columns (and of every standings column): a place, a name, a result and perhaps points. */
export const ROUND_COLUMN_WIDTH = 330;

/** What a game column takes beside the others: its 38 px cell and the 8 px gap before it. */
const GAME_COLUMN_WIDTH = 46;

/** At most this many game columns (the shared one of the games not played included) are in view; a room with more scrolls sideways. */
export const MAX_GAME_COLUMNS_IN_VIEW = 4;

/** What the row keeps for everything but the game columns: the pinned name (a name of 16 characters) and the pinned result. */
const ROW_BASE_WIDTH = 260;

/** The points column beside the result of a pooling room. */
const POINTS_WIDTH = 44;

/** Whether the rooms of a round show the points each place earned: a pooling round that counts toward the standings. */
export function showsPoints(state: TournamentState, roundIndex: number): boolean {
  const rule = roundExitRule(state, roundIndex);
  return (
    (rule.kind === 'standings' && rule.counted) ||
    (rule.kind === 'standings-cutoff' && !state.rounds[roundIndex].excludeFromStandings)
  );
}

/** Whether a room card shows a column per game: not the Final (its own view), and not while its rows take the score inputs. */
export function roomShowsGameColumns(round: TournamentRound, rowsEditable: boolean): boolean {
  return !rowsEditable && !round.isFinal && (round.numGames ?? 1) > 1;
}

/**
 * How many game columns the widest card of a round really shows: none for a round not drawn yet (the expected and
 * projected rounds show names only), and for rooms whose rows take the score inputs; the Final always shows them.
 */
function gameColumnCount(state: TournamentState, roundIndex: number, editable: boolean): number {
  const round = state.rounds[roundIndex];
  if (!(state.assignments[roundIndex]?.length ?? 0)) return 0;
  if (round.isFinal) return roomGameColumns(state, roundIndex, 1).length;
  if (!roomShowsGameColumns(round, editable && isCurrentRound(state, roundIndex))) return 0;
  return Math.max(0, ...round.rooms.map((_, room) => roomGameColumns(state, roundIndex, room + 1).length));
}

/**
 * The width of a round column: 330 px, or wide enough for the game columns its cards show (at most
 * `MAX_GAME_COLUMNS_IN_VIEW`; the rest scroll inside the card), the names keeping their room beside them.
 */
export function roundColumnWidth(state: TournamentState, roundIndexes: number[], editable: boolean): number {
  const columns = Math.max(0, ...roundIndexes.map((index) => gameColumnCount(state, index, editable)));
  if (columns === 0) return ROUND_COLUMN_WIDTH;
  const shown = Math.min(columns, MAX_GAME_COLUMNS_IN_VIEW);
  const points = roundIndexes.some((index) => showsPoints(state, index)) ? POINTS_WIDTH : 0;
  return Math.max(ROUND_COLUMN_WIDTH, ROW_BASE_WIDTH + points + GAME_COLUMN_WIDTH * shown);
}

/** A card with game columns scrolls sideways inside itself, on every screen width; the names stay on the left, the result on the right. */
export const scrollableCardClass = 'overflow-x-auto';

/** The rows of a scrollable card: as wide as the game columns need, at least the card's width. */
export const scrollableRowsClass = 'w-max min-w-full';

/** The lead of a row (place, stripe, name) and of the header above it: fixed on the left while the game columns scroll under it. */
export const stickyLeadClass = 'sticky left-0 z-1 -ml-3 w-48 shrink-0 grow bg-inherit pl-3 max-[700px]:w-40';

/** The end of a row (the result, the points) and of the header above it: fixed on the right. */
export const stickyEndClass = 'sticky right-0 z-1 -mr-3 shrink-0 bg-inherit pr-3';
