import { ordinal } from '../../lib/ordinal';
import type { PodiumCard } from './ranking-podium';
import {
  CARD_WIDTH,
  podiumCardHeight,
  podiumCardMetrics,
  type Box,
  type PodiumSize,
} from './rankings-image-layout';
import { COLORS, FONTS, measurer } from './rankings-image-style';
import { wrapMembers, wrapText } from './rankings-image-wrap';

const CARD_SIDE_PADDING = 18;
const FRAME_WIDTH = 2;
const CARD_TEXT_WIDTH = CARD_WIDTH - 2 * CARD_SIDE_PADDING;
const NAME_MAX_LINES = 3;
const MEMBERS_MAX_LINES = 4;

/** A podium card with its name, members and Final line wrapped to the card's width. */
export interface WrappedPodiumCard {
  card: PodiumCard;
  nameLines: string[];
  memberLines: string[];
  finalLines: string[];
}

/** Wraps what a card says to its width (set by the layout's card width), measuring with the canvas. */
export function wrapPodiumCard(context: CanvasRenderingContext2D, card: PodiumCard): WrappedPodiumCard {
  const small = measurer(context, FONTS.cardSmall);
  return {
    card,
    nameLines: wrapText(measurer(context, FONTS.cardName), card.label, CARD_TEXT_WIDTH, NAME_MAX_LINES),
    memberLines: wrapMembers(small, card.members ?? [], CARD_TEXT_WIDTH, MEMBERS_MAX_LINES),
    finalLines: wrapText(small, card.line, CARD_TEXT_WIDTH, 1),
  };
}

function cardKind({ card, nameLines, memberLines }: WrappedPodiumCard) {
  return { first: card.rank === 1, nameLines: nameLines.length, memberLines: memberLines.length };
}

/** The sizes the layout places the podium cards by. */
export function podiumSizes(cards: readonly WrappedPodiumCard[]): PodiumSize[] {
  return cards.map((wrapped) => ({ height: podiumCardHeight(cardKind(wrapped)) }));
}

/** The blocks of a card, top to bottom, matching `podiumCardMetrics().lines`. */
function cardBlocks(wrapped: WrappedPodiumCard) {
  const { card, nameLines, memberLines, finalLines } = wrapped;
  const first = card.rank === 1;
  return [
    {
      lines: [ordinal(card.rank)],
      font: first ? FONTS.ordinalFirst : FONTS.ordinalOther,
      color: COLORS.medals[card.medal],
    },
    { lines: nameLines, font: FONTS.cardName, color: COLORS.text },
    ...(memberLines.length > 0 ? [{ lines: memberLines, font: FONTS.cardSmall, color: COLORS.muted }] : []),
    { lines: finalLines, font: FONTS.cardSmall, color: COLORS.muted },
  ];
}

/** One card of the podium as the page draws it: the frame, a medal bar, then the ordinal, name, members and Final line. */
export function drawPodiumCard(context: CanvasRenderingContext2D, wrapped: WrappedPodiumCard, box: Box) {
  const { barHeight, paddingTop, lineGap, lines } = podiumCardMetrics(cardKind(wrapped));
  const { card } = wrapped;
  context.fillStyle = COLORS.frame;
  context.fillRect(
    box.x - FRAME_WIDTH,
    box.y - FRAME_WIDTH,
    box.width + 2 * FRAME_WIDTH,
    box.height + 2 * FRAME_WIDTH,
  );
  context.fillStyle = COLORS.cardGround;
  context.fillRect(box.x, box.y, box.width, box.height);
  context.fillStyle = COLORS.medals[card.medal];
  context.fillRect(box.x, box.y, box.width, barHeight);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let top = box.y + barHeight + paddingTop;
  cardBlocks(wrapped).forEach(({ lines: texts, font, color }, index) => {
    context.font = font;
    context.fillStyle = color;
    const lineHeight = lines[index] / Math.max(1, texts.length);
    texts.forEach((text, line) => {
      context.fillText(text, box.x + box.width / 2, top + (line + 0.5) * lineHeight);
    });
    top += lines[index] + lineGap;
  });
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
}
