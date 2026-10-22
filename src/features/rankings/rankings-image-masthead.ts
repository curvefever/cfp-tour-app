import type { ImageHeaderText } from './rankings-image-header';
import { HEADER_HEIGHT, MASTHEAD_LINES, mastheadTextHeight } from './rankings-image-layout';
import { COLORS, FONTS, measurer } from './rankings-image-style';
import { wrapText } from './rankings-image-wrap';

const LOGO_GAP = 28;
const RULE_WIDTH = 2;
const LABEL_SPACING = '2px';
const DOT_SIZE = 8;
const { label: LABEL_LINE, title: TITLE_LINE, date: DATE_LINE, gap: LINE_GAP } = MASTHEAD_LINES;
const TITLE_MAX_LINES = 2;

/** The logo, or null when it didn't load: the header is then drawn without it. */
export async function loadRankingsLogo(): Promise<HTMLImageElement | null> {
  try {
    const logo = new Image();
    logo.src = '/rankings-logo.png';
    await logo.decode();
    return logo;
  } catch {
    return null;
  }
}

function drawLabel(context: CanvasRenderingContext2D, header: ImageHeaderText, x: number, centre: number) {
  let labelX = x;
  if (header.live) {
    context.fillStyle = COLORS.red;
    context.beginPath();
    context.arc(x + DOT_SIZE / 2, centre, DOT_SIZE / 2, 0, 2 * Math.PI);
    context.fill();
    labelX += 2 * DOT_SIZE;
  }
  context.font = FONTS.label;
  context.fillStyle = COLORS.brand;
  context.letterSpacing = LABEL_SPACING;
  context.fillText(header.label, labelX, centre);
  context.letterSpacing = '0px';
}

/** The date, the count and, in play, how many are still in: the count part stands out, the rest is muted. */
function drawDateLine(context: CanvasRenderingContext2D, header: ImageHeaderText, x: number, centre: number) {
  const muted = (text: string) => ({ text, font: FONTS.date, color: COLORS.muted });
  const segments = [
    ...(header.date ? [muted(header.date), muted(' · ')] : []),
    { text: header.count, font: FONTS.count, color: COLORS.text },
    ...(header.stillIn ? [muted(' · '), muted(header.stillIn)] : []),
  ];
  let cursor = x;
  for (const { text, font, color } of segments) {
    context.font = font;
    context.fillStyle = color;
    context.fillText(text, cursor, centre);
    cursor += context.measureText(text).width;
  }
}

/** Where the text starts: at the padding, or after the logo and its rule. */
export function mastheadTextLeft(x: number, logo: HTMLImageElement | null): number {
  if (!logo) return x;
  const logoWidth = (HEADER_HEIGHT * logo.naturalWidth) / logo.naturalHeight;
  return x + logoWidth + LOGO_GAP + RULE_WIDTH + LOGO_GAP;
}

/** The title wrapped to its width: at most two lines, cut with an ellipsis only beyond that or for a word wider than a line. */
export function wrapTitle(context: CanvasRenderingContext2D, title: string, width: number): string[] {
  return wrapText(measurer(context, FONTS.title), title, width, TITLE_MAX_LINES);
}

/**
 * The top of the image: the logo at the left (`HEADER_HEIGHT` tall, centred in the header) with a rule, then the label,
 * the title lines and the date-and-count line as one block centred in the header. Without the logo the block starts at
 * the padding.
 */
export function drawMasthead(
  context: CanvasRenderingContext2D,
  header: ImageHeaderText,
  titleLines: readonly string[],
  logo: HTMLImageElement | null,
  box: { x: number; y: number; height: number },
) {
  if (logo) {
    const logoWidth = (HEADER_HEIGHT * logo.naturalWidth) / logo.naturalHeight;
    const logoTop = box.y + (box.height - HEADER_HEIGHT) / 2;
    context.drawImage(logo, box.x, logoTop, logoWidth, HEADER_HEIGHT);
    context.fillStyle = COLORS.frame;
    context.fillRect(box.x + logoWidth + LOGO_GAP, logoTop, RULE_WIDTH, HEADER_HEIGHT);
  }
  const textX = mastheadTextLeft(box.x, logo);
  const lines = Math.max(1, titleLines.length);
  const top = box.y + (box.height - mastheadTextHeight(lines)) / 2;
  const titleTop = top + LABEL_LINE + LINE_GAP;
  context.textBaseline = 'middle';
  drawLabel(context, header, textX, top + LABEL_LINE / 2);
  context.font = FONTS.title;
  context.fillStyle = COLORS.text;
  titleLines.forEach((line, index) => {
    context.fillText(line, textX, titleTop + index * TITLE_LINE + TITLE_LINE / 2);
  });
  drawDateLine(context, header, textX, titleTop + lines * TITLE_LINE + LINE_GAP + DATE_LINE / 2);
  context.textBaseline = 'alphabetic';
}
