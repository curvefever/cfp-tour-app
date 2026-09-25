import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { roomPairKey } from '../seeding';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import { buildState, playThrough, scoreCurrentRound, type SweepConfig } from './play-through';

/**
 * Real tournament sizes (30-40 head-to-head units, 80 FFA players). Rooms
 * per wave used to be capped near 8 because assignWaveToRooms tried every
 * permutation; these run the full transition code at 15-20 rooms per wave.
 */

const H2H = { gameFormat: 'individual-1v1' as const, oddCountStrategy: 'bye' as const };

function configs(count: number): SweepConfig[] {
  const base = { count, teams: false };
  return [
    {
      ...base,
      label: 'single elimination, no pooling',
      setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
    },
    {
      ...base,
      label: 'single elimination after a qualification table',
      setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '16' },
    },
    {
      ...base,
      label: 'Swiss into single elimination (32 advance)',
      setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase: 'swiss', qualAdv: '32' },
    },
    {
      ...base,
      label: 'double elimination',
      setup: { ...H2H, scheduleLogic: 'double-elimination', poolingPhase: 'none' },
    },
  ];
}

describe('head-to-head tournaments of 33 and 40 players play through to the Final', () => {
  it.each(
    [33, 40].flatMap((count) => configs(count).map((config) => [count, config.label, config] as const)),
  )(
    '%i players: %s',
    (_count, _label, config) => {
      const state = buildState(config);
      expect(state).not.toBeNull();
      const started = performance.now();
      const outcome = playThrough(state as NonNullable<typeof state>, 0, null);
      const elapsed = performance.now() - started;
      expect(outcome.kind === 'ok' ? 'ok' : JSON.stringify(outcome)).toBe('ok');
      expect(elapsed).toBeLessThan(5000);
    },
    30_000,
  );
});

describe('a fixed-draw Qualification Table, 1v1 with 37 players', () => {
  it('generates quickly and publishes no repeat pairing', () => {
    const players = Array.from({ length: 37 }, (_, index) => `P${index + 1}`);
    const started = performance.now();
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players }),
      createDefaultSetup({
        ...H2H,
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '16',
        drawPublication: 'fixed',
      }),
      createTournamentRuntime(),
    );
    const elapsed = performance.now() - started;
    if (result.status !== 'generated') throw new Error(JSON.stringify(result));
    expect(elapsed).toBeLessThan(5000);

    const seen = new Set<string>();
    const repeats: string[] = [];
    for (const round of result.state.rounds.filter((entry) => entry.fixedRoomAssignments)) {
      const byRoom = new Map<number, string[]>();
      for (const entry of round.fixedRoomAssignments ?? []) {
        if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
      }
      for (const members of byRoom.values()) {
        const key = roomPairKey(members[0], members[1]);
        if (seen.has(key)) repeats.push(key);
        seen.add(key);
      }
    }
    expect(repeats).toEqual([]);
  });
});

describe('FFA with 80 players (10 rooms per wave)', () => {
  it('advances one Qualification Table round quickly', () => {
    const state = buildState({
      label: 'FFA 80',
      count: 80,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '32',
      },
    });
    expect(state).not.toBeNull();
    const scored = scoreCurrentRound(state as NonNullable<typeof state>, 0);
    const started = performance.now();
    const result = advanceTournamentRound(scored);
    const elapsed = performance.now() - started;
    expect(result.status).toBe('advanced');
    expect(elapsed).toBeLessThan(5000);
  });
});
