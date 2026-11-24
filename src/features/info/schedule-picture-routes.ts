import type { RoomExitBand, RoundExitRule } from '../../domain/tournament/room-exits';
import { advanceResult } from '../../domain/tournament/room-row-result';
import type { TournamentRound } from '../../domain/tournament/types';
import { toneOfResult } from './schedule-picture-bands';
import type { PictureTone } from './schedule-picture-types';

/** Players a round (or the pooling block) sends to a round of the bracket, under one colour. */
export interface Route {
  to: number;
  tone: PictureTone;
  count: number;
}

type PerRoomRule = Extract<RoundExitRule, { kind: 'per-room' }>;

/** How many rooms of the round have a lucky-chance band at a place. */
export function luckyRoomsAt(rooms: readonly (readonly RoomExitBand[])[]): (rank: number) => number {
  return (rank) =>
    rooms.filter((bands) => bands.some((band) => band.kind === 'lucky-chance' && band.rank === rank)).length;
}

/** Where a room's lucky-chance band sends its units: the room's advance band, else the round after (or its winners' target). */
export function luckyDestinationOf(
  round: Pick<TournamentRound, 'winnersTo'>,
  roundIndex: number,
  bands: readonly RoomExitBand[],
): number {
  const advance = bands.find((band) => band.kind === 'advance');
  return advance?.kind === 'advance' ? advance.destination : (round.winnersTo ?? roundIndex + 1);
}

const width = (band: { fromRank: number; toRank: number }) => band.toRank - band.fromRank + 1;

/**
 * The players a round sends on, by destination and colour: the band widths times the rooms that have the band, a
 * best-of-a-place and lucky places counted at their spots. Only reads the exit rule; it decides nothing.
 */
export function roundRoutes(
  round: Pick<TournamentRound, 'winnersTo'>,
  roundIndex: number,
  rule: PerRoomRule,
): Route[] {
  const routes = new Map<string, Route>();
  const add = (to: number, tone: PictureTone, count: number) => {
    if (count <= 0) return;
    const key = `${to}|${tone}`;
    const known = routes.get(key);
    if (known) known.count += count;
    else routes.set(key, { to, tone, count });
  };
  const luckyRooms = luckyRoomsAt(rule.rooms);
  const counted = new Set<string>();
  for (const bands of rule.rooms) {
    for (const band of bands) {
      if (band.kind === 'advance') add(band.destination, toneOfResult(advanceResult(band)), width(band));
      else if (band.kind === 'drop') add(band.destination, 'purple', width(band));
      else if (band.kind === 'promote') add(roundIndex + 1, 'green', width(band));
      else if (band.kind === 'stay') add(roundIndex + 1, 'yellow', width(band));
      else if (band.kind === 'demote') add(roundIndex + 1, 'orange', width(band));
      else if (band.kind === 'lucky-chance') {
        const key = `lucky|${band.rank}|${band.size ?? ''}`;
        if (counted.has(key)) continue;
        counted.add(key);
        add(luckyDestinationOf(round, roundIndex, bands), 'green', band.spots);
        if (band.otherwise !== 'eliminate')
          add(band.otherwise.drop, 'purple', luckyRooms(band.rank) - band.spots);
      } else if (band.kind === 'best-place') {
        if (counted.has('best')) continue;
        counted.add('best');
        add(band.destination, toneOfResult(advanceResult(band)), band.spots);
        if (band.otherwise !== 'eliminate') {
          add(band.otherwise.advance, toneOfResult(advanceResult(band.otherwise)), band.rooms - band.spots);
        }
      }
    }
  }
  return [...routes.values()];
}
