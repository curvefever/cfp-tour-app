import { describe, expect, it } from 'vitest';
import { GAME_FORMATS, getGameFormat, resolveOddCountStrategy } from '../formats';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { GameFormatKey, PersistedSetup, TournamentState, TournamentTeam } from '../types';
import { fixedIdSource, sequenceRandom } from './test-fixtures';

/**
 * Head-to-head formats default to the "Bye" odd-count strategy, and an unset
 * value ('') means that default everywhere: what Setup shows is what is applied.
 */

const format = (key: GameFormatKey) => getGameFormat(key) as (typeof GAME_FORMATS)[GameFormatKey];

describe('resolveOddCountStrategy', () => {
  it.each(['individual-1v1', 'team-3v3'] as const)('resolves an unset value to "bye" for %s', (key) => {
    expect(resolveOddCountStrategy(format(key), '')).toBe('bye');
    expect(resolveOddCountStrategy(format(key), undefined)).toBe('bye');
  });

  it.each(['ffa-individual', 'team-2v2v2v2', 'team-3v3v3'] as const)(
    'resolves to undefined for %s, which has no odd-count options',
    (key) => {
      expect(resolveOddCountStrategy(format(key), '')).toBeUndefined();
      expect(resolveOddCountStrategy(format(key), 'bye')).toBeUndefined();
    },
  );

  it('returns an explicit value unchanged', () => {
    expect(resolveOddCountStrategy(format('individual-1v1'), 'none')).toBe('none');
    expect(resolveOddCountStrategy(format('individual-1v1'), 'bye')).toBe('bye');
    expect(resolveOddCountStrategy(format('team-3v3'), 'none')).toBe('none');
    expect(resolveOddCountStrategy(format('team-3v3'), 'flex')).toBe('flex');
  });

  it('keeps "none" first in the dropdown order and names "bye" as the default explicitly', () => {
    expect(GAME_FORMATS['individual-1v1'].supportedOddCountStrategies).toEqual(['none', 'bye']);
    expect(GAME_FORMATS['team-3v3'].supportedOddCountStrategies).toEqual(['none', 'bye', 'flex']);
    expect(GAME_FORMATS['individual-1v1'].defaultOddCountStrategy).toBe('bye');
    expect(GAME_FORMATS['team-3v3'].defaultOddCountStrategy).toBe('bye');
  });
});

function unitsFor(gameFormat: GameFormatKey, count: number): TournamentState['players'] {
  if (gameFormat === 'individual-1v1') return Array.from({ length: count }, (_, index) => `P${index + 1}`);
  return Array.from({ length: count }, (_, index): TournamentTeam => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
  }));
}

function generate(gameFormat: GameFormatKey, count: number, setup: Partial<PersistedSetup>) {
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: unitsFor(gameFormat, count) }),
    createDefaultSetup({ gameFormat, qualAdv: '4', ...setup }),
    createTournamentRuntime({ random: sequenceRandom([0.31, 0.72, 0.05, 0.9, 0.48]), ids: fixedIdSource() }),
  );
}

describe('an unset strategy generates exactly what "Bye" generates', () => {
  const schedules: Array<[PersistedSetup['scheduleLogic'], Partial<PersistedSetup>]> = [
    ['single-elimination', {}],
    ['double-elimination', {}],
  ];
  const poolings = ['none', 'qual-table', 'swiss'] as const;

  it.each(
    (['individual-1v1', 'team-3v3'] as const).flatMap((gameFormat) =>
      [11, 13, 33].flatMap((count) =>
        schedules.flatMap(([scheduleLogic, extra]) =>
          poolings.map((poolingPhase) => [gameFormat, count, scheduleLogic, poolingPhase, extra] as const),
        ),
      ),
    ),
  )('%s, %i units, %s, pooling %s', (gameFormat, count, scheduleLogic, poolingPhase, extra) => {
    const setup = { scheduleLogic, poolingPhase, ...extra };
    const unset = generate(gameFormat, count, { ...setup, oddCountStrategy: '' });
    const bye = generate(gameFormat, count, { ...setup, oddCountStrategy: 'bye' });
    expect(unset.status).toBe(bye.status);
    if (unset.status !== 'generated' || bye.status !== 'generated') return;
    expect(unset.state.rounds).toEqual(bye.state.rounds);
    expect(unset.state.gamemodeConfig).toEqual(bye.state.gamemodeConfig);
    expect(unset.state.gamemodeConfig.oddCountStrategy).toBe('bye');
    expect(unset.state.assignments).toEqual(bye.state.assignments);
  });
});

describe('an unset strategy seats no lone unit in round 1 (1v1, 11 players)', () => {
  it.each([
    ['a Qualification Table', { poolingPhase: 'qual-table' as const }],
    ['single elimination', { scheduleLogic: 'single-elimination' as const }],
    ['double elimination', { scheduleLogic: 'double-elimination' as const }],
  ])('%s: rooms of 2 plus one bye', (_label, setup) => {
    const result = generate('individual-1v1', 11, { oddCountStrategy: '', ...setup });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const round0 = result.state.assignments[0];
    const sizes = new Map<number, number>();
    for (const entry of round0)
      if (entry.room !== null) sizes.set(entry.room, (sizes.get(entry.room) ?? 0) + 1);
    expect([...sizes.values()]).toEqual(Array(5).fill(2));
    expect(round0.filter((entry) => entry.room === null)).toHaveLength(1);
  });
});

describe('an explicit "None" still refuses an odd field', () => {
  it('1v1 with 11 players', () => {
    const result = generate('individual-1v1', 11, { oddCountStrategy: 'none' });
    expect(result.status).toBe('invalid');
  });
});
