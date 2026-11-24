import { roomLetter } from '../../domain/tournament/bracket';
import type { RoomExitBand } from '../../domain/tournament/room-exits';
import { advanceResult, type RowResult } from '../../domain/tournament/room-row-result';
import { ordinal } from '../../lib/ordinal';
import { destinationLabel } from '../tournament/components/exit-text';
import { stripeTone } from '../tournament/components/result-row';
import { placesText } from './schedule-picture-text';
import type { PictureBlock, PictureTone } from './schedule-picture-types';

/** The tone the Bracket gives a result; an undecided (dashed) or empty one reads neutral. */
export function toneOfResult(result: RowResult): PictureTone {
  const tone = stripeTone(result);
  return tone === null || tone === 'dashed' ? 'neutral' : tone;
}

/** What a block needs to know about its room and its round. */
export interface BlockContext {
  labels: Parameters<typeof destinationLabel>[1];
  roomSize: number;
  /** Write the last band to the end of the room ("5th–last"): for rooms of different sizes that exit alike. */
  toLast: boolean;
  /** How many rooms of the round have a lucky-chance band at this place. */
  luckyRooms: (rank: number) => number;
  /** Where a lucky-chance band sends its units: the room's advance band, else the next round. */
  luckyDestination: number;
}

type LuckyBand = Extract<RoomExitBand, { kind: 'lucky-chance' }>;
type BestBand = Extract<RoomExitBand, { kind: 'best-place' }>;

const single = (tone: PictureTone, text: string): PictureBlock => ({ tones: [tone], lines: [text] });

/** The end of a band's places: "last" when it runs to the end of a room that is written to the end. */
function endOf(toRank: number, context: BlockContext): number | 'last' {
  return context.toLast && toRank === context.roomSize ? 'last' : toRank;
}

/** "the best one", "the best 2", "the best 0–1": the spots of a lucky place. */
function bestSpots(spots: number, minSpots: number | undefined): string {
  if (minSpots !== undefined && minSpots !== spots) return `${minSpots}–${spots}`;
  return spots === 1 ? 'one' : `${spots}`;
}

/** "the other" when one unit of the place is left over, else "the others". */
const others = (left: number) => (left === 1 ? 'the other' : 'the others');

function luckyBlock(band: LuckyBand, context: BlockContext): PictureBlock {
  const destination = destinationLabel(context.luckyDestination, context.labels);
  const left = context.luckyRooms(band.rank) - band.spots;
  const rest =
    band.otherwise === 'eliminate' ? 'out' : `→ ${destinationLabel(band.otherwise.drop, context.labels)}`;
  return {
    tones: ['green', band.otherwise === 'eliminate' ? 'red' : 'purple'],
    lines: [
      `${ordinal(band.rank)}: the best ${bestSpots(band.spots, band.minSpots)} → ${destination}`,
      `${others(left)} ${rest}`,
    ],
  };
}

function bestPlaceBlock(band: BestBand, context: BlockContext): PictureBlock {
  const otherwise = band.otherwise;
  const rest = otherwise === 'eliminate' ? 'out' : `→ ${destinationLabel(otherwise.advance, context.labels)}`;
  return {
    tones: [
      toneOfResult(advanceResult(band)),
      otherwise === 'eliminate' ? 'red' : toneOfResult(advanceResult(otherwise)),
    ],
    lines: [
      `${ordinal(band.rank)}: the best ${bestSpots(band.spots, undefined)} → ${destinationLabel(band.destination, context.labels)}`,
      `${others(band.rooms - band.spots)} ${rest}`,
    ],
  };
}

/** One block for one band of a room: its stripe and its text, as the Bracket's exit pop-up words them. */
export function bandBlock(band: RoomExitBand, context: BlockContext): PictureBlock {
  if (band.kind === 'lucky-chance') return luckyBlock(band, context);
  if (band.kind === 'best-place') return bestPlaceBlock(band, context);
  const places = placesText(band.fromRank, endOf(band.toRank, context));
  switch (band.kind) {
    case 'advance':
      return single(
        toneOfResult(advanceResult(band)),
        `${places} → ${destinationLabel(band.destination, context.labels)}`,
      );
    case 'drop':
      return single('purple', `${places} → ${destinationLabel(band.destination, context.labels)}`);
    case 'eliminate':
      return band.placement ? single('neutral', `${places} play for places`) : single('red', `${places} out`);
    case 'promote':
      return single('green', `${places} → Room ${roomLetter(band.targetRoom)}`);
    case 'stay':
      return single('yellow', `${places} stay`);
    case 'demote':
      return single('orange', `${places} → Room ${roomLetter(band.targetRoom)}`);
  }
}

/** The Final, or a round with no exit: its room plays for places, 1st to its size. */
export function placesBlock(roomSize: number, toLast: boolean): PictureBlock {
  return single('neutral', `Places ${placesText(1, toLast ? 'last' : roomSize)}`);
}

/** The blocks of one room, in rank order. */
export function roomBlocks(bands: readonly RoomExitBand[], context: BlockContext): PictureBlock[] {
  return bands.map((band) => bandBlock(band, context));
}
