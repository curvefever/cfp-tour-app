import { measurer } from '../rankings/rankings-image-style';
import {
  STRIPE_WIDTH,
  schedulePictureLayout,
  type Box,
  type LayoutBlock,
  type LayoutCard,
  type LayoutPooling,
  type PictureLayout,
  type TextItem,
} from './schedule-picture-layout';
import { PICTURE_COLORS, PICTURE_FONTS, TONE_COLORS, type PictureFont } from './schedule-picture-style';
import type { SchedulePictureModel } from './schedule-picture-types';

const SCALE = 2;

/** The picture as a PNG, and the size it is shown at (the PNG is drawn at twice that). */
export interface SchedulePictureImage {
  blob: Blob;
  width: number;
  height: number;
}

type Context = CanvasRenderingContext2D;

function fillBox(context: Context, box: Box, color: string): void {
  context.fillStyle = color;
  context.fillRect(box.x, box.y, box.width, box.height);
}

function drawText(context: Context, item: TextItem): void {
  context.font = PICTURE_FONTS[item.font];
  context.fillStyle = PICTURE_COLORS[item.color];
  context.textAlign = item.align;
  context.textBaseline = 'middle';
  context.fillText(item.text, item.x, item.y);
}

/** A block: its ground, its stripe (two tones stacked, top first) and its lines. */
function drawBlock(context: Context, block: LayoutBlock): void {
  fillBox(context, block.box, PICTURE_COLORS.rowGrounds[block.ground]);
  const { x, y, height } = block.box;
  const part = height / block.tones.length;
  block.tones.forEach((tone, index) => {
    fillBox(context, { x, y: y + index * part, width: STRIPE_WIDTH, height: part }, TONE_COLORS[tone]);
  });
  block.texts.forEach((text) => drawText(context, text));
}

function drawCard(context: Context, card: LayoutCard): void {
  fillBox(context, card.headerBox, TONE_COLORS[card.tone]);
  fillBox(context, card.subBox, PICTURE_COLORS.card);
  card.texts.forEach((text) => drawText(context, text));
  for (const group of card.groups) {
    if (group.label) drawText(context, group.label);
    group.blocks.forEach((block) => drawBlock(context, block));
  }
}

function drawPooling(context: Context, pooling: LayoutPooling): void {
  fillBox(context, pooling.headerBox, PICTURE_COLORS.brand);
  pooling.texts.forEach((text) => drawText(context, text));
  if (pooling.afterTitle) drawText(context, pooling.afterTitle);
  pooling.blocks.forEach((block) => drawBlock(context, block));
}

/** Draws a laid-out picture on a context already scaled to the layout's units. */
export function drawSchedulePicture(context: Context, layout: PictureLayout): void {
  fillBox(context, { x: 0, y: 0, width: layout.width, height: layout.height }, PICTURE_COLORS.page);
  layout.header.forEach((text) => drawText(context, text));
  if (layout.pooling) drawPooling(context, layout.pooling);
  layout.cards.forEach((card) => drawCard(context, card));
}

/** The canvas only draws with a web font once it is loaded, so load the weights the picture uses before drawing. */
async function loadFonts(): Promise<void> {
  await Promise.all(Object.values(PICTURE_FONTS).map((spec) => document.fonts.load(spec)));
  await document.fonts.ready;
}

/**
 * The picture as a PNG; null where there is nothing to draw on (no canvas, as in the render tests, or no font loading).
 * The layout is measured with the canvas itself, so the card width fits the real text.
 */
export async function buildSchedulePicture(
  model: SchedulePictureModel,
): Promise<SchedulePictureImage | null> {
  if (typeof document === 'undefined' || !document.fonts) return null;
  await loadFonts();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const measure = (text: string, font: PictureFont) => measurer(context, PICTURE_FONTS[font])(text);
  const layout = schedulePictureLayout(model, measure);
  // Resizing the canvas resets its context, so it is scaled after that.
  canvas.width = layout.width * SCALE;
  canvas.height = layout.height * SCALE;
  context.scale(SCALE, SCALE);
  drawSchedulePicture(context, layout);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? { blob, width: layout.width, height: layout.height } : null;
}
