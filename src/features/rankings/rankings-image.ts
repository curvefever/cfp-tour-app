import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { downloadBlob, sanitizeFilename } from '../../lib/browser-download';
import { finalStanding } from './ranking-podium';
import { rankingsImageHeader } from './rankings-image-header';
import { PADDING, imageColumnWidth, rankingsImageLayout } from './rankings-image-layout';
import { drawMasthead, loadRankingsLogo, mastheadTextLeft, wrapTitle } from './rankings-image-masthead';
import { drawPodiumCard, podiumSizes, wrapPodiumCard } from './rankings-image-podium';
import { drawRow, rowLinesOf, wrapRow } from './rankings-image-row';
import { rankingsImageRows } from './rankings-image-rows';
import { COLORS, FONTS } from './rankings-image-style';

const WIDTH = 1200;
const SCALE = 2;

/** The canvas only draws with a web font once it is loaded, so load the weights it uses before drawing. */
async function loadAppFont(): Promise<void> {
  await Promise.all(Object.values(FONTS).map((spec) => document.fonts.load(spec)));
  await document.fonts.ready;
}

export async function buildRankingsImage(state: TournamentState): Promise<Blob | null> {
  const data = computeRankings(state);
  if (!data) return null;
  const [logo] = await Promise.all([loadRankingsLogo(), loadAppFont()]);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  // The layout needs the line counts and the canvas's height comes from the layout, so everything is wrapped
  // (measured with this context) first; resizing the canvas then resets the context, so it is scaled after that.
  const header = rankingsImageHeader(state, data);
  const titleLines = wrapTitle(context, header.title, WIDTH - PADDING - mastheadTextLeft(PADDING, logo));
  const podium = (data.finalComplete ? finalStanding(state, data).podium : []).map((card) =>
    wrapPodiumCard(context, card),
  );
  const rows = rankingsImageRows(state, data).map((row) => wrapRow(context, row, imageColumnWidth(WIDTH)));
  const layout = rankingsImageLayout(rows, {
    width: WIDTH,
    podium: podiumSizes(podium),
    titleLines: titleLines.length,
    rowLines: rowLinesOf,
  });
  canvas.width = WIDTH * SCALE;
  canvas.height = layout.height * SCALE;
  context.scale(SCALE, SCALE);
  context.fillStyle = COLORS.page;
  context.fillRect(0, 0, WIDTH, layout.height);
  drawMasthead(context, header, titleLines, logo, layout.header);
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
