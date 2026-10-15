import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { downloadBlob, sanitizeFilename } from '../../lib/browser-download';
import { rankingsImageLayout } from './rankings-image-layout';
import { rankingsImageRows, type ImageRow } from './rankings-image-rows';

const FONT = 'Asap, sans-serif';
const WIDTH = 1200;
const SCALE = 2;

// The weights the image draws with, as the page loads them (400, 700, 800); the sizes only name the font.
const BRAND_FONT = `800 22px ${FONT}`;
const TITLE_FONT = `700 26px ${FONT}`;
const LABEL_FONT = `800 12px ${FONT}`;
const RANK_FONT = `800 15px ${FONT}`;
const NAME_FONT = `700 15px ${FONT}`;
const WHERE_FONT = `400 13px ${FONT}`;
const FONT_SPECS = [BRAND_FONT, TITLE_FONT, LABEL_FONT, RANK_FONT, NAME_FONT, WHERE_FONT];

// The game look's colours (styles.css, `--color-cfp-*`).
const PAGE = '#11233b';
const ROW_GROUNDS = ['#113148', '#0b253a'];
const BRAND = '#34a3ce';
const TEXT = '#cce6f7';
const MUTED = '#8fb3cc';
const MEDALS = { gold: '#e8b923', silver: '#b8c4cc', bronze: '#c27c3e' };

/** The canvas only draws with a web font once it is loaded, so load the weights it uses before drawing. */
async function loadAppFont(): Promise<void> {
  await Promise.all(FONT_SPECS.map((spec) => document.fonts.load(spec)));
  await document.fonts.ready;
}

/** The text cut with an ellipsis so that it fits the width. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let length = text.length;
  while (length > 1 && context.measureText(`${text.slice(0, length)}…`).width > maxWidth) length--;
  return `${text.slice(0, length)}…`;
}

function drawHeader(context: CanvasRenderingContext2D, title: string, label: string, padding: number) {
  context.font = BRAND_FONT;
  context.fillStyle = BRAND;
  context.fillText('CFP', padding, 40);
  const brandWidth = context.measureText('CFP ').width;
  context.fillStyle = TEXT;
  context.fillText('TOURNAMENT HUB', padding + brandWidth, 40);
  context.font = TITLE_FONT;
  context.fillText(title, padding, 76);
  context.font = LABEL_FONT;
  context.fillStyle = MUTED;
  context.letterSpacing = '1.5px';
  context.fillText(label, padding, 98);
  context.letterSpacing = '0px';
}

function drawRow(
  context: CanvasRenderingContext2D,
  row: ImageRow,
  box: { x: number; y: number; width: number; height: number },
  index: number,
) {
  context.fillStyle = ROW_GROUNDS[index % 2] ?? PAGE;
  context.fillRect(box.x, box.y, box.width, box.height);
  const baseline = box.y + box.height / 2 + 5;
  context.textAlign = 'right';
  context.font = RANK_FONT;
  context.fillStyle = row.medal ? MEDALS[row.medal] : MUTED;
  context.fillText(row.rank, box.x + 40, baseline);
  context.font = WHERE_FONT;
  context.fillStyle = MUTED;
  context.fillText(row.where, box.x + box.width - 12, baseline);
  const whereWidth = context.measureText(row.where).width;
  context.textAlign = 'left';
  context.font = NAME_FONT;
  context.fillStyle = TEXT;
  context.fillText(fitText(context, row.name, box.width - 52 - 12 - whereWidth - 12), box.x + 52, baseline);
}

export async function buildRankingsImage(state: TournamentState): Promise<Blob | null> {
  const data = computeRankings(state);
  if (!data) return null;
  await loadAppFont();
  const layout = rankingsImageLayout(rankingsImageRows(state, data), { width: WIDTH });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = layout.height * SCALE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(SCALE, SCALE);
  context.fillStyle = PAGE;
  context.fillRect(0, 0, WIDTH, layout.height);
  const label = data.finalComplete ? 'FINAL RANKINGS' : 'LIVE RANKINGS';
  drawHeader(context, state.title.trim() || 'Unnamed Tournament', label, layout.padding);
  for (const cell of layout.cells) drawRow(context, cell.row, cell, cell.index);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function downloadRankingsImage(state: TournamentState): Promise<boolean> {
  const blob = await buildRankingsImage(state);
  if (!blob) return false;
  downloadBlob(`${sanitizeFilename(state.title || 'Unnamed Tournament')}-rankings.png`, blob);
  return true;
}
