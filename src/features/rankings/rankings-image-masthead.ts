import type { ImageHeaderText } from './rankings-image-header';
import { COLORS, FONTS, fitText } from './rankings-image-style';

const LOGO_GAP = 28;
const RULE_WIDTH = 2;
const LABEL_SPACING = '2px';
const DOT_SIZE = 8;
const LABEL_LINE = 16;
const TITLE_LINE = 40;
const DATE_LINE = 22;
const LINE_GAP = 6;

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

/**
 * The top of the image: the logo at the left, a rule, then the label, the title and the date-and-count line, the three
 * lines centred on the logo's height. Without the logo the lines start at the padding.
 */
export function drawMasthead(
  context: CanvasRenderingContext2D,
  header: ImageHeaderText,
  logo: HTMLImageElement | null,
  box: { x: number; y: number; height: number; right: number },
) {
  let textX = box.x;
  if (logo) {
    const logoWidth = (box.height * logo.naturalWidth) / logo.naturalHeight;
    context.drawImage(logo, box.x, box.y, logoWidth, box.height);
    const ruleX = box.x + logoWidth + LOGO_GAP;
    context.fillStyle = COLORS.frame;
    context.fillRect(ruleX, box.y, RULE_WIDTH, box.height);
    textX = ruleX + RULE_WIDTH + LOGO_GAP;
  }
  const block = LABEL_LINE + TITLE_LINE + DATE_LINE + 2 * LINE_GAP;
  const top = box.y + (box.height - block) / 2;
  const titleTop = top + LABEL_LINE + LINE_GAP;
  context.textBaseline = 'middle';
  drawLabel(context, header, textX, top + LABEL_LINE / 2);
  context.font = FONTS.title;
  context.fillStyle = COLORS.text;
  context.fillText(fitText(context, header.title, box.right - textX), textX, titleTop + TITLE_LINE / 2);
  drawDateLine(context, header, textX, titleTop + TITLE_LINE + LINE_GAP + DATE_LINE / 2);
  context.textBaseline = 'alphabetic';
}
