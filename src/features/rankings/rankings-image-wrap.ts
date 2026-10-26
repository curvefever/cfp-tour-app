/** The width of a text in the font the caller has chosen (the canvas's `measureText(...).width`, a fake in tests). */
export type Measure = (text: string) => number;

/** What stands between two members on a line, as on the page. */
export const MEMBER_SEPARATOR = ' · ';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The characters of `text` as they are seen: an emoji, a flag or an accented letter stays whole. */
function visibleCharacters(text: string): string[] {
  return Array.from(graphemes.segment(text), ({ segment }) => segment);
}

/** `base` cut, between whole characters, so that it and an ellipsis fit the width. */
function withEllipsis(measure: Measure, base: string, width: number): string {
  const characters = visibleCharacters(base);
  const cut = (length: number) => `${characters.slice(0, length).join('').trimEnd()}…`;
  let length = characters.length;
  while (length > 0 && measure(cut(length)) > width) length--;
  return cut(length);
}

/**
 * Fills lines with the units in order, `separator` between the units of one line. A unit wider than a line is
 * handed to `splitWide`, which gives its own lines. Past `maxLines` the last allowed line is cut with an ellipsis.
 */
function pack(
  measure: Measure,
  units: readonly string[],
  separator: string,
  width: number,
  maxLines: number,
  splitWide: (unit: string) => string[],
): string[] {
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };
  for (const unit of units) {
    if (measure(unit) > width) {
      flush();
      lines.push(...splitWide(unit));
      continue;
    }
    const joined = current ? `${current}${separator}${unit}` : unit;
    if (!current || measure(joined) <= width) {
      current = joined;
    } else {
      flush();
      current = unit;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), withEllipsis(measure, lines[maxLines - 1], width)];
}

/** A text wrapped at its spaces; a word wider than a line is cut with an ellipsis, text beyond `maxLines` too. */
export function wrapText(measure: Measure, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  return pack(measure, words, ' ', width, maxLines, (word) => [withEllipsis(measure, word, width)]);
}

/**
 * Members wrapped between members only: a member never starts on one line and ends on the next, and no line starts
 * or ends with the separator. A member wider than a line is wrapped at its own spaces, on lines of its own.
 */
export function wrapMembers(
  measure: Measure,
  members: readonly string[],
  width: number,
  maxLines: number,
): string[] {
  return pack(
    measure,
    members.filter((member) => member.trim()),
    MEMBER_SEPARATOR,
    width,
    maxLines,
    (member) => wrapText(measure, member, width, maxLines),
  );
}
