import { describe, expect, it } from 'vitest';
import {
  answerAbsence,
  clearAbsenceAnswer,
  hasBlockingAbsenceQuestions,
  hasBlockingAbsenceQuestionsInRound,
  pendingAbsenceQuestions,
  unitsAwaitingAnswer,
  zeroScoresInPlay,
} from '../absences';
import { getAllColumnTies, hasPendingColumnTies } from '../advancement';
import { bracketFollowStatus, bracketRoundDefaultCollapsed, projectFutureRoundSlots } from '../bracket';
import { expectedRounds } from '../expected-draw';
import { computeRankings } from '../rankings';
import { currentColumn, isRoundDone, roundsInPlay, undrawnRounds } from '../round-columns';
import { scoreKeysForPosition, unscoredRooms } from '../scoring';
import type { TournamentState } from '../types';
import { finishedRoundsInPlay, goBack, isRoundScored } from '../waterfall-steps';
import {
  CASES,
  STRATEGIES,
  atEntry,
  indexOf,
  indexes,
  playColumns,
  pressed,
  resolveEveryTie,
  scoreRound,
  scoreTied,
  type Strategy,
} from './dependency-play-fixtures';
import { followBannerText } from '../../../features/bracket/follow-text';
import { describeStandings } from '../standings-display';
import { absentMatchRows } from '../../../features/rankings/absent-panel';
import { unscoredRoomsMessage } from '../../../features/bracket/next-round-warning';
import { withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * The readers of "the round in play" in dependency play. On the upper and lower graph, with SemiA still being
 * played, R6L and R6R drawn: curRound is SemiA, whose column does not hold R6L, so nothing may read a column.
 */

const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
const at = (label: string) => indexOf(entry, label);

const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));

/** R5L and R5R scored and sent, SemiA still unscored: R6L and R6R are drawn and in play beside it. */
const besideSemiA = pressed(scoreRound(scoreRound(afterRound4, at('R5L')), at('R5R')));

const keyOf = (state: TournamentState, roundIndex: number, position: number) =>
  scoreKeysForPosition({
    roundIndex,
    room: 1,
    position,
    numGames: state.rounds[roundIndex].numGames ?? 1,
  })[0];

describe('the state the readers are checked on', () => {
  it('has R6L and R6R in play beside SemiA, outside the column of curRound', () => {
    expect(roundsInPlay(besideSemiA)).toEqual(indexes(besideSemiA, 'SemiA', 'R6L', 'R6R'));
    expect(besideSemiA.curRound).toBe(at('SemiA'));
    const column = currentColumn(besideSemiA);
    expect(at('R6L')).toBeGreaterThan(column.end);
  });
});

describe("an unanswered 0 in a round in play beyond curRound's column", () => {
  const zeroKey = keyOf(besideSemiA, at('R6L'), 0);
  const scored = (): TournamentState => {
    const state = scoreRound(scoreRound(besideSemiA, at('R6L')), at('R6R'));
    return { ...state, scores: { ...state.scores, [zeroKey]: 0 } };
  };

  it('asks about it, blocks Next Round, and does not count the round as finished', () => {
    const state = scored();
    expect(zeroScoresInPlay(state).map((room) => room.roundIndex)).toContain(at('R6L'));
    expect(pendingAbsenceQuestions(state).map((room) => room.roundIndex)).toEqual([at('R6L')]);
    expect(hasBlockingAbsenceQuestions(state)).toBe(true);
    expect(hasBlockingAbsenceQuestionsInRound(state, at('R6L'))).toBe(true);
    expect(isRoundScored(state, at('R6L'))).toBe(true);
    expect(finishedRoundsInPlay(state)).toEqual([at('R6R')]);
  });

  it('holds a tie at 0 back until it is answered', () => {
    const state = scored();
    const unit = state.assignments[at('R6L')].filter((candidate) => candidate.room === 1)[0].name;
    expect(unitsAwaitingAnswer(state, at('R6L'), 1).has(unit)).toBe(true);
  });

  it('can be answered and taken back, and the round is finished once answered', () => {
    const state = scored();
    const answered = answerAbsence(state, [zeroKey], 'absent');
    expect(answered.absences[zeroKey]).toBe('absent');
    expect(hasBlockingAbsenceQuestionsInRound(answered, at('R6L'))).toBe(false);
    expect(finishedRoundsInPlay(answered)).toEqual(indexes(answered, 'R6L', 'R6R'));
    const taken = clearAbsenceAnswer(answered, zeroKey);
    expect(taken.absences[zeroKey]).toBeUndefined();
    expect(hasBlockingAbsenceQuestionsInRound(taken, at('R6L'))).toBe(true);
  });

  it('is not sent on by a press while the question is open', () => {
    const next = pressed(scored());
    expect(next.waterfallSteps.at(-1)?.sent).toEqual([at('R6R')]);
    expect(roundsInPlay(next)).toEqual(indexes(next, 'SemiA', 'R6L'));
  });
});

describe("a tie in a round in play beyond curRound's column", () => {
  it('shows with the column ties and blocks until resolved', () => {
    const state = scoreTied(besideSemiA, at('R6L'));
    const keys = Object.keys(getAllColumnTies(state));
    expect(keys.some((key) => key.startsWith(`r${at('R6L')}-`))).toBe(true);
    expect(hasPendingColumnTies(state)).toBe(true);
    expect(hasPendingColumnTies(resolveEveryTie(state, at('R6L')))).toBe(false);
  });

  it('keeps the round out of the finished ones', () => {
    const state = scoreRound(scoreTied(besideSemiA, at('R6L')), at('R6R'));
    expect(finishedRoundsInPlay(state)).toEqual([at('R6R')]);
  });
});

describe('the rooms with no score yet', () => {
  it("lists the rooms of every round in play, the ones beyond curRound's column too", () => {
    const state = scoreRound(besideSemiA, at('R6L'));
    const rounds = new Set(unscoredRooms(state).map((room) => room.roundIndex));
    expect(rounds).toEqual(new Set([at('SemiA'), at('R6R')]));
  });
});

describe('the lists the features read', () => {
  it('the confirmation names each room with its round when several rounds are in play', () => {
    const state = scoreRound(besideSemiA, at('R6L'));
    const rooms = unscoredRooms(state);
    const message = unscoredRoomsMessage(state, rooms);
    expect(message).toContain('SemiA · Room A');
    expect(message).toContain('R6R · Room A');
  });

  it('the Absent panel lists an absentee of a round outside the column of curRound, and lets it be marked played', () => {
    const zeroKey = keyOf(besideSemiA, at('R6L'), 0);
    const scored = scoreRound(besideSemiA, at('R6L'));
    const answered = answerAbsence(
      { ...scored, scores: { ...scored.scores, [zeroKey]: 0 } },
      [zeroKey],
      'absent',
    );
    const rows = absentMatchRows(answered).filter((row) => row.id.startsWith(`${at('R6L')}-`));
    expect(rows).toHaveLength(1);
    expect(rows[0].canMarkPlayed).toBe(true);
  });
});

describe('the follow status of a unit in dependency play', () => {
  it('reads a unit waiting in a pool, or in a round in play, as not out', () => {
    const state = besideSemiA;
    const pooled = Object.values(state.pendingBracketSeeds).flatMap((seeds) =>
      seeds.map((seed) => seed.name),
    );
    for (const name of new Set(pooled))
      expect(bracketFollowStatus(state, name)?.eliminated, name).toBe(false);
    for (const label of ['SemiA', 'R6L', 'R6R']) {
      for (const unit of state.assignments[at(label)]) {
        expect(bracketFollowStatus(state, unit.name)?.eliminated, `${unit.name} in ${label}`).toBe(false);
      }
    }
  });

  it('reads a unit whose last round is done and that waits nowhere as out', () => {
    const state = besideSemiA;
    const sentHome = state.assignments[at('R5R')].map((unit) => unit.name);
    expect(sentHome.length).toBeGreaterThan(0);
    for (const name of sentHome) expect(bracketFollowStatus(state, name)?.eliminated, name).toBe(true);
  });
});

describe('the follow box in dependency play', () => {
  const textFor = (state: TournamentState, name: string) =>
    followBannerText(state, bracketFollowStatus(state, name), describeStandings(state), name).detail;

  it('names the room of a unit in a round in play and never says Out for it', () => {
    for (const label of ['SemiA', 'R6L', 'R6R']) {
      for (const unit of besideSemiA.assignments[at(label)]) {
        expect(textFor(besideSemiA, unit.name), `${unit.name} in ${label}`).toMatch(
          new RegExp(`^${label} · Room `),
        );
      }
    }
  });

  it('says Out for a unit R5R sent home, and names the place it had', () => {
    const name = besideSemiA.assignments[at('R5R')][0].name;
    expect(textFor(besideSemiA, name)).toMatch(/^Out in R5R · Room [A-Z] · [0-9]+(st|nd|rd|th)$/);
  });
});

describe('the folding of a column', () => {
  it('folds a column once it and the next column are done', () => {
    // R4U and R4L are done; the next column, [R5R, SemiA, R5L], is not (SemiA is in play).
    expect(bracketRoundDefaultCollapsed(besideSemiA, at('R4U'))).toBe(false);
    const semiASent = pressed(scoreRound(besideSemiA, at('SemiA')));
    expect(isRoundDone(semiASent, at('SemiA'))).toBe(true);
    expect(bracketRoundDefaultCollapsed(semiASent, at('R4U'))).toBe(true);
    expect(bracketRoundDefaultCollapsed(semiASent, at('R5L'))).toBe(false);
  });

  it('folds exactly the columns before the previous one in column play', () => {
    const columns = playColumns(atEntry(37, UPPER_LOWER_GRAPH));
    const rounds = columns.rounds.map((_, index) => bracketRoundDefaultCollapsed(columns, index));
    // At the Final: every column before the one before the Final folds, the last two do not.
    expect(rounds[at('R4U')]).toBe(true);
    expect(rounds.at(-1)).toBe(false);
  });
});

describe('the slots of the rounds not drawn', () => {
  it('are projected for every undrawn round, and for no drawn one', () => {
    const slots = projectFutureRoundSlots(besideSemiA);
    expect(Object.keys(slots).map(Number)).toEqual(undrawnRounds(besideSemiA));
    expect(undrawnRounds(besideSemiA)).toEqual(indexes(besideSemiA, 'SemiB', 'Final'));
  });
});

describe('what the Bracket shows ahead is what the next press draws', () => {
  const walk = (
    start: TournamentState,
    strategy: Strategy,
    check: (before: TournamentState, after: TournamentState) => void,
  ) => {
    let state = withDependencyPlay(start);
    for (
      let guard = 0;
      guard < 60 && roundsInPlay(state).some((index) => !state.rounds[index].isFinal);
      guard += 1
    ) {
      const unscored = roundsInPlay(state).filter(
        (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
      );
      for (const index of strategy(state, unscored, guard)) state = scoreRound(state, index);
      const before = state;
      state = pressed(before);
      check(before, state);
    }
  };

  it.each(Object.entries(STRATEGIES))(
    '%s: every shown round is drawn so by the press, and no other is',
    (_name, strategy) => {
      let shownSomething = 0;
      walk(atEntry(37, UPPER_LOWER_GRAPH), strategy, (before, after) => {
        const shown = expectedRounds(before) ?? new Map();
        const drew = after.waterfallSteps.at(-1)?.drew ?? [];
        expect([...shown.keys()].sort()).toEqual([...drew].sort());
        for (const [index, round] of shown) {
          expect(after.assignments[index]).toEqual(round.assignments);
          expect(after.byes[index] ?? []).toEqual(round.byes);
          shownSomething += 1;
        }
      });
      expect(shownSomething).toBeGreaterThan(5);
    },
  );

  it('after Previous removes a draw, the round shows its expected draw again, the same', () => {
    const scored = scoreRound(scoreRound(entry, at('R4U')), at('R4L'));
    const drawn = pressed(scored);
    const back = goBack(drawn);
    const shown = expectedRounds(back);
    expect(shown).not.toBeNull();
    for (const label of ['SemiA', 'R5L', 'R5R']) {
      expect(shown?.get(at(label))?.assignments).toEqual(drawn.assignments[at(label)]);
    }
  });
});

/** Every unit of the roster appears exactly once across Rankings' active (waiting ones included), eliminated and finalists. */
function expectEveryUnitOnce(
  state: TournamentState,
  rankings: NonNullable<ReturnType<typeof computeRankings>>,
) {
  const names = [
    ...rankings.stillActive.map((unit) => unit.name),
    ...rankings.eliminatedList.map((unit) => unit.name),
    ...rankings.finalists.map((unit) => unit.name),
  ];
  expect(new Set(names).size, 'no unit twice').toBe(names.length);
  expect([...names].sort(), 'no unit lost').toEqual(
    (state.players as string[]).map((player) => player).sort(),
  );
}

describe.each(CASES)('the rankings in dependency play: $label', (testCase) => {
  const start = atEntry(testCase.count, testCase.graph, testCase.setup);
  const columnPlay = computeRankings(playColumns(start));

  it.each(Object.entries(STRATEGIES))(
    '%s: at every press every unit is ranked once, none waiting or in play is out, and the final order is that of column play',
    (_name, strategy) => {
      let state = withDependencyPlay(start);
      let checked = 0;
      const check = (current: TournamentState) => {
        const rankings = computeRankings(current);
        if (!rankings) return;
        expectEveryUnitOnce(current, rankings);
        const out = new Map(rankings.eliminatedList.map((unit) => [unit.name, unit]));
        const pooled = Object.values(current.pendingBracketSeeds).flatMap((seeds) =>
          seeds.map((seed) => seed.name),
        );
        for (const name of pooled) expect(out.has(name), `${name} waits in a pool`).toBe(false);
        for (const unit of rankings.eliminatedList) {
          // A unit certainly out of a round still in play has no rank yet; every other eliminated unit is done.
          if (unit.rank !== null)
            expect(isRoundDone(current, unit.ri), `${unit.name} ranked from a round in play`).toBe(true);
        }
        checked += 1;
      };
      for (
        let guard = 0;
        guard < 60 && roundsInPlay(state).some((index) => !state.rounds[index].isFinal);
        guard += 1
      ) {
        const unscored = roundsInPlay(state).filter(
          (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
        );
        for (const index of strategy(state, unscored, guard)) state = scoreRound(state, index);
        check(state);
        state = pressed(state);
        check(state);
      }
      expect(checked).toBeGreaterThan(5);
      const final = computeRankings(state);
      const summary = (rankings: typeof final) =>
        rankings?.eliminatedList.map((unit) => ({ name: unit.name, rank: unit.rank, ri: unit.ri }));
      expect(summary(final)).toEqual(summary(columnPlay));
      expect(final?.stillActive.map((unit) => unit.name).sort()).toEqual(
        columnPlay?.stillActive.map((unit) => unit.name).sort(),
      );
    },
  );

  it('with the later round of a pair sent first, a unit waiting for an earlier-numbered round is still listed', () => {
    // Backward scoring sends the higher-numbered round of a column first, so a round after it is drawn while a lower one
    // still waits: the waiting units sit below a drawn round's index.
    let state = withDependencyPlay(start);
    let sawLowerWaiting = 0;
    for (
      let guard = 0;
      guard < 60 && roundsInPlay(state).some((index) => !state.rounds[index].isFinal);
      guard += 1
    ) {
      const unscored = roundsInPlay(state).filter(
        (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
      );
      state = pressed(scoreRound(state, unscored[unscored.length - 1]));
      const highestDrawn = Math.max(
        ...state.assignments.flatMap((round, index) => (round.length ? [index] : [])),
      );
      if (Object.keys(state.pendingBracketSeeds).some((key) => Number(key) < highestDrawn))
        sawLowerWaiting += 1;
      const rankings = computeRankings(state);
      if (rankings) expectEveryUnitOnce(state, rankings);
    }
    // On the three chains Y2 is drawn while X2, a lower round, still waits for X1.
    if (testCase.label.startsWith('three chains')) expect(sawLowerWaiting).toBeGreaterThan(0);
  });
});

describe('the rankings while a step is reopened', () => {
  /** Up to the press that sends R6L and R6R and draws SemiB, then SemiB scored and Previous: that press is reopened. */
  function reopenedAtSemiB(): TournamentState {
    let state = afterRound4;
    state = pressed(scoreRound(scoreRound(scoreRound(state, at('R5L')), at('R5R')), at('SemiA')));
    state = pressed(scoreRound(scoreRound(state, at('R6L')), at('R6R')));
    expect(state.assignments[at('SemiB')].length).toBeGreaterThan(0);
    const back = goBack(scoreRound(state, at('SemiB')));
    expect(back.waterfallSteps.at(-1)?.reopened).toBe(true);
    return back;
  }

  const rankedUnits = (state: TournamentState) => {
    const rankings = computeRankings(state);
    if (!rankings) throw new Error('no rankings');
    return rankings;
  };

  it('lists every unit once, a unit sent on by a reopened round in the round it went to', () => {
    const state = reopenedAtSemiB();
    const rankings = rankedUnits(state);
    expectEveryUnitOnce(state, rankings);
    // A unit of R6L that moved on to SemiB is seated in both rounds in play: it shows once, in SemiB (unless SemiB puts it out).
    const semiB = state.assignments[at('SemiB')].map((seat) => seat.name);
    const fromR6L = state.assignments[at('R6L')]
      .map((seat) => seat.name)
      .filter((name) => semiB.includes(name));
    const shown = fromR6L.flatMap((name) => rankings.stillActive.filter((unit) => unit.name === name));
    expect(shown.length).toBeGreaterThan(0);
    for (const unit of shown) expect(unit.ri, `${unit.name} shows in SemiB`).toBe(at('SemiB'));
  });

  it('reads a reopened round by where its units were sent: R6R, which sends nobody on, has every unit out, unranked', () => {
    const state = reopenedAtSemiB();
    const rankings = rankedUnits(state);
    for (const seat of state.assignments[at('R6R')]) {
      const out = rankings.eliminatedList.find((unit) => unit.name === seat.name);
      expect(out?.ri, `${seat.name} is out of R6R`).toBe(at('R6R'));
      expect(out?.rank).toBeNull();
    }
  });

  it('keeps a unit in play after a correction that would put it out of the reopened round', () => {
    const state = reopenedAtSemiB();
    const r6l = at('R6L');
    // The best score of room 1 of R6L and the worst trade places: the unit that moved on to SemiB now places last.
    const seats = state.assignments[r6l].filter((seat) => seat.room === 1);
    const keys = seats.map((_, position) => keyOf(state, r6l, position));
    const ranked = [...keys].sort(
      (first, second) => (state.scores[second] as number) - (state.scores[first] as number),
    );
    const [best, worst] = [ranked[0], ranked[ranked.length - 1]];
    const corrected: TournamentState = {
      ...state,
      scores: { ...state.scores, [best]: state.scores[worst], [worst]: state.scores[best] },
    };
    const movedOn = seats[keys.indexOf(best)].name;
    expect(state.assignments[at('SemiB')].some((seat) => seat.name === movedOn)).toBe(true);
    const rankings = rankedUnits(corrected);
    expectEveryUnitOnce(corrected, rankings);
    expect(rankings.eliminatedList.some((unit) => unit.name === movedOn)).toBe(false);
    expect(rankings.stillActive.find((unit) => unit.name === movedOn)?.ri).toBe(at('SemiB'));
  });
});
