import { roomLetter } from '../../domain/tournament/bracket';
import { ordinal } from '../../lib/ordinal';

/** "1st–4th", "5th", "5th–last": the places of a band; `last` is the end of rooms of different sizes. */
export function placesText(from: number, to: number | 'last'): string {
  if (to === 'last') return `${ordinal(from)}–last`;
  return from === to ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`;
}

/** "8p", "8p and 7p", "8p, 7p and 6p"; in team formats "4 teams", "4 and 3 teams". */
function joined(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The distinct room sizes, largest first, and "each" when several rooms are all of one size. */
export function sizesText(rooms: readonly number[], team: boolean): string {
  const distinct = [...new Set(rooms)].sort((first, second) => second - first);
  const each = rooms.length > 1 && distinct.length === 1 ? ' each' : '';
  if (!team) return `${joined(distinct.map((size) => `${size}p`))}${each}`;
  const noun = distinct.length === 1 && distinct[0] === 1 ? 'team' : 'teams';
  return `${joined(distinct.map(String))} ${noun}${each}`;
}

/** "6 matches", "1 match": a round of matches, which has no rooms. */
export function matchesText(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

/** "Room A · 8p", "Rooms B–D · 7p each", "Rooms B, D · 8p and 7p": a group of rooms that exit alike. `rooms` are 0-based. */
export function roomGroupLabel(rooms: readonly number[], sizes: readonly number[], team: boolean): string {
  const contiguous = rooms.every((room, index) => index === 0 || room === rooms[index - 1] + 1);
  const names =
    rooms.length === 1
      ? `Room ${roomLetter(rooms[0] + 1)}`
      : `Rooms ${contiguous ? `${roomLetter(rooms[0] + 1)}–${roomLetter(rooms.at(-1)! + 1)}` : rooms.map((room) => roomLetter(room + 1)).join(', ')}`;
  return `${names} · ${sizesText(sizes, team)}`;
}
