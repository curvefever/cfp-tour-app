import type { Measure } from './rankings-image-wrap';

const FONT = 'Asap, sans-serif';

// The weights the image draws with, as the page loads them (400, 700, 800); the sizes only name the font.
export const FONTS = {
  label: `800 13px ${FONT}`,
  title: `800 32px ${FONT}`,
  date: `400 16px ${FONT}`,
  count: `700 16px ${FONT}`,
  rank: `800 15px ${FONT}`,
  name: `700 15px ${FONT}`,
  where: `400 13px ${FONT}`,
  ordinalFirst: `800 52px ${FONT}`,
  ordinalOther: `800 40px ${FONT}`,
  cardName: `700 24px ${FONT}`,
  cardSmall: `400 14px ${FONT}`,
};

// The game look's colours (styles.css, `--color-cfp-*`).
export const COLORS = {
  page: '#11233b',
  rowGrounds: ['#113148', '#0b253a'],
  brand: '#34a3ce',
  text: '#cce6f7',
  muted: '#8fb3cc',
  cardGround: '#102e44',
  frame: '#014560',
  red: '#e0353d',
  medals: { gold: '#e8b923', silver: '#b8c4cc', bronze: '#c27c3e' },
};

/** A measuring function for `font`: it sets the font on the context, then measures. */
export function measurer(context: CanvasRenderingContext2D, font: string): Measure {
  return (text) => {
    context.font = font;
    return context.measureText(text).width;
  };
}
