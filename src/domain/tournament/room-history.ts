import type { RoundAssignment, TournamentState } from './types';

/** Who has shared a room: the pair key, each pair's latest shared round, and the recent opponents and their parting after a pooling exit. */

/** The pairs that shared a room in any round up to `throughRoundIndex` (or in the ones `counts` accepts). */
export function metPairs(
  state: Pick<TournamentState, 'assignments'>,
  throughRoundIndex: number,
  counts: (roundIndex: number) => boolean = () => true,
): Set<string> {
  const met = new Set<string>();
  for (let roundIndex = 0; roundIndex <= throughRoundIndex; roundIndex += 1) {
    if (!counts(roundIndex)) continue;
    const byRoom = new Map<number, string[]>();
    for (const entry of state.assignments[roundIndex] ?? []) {
      if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    for (const names of byRoom.values()) {
      for (let first = 0; first < names.length; first += 1) {
        for (let second = first + 1; second < names.length; second += 1) {
          met.add(roomPairKey(names[first], names[second]));
        }
      }
    }
  }
  return met;
}

/**
 * A greedy pass over a seeding by exit order (the separation after a qualification table): in each room, a pair that has met before is parted by trading the
 * lower-ranked unit of the pair with the unit one rank below it in the exit order, then the one above, then the same
 * for the higher-ranked unit. A trade is made only between two rooms and only when it strictly lowers the number of
 * met pairs in them. A unit trades at most once, so it never moves more than one rank in the order.
 */
export function avoidMetPairsNearRank(
  input: RoundAssignment[],
  exitOrder: readonly string[],
  met: ReadonlySet<string>,
): RoundAssignment[] {
  const seeded = input.map((entry) => ({ ...entry }));
  const entryOf = new Map(seeded.map((entry) => [entry.name, entry]));
  const metIn = (room: number | null): Array<[RoundAssignment, RoundAssignment]> => {
    const inRoom = seeded.filter((entry) => entry.room === room);
    return inRoom
      .flatMap((first, index) =>
        inRoom.slice(index + 1).map((second): [RoundAssignment, RoundAssignment] => [first, second]),
      )
      .filter(([first, second]) => met.has(roomPairKey(first.name, second.name)));
  };
  const trade = (first: RoundAssignment, second: RoundAssignment) => {
    const rooms = [first.room, second.room];
    const before = metIn(rooms[0]).length + metIn(rooms[1]).length;
    [first.room, second.room] = [second.room, first.room];
    if (metIn(rooms[0]).length + metIn(rooms[1]).length < before) return true;
    [first.room, second.room] = [second.room, first.room];
    return false;
  };
  const traded = new Set<string>();
  const partOne = (room: number): boolean => {
    for (const pair of metIn(room)) {
      const [higher, lower] = [...pair].sort(
        (first, second) => exitOrder.indexOf(first.name) - exitOrder.indexOf(second.name),
      );
      for (const mover of [lower, higher]) {
        if (traded.has(mover.name)) continue;
        const rank = exitOrder.indexOf(mover.name);
        for (const neighbour of [exitOrder[rank + 1], exitOrder[rank - 1]]) {
          const other = neighbour === undefined ? undefined : entryOf.get(neighbour);
          if (!other || other.room === null || other.room === mover.room || traded.has(other.name)) continue;
          if (trade(mover, other)) {
            traded.add(mover.name).add(other.name);
            return true;
          }
        }
      }
    }
    return false;
  };
  for (const room of [...new Set(seeded.map((entry) => entry.room))]) {
    if (room === null) continue;
    while (partOne(room)) continue;
  }
  return seeded;
}

export function roomPairKey(first: string, second: string): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

/**
 * Records every co-occurring pair in `seeded` (skipping byes, room:null)
 * against `targetRoundIndex` -- the round `seeded` actually belongs to, not
 * the round being advanced from. Only the most recent shared round is kept
 * per pair (not a full occurrence log), which is exactly what
 * `recencyWeight` needs. Pure -- returns a fresh object.
 */
export function recordRoomHistory(
  roomHistory: Record<string, number>,
  seeded: RoundAssignment[],
  targetRoundIndex: number,
): Record<string, number> {
  const updated = { ...roomHistory };
  const byRoom = new Map<number, string[]>();
  for (const assignment of seeded) {
    if (assignment.room === null) continue;
    byRoom.set(assignment.room, [...(byRoom.get(assignment.room) ?? []), assignment.name]);
  }
  for (const names of byRoom.values()) {
    for (let first = 0; first < names.length; first += 1) {
      for (let second = first + 1; second < names.length; second += 1) {
        updated[roomPairKey(names[first], names[second])] = targetRoundIndex;
      }
    }
  }
  return updated;
}

/**
 * Undoes `roundIndex`'s contribution to `roomHistory` after that round's
 * line-up is discarded or changed. A pair's entry is the round index it MOST
 * RECENTLY shared a room in, so only entries pointing at `roundIndex` came
 * from the discarded draw: a scratch replay over rounds 0..roundIndex-1 finds
 * each such pair's next-most-recent meeting, if it has one, else the entry is
 * dropped. Every other entry (any round's, including one built under
 * drawPublication: 'fixed', which never called `recordRoomHistory`) is left
 * exactly as it was. Pure -- returns a fresh object.
 */
export function rewindRoomHistory(
  roomHistory: Record<string, number>,
  assignments: RoundAssignment[][],
  roundIndex: number,
): Record<string, number> {
  let scratch: Record<string, number> = {};
  for (let index = 0; index < roundIndex; index += 1) {
    scratch = recordRoomHistory(scratch, assignments[index] ?? [], index);
  }
  const rewound = { ...roomHistory };
  for (const [key, recorded] of Object.entries(roomHistory)) {
    if (recorded !== roundIndex) continue;
    if (key in scratch) rewound[key] = scratch[key];
    else delete rewound[key];
  }
  return rewound;
}
