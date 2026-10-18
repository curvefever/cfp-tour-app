import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { addReserveUnit, addWalkUpIndividual, removeRosterUnit, type ReserveAddResult } from '../mutations';
import { reloadRosterBeforeStart, removeUnitBeforeStart } from '../pre-start-edits';
import { regenerateForRoster, scheduleMatchesRoster } from '../pre-start-roster';
import { rosterKeys } from '../roster';
import { distributeRooms } from '../room-distribution';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState, TournamentTeam } from '../types';
import { fixedIdSource, rosterFor } from './test-fixtures';

type Setup = Parameters<typeof createDefaultSetup>[0];

/** A deterministic runtime: fixed ids and a seeded generator, so a redraw is repeatable. */
function testRuntime() {
  let seed = 12345;
  return createTournamentRuntime({
    ids: fixedIdSource(),
    random: {
      next: () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      },
    },
  });
}

/** Generated but not started: the state the organiser sees on Setup before Confirm & Start. */
function generated(count: number, setup: Setup = {}): TournamentState {
  const gameFormat = setup.gameFormat ?? 'ffa-individual';
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(gameFormat, count) }),
    createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '16', ...setup }),
    testRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return result.state;
}

function added(result: ReserveAddResult): TournamentState {
  if (result.status !== 'added') throw new Error(`expected an add, got ${JSON.stringify(result)}`);
  return result.state;
}

function withoutSettings(state: TournamentState): TournamentState {
  const { settings: _settings, ...rest } = state;
  return rest;
}

const lateTeam: TournamentTeam = {
  teamId: 'late',
  teamName: 'Late Team',
  members: [{ name: 'x1' }, { name: 'x2' }],
};

const seatedCount = (state: TournamentState, index: number) =>
  (state.assignments[index] ?? []).filter((entry) => entry.room !== null).length;
const roomSizeOf = (state: TournamentState) =>
  state.gamemodeConfig.roomSize as { min: number; max: number; ideal: number };

const FFA_QUAL: Setup = { poolingPhase: 'qual-table', qualAdv: '16' };
const GROUP_STAGE: Setup = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'group-stage',
  oddCountStrategy: 'bye',
};

const TEAM_QUAL_GRAPH = `
ROUNDS:
R1 = 2x4
R1C = 4
R2 = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->R1, 9-12->R1C
R1.A: 1-2->R2, 3-4->eliminated
R1.B: 1-2->R2, 3-4->eliminated
R1C: 1->Final, 2-4->eliminated
R2: 1-3->Final, 4->eliminated
`;

const EXACT_COUNT_GRAPH = `
ROUNDS:
R1 = 2x8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Final, 5-8->eliminated
R1.B: 1-4->Final, 5-8->eliminated
`;

describe('adding a reserve before Confirm & Start redraws the schedule', () => {
  it.each([31, 37, 43, 53])(
    'FFA qualification table at %i: the joiner is in round 1, rooms refitted',
    (count) => {
      const start = generated(count, FFA_QUAL);
      const joined = added(addWalkUpIndividual(start, 'Late', {}, testRuntime()));
      expect(joined.started).toBe(false);
      expect(joined.confirmedCount).toBe(count + 1);
      expect(joined.players).toHaveLength(count + 1);
      expect(seatedCount(joined, 0)).toBe(count + 1);
      expect(joined.assignments[0].filter((entry) => entry.name === 'Late')).toHaveLength(1);
      expect(joined.rounds[0].rooms).toEqual(distributeRooms(count + 1, roomSizeOf(joined)));
      expect(joined.cfg.n).toBe(count + 1);
    },
  );

  it('2v2v2v2 into a waterfall with a Qual source (20 teams + 1): seated in round 1, graph rounds unchanged', () => {
    const start = generated(20, {
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: TEAM_QUAL_GRAPH,
    });
    const joined = added(addReserveUnit({ ...start, reserves: [lateTeam] }, 'late', {}, testRuntime()));
    expect(joined.confirmedCount).toBe(21);
    expect(seatedCount(joined, 0)).toBe(21);
    expect(joined.assignments[0].filter((entry) => entry.name === 'late')).toHaveLength(1);
    const firstWaterfall = start.rounds.findIndex((round) => round.isWaterfall);
    expect(firstWaterfall).toBeGreaterThan(0);
    expect(joined.rounds.slice(firstWaterfall)).toEqual(start.rounds.slice(firstWaterfall));
  });

  it('head-to-head group stage at 37 -> 38: accepted, groups rebuilt for 38', () => {
    const joined = added(addWalkUpIndividual(generated(37, GROUP_STAGE), 'Late', {}, testRuntime()));
    const members = joined.groups.flatMap((group) => group.members);
    expect(members).toHaveLength(38);
    expect(members).toContain('Late');
    expect(joined.confirmedCount).toBe(38);
  });

  it('after the start the same group stage still refuses a joiner', () => {
    const started = { ...generated(37, GROUP_STAGE), started: true };
    expect(addWalkUpIndividual(started, 'Late', {}, testRuntime())).toEqual({
      status: 'blocked',
      reason: 'group-stage',
    });
  });

  it('a fixed draw before the start: accepted, every published pooling round includes the joiner', () => {
    const start = generated(37, { ...FFA_QUAL, drawPublication: 'fixed' });
    const joined = added(addWalkUpIndividual(start, 'Late', {}, testRuntime()));
    const published = joined.rounds.filter((round) => round.fixedRoomAssignments);
    expect(published.length).toBeGreaterThan(0);
    for (const round of published) {
      expect(round.fixedRoomAssignments?.some((entry) => entry.name === 'Late')).toBe(true);
    }
    expect(seatedCount(joined, 0)).toBe(38);
  });

  it("a waterfall without pooling, built for the exact count: refused with generation's own message", () => {
    const start = generated(16, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: EXACT_COUNT_GRAPH,
    });
    const result = addWalkUpIndividual(start, 'Late', {}, testRuntime());
    expect(result).toMatchObject({ status: 'blocked', reason: 'generation' });
    const regenerated = regenerateForRoster(
      { ...start, players: [...(start.players as string[]), 'Late'] },
      testRuntime(),
    );
    if (regenerated.status !== 'invalid') throw new Error(JSON.stringify(regenerated));
    expect(result).toEqual({ status: 'blocked', reason: 'generation', message: regenerated.message });
  });

  it('once started, the joiner still sits out the round in play', () => {
    const started = { ...generated(37, FFA_QUAL), started: true };
    const joined = added(addWalkUpIndividual(started, 'Late', {}, testRuntime()));
    expect(joined.assignments[0]).toEqual(started.assignments[0]);
    expect(joined.players).toHaveLength(38);
  });

  it('a tournament generated before settings were stored keeps the old path', () => {
    const joined = added(
      addWalkUpIndividual(withoutSettings(generated(37, FFA_QUAL)), 'Late', {}, testRuntime()),
    );
    expect(joined.players).toHaveLength(38);
    expect(seatedCount(joined, 0)).toBe(37);
  });

  it('with no rounds yet (roster loaded, not generated) the reserve joins and the count follows', () => {
    const loaded = createDefaultTournamentState({
      confirmedCount: 5,
      players: rosterFor('ffa-individual', 5),
      reserves: ['Late'],
    });
    const joined = added(addReserveUnit(loaded, 'Late', {}, testRuntime()));
    expect(joined.confirmedCount).toBe(6);
    expect(joined.rounds).toEqual([]);
    expect(rosterKeys(joined.players)).toContain('Late');
  });
});

describe('regenerateForRoster', () => {
  it('reports "no-settings" for a tournament generated before settings were stored', () => {
    expect(regenerateForRoster(withoutSettings(generated(37, FFA_QUAL)), testRuntime())).toEqual({
      status: 'no-settings',
    });
  });
});

describe('removing a unit before Confirm & Start redraws the schedule', () => {
  const nowhere = (state: TournamentState, name: string) => {
    expect(state.assignments.flat().some((entry) => entry.name === name)).toBe(false);
    expect(state.byes.flat()).not.toContain(name);
    expect(state.qualTable.some((entry) => entry.name === name)).toBe(false);
  };

  it.each([32, 38, 44, 54])(
    'FFA qualification table at %i -> one fewer: no short room, the unit is a no-show',
    (count) => {
      const { state, redrawRefusal } = removeUnitBeforeStart(generated(count, FFA_QUAL), 'P5', testRuntime());
      expect(redrawRefusal).toBeUndefined();
      expect(state.confirmedCount).toBe(count - 1);
      expect(state.players).toHaveLength(count - 1);
      expect(seatedCount(state, 0)).toBe(count - 1);
      expect(state.assignments[0].every((entry) => entry.room !== null)).toBe(true);
      expect(state.rounds[0].rooms).toEqual(distributeRooms(count - 1, roomSizeOf(state)));
      expect(state.withdrawnUnits).toMatchObject([{ name: 'P5', reason: 'removed', playedAnyMatch: false }]);
      nowhere(state, 'P5');
    },
  );

  it('2v2v2v2 into a waterfall with a Qual source, 21 -> 20 teams: round 1 redrawn, graph rounds unchanged', () => {
    const start = generated(21, {
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: TEAM_QUAL_GRAPH,
    });
    const { state, redrawRefusal } = removeUnitBeforeStart(start, 't5', testRuntime());
    expect(redrawRefusal).toBeUndefined();
    expect(state.confirmedCount).toBe(20);
    expect(seatedCount(state, 0)).toBe(20);
    nowhere(state, 't5');
    const firstWaterfall = start.rounds.findIndex((round) => round.isWaterfall);
    expect(state.rounds.slice(firstWaterfall)).toEqual(start.rounds.slice(firstWaterfall));
  });

  it('head-to-head group stage at 38 -> 37: groups rebuilt without the unit', () => {
    const { state } = removeUnitBeforeStart(generated(38, GROUP_STAGE), 'P5', testRuntime());
    const members = state.groups.flatMap((group) => group.members);
    expect(members).toHaveLength(37);
    expect(members).not.toContain('P5');
    expect(state.confirmedCount).toBe(37);
  });

  it('a waterfall without pooling built for the exact count: removed anyway, the refusal is the message generation gives', () => {
    const start = generated(16, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: EXACT_COUNT_GRAPH,
    });
    const { state, redrawRefusal } = removeUnitBeforeStart(start, 'P3', testRuntime());
    const plain = removeRosterUnit(start, 'P3');
    expect(state).toEqual({ ...plain, confirmedCount: 15 });
    const regenerated = regenerateForRoster(plain, testRuntime());
    if (regenerated.status !== 'invalid') throw new Error(JSON.stringify(regenerated));
    expect(redrawRefusal).toBe(regenerated.message);
  });

  it("a removal below the format's minimum is carried out, with the refusal", () => {
    const start = generated(12, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });
    const { state, redrawRefusal } = removeUnitBeforeStart(start, 'P3', testRuntime());
    expect(state.players).toHaveLength(11);
    expect(state.confirmedCount).toBe(11);
    expect(redrawRefusal).toContain('at least 12');
    nowhere(state, 'P3');
  });

  it('with no rounds yet it is the plain removal and the count follows', () => {
    const loaded = createDefaultTournamentState({
      confirmedCount: 6,
      players: rosterFor('ffa-individual', 6),
    });
    const { state, redrawRefusal } = removeUnitBeforeStart(loaded, 'P2', testRuntime());
    expect(redrawRefusal).toBeUndefined();
    expect(state.confirmedCount).toBe(5);
    expect(state.rounds).toEqual([]);
    expect(state.withdrawnUnits).toMatchObject([{ name: 'P2', reason: 'removed' }]);
  });

  it('a tournament generated before settings were stored gets the plain removal, no message', () => {
    const start = withoutSettings(generated(37, FFA_QUAL));
    const { state, redrawRefusal } = removeUnitBeforeStart(start, 'P3', testRuntime());
    expect(redrawRefusal).toBeUndefined();
    expect(state).toEqual({ ...removeRosterUnit(start, 'P3'), confirmedCount: 36 });
  });
});

describe('reloading the roster in Setup after Generate', () => {
  /** The same teams parsed again: every one gets a new id, as `parseTeamLines` gives them. */
  const reparsed = (teams: TournamentTeam[]) =>
    teams.map((team) => ({ ...team, teamId: `new_${team.teamId}` }));
  const nothingStale = (state: TournamentState, staleIds: string[]) => {
    const everywhere = JSON.stringify([state.assignments, state.byes, state.qualTable, state.roomHistory]);
    for (const id of staleIds) expect(everywhere).not.toContain(`"${id}"`);
  };

  it('2v2v2v2 into a waterfall with a Qual source: 20 teams generated, the same 20 plus one reloaded', () => {
    const setup: Setup = {
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: TEAM_QUAL_GRAPH,
    };
    const start = generated(20, setup);
    const oldTeams = start.players as TournamentTeam[];
    const players = [...reparsed(oldTeams), { ...lateTeam, teamId: 'new_late' }];
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      start,
      'team-2v2v2v2',
      { players, reserves: [], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toBeUndefined();
    expect(state.confirmedCount).toBe(21);
    expect(state.assignments[0].map((entry) => entry.name).sort()).toEqual(
      players.map((team) => team.teamId).sort(),
    );
    nothingStale(
      state,
      oldTeams.map((team) => team.teamId),
    );
    expect(scheduleMatchesRoster(state)).toBe(true);
  });

  it('FFA individuals generated at 37, reloaded with one name replaced and one added (38)', () => {
    const start = generated(37, FFA_QUAL);
    const players = [...(start.players as string[]).filter((name) => name !== 'P3'), 'Q3', 'Q38'];
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      start,
      'ffa-individual',
      { players, reserves: [], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toBeUndefined();
    expect(state.assignments[0].some((entry) => entry.name === 'P3')).toBe(false);
    for (const name of ['Q3', 'Q38']) {
      expect(state.assignments[0].filter((entry) => entry.name === name)).toHaveLength(1);
    }
    expect(seatedCount(state, 0)).toBe(38);
    expect(state.rounds[0].rooms).toEqual(distributeRooms(38, roomSizeOf(state)));
    nothingStale(state, ['P3']);
  });

  it('a reload for another game format drops the schedule, keeps the roster and says why', () => {
    const start = generated(37, FFA_QUAL);
    const teams = rosterFor('team-2v2v2v2', 24) as TournamentTeam[];
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      start,
      'team-2v2v2v2',
      { players: teams, reserves: [], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toContain('game format');
    expect(state.rounds).toEqual([]);
    expect(state.assignments).toEqual([]);
    expect(state.gameFormat).toBe('team-2v2v2v2');
    expect(state.players).toEqual(teams);
    expect(state.confirmedCount).toBe(24);
    expect(state.settings).toEqual(start.settings);
  });

  it('a reload below the minimum of the format drops the schedule with the message of generation', () => {
    const start = generated(12, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      start,
      'ffa-individual',
      { players: rosterFor('ffa-individual', 8), reserves: [], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toContain('at least 12');
    expect(state.rounds).toEqual([]);
    expect(state.players).toHaveLength(8);
  });

  it('a tournament generated before settings were stored drops the schedule', () => {
    const start = withoutSettings(generated(37, FFA_QUAL));
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      start,
      'ffa-individual',
      { players: rosterFor('ffa-individual', 37), reserves: [], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toBeDefined();
    expect(state.rounds).toEqual([]);
  });

  it('before Generate nothing is created: the roster is stored, no rounds', () => {
    const loaded = createDefaultTournamentState({
      confirmedCount: 5,
      players: rosterFor('ffa-individual', 5),
    });
    const { state, redrawRefusal } = reloadRosterBeforeStart(
      loaded,
      'ffa-individual',
      { players: rosterFor('ffa-individual', 9), reserves: ['R'], reserveIndividuals: [] },
      testRuntime(),
    );
    expect(redrawRefusal).toBeUndefined();
    expect(state.rounds).toEqual([]);
    expect(state.confirmedCount).toBe(9);
    expect(state.reserves).toEqual(['R']);
  });
});

describe('scheduleMatchesRoster', () => {
  it.each([31, 43, 53])('is true right after generation at %i, across the schedule shapes', (count) => {
    const setups: Setup[] = [
      FFA_QUAL,
      { ...FFA_QUAL, drawPublication: 'fixed' },
      { poolingPhase: 'none', scheduleLogic: 'single-elimination' },
      { poolingPhase: 'none', scheduleLogic: 'kings-valley' },
      { poolingPhase: 'swiss', gameFormat: 'individual-1v1', oddCountStrategy: 'bye' },
      GROUP_STAGE,
      { ...GROUP_STAGE, drawPublication: 'fixed' },
      {
        gameFormat: 'individual-1v1',
        poolingPhase: 'none',
        scheduleLogic: 'double-elimination',
        oddCountStrategy: 'bye',
      },
      { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table', qualAdv: '8' },
    ];
    let generatedCount = 0;
    for (const setup of setups) {
      const result = generateTournament(
        createDefaultTournamentState({
          confirmedCount: count,
          players: rosterFor(setup?.gameFormat ?? 'ffa-individual', count),
        }),
        createDefaultSetup(setup),
        testRuntime(),
      );
      if (result.status !== 'generated') continue;
      generatedCount += 1;
      expect(scheduleMatchesRoster(result.state), JSON.stringify(setup)).toBe(true);
    }
    expect(generatedCount).toBe(setups.length);
  });

  it('is true for a roster with no schedule yet', () => {
    const loaded = createDefaultTournamentState({ players: rosterFor('ffa-individual', 5) });
    expect(scheduleMatchesRoster(loaded)).toBe(true);
  });

  it('is false when every roster id is new (the seated ids are no longer on the roster)', () => {
    const start = generated(20, { gameFormat: 'team-2v2v2v2', qualAdv: '8' });
    const players = (start.players as TournamentTeam[]).map((team) => ({
      ...team,
      teamId: `new_${team.teamId}`,
    }));
    expect(scheduleMatchesRoster({ ...start, players })).toBe(false);
  });

  it('is false when the schedule was built for fewer units than the roster holds (production: 20 vs 21)', () => {
    const start = generated(20, { gameFormat: 'team-2v2v2v2', qualAdv: '8' });
    const players = [...(start.players as TournamentTeam[]), lateTeam];
    expect(scheduleMatchesRoster({ ...start, players })).toBe(false);
  });

  it('stays true after a pre-start removal whose redraw was refused: the short room can still start', () => {
    const exactCount = generated(16, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: EXACT_COUNT_GRAPH,
    });
    const belowMinimum = generated(12, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });
    for (const start of [exactCount, belowMinimum]) {
      const { state, redrawRefusal } = removeUnitBeforeStart(start, 'P3', testRuntime());
      expect(redrawRefusal).toBeDefined();
      expect(state.cfg.n).toBe(start.players.length);
      expect(state.players).toHaveLength(start.players.length - 1);
      expect(scheduleMatchesRoster(state)).toBe(true);
    }
  });

  it('is false when a seated id is not on the roster, though the count agrees', () => {
    const start = generated(37, FFA_QUAL);
    const players = (start.players as string[]).map((name) => (name === 'P3' ? 'Q3' : name));
    expect(scheduleMatchesRoster({ ...start, players })).toBe(false);
  });
});
