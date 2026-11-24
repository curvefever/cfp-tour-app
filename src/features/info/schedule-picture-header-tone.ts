import type { PictureTone } from './schedule-picture-types';

/** The most favourable first: green, yellow, orange, purple, then neutral. */
const FAVOUR: PictureTone[] = ['green', 'yellow', 'orange', 'purple', 'neutral'];

/** What sends players to a round: the column of the sender (the pooling block is column -1) and the tone of the band. */
export interface Feed {
  column: number;
  tone: PictureTone;
}

/**
 * The header colour of a round: the tone its earliest feeding column sends it under, the most favourable when that
 * column has several bands into it. A round nothing routes into is green.
 */
export function headerTone(feeds: readonly Feed[]): PictureTone {
  if (feeds.length === 0) return 'green';
  const earliest = Math.min(...feeds.map((feed) => feed.column));
  const tones = feeds.filter((feed) => feed.column === earliest).map((feed) => feed.tone);
  return FAVOUR.find((tone) => tones.includes(tone)) ?? 'green';
}
