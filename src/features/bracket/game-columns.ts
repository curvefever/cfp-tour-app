import { isCurrentRound } from '../../domain/tournament/round-columns';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';

/** The width of a round column with one game (and of every standings column): a place, a name, a result and perhaps points. */
export const ROUND_COLUMN_WIDTH = 330;

/** What a game column takes beside the others: its 38 px cell and the 8 px gap before it. */
const GAME_COLUMN_WIDTH = 46;

/** What the row keeps for everything but the game columns: the place, the stripe, a name of 16 characters, the result and the points. */
const ROW_BASE_WIDTH = 270;

/** Whether the rooms of a round show a column per game (the Final always does; a room does unless its rows take the score inputs). */
function showsGameColumns(state: TournamentState, roundIndex: number, editable: boolean): boolean {
  const round = state.rounds[roundIndex];
  if ((round.numGames ?? 1) <= 1) return false;
  return round.isFinal || !(editable && isCurrentRound(state, roundIndex));
}

/**
 * The width of a round column on a desktop: wide enough for its widest room, the names keeping their room beside the
 * game columns. A phone keeps the page's width and scrolls the game columns inside the card (`scrollableCardClass`).
 */
export function roundColumnWidth(state: TournamentState, roundIndexes: number[], editable: boolean): number {
  const widest = Math.max(
    0,
    ...roundIndexes.map((roundIndex) =>
      showsGameColumns(state, roundIndex, editable)
        ? ROW_BASE_WIDTH + GAME_COLUMN_WIDTH * (state.rounds[roundIndex].numGames ?? 1)
        : 0,
    ),
  );
  return Math.max(ROUND_COLUMN_WIDTH, widest);
}

/** On a phone, a card with game columns scrolls sideways inside itself; the names stay (`stickyLeadClass`). */
export const scrollableCardClass = 'max-[700px]:overflow-x-auto';

/** The rows of a scrollable card: as wide as the game columns need, at least the card's width. */
export const scrollableRowsClass = 'max-[700px]:w-max max-[700px]:min-w-full';

/** The lead of a row (place, stripe, name) and of the header above it: fixed on a phone while the game columns scroll under it. */
export const stickyLeadClass = cn(
  'max-[700px]:sticky max-[700px]:left-0 max-[700px]:z-1 max-[700px]:-ml-3 max-[700px]:w-43',
  'max-[700px]:shrink-0 max-[700px]:bg-inherit max-[700px]:pl-3',
);
