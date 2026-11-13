import { unitsAwaitingAnswer } from './absences';
// Room-result helpers only (job 2 of the cleanup audit's C2-1 split of advancement.ts): the present units of a room,
// a unit's share of its room's average, and the equality of two shares.
import { relativeRoomShare, sameRoomShare, scoreRoom } from './advancement';
import { comparableRoomTotal, isRoomScored, orderRoomWithPlaces, readTieResolution } from './scoring';
import type { TournamentRound, TournamentState } from './types';

/**
 * "The best n of the k-th places go to round X" (`TournamentRound.waterfallBest`): who goes. It is worked out from the
 * scores and the tie decision every time and never stored, so routing, replay, Previous, the expected draw and the
 * Bracket all read the same answer. The rest of that place follow their rooms' own lines.
 */

/** One unit at the best place of a room, with its score relative to the room's average. */
export interface BestCandidate {
  name: string;
  room: number;
  share: number;
  /** False for a room whose points are all zero (or not scored yet): its candidate ranks after every scored one. */
  hasPoints: boolean;
}

/** Candidates with exactly the same share straddling the cut: the organiser picks `spots` of them. */
export interface BestPlaceTie {
  key: string;
  players: BestCandidate[];
  rm: null;
  place: number;
  /** How many of the tied units still get through. */
  spots: number;
  /** The round they would go to. */
  destination: number;
}

export interface BestPlaceChoice {
  /** Best first, after the tie decision. */
  candidates: BestCandidate[];
  chosen: string[];
  rest: string[];
  /** The card the organiser must settle, or null (none, or a room still being scored). */
  tie: BestPlaceTie | null;
}

/** The key the organiser's decision on a round's best-place tie is stored under. */
export function bestPlaceTieKey(roundIndex: number): string {
  return `r${roundIndex}-best`;
}

function candidatesAt(state: TournamentState, roundIndex: number, round: TournamentRound, place: number) {
  const candidates: BestCandidate[] = [];
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const present = scoreRoom(state, roundIndex, room, 0);
    const hasPoints = comparableRoomTotal(present) > 0;
    for (const { entry, place: held } of orderRoomWithPlaces(present, roundIndex, room, state)) {
      if (held !== place) continue;
      candidates.push({ name: entry.name, room, share: relativeRoomShare(entry, present), hasPoints });
    }
  }
  return candidates;
}

/** Best first: rooms with points before rooms without, then the higher share; the same share goes by room order. */
function compareCandidates(first: BestCandidate, second: BestCandidate): number {
  if (first.hasPoints !== second.hasPoints) return first.hasPoints ? -1 : 1;
  if (first.hasPoints && !sameRoomShare(first.share, second.share)) return second.share - first.share;
  return first.room - second.room || first.name.localeCompare(second.name);
}

/** Where, in `ordered`, the run of equal shares that the cut after `count` units falls inside begins and ends. */
function straddlingRun(ordered: BestCandidate[], count: number): { start: number; end: number } | null {
  const first = ordered[count - 1];
  const next = ordered[count];
  if (!first?.hasPoints || !next?.hasPoints || !sameRoomShare(first.share, next.share)) return null;
  let start = count - 1;
  while (start > 0 && sameRoomShare(ordered[start - 1].share, first.share)) start -= 1;
  let end = count;
  while (end + 1 < ordered.length && sameRoomShare(ordered[end + 1].share, first.share)) end += 1;
  return { start, end: end + 1 };
}

/** Whether every room that has a place-th seat is fully scored and has no absence question open. */
function roomsAreComplete(state: TournamentState, roundIndex: number, round: TournamentRound, place: number) {
  return round.rooms.every(
    (size, index) =>
      size < place ||
      (isRoomScored(state, roundIndex, index + 1) &&
        unitsAwaitingAnswer(state, roundIndex, index + 1).size === 0),
  );
}

/** The run with the organiser's picks first, in the order they were made, then the others as they were. */
function withPicksFirst(run: BestCandidate[], picked: string[]): BestCandidate[] {
  const inRun = new Map(run.map((candidate) => [candidate.name, candidate]));
  const picks = picked.flatMap((name) => inRun.get(name) ?? []);
  return [...picks, ...run.filter((candidate) => !picks.includes(candidate))];
}

/**
 * Who a round's BEST line sends on, or null for a round without one. `round` is the round whose line is read
 * (a caller replaying an edited graph passes its edited round). Absentees are never candidates; a room without a
 * seat at the place offers none, and fewer candidates than the line asks for all go.
 */
export function bestPlaceChoice(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound | undefined = state.rounds[roundIndex],
): BestPlaceChoice | null {
  const best = round?.waterfallBest;
  if (!round || !best) return null;
  const sorted = candidatesAt(state, roundIndex, round, best.place).sort(compareCandidates);
  const key = bestPlaceTieKey(roundIndex);
  const run = straddlingRun(sorted, best.count);
  const ordered = run
    ? [
        ...sorted.slice(0, run.start),
        ...withPicksFirst(sorted.slice(run.start, run.end), readTieResolution(state, key).ranked),
        ...sorted.slice(run.end),
      ]
    : sorted;
  const tie =
    run && roomsAreComplete(state, roundIndex, round, best.place)
      ? {
          key,
          players: sorted.slice(run.start, run.end),
          rm: null,
          place: best.place,
          spots: best.count - run.start,
          destination: best.destination,
        }
      : null;
  return {
    candidates: ordered,
    chosen: ordered.slice(0, best.count).map(({ name }) => name),
    rest: ordered.slice(best.count).map(({ name }) => name),
    tie,
  };
}

/** The best-place tie of a round that the organiser has to settle, or null. */
export function bestPlaceTie(state: TournamentState, roundIndex: number): BestPlaceTie | null {
  return bestPlaceChoice(state, roundIndex)?.tie ?? null;
}
