import type { PictureColor, PictureFont } from './schedule-picture-style';
import type {
  PictureBlock,
  PictureCard,
  PicturePooling,
  PictureRoomGroup,
  PictureTone,
  SchedulePictureModel,
} from './schedule-picture-types';

/** The width of a text in a font (the canvas's `measureText`, a fake in tests). */
export type Measure = (text: string, font: PictureFont) => number;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line of text; `y` is the middle of the line, `x` its left edge or, right-aligned, its right edge. */
export interface TextItem {
  text: string;
  x: number;
  y: number;
  font: PictureFont;
  color: PictureColor;
  align: 'left' | 'right';
}

export interface LayoutBlock {
  box: Box;
  /** Index into the alternating grounds. */
  ground: number;
  tones: PictureTone[];
  texts: TextItem[];
}

export interface LayoutGroup {
  label: TextItem | null;
  blocks: LayoutBlock[];
}

export interface LayoutCard {
  box: Box;
  tone: PictureTone;
  headerBox: Box;
  subBox: Box;
  /** The name, the ×n tag and the sub line. */
  texts: TextItem[];
  groups: LayoutGroup[];
}

export interface LayoutPooling {
  box: Box;
  headerBox: Box;
  /** The title and the wrapped lines under it. */
  texts: TextItem[];
  /** "After the last round" and its blocks; null when no place goes anywhere. */
  afterTitle: TextItem | null;
  blocks: LayoutBlock[];
}

export interface PictureLayout {
  width: number;
  height: number;
  cardWidth: number;
  /** The title and the format line with the count. */
  header: TextItem[];
  pooling: LayoutPooling | null;
  cards: LayoutCard[];
}

export const PADDING = 20;
export const MIN_CARD_WIDTH = 150;
const HEADER_BAND = 48;
const COLUMN_GAP = 44;
const ROW_GAP = 20;
const CARD_PAD_X = 10;
export const STRIPE_WIDTH = 4;
const TEXT_X = STRIPE_WIDTH + 8;
const CARD_HEADER_HEIGHT = 26;
const SUB_HEIGHT = 20;
const GROUP_LABEL_HEIGHT = 20;
const BLOCK_LINE_HEIGHT = 15;
const BLOCK_PAD_Y = 6;
const POOLING_LINE_HEIGHT = 17;
const POOLING_GAP = 10;
const AFTER_LAST = 'After the last round';

const blockHeight = (block: PictureBlock) => block.lines.length * BLOCK_LINE_HEIGHT + 2 * BLOCK_PAD_Y;

function groupHeight(group: PictureRoomGroup): number {
  return (
    (group.label ? GROUP_LABEL_HEIGHT : 0) + group.blocks.reduce((sum, block) => sum + blockHeight(block), 0)
  );
}

function cardHeight(card: PictureCard): number {
  return CARD_HEADER_HEIGHT + SUB_HEIGHT + card.groups.reduce((sum, group) => sum + groupHeight(group), 0);
}

/** The width the widest line of a card needs, with its padding. */
function cardNeeds(card: PictureCard, measure: Measure): number {
  const nameWidth = measure(card.name, 'cardName') + (card.tag ? 12 + measure(card.tag, 'tag') : 0);
  const widths = [nameWidth + 2 * CARD_PAD_X, measure(card.sub, 'sub') + 2 * CARD_PAD_X];
  for (const group of card.groups) {
    if (group.label) widths.push(measure(group.label, 'groupLabel') + 2 * CARD_PAD_X);
    widths.push(...blockNeeds(group.blocks, measure));
  }
  return Math.max(...widths);
}

function blockNeeds(blocks: readonly PictureBlock[], measure: Measure): number[] {
  return blocks.flatMap((block) => block.lines.map((line) => TEXT_X + measure(line, 'block') + CARD_PAD_X));
}

/** The width the pooling block needs for what it never wraps: its title, its blocks and its longest words. */
function poolingNeeds(pooling: PicturePooling, measure: Measure): number {
  const words = pooling.lines.flatMap((line) => line.split(' ')).map((word) => measure(word, 'poolingLine'));
  return Math.max(
    measure(pooling.title, 'cardName') + 2 * CARD_PAD_X,
    measure(AFTER_LAST, 'poolingBold') + 2 * CARD_PAD_X,
    ...blockNeeds(pooling.afterLast, measure),
    ...words.map((width) => width + 2 * CARD_PAD_X),
  );
}

/** Greedy word wrap: a word wider than the width stays whole on a line of its own. */
export function wrapLine(measure: Measure, font: PictureFont, text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, font) > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  return current ? [...lines, current] : lines;
}

function layoutBlocks(blocks: readonly PictureBlock[], x: number, top: number, width: number): LayoutBlock[] {
  let y = top;
  return blocks.map((block, ground) => {
    const height = blockHeight(block);
    const laid: LayoutBlock = {
      box: { x, y, width, height },
      ground: ground % 2,
      tones: block.tones,
      texts: block.lines.map((text, line) => ({
        text,
        x: x + TEXT_X,
        y: y + BLOCK_PAD_Y + line * BLOCK_LINE_HEIGHT + BLOCK_LINE_HEIGHT / 2,
        font: 'block',
        color: line === 0 ? 'text' : 'muted',
        align: 'left',
      })),
    };
    y += height;
    return laid;
  });
}

function layoutCard(card: PictureCard, x: number, y: number, width: number): LayoutCard {
  const texts: TextItem[] = [
    {
      text: card.name,
      x: x + CARD_PAD_X,
      y: y + CARD_HEADER_HEIGHT / 2,
      font: 'cardName',
      color: 'ink',
      align: 'left',
    },
    {
      text: card.sub,
      x: x + CARD_PAD_X,
      y: y + CARD_HEADER_HEIGHT + SUB_HEIGHT / 2,
      font: 'sub',
      color: 'muted',
      align: 'left',
    },
  ];
  if (card.tag) {
    texts.push({
      text: card.tag,
      x: x + width - CARD_PAD_X,
      y: y + CARD_HEADER_HEIGHT / 2,
      font: 'tag',
      color: 'ink',
      align: 'right',
    });
  }
  let top = y + CARD_HEADER_HEIGHT + SUB_HEIGHT;
  const groups = card.groups.map((group): LayoutGroup => {
    const label: TextItem | null = group.label
      ? {
          text: group.label,
          x: x + CARD_PAD_X,
          y: top + GROUP_LABEL_HEIGHT / 2,
          font: 'groupLabel',
          color: 'text',
          align: 'left',
        }
      : null;
    const blocks = layoutBlocks(group.blocks, x, top + (label ? GROUP_LABEL_HEIGHT : 0), width);
    top += groupHeight(group);
    return { label, blocks };
  });
  return {
    box: { x, y, width, height: cardHeight(card) },
    tone: card.tone,
    headerBox: { x, y, width, height: CARD_HEADER_HEIGHT },
    subBox: { x, y: y + CARD_HEADER_HEIGHT, width, height: SUB_HEIGHT },
    texts,
    groups,
  };
}

function layoutPooling(
  pooling: PicturePooling,
  x: number,
  y: number,
  width: number,
  measure: Measure,
): LayoutPooling {
  const texts: TextItem[] = [
    {
      text: pooling.title,
      x: x + CARD_PAD_X,
      y: y + CARD_HEADER_HEIGHT / 2,
      font: 'cardName',
      color: 'ink',
      align: 'left',
    },
  ];
  let top = y + CARD_HEADER_HEIGHT + POOLING_GAP;
  for (const line of pooling.lines) {
    for (const wrapped of wrapLine(measure, 'poolingLine', line, width - 2 * CARD_PAD_X)) {
      texts.push({
        text: wrapped,
        x: x + CARD_PAD_X,
        y: top + POOLING_LINE_HEIGHT / 2,
        font: 'poolingLine',
        color: 'muted',
        align: 'left',
      });
      top += POOLING_LINE_HEIGHT;
    }
  }
  let afterTitle: TextItem | null = null;
  if (pooling.afterLast.length > 0) {
    top += POOLING_GAP;
    afterTitle = {
      text: AFTER_LAST,
      x: x + CARD_PAD_X,
      y: top + POOLING_LINE_HEIGHT / 2,
      font: 'poolingBold',
      color: 'text',
      align: 'left',
    };
    top += POOLING_LINE_HEIGHT + 4;
  }
  const blocks = layoutBlocks(pooling.afterLast, x, top, width);
  const bottom = blocks.length ? blocks[blocks.length - 1].box.y + blocks[blocks.length - 1].box.height : top;
  return {
    box: { x, y, width, height: bottom - y },
    headerBox: { x, y, width, height: CARD_HEADER_HEIGHT },
    texts,
    afterTitle,
    blocks,
  };
}

/** Each row as tall as its tallest card, from the top: the y of every row. */
function rowTops(cards: readonly PictureCard[], top: number): Map<number, number> {
  const heights = new Map<number, number>();
  for (const card of cards) heights.set(card.row, Math.max(heights.get(card.row) ?? 0, cardHeight(card)));
  const tops = new Map<number, number>();
  let y = top;
  for (const row of [...heights.keys()].sort((first, second) => first - second)) {
    tops.set(row, y);
    y += (heights.get(row) ?? 0) + ROW_GAP;
  }
  return tops;
}

/**
 * Where everything goes. One card width for the whole picture: the widest line any card or the pooling block needs
 * (text is never cut), at least `MIN_CARD_WIDTH`. Cards start at the top of their row, a row is as tall as its
 * tallest card in any column, and the pooling block, in the first column, does not push the rows down: the picture
 * is as tall as the taller of the two.
 */
export function schedulePictureLayout(model: SchedulePictureModel, measure: Measure): PictureLayout {
  const needs = model.cards.map((card) => cardNeeds(card, measure));
  if (model.pooling) needs.push(poolingNeeds(model.pooling, measure));
  const cardWidth = Math.ceil(Math.max(MIN_CARD_WIDTH, ...needs));

  const columns = Math.max(...model.cards.map((card) => card.column), -1) + 1 + (model.pooling ? 1 : 0);
  const rightText = `${model.header.formatLine} · ${model.header.count}`;
  const headerWidth = measure(model.header.title, 'title') + 40 + measure(rightText, 'formatLine');
  const width = Math.ceil(
    Math.max(2 * PADDING + columns * cardWidth + (columns - 1) * COLUMN_GAP, 2 * PADDING + headerWidth),
  );
  const bodyTop = PADDING + HEADER_BAND;
  const columnX = (column: number) => PADDING + (column + (model.pooling ? 1 : 0)) * (cardWidth + COLUMN_GAP);

  const tops = rowTops(model.cards, bodyTop);
  const cards = model.cards.map((card) =>
    layoutCard(card, columnX(card.column), tops.get(card.row) ?? bodyTop, cardWidth),
  );
  const pooling = model.pooling ? layoutPooling(model.pooling, PADDING, bodyTop, cardWidth, measure) : null;
  const bottom = Math.max(
    pooling ? pooling.box.y + pooling.box.height : 0,
    ...cards.map((card) => card.box.y + card.box.height),
  );

  return {
    width,
    height: bottom + PADDING,
    cardWidth,
    header: [
      { text: model.header.title, x: PADDING, y: PADDING + 16, font: 'title', color: 'title', align: 'left' },
      {
        text: rightText,
        x: width - PADDING,
        y: PADDING + 16,
        font: 'formatLine',
        color: 'muted',
        align: 'right',
      },
    ],
    pooling,
    cards,
  };
}
