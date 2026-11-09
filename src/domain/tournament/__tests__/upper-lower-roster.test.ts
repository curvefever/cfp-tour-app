import { describe, expect, it } from 'vitest';
import { bracketBoxes } from '../bracket';
import { generateTournament } from '../generation';
import { groupRoundMisses, groupSeats } from '../group-standings';
import { addWalkUpIndividual, removeRosterUnit } from '../mutations';
import { rosterKeys } from '../roster';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { applyStageMatchEdit } from '../stage-match-edit';
import { readTournamentSettings } from '../tournament-settings';
import type { TournamentRound, TournamentState } from '../types';
import { bracketLogicOf } from '../upper-lower';
import { replanUpperLower } from '../upper-lower-replan';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import { applyHandGraphEdit } from '../waterfall-live-edit';
import {
  STRATEGIES,
  expectEveryUnitRankedOnce,
  expectRankingRoomsBelowTheirColumn,
  expectRankingRoomsFedByTheLowerBefore,
  playDependency,
  playToBracketEntry,
  pressed,
  resolveEveryTie,
  scoreRound,
  scoreTied,
} from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

/**
 * The head count changes during pooling: the built-in upper and lower bracket works its rooms out again from the units
 * still in the roster (`replanUpperLower`), whether a unit is removed or a late joiner is admitted. Each case below
 * is checked against the bracket generated fresh at the new count, then played on to the Final.
 */

type Setup = Parameters<typeof createDefaultSetup>[0];

const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
const SWISS = { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' } as const;
const GROUPS = {
  gameFormat: 'team-4v4',
  poolingPhase: 'group-stage',
  groupSize: '4',
  groupExit: 'fair-cut',
  oddCountStrategy: 'bye',
} as const;

function built(count: number, setup: Setup): TournamentState {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
  if (result.status !== 'generated') throw new Error(result.message);
  return { ...result.state, started: true };
}

const bracketOf = (state: TournamentState): TournamentRound[] =>
  state.rounds.filter((round) => round.isWaterfall);

/** What the bracket is: every round's name, rooms, declared rooms, routes, stage and match format, in play order. */
const shapeOf = (state: TournamentState) =>
  bracketOf(state).map((round) => ({
    label: round.customLabel,
    rooms: round.rooms,
    declaredRooms: round.declaredRooms,
    players: round.players,
    routes: round.waterfallRoutes,
    stage: round.graphMatchStage,
    bestOf: round.bestOf,
    numGames: round.numGames,
    ranking: round.waterfallRanking,
  }));

const labelsOf = (state: TournamentState) => bracketOf(state).map((round) => round.customLabel);
const roomsOf = (state: TournamentState, label: string) =>
  state.rounds.find((round) => round.customLabel === label)?.rooms;
const qualRound = (state: TournamentState) => state.rounds.find((round) => round.standingsRoutes);

/** The unit at `position` of the roster, removed. */
const without = (state: TournamentState, position = 0): TournamentState =>
  removeRosterUnit(state, rosterKeys(state.players)[position]);

/** The same, with the version off: what a removal does to a Custom bracket, to compare the pooling rounds against. */
const withoutReplan = (state: TournamentState, position = 0): TournamentState => {
  const { upperLowerVersion: _version, ...gamemodeConfig } = state.gamemodeConfig;
  return without({ ...state, gamemodeConfig }, position);
};

/** Played on to the Final in the five press orders, every unit ranked once after every press, and the ranking rooms below their column. */
function expectPlaysToTheFinal(state: TournamentState): void {
  const count = rosterKeys(state.players).length;
  const entered = playToBracketEntry(state);
  for (const [name, strategy] of Object.entries(STRATEGIES)) {
    const played = playDependency(entered, strategy, (current) => {
      expectEveryUnitRankedOnce(current, count);
      expectRankingRoomsBelowTheirColumn(current);
      return current;
    });
    expectEveryUnitRankedOnce(played, count);
    expect(expectRankingRoomsFedByTheLowerBefore(played), name).toBe(
      played.rounds.filter((round) => round.waterfallRanking).length,
    );
  }
}

/** The ranking rooms come first in their column of `state.rounds`: the play order Rankings relies on. */
function expectRankingRoomsFirstInPlayOrder(state: TournamentState): void {
  for (const box of bracketBoxes(state)) {
    if (box.kind !== 'column') continue;
    const ranking = box.roundIndices.filter((index) => state.rounds[index].waterfallRanking);
    const others = box.roundIndices.filter((index) => !state.rounds[index].waterfallRanking);
    for (const index of ranking) for (const other of others) expect(index).toBeLessThan(other);
  }
}

describe('a withdrawal during qualification works the rooms out again', () => {
  it('32 to 31: 31 enter, upper 8 + 8, lower 8 + 7, as generated fresh at 31, and no shortfall at the entry', () => {
    const removed = without(built(32, QUAL));
    expect(bracketLogicOf(removed)).toBe('upper-lower');
    expect(roomsOf(removed, 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(removed, 'Round 4 - Lower')).toEqual([8, 7]);
    expect(removed.cfg.qualAdv).toBe(31);
    expect(shapeOf(removed)).toEqual(shapeOf(built(31, QUAL)));
    expectPlaysToTheFinal(removed);
  });

  it('25 to 24: 24 enter in four rooms of 6', () => {
    const removed = without(built(25, QUAL));
    expect(roomsOf(removed, 'Round 4 - Upper')).toEqual([6, 6]);
    expect(roomsOf(removed, 'Round 4 - Lower')).toEqual([6, 6]);
    expect(removed.cfg.qualAdv).toBe(24);
    expect(shapeOf(removed)).toEqual(shapeOf(built(24, QUAL)));
    expectPlaysToTheFinal(removed);
  });

  it('24 to 23: 16 enter, in two rooms', () => {
    const removed = without(built(24, QUAL));
    expect(removed.cfg.qualAdv).toBe(16);
    expect(roomsOf(removed, 'Round 4 - Upper')).toEqual([8]);
    expect(roomsOf(removed, 'Round 4 - Lower')).toEqual([8]);
    expect(labelsOf(removed)).toEqual(labelsOf(built(23, QUAL)));
    expect(shapeOf(removed)).toEqual(shapeOf(built(23, QUAL)));
    expectPlaysToTheFinal(removed);
  });

  it('16 to 17 and 37 to 36 change nothing (the same units enter)', () => {
    const sixteen = built(17, QUAL);
    expect(shapeOf(without(sixteen))).toEqual(shapeOf(sixteen));
    const thirtySeven = built(37, QUAL);
    expect(shapeOf(without(thirtySeven))).toEqual(shapeOf(thirtySeven));
  });

  it('two removals in a row work out the second count from the first', () => {
    const removed = without(without(built(33, QUAL)), 3);
    expect(shapeOf(removed)).toEqual(shapeOf(built(31, QUAL)));
    expectPlaysToTheFinal(removed);
  });
});

describe('a late joiner works the rooms out again', () => {
  it('31 to 32: 32 enter, upper 8 + 8, lower 8 + 8', () => {
    const result = addWalkUpIndividual(built(31, QUAL), 'Newcomer', { allowLateJoin: true });
    if (result.status !== 'added') throw new Error(`expected added, got ${result.status}`);
    expect(roomsOf(result.state, 'Round 4 - Lower')).toEqual([8, 8]);
    expect(result.state.cfg.qualAdv).toBe(32);
    expect(shapeOf(result.state)).toEqual(shapeOf(built(32, QUAL)));
    expectPlaysToTheFinal(result.state);
  });

  it('a joiner whose count makes no new bracket changes nothing', () => {
    const result = addWalkUpIndividual(built(17, QUAL), 'Newcomer', { allowLateJoin: true });
    if (result.status !== 'added') throw new Error(`expected added, got ${result.status}`);
    expect(shapeOf(result.state)).toEqual(shapeOf(built(18, QUAL)));
  });
});

describe('the pooling phase is left as a removal leaves it', () => {
  it.each([
    ['a qualification table', QUAL, 31],
    ['a Swiss', SWISS, 9],
    ['a group stage', GROUPS, 13],
  ])(
    '%s: the rounds before the bracket, their draws and the scores are those of a removal without the replan',
    (_name, setup, count) => {
      const state = playOnePoolingRound(built(count, setup));
      const first = state.rounds.findIndex((round) => round.isWaterfall);
      const replanned = without(state, 2);
      const plain = withoutReplan(state, 2);
      // The last pooling round's routes follow the new cut lines; the rest of the rounds are the same.
      const unrouted = (rounds: TournamentRound[]) =>
        rounds.map(({ standingsRoutes: _routes, ...round }) => round);
      expect(unrouted(replanned.rounds.slice(0, first))).toEqual(unrouted(plain.rounds.slice(0, first)));
      // A pooling round not drawn yet has no list, or an empty one.
      const drawn = (current: TournamentState) =>
        Array.from({ length: first }, (_, index) => current.assignments[index] ?? []);
      expect(drawn(replanned)).toEqual(drawn(plain));
      expect(replanned.scores).toEqual(plain.scores);
      expect(replanned.qualTable).toEqual(plain.qualTable);
      expect(replanned.groups).toEqual(plain.groups);
      expect(replanned.curRound).toBe(plain.curRound);
    },
  );
});

/** The first pooling round scored and sent on, so the walk-through has something played. */
function playOnePoolingRound(state: TournamentState): TournamentState {
  return pressed(resolveEveryTie(scoreRound(state, state.curRound), state.curRound));
}

describe('a save during qualification, from one short graph to another', () => {
  it.each([
    [31, 30],
    [29, 28],
  ])(
    '%i to %i: rooms, declared rooms and the qualification routes are those of the new count',
    (before, after) => {
      const state = built(before, QUAL);
      const removed = without(state);
      const fresh = built(after, QUAL);
      expect(bracketOf(removed).map((round) => round.rooms)).toEqual(
        bracketOf(fresh).map((round) => round.rooms),
      );
      expect(bracketOf(removed).map((round) => round.declaredRooms)).toEqual(
        bracketOf(fresh).map((round) => round.declaredRooms),
      );
      expect(qualRound(removed)?.standingsRoutes).toEqual(qualRound(fresh)?.standingsRoutes);
      expect(qualRound(removed)?.standingsRoutes).toBeDefined();
      expect(removed.cfg.qualAdv).toBe(after);
      // The routes were rewritten for the new count, and the rooms are not those the graph had before.
      expect(qualRound(removed)?.standingsRoutes).toHaveLength(after);
      expect(bracketOf(removed).map((round) => round.rooms)).not.toEqual(
        bracketOf(state).map((round) => round.rooms),
      );
      expectPlaysToTheFinal(removed);
    },
  );
});

describe('a fixed-draw qualification', () => {
  it('works the bracket out again too, though its pooling rounds were published', () => {
    const state = built(32, { ...QUAL, drawPublication: 'fixed' });
    const removed = without(state);
    expect(shapeOf(removed)).toEqual(shapeOf(built(31, { ...QUAL, drawPublication: 'fixed' })));
    expectPlaysToTheFinal(removed);
  });
});

describe('a Swiss', () => {
  it('9 to 8 keeps 8 entering, 8 to 7 goes to 4, and the round names do not change', () => {
    const nine = built(9, SWISS);
    const eight = without(nine);
    expect(shapeOf(eight)).toEqual(shapeOf(nine));
    const seven = without(eight);
    expect(seven.cfg.qualAdv).toBe(4);
    expect(bracketOf(seven)).not.toEqual(bracketOf(eight));
    const names = (state: TournamentState) =>
      state.rounds
        .slice(
          0,
          state.rounds.findIndex((round) => round.isWaterfall),
        )
        .map((round) => round.roundNum);
    expect(names(seven)).toEqual(names(nine));
    expect(bracketOf(seven)[0].roundNum).toBe(bracketOf(nine)[0].roundNum);
    expectPlaysToTheFinal(seven);
  });

  it('a late joiner mid-way: 7 to 8 goes back to 8 entering', () => {
    const seven = playOnePoolingRound(built(7, SWISS));
    const result = addWalkUpIndividual(seven, 'Newcomer', { allowLateJoin: true });
    if (result.status !== 'added') throw new Error(`expected added, got ${result.status}`);
    expect(rosterKeys(result.state.players)).toHaveLength(8);
    expect(result.state.cfg.qualAdv).toBe(8);
    expect(bracketOf(result.state)[0].roundNum).toBe(bracketOf(seven)[0].roundNum);
  });
});

describe('a group stage', () => {
  it('a removal re-works the entry, and the groups and their matches stay as they were', () => {
    const state = built(13, GROUPS);
    const removed = without(state, 4);
    expect(bracketLogicOf(removed)).toBe('upper-lower');
    expect(removed.groups).toEqual(withoutReplan(state, 4).groups);
    const fresh = shapeOf(removed).map((round) => round.label);
    expect(fresh).toEqual(labelsOf(removed));
    expect(removed.cfg.qualAdv).toBe(8);
  });

  it('9 to 8 to 7 teams: 8 enter at 9 and at 8 (everyone may go on), then 4 enter, as generated fresh', () => {
    const state = built(9, GROUPS);
    expect(state.cfg.qualAdv).toBe(8);
    const structure = (rounds: TournamentRound[]) =>
      rounds.map((round) => ({
        label: round.customLabel?.replace(/^Round [0-9]+/, 'Round N'),
        rooms: round.rooms,
        players: round.players,
        stage: round.graphMatchStage,
        ranking: round.waterfallRanking,
      }));
    // At 8 teams everyone goes on: re-worked like a fresh generation at 8 (the round numbers stay those of the state).
    const eight = without(state, 5);
    expect(eight.cfg.qualAdv).toBe(8);
    expect(structure(bracketOf(eight))).toEqual(structure(bracketOf(built(8, GROUPS))));
    expectPlaysToTheFinal(eight);
    const seven = without(eight, 5);
    const fresh = built(7, GROUPS);
    expect(seven.cfg.qualAdv).toBe(4);
    expect(structure(bracketOf(seven))).toEqual(structure(bracketOf(fresh)));
    expect(bracketOf(seven)[0].roundNum).toBe(bracketOf(state)[0].roundNum);
    expect(qualRound(seven)?.standingsRoutes).toHaveLength(4);
    expectPlaysToTheFinal(seven);
  });

  it('a match voided by the removal stays void while the bracket is re-worked', () => {
    const state = built(9, GROUPS);
    const seven = without(without(state, 5), 5);
    const misses = (current: TournamentState) =>
      [...groupRoundMisses(current, groupSeats(current)).entries()].sort(([first], [second]) =>
        first.localeCompare(second),
      );
    expect(seven.cfg.qualAdv).toBe(4);
    expect(misses(seven).some(([, missed]) => missed.voided.length > 0)).toBe(true);
    expect(misses(seven)).toEqual(misses(withoutReplan(withoutReplan(state, 5), 5)));
  });

  it('below the floor of the bracket the rounds stand as they were, and the removal is not blocked', () => {
    let state = built(5, GROUPS);
    state = without(state);
    state = without(state);
    expect(rosterKeys(state.players)).toHaveLength(3);
    const before = shapeOf(state);
    const removed = without(state);
    expect(rosterKeys(removed.players)).toHaveLength(2);
    expect(shapeOf(removed)).toEqual(before);
  });
});

describe('"Advance to bracket"', () => {
  it('an override above the new count means everyone: 32 enter at 33 with 32 asked, 31 after a removal', () => {
    const state = built(33, { ...QUAL, upperLowerAdvance: '32' });
    expect(state.cfg.qualAdv).toBe(32);
    const removed = without(state);
    expect(removed.cfg.qualAdv).toBe(32);
    const again = without(removed);
    expect(again.cfg.qualAdv).toBe(31);
    expect(shapeOf(again)).toEqual(shapeOf(built(31, QUAL)));
  });
});

describe('"Advance to bracket" below the count', () => {
  it("'24' at 31: 24 still enter after a removal, as generated fresh at 30 with '24'", () => {
    const state = built(31, { ...QUAL, upperLowerAdvance: '24' });
    expect(state.cfg.qualAdv).toBe(24);
    const removed = without(state);
    expect(removed.cfg.qualAdv).toBe(24);
    expect(shapeOf(removed)).toEqual(shapeOf(built(30, { ...QUAL, upperLowerAdvance: '24' })));
    expect(qualRound(removed)?.standingsRoutes).toHaveLength(24);
    expectPlaysToTheFinal(removed);
  });

  it("'24' at 24: a removal puts the override above the count, so 16 enter", () => {
    const removed = without(built(24, { ...QUAL, upperLowerAdvance: '24' }));
    expect(removed.cfg.qualAdv).toBe(16);
    expect(shapeOf(removed)).toEqual(shapeOf(built(23, QUAL)));
  });
});

describe('the formats and the stages of a re-worked bracket', () => {
  const formats = {
    ...QUAL,
    semisBestOf: '3',
    semisGames: '2',
    bracketGames: '2',
    finalsBestOf: '5',
    matchOverrides: 'Round 4 - Lower: BO3',
  } as const;

  it('every re-worked round keeps its stage, the Final included, and the formats of the Setup and of a round override', () => {
    const removed = without(built(32, formats));
    const stages = Object.fromEntries(
      bracketOf(removed).map((round) => [round.customLabel, round.graphMatchStage]),
    );
    expect(stages).toMatchObject({
      'Round 4 - Upper': 'bracket',
      'Round 5 - Ranking': 'bracket',
      'Semi-Final A': 'semis',
      'Semi-Final B': 'semis',
      Final: 'finals',
    });
    expect(bracketOf(removed).every((round) => round.graphMatchStage !== undefined)).toBe(true);
    const round = (label: string) => removed.rounds.find((entry) => entry.customLabel === label);
    expect(round('Semi-Final A')?.bestOf).toBe(3);
    expect(round('Final')?.bestOf).toBe(5);
    expect(round('Round 4 - Upper')?.numGames).toBe(2);
    expect(round('Round 4 - Lower')?.bestOf).toBe(3);
    expect(shapeOf(removed)).toEqual(shapeOf(built(31, formats)));
  });

  it('a format changed live keeps carrying over', () => {
    const live = applyStageMatchEdit(built(32, QUAL), {
      semis: { games: 1, bestOf: 5 },
      finals: { games: 3, bestOf: 3 },
    });
    if (!live.ok) throw new Error(live.error);
    const removed = without(live.state);
    const round = (label: string) => removed.rounds.find((entry) => entry.customLabel === label);
    expect(round('Semi-Final B')?.bestOf).toBe(5);
    expect(round('Final')?.bestOf).toBe(3);
    expect(removed.gamemodeConfig.upperLowerVersion).toBe(1);
  });

  it('keeps the play order: the ranking rooms stay first in their column', () => {
    const removed = without(built(32, QUAL));
    expect(bracketOf(removed).some((round) => round.waterfallRanking)).toBe(true);
    expectRankingRoomsFirstInPlayOrder(removed);
    expect(shapeOf(removed).map((round) => round.label)).toEqual(labelsOf(built(31, QUAL)));
  });
});

describe('the settings snapshot', () => {
  it('is what the form said after a re-work: the typed graph, the advance override and the formats are untouched', () => {
    const state = built(33, { ...QUAL, upperLowerAdvance: '32', semisBestOf: '3', finalsBestOf: '5' });
    const removed = without(without(state));
    expect(removed.cfg.qualAdv).toBe(31);
    expect(removed.settings).toEqual(state.settings);
    expect(removed.settings?.waterfallGraph).not.toContain('Round 4 - Upper');
    expect(removed.settings?.upperLowerAdvance).toBe('32');
    expect(removed.settings?.semisBestOf).toBe('3');
    expect(removed.settings?.finalsBestOf).toBe('5');
  });

  it('Copy settings from it still re-derives for another count', () => {
    const removed = without(without(built(33, { ...QUAL, upperLowerAdvance: '32' })));
    const copied = readTournamentSettings(removed.settings);
    expect(copied?.scheduleLogic).toBe('upper-lower');
    const again = built(37, { ...QUAL, ...(copied as Setup) });
    expect(again.cfg.qualAdv).toBe(32);
    expect(roomsOf(again, 'Round 4 - Lower')).toEqual([8, 8]);
  });
});

describe('an unchanged re-work', () => {
  it('returns the very same state, a tie pick that still applies included', () => {
    const state = built(37, QUAL);
    const tied = resolveEveryTie(scoreTied(state, state.curRound), state.curRound);
    expect(Object.keys(tied.tieResolutions).length).toBeGreaterThan(0);
    expect(replanUpperLower(tied)).toBe(tied);
    const removed = without(tied);
    expect(replanUpperLower(removed)).toBe(removed);
    expect(removed.tieResolutions).toEqual(
      Object.fromEntries(
        Object.entries(tied.tieResolutions).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.filter((name) => name !== rosterKeys(state.players)[0]) : value,
        ]),
      ),
    );
  });
});

describe('where the replan stops', () => {
  // The count matters: at 32, 30 and 28 the new text would reshape the rooms already drawn, at 31 and 29 it would not.
  it.each([28, 29, 30, 31, 32, 33])('entered at %i, the rooms stand and a withdrawal ripples', (count) => {
    const entered = playToBracketEntry(built(count, QUAL));
    const removed = without(entered);
    expect(bracketLogicOf(removed)).toBe('upper-lower');
    expect(labelsOf(removed)).toEqual(labelsOf(entered));
    expect(removed.rounds.map((round) => round.declaredRooms ?? round.rooms)).toEqual(
      entered.rounds.map((round) => round.declaredRooms ?? round.rooms),
    );
    // Exactly what a withdrawal does to any Custom bracket: nothing re-worked it.
    const plain = withoutReplan(entered);
    expect(removed.rounds).toEqual(plain.rounds);
    expect(removed.cfg).toEqual(plain.cfg);
    expect(removed.assignments).toEqual(plain.assignments);
  });

  it('after a hand edit of the graph nothing re-works it', () => {
    const state = built(32, QUAL);
    const edited = applyHandGraphEdit(state, savedGraphOf(state));
    if (!edited.ok) throw new Error(edited.error);
    expect(bracketLogicOf(edited.state)).toBe('waterfall-bracket');
    const removed = without(edited.state);
    expect(bracketOf(removed).map((round) => round.declaredRooms ?? round.rooms)).toEqual(
      bracketOf(edited.state).map((round) => round.declaredRooms ?? round.rooms),
    );
  });
});

/** The graph "Edit graph" opens on, as the running Admin reads it off the rounds. */
function savedGraphOf(state: TournamentState): string {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, {
      rankCount: rosterKeys(state.players).length,
      finalsMatch: finalsMatchOf(finalsGames, finalsBestOf),
    }),
  );
}
