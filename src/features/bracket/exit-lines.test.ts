import { describe, expect, it } from 'vitest';
import { buildState } from '../../domain/tournament/__tests__/play-through';
import {
  QUAL_GRAPH,
  buildQualWaterfall,
  playToQualificationExit,
} from '../../domain/tournament/__tests__/qual-waterfall';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { type RoomExitBand } from '../../domain/tournament/room-exits';
import { describeStandings } from '../../domain/tournament/standings-display';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { poolingExitLines, roomExitLines, standingsExitLines } from './exit-lines';

const labels = (names: string[]) => names.map((label, index) => ({ label, roundNumber: index + 1 }));

describe('roomExitLines', () => {
  const names = labels(['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Semis', 'Final']);

  it('describes a single-elimination room: advance, the lucky-loser chance, out', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 5, destination: 5 },
      { kind: 'lucky-chance', rank: 6, spots: 1, otherwise: 'eliminate' },
      { kind: 'eliminate', fromRank: 7, toRank: 8 },
    ];
    expect(roomExitLines(bands, names)).toEqual([
      { tone: 'green', places: '1–5', where: '→ Semis' },
      { tone: 'dashed', places: '6 ★', where: 'lucky loser? (1 spot)' },
      { tone: 'red', places: '7–8', where: 'out' },
    ]);
  });

  it('pluralises the spots of a lucky-loser chance', () => {
    const lines = roomExitLines([{ kind: 'lucky-chance', rank: 7, spots: 2, otherwise: 'eliminate' }], names);
    expect(lines[0].where).toBe('lucky loser? (2 spots)');
  });

  it('colours a second destination yellow and a third purple (waterfall)', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
      { kind: 'advance', fromRank: 5, toRank: 6, destination: 6 },
      { kind: 'advance', fromRank: 7, toRank: 7, destination: 4 },
      { kind: 'eliminate', fromRank: 8, toRank: 8 },
    ];
    expect(roomExitLines(bands, names).map((line) => [line.places, line.tone, line.where])).toEqual([
      ['1–4', 'green', '→ Semis'],
      ['5–6', 'yellow', '→ Final'],
      ['7', 'purple', '→ Round 5'],
      ['8', 'red', 'out'],
    ]);
  });

  it('describes a double-elimination room: the winner goes on, the loser drops to the losers bracket (purple)', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 1, destination: 3 },
      { kind: 'drop', fromRank: 2, toRank: 2, destination: 2 },
    ];
    expect(
      roomExitLines(bands, labels(['R1', 'R2', 'LB Round 4', 'WB Round 5'])).map((line) => line.where),
    ).toEqual(['→ WB Round 5', '→ LB Round 4']);
    expect(roomExitLines(bands, names)[1].tone).toBe('purple');
  });

  it('describes a Kings Valley room: promote (green), stay (yellow), demote (orange) with the room letters', () => {
    const bands: RoomExitBand[] = [
      { kind: 'promote', fromRank: 1, toRank: 2, targetRoom: 1 },
      { kind: 'stay', fromRank: 3, toRank: 4 },
      { kind: 'demote', fromRank: 5, toRank: 6, targetRoom: 3 },
    ];
    expect(roomExitLines(bands, names)).toEqual([
      { tone: 'green', places: '1–2', where: '→ Room A' },
      { tone: 'yellow', places: '3–4', where: 'stay' },
      { tone: 'orange', places: '5–6', where: '→ Room C' },
    ]);
  });
});

function pooling(
  count: number,
  setup: Partial<PersistedSetup>,
  gameFormat: PersistedSetup['gameFormat'] = 'ffa-individual',
) {
  const state = buildState({
    label: `${count}`,
    count,
    teams: false,
    setup: {
      gameFormat,
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '8',
      ...setup,
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

describe('poolingExitLines: what a place earns in a counted round', () => {
  it('37 FFA players (rooms of up to 8)', () => {
    expect(poolingExitLines(pooling(37, {}), 0)).toEqual([
      { tone: null, places: '1st +8', where: '2nd +7 … 8th +1 points' },
      { tone: null, places: 'All', where: '→ standings' },
    ]);
  });

  it('a 3v3v3 tournament with 13 teams (rooms of up to 3)', () => {
    const state = buildState({
      label: 'threes',
      count: 13,
      teams: true,
      setup: {
        gameFormat: 'team-3v3v3',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '8',
      },
    });
    expect(state).not.toBeNull();
    expect(poolingExitLines(state as TournamentState, 0)[0]).toEqual({
      tone: null,
      places: '1st +3',
      where: '2nd +2 … 3rd +1 points',
    });
  });

  it('a 2v2v2v2 tournament with 13 teams (rooms of up to 4)', () => {
    const state = buildState({
      label: 'teams',
      count: 13,
      teams: true,
      setup: {
        gameFormat: 'team-2v2v2v2',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '8',
      },
    });
    expect(state).not.toBeNull();
    const lines = poolingExitLines(state as TournamentState, 0);
    expect(lines[0]).toEqual({ tone: null, places: '1st +4', where: '2nd +3 … 4th +1 points' });
  });

  it('a head-to-head tournament reads "1st +2", "2nd +1", without an ellipsis or the word points', () => {
    const lines = poolingExitLines(pooling(33, { oddCountStrategy: 'bye' }, 'individual-1v1'), 0);
    expect(lines).toEqual([
      { tone: null, places: '1st +2', where: '2nd +1' },
      { tone: null, places: 'All', where: '→ standings' },
    ]);
  });

  it('a Custom points table lists its own values', () => {
    const lines = poolingExitLines(
      pooling(37, { scoring: 'positional-points', positionalPointsTable: '10,7,5,4,3,2,1,0' }),
      0,
    );
    expect(lines[0]).toEqual({ tone: null, places: '1st +10', where: '2nd +7 … 8th +0 points' });
  });

  it('a round that does not count is seeding only', () => {
    const state = pooling(37, { nonCountingRounds: '1' });
    expect(poolingExitLines(state, 0)).toEqual([
      { tone: null, places: 'All', where: 'seeding only, not counted' },
    ]);
    expect(poolingExitLines(state, 1)[0].places).toBe('1st +8');
  });

  it('a warm-up round sends everyone to the next round', () => {
    const state = pooling(37, { poolingPhase: 'none', scheduleLogic: 'single-elimination' });
    const label = bracketRoundLabels(state)[1].label;
    expect(poolingExitLines(state, 0)).toEqual([{ tone: null, places: 'All', where: `→ ${label}` }]);
  });

  it('gives nothing for a round that has its own stripes (the Final)', () => {
    const state = pooling(37, {});
    expect(poolingExitLines(state, state.rounds.length - 1)).toEqual([]);
  });
});

describe.each([31, 37, 43, 53])('standingsExitLines with %i players and a cut of 24', (count) => {
  const state = pooling(count, { qualAdv: '24' });
  const display = describeStandings(state);
  const table = display?.tables[0];
  if (!display || !table) throw new Error('no standings');
  const labelsOf = bracketRoundLabels(state);

  it('says who goes to the first bracket round and who is out', () => {
    expect(standingsExitLines(table, display, labelsOf)).toEqual([
      { tone: 'green', places: '1–24', where: `→ ${labelsOf[display.lastStandingsRoundIndex + 1].label}` },
      { tone: 'red', places: `25–${count}`, where: 'out' },
    ]);
  });
});

describe('standingsExitLines: a Qual source with destination bands', () => {
  it.each([
    [31, '25–31'],
    [37, '25–37'],
    [43, '25–43'],
    [53, '25–53'],
  ])('%i players: 1–16 → R1, 17–24 → R1C, the rest out', (count, outPlaces) => {
    const exit = playToQualificationExit(buildQualWaterfall(count, QUAL_GRAPH));
    const display = describeStandings(exit);
    const table = display?.tables[0];
    if (!display || !table) throw new Error('no standings');
    expect(standingsExitLines(table, display, bracketRoundLabels(exit))).toEqual([
      { tone: 'green', places: '1–16', where: '→ R1' },
      { tone: 'yellow', places: '17–24', where: '→ R1C' },
      { tone: 'red', places: outPlaces, where: 'out' },
    ]);
  });

  it('a third destination is purple', () => {
    const graph = `
ROUNDS:
R1 = 2x8
R1C = 8
R1D = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C, 25-32->R1D
R1.A: 1-2->Final, 3-8->eliminated
R1.B: 1-2->Final, 3-8->eliminated
R1C: 1-2->Final, 3-8->eliminated
R1D: 1-2->Final, 3-8->eliminated
`;
    const exit = playToQualificationExit(buildQualWaterfall(40, graph));
    const display = describeStandings(exit);
    const table = display?.tables[0];
    if (!display || !table) throw new Error('no standings');
    expect(standingsExitLines(table, display, bracketRoundLabels(exit)).map((line) => line.tone)).toEqual([
      'green',
      'yellow',
      'purple',
      'red',
    ]);
  });
});

describe('standingsExitLines: a table nobody is cut from, and a group stage', () => {
  it('everyone goes through when there is no cut', () => {
    const state = pooling(37, { qualAdv: '99' });
    const display = describeStandings(state);
    const table = display?.tables[0];
    if (!display || !table) throw new Error('no standings');
    expect(standingsExitLines(table, display, bracketRoundLabels(state))).toEqual([
      expect.objectContaining({ tone: 'green', places: 'All' }),
    ]);
  });

  it('each group of a group stage reads "1–2 (each group)" and "3+ out"', () => {
    const state = buildState({
      label: 'groups',
      count: 13,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        oddCountStrategy: 'bye',
        scheduleLogic: 'single-elimination',
      },
    });
    if (!state) throw new Error('generation failed');
    const display = describeStandings(state);
    const table = display?.tables[0];
    if (!display || !table) throw new Error('no standings');
    const lines = standingsExitLines(table, display, bracketRoundLabels(state));
    expect(lines.map((line) => [line.tone, line.places])).toEqual([
      ['green', '1–2 (each group)'],
      ['red', '3+'],
    ]);
    expect(lines[1].where).toBe('out');
  });
});
