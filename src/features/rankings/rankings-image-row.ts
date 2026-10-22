import { ROW_HEIGHT, ROW_MEMBER_LINE, ROW_NAME_LINE, type RowLines } from './rankings-image-layout';
import type { ImageRow } from './rankings-image-rows';
import { COLORS, FONTS, measurer } from './rankings-image-style';
import { wrapMembers, wrapText } from './rankings-image-wrap';

const NAME_MAX_LINES = 3;
const MEMBERS_MAX_LINES = 4;
/** The space left of the name for the rank, and right of the line for the "where" text and its gaps. */
const NAME_LEFT = 52;
const RIGHT_GAP = 12;
/** The empty band above and below a one-line row's text. */
const ROW_TEXT_PADDING = 9;

/** A row with its name and its members wrapped to the width they get beside the rank and the "where" text. */
export interface WrappedRow {
  row: ImageRow;
  nameLines: string[];
  memberLines: string[];
}

/** Wraps a row's name and members, which get the column's width less the rank and the "where" text, measuring with the canvas. */
export function wrapRow(context: CanvasRenderingContext2D, row: ImageRow, columnWidth: number): WrappedRow {
  const whereWidth = measurer(context, FONTS.where)(row.where);
  const textWidth = columnWidth - NAME_LEFT - RIGHT_GAP - whereWidth - RIGHT_GAP;
  return {
    row,
    nameLines: wrapText(measurer(context, FONTS.name), row.name, textWidth, NAME_MAX_LINES),
    memberLines: wrapMembers(measurer(context, FONTS.where), row.members ?? [], textWidth, MEMBERS_MAX_LINES),
  };
}

export function rowLinesOf({ nameLines, memberLines }: WrappedRow): RowLines {
  return { nameLines: nameLines.length, memberLines: memberLines.length };
}

/** One row: the rank and the "where" text on the first line, the name's lines under each other, then the members, muted. */
export function drawRow(
  context: CanvasRenderingContext2D,
  { row, nameLines, memberLines }: WrappedRow,
  box: { x: number; y: number; width: number; height: number },
  index: number,
) {
  context.fillStyle = COLORS.rowGrounds[index % 2] ?? COLORS.page;
  context.fillRect(box.x, box.y, box.width, box.height);
  const baseline = box.y + ROW_HEIGHT / 2 + 5;
  context.textAlign = 'right';
  context.font = FONTS.rank;
  context.fillStyle = COLORS.muted;
  context.fillText(row.rank, box.x + 40, baseline);
  context.font = FONTS.where;
  context.fillText(row.where, box.x + box.width - RIGHT_GAP, baseline);
  context.textAlign = 'left';
  context.font = FONTS.name;
  context.fillStyle = COLORS.text;
  nameLines.forEach((line, lineIndex) => {
    context.fillText(line, box.x + NAME_LEFT, baseline + lineIndex * ROW_NAME_LINE);
  });
  context.font = FONTS.where;
  context.fillStyle = COLORS.muted;
  const membersTop =
    box.y + ROW_HEIGHT - ROW_TEXT_PADDING + (Math.max(1, nameLines.length) - 1) * ROW_NAME_LINE;
  memberLines.forEach((line, lineIndex) => {
    const slotTop = membersTop + lineIndex * ROW_MEMBER_LINE;
    context.fillText(line, box.x + NAME_LEFT, slotTop + ROW_MEMBER_LINE / 2 + 4);
  });
}
