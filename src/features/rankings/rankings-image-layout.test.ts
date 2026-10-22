import { describe, expect, it } from 'vitest';
import {
  HEADER_HEIGHT,
  NAME_LINE,
  ROW_HEIGHT,
  ROW_MEMBER_LINE,
  ROW_NAME_LINE,
  SMALL_LINE,
  imageColumnWidth,
  mastheadTextHeight,
  podiumCardHeight,
  rankingsImageLayout,
  type RowLines,
} from './rankings-image-layout';

const rows = (count: number) => Array.from({ length: count }, (_, index) => `row ${index + 1}`);
const columnSizes = (count: number) => {
  const { cells } = rankingsImageLayout(rows(count), { width: 1200 });
  return [0, 1, 2].map((column) => cells.filter((cell) => cell.column === column).length);
};

const podiumSizes = [
  { height: podiumCardHeight({ first: false, nameLines: 1, memberLines: 0 }) },
  { height: podiumCardHeight({ first: true, nameLines: 1, memberLines: 0 }) },
  { height: podiumCardHeight({ first: false, nameLines: 1, memberLines: 0 }) },
];

describe('rankingsImageLayout', () => {
  it.each([37, 43, 53, 13, 31, 2, 0])('fills the columns evenly for %i rows', (count) => {
    const sizes = columnSizes(count);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(count);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('puts the extra rows in the first columns (37 → 13, 12, 12)', () => {
    expect(columnSizes(37)).toEqual([13, 12, 12]);
  });

  it('fills column by column: the list runs down the first column, then the next', () => {
    const { cells } = rankingsImageLayout(rows(13), { width: 1200 });
    expect(cells.map((cell) => cell.row)).toEqual(rows(13));
    expect(cells.slice(0, 5).every((cell) => cell.column === 0)).toBe(true);
    expect(cells[5]?.column).toBe(1);
    expect(cells[5]?.y).toBe(cells[0]?.y);
    expect(cells[1]?.y).toBeGreaterThan(cells[0]?.y ?? 0);
  });

  it('makes the image as tall as the longest column needs (37, 43 and 53 rows: 13, 15 and 18 high)', () => {
    const height = (count: number) => rankingsImageLayout(rows(count), { width: 1200 }).height;
    const pitch = 38;
    expect(height(43) - height(37)).toBe(2 * pitch);
    expect(height(53) - height(43)).toBe(3 * pitch);
    expect(height(0)).toBeLessThan(height(1));
  });

  it('keeps every cell inside the image', () => {
    const layout = rankingsImageLayout(rows(53), { width: 1200 });
    for (const cell of layout.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(layout.padding);
      expect(cell.x + cell.width).toBeLessThanOrEqual(1200 - layout.padding + 0.001);
      expect(cell.y + cell.height).toBeLessThanOrEqual(layout.height - layout.padding);
    }
  });
});

describe('rankingsImageLayout with a podium', () => {
  const layoutOf = (count: number, podium = podiumSizes) =>
    rankingsImageLayout(rows(count), { width: 1200, podium });

  it('places the cards in the order given, side by side', () => {
    const { podium } = layoutOf(34);
    expect(podium).toHaveLength(3);
    expect(podium[0]?.x).toBeLessThan(podium[1]?.x ?? 0);
    expect(podium[1]?.x).toBeLessThan(podium[2]?.x ?? 0);
    expect(podium.map((card) => card.height)).toEqual(podiumSizes.map((size) => size.height));
  });

  it('makes the first place the tallest card and lines the bottoms up', () => {
    const { podium } = layoutOf(34);
    const [second, first, third] = podium;
    expect(first?.height).toBeGreaterThan(second?.height ?? Infinity);
    expect(first?.height).toBeGreaterThan(third?.height ?? Infinity);
    const bottoms = podium.map((card) => card.y + card.height);
    expect(new Set(bottoms).size).toBe(1);
  });

  it('centres the row of cards: the left margin equals the right margin', () => {
    const { podium } = layoutOf(34);
    const left = podium[0]?.x ?? 0;
    const last = podium.at(-1);
    expect(left).toBe(1200 - ((last?.x ?? 0) + (last?.width ?? 0)));
  });

  it.each([1, 2])('still centres the row with %i card(s)', (count) => {
    const { podium } = layoutOf(34, podiumSizes.slice(0, count));
    const last = podium.at(-1);
    expect(podium).toHaveLength(count);
    expect(podium[0]?.x).toBe(1200 - ((last?.x ?? 0) + (last?.width ?? 0)));
  });

  it('starts the list exactly 32 below the lowest card', () => {
    const { podium, cells } = layoutOf(34);
    const lowest = Math.max(...podium.map((card) => card.y + card.height));
    expect(cells[0]?.y).toBe(lowest + 32);
  });

  it('starts the list exactly 32 below the header without a podium', () => {
    const { header, cells, podium } = rankingsImageLayout(rows(34), { width: 1200 });
    expect(podium).toEqual([]);
    expect(cells[0]?.y).toBe(header.y + header.height + 32);
  });

  it('keeps the podium 30 below the header and the header at the padding', () => {
    const { header, podium, padding } = layoutOf(34);
    expect([header.x, header.y]).toEqual([padding, padding]);
    const tallest = Math.min(...podium.map((card) => card.y));
    expect(tallest).toBe(header.y + header.height + 30);
  });

  it('makes a team card with members taller than one without', () => {
    expect(podiumCardHeight({ first: false, nameLines: 1, memberLines: 1 })).toBeGreaterThan(
      podiumCardHeight({ first: false, nameLines: 1, memberLines: 0 }),
    );
    expect(podiumCardHeight({ first: true, nameLines: 1, memberLines: 1 })).toBeGreaterThan(
      podiumCardHeight({ first: true, nameLines: 1, memberLines: 0 }),
    );
  });

  it('puts the podium cards on a team podium at their own heights, the tallest setting the line', () => {
    const sizes = [
      { height: podiumCardHeight({ first: false, nameLines: 1, memberLines: 1 }) },
      { height: podiumCardHeight({ first: true, nameLines: 1, memberLines: 0 }) },
      { height: podiumCardHeight({ first: false, nameLines: 1, memberLines: 0 }) },
    ];
    const { podium } = layoutOf(34, sizes);
    expect(new Set(podium.map((card) => card.y + card.height)).size).toBe(1);
    expect(podium.map((card) => card.height)).toEqual(sizes.map((size) => size.height));
  });

  it.each([31, 37, 43, 53])('fits every cell inside the image with a podium and %i rows', (count) => {
    const layout = layoutOf(count);
    expect(layout.cells).toHaveLength(count);
    const lowest = Math.max(...layout.podium.map((card) => card.y + card.height));
    for (const cell of layout.cells) {
      expect(cell.y).toBeGreaterThanOrEqual(lowest + 32);
      expect(cell.y + cell.height).toBeLessThanOrEqual(layout.height - layout.padding);
    }
    const lastBottom = Math.max(...layout.cells.map((cell) => cell.y + cell.height));
    expect(lastBottom).toBe(layout.height - layout.padding);
  });
});

describe('rankingsImageLayout with wrapped lines', () => {
  const kind = (nameLines: number, memberLines: number, first = false) => ({ first, nameLines, memberLines });
  const rowsOf = (count: number) => rows(count);
  const withLines = (count: number, lines: Record<string, RowLines>, extra = {}) =>
    rankingsImageLayout(rowsOf(count), {
      width: 1200,
      rowLines: (row) => lines[row] ?? { nameLines: 1, memberLines: 0 },
      ...extra,
    });

  it('makes a podium card taller by exactly one name line for each extra line of its name', () => {
    expect(podiumCardHeight(kind(2, 0)) - podiumCardHeight(kind(1, 0))).toBe(NAME_LINE);
    expect(podiumCardHeight(kind(3, 0)) - podiumCardHeight(kind(1, 0))).toBe(2 * NAME_LINE);
  });

  it('makes a podium card taller by one small line for each extra line of its members', () => {
    expect(podiumCardHeight(kind(1, 2)) - podiumCardHeight(kind(1, 1))).toBe(SMALL_LINE);
    expect(podiumCardHeight(kind(1, 4)) - podiumCardHeight(kind(1, 1))).toBe(3 * SMALL_LINE);
  });

  it('keeps the bottoms of the cards aligned when their heights differ', () => {
    const sizes = [
      { height: podiumCardHeight(kind(2, 2)) },
      { height: podiumCardHeight(kind(1, 3, true)) },
      { height: podiumCardHeight(kind(3, 0)) },
    ];
    const { podium } = rankingsImageLayout(rowsOf(34), { width: 1200, podium: sizes });
    expect(new Set(podium.map((card) => card.y + card.height)).size).toBe(1);
    expect(podium.map((card) => card.height)).toEqual(sizes.map((size) => size.height));
  });

  it('gives a row of one line and no members the old height, and each further line its own', () => {
    const [plain, wrapped, team] = rankingsImageLayout(rowsOf(3), {
      width: 1200,
      rowLines: (row) =>
        ({ 'row 1': { nameLines: 1, memberLines: 0 }, 'row 2': { nameLines: 3, memberLines: 0 } })[row] ?? {
          nameLines: 1,
          memberLines: 2,
        },
    }).cells;
    expect(plain?.height).toBe(ROW_HEIGHT);
    expect(wrapped?.height).toBe(ROW_HEIGHT + 2 * ROW_NAME_LINE);
    expect(team?.height).toBe(ROW_HEIGHT + 2 * ROW_MEMBER_LINE);
  });

  it('pushes the rest of its column down when a row wraps, and leaves the other columns alone', () => {
    const plain = rankingsImageLayout(rowsOf(13), { width: 1200 }).cells;
    const tall = withLines(13, { 'row 2': { nameLines: 3, memberLines: 0 } }).cells;
    const shift = 2 * ROW_NAME_LINE;
    plain.forEach((cell, index) => {
      const moved = cell.column === 0 && index > 1 ? shift : 0;
      expect(tall[index]?.y).toBe(cell.y + moved);
    });
  });

  it('is as tall as the tallest column: a taller shorter column grows the image only when it passes the longest', () => {
    const height = (lines: Record<string, RowLines>) => withLines(13, lines).height;
    const base = height({});
    // Column 1 (rows 6-9) holds 4 rows against column 0's 5: one extra line still leaves it shorter.
    expect(height({ 'row 7': { nameLines: 2, memberLines: 0 } })).toBe(base);
    // Four member lines on a row of column 1 make it the tallest.
    const grown = height({ 'row 7': { nameLines: 1, memberLines: 4 } });
    expect(grown - base).toBe(4 * ROW_MEMBER_LINE - ROW_HEIGHT - 2);
  });

  it('makes the header as tall as its text needs: the logo height for a one-line title, more for two', () => {
    const one = rankingsImageLayout(rowsOf(34), { width: 1200, titleLines: 1, podium: podiumSizes });
    const two = rankingsImageLayout(rowsOf(34), { width: 1200, titleLines: 2, podium: podiumSizes });
    expect(one.header.height).toBe(HEADER_HEIGHT);
    expect(HEADER_HEIGHT).toBe(112);
    expect(two.header.height).toBe(mastheadTextHeight(2));
    expect(two.header.height).toBe(130);
    const shift = two.header.height - one.header.height;
    expect(two.podium[0]?.y).toBe((one.podium[0]?.y ?? 0) + shift);
    expect(two.cells[0]?.y).toBe((one.cells[0]?.y ?? 0) + shift);
    expect(two.height).toBe(one.height + shift);
  });

  it('lays out one-line rows without members exactly as before: 112 header, 38 pitch from the list top', () => {
    const plain = rankingsImageLayout(rowsOf(37), { width: 1200 });
    const explicit = rankingsImageLayout(rowsOf(37), {
      width: 1200,
      titleLines: 1,
      rowLines: () => ({ nameLines: 1, memberLines: 0 }),
    });
    expect(explicit).toEqual(plain);
    expect(plain.header).toEqual({ x: 32, y: 32, height: 112 });
    expect(plain.cells[0]?.y).toBe(32 + 112 + 32);
    expect(plain.cells[1]?.y).toBe(32 + 112 + 32 + 38);
    expect(plain.height).toBe(32 + 112 + 32 + 13 * 38 - 2 + 32);
  });

  it('exposes the column width the drawing code wraps to', () => {
    expect(imageColumnWidth(1200)).toBe((1200 - 64 - 48) / 3);
    expect(rankingsImageLayout(rowsOf(3), { width: 1200 }).cells[0]?.width).toBe(imageColumnWidth(1200));
  });
});
