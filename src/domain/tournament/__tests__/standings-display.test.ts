import { describe, expect, it } from 'vitest';
import { describeStandings, hasStandingsPhase, standingFor } from '../standings-display';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, scoreCurrentRound } from './play-through';

const POINTS = '10,8,6,5,4,3,2,1';
const H2H = { gameFormat: 'individual-1v1' as const, oddCountStrategy: 'bye' as const };

function started(state: TournamentState): TournamentState {
  return { ...state, started: true };
}

function scenarioA(): TournamentState {
  return started(
    buildState({
      label: 'A',
      count: 43,
      teams: false,
      setup: { gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '24' },
    }) as TournamentState,
  );
}

function scenarioB(): TournamentState {
  return started(
    buildState({
      label: 'B',
      count: 53,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        qualAdv: '31',
        scoring: 'positional-points',
        positionalPointsTable: POINTS,
        nonCountingRounds: '1',
        qualRoundsOverride: '3',
      },
    }) as TournamentState,
  );
}

function scenarioC(): TournamentState {
  return started(
    buildState({
      label: 'C',
      count: 37,
      teams: false,
      setup: {
        ...H2H,
        poolingPhase: 'swiss',
        qualAdv: '16',
        scoring: 'positional-points',
        positionalPointsTable: '3,1',
        swissRoundsOverride: '5',
      },
    }) as TournamentState,
  );
}

function scenarioD(): TournamentState {
  return started(
    buildState({
      label: 'D',
      count: 31,
      teams: false,
      setup: { ...H2H, poolingPhase: 'group-stage', groupSize: '4', qualifiersPerGroup: '2', qualAdv: '4' },
    }) as TournamentState,
  );
}

function scoreAndAdvance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status === 'blocked' || result.status === 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}

/** Scores every room of the current round except the last score of one room. */
function scoreAllButOne(state: TournamentState): { state: TournamentState; lastKey: string } {
  const full = scoreCurrentRound(state, 0);
  const room1 = (state.assignments[state.curRound] ?? []).filter((entry) => entry.room === 1);
  const lastKey = `r${state.curRound}-rm1-p${room1.length - 1}`;
  const { [lastKey]: lastScore, ...rest } = full.scores;
  return { state: { ...full, scores: rest }, lastKey: `${lastKey}=${lastScore}` };
}

function restore(state: TournamentState, packed: string): TournamentState {
  const [key, value] = packed.split('=');
  return { ...state, scores: { ...state.scores, [key]: Number(value) } };
}

describe('current-round rooms count only once fully scored', () => {
  it('excludes a partly scored room of the current round and includes it once its last score lands', () => {
    const { state, lastKey } = scoreAllButOne(scenarioA());
    const room1 = (state.assignments[0] ?? []).filter((entry) => entry.room === 1).map((e) => e.name);
    const before = describeStandings(state)?.tables[0].entries ?? [];
    expect(before.filter((entry) => entry.played === 0).map((entry) => entry.name)).toEqual(
      expect.arrayContaining(room1),
    );
    const after = describeStandings(restore(state, lastKey))?.tables[0].entries ?? [];
    expect(after.filter((entry) => room1.includes(entry.name)).every((entry) => entry.played === 1)).toBe(
      true,
    );
  });

  it('still counts a partly scored room of a past round', () => {
    const { state } = scoreAllButOne(scenarioA());
    const advanced = { ...state, curRound: 1 };
    const room1 = (state.assignments[0] ?? []).filter((entry) => entry.room === 1).map((e) => e.name);
    const entries = describeStandings(advanced)?.tables[0].entries ?? [];
    const played = entries.filter((entry) => room1.includes(entry.name) && entry.played === 1);
    expect(played.length).toBe(room1.length - 1);
  });
});

describe('rounds done and phase', () => {
  it('skips non-counting rounds (scenario B: 0 of 2, then 1 of 2)', () => {
    let state = scenarioB();
    expect(describeStandings(state)).toMatchObject({
      roundsDone: 0,
      roundsTotal: 2,
      firstCountedRoundNum: 2,
    });
    state = scoreAndAdvance(state);
    expect(describeStandings(state)).toMatchObject({ roundsDone: 0, roundsTotal: 2, phase: 'upcoming' });
    const { state: partly, lastKey } = scoreAllButOne(state);
    expect(describeStandings(partly)?.roundsDone).toBe(0);
    expect(describeStandings(restore(partly, lastKey))).toMatchObject({ roundsDone: 1 });
  });

  it('goes upcoming, live, final across scenario A', () => {
    let state = scenarioA();
    expect(describeStandings(state)?.phase).toBe('upcoming');
    state = scoreCurrentRound(state, 0);
    expect(describeStandings(state)?.phase).toBe('live');
    state = scoreAndAdvance(state);
    state = scoreAndAdvance(scoreAndAdvance(state));
    expect(state.rounds[state.curRound].isQual).toBe(false);
    expect(describeStandings(state)?.phase).toBe('final');
  });

  it('puts the column after the last pooling round in A, C and D', () => {
    for (const [state, expected] of [
      [scenarioA(), 2],
      [scenarioC(), 4],
    ] as const) {
      expect(describeStandings(state)?.lastStandingsRoundIndex).toBe(expected);
    }
    const d = scenarioD();
    const lastGroup = d.rounds.map((round) => Boolean(round.isGroupStage)).lastIndexOf(true);
    expect(describeStandings(d)?.lastStandingsRoundIndex).toBe(lastGroup);
  });
});

describe('cut', () => {
  it('is qualAdv, or null when qualAdv is at least the entrants', () => {
    expect(describeStandings(scenarioA())?.tables[0].cut).toBe(24);
    const everyone = buildState({
      label: 'all',
      count: 16,
      teams: false,
      setup: { gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '4' },
    }) as TournamentState;
    expect(
      describeStandings({ ...everyone, started: true, cfg: { ...everyone.cfg, qualAdv: 16 } })?.tables[0].cut,
    ).toBeNull();
  });

  it('uses qualifiersPerGroup per group (scenario D)', () => {
    const display = describeStandings(scenarioD());
    expect(display?.perGroup).toBe(true);
    expect(display?.tables.length).toBeGreaterThan(1);
    expect(display?.tables.every((table) => table.cut === 2)).toBe(true);
    expect(display?.tables.map((table) => table.groupLabel)).toEqual(
      scenarioD().groups.map((group) => group.label),
    );
  });
});

describe('a cut-off tie', () => {
  function tiedAtCut() {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      started: true,
      players: ['A', 'B', 'C', 'D'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 1 },
      gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: [10, 8] },
      rounds: [
        {
          roundNum: 1,
          players: 4,
          rooms: [2, 2],
          byeCount: 0,
          isQual: true,
          isNoElim: true,
          isSemis: false,
          isFinal: false,
          advPerRoom: null,
          advTotal: 4,
          luckyCount: 0,
        },
        {
          roundNum: 2,
          players: 1,
          rooms: [2],
          byeCount: 0,
          isQual: false,
          isNoElim: false,
          isSemis: false,
          isFinal: false,
          advPerRoom: null,
          advTotal: 1,
          luckyCount: 0,
        },
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 2, isLucky: false },
          { name: 'D', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 100, 'r0-rm2-p0': 300, 'r0-rm2-p1': 100 },
    });
    return state;
  }

  it('shares a rank while unresolved', () => {
    const entries = describeStandings(tiedAtCut())?.tables[0].entries ?? [];
    expect(entries.slice(0, 2).map((entry) => entry.rank)).toEqual([1, 1]);
  });

  it('gets distinct ranks in the resolved order', () => {
    const state = { ...tiedAtCut(), tieResolutions: { 'qual-cutoff': ['C', 'A'] } };
    const entries = describeStandings(state)?.tables[0].entries ?? [];
    expect(entries.slice(0, 2).map((entry) => [entry.name, entry.rank])).toEqual([
      ['C', 1],
      ['A', 2],
    ]);
  });
});

describe('describeStandings availability', () => {
  it('is null without a pooling phase and before start', () => {
    const none = buildState({
      label: 'se',
      count: 16,
      teams: false,
      setup: { ...H2H, poolingPhase: 'none', scheduleLogic: 'single-elimination' },
    }) as TournamentState;
    expect(hasStandingsPhase({ ...none, started: true })).toBe(false);
    expect(describeStandings({ ...none, started: true })).toBeNull();
    const kings = buildState({
      label: 'kv',
      count: 24,
      teams: false,
      setup: { gameFormat: 'ffa-individual', poolingPhase: 'none', scheduleLogic: 'kings-valley' },
    });
    expect(kings).not.toBeNull();
    expect(describeStandings({ ...(kings as TournamentState), started: true })).toBeNull();
    expect(describeStandings({ ...scenarioA(), started: false })).toBeNull();
  });
});

describe('standingFor', () => {
  it('reports rank, group and the side of the cut (scenario C: 16th and 17th)', () => {
    let state = scenarioC();
    for (let index = 0; index < 5; index += 1) state = scoreAndAdvance(state);
    const display = describeStandings(state);
    const entries = display?.tables[0].entries ?? [];
    const sixteenth = standingFor(display!, entries[15].name);
    const seventeenth = standingFor(display!, entries[16].name);
    expect(sixteenth?.insideCut).toBe(true);
    expect(seventeenth?.insideCut).toBe(false);
    expect(sixteenth?.groupLabel).toBeUndefined();
  });

  it('reports the group label in group stage and null for an unknown name', () => {
    let state = scenarioD();
    state = scoreCurrentRound(state, 0);
    const display = describeStandings(state)!;
    const first = display.tables[0].entries[0];
    expect(standingFor(display, first.name)?.groupLabel).toBe(display.tables[0].groupLabel);
    expect(standingFor(display, 'nobody')).toBeNull();
  });
});
