export const IMAGE_COLUMNS = 3;
const PADDING = 32;
const COLUMN_GAP = 24;
const HEADER_HEIGHT = 112;
const ROW_HEIGHT = 36;
const ROW_GAP = 2;
const PODIUM_GAP_ABOVE = 30;
const LIST_GAP_ABOVE = 32;
const CARD_WIDTH = 300;
const CARD_GAP = 18;

// The podium card's inside, top to bottom: a medal bar, padding, the lines (each as high as its line height) and padding.
const CARD_BAR = 10;
const CARD_LINE_GAP = 6;
const NAME_LINE = 29;
const SMALL_LINE = 18;
const CARD_PADDING = {
  first: { top: 26, bottom: 28, ordinal: 52 },
  other: { top: 18, bottom: 20, ordinal: 40 },
};

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

/** What the layout needs of a podium card: how tall it is (see `podiumCardHeight`). */
export interface PodiumSize {
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RankingsImageLayout<T> {
  /** The height of the image: the header, the podium, the longest column and the margin under it. */
  height: number;
  padding: number;
  /** The block at the top: the logo's place, which the title lines are centred on. */
  header: { x: number; y: number; height: number };
  /** The podium cards in the order given, bottoms aligned; empty without a podium. */
  podium: Box[];
  cells: PlacedRow<T>[];
}

/** The height of a podium card: the first place stands taller, a team shows its members under the name. */
export function podiumCardHeight({ first, hasMembers }: { first: boolean; hasMembers: boolean }): number {
  const { top, bottom, ordinal } = first ? CARD_PADDING.first : CARD_PADDING.other;
  const lines = [ordinal, NAME_LINE, ...(hasMembers ? [SMALL_LINE] : []), SMALL_LINE];
  const gaps = (lines.length - 1) * CARD_LINE_GAP;
  return CARD_BAR + top + lines.reduce((sum, line) => sum + line, 0) + gaps + bottom;
}

/** How many rows each column takes when they fill column by column: the first columns take the extra ones. */
function columnLengths(count: number, columns: number): number[] {
  const base = Math.floor(count / columns);
  const extra = count % columns;
  return Array.from({ length: columns }, (_, column) => base + (column < extra ? 1 : 0));
}

/** The cards side by side, centred on the image, their bottoms on the line `top + tallest height`. */
function placePodium(sizes: readonly PodiumSize[], width: number, top: number): Box[] {
  const total = sizes.length * CARD_WIDTH + Math.max(0, sizes.length - 1) * CARD_GAP;
  const bottom = top + Math.max(0, ...sizes.map((size) => size.height));
  return sizes.map((size, index) => ({
    x: (width - total) / 2 + index * (CARD_WIDTH + CARD_GAP),
    y: bottom - size.height,
    width: CARD_WIDTH,
    height: size.height,
  }));
}

/**
 * Where each part of the rankings image goes: the header, the podium cards when there are any, and the rows, which
 * fill the columns one after the other as the page's columns do. The list starts a fixed gap under the podium (the
 * header without one) and the image is as tall as the longest column needs.
 */
export function rankingsImageLayout<T>(
  rows: readonly T[],
  {
    columns = IMAGE_COLUMNS,
    width,
    podium: podiumSizes = [],
  }: { columns?: number; width: number; podium?: readonly PodiumSize[] },
): RankingsImageLayout<T> {
  const header = { x: PADDING, y: PADDING, height: HEADER_HEIGHT };
  const headerBottom = header.y + header.height;
  const podium = placePodium(podiumSizes, width, headerBottom + PODIUM_GAP_ABOVE);
  const aboveList = Math.max(headerBottom, ...podium.map((card) => card.y + card.height));
  const listTop = aboveList + LIST_GAP_ABOVE;
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
        y: listTop + slot * (ROW_HEIGHT + ROW_GAP),
        width: columnWidth,
        height: ROW_HEIGHT,
      });
      index++;
    }
  });
  const longest = Math.max(0, ...lengths);
  const listHeight = longest ? longest * (ROW_HEIGHT + ROW_GAP) - ROW_GAP : 0;
  return { height: listTop + listHeight + PADDING, padding: PADDING, header, podium, cells };
}
