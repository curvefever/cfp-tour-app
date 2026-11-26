import { describe, expect, it } from 'vitest';
import { replayBracketPools } from '../bracket-replay';
import { moveUnitToRoom } from '../lineup-edit';
import { removeRosterUnit } from '../unit-removal';
import { tieredBracketSeed } from '../wave-draw';
import type { TournamentState } from '../types';
import { pressNextRound } from './play-through';
import { buildQualWaterfall, playToQualificationExit } from './qual-waterfall';
import {
  atSwissExit,
  exitOrder,
  favouritesWin,
  indexOfLabel,
  pressed,
  roomNames,
  scoreWith,
} from './seed-lines-fixtures';

/**
 * The organiser's example of 2026-11-21 (13 head-to-head units, a Swiss of 5 rounds, then Round 6, Quarter-finals,
 * Semi-finals and ranking matches): the bracket's lines are fixed. Q1 ... Q13 are the places of the Swiss table.
 */

const QF_ROOMS = [1, 2, 3, 4];

/** The Quarter-finals as pairs of Swiss places, after Round 6 was scored by `scoresByName` (the favourites win without it). */
function quarterFinals(scoresByName?: Record<string, number>) {
  const entered = pressed(atSwissExit());
  const order = exitOrder(entered);
  const scored = scoresByName ? scoreWith(entered, 'R6', scoresByName) : favouritesWin(entered, 'R6');
  const sent = pressed(scored);
  const place = (name: string) => order.indexOf(name) + 1;
  return {
    sent,
    order,
    pairs: QF_ROOMS.map((room) => roomNames(sent, 'QF', room).map(place)),
  };
}

describe('Round 6 winners meet the qualifiers by fixed lines', () => {
  it('the favourites win Round 6 (Q7, Q8): Q1 v Q8, Q2 v Q7, Q3 v Q6, Q4 v Q5', () => {
    expect(quarterFinals().pairs).toEqual([
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5],
    ]);
  });

  it('Q10 and Q9 win Round 6: the line follows the room, not the winner own place: Q1 v Q9, Q2 v Q10', () => {
    const entered = pressed(atSwissExit());
    const order = exitOrder(entered);
    const { pairs } = quarterFinals({ [order[9]]: 500, [order[6]]: 100, [order[8]]: 500, [order[7]]: 100 });
    expect(pairs.slice(0, 2)).toEqual([
      [1, 9],
      [2, 10],
    ]);
    expect(pairs.slice(2)).toEqual([
      [3, 6],
      [4, 5],
    ]);
  });

  it('the Semi-finals follow the lines: W QF1 v W QF4, W QF2 v W QF3, and the losers the same', () => {
    const { sent } = quarterFinals();
    const winners = QF_ROOMS.map((room) => roomNames(sent, 'QF', room)[0]);
    const losers = QF_ROOMS.map((room) => roomNames(sent, 'QF', room)[1]);
    const played = pressed(favouritesWin(sent, 'QF'));
    const sorted = (names: string[]) => [...names].sort();
    expect(sorted(roomNames(played, 'SF', 1))).toEqual(sorted([winners[0], winners[3]]));
    expect(sorted(roomNames(played, 'SF', 2))).toEqual(sorted([winners[1], winners[2]]));
    expect(sorted(roomNames(played, 'R58', 1))).toEqual(sorted([losers[0], losers[3]]));
    expect(sorted(roomNames(played, 'R58', 2))).toEqual(sorted([losers[1], losers[2]]));
  });

  it('upsets in QF1 and QF4: SF1 is still W QF1 v W QF4', () => {
    const { sent } = quarterFinals();
    const [first, , , fourth] = QF_ROOMS.map((room) => roomNames(sent, 'QF', room));
    // The second seat of each of those rooms wins.
    const played = pressed(favouritesWin(sent, 'QF', [first[1], fourth[1]]));
    expect(roomNames(played, 'SF', 1).sort()).toEqual([first[1], fourth[1]].sort());
  });

  /** The Quarter-finals as pairs of Swiss places after the unit at `place` (1-based) withdrew following the exit. */
  function quarterFinalsWithout(place: number): number[][] {
    const entered = pressed(atSwissExit());
    const order = exitOrder(entered);
    const withdrawn = removeRosterUnit(entered, order[place - 1]);
    const sent = pressed(favouritesWin(withdrawn, 'R6'));
    return QF_ROOMS.map((room) => roomNames(sent, 'QF', room).map((name) => order.indexOf(name) + 1));
  }

  it('a short Quarter-finals keeps the fitted shape and the lines of the seeds present: Q5 out leaves Q4 alone', () => {
    expect(quarterFinalsWithout(5)).toEqual([[1, 8], [2, 7], [3, 6], [4]]);
  });

  it('a top seed out shifts the pairs below it: Q2 out gives Q1 v Q8, Q3 v Q7, Q4 v Q6 and Q5 alone', () => {
    expect(quarterFinalsWithout(2)).toEqual([[1, 8], [3, 7], [4, 6], [5]]);
  });
});

describe('a room seed ignores a seat without one', () => {
  it('a room holding one unit without a seed still carries the seed of the others', () => {
    const { sent } = quarterFinals();
    const quarter = indexOfLabel(sent, 'QF');
    const seatOne = sent.assignments[quarter].find((entry) => entry.room === 1);
    const stripped: TournamentState = {
      ...sent,
      assignments: sent.assignments.map((entries, index) =>
        index === quarter
          ? entries.map((entry) => {
              if (entry.name !== seatOne?.name) return entry;
              const { seed: _seed, ...withoutSeed } = entry;
              return withoutSeed;
            })
          : entries,
      ),
    };
    const scored = favouritesWin(stripped, 'QF');
    const pooled = replayBracketPools(scored, quarter + 1).pools.get(indexOfLabel(scored, 'SF')) ?? [];
    expect(pooled).toHaveLength(4);
    expect(pooled.every((entry) => entry.seed !== undefined)).toBe(true);
  });
});

/** Scores every room of a round by seat (the first seat wins). */
function scoreAll(state: TournamentState, label: string): TournamentState {
  const roundIndex = indexOfLabel(state, label);
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    scores[`r${roundIndex}-rm${entry.room}-p${position}`] = 1000 - 37 * position - entry.room;
  }
  return { ...state, scores };
}

describe('FFA after a qualification table: Upper and Middle rooms', () => {
  const UPPER_MIDDLE = `
ROUNDS:
M = 2x8
U = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-12->U, 13-28->M
M.A: 1-2->U, 3-8->eliminated
M.B: 1-2->U, 3-8->eliminated
U.A: 1-4->Final, 5-8->eliminated
U.B: 1-4->Final, 5-8->eliminated
`;

  it('37 players: the four Middle arrivals are tagged after Q12 and are not drawn as the strongest seeds', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37, UPPER_MIDDLE, {}, { columns: true }));
    const middle = pressNextRound(exit);
    const order = (middle.rounds.find((round) => round.standingsExitOrder)?.standingsExitOrder ?? []).map(
      (entry) => entry.name,
    );
    const scored = scoreAll(middle, 'M');
    const upperIndex = indexOfLabel(scored, 'U');
    const pool = replayBracketPools(scored, indexOfLabel(scored, 'M') + 1).pools.get(upperIndex) ?? [];
    const fromMiddle = pool.filter((entry) => !order.slice(0, 12).includes(entry.name));
    expect(fromMiddle).toHaveLength(4);
    expect(fromMiddle.every((entry) => (entry.seed ?? 0) >= 13)).toBe(true);
    const upper = pressNextRound(scored).assignments[upperIndex];
    const roomOf = (name: string) => upper.find((entry) => entry.name === name)?.room;
    // Q1 and Q2 are in different rooms, and each room takes two of the Middle arrivals.
    expect(roomOf(order[0])).not.toBe(roomOf(order[1]));
    for (const room of [1, 2]) {
      const arrivals = upper.filter(
        (entry) => entry.room === room && fromMiddle.some((arrival) => arrival.name === entry.name),
      );
      expect(arrivals).toHaveLength(2);
    }
    const seedByName = Object.fromEntries(upper.map((entry) => [entry.name, entry.seed]));
    expect(seedByName[order[0]]).toBe(1);
    expect(seedByName[order[11]]).toBe(12);
  });

  it('a single-source round is drawn exactly as before: its tiers are not touched', () => {
    const state = buildQualWaterfall(
      32,
      `
ROUNDS:
R1 = 4x8
R2 = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-32->R1
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R1.C: 1-4->R2, 5-8->eliminated
R1.D: 1-4->R2, 5-8->eliminated
R2.A: 1-4->Final, 5-8->eliminated
R2.B: 1-4->Final, 5-8->eliminated
`,
      {},
      { columns: true },
    );
    const entered = pressNextRound(playToQualificationExit(state));
    const scored = scoreAll(entered, 'R1');
    const target = indexOfLabel(scored, 'R2');
    const pool = replayBracketPools(scored, indexOfLabel(scored, 'R1') + 1).pools.get(target) ?? [];
    const expected = tieredBracketSeed({
      pool,
      roomSizes: [8, 8],
      roomHistory: scored.roomHistory,
      rounds: scored.rounds,
      targetRoundIndex: target,
      likelyAbsent: new Set(),
    }).seeded;
    const drawn = pressNextRound(scored).assignments[target];
    expect(drawn.map(({ name, room }) => [name, room])).toEqual(
      expected.map(({ name, room }) => [name, room]),
    );
  });
});

describe('seeds survive moving a unit to another room', () => {
  // A Custom bracket round of rooms of two can't lose a seat in a room; a short Upper round (8 + 7) can.
  const SHORT_UPPER = `
ROUNDS:
M = 2x8
U = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-12->U, 13-28->M
M.A: 1-2->U, 3-8->eliminated
M.B: 1-2->U, 3-8->eliminated
U.A: 1-4->Final, 5-8->eliminated
U.B: 1-4->Final, 5-8->eliminated
`;

  it('a unit moved by hand keeps its seed, and so does every other unit of the round', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37, SHORT_UPPER, {}, { columns: true }));
    const middle = pressNextRound(exit);
    const order = (middle.rounds.find((round) => round.standingsExitOrder)?.standingsExitOrder ?? []).map(
      (entry) => entry.name,
    );
    const withdrawn = removeRosterUnit(scoreAll(middle, 'M'), order[11]);
    const upperIndex = indexOfLabel(withdrawn, 'U');
    const drawn = pressNextRound(withdrawn);
    expect(drawn.rounds[upperIndex].rooms).toEqual([8, 7]);
    const upper = drawn.assignments[upperIndex];
    const mover = upper.find((entry) => entry.room === 1);
    if (!mover) throw new Error('no unit in room 1');
    const moved = moveUnitToRoom({ ...drawn, curRound: upperIndex }, upperIndex, mover.name, 2);
    if (!moved.ok) throw new Error(moved.error);
    const after = moved.state.assignments[upperIndex];
    expect(after.find((entry) => entry.name === mover.name)).toMatchObject({ room: 2, manual: true });
    const seedOf = (entries: typeof upper) =>
      Object.fromEntries(entries.map((entry) => [entry.name, entry.seed]));
    expect(seedOf(after)).toEqual(seedOf(upper));
    expect(Object.values(seedOf(after)).every((seed) => seed !== undefined)).toBe(true);
  });
});
