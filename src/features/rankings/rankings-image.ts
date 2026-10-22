import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { downloadBlob, sanitizeFilename } from '../../lib/browser-download';
import { finalStanding } from './ranking-podium';
import { rankingsImageHeader } from './rankings-image-header';
import { rankingsImageLayout } from './rankings-image-layout';
import { drawMasthead, loadRankingsLogo } from './rankings-image-masthead';
import { drawPodiumCard, podiumSizes } from './rankings-image-podium';
import { rankingsImageRows, type ImageRow } from './rankings-image-rows';
import { COLORS, FONTS, fitText } from './rankings-image-style';

const WIDTH = 1200;
const SCALE = 2;

/** The canvas only draws with a web font once it is loaded, so load the weights it uses before drawing. */
async function loadAppFont(): Promise<void> {
  await Promise.all(Object.values(FONTS).map((spec) => document.fonts.load(spec)));
  await document.fonts.ready;
}

function drawRow(
  context: CanvasRenderingContext2D,
  row: ImageRow,
  box: { x: number; y: number; width: number; height: number },
  index: number,
) {
  context.fillStyle = COLORS.rowGrounds[index % 2] ?? COLORS.page;
  context.fillRect(box.x, box.y, box.width, box.height);
  const baseline = box.y + box.height / 2 + 5;
  context.textAlign = 'right';
  context.font = FONTS.rank;
  context.fillStyle = COLORS.muted;
  context.fillText(row.rank, box.x + 40, baseline);
  context.font = FONTS.where;
  context.fillText(row.where, box.x + box.width - 12, baseline);
  const whereWidth = context.measureText(row.where).width;
  context.textAlign = 'left';
  context.font = FONTS.name;
  context.fillStyle = COLORS.text;
  context.fillText(fitText(context, row.name, box.width - 52 - 12 - whereWidth - 12), box.x + 52, baseline);
}

export async function buildRankingsImage(state: TournamentState): Promise<Blob | null> {
  const data = computeRankings(state);
  if (!data) return null;
  const [logo] = await Promise.all([loadRankingsLogo(), loadAppFont()]);
  const podium = data.finalComplete ? finalStanding(state, data).podium : [];
  const layout = rankingsImageLayout(rankingsImageRows(state, data), {
    width: WIDTH,
    podium: podiumSizes(podium),
  });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = layout.height * SCALE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(SCALE, SCALE);
  context.fillStyle = COLORS.page;
  context.fillRect(0, 0, WIDTH, layout.height);
  drawMasthead(context, rankingsImageHeader(state, data), logo, {
    ...layout.header,
    right: WIDTH - layout.padding,
  });
  podium.forEach((card, index) => drawPodiumCard(context, card, layout.podium[index]));
  for (const cell of layout.cells) drawRow(context, cell.row, cell, cell.index);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function downloadRankingsImage(state: TournamentState): Promise<boolean> {
  const blob = await buildRankingsImage(state);
  if (!blob) return false;
  downloadBlob(`${sanitizeFilename(state.title || 'Unnamed Tournament')}-rankings.png`, blob);
  return true;
}
