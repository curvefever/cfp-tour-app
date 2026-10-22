import { describe, expect, it } from 'vitest';
import {
  GAME_FORMAT_LIST,
  GAME_FORMATS,
  HARD_ROOM_PLAYER_CAP,
  deriveRoomSize,
  getGameFormat,
  teamFormatKey,
  teamsPerRoomOptions,
} from '../formats';
import { generateTournament } from '../generation';
import { validateRoomCap } from '../room-distribution';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { GameFormatKey, PersistedSetup, TournamentState } from '../types';
import { fixedIdSource, requireGameFormat, rosterFor, sequenceRandom } from './test-fixtures';

const RULE_KEYS = [
  'ffa-individual',
  'individual-1v1',
  'team-2v2',
  'team-2v2v2',
  'team-2v2v2v2',
  'team-2v2v2v2v2',
  'team-3v3',
  'team-3v3v3',
  'team-4v4',
  'team-5v5',
];

describe('the team format rule', () => {
  it('offers exactly the combinations the rule allows, and none over the room cap', () => {
    expect(GAME_FORMAT_LIST.map((format) => format.key)).toEqual(RULE_KEYS);
    expect(Object.keys(GAME_FORMATS)).toEqual(RULE_KEYS);
    for (const format of GAME_FORMAT_LIST) {
      const flexExtra = format.supportedOddCountStrategies?.includes('flex') ? 1 : 0;
      const largestRoom = format.defaultRoomSize?.max ?? (format.idealRoomSize ?? 1) + flexExtra;
      expect((format.teamSize ?? 1) * largestRoom).toBeLessThanOrEqual(HARD_ROOM_PLAYER_CAP);
    }
  });

  it('names the valid teams-per-room counts for each team size', () => {
    expect(teamsPerRoomOptions(2)).toEqual([2, 3, 4, 5]);
    expect(teamsPerRoomOptions(3)).toEqual([2, 3]);
    expect(teamsPerRoomOptions(4)).toEqual([2]);
    expect(teamsPerRoomOptions(5)).toEqual([2]);
  });

  it('builds the key and label from the numbers', () => {
    expect(teamFormatKey(2, 3)).toBe('team-2v2v2');
    expect(teamFormatKey(4, 2)).toBe('team-4v4');
    expect(requireGameFormat('team-2v2v2v2v2')).toMatchObject({
      label: '2v2v2v2v2',
      shortLabel: '2v2v2v2v2',
    });
    expect(requireGameFormat('team-4v4')).toMatchObject({ teamSize: 4, teamsPerRoom: 2 });
  });

  it('offers none/bye only for 4v4 and 5v5, and Flex for 2v2 and 3v3', () => {
    expect(requireGameFormat('team-4v4').supportedOddCountStrategies).toEqual(['none', 'bye']);
    expect(requireGameFormat('team-5v5').supportedOddCountStrategies).toEqual(['none', 'bye']);
    expect(requireGameFormat('team-2v2').supportedOddCountStrategies).toEqual(['none', 'bye', 'flex']);
    expect(requireGameFormat('team-3v3').supportedOddCountStrategies).toEqual(['none', 'bye', 'flex']);
    expect(requireGameFormat('team-4v4').defaultOddCountStrategy).toBe('bye');
  });

  it('has no definition for a key outside the rule', () => {
    expect(getGameFormat('team-6v6')).toBeUndefined();
    expect(getGameFormat('team-3v3v3v3')).toBeUndefined();
  });
});

describe('the five formats that existed before the rule', () => {
  const before: Array<[GameFormatKey, string, object]> = [
    [
      'ffa-individual',
      'FFA — Individual',
      { unitLabel: 'Player', defaultRoomSize: { min: 6, max: 8, ideal: 8 } },
    ],
    [
      'team-2v2v2v2',
      '2v2v2v2',
      { unitLabel: 'Team', teamSize: 2, defaultRoomSize: { min: 3, max: 4, ideal: 4 } },
    ],
    [
      'team-3v3v3',
      '3v3v3',
      { unitLabel: 'Team', teamSize: 3, defaultRoomSize: { min: 2, max: 3, ideal: 3 } },
    ],
    [
      'team-3v3',
      '3v3',
      {
        unitLabel: 'Team',
        teamSize: 3,
        idealRoomSize: 2,
        supportedOddCountStrategies: ['none', 'bye', 'flex'],
        defaultOddCountStrategy: 'bye',
      },
    ],
    [
      'individual-1v1',
      '1v1',
      {
        unitLabel: 'Player',
        idealRoomSize: 2,
        supportedOddCountStrategies: ['none', 'bye'],
        defaultOddCountStrategy: 'bye',
      },
    ],
  ];

  it.each(before)('%s keeps its traits and label', (key, label, traits) => {
    const format = requireGameFormat(key);
    expect(format).toMatchObject({ key, label, ...traits });
    expect(format.unitLabelPlural).toBe(format.unitLabel === 'Team' ? 'Teams' : 'Players');
  });

  it('gains no trait of the other room-size style', () => {
    for (const key of ['team-2v2v2v2', 'team-3v3v3'] as const) {
      const format = requireGameFormat(key);
      expect(format.idealRoomSize).toBeUndefined();
      expect(format.supportedOddCountStrategies).toBeUndefined();
      expect(format.defaultOddCountStrategy).toBeUndefined();
    }
    expect(requireGameFormat('team-3v3').defaultRoomSize).toBeUndefined();
    expect(requireGameFormat('individual-1v1').defaultRoomSize).toBeUndefined();
  });

  it('keeps the derived room sizes of the head-to-head team format', () => {
    expect(deriveRoomSize(requireGameFormat('team-3v3'), 'flex')).toEqual({ min: 2, max: 3, ideal: 2 });
    expect(deriveRoomSize(requireGameFormat('team-3v3'), 'bye')).toEqual({ min: 2, max: 2, ideal: 2 });
  });
});

describe('the room cap', () => {
  it('refuses a 3-team Final in 5v5 (15 players)', () => {
    const format = requireGameFormat('team-5v5');
    expect(validateRoomCap([{ roundNum: 4, rooms: [3] }], format)).toContain('15 players');
    expect(validateRoomCap([{ roundNum: 4, rooms: [2] }], format)).toBeNull();
  });
});

function generate(gameFormat: GameFormatKey, count: number, setup: Partial<PersistedSetup>) {
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(gameFormat, count) }),
    createDefaultSetup({ gameFormat, ...setup }),
    createTournamentRuntime({ random: sequenceRandom([0.31, 0.72, 0.05, 0.9, 0.48]), ids: fixedIdSource() }),
  );
}

function generated(result: ReturnType<typeof generate>): TournamentState {
  if (result.status !== 'generated') throw new Error(`Not generated: ${result.message}`);
  return result.state;
}

describe('generation for the new team formats at awkward counts', () => {
  it('4v4, 31 teams, qualification table + single elimination: rooms of 2 plus one bye', () => {
    const state = generated(
      generate('team-4v4', 31, {
        poolingPhase: 'qual-table',
        scheduleLogic: 'single-elimination',
        qualAdv: '8',
        oddCountStrategy: 'bye',
      }),
    );
    expect(state.rounds[0].rooms).toEqual(Array(15).fill(2));
    expect(state.rounds[0].byeCount).toBe(1);
  });

  it('4v4 with "None" refuses 31 teams, as 3v3 does', () => {
    const setup = { poolingPhase: 'qual-table', qualAdv: '8', oddCountStrategy: 'none' } as const;
    expect(generate('team-4v4', 31, setup).status).toBe('invalid');
    expect(generate('team-3v3', 31, setup).status).toBe('invalid');
  });

  it('5v5, 13 teams, Swiss: 6 rooms of 2 and a bye', () => {
    const state = generated(generate('team-5v5', 13, { poolingPhase: 'swiss', qualAdv: '4' }));
    expect(state.rounds[0].rooms).toEqual(Array(6).fill(2));
    expect(state.rounds[0].byeCount).toBe(1);
  });

  it('2v2, 13 teams, group stage generates', () => {
    const state = generated(generate('team-2v2', 13, { poolingPhase: 'group-stage', qualAdv: '4' }));
    expect(state.rounds.length).toBeGreaterThan(0);
  });

  it.each([23, 37])(
    '2v2v2v2v2, %i teams, qualification table: rooms of 4-5 teams, at most 10 players',
    (count) => {
      const state = generated(
        generate('team-2v2v2v2v2', count, { poolingPhase: 'qual-table', qualAdv: '8' }),
      );
      for (const round of state.rounds.filter((entry) => entry.isQual)) {
        expect(round.rooms.reduce((sum, room) => sum + room, 0)).toBe(count);
        for (const room of round.rooms) expect([4, 5]).toContain(room);
      }
      expect(validateRoomCap(state.rounds, requireGameFormat('team-2v2v2v2v2'))).toBeNull();
    },
  );

  it('2v2v2, 31 teams, qualification table + Kings Valley: rooms of 2-3 teams', () => {
    const state = generated(
      generate('team-2v2v2', 31, {
        poolingPhase: 'qual-table',
        scheduleLogic: 'kings-valley',
        qualAdv: '16',
      }),
    );
    expect(state.rounds[0].rooms.reduce((sum, room) => sum + room, 0)).toBe(31);
    for (const room of state.rounds[0].rooms) expect([2, 3]).toContain(room);
  });
});
