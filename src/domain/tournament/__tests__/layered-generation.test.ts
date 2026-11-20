import { describe, expect, it } from 'vitest';
import { bracketLogicOf } from '../app-written-bracket';
import { generateTournament } from '../generation';
import { layeredGateRefusal, LAYERED_FORMATS, LAYERED_POOLING_PHASES } from '../layered-form';
import { planLayered, type LayeredPlan } from '../layered-plan';
import { removeRosterUnit } from '../mutations';
import { rosterKeys } from '../roster';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { applyStageMatchEdit } from '../stage-match-edit';
import { readTournamentSettings } from '../tournament-settings';
import type { TournamentState } from '../types';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import { applyHandGraphEdit } from '../waterfall-live-edit';
import {
  expectEveryUnitRankedOnce,
  expectPlaysToTheFinal,
  indexOf,
  playDependency,
  playToBracketEntry,
  STRATEGIES,
} from './dependency-play-fixtures';
import { rosterFor, startedState, testRuntime, type Setup } from './test-fixtures';

/**
 * A layered bracket generated from the Setup form: a Custom bracket the app marks, whose rounds, rooms and routes are
 * the plan's (`planLayered`), after a qualification table.
 */

const FFA_QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
const FFA_ROOM = { min: 6, ideal: 8, max: 8 };

function generate(count: number, setup: Setup = FFA_QUAL) {
  const form = createDefaultSetup({ scheduleLogic: 'layered', ...setup });
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
}

function built(count: number, setup: Setup = FFA_QUAL): TournamentState {
  return startedState(generate(count, setup));
}

function planFor(count: number): LayeredPlan {
  const planned = planLayered({ registered: count, roomSize: FFA_ROOM });
  if (!planned.ok) throw new Error(planned.message);
  return planned.plan;
}

const roomsOf = (state: TournamentState, label: string): number[] =>
  state.rounds[indexOf(state, label)].rooms;

/** The first bracket round's number: "Round 4" after three qualification rounds. */
const FIRST_ROUND = 4;

/** The names the plan gives its rounds, in the order the plan has them, with the rooms each plays. */
function plannedRounds(plan: LayeredPlan): Array<{ name: string; rooms: number[] }> {
  const rounds = plan.rounds.flatMap((round, index) => {
    const semi = round.firstSemiFinal ? [{ name: 'Semi-Final A', rooms: [plan.finalPlayers] }] : [];
    const levels = round.levels.map((level) => ({
      name: `Round ${FIRST_ROUND + index} - ${level.level}`,
      rooms: level.rooms,
    }));
    return [...semi, ...levels];
  });
  const full = [plan.finalPlayers];
  return [...rounds, { name: 'Semi-Final B', rooms: full }, { name: 'Final', rooms: full }];
}

/** The seats each room of a round really holds once it is drawn. */
function seatedRooms(state: TournamentState, label: string): number[] {
  const rooms = state.rounds[indexOf(state, label)].rooms;
  const seated = state.assignments[indexOf(state, label)] ?? [];
  return rooms.map((_, room) => seated.filter((entry) => entry.room === room + 1).length);
}

/** The awkward counts of the organiser's practice, with the ones around them, and a three-level field. */
const COUNTS = [24, 31, 37, 43, 53, 60];

describe('generating a layered bracket', () => {
  it('FFA 31 after a qualification table: a Custom bracket the app marks as layered', () => {
    const state = built(31);
    expect(state.scheduleLogic).toBe('waterfall-bracket');
    expect(bracketLogicOf(state)).toBe('layered');
    expect(state.gamemodeConfig.layeredVersion).toBe(1);
    expect(state.gamemodeConfig.upperLowerVersion).toBeUndefined();
    expect(state.gamemodeConfig.bracketPhase).toBe('waterfall-bracket');
    expect(state.settings?.scheduleLogic).toBe('layered');
  });

  it('FFA 31: 23 of the 28 who play are in the bracket: ranks 1 to 8 go to Semi-Final A, 9 to 23 to the Lower level', () => {
    const state = built(31);
    expect(state.cfg.qualAdv).toBe(23);
    const routes = state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes;
    expect(routes).toEqual([
      ...Array.from({ length: 8 }, () => indexOf(state, 'Semi-Final A')),
      ...Array.from({ length: 15 }, () => indexOf(state, 'Round 4 - Lower')),
    ]);
  });

  it('FFA 31: Semi-Final A is the first bracket round, the Lower level 8 + 7, then 8, the last semi-final and the Final', () => {
    const state = built(31);
    const labels = state.rounds.filter((round) => round.isWaterfall).map((round) => round.customLabel);
    expect(labels).toEqual(['Semi-Final A', 'Round 4 - Lower', 'Round 5 - Lower', 'Semi-Final B', 'Final']);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([8, 7]);
    expect(roomsOf(state, 'Round 5 - Lower')).toEqual([8]);
  });

  it('FFA 53: Upper 2 x 8, Lower 3 x 8, then 8 + 8 + 7 and 2 x 8 with the first semi-final in between', () => {
    const state = built(53);
    expect(roomsOf(state, 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([8, 8, 8]);
    expect(roomsOf(state, 'Round 5 - Lower')).toEqual([8, 8, 7]);
    expect(roomsOf(state, 'Round 6 - Lower')).toEqual([8, 8]);
    expect(state.cfg.qualAdv).toBe(40);
  });

  it.each(COUNTS)('FFA %i: the rounds, rooms and who is routed where are the plan', (count) => {
    const state = built(count);
    const plan = planFor(count);
    expect(state.cfg.qualAdv).toBe(plan.inBracket.value);
    const bracket = state.rounds.filter((round) => round.isWaterfall);
    const planned = plannedRounds(plan);
    expect(bracket.map((round) => round.customLabel).sort()).toEqual(
      planned.map((round) => round.name).sort(),
    );
    for (const { name, rooms } of planned) expect(roomsOf(state, name), name).toEqual(rooms);
  });

  it.each(COUNTS)('FFA %i: the table sends each level its players, the top level first', (count) => {
    const state = built(count);
    const plan = planFor(count);
    const routes = state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes ?? [];
    const entryRounds = plan.levels.map((level) => {
      const semi = level.name === 'Upper' && plan.rounds[0].firstSemiFinal;
      return indexOf(state, semi ? 'Semi-Final A' : `Round ${FIRST_ROUND} - ${level.name}`);
    });
    const expected = plan.levels.flatMap((level, at) =>
      Array.from({ length: level.players }, () => entryRounds[at]),
    );
    expect(routes).toEqual(expected);
    expect(routes).toHaveLength(plan.inBracket.value);
  });

  it('a field of 17 has no layered bracket, in the words of the plan', () => {
    expect(generate(17)).toEqual({
      status: 'invalid',
      message:
        'A layered bracket needs at least 18 players registered. For a smaller field use a single elimination, or build the bracket by hand with the Custom bracket.',
    });
  });

  it('Copy settings carries the choice, and the copy works its own rooms out', () => {
    const copied = readTournamentSettings(built(31).settings);
    expect(copied?.scheduleLogic).toBe('layered');
    const again = built(37, { ...FFA_QUAL, ...(copied as Setup) });
    expect(again.gamemodeConfig.layeredVersion).toBe(1);
    expect(again.cfg.qualAdv).toBe(planFor(37).inBracket.value);
  });

  it('the form is not changed: the graph text field stays whatever it was', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'layered',
      ...FFA_QUAL,
      waterfallGraph: 'kept as typed',
    });
    generateTournament(
      createDefaultTournamentState({ confirmedCount: 31, players: rosterFor(form.gameFormat, 31) }),
      form,
      testRuntime(),
    );
    expect(form.waterfallGraph).toBe('kept as typed');
  });
});

describe('playing a layered bracket', () => {
  it.each(COUNTS)('FFA %i: every round is drawn at the planned size and it plays to the Final', (count) => {
    const state = built(count);
    expectPlaysToTheFinal(state);
    const played = playDependency(playToBracketEntry(state), STRATEGIES['one round at a time, forward']);
    for (const { name, rooms } of plannedRounds(planFor(count))) {
      expect(seatedRooms(played, name), name).toEqual(rooms);
    }
  });

  it('every field from 18 to 96 registered plays to the Final with every round drawn at the planned size', () => {
    for (let count = 18; count <= 96; count += 1) {
      const planned = planLayered({ registered: count, roomSize: FFA_ROOM });
      if (!planned.ok) {
        expect(generate(count), `${count} registered`).toEqual({
          status: 'invalid',
          message: planned.message,
        });
        continue;
      }
      const played = playDependency(playToBracketEntry(built(count)), STRATEGIES['all at once']);
      for (const { name, rooms } of plannedRounds(planned.plan)) {
        expect(seatedRooms(played, name), `${count} registered, ${name}`).toEqual(rooms);
      }
    }
  }, 60_000);

  it.each([31, 53])(
    'FFA %i: a withdrawal in the first bracket round leaves a seat short and it plays on',
    (count) => {
      const entered = playToBracketEntry(built(count));
      const firstBracket = entered.rounds.findIndex((round) => round.isWaterfall);
      const leaving = (entered.assignments[firstBracket] ?? []).find((entry) => entry.room !== null);
      expect(leaving).toBeDefined();
      const removed = removeRosterUnit(entered, leaving?.name ?? '');
      expect(bracketLogicOf(removed)).toBe('layered');
      const played = playDependency(removed, STRATEGIES['all at once']);
      expect(rosterKeys(removed.players)).toHaveLength(count - 1);
      expectEveryUnitRankedOnce(played, count);
    },
  );
});

describe('the match formats of a layered bracket', () => {
  const state = built(53);
  const formatOf = (current: TournamentState, label: string) => {
    const round = current.rounds[indexOf(current, label)];
    return { bestOf: round.bestOf, numGames: round.numGames };
  };

  it('marks every round with its stage: the Semi-Finals Semis, the Final Finals, the others the bracket rounds', () => {
    const stages = Object.fromEntries(
      state.rounds
        .filter((round) => round.isWaterfall)
        .map((round) => [round.customLabel, round.graphMatchStage]),
    );
    expect(stages).toEqual({
      'Round 4 - Upper': 'bracket',
      'Round 4 - Lower': 'bracket',
      'Semi-Final A': 'semis',
      'Round 5 - Lower': 'bracket',
      'Round 6 - Lower': 'bracket',
      'Semi-Final B': 'semis',
      Final: 'finals',
    });
  });

  it('the bracket rounds, Semis and Finals selects reach their own rounds only', () => {
    const current = built(53, { ...FFA_QUAL, bracketGames: '2', semisBestOf: '3', finalsBestOf: '5' });
    expect(formatOf(current, 'Round 5 - Lower').numGames).toBe(2);
    expect(formatOf(current, 'Semi-Final A').bestOf).toBe(3);
    expect(formatOf(current, 'Semi-Final B').bestOf).toBe(3);
    expect(formatOf(current, 'Round 5 - Lower').bestOf).toBeUndefined();
    expect(formatOf(current, 'Final').bestOf).toBe(5);
  });

  it('a live change of the Finals format reaches the Final and keeps the mark', () => {
    const result = applyStageMatchEdit({ ...state, started: true }, { finals: { games: 3, bestOf: 5 } }, {});
    expect(result.ok ? '' : result.error).toBe('');
    if (!result.ok) return;
    expect(formatOf(result.state, 'Final').bestOf).toBe(5);
    expect(result.state.gamemodeConfig.layeredVersion).toBe(1);
  });
});

/** The graph text "Edit graph" opens on: read back off the rounds as they stand. */
function editedText(state: TournamentState): string {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, {
      rankCount: rosterKeys(state.players).length,
      finalsMatch: finalsMatchOf(finalsGames, finalsBestOf),
    }),
  );
}

describe('a hand edit of a layered bracket', () => {
  it('makes it a Custom bracket for good: the mark and the stages go, the snapshot reads Custom bracket', () => {
    const state = { ...built(31), started: true };
    const edited = applyHandGraphEdit(state, editedText(state));
    expect(edited.ok ? '' : edited.error).toBe('');
    if (!edited.ok) return;
    expect(bracketLogicOf(edited.state)).toBe('waterfall-bracket');
    expect(edited.state.gamemodeConfig.layeredVersion).toBeUndefined();
    expect(edited.state.settings?.scheduleLogic).toBe('waterfall-bracket');
    expect(edited.state.rounds.every((round) => round.graphMatchStage === undefined)).toBe(true);
  });
});

describe('where a layered bracket is offered', () => {
  it('is written for free-for-all rooms after a qualification table, in two lists', () => {
    expect(LAYERED_FORMATS).toEqual(['ffa-individual']);
    expect(LAYERED_POOLING_PHASES).toEqual(['qual-table']);
    expect(layeredGateRefusal({ gameFormat: 'ffa-individual', poolingPhase: 'qual-table' })).toBeNull();
  });

  it('refuses a Swiss in words that name the alternatives', () => {
    expect(layeredGateRefusal({ gameFormat: 'ffa-individual', poolingPhase: 'swiss' })).toBe(
      'A layered bracket cannot be written after a Swiss yet: it follows the qualification table. Choose a qualification table, or pick the upper and lower bracket, single elimination or the Custom bracket (built by hand) instead.',
    );
  });

  it('refuses no pooling phase ("None") in words that name the alternatives', () => {
    const message =
      'A layered bracket cannot be written without a pooling phase yet: it follows the qualification table. Choose a qualification table, or pick the upper and lower bracket, single elimination or the Custom bracket (built by hand) instead.';
    expect(layeredGateRefusal({ gameFormat: 'ffa-individual', poolingPhase: 'none' })).toBe(message);
    expect(generate(31, { ...FFA_QUAL, poolingPhase: 'none' })).toEqual({ status: 'invalid', message });
  });

  it('refuses a group stage and a head-to-head or team format', () => {
    expect(layeredGateRefusal({ gameFormat: 'ffa-individual', poolingPhase: 'group-stage' })).toMatch(
      /cannot be written after a group stage yet/,
    );
    expect(layeredGateRefusal({ gameFormat: 'individual-1v1', poolingPhase: 'qual-table' })).toMatch(
      /is not available for .* yet: it is written for .*\. Please pick the upper and lower bracket/,
    );
    expect(layeredGateRefusal({ gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table' })).toMatch(
      /is not available for/,
    );
  });

  it('refuses at generation before anything else about the form is read: a Swiss after FFA says it is the layered bracket that waits', () => {
    const result = generate(31, { ...FFA_QUAL, poolingPhase: 'swiss' });
    expect(result).toMatchObject({ status: 'invalid' });
    expect('message' in result ? result.message : '').toMatch(
      /^A layered bracket cannot be written after a Swiss/,
    );
  });
});
