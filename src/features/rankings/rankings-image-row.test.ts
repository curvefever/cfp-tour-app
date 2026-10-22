import { describe, expect, it } from 'vitest';
import { wrapRow } from './rankings-image-row';
import type { ImageRow } from './rankings-image-rows';

/** A canvas context whose text is 10 wide per character. */
const context = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 10 }),
} as unknown as CanvasRenderingContext2D;

const row = (overrides: Partial<ImageRow>): ImageRow => ({
  rank: '4',
  name: 'Team Rocket',
  where: 'Semis',
  members: null,
  ...overrides,
});

describe('wrapRow', () => {
  // A 300 wide column: the name gets 300 - 52 - 12 - 50 ("Semis") - 12 = 174, the members 300 - 52 - 12 = 236.
  it('gives the members the width under the "where" text too: 23 characters stay on one line', () => {
    const wrapped = wrapRow(context, row({ members: ['Alpha', 'Bravo', 'Charlie'] }), 300);
    expect(wrapped.memberLines).toEqual(['Alpha · Bravo · Charlie']);
  });

  it('keeps the name to the narrower width beside the "where" text', () => {
    const wrapped = wrapRow(context, row({ name: 'Slithering Snakes Doom' }), 300);
    expect(wrapped.nameLines).toEqual(['Slithering Snakes', 'Doom']);
  });

  it('wraps members that do not fit the full width between members', () => {
    const wrapped = wrapRow(context, row({ members: ['Alpha', 'Bravo', 'Charlie', 'Delta'] }), 300);
    expect(wrapped.memberLines).toEqual(['Alpha · Bravo · Charlie', 'Delta']);
  });

  it('has no member lines for a player', () => {
    expect(wrapRow(context, row({}), 300).memberLines).toEqual([]);
  });
});
