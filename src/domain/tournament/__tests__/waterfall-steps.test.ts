import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { getAllTies } from '../advancement';
import { removeRosterUnit } from '../mutations';
import { isRoundDone, roundsInPlay } from '../round-columns';
import { scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { isRoundScored, roundsReadyToDraw } from '../waterfall-steps';
import {
  CASES,
  STRATEGIES,
  THREE_CHAIN_GRAPH,
  atEntry,
  drawsOf,
  indexOf,
  indexes,
  onlyFinalInPlay,
  playColumns,
  playDependency,
  pressed,
  resolveEveryTie,
  scoreBySeat,
  scoreGames,
  scoreRound,
  scoreTied,
  type Hook,
} from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * Next Round in dependency play. The invariant: a round's draw reads only the units in its own pool and their
 * history, so whatever order the rounds are scored and sent on in, every round gets the draw column play gives it.
 */

describe.each(CASES)('the draw does not depend on the order of the presses: $label', (testCase) => {
  const entry = atEntry(testCase.count, testCase.graph, testCase.setup);
  const reference = drawsOf(playColumns(entry));

  it('reaches the Final in column play with the Final drawn', () => {
    const last = entry.rounds.length - 1;
    expect(reference.assignments[last].length).toBeGreaterThan(0);
  });

  it.each(Object.entries(STRATEGIES))(
    '%s gives every round the draw column play gives it',
    (_name, strategy) => {
      const played = playDependency(entry, strategy);
      expect(drawsOf(played)).toEqual(reference);
    },
  );
});

describe('a pool fed by two rounds that send the same places', () => {
  // T3 takes the first four of X2 and of Y2. Scored by seat, their units tie on place and relative score, so only the
  // order of the pool tells them apart: the draw must still match column play, whichever round is sent first.
  const entry = atEntry(31, THREE_CHAIN_GRAPH, { qualAdv: '24' });
  const reference = drawsOf(playColumns(entry, (state) => state, scoreBySeat));

  it.each(Object.entries(STRATEGIES))('%s draws T3 and the Final as column play does', (_name, strategy) => {
    expect(drawsOf(playDependency(entry, strategy, (state) => state, scoreBySeat))).toEqual(reference);
  });
});

describe('what a press does', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const [r4u, r4l, semiA, r5l, , final] = ['R4U', 'R4L', 'SemiA', 'R5L', 'R5R', 'Final'].map((label) =>
    indexOf(entry, label),
  );

  it('starts with the entry column in play and nothing sent', () => {
    expect(roundsInPlay(entry)).toEqual(indexes(entry, 'R4U', 'R4L'));
    expect(entry.waterfallSteps).toEqual([]);
    expect(entry.curRound).toBe(r4u);
  });

  it('sends R4U on alone and draws SemiA, which only R4U feeds; R5L and R5R wait for R4L', () => {
    const next = pressed(scoreRound(entry, r4u));
    expect(next.waterfallSteps).toEqual([{ sent: [r4u], drew: [semiA] }]);
    expect(roundsInPlay(next)).toEqual(indexes(next, 'R4L', 'SemiA'));
    expect(next.assignments[semiA].length).toBeGreaterThan(0);
    expect(next.assignments[r5l] ?? []).toEqual([]);
    expect(next.curRound).toBe(r4l);
  });

  it('sends R4U and R4L on and draws SemiA, R5L and R5R', () => {
    const next = pressed(scoreRound(scoreRound(entry, r4u), r4l));
    expect(next.waterfallSteps).toEqual([
      { sent: indexes(next, 'R4U', 'R4L'), drew: indexes(next, 'SemiA', 'R5L', 'R5R') },
    ]);
    expect(roundsInPlay(next)).toEqual(indexes(next, 'SemiA', 'R5L', 'R5R'));
    expect(next.curRound).toBe(Math.min(...indexes(next, 'SemiA', 'R5L', 'R5R')));
  });

  it('leaves the input state untouched', () => {
    const scored = scoreRound(scoreRound(entry, r4u), r4l);
    const snapshot = structuredClone(scored);
    pressed(scored);
    expect(scored).toEqual(snapshot);
  });

  it('is a noop with only the Final in play', () => {
    const played = playDependency(atEntry(37, UPPER_LOWER_GRAPH), STRATEGIES['all at once']);
    expect(advanceTournamentRound(played).status).toBe('noop');
    expect(roundsInPlay(played)).toEqual([final]);
    expect(played.curRound).toBe(final);
  });

  it('is a noop with the Final fully scored too, and adds no step', () => {
    const played = playDependency(atEntry(37, UPPER_LOWER_GRAPH), STRATEGIES['all at once']);
    const scored = scoreRound(played, final);
    expect(isRoundScored(scored, final)).toBe(true);
    const result = advanceTournamentRound(scored);
    expect(result.status).toBe('noop');
    expect(result.state.waterfallSteps).toEqual(played.waterfallSteps);
  });

  it('lists the rounds a press would draw, from the rounds that would be done', () => {
    const done = new Set([...Array(r4u).keys(), r4u]);
    expect(roundsReadyToDraw(entry, done)).toEqual([semiA]);
    expect(roundsReadyToDraw(entry, new Set([...done, r4l]))).toEqual(indexes(entry, 'SemiA', 'R5L', 'R5R'));
  });
});

describe('the organiser example: upper and lower bracket with a Best of 3 Semi-Final A', () => {
  const graph = UPPER_LOWER_GRAPH.replace('SemiA = 8', 'SemiA = 8 BO3');
  const entry = withDependencyPlay(atEntry(37, graph));
  const at = (label: string) => indexOf(entry, label);

  /** R4U and R4L scored and sent: SemiA, R5L and R5R drawn. */
  const afterRound4 = () => pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));

  it('sends R5L and R5R with no question while SemiA is at game 1, and draws R6L and R6R', () => {
    let state = scoreGames(afterRound4(), at('SemiA'), [1]);
    state = scoreRound(scoreRound(state, at('R5L')), at('R5R'));
    expect(isRoundScored(state, at('SemiA'))).toBe(false);
    const next = pressed(state);
    expect(next.waterfallSteps.at(-1)).toEqual({
      sent: indexes(next, 'R5L', 'R5R'),
      drew: indexes(next, 'R6L', 'R6R'),
    });
    expect(roundsInPlay(next)).toEqual(indexes(next, 'SemiA', 'R6L', 'R6R'));
    expect(next.curRound).toBe(Math.min(...indexes(next, 'SemiA', 'R6L', 'R6R')));
  });

  /** SemiA at game 1, R5L and R5R sent, R6L and R6R drawn; R6R scored and R6L tied. */
  const withTie = () => {
    let state = pressed(
      scoreRound(scoreRound(scoreGames(afterRound4(), at('SemiA'), [1]), at('R5L')), at('R5R')),
    );
    state = scoreTied(state, at('R6L'));
    return scoreRound(state, at('R6R'));
  };

  it('sends R6R, keeps R6L and its tie, and SemiA stays in play', () => {
    const state = withTie();
    expect(Object.keys(getAllTies(state, at('R6L'))).length).toBeGreaterThan(0);
    const next = pressed(state);
    expect(next.waterfallSteps.at(-1)).toEqual({ sent: [at('R6R')], drew: [] });
    expect(roundsInPlay(next)).toEqual(indexes(next, 'SemiA', 'R6L'));
  });

  it('blocks on the tie when nothing is finished, and sends nothing', () => {
    const state = scoreTied(pressed(scoreRound(scoreRound(afterRound4(), at('R5L')), at('R5R'))), at('R6L'));
    const onlyTied: TournamentState = { ...state, scores: { ...state.scores } };
    const result = advanceTournamentRound(onlyTied);
    // SemiA, R6L (tied) and R6R (unscored) are in play and none is finished.
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.reason).toBe('pending-ties');
  });

  it('sends SemiA once decided 2-0 (game 3 blank), while the R6L tie is open; SemiB waits for R6L', () => {
    let state = pressed(withTie());
    state = scoreGames(state, at('SemiA'), [1, 2]);
    expect(isRoundScored(state, at('SemiA'))).toBe(true);
    const next = pressed(state);
    expect(next.waterfallSteps.at(-1)).toEqual({ sent: [at('SemiA')], drew: [] });
    expect(next.assignments[at('SemiB')] ?? []).toEqual([]);
    expect(roundsInPlay(next)).toEqual([at('R6L')]);
  });

  it('draws SemiB once the R6L tie is resolved and R6L is sent; the Final waits for SemiB', () => {
    let state = pressed(scoreGames(pressed(withTie()), at('SemiA'), [1, 2]));
    state = resolveEveryTie(state, at('R6L'));
    const next = pressed(state);
    expect(next.waterfallSteps.at(-1)).toEqual({ sent: [at('R6L')], drew: [at('SemiB')] });
    expect(next.assignments[at('Final')] ?? []).toEqual([]);
    expect(roundsInPlay(next)).toEqual([at('SemiB')]);
  });

  it('draws the Final when SemiB is sent: every other round is done', () => {
    let state = pressed(scoreGames(pressed(withTie()), at('SemiA'), [1, 2]));
    state = pressed(resolveEveryTie(state, at('R6L')));
    const next = pressed(scoreRound(state, at('SemiB')));
    expect(next.waterfallSteps.at(-1)).toEqual({ sent: [at('SemiB')], drew: [at('Final')] });
    expect(roundsInPlay(next)).toEqual([at('Final')]);
    expect(next.curRound).toBe(at('Final'));
  });

  it('sends a round in play that is not fully scored, when it is the only one in play and the press is confirmed', () => {
    let state = pressed(withTie());
    state = resolveEveryTie(state, at('R6L'));
    // SemiA at game 1 of 3 is the only round in play once R6L and R6R are sent.
    state = pressed(state);
    expect(roundsInPlay(state)).toEqual([at('SemiA')]);
    expect(isRoundScored(scoreGames(state, at('SemiA'), [1]), at('SemiA'))).toBe(false);
    const next = pressed(scoreGames(state, at('SemiA'), [1]));
    expect(next.waterfallSteps.at(-1)?.sent).toEqual([at('SemiA')]);
  });
});

describe('a press while a step is reopened', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
  /** What Previous leaves when a round of the step has a score: the step's draws stay, its sent rounds are in play again. */
  const reopened: TournamentState = {
    ...afterRound4,
    waterfallSteps: afterRound4.waterfallSteps.map((step) => ({ ...step, reopened: true })),
    curRound: at('R4U'),
  };
  const scoredAfter = (state: TournamentState) =>
    ['SemiA', 'R5L', 'R5R'].reduce((current, label) => scoreRound(current, at(label)), state);

  it('has the sent rounds in play again, beside the rounds they drew', () => {
    expect(roundsInPlay(reopened)).toEqual(indexes(entry, 'R4U', 'R4L', 'SemiA', 'R5L', 'R5R'));
  });

  it('clears the flag, routes nothing a second time and draws what an ordinary press draws', () => {
    const next = pressed(scoredAfter(reopened));
    const ordinary = pressed(scoredAfter(afterRound4));
    expect(next.waterfallSteps).toEqual([
      { sent: indexes(entry, 'R4U', 'R4L'), drew: indexes(entry, 'SemiA', 'R5L', 'R5R') },
      { sent: indexes(entry, 'SemiA', 'R5L', 'R5R'), drew: indexes(entry, 'R6L', 'R6R') },
    ]);
    expect(drawsOf(next)).toEqual(drawsOf(ordinary));
    expect(next.pendingBracketSeeds).toEqual(ordinary.pendingBracketSeeds);
    expect(roundsInPlay(next)).toEqual(indexes(entry, 'R6L', 'R6R'));
  });

  it('with nothing finished, sends the live rounds in play (the press is confirmed) and counts the reopened ones as done', () => {
    const next = pressed(reopened);
    expect(next.waterfallSteps.map((step) => step.reopened)).toEqual([undefined, undefined]);
    expect(next.waterfallSteps.at(-1)?.sent).toEqual(indexes(entry, 'SemiA', 'R5L', 'R5R'));
    expect(next.waterfallSteps.at(-1)?.sent).not.toContain(at('R4U'));
    expect(roundsInPlay(next)).toEqual(indexes(entry, 'R6L', 'R6R'));
  });
});

describe('an unanswered 0 in dependency play', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));

  /** The score key of the unit at `position` of room 1 of a round. */
  const keyOf = (state: TournamentState, roundIndex: number, position: number) =>
    scoreKeysForPosition({
      roundIndex,
      room: 1,
      position,
      numGames: state.rounds[roundIndex].numGames ?? 1,
    })[0];

  /** SemiA and R5R scored, R5L scored with a 0 for its first unit that nobody has answered. */
  const withZero = () => {
    const state = ['SemiA', 'R5R', 'R5L'].reduce(
      (current, label) => scoreRound(current, at(label)),
      afterRound4,
    );
    const key = keyOf(state, at('R5L'), 0);
    return { state: { ...state, scores: { ...state.scores, [key]: 0 } }, key };
  };

  it('keeps its round in play while the finished rounds are sent, and draws nothing that round feeds', () => {
    const { state } = withZero();
    const next = pressed(state);
    expect(next.waterfallSteps.at(-1)).toEqual({ sent: indexes(next, 'SemiA', 'R5R'), drew: [] });
    expect(roundsInPlay(next)).toEqual([at('R5L')]);
    expect(next.assignments[at('R6L')] ?? []).toEqual([]);
    expect(next.assignments[at('R6R')] ?? []).toEqual([]);
  });

  it('blocks a press that has only that round left, and sends it once answered', () => {
    const waiting = pressed(withZero().state);
    const blocked = advanceTournamentRound(waiting);
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') expect(blocked.reason).toBe('pending-absences');
    const answered = answerAbsence(waiting, [withZero().key], 'absent');
    const next = pressed(answered);
    expect(next.waterfallSteps.at(-1)).toEqual({
      sent: [at('R5L')],
      drew: indexes(next, 'R6L', 'R6R'),
    });
  });
});

describe('holds', () => {
  const numbered = (graphText: string, labels: Record<string, number>) =>
    Object.entries(labels).reduce(
      (text, [label, column]) =>
        text.replace(new RegExp(`^(${label} = [^\\n]*?)$`, 'm'), `$1 COLUMN ${column}`),
      graphText,
    );

  it('a round with a manual COLUMN is not drawn before every earlier column is sent on', () => {
    const graph = numbered(UPPER_LOWER_GRAPH, { R6L: 3, R6R: 3 });
    const held = withDependencyPlay(atEntry(37, graph));
    const free = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
    const [r4u, r4l, r5l, r5r, r6l] = ['R4U', 'R4L', 'R5L', 'R5R', 'R6L'].map((label) =>
      indexOf(held, label),
    );
    const play = (state: TournamentState) =>
      pressed(scoreRound(scoreRound(pressed(scoreRound(scoreRound(state, r4u), r4l)), r5l), r5r));
    // SemiA is in the column before R6L and is not scored: the numbered R6L waits for it, the automatic one does not.
    expect(play(free).assignments[r6l].length).toBeGreaterThan(0);
    expect(play(held).assignments[r6l] ?? []).toEqual([]);
  });

  it('numbering every round after its column plays press for press like column play', () => {
    const everyColumn = Object.fromEntries(
      [
        ['R4U', 1],
        ['R4L', 1],
        ['SemiA', 2],
        ['R5L', 2],
        ['R5R', 2],
        ['R6L', 3],
        ['R6R', 3],
        ['SemiB', 4],
      ].map(([label, column]) => [label, column]),
    ) as Record<string, number>;
    const start = atEntry(37, numbered(UPPER_LOWER_GRAPH, everyColumn));
    let columns = start;
    let dependency = withDependencyPlay(start);
    for (let guard = 0; guard < 10 && !onlyFinalInPlay(dependency); guard += 1) {
      for (const index of roundsInPlay(columns)) {
        columns = scoreRound(columns, index);
        dependency = scoreRound(dependency, index);
      }
      columns = pressed(columns);
      dependency = pressed(dependency);
      expect(drawsOf(dependency)).toEqual(drawsOf(columns));
      expect(roundsInPlay(dependency)).toEqual(roundsInPlay(columns));
    }
    expect(onlyFinalInPlay(dependency)).toBe(true);
  });

  it('the Final is not drawn while a ranking room is still in play', () => {
    let state = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
    const r6r = indexOf(state, 'R6R');
    const final = indexOf(state, 'Final');
    for (let guard = 0; guard < 20 && !isRoundDone(state, indexOf(state, 'SemiB')); guard += 1) {
      for (const index of roundsInPlay(state)) {
        if (index !== r6r && !state.rounds[index].isFinal) state = scoreRound(state, index);
      }
      state = pressed(state);
      expect(state.assignments[final] ?? []).toEqual([]);
    }
    expect(roundsInPlay(state)).toEqual([r6r]);
    const next = pressed(scoreRound(state, r6r));
    expect(next.assignments[final].length).toBeGreaterThan(0);
  });
});

describe('a press is all or nothing', () => {
  it('returns the input state itself, unchanged, when a round to draw does not fit', () => {
    const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
    const semiA = indexOf(entry, 'SemiA');
    // SemiA declares 8 seats and takes 8 units; with 6 seats declared, 8 arriving can not be drawn.
    const short: TournamentState = {
      ...entry,
      rounds: entry.rounds.map((round, index) => (index === semiA ? { ...round, rooms: [6] } : round)),
    };
    const scored = scoreRound(scoreRound(short, indexOf(short, 'R4U')), indexOf(short, 'R4L'));
    const snapshot = structuredClone(scored);
    const result = advanceTournamentRound(scored);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.state).toBe(scored);
    expect(scored).toEqual(snapshot);
  });
});

describe('roster changes land where column play puts them', () => {
  /** Applies `change` once, the first time `when` holds after an advance, in either play. */
  const once = (when: (state: TournamentState) => boolean, change: Hook): Hook => {
    let done = false;
    return (state) => {
      if (done || !when(state)) return state;
      done = true;
      return change(state);
    };
  };

  const entry = atEntry(37, UPPER_LOWER_GRAPH);
  const drawn = (label: string) => (state: TournamentState) =>
    (state.assignments[indexOf(state, label)] ?? []).length > 0;
  const nameIn = (state: TournamentState, label: string, position: number) =>
    state.assignments[indexOf(entry, label)][position].name;
  const referenceState = playColumns(entry);

  it('a unit removed from a round in play, which is not the one curRound is in', () => {
    const victim = nameIn(referenceState, 'R6L', 0);
    const remove = () => once(drawn('R6L'), (state) => removeRosterUnit(state, victim));
    const columns = playColumns(entry, remove());
    const dependency = playDependency(entry, STRATEGIES['one round at a time, forward'], remove());
    expect(drawsOf(dependency)).toEqual(drawsOf(columns));
    expect(dependency.assignments[indexOf(entry, 'R6L')].map((entry2) => entry2.name)).not.toContain(victim);
  });

  it('removes the unit from the round in play that holds it, with SemiA still in play beside R6L', () => {
    let state = withDependencyPlay(entry);
    state = pressed(scoreRound(scoreRound(state, indexOf(state, 'R4U')), indexOf(state, 'R4L')));
    state = pressed(scoreRound(scoreRound(state, indexOf(state, 'R5L')), indexOf(state, 'R5R')));
    const r6l = indexOf(state, 'R6L');
    const semiA = indexOf(state, 'SemiA');
    expect(roundsInPlay(state)).toContain(semiA);
    expect(state.curRound).toBe(semiA);
    const victim = state.assignments[r6l][0].name;
    const removed = removeRosterUnit(state, victim);
    expect(removed.assignments[r6l].map((assignment) => assignment.name)).not.toContain(victim);
    expect(removed.assignments[semiA]).toEqual(state.assignments[semiA]);
  });

  it('a unit removed while it waits in a pool', () => {
    const semiA = indexOf(entry, 'SemiA');
    const semiB = indexOf(entry, 'SemiB');
    const victim = referenceState.assignments[semiA].find((unit) =>
      (referenceState.assignments[semiB] ?? []).some((other) => other.name === unit.name),
    )?.name as string;
    expect(victim).toBeDefined();
    const waiting = (state: TournamentState) =>
      Object.values(state.pendingBracketSeeds).some((pool) => pool.some((seed) => seed.name === victim));
    const remove = () => once(waiting, (state) => removeRosterUnit(state, victim));
    const columns = playColumns(entry, remove());
    expect(columns.assignments[semiB].map((unit) => unit.name)).not.toContain(victim);
    // When SemiA is sent in the same press that draws SemiB (backward) the unit never waits: only the other orders apply.
    let waited = 0;
    for (const strategy of Object.values(STRATEGIES)) {
      const played = playDependency(entry, strategy, remove());
      if (!played.withdrawnUnits.some((unit) => unit.name === victim)) continue;
      waited += 1;
      expect(drawsOf(played)).toEqual(drawsOf(columns));
    }
    expect(waited).toBeGreaterThanOrEqual(2);
  });

  it('an absentee of a round in play is routed as in column play', () => {
    const r5l = indexOf(entry, 'R5L');
    const absent = nameIn(referenceState, 'R5L', 1);
    const markAbsent = (state: TournamentState): TournamentState => {
      const seat = state.assignments[r5l].findIndex((unit) => unit.name === absent);
      const room = state.assignments[r5l][seat].room as number;
      const position = state.assignments[r5l]
        .filter((unit) => unit.room === room)
        .findIndex((unit) => unit.name === absent);
      const key = scoreKeysForPosition({
        roundIndex: r5l,
        room,
        position,
        numGames: state.rounds[r5l].numGames ?? 1,
      })[0];
      return answerAbsence({ ...state, scores: { ...state.scores, [key]: 0 } }, [key], 'absent');
    };
    const scoreWithAbsentee = (state: TournamentState, index: number): TournamentState =>
      index === r5l ? markAbsent(scoreRound(state, index)) : scoreRound(state, index);
    let columns = entry;
    let dependency = withDependencyPlay(entry);
    for (let guard = 0; guard < 20 && !columns.rounds[columns.curRound].isFinal; guard += 1) {
      for (const index of roundsInPlay(columns)) columns = scoreWithAbsentee(columns, index);
      columns = pressed(columns);
    }
    for (let guard = 0; guard < 60 && !onlyFinalInPlay(dependency); guard += 1) {
      const first = roundsInPlay(dependency).filter((index) => !dependency.rounds[index].isFinal)[0];
      dependency = pressed(scoreWithAbsentee(dependency, first));
    }
    expect(Object.values(dependency.absences)).toContain('absent');
    expect(drawsOf(dependency)).toEqual(drawsOf(columns));
  });
});
