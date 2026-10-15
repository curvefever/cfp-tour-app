export const IMAGE_COLUMNS = 3;
const PADDING = 32;
const COLUMN_GAP = 24;
const HEADER_HEIGHT = 112;
const ROW_HEIGHT = 36;
const ROW_GAP = 2;

/** One row of the image with the place it is drawn at. */
export interface PlacedRow<T> {
  row: T;
  /** The row's place in the whole list, which sets its ground (they alternate down the list). */
  index: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RankingsImageLayout<T> {
  /** The height of the image: the header, the longest column and the margin under it. */
  height: number;
  padding: number;
  cells: PlacedRow<T>[];
}

/** How many rows each column takes when they fill column by column: the first columns take the extra ones. */
function columnLengths(count: number, columns: number): number[] {
  const base = Math.floor(count / columns);
  const extra = count % columns;
  return Array.from({ length: columns }, (_, column) => base + (column < extra ? 1 : 0));
}

/**
 * Where each row of the rankings image goes: the rows fill the columns one after the other, as the page's columns
 * do, and the image is as tall as the longest column needs.
 */
export function rankingsImageLayout<T>(
  rows: readonly T[],
  { columns = IMAGE_COLUMNS, width }: { columns?: number; width: number },
): RankingsImageLayout<T> {
  const columnWidth = (width - 2 * PADDING - (columns - 1) * COLUMN_GAP) / columns;
  const lengths = columnLengths(rows.length, columns);
  const cells: PlacedRow<T>[] = [];
  let index = 0;
  lengths.forEach((length, column) => {
    for (let slot = 0; slot < length; slot++) {
      cells.push({
        row: rows[index],
        index,
        column,
        x: PADDING + column * (columnWidth + COLUMN_GAP),
        y: HEADER_HEIGHT + slot * (ROW_HEIGHT + ROW_GAP),
        width: columnWidth,
        height: ROW_HEIGHT,
      });
      index++;
    }
  });
  const longest = Math.max(0, ...lengths);
  const listHeight = longest ? longest * (ROW_HEIGHT + ROW_GAP) - ROW_GAP : 0;
  return { height: HEADER_HEIGHT + listHeight + PADDING, padding: PADDING, cells };
}
