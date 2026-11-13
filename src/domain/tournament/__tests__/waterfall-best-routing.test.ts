import { describe, expect, it } from 'vitest';
import { answerAbsence, unitsAwaitingAnswer } from '../absences';
import { getAllTies, hasPendingTies, invalidateStaleTieResolutions, isTieResolved } from '../advancement';
import { bestPlaceChoice, bestPlaceTieKey } from '../best-place';
import { routeWaterfallRound } from '../bracket-replay';
import { expectedRounds } from '../expected-draw';
import { resolveTournamentTie } from '../mutations';
import { createDefaultTournamentState } from '../state-defaults';
import { scoreKeysForPosition } from '../scoring';
import type { TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { canGoBack, goBack, nextRoundPlan } from '../waterfall-steps';
import { expectConsistent, removeChecked } from './consistency';
import { atEntry, indexOf, pressed } from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';
import { buildAssignments, buildRound } from './test-fixtures';

/**
 * "The best n of the k-th places": who goes (`bestPlaceChoice`), the tie card that settles a straddled cut, and
 * every path that routes it (`plans/2026-11-13-best-of-a-place.md`, stage 2).
 */

const OUT = 'eliminated';
/** Rooms of 8: places 1-5 to round 2, the 6th is the BEST place, 7-8 out. */
const ROOM_ROUTES = [1, 1, 1, 1, 1, OUT, OUT, OUT] as const;

/** Three rooms' scores, best first by seat. The 6th places' shares of their rooms' averages: A .67, B .76, C .79. */
const A = [80, 70, 60, 50, 40, 30, 20, 10];
const B = [80, 70, 60, 50, 40, 35, 20, 15];
const C = [85, 70, 60, 50, 40, 36, 15, 8];
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];

/** A room's scores, or null while it has none. */
type RoomScores = number[] | null;

const seatName = (room: number, position: number) => `W${(room - 1) * 8 + position + 1}`;
const sixth = (room: number) => seatName(room, 5);

interface Built {
  count?: number;
  restTo?: number | typeof OUT;
  absent?: Array<[room: number, position: number]>;
}

/** Three rooms of 8 in a hand-written round 1 that routes places 1-5 on and has the BEST line `n OF 6`. */
function threeRooms(rooms: RoomScores[], built: Built = {}): TournamentState {
  const players = Array.from({ length: 24 }, (_, index) => `W${index + 1}`);
  const scores: Record<string, number> = {};
  rooms.forEach((roomScores, index) => {
    roomScores?.forEach((score, position) => {
      scores[`r0-rm${index + 1}-p${position}`] = score;
    });
  });
  const routes = ROOM_ROUTES.map((route, place) => (place === 5 ? (built.restTo ?? OUT) : route));
  const state = createDefaultTournamentState({
    players,
    gamemodeConfig: { absenceVersion: 2 },
    rounds: [
      buildRound({
        roundNum: 1,
        rooms: [8, 8, 8],
        players: 24,
        isWaterfall: true,
        waterfallRoutes: [routes, routes, routes],
        waterfallBest: { place: 6, count: built.count ?? 1, destination: 1 },
      }),
      buildRound({ roundNum: 2, rooms: [8, 8], players: 16 }),
      buildRound({ roundNum: 3, rooms: [2], players: 2 }),
    ],
    assignments: [buildAssignments(players, [8, 8, 8])],
    scores,
    started: true,
  });
  const absentKeys = (built.absent ?? []).map(([room, position]) => `r0-rm${room}-p${position}`);
  if (absentKeys.length === 0) return state;
  const zeroed = Object.fromEntries(absentKeys.map((key) => [key, 0]));
  return answerAbsence({ ...state, scores: { ...state.scores, ...zeroed } }, absentKeys, 'absent');
}

const chosenOf = (state: TournamentState) => bestPlaceChoice(state, 0)?.chosen;

describe('who the best of a place sends on', () => {
  it('is nothing for a round with no BEST line', () => {
    const state = threeRooms([A, B, C]);
    const plain = {
      ...state,
      rounds: [{ ...state.rounds[0], waterfallBest: undefined }, ...state.rounds.slice(1)],
    };
    expect(bestPlaceChoice(plain, 0)).toBeNull();
  });

  it('is the 6th place with the highest score relative to its room, the others being the rest', () => {
    const choice = bestPlaceChoice(threeRooms([A, B, C]), 0);
    expect(choice?.chosen).toEqual([sixth(3)]);
    expect(choice?.rest).toEqual([sixth(2), sixth(1)]);
    expect(choice?.candidates.map((candidate) => candidate.name)).toEqual([sixth(3), sixth(2), sixth(1)]);
    expect(choice?.tie).toBeNull();
  });

  it('does not depend on the order of the rooms', () => {
    expect(chosenOf(threeRooms([C, A, B]))).toEqual([sixth(1)]);
    expect(chosenOf(threeRooms([B, C, A]))).toEqual([sixth(2)]);
  });

  it('sends the best n when the line asks for more than one', () => {
    const choice = bestPlaceChoice(threeRooms([A, B, C], { count: 2 }), 0);
    expect(choice?.chosen).toEqual([sixth(3), sixth(2)]);
    expect(choice?.rest).toEqual([sixth(1)]);
  });

  it('ranks a room with no points last, even though its relative score would be average', () => {
    const choice = bestPlaceChoice(threeRooms([ZEROS, B, C]), 0);
    expect(choice?.chosen).toEqual([sixth(3)]);
    expect(choice?.candidates.map((candidate) => candidate.name)).toEqual([sixth(3), sixth(2), sixth(1)]);
    expect(choice?.tie).toBeNull();
  });

  it('ranks a room not scored yet last (Next Round sends a round as it stands)', () => {
    expect(chosenOf(threeRooms([null, B, C]))).toEqual([sixth(3)]);
    expect(chosenOf(threeRooms([A, B, null]))).toEqual([sixth(2)]);
  });

  it('settles two rooms with no points by room order, with no card', () => {
    const choice = bestPlaceChoice(threeRooms([ZEROS, ZEROS, ZEROS]), 0);
    expect(choice?.chosen).toEqual([sixth(1)]);
    expect(choice?.tie).toBeNull();
  });

  it('never takes an absentee: a room left with fewer than 6 present offers no candidate', () => {
    const absent: Built['absent'] = [3, 4, 5].map((position) => [3, position]);
    const choice = bestPlaceChoice(threeRooms([A, B, C], { absent }), 0);
    expect(choice?.candidates.map((candidate) => candidate.name)).toEqual([sixth(2), sixth(1)]);
    expect(choice?.chosen).toEqual([sixth(2)]);
  });

  it('keeps an absentee on its own room line when a v2 tournament routes it', () => {
    const state = threeRooms([A, B, C], { absent: [3, 4, 5].map((position) => [3, position]) });
    const routed = routeWaterfallRound(state, 0, state.rounds[0]);
    const names = (routed.get(1) ?? []).map((seed) => seed.name);
    expect(names).toContain(sixth(2));
    expect(names).not.toContain(sixth(1));
    expect(names).not.toContain(seatName(3, 5));
  });
});

describe('the tie of a best place', () => {
  const tied = () => threeRooms([A, B, B]);

  it('is a card once every room is complete and equal shares straddle the cut', () => {
    const state = tied();
    const tie = getAllTies(state, 0)[bestPlaceTieKey(0)];
    expect(tie).toMatchObject({ rm: null, place: 6, spots: 1, destination: 1 });
    expect(tie?.players.map((player) => player.name)).toEqual([sixth(2), sixth(3)]);
    expect(hasPendingTies(state, 0)).toBe(true);
  });

  it('is written by one key', () => {
    expect(bestPlaceTieKey(0)).toBe('r0-best');
    expect(bestPlaceTieKey(12)).toBe('r12-best');
  });

  it('is no card while a room is still being scored', () => {
    const state = threeRooms([A, B, B.slice(0, 7)]);
    expect(getAllTies(state, 0)[bestPlaceTieKey(0)]).toBeUndefined();
    expect(hasPendingTies(state, 0)).toBe(false);
  });

  it('is no card while a room has no scores', () => {
    expect(getAllTies(threeRooms([A, B, null]), 0)[bestPlaceTieKey(0)]).toBeUndefined();
  });

  it('is no card when the equal shares are both inside the cut, or both outside it', () => {
    expect(getAllTies(threeRooms([A, B, B], { count: 3 }), 0)[bestPlaceTieKey(0)]).toBeUndefined();
    expect(getAllTies(threeRooms([B, B, C]), 0)[bestPlaceTieKey(0)]).toBeUndefined();
  });

  it('is a card for the one spot left when the cut falls inside the tied shares', () => {
    const state = threeRooms([C, B, B], { count: 2 });
    const tie = bestPlaceChoice(state, 0)?.tie;
    expect(tie?.spots).toBe(1);
    expect(tie?.players.map((player) => player.name)).toEqual([sixth(2), sixth(3)]);
  });

  it('puts the organiser’s pick first and the others after it', () => {
    const state = tied();
    expect(chosenOf(state)).toEqual([sixth(2)]);
    const picked = resolveTournamentTie(state, bestPlaceTieKey(0), sixth(3));
    expect(chosenOf(picked)).toEqual([sixth(3)]);
    expect(hasPendingTies(picked, 0)).toBe(false);
    const tie = getAllTies(picked, 0)[bestPlaceTieKey(0)];
    expect(tie && isTieResolved(bestPlaceTieKey(0), tie, picked)).toBe(true);
  });

  it('needs one pick per spot, not one per tied unit but one', () => {
    const state = threeRooms([B, B, B]);
    const tie = getAllTies(state, 0)[bestPlaceTieKey(0)];
    expect(tie?.players).toHaveLength(3);
    expect(tie && isTieResolved(bestPlaceTieKey(0), tie, state)).toBe(false);
    const picked = resolveTournamentTie(state, bestPlaceTieKey(0), sixth(2));
    expect(hasPendingTies(picked, 0)).toBe(false);
    expect(chosenOf(picked)).toEqual([sixth(2)]);
  });

  it('drops a decision when a score edit breaks the tie', () => {
    const picked = resolveTournamentTie(tied(), bestPlaceTieKey(0), sixth(3));
    const edited = { ...picked, scores: { ...picked.scores, 'r0-rm3-p5': 50 } };
    expect(invalidateStaleTieResolutions(edited, 0, 3).tieResolutions[bestPlaceTieKey(0)]).toBeUndefined();
  });

  it('keeps a decision while the same units are still tied', () => {
    const picked = resolveTournamentTie(tied(), bestPlaceTieKey(0), sixth(3));
    expect(invalidateStaleTieResolutions(picked, 0, 3)).toBe(picked);
  });

  it('drops a decision when a room is no longer complete', () => {
    const picked = resolveTournamentTie(tied(), bestPlaceTieKey(0), sixth(3));
    const { 'r0-rm3-p7': _removed, ...scores } = picked.scores;
    expect(
      invalidateStaleTieResolutions({ ...picked, scores }, 0, 3).tieResolutions[bestPlaceTieKey(0)],
    ).toBeUndefined();
  });
});

/**
 * Room B and room C have the same share at the 6th place (35 of a room total of 367) while C's last two seats are 0:
 * unscored, then scored 0 with the bar's question open, then answered. Only completeness makes the difference.
 */
describe('the tie card waits for a room to be complete', () => {
  const B_EQUAL = [80, 70, 60, 50, 40, 35, 17, 15];
  const C_EQUAL = [100, 90, 66, 40, 36, 35, 0, 0];
  const lastTwoOfC = ['r0-rm3-p6', 'r0-rm3-p7'];
  const cardOf = (state: TournamentState) => getAllTies(state, 0)[bestPlaceTieKey(0)];
  const withoutLastTwoOfC = (state: TournamentState): TournamentState => {
    const scores = { ...state.scores };
    for (const key of lastTwoOfC) delete scores[key];
    return { ...state, scores };
  };

  it('shows the card once the room is scored and its 0s are answered', () => {
    const answered = answerAbsence(threeRooms([A, B_EQUAL, C_EQUAL]), lastTwoOfC, 'played');
    expect(cardOf(answered)?.players.map((player) => player.name)).toEqual([sixth(2), sixth(3)]);
  });

  it('holds the card back while a seat of the room with the 6th place has no score', () => {
    const partly = withoutLastTwoOfC(threeRooms([A, B_EQUAL, C_EQUAL]));
    expect(cardOf(partly)).toBeUndefined();
    expect(hasPendingTies(partly, 0)).toBe(false);
  });

  it('holds the card back while the bar still asks about a 0 in a scored room', () => {
    const asking = threeRooms([A, B_EQUAL, C_EQUAL]);
    expect(unitsAwaitingAnswer(asking, 0, 3).size).toBe(2);
    expect(cardOf(asking)).toBeUndefined();
    expect(hasPendingTies(asking, 0)).toBe(false);
  });

  it('settles rooms with no points by room order, with no card, however many spots they hold', () => {
    const zeroSeats = (room: number) =>
      Array.from({ length: 8 }, (_, position) => `r0-rm${room}-p${position}`);
    const asked = threeRooms([A, ZEROS, ZEROS], { count: 2 });
    const state = answerAbsence(asked, [...zeroSeats(2), ...zeroSeats(3)], 'played');
    expect(unitsAwaitingAnswer(state, 0, 2).size).toBe(0);
    const choice = bestPlaceChoice(state, 0);
    expect(choice?.chosen).toEqual([sixth(1), sixth(2)]);
    expect(choice?.rest).toEqual([sixth(3)]);
    expect(choice?.tie).toBeNull();
    expect(cardOf(state)).toBeUndefined();
  });
});

describe('routing the best of a place', () => {
  const seedsTo = (state: TournamentState, destination: number) =>
    (routeWaterfallRound(state, 0, state.rounds[0]).get(destination) ?? []).map((seed) => seed.name);

  it('sends the chosen 6th with the places 1-5 and the other 6ths out', () => {
    const state = threeRooms([A, B, C]);
    const names = seedsTo(state, 1);
    expect(names).toHaveLength(16);
    expect(names).toContain(sixth(3));
    expect(names).not.toContain(sixth(2));
    expect(names).not.toContain(sixth(1));
  });

  it('gives the chosen unit its place as tier rank and its share as pct, and is not lucky', () => {
    const seeds = routeWaterfallRound(threeRooms([A, B, C]), 0, threeRooms([A, B, C]).rounds[0]).get(1) ?? [];
    const seed = seeds.find((candidate) => candidate.name === sixth(3));
    expect(seed).toMatchObject({ tierRank: 5, isLucky: false });
    expect(seed?.pct).toBeCloseTo(36 / (364 / 8), 6);
  });

  it('sends the other 6ths where their rooms’ lines send them', () => {
    const state = threeRooms([A, B, C], { restTo: 2 });
    expect(seedsTo(state, 1)).toContain(sixth(3));
    expect(seedsTo(state, 2).sort()).toEqual([sixth(1), sixth(2)].sort());
  });

  it('sends the room-order pick of a tie not decided yet, and the organiser’s pick once it is', () => {
    const state = threeRooms([A, B, B]);
    expect(seedsTo(state, 1)).toContain(sixth(2));
    const picked = resolveTournamentTie(state, bestPlaceTieKey(0), sixth(3));
    expect(seedsTo(picked, 1)).toContain(sixth(3));
    expect(seedsTo(picked, 1)).not.toContain(sixth(2));
  });
});

/** The example on a generated tournament: a qualification table at `count` entrants sends 24 into R4 = 3x8. */
const rooms = (...labels: string[]) => labels.map((label) => `R4.${label}: 1-5->R5, 6-8->eliminated`);
const graphText = (roundLines: string[], routeLines: string[]) =>
  `ROUNDS:\n${roundLines.join('\n')}\n\nROUTES:\n${routeLines.join('\n')}`;
const EXAMPLE = graphText(
  ['R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'],
  [
    'Qual: 1-24->R4',
    ...rooms('A', 'B', 'C'),
    'R4.BEST: 1 OF 6->R5',
    'R5.A: 1-4->Final, 5-8->eliminated',
    'R5.B: 1-4->Final, 5-8->eliminated',
  ],
);
const WITH_LOWER = graphText(
  ['R4 = 3x8', 'R5 = 2x8', 'R5L = 6', 'Final = 8 FINAL'],
  [
    'Qual: 1-24->R4',
    'R4.A: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.B: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.C: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.BEST: 1 OF 6->R5',
    'R5.A: 1-3->Final, 4-5->R5L, 6-8->eliminated',
    'R5.B: 1-3->Final, 4-5->R5L, 6-8->eliminated',
    'R5L: 1-2->Final',
  ],
);

/** The scores of each room of a round, best first by seat. */
function scoreRooms(state: TournamentState, roundIndex: number, perRoom: number[][]): TournamentState {
  const scores = { ...state.scores };
  perRoom.forEach((roomScores, index) => {
    roomScores.forEach((score, position) => {
      scores[scoreKeysForPosition({ roundIndex, room: index + 1, position })[0]] = score;
    });
  });
  return { ...state, scores };
}

const namesIn = (state: TournamentState, label: string) =>
  (state.assignments[indexOf(state, label)] ?? []).map((entry) => entry.name);

/** The unit sitting at a seat of R4 as drawn. */
function seatOf(state: TournamentState, room: number, position: number): string {
  const seats = (state.assignments[indexOf(state, 'R4')] ?? []).filter((entry) => entry.room === room);
  return seats[position].name;
}

const SHAPES: Array<[string, (state: TournamentState) => TournamentState]> = [
  ['dependency play', withDependencyPlay],
  ['column play', (state) => state],
];

describe.each(SHAPES)('Next Round with a best place, %s', (_shape, shaped) => {
  const start = (count: number, graph = EXAMPLE) => shaped(atEntry(count, graph));
  const r4 = (state: TournamentState) => indexOf(state, 'R4');

  it('draws R5 with the 15 first places and the best 6th', () => {
    const entry = start(37);
    const state = scoreRooms(entry, r4(entry), [A, B, C]);
    const after = pressed(state);
    const r5 = namesIn(after, 'R5');
    expect(r5).toHaveLength(16);
    expect(r5).toContain(seatOf(state, 3, 5));
    expect(r5).not.toContain(seatOf(state, 2, 5));
    expect(r5).not.toContain(seatOf(state, 1, 5));
    expectConsistent(after);
  });

  it.each([31, 37, 43, 53])('sends the same 16 at %i registered', (count) => {
    const entry = start(count);
    const state = scoreRooms(entry, r4(entry), [A, B, C]);
    const after = pressed(state);
    expect(namesIn(after, 'R5')).toHaveLength(16);
    expect(namesIn(after, 'R5')).toContain(seatOf(state, 3, 5));
    expectConsistent(after);
  });

  it('sends the other 6ths to the Lower round when the rooms’ lines say so', () => {
    const entry = start(37, WITH_LOWER);
    const state = scoreRooms(entry, r4(entry), [A, B, C]);
    const after = pressed(state);
    expect(namesIn(after, 'R5')).toContain(seatOf(state, 3, 5));
    // R5L also waits for R5, so the two other 6ths wait in its pool.
    const waiting = (after.pendingBracketSeeds[indexOf(after, 'R5L')] ?? []).map((seed) => seed.name);
    expect(waiting.sort()).toEqual([seatOf(state, 1, 5), seatOf(state, 2, 5)].sort());
    expectConsistent(after);
  });
});

describe('Next Round with a best place in dependency play', () => {
  const entry = withDependencyPlay(atEntry(37, EXAMPLE));
  const r4 = indexOf(entry, 'R4');
  const scored = scoreRooms(entry, r4, [A, B, C]);
  const tiedScores = scoreRooms(entry, r4, [A, B, B]);

  it('is blocked by the tie card until the organiser picks, and the pick is sent on', () => {
    expect(nextRoundPlan(tiedScores).blocked).toBe('pending-ties');
    const first = seatOf(tiedScores, 2, 5);
    const second = seatOf(tiedScores, 3, 5);
    const picked = resolveTournamentTie(tiedScores, bestPlaceTieKey(r4), second);
    expect(nextRoundPlan(picked).blocked).toBeNull();
    const r5 = namesIn(pressed(picked), 'R5');
    expect(r5).toContain(second);
    expect(r5).not.toContain(first);
  });

  it('is not blocked while the tied rooms are still being scored', () => {
    const partly = { ...tiedScores, scores: { ...tiedScores.scores } };
    delete partly.scores[scoreKeysForPosition({ roundIndex: r4, room: 3, position: 7 })[0]];
    expect(nextRoundPlan(partly).blocked).toBeNull();
  });

  it('sends the same unit after Previous and Next Round', () => {
    const after = pressed(scored);
    expect(canGoBack(after)).toBe(true);
    const again = pressed(goBack(after));
    expect(namesIn(again, 'R5').sort()).toEqual(namesIn(after, 'R5').sort());
  });

  it('does not bring a removed chosen unit back or move another 6th up into its place', () => {
    const after = pressed(scored);
    const chosen = seatOf(scored, 3, 5);
    const removed = removeChecked(after, chosen);
    const again = pressed(goBack(removed));
    const r5 = namesIn(again, 'R5');
    expect(r5).not.toContain(chosen);
    expect(r5).not.toContain(seatOf(scored, 1, 5));
    expect(r5).not.toContain(seatOf(scored, 2, 5));
    expect(r5).toHaveLength(15);
  });

  it('shows the chosen unit in the expected draw of R5 once R4 is finished', () => {
    const expected = expectedRounds(scored)?.get(indexOf(scored, 'R5'));
    const names = (expected?.assignments ?? []).map((entry) => entry.name);
    expect(names).toHaveLength(16);
    expect(names).toContain(seatOf(scored, 3, 5));
    expect(names).not.toContain(seatOf(scored, 2, 5));
  });

  it('accepts an unchanged graph in Edit graph after R4 is sent on', () => {
    const after = pressed(scored);
    const saved = applyWaterfallGraphEdit(after, after.settings?.waterfallGraph ?? '');
    expect(saved.ok ? '' : saved.error).toBe('');
    if (saved.ok) {
      expect(saved.state.rounds[indexOf(after, 'R4')].waterfallBest).toEqual(
        after.rounds[indexOf(after, 'R4')].waterfallBest,
      );
      expect(namesIn(saved.state, 'R5').sort()).toEqual(namesIn(after, 'R5').sort());
    }
  });
});
