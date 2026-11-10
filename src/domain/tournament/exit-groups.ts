import { rankingRoomsLast, roundColumn } from './round-columns';
import type { TournamentRound, TournamentState } from './types';
import { declaredWaterfallRooms } from './waterfall-bracket';

/**
 * Which destinations of a round are "the same": players going on in the same conditions share a group, in every
 * room of the round and of the rounds played in its column. Group 0 is the column's first destination, 1 the next one in other conditions, and so on.
 * A ranking round (`waterfallRanking`) is no group: units routed there play for places and read as such, not as a colour.
 * Display only (the exit colours); nothing here decides an advancement. It reads the declared routes, never the
 * drawn bands, so a removal that shrinks a room cannot change the colours of the round.
 */

type Route = number | 'eliminated';

/** Two destinations whose average place taken from the same source differs by at most this many places are alike. */
const SIMILAR_PLACE_GAP = 1;

/** Rooms of two destinations differ in size by at most this many seats. */
const SIMILAR_ROOM_SIZE_GAP = 1;

/** Absorbs the rounding of an average, so a gap of exactly `SIMILAR_PLACE_GAP` still counts as alike. */
const GAP_TOLERANCE = 1e-9;

/** A destination's source: a feeder round's rooms taken together, or a round's standings routes. */
function sourceKey(kind: 'round' | 'standings', roundIndex: number): string {
  return `${kind}:${roundIndex}`;
}

/** Records the places of one source (a place is a rank in its room, or in the standings) that route to `destination`. */
function placesTaken(
  intake: Map<string, number[]>,
  key: string,
  routes: ReadonlyArray<ReadonlyArray<Route>>,
  destination: number,
): void {
  const places: number[] = [];
  for (const room of routes) {
    room.forEach((route, index) => {
      if (route === destination) places.push(index + 1);
    });
  }
  if (places.length > 0) intake.set(key, places);
}

/** The average place taken from each source that sends units to `destination`. */
function intakeAverages(state: TournamentState, destination: number): Map<string, number> {
  const intake = new Map<string, number[]>();
  state.rounds.forEach((round, roundIndex) => {
    if (round.waterfallRoutes) {
      placesTaken(intake, sourceKey('round', roundIndex), round.waterfallRoutes, destination);
    }
    if (round.standingsRoutes) {
      placesTaken(intake, sourceKey('standings', roundIndex), [round.standingsRoutes], destination);
    }
  });
  const averages = new Map<string, number>();
  for (const [key, places] of intake) {
    averages.set(key, places.reduce((sum, place) => sum + place, 0) / places.length);
  }
  return averages;
}

/** A room's routes without its trailing eliminated entries: where its last units actually go. */
function withoutTrailingElimination(routes: ReadonlyArray<Route>): Route[] {
  let end = routes.length;
  while (end > 0 && routes[end - 1] === 'eliminated') end -= 1;
  return routes.slice(0, end);
}

function similarRooms(first: TournamentRound, second: TournamentRound): boolean {
  const firstRooms = declaredWaterfallRooms(first);
  const secondRooms = declaredWaterfallRooms(second);
  return (
    firstRooms.length === secondRooms.length &&
    firstRooms.every((size, room) => Math.abs(size - secondRooms[room]) <= SIMILAR_ROOM_SIZE_GAP)
  );
}

function sameExits(first: TournamentRound, second: TournamentRound): boolean {
  const firstRoutes = first.waterfallRoutes ?? [];
  const secondRoutes = second.waterfallRoutes ?? [];
  if (firstRoutes.length !== secondRoutes.length) return false;
  return firstRoutes.every((room, index) => {
    const left = withoutTrailingElimination(room);
    const right = withoutTrailingElimination(secondRoutes[index]);
    return left.length === right.length && left.every((route, rank) => route === right[rank]);
  });
}

function similarIntake(state: TournamentState, first: number, second: number): boolean {
  const firstAverages = intakeAverages(state, first);
  const secondAverages = intakeAverages(state, second);
  if (firstAverages.size !== secondAverages.size) return false;
  for (const [key, average] of firstAverages) {
    const other = secondAverages.get(key);
    if (other === undefined || Math.abs(average - other) > SIMILAR_PLACE_GAP + GAP_TOLERANCE) return false;
  }
  return true;
}

/** Whether units going to round `first` and units going to round `second` go on in the same conditions. */
function sameConditions(state: TournamentState, first: number, second: number): boolean {
  const firstRound = state.rounds[first];
  const secondRound = state.rounds[second];
  if (!firstRound || !secondRound || firstRound.isFinal || secondRound.isFinal) return false;
  return (
    similarRooms(firstRound, secondRound) &&
    sameExits(firstRound, secondRound) &&
    similarIntake(state, first, second)
  );
}

/** Each destination's group, reading `routes` in order. */
export function exitGroups(state: TournamentState, routes: ReadonlyArray<Route>): Map<number, number> {
  const groups = new Map<number, number>();
  let nextGroup = 0;
  for (const route of routes) {
    if (route === 'eliminated' || groups.has(route) || state.rounds[route]?.waterfallRanking) continue;
    const alike = [...groups.keys()].find((read) => sameConditions(state, read, route));
    if (alike === undefined) {
      groups.set(route, nextGroup);
      nextGroup += 1;
    } else {
      groups.set(route, groups.get(alike) ?? 0);
    }
  }
  return groups;
}

/** The routes of every round played in the column of `roundIndex`, in the order the Bracket shows the column's rounds. */
function columnRoutes(state: TournamentState, roundIndex: number): Route[] {
  const { start, end } = roundColumn(state.rounds, roundIndex);
  return rankingRoomsLast(state.rounds, start, end).flatMap(
    (index) => state.rounds[index].waterfallRoutes?.flat() ?? [],
  );
}

/**
 * The groups of a round's exits: the routes of every round of its column (so a destination has one group in every
 * room and round of the column), or its standings routes. Empty for any other round.
 */
export function roundExitGroups(state: TournamentState, roundIndex: number): Map<number, number> {
  const round = state.rounds[roundIndex];
  if (round?.waterfallRoutes) return exitGroups(state, columnRoutes(state, roundIndex));
  if (round?.standingsRoutes) return exitGroups(state, round.standingsRoutes);
  return new Map();
}
