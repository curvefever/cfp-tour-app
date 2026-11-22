import { describe, expect, it } from 'vitest';
import { roomFinishOrder } from '../advancement';
import { finalsProgressState } from '../finals';
import {
  isMatchRound,
  isWinsRound,
  matchFormatToken,
  parseMatchFormatToken,
  roomMatch,
  unitRankScore,
  unneededGames,
  winsGameCount,
} from '../match-format';
import { flagFinalGameAnonymous } from '../mutations';
import { computeRankings, isFinalComplete } from '../rankings';
import { createDefaultTournamentState } from '../state-defaults';
import type { OrderedWaterfallGraph, RoomSize, RoundAssignment, TournamentState } from '../types';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
} from '../waterfall-bracket';
import {
  parseWaterfallDraft,
  renameWaterfallRound,
  serializeWaterfallDraft,
  setWaterfallMatch,
} from '../waterfall-draft';
import { assignWaterfallSlots } from '../waterfall-draft';
import { setWaterfallWins } from '../waterfall-draft-wins';
import { buildAssignments, buildRound, oneRoomState } from './test-fixtures';

const ANY_ROOM_SIZE: RoomSize = { min: 1, max: 20, ideal: 8 };

/**
 * A double elimination of 8 teams, the shape of the prod tournament this feature is for: Semi A is the upper final
 * (column 3) and Semi B the lower final (column 4), and the Final is Semi A's winner against Semi B's winner.
 */
function doubleElimination(options: { final?: string; semiA?: string; semiB?: string } = {}): string {
  return `
ROUNDS:
R1 = 4x2
U2 = 2x2
L2 = 2x2
Semi A = 2
L3 = 2x2
Semi B = 2
${options.final ?? 'Final = 2 FINAL WINS'}

ROUTES:
R1.A: 1->U2, 2->L2
R1.B: 1->U2, 2->L2
R1.C: 1->U2, 2->L2
R1.D: 1->U2, 2->L2
U2.A: 1->Semi A, 2->L3
U2.B: 1->Semi A, 2->L3
L2.A: 1->L3
L2.B: 1->L3
Semi A: ${options.semiA ?? '1->Final'}
L3.A: 1->Semi B
L3.B: 1->Semi B
Semi B: ${options.semiB ?? '1->Final'}
`;
}

function validate(text: string, entrantCount = 8): ReturnType<typeof validateAndOrderWaterfallGraph> {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize: ANY_ROOM_SIZE, entrantCount });
}

function graphOf(text: string, entrantCount = 8): OrderedWaterfallGraph {
  const result = validate(text, entrantCount);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function errorOf(text: string, entrantCount = 8): string {
  const result = validate(text, entrantCount);
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

function finalSpec(graph: OrderedWaterfallGraph) {
  return graph.rounds.find((round) => round.isFinal);
}

/** The wins of the Final's two arrivals, each with the label of the round it comes from. */
function finalTargets(graph: OrderedWaterfallGraph): Array<[string, number]> {
  return (finalSpec(graph)?.winTargets ?? []).map((target) => [
    target.from === 'qual' ? 'qual' : graph.rounds[target.from].label,
    target.wins,
  ]);
}

describe('the WINS match format token', () => {
  it('is written and read like BO and GAMES', () => {
    expect(matchFormatToken({ games: 1, wins: true })).toBe('WINS');
    expect(parseMatchFormatToken('wins')).toEqual({ games: 1, wins: true });
    expect(parseMatchFormatToken('WINS 2')).toBeNull();
  });

  it('knows a WINS round and counts the games its targets can need', () => {
    const round = buildRound({
      roundNum: 1,
      winTargets: [
        { from: 0, wins: 1 },
        { from: 1, wins: 2 },
      ],
    });
    expect(isWinsRound(round)).toBe(true);
    expect(isMatchRound(round)).toBe(true);
    expect(isMatchRound(buildRound({ roundNum: 1, bestOf: 3 }))).toBe(true);
    expect(isMatchRound(buildRound({ roundNum: 1, numGames: 3 }))).toBe(false);
    expect([winsGameCount(1, 2), winsGameCount(2, 3), winsGameCount(3, 1), winsGameCount(2, 2)]).toEqual([
      2, 4, 3, 3,
    ]);
  });
});

describe('the ROUNDS line', () => {
  it('reads WINS in any case and any order with FINAL and COLUMN', () => {
    for (const line of ['Final = 2 FINAL WINS', 'Final = 2 wins final', 'Final = 2 WINS COLUMN 5 FINAL']) {
      expect(finalSpec(graphOf(doubleElimination({ final: line })))?.winTargets).toHaveLength(2);
    }
  });

  it('refuses WINS together with BO or GAMES, and WINS twice', () => {
    expect(errorOf(doubleElimination({ final: 'Final = 2 FINAL WINS BO3' }))).toBe(
      'ROUNDS line for "Final" has both WINS and BO3 -- choose one match format.',
    );
    expect(errorOf(doubleElimination({ final: 'Final = 2 FINAL BO3 WINS' }))).toBe(
      'ROUNDS line for "Final" has both BO3 and WINS -- choose one match format.',
    );
    expect(errorOf(doubleElimination({ final: 'Final = 2 FINAL WINS GAMES 2' }))).toBe(
      'ROUNDS line for "Final" has both WINS and GAMES 2 -- choose one match format.',
    );
    expect(errorOf(doubleElimination({ final: 'Final = 2 FINAL GAMES 2 WINS' }))).toBe(
      'ROUNDS line for "Final" has both GAMES 2 and WINS -- choose one match format.',
    );
    expect(errorOf(doubleElimination({ final: 'Final = 2 FINAL WINS WINS' }))).toBe(
      'ROUNDS line for "Final" repeats WINS -- write it once.',
    );
  });
});

describe('the targets by column', () => {
  it("gives the earlier column's finalist 1 win and the later one 2", () => {
    const graph = graphOf(doubleElimination());
    expect(finalTargets(graph)).toEqual([
      ['Semi A', 1],
      ['Semi B', 2],
    ]);
    expect(graph.columns[graph.rounds.findIndex((round) => round.label === 'Semi A')]).toBe(3);
    expect(graph.columns[graph.rounds.findIndex((round) => round.label === 'Semi B')]).toBe(4);
  });

  it('follows the source round, whichever band is written first', () => {
    const graph = graphOf(doubleElimination({ semiA: '1->Final', semiB: '1->Final' }));
    const [first, second] = graph.rounds.find((round) => round.isFinal)?.winTargets ?? [];
    expect([first.wins, second.wins].sort()).toEqual([1, 2]);
  });

  it('takes a typed value over the default, with spaced names resolved', () => {
    const graph = graphOf(doubleElimination({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 3' }));
    expect(finalTargets(graph)).toEqual([
      ['Semi A', 2],
      ['Semi B', 3],
    ]);
  });

  it('allows the earlier finalist to need more, and equal numbers', () => {
    expect(
      finalTargets(graphOf(doubleElimination({ semiA: '1->Final WINS 3', semiB: '1->Final WINS 1' }))),
    ).toEqual([
      ['Semi A', 3],
      ['Semi B', 1],
    ]);
    expect(
      finalTargets(graphOf(doubleElimination({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 2' }))),
    ).toEqual([
      ['Semi A', 2],
      ['Semi B', 2],
    ]);
  });

  it('gives an untyped band its default whatever the other band has typed', () => {
    expect(finalTargets(graphOf(doubleElimination({ semiB: '1->Final WINS 5' })))).toEqual([
      ['Semi A', 1],
      ['Semi B', 5],
    ]);
    expect(finalTargets(graphOf(doubleElimination({ semiA: '1->Final WINS 4' })))).toEqual([
      ['Semi A', 4],
      ['Semi B', 2],
    ]);
  });

  it('counts a Qual arrival as column 0', () => {
    const text = `
ROUNDS:
Semi = 2
Final = 2 FINAL WINS

ROUTES:
Qual: 1->Final, 2-3->Semi
Semi: 1->Final
`;
    const parsed = parseWaterfallGraph(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const graph = validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: ANY_ROOM_SIZE,
      entrantCount: 8,
      standingsSource: true,
    });
    if (!graph.ok) throw new Error(graph.error);
    expect(finalSpec(graph.value)?.winTargets).toEqual([
      { from: 'qual', wins: 1 },
      { from: 0, wins: 2 },
    ]);
  });
});

describe('the refusals', () => {
  const sameColumn = `
ROUNDS:
R1 = 2x2
Semi A = 2
Semi B = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->Semi A, 2->Semi B
R1.B: 1->Semi A, 2->Semi B
Semi A: 1->Final
Semi B: 1->Final
`;

  it('refuses a WINS round that is not one room of two', () => {
    expect(errorOf(doubleElimination().replace('L3 = 2x2', 'L3 = 2x2 WINS'))).toBe(
      'Round "L3" plays WINS, which needs one room of two players.',
    );
    expect(errorOf(doubleElimination().replace('Semi A = 2', 'Semi A = 3 WINS'))).toBe(
      'Round "Semi A" plays WINS, which needs one room of two players.',
    );
  });

  it('refuses a band value into a round that does not play WINS', () => {
    expect(
      errorOf(
        doubleElimination({ semiB: '1->Final WINS 2' }).replace('L3.A: 1->Semi B', 'L3.A: 1->Semi B WINS 2'),
      ),
    ).toBe(
      'Round "L3" gives "Semi B" a WINS value, but "Semi B" doesn\'t play WINS -- add WINS to its ROUNDS line.',
    );
  });

  it('refuses a target outside 1 to 9', () => {
    for (const wins of [0, 10, 25]) {
      expect(errorOf(doubleElimination({ semiA: `1->Final WINS ${wins}` }))).toBe(
        `Round "Final": WINS ${wins} is out of range -- a target is a whole number from 1 to 9.`,
      );
    }
    expect(finalTargets(graphOf(doubleElimination({ semiA: '1->Final WINS 9' })))[0]).toEqual(['Semi A', 9]);
  });

  it('refuses a WINS with no number', () => {
    expect(errorOf(doubleElimination({ semiA: '1->Final WINS' }))).toBe(
      'ROUTES line for "Semi A" needs a whole number from 1 to 9 after WINS -- for example "Final WINS 2".',
    );
    expect(errorOf(doubleElimination({ semiA: '1->Final WINS two' }))).toContain('needs a whole number');
  });

  it('refuses a band that sends more than one unit into a WINS round', () => {
    const text = `
ROUNDS:
R1 = 2x2
Semi A = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->Semi A
R1.B: 1->Semi A
Semi A: 1-2->Final
`;
    expect(errorOf(text, 4)).toBe(
      'Round "Semi A" sends 2 units to "Final" in one band -- a WINS round takes one unit by each band.',
    );
  });

  it('refuses two bands from one round into a WINS round', () => {
    const text = `
ROUNDS:
R1 = 2x2
Semi A = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->Semi A
R1.B: 1->Semi A
Semi A: 1->Final, 2->Final
`;
    expect(errorOf(text, 4)).toBe(
      'Round "Semi A" sends two bands into "Final" -- the two units of a WINS round must come from different rounds.',
    );
  });

  it('refuses a WINS round the bands do not feed with two units', () => {
    const text = 'ROUNDS:\nR1 = 2 WINS\nFinal = 2 FINAL\n\nROUTES:\nR1: 1->Final';
    expect(errorOf(text, 2)).toBe(
      'Round "R1" plays WINS, so its two units must each come by a band (it has 0).',
    );
  });

  it('refuses a BEST line into a WINS round', () => {
    const text = `
ROUNDS:
R1 = 2x2
Semi A = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->Semi A, 2->eliminated
R1.B: 1->Semi A, 2->eliminated
R1.BEST: 1 OF 2->Final
Semi A: 1->Final
`;
    expect(errorOf(text, 4)).toBe(
      'A BEST line sends units into "Final", which plays WINS -- a WINS round takes its two units by bands.',
    );
  });

  it('refuses two finalists of the same column unless both are typed', () => {
    const message = 'Final: both finalists qualify in the same column, so type the wins each one needs.';
    expect(errorOf(sameColumn, 4)).toBe(message);
    expect(errorOf(sameColumn.replace('Semi A: 1->Final', 'Semi A: 1->Final WINS 1'), 4)).toBe(message);
    const typed = sameColumn
      .replace('Semi A: 1->Final', 'Semi A: 1->Final WINS 1')
      .replace('Semi B: 1->Final', 'Semi B: 1->Final WINS 1');
    expect(finalTargets(graphOf(typed, 4))).toEqual([
      ['Semi A', 1],
      ['Semi B', 1],
    ]);
  });

  it('keeps a round named like the keyword working', () => {
    const text = `
ROUNDS:
R1 = 2x2
Big Wins = 2 FINAL

ROUTES:
R1.A: 1->Big Wins
R1.B: 1->Big Wins
`;
    expect(validate(text, 4).ok).toBe(true);
  });
});

describe('the rounds the graph builds', () => {
  const startRoundNum = 6;

  function builtFinal(text: string, standingsSource = false) {
    const graph = standingsSource
      ? (() => {
          const parsed = parseWaterfallGraph(text);
          if (!parsed.ok) throw new Error(parsed.error);
          const result = validateAndOrderWaterfallGraph(parsed.value, {
            roomSize: ANY_ROOM_SIZE,
            entrantCount: 8,
            standingsSource: true,
          });
          if (!result.ok) throw new Error(result.error);
          return result.value;
        })()
      : graphOf(text);
    const seedTotal = graph.qualRoutes?.length ?? 8;
    const rounds = waterfallBracketPhase(seedTotal, startRoundNum, { graph, finalsGames: 1 });
    return { rounds, graph, final: rounds.find((round) => round.isFinal)! };
  }

  it('gives the Final both targets by the absolute index of the round they come from, and a + b - 1 games', () => {
    const { rounds, final } = builtFinal(doubleElimination());
    const indexOf = (label: string) =>
      startRoundNum - 1 + rounds.findIndex((round) => round.customLabel === label);
    expect(final.winTargets).toEqual([
      { from: indexOf('Semi A'), wins: 1 },
      { from: indexOf('Semi B'), wins: 2 },
    ]);
    expect(final.numGames).toBe(2);
    expect(final.bestOf).toBeUndefined();
    expect(rounds.filter((round) => round.winTargets)).toHaveLength(1);
  });

  it('counts a + b - 1 games for 2 v 3, 3 v 1 and 2 v 2', () => {
    const games = (first: number, second: number) =>
      builtFinal(doubleElimination({ semiA: `1->Final WINS ${first}`, semiB: `1->Final WINS ${second}` }))
        .final.numGames;
    expect([games(2, 3), games(3, 1), games(2, 2)]).toEqual([4, 3, 3]);
  });

  it('points a Qual arrival at the pooling round before the bracket', () => {
    const text =
      'ROUNDS:\nSemi = 2\nFinal = 2 FINAL WINS\n\nROUTES:\nQual: 1->Final, 2-3->Semi\nSemi: 1->Final';
    const { rounds, final } = builtFinal(text, true);
    expect(final.winTargets).toEqual([
      { from: startRoundNum - 2, wins: 1 },
      { from: startRoundNum - 1 + rounds.findIndex((round) => round.customLabel === 'Semi'), wins: 2 },
    ]);
  });

  it('leaves a round with no WINS as it is', () => {
    const { rounds } = builtFinal(doubleElimination({ final: 'Final = 2 FINAL' }));
    expect(rounds.some((round) => round.winTargets !== undefined)).toBe(false);
  });
});

/** One room of two, A seated with `needs[0]` and B with `needs[1]`; `games[g]` the scores of game g + 1. */
function winsRoom(needs: [number, number], games: number[][]): TournamentState {
  const scores: Record<string, number> = {};
  games.forEach((row, game) =>
    row.forEach((value, position) => {
      scores[`r0-rm1-p${position}-g${game + 1}`] = value;
    }),
  );
  const state = oneRoomState({
    players: ['A', 'B'],
    rounds: [
      {
        winTargets: [
          { from: 0, wins: needs[0] },
          { from: 1, wins: needs[1] },
        ],
        numGames: winsGameCount(needs[0], needs[1]),
        isWaterfall: true,
      },
      {},
    ],
    scores,
  });
  const assignments: RoundAssignment[] = state.assignments[0].map((entry, position) => ({
    ...entry,
    winsNeeded: needs[position],
  }));
  return { ...state, assignments: [assignments, state.assignments[1]] };
}

describe('a match where each unit needs its own wins', () => {
  it('is decided as soon as the 1-win unit wins game 1', () => {
    const state = winsRoom([1, 2], [[10, 5]]);
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 1, decidingGame: 1, complete: true });
    expect(roomMatch(state, 0, 1)?.units.map((unit) => [unit.wins, unit.needed])).toEqual([
      [1, 1],
      [0, 2],
    ]);
    expect(roomFinishOrder(state, 0, 1)).toEqual(['A', 'B']);
    expect(unneededGames(state, 0, 1)).toEqual([2]);
  });

  it('needs the other unit to win both of its first 2 games', () => {
    const afterOne = winsRoom([1, 2], [[3, 9]]);
    expect(roomMatch(afterOne, 0, 1)).toMatchObject({ decidingGame: null, complete: false, countedGames: 1 });
    const afterTwo = winsRoom(
      [1, 2],
      [
        [3, 9],
        [4, 8],
      ],
    );
    expect(roomMatch(afterTwo, 0, 1)).toMatchObject({ decidingGame: 2, complete: true });
    expect(roomFinishOrder(afterTwo, 0, 1)).toEqual(['B', 'A']);
  });

  it('lets the 2-win unit win a 2 v 3 match after losing two games', () => {
    const state = winsRoom(
      [2, 3],
      [
        [1, 9],
        [1, 9],
        [9, 1],
        [9, 1],
      ],
    );
    expect(roomMatch(state, 0, 1)).toMatchObject({ decidingGame: 4, complete: true });
    expect(roomMatch(state, 0, 1)?.units.map((unit) => unit.wins)).toEqual([2, 2]);
    expect(roomFinishOrder(state, 0, 1)).toEqual(['A', 'B']);
  });

  it('orders by the wins still needed, then by the total', () => {
    const state = winsRoom(
      [2, 3],
      [
        [1, 9],
        [1, 9],
        [9, 1],
        [9, 1],
      ],
    );
    expect(unitRankScore(state, 0, 1, 0, null)).toEqual({ score: 0, tiebreak: 20 });
    expect(unitRankScore(state, 0, 1, 1, null)).toEqual({ score: -1, tiebreak: 20 });
  });

  it('counts a drawn game for nobody, and ends when every game is used', () => {
    const open = winsRoom([1, 2], [[5, 5]]);
    expect(roomMatch(open, 0, 1)).toMatchObject({ countedGames: 1, decidingGame: null, complete: false });
    const used = winsRoom(
      [1, 2],
      [
        [5, 5],
        [7, 7],
      ],
    );
    expect(roomMatch(used, 0, 1)).toMatchObject({ countedGames: 2, decidingGame: null, complete: true });
    expect(roomMatch(used, 0, 1)?.units.map((unit) => unit.wins)).toEqual([0, 0]);
  });

  it('ignores scores typed after the deciding game', () => {
    const state = winsRoom(
      [1, 2],
      [
        [10, 5],
        [1, 99],
      ],
    );
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 1, decidingGame: 1 });
    expect(roomMatch(state, 0, 1)?.units.map((unit) => unit.total)).toEqual([10, 5]);
  });

  it('re-opens the match when an earlier game is typed over', () => {
    const decided = winsRoom(
      [1, 2],
      [
        [10, 5],
        [1, 99],
      ],
    );
    expect(roomMatch(decided, 0, 1)?.complete).toBe(true);
    const corrected = winsRoom(
      [1, 2],
      [
        [3, 5],
        [1, 99],
      ],
    );
    expect(roomMatch(corrected, 0, 1)).toMatchObject({ countedGames: 2, decidingGame: 2, complete: true });
    expect(roomFinishOrder(corrected, 0, 1)).toEqual(['B', 'A']);
  });

  it('falls back to the larger target for a seat with no stamp', () => {
    const state = winsRoom([1, 2], [[10, 5]]);
    const bare = {
      ...state,
      assignments: [
        state.assignments[0].map(({ winsNeeded: _wins, ...entry }) => entry),
        state.assignments[1],
      ],
    };
    expect(roomMatch(bare, 0, 1)?.units.map((unit) => unit.needed)).toEqual([2, 2]);
    expect(roomMatch(bare, 0, 1)).toMatchObject({ decidingGame: null });
  });
});

describe('a Final where each finalist needs its own wins', () => {
  function winsFinal(needs: [number, number], finalScores: Record<string, number>): TournamentState {
    const assignments = ['A', 'B'].map((name, position) => ({
      ...buildAssignments(['A', 'B'], [2])[position],
      name,
      winsNeeded: needs[position],
    }));
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['A', 'B'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1 }),
        buildRound({
          roundNum: 2,
          rooms: [2],
          players: 2,
          isFinal: true,
          numGames: winsGameCount(...needs),
          winTargets: [
            { from: 0, wins: needs[0] },
            { from: 1, wins: needs[1] },
          ],
        }),
      ],
      assignments: [buildAssignments(['A', 'B'], [2]), assignments],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300 },
      finalScores,
    });
  }

  it('is complete once the earlier finalist wins its one game', () => {
    const state = winsFinal([1, 2], { 'game1-A': 9, 'game1-B': 3 });
    expect(isFinalComplete(state)).toBe(true);
    expect(finalsProgressState(state, 1, state.rounds[1])).toMatchObject({
      complete: true,
      order: ['A', 'B'],
    });
  });

  it('is complete once the later finalist wins its two games, and not before', () => {
    expect(isFinalComplete(winsFinal([1, 2], { 'game1-A': 3, 'game1-B': 9 }))).toBe(false);
    const state = winsFinal([1, 2], { 'game1-A': 3, 'game1-B': 9, 'game2-A': 2, 'game2-B': 9 });
    expect(isFinalComplete(state)).toBe(true);
    expect(finalsProgressState(state, 1, state.rounds[1])).toMatchObject({
      complete: true,
      order: ['B', 'A'],
    });
  });

  it('puts the finalist who reached its own target first, even with the same game wins', () => {
    const state = winsFinal([2, 3], {
      'game1-A': 1,
      'game1-B': 9,
      'game2-A': 1,
      'game2-B': 9,
      'game3-A': 9,
      'game3-B': 1,
      'game4-A': 9,
      'game4-B': 1,
    });
    expect(isFinalComplete(state)).toBe(true);
    expect(finalsProgressState(state, 1, state.rounds[1])).toMatchObject({ order: ['A', 'B'] });
    expect(computeRankings(state)?.finalists.map(({ name, total }) => [name, total])).toEqual([
      ['A', 2],
      ['B', 2],
    ]);
  });

  it('refuses to flag an anonymous game', () => {
    const state = winsFinal([1, 2], {});
    expect(flagFinalGameAnonymous(state, 1)).toBe(state);
  });
});

describe('the draft of a graph with WINS', () => {
  const text = doubleElimination({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 3' });

  function draftOf(source: string) {
    const parsed = parseWaterfallDraft(source);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  it('reads the match format and the typed values, and writes them back', () => {
    const draft = draftOf(text);
    expect(draft.rounds.find((round) => round.label === 'Final')?.match).toEqual({ kind: 'wins' });
    expect(draft.wins).toEqual({ Final: { 'Semi A.0': 2, 'Semi B.0': 3 } });
    const written = serializeWaterfallDraft(draft);
    expect(written).toContain('Final = 2 FINAL WINS');
    expect(written).toContain('Semi A: 1->Final WINS 2');
    expect(written).toContain('Semi B: 1->Final WINS 3');
    expect(draftOf(written)).toEqual(draft);
    expect(validate(written).ok).toBe(true);
  });

  it('writes no value for a default, so the text stays short', () => {
    const written = serializeWaterfallDraft(draftOf(doubleElimination()));
    expect(written).toContain('Final = 2 FINAL WINS');
    expect(written).not.toMatch(/WINS \d/);
    expect(draftOf(written).wins).toBeUndefined();
  });

  it('keeps a value with a renamed source or destination', () => {
    const renamedSource = renameWaterfallRound(draftOf(text), 'Semi A', 'Upper Final');
    expect(renamedSource.ok && serializeWaterfallDraft(renamedSource.value)).toContain(
      'Upper Final: 1->Final WINS 2',
    );
    const renamedFinal = renameWaterfallRound(draftOf(text), 'Final', 'Grand Final');
    expect(renamedFinal.ok && serializeWaterfallDraft(renamedFinal.value)).toContain(
      'Semi B: 1->Grand Final WINS 3',
    );
  });

  it('drops the values when the round stops playing WINS or the band is rerouted', () => {
    const plain = setWaterfallMatch(draftOf(text), 'Final', null);
    expect(plain.wins).toBeUndefined();
    expect(serializeWaterfallDraft(plain)).not.toContain('WINS');
    const rerouted = assignWaterfallSlots(draftOf(text), 'Semi A', [{ room: 0, rank: 1 }], 'eliminated');
    expect(rerouted.wins).toEqual({ Final: { 'Semi B.0': 3 } });
  });

  it('types and clears one value', () => {
    const typed = setWaterfallWins(draftOf(doubleElimination()), 'Final', 'Semi A.0', 4);
    expect(serializeWaterfallDraft(typed)).toContain('Semi A: 1->Final WINS 4');
    expect(setWaterfallWins(typed, 'Final', 'Semi A.0', null).wins).toBeUndefined();
  });

  it('round-trips a Qual band with a value', () => {
    const qual =
      'ROUNDS:\nSemi = 2\nFinal = 2 FINAL WINS\n\nROUTES:\nQual: 1->Final WINS 3, 2-3->Semi\nSemi: 1->Final';
    const draft = parseWaterfallDraft(qual, { standingsSource: true });
    if (!draft.ok) throw new Error(draft.error);
    expect(draft.value.wins).toEqual({ Final: { Qual: 3 } });
    expect(serializeWaterfallDraft(draft.value)).toContain('Qual: 1->Final WINS 3, 2-3->Semi');
  });
});
