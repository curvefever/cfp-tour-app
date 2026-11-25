import { describe, expect, it } from 'vitest';
import { roomFinishOrder } from '../room-results';
import { answerAbsence, absentInRoom, pendingAbsenceQuestions } from '../absences';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { roomMatch, winsGameCount } from '../match-format';
import { renameIndividualResult } from '../mutations';
import { computeRankings, isFinalComplete } from '../rankings';
import { parseMatchOverrides } from '../round-match-formats';
import { finalScoreKey, scoredMemberSlots, scoredTeamSize } from '../scoring';
import type { RoundAssignment, TournamentRound, TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { goBack } from '../go-back';
import {
  STRATEGIES,
  indexOf,
  onlyFinalInPlay,
  playColumns,
  playDependency,
  pressed,
} from './dependency-play-fixtures';
import { atEntry, firstBracketIndex, swiss, toSwissExit } from './swiss-source-fixtures';
import { oneRoomState } from './test-fixtures';

/**
 * A 3v3 Swiss of 14 teams into a hand-written double elimination of 8 whose Final is uneven wins, the shape of the
 * tournament this feature is for: Semi A is the upper final, Semi B the lower final, and the Final is Semi A's winner
 * against Semi B's winner.
 */
function graph(
  options: { semiA?: string; semiB?: string; final?: string; qual?: string | null } = {},
): string {
  const qual = options.qual === null ? '' : `${options.qual ?? 'Qual: 1-8->R1'}\n`;
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
${qual}R1.A: 1->U2, 2->L2
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

const RULES = [ONE_SCORE_PER_TEAM, 'designated-player'] as const;

function swissSetup(rule: (typeof RULES)[number]) {
  return {
    gameFormat: 'team-3v3' as const,
    teamScoringRule: rule,
    scoring: 'match-results' as const,
    matchResultPoints: '3, 2, 1, 0',
    tieMargin: '15',
    swissRoundsOverride: '5',
  };
}

function start(count: number, rule: (typeof RULES)[number], text = graph()): TournamentState {
  return swiss(count, swissSetup(rule), text);
}

/** The state with the Final drawn and nothing of it scored, played in column play. */
function toFinal(startState: TournamentState): TournamentState {
  return playColumns(atEntry(startState));
}

const finalIndex = (state: TournamentState) => state.rounds.findIndex((round) => round.isFinal);

/** The unit that won the room of the round called `label`. */
function winnerOf(state: TournamentState, label: string): string {
  return roomFinishOrder(state, indexOf(state, label), 1)[0];
}

/** The Final with its games typed: `games[g]` is the pair of scores of game g + 1, upper finalist first. */
function scoreFinal(state: TournamentState, games: Array<[number, number]>): TournamentState {
  const index = finalIndex(state);
  const finalists = [winnerOf(state, 'Semi A'), winnerOf(state, 'Semi B')];
  const teamSize = scoredTeamSize(state);
  const finalScores = { ...state.finalScores };
  games.forEach((pair, game) =>
    finalists.forEach((name, seat) => {
      const slots = teamSize ? scoredMemberSlots(state, name, index, teamSize) : [undefined];
      for (const slot of slots) finalScores[finalScoreKey(game + 1, name, slot)] = pair[seat];
    }),
  );
  return { ...state, finalScores };
}

const stampsOf = (assignments: RoundAssignment[]) =>
  Object.fromEntries(assignments.map((entry) => [entry.name, entry.winsNeeded]));

describe.each(RULES)('a 3v3 Swiss into a double elimination with a WINS Final (%s)', (rule) => {
  const first = start(14, rule);

  it('stamps each finalist with the wins of the round it comes from: the earlier final 1, the later final 2', () => {
    const state = toFinal(first);
    const upper = winnerOf(state, 'Semi A');
    const lower = winnerOf(state, 'Semi B');
    const final = state.rounds[finalIndex(state)];
    expect(final.winTargets).toEqual([
      { from: indexOf(state, 'Semi A'), wins: 1 },
      { from: indexOf(state, 'Semi B'), wins: 2 },
    ]);
    expect(final.numGames).toBe(2);
    expect(stampsOf(state.assignments[finalIndex(state)])).toEqual({ [upper]: 1, [lower]: 2 });
  });

  it('tags every arrival of the Custom bracket with the round it comes from', () => {
    const lastSwiss = firstBracketIndex(first) - 1;
    let seen = 0;
    let state = atEntry(first);
    const check = (current: TournamentState) => {
      for (const seeds of Object.values(current.pendingBracketSeeds)) {
        for (const seed of seeds) {
          expect(seed.from, `${seed.name} has no source round`).toBeTypeOf('number');
          seen += 1;
        }
      }
      return current;
    };
    state = check(state);
    playColumns(state, check);
    expect(seen).toBeGreaterThan(0);
    // The Qual arrivals come from the last Swiss round, the one holding the routing.
    expect(lastSwiss).toBe(first.rounds.findIndex((round) => round.standingsRoutes));
  });

  it('is decided by the upper finalist winning game 1, and the podium follows', () => {
    const state = scoreFinal(toFinal(first), [[300, 100]]);
    const upper = winnerOf(state, 'Semi A');
    const lower = winnerOf(state, 'Semi B');
    expect(isFinalComplete(state)).toBe(true);
    expect(roomMatch(state, finalIndex(state), 1)).toMatchObject({ decidingGame: 1, complete: true });
    expect(computeRankings(state)?.finalists.map(({ name, total, rank }) => [name, total, rank])).toEqual([
      [upper, 1, 1],
      [lower, 0, 2],
    ]);
  });

  it('is not decided by the lower finalist winning game 1, and is by winning game 2 as well', () => {
    const afterOne = scoreFinal(toFinal(first), [[100, 300]]);
    expect(isFinalComplete(afterOne)).toBe(false);
    const decided = scoreFinal(toFinal(first), [
      [100, 300],
      [100, 300],
    ]);
    const upper = winnerOf(decided, 'Semi A');
    const lower = winnerOf(decided, 'Semi B');
    expect(isFinalComplete(decided)).toBe(true);
    expect(computeRankings(decided)?.finalists.map(({ name, total, rank }) => [name, total, rank])).toEqual([
      [lower, 2, 1],
      [upper, 0, 2],
    ]);
  });

  it('lets the upper finalist win game 2 after losing game 1, with fewer game wins than a one-all would give', () => {
    const state = scoreFinal(toFinal(first), [
      [100, 300],
      [300, 100],
    ]);
    const upper = winnerOf(state, 'Semi A');
    expect(isFinalComplete(state)).toBe(true);
    expect(computeRankings(state)?.finalists[0]).toMatchObject({ name: upper, rank: 1 });
    expect(computeRankings(state)?.finalists[1].rank).toBe(2);
  });

  it('plays the same draw in dependency play as in column play', () => {
    const entry = atEntry(first);
    const columns = playColumns(entry);
    const dependency = playDependency(entry, STRATEGIES['all at once']);
    expect(onlyFinalInPlay(dependency)).toBe(true);
    expect(stampsOf(dependency.assignments[finalIndex(dependency)])).toEqual(
      stampsOf(columns.assignments[finalIndex(columns)]),
    );
  });

  it('draws the Final again with the same stamps after Previous', () => {
    const played = playDependency(atEntry(first), STRATEGIES['all at once']);
    const stamps = stampsOf(played.assignments[finalIndex(played)]);
    const back = goBack(played);
    expect(back.assignments[finalIndex(back)] ?? []).toEqual([]);
    const again = pressed(back);
    expect(stampsOf(again.assignments[finalIndex(again)])).toEqual(stamps);
  });

  it('plays to a podium with typed 2 v 3, the finalist with fewer game wins needed placed first on a 2-2 finish', () => {
    const typed = graph({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 3' });
    const state = scoreFinal(toFinal(start(14, rule, typed)), [
      [100, 300],
      [100, 300],
      [300, 100],
      [300, 100],
    ]);
    const upper = winnerOf(state, 'Semi A');
    const lower = winnerOf(state, 'Semi B');
    expect(state.rounds[finalIndex(state)].numGames).toBe(winsGameCount(2, 3));
    expect(isFinalComplete(state)).toBe(true);
    expect(roomMatch(state, finalIndex(state), 1)?.units.map((unit) => unit.wins)).toEqual([2, 2]);
    expect(computeRankings(state)?.finalists.map(({ name, rank }) => [name, rank])).toEqual([
      [upper, 1],
      [lower, 2],
    ]);
  });

  it('stamps the earlier finalist with the larger number when it is typed so (3 v 1)', () => {
    const typed = graph({ semiA: '1->Final WINS 3', semiB: '1->Final WINS 1' });
    const state = toFinal(start(14, rule, typed));
    expect(stampsOf(state.assignments[finalIndex(state)])).toEqual({
      [winnerOf(state, 'Semi A')]: 3,
      [winnerOf(state, 'Semi B')]: 1,
    });
  });
});

describe('a finalist renamed before the Final is scored', () => {
  it('keeps its stamp, and the match reads the new name', () => {
    const state = toFinal(swiss(14, { gameFormat: 'individual-1v1', swissRoundsOverride: '5' }, graph()));
    const upper = winnerOf(state, 'Semi A');
    const lower = winnerOf(state, 'Semi B');
    const renamed = renameIndividualResult(state, upper, 'Zed');
    expect(renamed.status).toBe('done');
    if (renamed.status !== 'done') return;
    const after = renamed.state;
    expect(stampsOf(after.assignments[finalIndex(after)])).toEqual({ Zed: 1, [lower]: 2 });
    const needed = roomMatch(after, finalIndex(after), 1)?.units.map((unit) => [unit.name, unit.needed]);
    expect(Object.fromEntries(needed ?? [])).toEqual({ Zed: 1, [lower]: 2 });
  });
});

describe('the stamps at the awkward counts of the Swiss in front', () => {
  it.each([13, 15])(
    'a Swiss of %i teams with the bye sends 8 into the bracket and stamps the Final',
    (count) => {
      const state = toFinal(start(count, ONE_SCORE_PER_TEAM));
      expect(stampsOf(state.assignments[finalIndex(state)])).toEqual({
        [winnerOf(state, 'Semi A')]: 1,
        [winnerOf(state, 'Semi B')]: 2,
      });
    },
  );
});

describe('a Qual arrival into a WINS round', () => {
  const qualFinal = `
ROUNDS:
Semi = 2
Final = 2 FINAL WINS

ROUTES:
Qual: 1->Final, 2-3->Semi
Semi: 1->Final
`;

  it("stores the Swiss round as the source, and the qualifier's pool entry carries the same one", () => {
    const state = swiss(9, { gameFormat: 'individual-1v1', swissRoundsOverride: '3' }, qualFinal);
    const lastSwiss = firstBracketIndex(state) - 1;
    const final = state.rounds[finalIndex(state)];
    expect(final.winTargets).toEqual([
      { from: lastSwiss, wins: 1 },
      { from: indexOf(state, 'Semi'), wins: 2 },
    ]);
    const atExit = pressed(toSwissExit(state));
    const waiting = atExit.pendingBracketSeeds[finalIndex(atExit)] ?? [];
    expect(waiting.map((seed) => seed.from)).toEqual([lastSwiss]);
    expect(waiting[0].from).toBe(final.winTargets?.[0].from);
    const drawn = playColumns(atExit);
    expect(stampsOf(drawn.assignments[finalIndex(drawn)])).toEqual({
      [waiting[0].name]: 1,
      [winnerOf(drawn, 'Semi')]: 2,
    });
  });
});

describe('the same graph with no Swiss in front', () => {
  const noPooling = () =>
    swiss(8, { gameFormat: 'individual-1v1', poolingPhase: 'none' }, graph({ qual: null }));

  it('tags the arrivals with their source round and keeps the defaults', () => {
    const state = noPooling();
    expect(state.rounds[finalIndex(state)].winTargets).toEqual([
      { from: indexOf(state, 'Semi A'), wins: 1 },
      { from: indexOf(state, 'Semi B'), wins: 2 },
    ]);
    let tagged = 0;
    const played = playColumns(state, (current) => {
      for (const seeds of Object.values(current.pendingBracketSeeds)) {
        for (const seed of seeds) {
          expect(seed.from).toBeTypeOf('number');
          tagged += 1;
        }
      }
      return current;
    });
    expect(tagged).toBeGreaterThan(0);
    expect(stampsOf(played.assignments[finalIndex(played)])).toEqual({
      [winnerOf(played, 'Semi A')]: 1,
      [winnerOf(played, 'Semi B')]: 2,
    });
  });
});

describe('a live graph edit of a WINS Final', () => {
  const text = graph();

  it('changes the targets of a Final that is not drawn yet', () => {
    const state = atEntry(start(14, ONE_SCORE_PER_TEAM));
    const edited = applyWaterfallGraphEdit(
      state,
      graph({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 3' }),
    );
    expect(edited.ok ? '' : edited.error).toBe('');
    if (!edited.ok) return;
    const final = edited.state.rounds[finalIndex(edited.state)];
    expect(final.winTargets?.map((target) => target.wins)).toEqual([2, 3]);
    expect(final.numGames).toBe(4);
  });

  it('adds WINS to a Final that played one game each, before it is drawn', () => {
    const state = atEntry(start(14, ONE_SCORE_PER_TEAM, graph({ final: 'Final = 2 FINAL' })));
    expect(state.rounds[finalIndex(state)].winTargets).toBeUndefined();
    const edited = applyWaterfallGraphEdit(state, text);
    expect(edited.ok ? '' : edited.error).toBe('');
    if (!edited.ok) return;
    expect(edited.state.rounds[finalIndex(edited.state)].winTargets).toHaveLength(2);
  });

  it('refuses to change the targets of a Final that is drawn, and saves the unchanged graph', () => {
    const state = toFinal(start(14, ONE_SCORE_PER_TEAM));
    const refused = applyWaterfallGraphEdit(
      state,
      graph({ semiA: '1->Final WINS 2', semiB: '1->Final WINS 3' }),
    );
    expect(refused).toEqual({
      ok: false,
      error: 'Can\'t save: "Final" has already been drawn, so its uneven wins can\'t change.',
    });
    const dropped = applyWaterfallGraphEdit(state, graph({ final: 'Final = 2 FINAL' }));
    expect(dropped.ok).toBe(false);
    const same = applyWaterfallGraphEdit(state, text);
    expect(same.ok ? '' : same.error).toBe('');
  });
});

describe('a round override asking for WINS', () => {
  it('is no format: the line is dropped, as the line of any other word is', () => {
    expect(parseMatchOverrides('Round 2: WINS\nFinal: BO3\nSemi: wins\nRound 3: nonsense')).toEqual({
      Final: 'BO3',
    });
  });
});

describe('an absentee in a WINS room', () => {
  function room(needs: [number, number], games: number[][]): TournamentState {
    const scores: Record<string, number> = {};
    games.forEach((row, game) =>
      row.forEach((value, position) => {
        scores[`r0-rm1-p${position}-g${game + 1}`] = value;
      }),
    );
    const base = oneRoomState({
      players: ['A', 'B'],
      rounds: [
        {
          winTargets: [
            { from: 0, wins: needs[0] },
            { from: 1, wins: needs[1] },
          ],
          numGames: winsGameCount(...needs),
          isWaterfall: true,
        } satisfies Partial<TournamentRound>,
        {},
      ],
      scores,
    });
    return {
      ...base,
      assignments: [
        base.assignments[0].map((entry, position) => ({ ...entry, winsNeeded: needs[position] })),
        base.assignments[1],
      ],
    };
  }

  it('loses the games it has a 0 in, and asks only about the games that count', () => {
    const state = room(
      [2, 1],
      [
        [0, 90],
        [0, 80],
      ],
    );
    expect(roomMatch(state, 0, 1)).toMatchObject({ decidingGame: 1, complete: true });
    expect(
      pendingAbsenceQuestions(state).flatMap((entry) => entry.questions.map((question) => question.key)),
    ).toEqual(['r0-rm1-p0-g1']);
    const answered = answerAbsence(state, ['r0-rm1-p0-g1'], 'absent');
    expect(absentInRoom(answered, 0, 1)).toEqual(['A']);
    expect(roomFinishOrder(answered, 0, 1)).toEqual(['B', 'A']);
  });
});
