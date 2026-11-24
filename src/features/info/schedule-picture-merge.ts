import { matchesText, roomGroupLabel, sizesText } from './schedule-picture-text';
import type { RoundPicture } from './schedule-picture-round';
import type { PictureRoomGroup } from './schedule-picture-types';

/** What two rounds of one column must share to be drawn as one card: their format and their one group of rooms and blocks. */
export function mergeKey(round: RoundPicture): string {
  if (round.groups.length !== 1) return `alone:${round.index}`;
  const [group] = round.groups;
  return JSON.stringify([round.format, [...new Set(group.sizes)].sort(), group.blocks]);
}

/**
 * The name of a card of several rounds: the shared words, then the last words ("Round 6 · B, C") when the labels differ
 * only in their last word, else the labels joined.
 */
export function mergedName(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0];
  const words = labels.map((label) => label.split(' '));
  const shared = words[0].slice(0, -1);
  const alike = words.every(
    (parts) =>
      parts.length === words[0].length &&
      parts.length > 1 &&
      parts.slice(0, -1).join(' ') === shared.join(' '),
  );
  if (!alike) return labels.join(' · ');
  return `${shared.join(' ')} · ${words.map((parts) => parts.at(-1)).join(', ')}`;
}

/** How many rooms the rounds hold together. */
export function roomCount(rounds: readonly RoundPicture[]): number {
  return rounds.reduce((sum, round) => sum + round.rooms.length, 0);
}

/** The sub line of a card: the room sizes and the match format; with room labels, the format alone. */
export function subLine(rounds: readonly RoundPicture[], team: boolean): string {
  const [first] = rounds;
  if (first.groups.length > 1) return first.format;
  const rooms = rounds.flatMap((round) => round.rooms);
  const sizes = rooms.length
    ? sizesText(rooms, team)
    : matchesText(rounds.reduce((sum, round) => sum + round.matches, 0));
  return `${sizes} · ${first.format}`;
}

/** The groups of a card: the blocks alone for one group, else each group under its room label. */
export function cardGroups(rounds: readonly RoundPicture[], team: boolean): PictureRoomGroup[] {
  const [first] = rounds;
  if (first.groups.length === 1) return [{ label: null, blocks: first.groups[0].blocks }];
  return first.groups.map((group) => ({
    label: roomGroupLabel(group.rooms, group.sizes, team),
    blocks: group.blocks,
  }));
}
