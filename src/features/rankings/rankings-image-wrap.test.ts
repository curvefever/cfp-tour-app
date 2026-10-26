import { describe, expect, it } from 'vitest';
import { wrapMembers, wrapText, type Measure } from './rankings-image-wrap';

/** Every character is 10 wide, so a width of 100 holds 10 characters. */
const measure: Measure = (text) => text.length * 10;

describe('wrapText', () => {
  it('leaves a text that fits on one line unchanged', () => {
    expect(wrapText(measure, 'Night Owls', 100, 3)).toEqual(['Night Owls']);
  });

  it('breaks at spaces', () => {
    expect(wrapText(measure, 'Night Owls Esports', 100, 3)).toEqual(['Night Owls', 'Esports']);
  });

  it('ends a single word wider than the line with an ellipsis, on a line of its own', () => {
    const lines = wrapText(measure, 'Hi TheLongestTeamName', 100, 3);
    expect(lines).toEqual(['Hi', 'TheLonges…']);
    expect(lines.every((line) => measure(line) <= 100)).toBe(true);
  });

  it('cuts the last allowed line with an ellipsis when the text needs more lines', () => {
    const lines = wrapText(measure, 'aa bb cc dd ee ff', 50, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('aa bb');
    expect(lines[1]).toMatch(/…$/);
    expect(measure(lines[1])).toBeLessThanOrEqual(50);
  });

  it('never cuts inside an emoji, a flag or an accented letter', () => {
    const family = '👨‍👩‍👧';
    const flag = '🇫🇷';
    const accented = 'é';
    // A cut by code units would end these lines with a piece of the symbol, still within the width.
    const cutAt = (symbol: string) => wrapText(measure, `abcdefgh${symbol}ij`, 100, 1)[0];
    expect(cutAt(family)).toBe('abcdefgh…');
    expect(cutAt(flag)).toBe('abcdefgh…');
    expect(cutAt(accented)).toBe('abcdefgh…');
  });

  it('is empty for an empty text', () => {
    expect(wrapText(measure, '', 100, 3)).toEqual([]);
    expect(wrapText(measure, '   ', 100, 3)).toEqual([]);
  });
});

describe('wrapMembers', () => {
  it('keeps members that fit on one line, joined with the separator', () => {
    expect(wrapMembers(measure, ['A', 'B', 'C'], 100, 4)).toEqual(['A · B · C']);
  });

  it('breaks only between members: no member is split, no line starts or ends with the separator', () => {
    const lines = wrapMembers(measure, ['Alpha', 'Bravo', 'Charlie'], 130, 4);
    expect(lines).toEqual(['Alpha · Bravo', 'Charlie']);
    for (const line of lines) expect(line).not.toMatch(/^ ?·|· ?$/);
  });

  it('wraps a member wider than a line at its own spaces, on lines of its own', () => {
    expect(wrapMembers(measure, ['Ann', 'Sir Wiggles the Third', 'Bo'], 100, 6)).toEqual([
      'Ann',
      'Sir',
      'Wiggles',
      'the Third',
      'Bo',
    ]);
  });

  it('cuts the last allowed line with an ellipsis beyond the limit', () => {
    expect(wrapMembers(measure, ['aaaa', 'bbbb', 'cccc', 'dddd'], 50, 2)).toEqual(['aaaa', 'bbbb…']);
  });

  it('is empty without members', () => {
    expect(wrapMembers(measure, [], 100, 4)).toEqual([]);
  });
});
