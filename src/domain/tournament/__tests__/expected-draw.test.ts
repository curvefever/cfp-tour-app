import { describe, expect, it } from 'vitest';
import { expectedNextColumn } from '../expected-draw';
import { removeRosterUnit } from '../mutations';
import { currentColumn, nextColumnStart } from '../round-columns';
import { scoreKeysForPosition, scoredTeamSize } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildQualWaterfall } from './qual-waterfall';
import { scoreByHash, spreadConfig, startSpread } from './spread-play';
import { buildState } from './play-through';

/** Scores every round of the column in play, so each room is complete. */
function scoreColumn(state: TournamentState): TournamentState {
  const { start, end } = currentColumn(state);
  let scores = state.scores;
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    scores = scoreByHash({ ...state, curRound: roundIndex, scores }).state.scores;
  }
  return { ...state, scores };
}

function advanced(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return result.state;
}

/** At every step to the Final: the expected draw of the next column equals what Next Round then draws. */
function expectEveryStepToMatch(start: TournamentState): number {
  let state = start;
  let checked = 0;
  for (let guard = 0; guard < 30 && !state.rounds[state.curRound].isFinal; guard += 1) {
    const scored = scoreColumn(state);
    const expected = expectedNextColumn(scored);
    const next = advanced(scored);
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

describe('expectedNextColumn equals what Next Round then draws', () => {
  it('37 FFA players, qualification table of 4 rounds: every pooling round and the cut after it', () => {
    expect(expectEveryStepToMatch(startSpread(FFA_QUAL))).toBeGreaterThan(4);
  });

  it('25 2v2v2v2 teams, qualification table: every step', () => {
    expect(expectEveryStepToMatch(startSpread(spreadConfig('2v2v2v2', 25)))).toBeGreaterThan(4);
  });

  it('43 FFA players, single elimination without a pooling phase: the warm-up rounds and the cuts', () => {
    expect(expectEveryStepToMatch(started(SINGLE_ELIMINATION_43))).toBeGreaterThan(3);
  });

  it('a qualification table feeding a waterfall: the entry column is two rounds, drawn together', () => {
    const start = buildQualWaterfall(37, undefined, {}, { columns: true });
    let state = start;
    // Play to the last qualification round, then compare the waterfall entry column.
    while (!state.rounds[state.curRound + 1]?.isWaterfall) state = advanced(scoreColumn(state));
    const scored = scoreColumn(state);
    const expected = expectedNextColumn(scored);
    const next = advanced(scored);
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

describe('expectedNextColumn follows the shape the advance fits, not the planned one', () => {
  it('a withdrawal from R1 leaves R3 a seat short: the expected room is 7, the planned 8, and Next Round draws the same', () => {
    let state = buildQualWaterfall(37, BOTTOM_ROUTES_ON, {}, { columns: true });
    const r1 = state.rounds.findIndex((round) => round.customLabel === 'R1');
    while (state.curRound < r1) state = advanced(scoreColumn(state));
    state = removeRosterUnit(state, fromFullestRoom(state));

    const scored = scoreColumn(state);
    const r3 = scored.rounds.findIndex((round) => round.customLabel === 'R3');
    const expected = expectedNextColumn(scored);
    const next = advanced(scored);

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
    const expected = expectedNextColumn(stale);
    const drawn = advanced(stale);
    expect(stale.rounds[next].rooms).toHaveLength(cut.rooms.length + 1);
    expect(expected?.get(next)?.rooms).toEqual(drawn.rounds[next].rooms);
    expect(expected?.get(next)?.rooms).toHaveLength(cut.rooms.length);
  });
});

describe('expectedNextColumn is null until the draw is determined', () => {
  it('while one room is unscored', () => {
    const state = startSpread(FFA_QUAL);
    const scored = scoreColumn(state);
    expect(expectedNextColumn(scored)).not.toBeNull();
    const [lone] = Object.keys(scored.scores).filter((key) => key.startsWith('r0-rm3-'));
    const { [lone]: _removed, ...rest } = scored.scores;
    expect(expectedNextColumn({ ...scored, scores: rest })).toBeNull();
    expect(expectedNextColumn(state)).toBeNull();
  });

  it('while a tie at the cut waits to be settled', () => {
    let state = started(SINGLE_ELIMINATION_43);
    while (state.rounds[state.curRound].isNoElim) state = advanced(scoreColumn(state));
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
    expect(expectedNextColumn(tied)).toBeNull();
  });

  it('once the next round is drawn (after Previous)', () => {
    const scored = scoreColumn(startSpread(FFA_QUAL));
    const drawn = advanced(scored);
    expect(expectedNextColumn({ ...drawn, curRound: drawn.curRound - 1 })).toBeNull();
  });

  it('before the start', () => {
    const state = scoreColumn(startSpread(FFA_QUAL));
    expect(expectedNextColumn({ ...state, started: false })).toBeNull();
  });

  it('on the Final, where there is no next column', () => {
    let state = startSpread(FFA_QUAL);
    while (!state.rounds[state.curRound].isFinal) state = advanced(scoreColumn(state));
    expect(expectedNextColumn(scoreColumn(state))).toBeNull();
  });

  it('for a fixed draw, whose next round is already published', () => {
    const state = scoreColumn(startSpread(spreadConfig('ffa', 37, { fixed: true })));
    expect(state.rounds[state.curRound + 1].fixedRoomAssignments).toBeDefined();
    expect(expectedNextColumn(state)).toBeNull();
  });
});

describe('expectedNextColumn changes nothing', () => {
  it('leaves a deeply frozen input state untouched (it would throw on any write)', () => {
    const scored = scoreColumn(startSpread(FFA_QUAL));
    const before = structuredClone(scored);
    const frozen = deepFreeze(structuredClone(scored));
    expect(expectedNextColumn(frozen)).not.toBeNull();
    expect(frozen).toEqual(before);
  });
});
