export const IMAGE_COLUMNS = 3;
export const PADDING = 32;
const COLUMN_GAP = 24;
export const HEADER_HEIGHT = 112;
export const ROW_HEIGHT = 36;
/** What a row grows by for each further line of its name (the 15 px name font) and for each line of members (13 px). */
export const ROW_NAME_LINE = 19;
export const ROW_MEMBER_LINE = 17;
const ROW_GAP = 2;
const PODIUM_GAP_ABOVE = 30;
const LIST_GAP_ABOVE = 32;
export const CARD_WIDTH = 300;
const CARD_GAP = 18;

/** The lines of the header's text block: the label, the title (one or more lines) and the date line. */
export const MASTHEAD_LINES = { label: 16, title: 40, date: 22, gap: 6 };

/** How tall the text block is with this many title lines. */
export function mastheadTextHeight(titleLines: number): number {
  const { label, title, date, gap } = MASTHEAD_LINES;
  return label + titleLines * title + date + 2 * gap;
}

// The podium card's inside, top to bottom: a medal bar, padding, the lines and padding.
const CARD_BAR = 10;
const CARD_LINE_GAP = 6;
export const NAME_LINE = 29;
export const SMALL_LINE = 18;
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

/** How many lines a row's name and its members take once wrapped (a player has no members). */
export interface RowLines {
  nameLines: number;
  memberLines: number;
}

const SINGLE_LINE: RowLines = { nameLines: 1, memberLines: 0 };

/** A row's height: `ROW_HEIGHT` for one name line and no members, more for each further line. */
export function rowHeight({ nameLines, memberLines }: RowLines): number {
  return ROW_HEIGHT + (Math.max(1, nameLines) - 1) * ROW_NAME_LINE + memberLines * ROW_MEMBER_LINE;
}

/** The width of one column of rows, which the drawing code wraps a row's name and members to. */
export function imageColumnWidth(width: number, columns = IMAGE_COLUMNS): number {
  return (width - 2 * PADDING - (columns - 1) * COLUMN_GAP) / columns;
}

export interface RankingsImageLayout<T> {
  /** The height of the image: the header, the podium, the longest column and the margin under it. */
  height: number;
  padding: number;
  /** The block at the top: as tall as the text block needs, and at least the logo's `HEADER_HEIGHT`. */
  header: { x: number; y: number; height: number };
  /** The podium cards in the order given, bottoms aligned; empty without a podium. */
  podium: Box[];
  cells: PlacedRow<T>[];
}

/** What a podium card is made of, for placing its lines and for its height. */
export interface PodiumCardMetrics {
  barHeight: number;
  paddingTop: number;
  paddingBottom: number;
  lineGap: number;
  /** The height of each block, top to bottom: the ordinal, the name, the members (a team only), the Final line. */
  lines: number[];
}

/** What a podium card's height depends on: its place and how many lines its name and its members wrapped to. */
export interface PodiumCardKind {
  first: boolean;
  nameLines: number;
  /** 0 for a player. */
  memberLines: number;
}

/** The first place stands taller; a wrapped name or member block is as many lines tall, with no gap between them. */
export function podiumCardMetrics({ first, nameLines, memberLines }: PodiumCardKind): PodiumCardMetrics {
  const { top, bottom, ordinal } = first ? CARD_PADDING.first : CARD_PADDING.other;
  return {
    barHeight: CARD_BAR,
    paddingTop: top,
    paddingBottom: bottom,
    lineGap: CARD_LINE_GAP,
    lines: [
      ordinal,
      Math.max(1, nameLines) * NAME_LINE,
      ...(memberLines > 0 ? [memberLines * SMALL_LINE] : []),
      SMALL_LINE,
    ],
  };
}

/** The height of a podium card. */
export function podiumCardHeight(kind: PodiumCardKind): number {
  const { barHeight, paddingTop, paddingBottom, lineGap, lines } = podiumCardMetrics(kind);
  const text = lines.reduce((sum, line) => sum + line, 0) + (lines.length - 1) * lineGap;
  return barHeight + paddingTop + text + paddingBottom;
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
 * header without one) and the image is as tall as the longest column needs. `titleLines` and `rowLines` say how many
 * lines the title and each row wrapped to; without them everything is one line.
 */
export function rankingsImageLayout<T>(
  rows: readonly T[],
  {
    columns = IMAGE_COLUMNS,
    width,
    podium: podiumSizes = [],
    titleLines = 1,
    rowLines = () => SINGLE_LINE,
  }: {
    columns?: number;
    width: number;
    podium?: readonly PodiumSize[];
    titleLines?: number;
    rowLines?: (row: T) => RowLines;
  },
): RankingsImageLayout<T> {
  const header = {
    x: PADDING,
    y: PADDING,
    height: Math.max(HEADER_HEIGHT, mastheadTextHeight(titleLines)),
  };
  const headerBottom = header.y + header.height;
  const podium = placePodium(podiumSizes, width, headerBottom + PODIUM_GAP_ABOVE);
  const aboveList = Math.max(headerBottom, ...podium.map((card) => card.y + card.height));
  const listTop = aboveList + LIST_GAP_ABOVE;
  const columnWidth = imageColumnWidth(width, columns);
  const cells: PlacedRow<T>[] = [];
  let index = 0;
  let listHeight = 0;
  columnLengths(rows.length, columns).forEach((length, column) => {
    let y = listTop;
    for (let slot = 0; slot < length; slot++) {
      const height = rowHeight(rowLines(rows[index]));
      cells.push({
        row: rows[index],
        index,
        column,
        x: PADDING + column * (columnWidth + COLUMN_GAP),
        y,
        width: columnWidth,
        height,
      });
      y += height + ROW_GAP;
      index++;
    }
    if (length) listHeight = Math.max(listHeight, y - ROW_GAP - listTop);
  });
  return { height: listTop + listHeight + PADDING, padding: PADDING, header, podium, cells };
}
