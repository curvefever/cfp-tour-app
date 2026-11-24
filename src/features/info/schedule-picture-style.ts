import type { PictureTone } from './schedule-picture-types';

const FONT = 'Asap, sans-serif';

/** The weights the picture draws with, as the page loads them (400, 600, 700, 800); the sizes are the picture's. */
export const PICTURE_FONTS = {
  title: `800 26px ${FONT}`,
  formatLine: `600 15px ${FONT}`,
  cardName: `700 13px ${FONT}`,
  tag: `700 12px ${FONT}`,
  sub: `400 12px ${FONT}`,
  groupLabel: `700 11px ${FONT}`,
  block: `400 12px ${FONT}`,
  poolingLine: `400 12px ${FONT}`,
  poolingBold: `700 12px ${FONT}`,
} as const;

export type PictureFont = keyof typeof PICTURE_FONTS;

/** The game look's colours (`styles.css`, `--color-cfp-*`); the stripe tones are the ones `ResultStripe` uses. */
export const PICTURE_COLORS = {
  page: '#11233b',
  card: '#102e44',
  rowGrounds: ['#113148', '#0b253a'],
  ink: '#0b1a2c',
  title: '#ffffff',
  text: '#cce6f7',
  muted: '#8fb3cc',
  brand: '#34a3ce',
} as const;

export type PictureColor = Exclude<keyof typeof PICTURE_COLORS, 'rowGrounds'>;

/** The stripe and header colour of each tone: the Bracket's exit colours. */
export const TONE_COLORS: Record<PictureTone, string> = {
  green: '#48e271',
  yellow: '#f2cf3a',
  orange: '#fc8a14',
  purple: '#9b6be0',
  red: '#e0353d',
  neutral: '#6f8da1',
};
