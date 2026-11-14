import { describe, expect, it } from 'vitest';
import { answerAbsence, hasBlockingAbsenceQuestionsInRound } from '../absences';
import { getAllTies, hasPendingTies } from '../advancement';
import { expectedRounds, type ExpectedRound } from '../expected-draw';
import { isOneScorePerTeam, ONE_SCORE_PER_TEAM } from '../formats';
import { removeRosterUnit } from '../mutations';
import { roomPairKey } from '../seeding';
import { currentColumn, nextColumnStart, roundColumn } from '../round-columns';
import { scoreKeysForPosition, scoredTeamSize } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { buildQualWaterfall, liveTournament, playToQualificationExit, QUAL_GRAPH } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';
import { scoreByHash, spreadConfig, startSpread } from './spread-play';
import { buildState, pressNextRound, scoreCurrentRound } from './play-through';

/** Scores every round of the column in play, so each room is complete. */
function scoreColumn(state: TournamentState): TournamentState {
  const { start, end } = currentColumn(state);
  let scores = state.scores;
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    scores = scoreByHash({ ...state, curRound: roundIndex, scores }).state.scores;
  }
  return { ...state, scores };
}

/** At every step to the Final: the expected draw of the next column equals what Next Round then draws. */
function expectEveryStepToMatch(start: TournamentState): number {
  let state = start;
  let checked = 0;
  for (let guard = 0; guard < 30 && !state.rounds[state.curRound].isFinal; guard += 1) {
    const scored = scoreColumn(state);
    const expected = expectedRounds(scored);
    const next = pressNextRound(scored);
    expect(expected).not.toBeNull();
    for (const [roundIndex, round] of expected ?? []) {
      expect(round.assignments).toEqual(next.assignments[roundIndex]);
      expect(round.byes).toEqual(next.byes[roundIndex] ?? []);
      checked += 1;
    }
    state = next;
  }
  return checked;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const FFA_QUAL = spreadConfig('ffa', 37);
const SINGLE_ELIMINATION_43 = {
  label: 'single elimination 43',
  count: 43,
  teams: false,
  setup: {
    gameFormat: 'ffa-individual' as const,
    scheduleLogic: 'single-elimination' as const,
    poolingPhase: 'none' as const,
  },
};

function started(config: Parameters<typeof buildState>[0]): TournamentState {
  const state = buildState(config);
  if (!state) throw new Error('generation refused');
  return state;
}

describe('expectedRounds equals what Next Round then draws', () => {
  it('37 FFA players, qualification table of 4 rounds: every pooling round and the cut after it', () => {
    expect(expectEveryStepToMatch(startSpread(FFA_QUAL))).toBeGreaterThan(4);
  });

  it('25 2v2v2v2 teams, qualification table: every step', () => {
    expect(expectEveryStepToMatch(startSpread(spreadConfig('2v2v2v2', 25)))).toBeGreaterThan(4);
  });

  it('43 FFA players, single elimination without a pooling phase: the warm-up rounds and the cuts', () => {
    expect(expectEveryStepToMatch(started(SINGLE_ELIMINATION_43))).toBeGreaterThan(3);
  });

  it.each<['ffa' | '2v2v2v2', number]>([
    ['2v2v2v2', 25],
    ['ffa', 31],
  ])(
    '%s at %i, warm-ups then elimination: the mixed-size rounds match too, spread and shares included',
    (kind, count) => {
      const start = startSpread(spreadConfig(kind, count, { pooling: 'none' }));
      expect(start.rounds.filter((round) => new Set(round.rooms).size > 1).length).toBeGreaterThan(2);
      expect(expectEveryStepToMatch(start)).toBeGreaterThan(3);
    },
  );

  it('a qualification table feeding a waterfall: the entry column is two rounds, drawn together', () => {
    const start = buildQualWaterfall(37, undefined, {}, { columns: true });
    let state = start;
    // Play to the last qualification round, then compare the waterfall entry column.
    while (!state.rounds[state.curRound + 1]?.isWaterfall) state = pressNextRound(scoreColumn(state));
    const scored = scoreColumn(state);
    const expected = expectedRounds(scored);
    const next = pressNextRound(scored);
    expect([...(expected?.keys() ?? [])]).toHaveLength(2);
    for (const [roundIndex, round] of expected ?? []) {
      expect(round.assignments).toEqual(next.assignments[roundIndex]);
    }
    expect(expectEveryStepToMatch(start)).toBeGreaterThan(4);
  });
});

/** R1's bottom bands (ranks 5-8) route on to R3, so one withdrawal from R1 leaves R3 a seat short. */
const BOTTOM_ROUTES_ON = `
ROUNDS:
R1 = 2x8
R2 = 8
R3 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1
R1.A: 1-4->R2, 5-8->R3
R1.B: 1-4->R2, 5-8->R3
R2: 1-4->Final, 5-8->eliminated
R3: 1-4->Final, 5-8->eliminated
`;

/** The unit in the room holding the most units. */
function fromFullestRoom(state: TournamentState): string {
  const seated = state.assignments[state.curRound].filter((entry) => entry.room !== null);
  const size = (room: number | null) => seated.filter((entry) => entry.room === room).length;
  return [...seated].sort((a, b) => size(b.room) - size(a.room) || (a.room ?? 0) - (b.room ?? 0))[0].name;
}

describe('expectedRounds follows the shape the advance fits, not the planned one', () => {
  it('a withdrawal from R1 leaves R3 a seat short: the expected room is 7, the planned 8, and Next Round draws the same', () => {
    let state = buildQualWaterfall(37, BOTTOM_ROUTES_ON, {}, { columns: true });
    const r1 = state.rounds.findIndex((round) => round.customLabel === 'R1');
    while (state.curRound < r1) state = pressNextRound(scoreColumn(state));
    state = removeRosterUnit(state, fromFullestRoom(state));

    const scored = scoreColumn(state);
    const r3 = scored.rounds.findIndex((round) => round.customLabel === 'R3');
    const expected = expectedRounds(scored);
    const next = pressNextRound(scored);

    expect(scored.rounds[r3].rooms).toEqual([8]);
    expect(expected?.get(r3)?.rooms).toEqual([7]);
    expect(expected?.get(r3)?.rooms).toEqual(next.rounds[r3].rooms);
    expect(expected?.get(r3)?.assignments).toEqual(next.assignments[r3]);
  });

  it('a plan that no longer matches the units arriving: the expected draw has the rooms the advance fits', () => {
    const scored = scoreColumn(startSpread(FFA_QUAL));
    const next = nextColumnStart(scored);
    const cut = scored.rounds[next];
    expect(cut.rooms.length).toBeGreaterThan(1);
    // A stale plan: the next round planned with one more room than the units arriving fill.
    const stale = {
      ...scored,
      rounds: scored.rounds.map((round, index) =>
        index === next ? { ...round, rooms: [...round.rooms, 1] } : round,
      ),
    };
    const expected = expectedRounds(stale);
    const drawn = pressNextRound(stale);
    expect(stale.rounds[next].rooms).toHaveLength(cut.rooms.length + 1);
    expect(expected?.get(next)?.rooms).toEqual(drawn.rounds[next].rooms);
    expect(expected?.get(next)?.rooms).toHaveLength(cut.rooms.length);
  });
});

describe('expectedRounds is null until the draw is determined', () => {
  it('while one room is unscored', () => {
    const state = startSpread(FFA_QUAL);
    const scored = scoreColumn(state);
    expect(expectedRounds(scored)).not.toBeNull();
    const [lone] = Object.keys(scored.scores).filter((key) => key.startsWith('r0-rm3-'));
    const { [lone]: _removed, ...rest } = scored.scores;
    expect(expectedRounds({ ...scored, scores: rest })).toBeNull();
    expect(expectedRounds(state)).toBeNull();
  });

  it('while a tie at the cut waits to be settled', () => {
    let state = started(SINGLE_ELIMINATION_43);
    while (state.rounds[state.curRound].isNoElim) state = pressNextRound(scoreColumn(state));
    const scored = scoreColumn(state);
    const round = scored.rounds[scored.curRound];
    const cutPosition = round.advPerRoom ?? 0;
    expect(cutPosition).toBeGreaterThan(0);
    const keyOf = (position: number) =>
      scoreKeysForPosition({
        roundIndex: scored.curRound,
        room: 1,
        position,
        teamSize: scoredTeamSize(scored),
      })[0];
    // The last place that advances and the first that does not share a score.
    const tied = {
      ...scored,
      scores: { ...scored.scores, [keyOf(cutPosition)]: scored.scores[keyOf(cutPosition - 1)] },
    };
    expect(advanceTournamentRound(tied).status).toBe('blocked');
    expect(expectedRounds(tied)).toBeNull();
  });

  it('once the next round is drawn (after Previous)', () => {
    const scored = scoreColumn(startSpread(FFA_QUAL));
    const drawn = pressNextRound(scored);
    expect(expectedRounds({ ...drawn, curRound: drawn.curRound - 1 })).toBeNull();
  });

  it('before the start', () => {
    const state = scoreColumn(startSpread(FFA_QUAL));
    expect(expectedRounds({ ...state, started: false })).toBeNull();
  });

  it('on the Final, where there is no next column', () => {
    let state = startSpread(FFA_QUAL);
    while (!state.rounds[state.curRound].isFinal) state = pressNextRound(scoreColumn(state));
    expect(expectedRounds(scoreColumn(state))).toBeNull();
  });

  it('for a fixed draw, whose next round is already published', () => {
    const state = scoreColumn(startSpread(spreadConfig('ffa', 37, { fixed: true })));
    expect(state.rounds[state.curRound + 1].fixedRoomAssignments).toBeDefined();
    expect(expectedRounds(state)).toBeNull();
  });
});

describe('expectedRounds changes nothing', () => {
  it('leaves a deeply frozen input state untouched (it would throw on any write)', () => {
    const scored = scoreColumn(startSpread(FFA_QUAL));
    const before = structuredClone(scored);
    const frozen = deepFreeze(structuredClone(scored));
    expect(expectedRounds(frozen)).not.toBeNull();
    expect(frozen).toEqual(before);
  });
});

const HEAD_TO_HEAD_QUAL_GRAPH = `
ROUNDS:
R1 = 4x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
Qual: 1-8->R1
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1.C: 1->R2, 2->eliminated
R1.D: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

/** Scores the round in play, then spreads the scores with a seed so the table comes out differently. */
function scoreWithSeed(state: TournamentState, seed: number): TournamentState {
  const scored = scoreCurrentRound(state, 0);
  let draw = seed * 7919 + state.curRound + 1;
  const scores = { ...scored.scores };
  for (const key of Object.keys(scores)) {
    if (!key.startsWith(`r${state.curRound}-`)) continue;
    draw = (draw * 48271) % 2147483647;
    scores[key] = (100 + (draw % 900)) * 100 + (draw % 97);
  }
  return { ...scored, scores };
}

/** The pairs that shared a room in the rounds up to the round in play. */
function pairsThatMet(state: TournamentState): Set<string> {
  const met = new Set<string>();
  for (let roundIndex = 0; roundIndex <= state.curRound; roundIndex += 1) {
    const byRoom = new Map<number, string[]>();
    for (const entry of state.assignments[roundIndex] ?? []) {
      if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    for (const names of byRoom.values()) {
      for (const [index, first] of names.entries())
        for (const second of names.slice(index + 1)) met.add(roomPairKey(first, second));
    }
  }
  return met;
}

describe('the expected draw after a qualification table includes the trade that parts units that met', () => {
  it('head-to-head rooms at 31, 37 and 43: the expected 4x2 round is what Next Round draws, no pair met before', () => {
    let trades = 0;
    for (const count of [31, 37, 43]) {
      for (let seed = 0; seed < 16; seed += 1) {
        let state = buildQualWaterfall(
          count,
          HEAD_TO_HEAD_QUAL_GRAPH,
          { gameFormat: 'individual-1v1' },
          { columns: true },
        );
        while (!state.rounds[state.curRound + 1]?.isWaterfall) {
          state = pressNextRound(scoreWithSeed(state, seed));
        }
        const scored = scoreWithSeed(state, seed);
        const next = pressNextRound(scored);
        const entry = scored.curRound + 1;
        const exitOrder = (next.rounds.find((round) => round.standingsRoutes)?.standingsExitOrder ?? []).map(
          (unit) => unit.name,
        );
        const met = pairsThatMet(scored);
        const pairs = (rooms: string[][]) =>
          rooms.flatMap((room) => (room.length === 2 ? [roomPairKey(room[0], room[1])] : []));
        // The snake alone pairs the best with the weakest: 1v8, 2v7, 3v6, 4v5.
        const snake = [0, 1, 2, 3].map((index) => [exitOrder[index], exitOrder[7 - index]]);
        if (pairs(snake).some((key) => met.has(key))) trades += 1;

        const expected = new Map(expectedRounds(scored) ?? []);
        expect(expected.get(entry)?.assignments, `${count} seed ${seed}`).toEqual(next.assignments[entry]);
        const rooms = new Map<number, string[]>();
        for (const unit of next.assignments[entry] ?? []) {
          if (unit.room !== null) rooms.set(unit.room, [...(rooms.get(unit.room) ?? []), unit.name]);
        }
        expect(
          pairs([...rooms.values()]).filter((key) => met.has(key)),
          `${count} seed ${seed}`,
        ).toEqual([]);
      }
    }
    expect(trades).toBeGreaterThan(0);
  });
});

// ---------- a Custom bracket round shows once its own feeders are finished ----------

/** The label's round index; the generation orders a column's rounds its own way, so tests never hard-code one. */
function indexOfRound(state: TournamentState, label: string): number {
  const index = state.rounds.findIndex((round) => round.customLabel === label);
  if (index < 0) throw new Error(`no round ${label}`);
  return index;
}

/** Scores one round of the column in play, whatever `curRound` is. */
function scoreRound(state: TournamentState, roundIndex: number): TournamentState {
  return {
    ...state,
    scores: scoreByHash({ ...state, curRound: roundIndex, scores: state.scores }).state.scores,
  };
}

function shown(state: TournamentState): Map<number, ExpectedRound> {
  return expectedRounds(state) ?? new Map();
}

function indexes(state: TournamentState, ...labels: string[]): number[] {
  return labels.map((label) => indexOfRound(state, label));
}

/** Plays whole columns until the column in play holds the labelled round. */
function playToColumnOf(start: TournamentState, label: string): TournamentState {
  const target = indexOfRound(start, label);
  let state = start;
  for (let guard = 0; guard < 40; guard += 1) {
    const { start: first, end } = currentColumn(state);
    if (target >= first && target <= end) return state;
    state = pressNextRound(scoreColumn(state));
  }
  throw new Error(`never reached ${label}`);
}

interface Walk {
  /** Steps after which a round was shown while a round of the column in play was still unscored. */
  early: number;
  /** Columns after which a round beyond the next column was shown. */
  ahead: number;
}

/** What Next Round draws equals what was shown, and a round shown for later is still shown, unchanged. */
function expectNextRoundToMatch(scored: TournamentState, seen: Map<number, ExpectedRound>): TournamentState {
  const next = pressNextRound(scored);
  const { start, end } = roundColumn(scored.rounds, nextColumnStart(scored));
  for (let index = start; index <= end; index += 1)
    expect(seen.has(index), `round ${index} shown`).toBe(true);
  for (const [index, round] of seen) {
    if (index > end) {
      expect(shown(next).get(index), `round ${index} still shown after Next Round`).toEqual(round);
      continue;
    }
    expect(next.assignments[index]).toEqual(round.assignments);
    expect(next.byes[index] ?? []).toEqual(round.byes);
    expect(next.rounds[index].rooms).toEqual(round.rooms);
  }
  return next;
}

/** Scores the tournament one round at a time, in a column's order or against it, to the Final. */
function walkToFinal(start: TournamentState, backward: boolean): Walk {
  const walk: Walk = { early: 0, ahead: 0 };
  let state = start;
  for (let guard = 0; guard < 30 && !state.rounds[state.curRound].isFinal; guard += 1) {
    const { start: first, end } = currentColumn(state);
    const order = Array.from({ length: end - first + 1 }, (_, offset) => first + offset);
    if (backward) order.reverse();
    const seen = new Map<number, ExpectedRound>();
    for (const [step, roundIndex] of order.entries()) {
      state = scoreRound(state, roundIndex);
      const now = shown(state);
      for (const [index, round] of seen)
        expect(now.get(index), `round ${index} keeps its draw`).toEqual(round);
      for (const [index, round] of now) seen.set(index, round);
      if (step < order.length - 1 && now.size > 0) walk.early += 1;
    }
    const nextEnd = roundColumn(state.rounds, nextColumnStart(state)).end;
    if ([...seen.keys()].some((index) => index > nextEnd)) walk.ahead += 1;
    state = expectNextRoundToMatch(state, seen);
  }
  return walk;
}

const WALKS = [37, 43, 53].flatMap((count) =>
  [true, false].flatMap((columns) =>
    [false, true].map((backward) => ({
      count,
      columns,
      backward,
      name: `${count} players, ${columns ? 'columns stored' : 'one round at a time'}, ${backward ? 'backward' : 'forward'}`,
    })),
  ),
);

describe('a Custom bracket round shows as soon as its own feeders are finished', () => {
  it.each(WALKS)('every step, $name: a shown draw never changes and is what Next Round draws', (walk) => {
    const start = buildQualWaterfall(walk.count, UPPER_LOWER_GRAPH, {}, { columns: walk.columns });
    const result = walkToFinal(start, walk.backward);
    // Stored columns show a round before the column in play is scored; one at a time, a round two columns ahead.
    expect(walk.columns ? result.early : result.ahead).toBeGreaterThan(0);
  });

  const SPREADSHEET = WATERFALL_EXAMPLES.find((example) => example.id === 'spreadsheet-32')?.text ?? '';
  const spreadsheet = () => buildQualWaterfall(32, SPREADSHEET, { qualAdv: '32' }, { columns: true });

  it.each([false, true])('spreadsheet-32, every step (backward: %s)', (backward) => {
    // Scored backward, R6C and R6B come before SemiA and show R7A early; forward, R6C comes last.
    expect(walkToFinal(spreadsheet(), backward).early > 0).toBe(backward);
  });

  it('spreadsheet-32: R7A needs both R6B and R6C, and does not wait for SemiA', () => {
    const column = playToColumnOf(spreadsheet(), 'SemiA');
    const [r6b, r6c, r7a] = indexes(column, 'R6B', 'R6C', 'R7A');
    const onlyB = scoreRound(column, r6b);
    expect(shown(onlyB).has(r7a)).toBe(false);
    const both = scoreRound(onlyB, r6c);
    expect(shown(both).has(r7a)).toBe(true);
    const semiA = indexOfRound(both, 'SemiA');
    expect(Object.keys(both.scores).some((key) => key.startsWith(`r${semiA}-`))).toBe(false);
  });
});

/** The column [R5R, SemiA, R5L] of the upper and lower graph, nothing scored. */
function atTheMiddleColumn(count = 37): TournamentState {
  return playToColumnOf(buildQualWaterfall(count, UPPER_LOWER_GRAPH, {}, { columns: true }), 'R5L');
}

describe('the upper and lower example', () => {
  it('R5L scored alone: R6L and R6R show, SemiB, the Final, R4 and the column in play do not', () => {
    const column = atTheMiddleColumn();
    expect(shown(column).size).toBe(0);
    const scored = scoreRound(column, indexOfRound(column, 'R5L'));
    expect([...shown(scored).keys()].sort()).toEqual(indexes(column, 'R6L', 'R6R').sort());
  });

  it('SemiA scored without R5L: nothing new shows (SemiB still waits for R6L)', () => {
    const column = atTheMiddleColumn();
    expect(shown(scoreRound(column, indexOfRound(column, 'SemiA'))).size).toBe(0);
  });

  it('R5L, SemiA and R5R scored, then Next Round: R6L and R6R are drawn exactly as shown', () => {
    const column = atTheMiddleColumn();
    const r5l = scoreRound(column, indexOfRound(column, 'R5L'));
    const before = shown(r5l);
    const next = pressNextRound(scoreColumn(r5l));
    for (const index of indexes(column, 'R6L', 'R6R')) {
      expect(next.assignments[index]).toEqual(before.get(index)?.assignments);
    }
  });
});

/** Every room of the round scored 1000, 990, … by seat, the fifth seat tying the fourth. */
function scoredWithATieAtTheFourth(state: TournamentState, roundIndex: number): TournamentState {
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    const [key] = scoreKeysForPosition({
      roundIndex,
      room: entry.room,
      position,
      numGames: state.rounds[roundIndex].numGames ?? 1,
      teamSize: scoredTeamSize(state),
    });
    scores[key] = 1000 - 10 * Math.min(position, 3) - (position > 4 ? position : 0);
  }
  return { ...state, scores };
}

/** The first unit of each tied cluster of the round picked, as the organiser does. */
function withTiesResolved(state: TournamentState, roundIndex: number): TournamentState {
  const tieResolutions = { ...state.tieResolutions };
  for (const [key, tie] of Object.entries(getAllTies(state, roundIndex))) {
    tieResolutions[key] = [tie.players[0].name];
  }
  return { ...state, tieResolutions };
}

describe('a tie holds back only the rounds it feeds', () => {
  it('a tie across 4th and 5th in R5L hides R6L and R6R until it is resolved', () => {
    const column = atTheMiddleColumn();
    const r5l = indexOfRound(column, 'R5L');
    const tied = scoredWithATieAtTheFourth(column, r5l);
    expect(hasPendingTies(tied, r5l)).toBe(true);
    expect(shown(tied).size).toBe(0);
    const resolved = withTiesResolved(tied, r5l);
    expect(hasPendingTies(resolved, r5l)).toBe(false);
    expect([...shown(resolved).keys()].sort()).toEqual(indexes(column, 'R6L', 'R6R').sort());
  });

  it('the same tie in SemiA hides nothing', () => {
    const column = atTheMiddleColumn();
    const semiA = indexOfRound(column, 'SemiA');
    const state = scoredWithATieAtTheFourth(scoreRound(column, indexOfRound(column, 'R5L')), semiA);
    expect(hasPendingTies(state, semiA)).toBe(true);
    expect([...shown(state).keys()].sort()).toEqual(indexes(column, 'R6L', 'R6R').sort());
  });
});

/** The first seat of the round's first room set to a score of 0: an absence the bar has not been answered about. */
function withAZeroIn(
  state: TournamentState,
  roundIndex: number,
): { state: TournamentState; key: string; unit: string } {
  const unit = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === 1)[0].name;
  const keys = scoreKeysForPosition({
    roundIndex,
    room: 1,
    position: 0,
    numGames: state.rounds[roundIndex].numGames ?? 1,
    teamSize: scoredTeamSize(state),
  });
  const zeroes = Object.fromEntries(keys.map((key) => [key, 0]));
  return { state: { ...state, scores: { ...state.scores, ...zeroes } }, key: keys[0], unit };
}

describe('an absence question holds back only the rounds it feeds', () => {
  it('an unanswered 0 in R5L hides R6L and R6R; "absent" shows them, the absentee at the last place destination, as Next Round draws', () => {
    const column = atTheMiddleColumn();
    const r5l = indexOfRound(column, 'R5L');
    const [r6l, r6r] = indexes(column, 'R6L', 'R6R');
    const zeroed = withAZeroIn(scoreColumn(column), r5l);
    expect(hasBlockingAbsenceQuestionsInRound(zeroed.state, r5l)).toBe(true);
    expect(shown(zeroed.state).size).toBe(0);

    const answered = answerAbsence(zeroed.state, [zeroed.key], 'absent');
    const draw = shown(answered);
    expect([...draw.keys()].sort()).toEqual([r6l, r6r].sort());
    expect(draw.get(r6r)?.assignments.map((entry) => entry.name)).toContain(zeroed.unit);
    const next = pressNextRound(answered);
    expect(draw.get(r6l)?.assignments).toEqual(next.assignments[r6l]);
    expect(draw.get(r6r)?.assignments).toEqual(next.assignments[r6r]);
  });

  it('an unanswered 0 in R5R hides nothing', () => {
    const column = atTheMiddleColumn();
    const r5r = indexOfRound(column, 'R5R');
    const state = scoreRound(withAZeroIn(scoreRound(column, r5r), r5r).state, indexOfRound(column, 'R5L'));
    expect(hasBlockingAbsenceQuestionsInRound(state, r5r)).toBe(true);
    expect([...shown(state).keys()].sort()).toEqual(indexes(column, 'R6L', 'R6R').sort());
  });

  /** Round 6 is fed by both halves of Round 5; Round 5 Lower has a score of 0 nobody has answered about. */
  function roundSixWithAZeroInTheLower(setup: Parameters<typeof liveTournament>[1]) {
    const column = playToColumnOf(liveTournament(16, setup), 'Round 5 Lower');
    const [lower, upper] = indexes(column, 'Round 5 Lower', 'Round 5 Upper');
    const { state } = withAZeroIn(scoreRound(scoreRound(column, upper), lower), lower);
    return { state, lower, roundSix: indexOfRound(column, 'Round 6') };
  }

  it('with one score per team an unanswered 0 hides nothing, where the default scoring waits for the answer', () => {
    const waiting = roundSixWithAZeroInTheLower({});
    expect(hasBlockingAbsenceQuestionsInRound(waiting.state, waiting.lower)).toBe(true);
    expect(shown(waiting.state).has(waiting.roundSix)).toBe(false);

    const oneScore = roundSixWithAZeroInTheLower({ teamScoringRule: ONE_SCORE_PER_TEAM });
    expect(isOneScorePerTeam(oneScore.state)).toBe(true);
    expect(hasBlockingAbsenceQuestionsInRound(oneScore.state, oneScore.lower)).toBe(false);
    expect(shown(oneScore.state).has(oneScore.roundSix)).toBe(true);
  });
});

describe('a round that cannot be drawn', () => {
  it('stays out of the map and does not hide the other round', () => {
    const column = atTheMiddleColumn();
    const [r6l, r6r] = indexes(column, 'R6L', 'R6R');
    const scored = scoreRound(column, indexOfRound(column, 'R5L'));
    expect([...shown(scored).keys()].sort()).toEqual([r6l, r6r].sort());
    // R6L declared with half its seats: the eight arriving units no longer fit.
    const edited = {
      ...scored,
      rounds: scored.rounds.map((round, index) =>
        index === r6l ? { ...round, rooms: [4], declaredRooms: [4] } : round,
      ),
    };
    expect([...shown(edited).keys()]).toEqual([r6r]);
  });
});

describe('after Previous on a Custom bracket', () => {
  it('nothing is shown, though later rounds are undrawn and their feeders are scored', () => {
    const column = atTheMiddleColumn();
    const scored = scoreColumn(column);
    const next = pressNextRound(scored);
    expect(next.assignments[indexOfRound(column, 'SemiB')] ?? []).toHaveLength(0);
    expect(expectedRounds(scored)).not.toBeNull();
    expect(expectedRounds({ ...next, curRound: column.curRound })).toBeNull();
  });
});

describe('a withdrawal and the expected draw of a Custom bracket round', () => {
  it('a unit removed from a neighbouring round leaves the shown draw unchanged', () => {
    const column = atTheMiddleColumn();
    const scored = scoreRound(column, indexOfRound(column, 'R5L'));
    const before = shown(scored);
    const neighbour = scored.assignments[indexOfRound(column, 'SemiA')][0].name;
    expect(shown(removeRosterUnit(scored, neighbour))).toEqual(before);
  });

  it('a unit removed from the feeder before Next Round changes it, and it still equals the real draw', () => {
    const column = atTheMiddleColumn();
    const r5l = indexOfRound(column, 'R5L');
    const scored = scoreRound(column, r5l);
    const before = shown(scored);
    const leaver = scored.assignments[r5l].find((entry) => entry.room === 1)?.name as string;
    const removed = scoreRound(removeRosterUnit(scored, leaver), r5l);
    const after = shown(removed);
    expect(after).not.toEqual(before);
    const next = pressNextRound(scoreColumn(removed));
    for (const [index, round] of after) expect(round.assignments).toEqual(next.assignments[index]);
  });
});

describe('a later round fed only by the qualification table', () => {
  it('R1C shows at the qualification exit and is what its own Next Round draws', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37, QUAL_GRAPH));
    const r1c = indexOfRound(exit, 'R1C');
    const draw = shown(exit);
    expect(draw.has(r1c)).toBe(true);
    expect(draw.has(indexOfRound(exit, 'R2'))).toBe(false);
    let state = pressNextRound(exit);
    while (state.curRound < r1c) state = pressNextRound(scoreColumn(state));
    expect(draw.get(r1c)?.assignments).toEqual(state.assignments[r1c]);
  });
});

describe('expectedRounds on a Custom bracket changes nothing', () => {
  it('leaves a deeply frozen, partly scored column untouched', () => {
    const column = atTheMiddleColumn();
    const partly = scoreRound(column, indexOfRound(column, 'R5L'));
    const before = structuredClone(partly);
    const frozen = deepFreeze(structuredClone(partly));
    expect(expectedRounds(frozen)).not.toBeNull();
    expect(frozen).toEqual(before);
  });
});
