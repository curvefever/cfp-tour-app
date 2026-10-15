import { describe, expect, it } from 'vitest';
import { rankingsImageLayout } from './rankings-image-layout';

const rows = (count: number) => Array.from({ length: count }, (_, index) => `row ${index + 1}`);
const columnSizes = (count: number) => {
  const { cells } = rankingsImageLayout(rows(count), { width: 1200 });
  return [0, 1, 2].map((column) => cells.filter((cell) => cell.column === column).length);
};

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
