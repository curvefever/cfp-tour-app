import { ordinal } from '../../lib/ordinal';
import type { PodiumCard } from './ranking-podium';
import { podiumCardHeight, podiumCardMetrics, type Box, type PodiumSize } from './rankings-image-layout';
import { COLORS, FONTS, fitText } from './rankings-image-style';

const CARD_SIDE_PADDING = 18;
const FRAME_WIDTH = 2;

function cardKind(card: PodiumCard) {
  return { first: card.rank === 1, hasMembers: Boolean(card.members?.length) };
}

/** The sizes the layout places the podium cards by. */
export function podiumSizes(cards: readonly PodiumCard[]): PodiumSize[] {
  return cards.map((card) => ({ height: podiumCardHeight(cardKind(card)) }));
}

/** The lines of a card, top to bottom, matching `podiumCardMetrics().lines`. */
function cardLines(card: PodiumCard) {
  const { first, hasMembers } = cardKind(card);
  const medal = COLORS.medals[card.medal];
  return [
    { text: ordinal(card.rank), font: first ? FONTS.ordinalFirst : FONTS.ordinalOther, color: medal },
    { text: card.label, font: FONTS.cardName, color: COLORS.text },
    ...(hasMembers
      ? [{ text: card.members?.join(' · ') ?? '', font: FONTS.cardSmall, color: COLORS.muted }]
      : []),
    { text: card.line, font: FONTS.cardSmall, color: COLORS.muted },
  ];
}

/** One card of the podium as the page draws it: the frame, a medal bar, then the ordinal, name, members and Final line. */
export function drawPodiumCard(context: CanvasRenderingContext2D, card: PodiumCard, box: Box) {
  const { barHeight, paddingTop, lineGap, lines } = podiumCardMetrics(cardKind(card));
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
  cardLines(card).forEach(({ text, font, color }, index) => {
    context.font = font;
    context.fillStyle = color;
    const fitted = fitText(context, text, box.width - 2 * CARD_SIDE_PADDING);
    context.fillText(fitted, box.x + box.width / 2, top + lines[index] / 2);
    top += lines[index] + lineGap;
  });
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
}
