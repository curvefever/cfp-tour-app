import { describe, expect, it } from 'vitest';
import { buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import {
  MIN_CARD_WIDTH,
  schedulePictureLayout,
  wrapLine,
  type Box,
  type Measure,
  type PictureLayout,
} from './schedule-picture-layout';
import { MOCKUP_GRAPH, modelOf } from './schedule-picture-test-support';
import type { SchedulePictureModel } from './schedule-picture-types';

/** Seven pixels a character, whatever the font. */
const measure: Measure = (text) => text.length * 7;

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;

function overlap(first: Box, second: Box): boolean {
  return (
    first.x < right(second) && second.x < right(first) && first.y < bottom(second) && second.y < bottom(first)
  );
}

const layoutOf = (model: SchedulePictureModel): PictureLayout => schedulePictureLayout(model, measure);

const mockup = () => modelOf(buildQualWaterfall(55, MOCKUP_GRAPH, { qualAdv: '37' }, { columns: true }));

describe('wrapLine', () => {
  it('breaks between words and keeps a word wider than the line whole', () => {
    expect(wrapLine(measure, 'poolingLine', 'aaa bbb ccc ddd', 28)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
    expect(wrapLine(measure, 'poolingLine', 'aaa bbb ccc ddd', 56)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(wrapLine(measure, 'poolingLine', 'extraordinarily long', 40)).toEqual(['extraordinarily', 'long']);
  });
});

describe.each([
  ['the layered bracket at 31', () => modelOf(built(31))],
  ['the layered bracket at 43', () => modelOf(built(43))],
  ['the 20 November mockup', mockup],
])('the layout of %s', (_name, model) => {
  const picture = model();
  const layout = layoutOf(picture);

  it('puts every card at the top of its row, each row as tall as its tallest card', () => {
    const rows = new Map<number, typeof layout.cards>();
    picture.cards.forEach((card, index) => {
      rows.set(card.row, [...(rows.get(card.row) ?? []), layout.cards[index]]);
    });
    const ordered = [...rows.entries()].sort(([first], [second]) => first - second);
    ordered.forEach(([, cards], index) => {
      expect(new Set(cards.map((card) => card.box.y)).size).toBe(1);
      if (index === 0) return;
      const [, above] = ordered[index - 1];
      const tallest = Math.max(...above.map((card) => card.box.height));
      expect(cards[0].box.y).toBe(above[0].box.y + tallest + 20);
    });
  });

  it('draws no two boxes over each other', () => {
    const boxes = layout.cards.map((card) => card.box);
    if (layout.pooling) boxes.push(layout.pooling.box);
    boxes.forEach((first, index) => {
      boxes.slice(index + 1).forEach((second) => expect(overlap(first, second)).toBe(false));
    });
    for (const card of layout.cards) {
      const blocks = card.groups.flatMap((group) => group.blocks.map((block) => block.box));
      blocks.forEach((block, index) => {
        expect(block.y).toBeGreaterThanOrEqual(bottom(card.subBox));
        expect(bottom(block)).toBeLessThanOrEqual(bottom(card.box));
        blocks.slice(index + 1).forEach((other) => expect(overlap(block, other)).toBe(false));
      });
    }
  });

  it('gives every card the same width, wide enough for its widest line', () => {
    expect(layout.cardWidth).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
    for (const card of layout.cards) {
      expect(card.box.width).toBe(layout.cardWidth);
      for (const text of card.texts) {
        if (text.align === 'left')
          expect(text.x + measure(text.text, text.font)).toBeLessThanOrEqual(right(card.box));
        else expect(text.x - measure(text.text, text.font)).toBeGreaterThanOrEqual(card.box.x);
      }
      for (const block of card.groups.flatMap((group) => group.blocks)) {
        for (const text of block.texts) {
          expect(text.x + measure(text.text, text.font)).toBeLessThanOrEqual(right(card.box));
        }
      }
    }
  });

  it('keeps the whole picture inside the canvas', () => {
    for (const card of layout.cards) {
      expect(right(card.box)).toBeLessThanOrEqual(layout.width);
      expect(bottom(card.box)).toBeLessThanOrEqual(layout.height);
    }
    if (layout.pooling) expect(bottom(layout.pooling.box)).toBeLessThanOrEqual(layout.height);
  });
});

describe('the pooling block and the canvas', () => {
  it('draws the pooling block in the first column and the bracket columns after it', () => {
    const layout = layoutOf(modelOf(built(31)));
    expect(layout.pooling?.box.x).toBe(20);
    expect(Math.min(...layout.cards.map((card) => card.box.x))).toBe(20 + layout.cardWidth + 44);
  });

  it('does not push the rows down, and the canvas is as tall as the taller of the two', () => {
    const model = modelOf(built(31));
    const long = {
      ...model.pooling!,
      lines: [...model.pooling!.lines, ...Array(12).fill('Round 2: a long note about the lobby')],
    };
    const plain = layoutOf(model);
    const tall = layoutOf({ ...model, pooling: long });
    expect(tall.cards.map((card) => card.box.y)).toEqual(plain.cards.map((card) => card.box.y));
    expect(tall.height).toBe(bottom(tall.pooling!.box) + 20);
    expect(tall.height).toBeGreaterThan(plain.height);
    const lowest = Math.max(...plain.cards.map((card) => bottom(card.box)));
    expect(plain.height).toBe(Math.max(lowest, bottom(plain.pooling!.box)) + 20);
  });

  it('widens the cards for a long line instead of cutting it', () => {
    const model = modelOf(built(31));
    const wide = {
      ...model,
      cards: model.cards.map((card, index) => (index ? card : { ...card, sub: 'x'.repeat(60) })),
    };
    expect(layoutOf(wide).cardWidth).toBe(60 * 7 + 20);
  });

  it('is wide enough for the header line', () => {
    const model = modelOf(built(31));
    const layout = layoutOf({ ...model, header: { ...model.header, title: 'T'.repeat(300) } });
    expect(layout.width).toBeGreaterThanOrEqual(2 * 20 + 300 * 7);
  });
});
