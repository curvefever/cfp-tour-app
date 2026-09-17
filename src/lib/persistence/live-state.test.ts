import { describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import {
  normalizeActiveTab,
  normalizeLiveTournamentState,
  normalizePersistedSetup,
  parseLiveEnvelope,
  serializeLiveEnvelope,
} from './live-state';

const fixedIds = { tournamentId: vi.fn(() => 'minted-id') };

describe('normalizeLiveTournamentState', () => {
  it('fills in missing fields with the default state', () => {
    const state = normalizeLiveTournamentState({ title: 'My Cup' }, fixedIds);
    expect(state.title).toBe('My Cup');
    expect(state.scores).toEqual({});
    expect(state.curRound).toBe(0);
  });

  it('pads player/reserve member arrays to teamSize for a team format', () => {
    const state = normalizeLiveTournamentState(
      {
        gameFormat: 'team-2v2v2v2',
        players: [{ name: 'Team A', members: ['P1'] }],
        reserves: [{ name: 'Team B', members: [] }],
      },
      fixedIds,
    );
    expect(state.players).toEqual([{ name: 'Team A', members: ['P1', null] }]);
    expect(state.reserves).toEqual([{ name: 'Team B', members: [null, null] }]);
  });

  it('leaves players/reserves untouched for a non-team format', () => {
    const players = [{ name: 'Solo Player' }];
    const state = normalizeLiveTournamentState({ gameFormat: 'ffa-individual', players }, fixedIds);
    expect(state.players).toEqual(players);
  });

  it('mints a tournamentId only when rounds is non-empty and no id is already set', () => {
    fixedIds.tournamentId.mockClear();
    const withRounds = normalizeLiveTournamentState(
      { rounds: [{ rooms: [2] }], tournamentId: null },
      fixedIds,
    );
    expect(withRounds.tournamentId).toBe('minted-id');
    expect(fixedIds.tournamentId).toHaveBeenCalledTimes(1);
  });

  it('does not mint a tournamentId when rounds is empty', () => {
    fixedIds.tournamentId.mockClear();
    const state = normalizeLiveTournamentState({ rounds: [], tournamentId: null }, fixedIds);
    expect(state.tournamentId).toBeNull();
    expect(fixedIds.tournamentId).not.toHaveBeenCalled();
  });

  it('keeps an existing tournamentId and does not mint a new one', () => {
    fixedIds.tournamentId.mockClear();
    const state = normalizeLiveTournamentState(
      { rounds: [{ rooms: [2] }], tournamentId: 'already-set' },
      fixedIds,
    );
    expect(state.tournamentId).toBe('already-set');
    expect(fixedIds.tournamentId).not.toHaveBeenCalled();
  });

  it('treats a non-object input as an empty envelope', () => {
    const state = normalizeLiveTournamentState('not-an-object', fixedIds);
    expect(state).toEqual(createDefaultTournamentState());
  });
});

describe('normalizePersistedSetup', () => {
  it('restores every known field independently from raw', () => {
    const setup = normalizePersistedSetup({ scheduleLogic: 'double-elimination', groupSize: '8' });
    expect(setup.scheduleLogic).toBe('double-elimination');
    expect(setup.groupSize).toBe('8');
    expect(setup.qualAdv).toBe(createDefaultSetup().qualAdv);
  });

  it('uses an explicit poolingPhase when present', () => {
    const setup = normalizePersistedSetup({ poolingPhase: 'group-stage', qual: 'yes' });
    expect(setup.poolingPhase).toBe('group-stage');
  });

  it('migrates the legacy qual === "yes" flag to qual-table when poolingPhase is absent', () => {
    const setup = normalizePersistedSetup({ qual: 'yes' });
    expect(setup.poolingPhase).toBe('qual-table');
  });

  it('falls back to none when neither poolingPhase nor the legacy qual flag is present', () => {
    const setup = normalizePersistedSetup({});
    expect(setup.poolingPhase).toBe('none');
  });

  it('treats a non-object input as an empty envelope', () => {
    expect(normalizePersistedSetup(null)).toEqual(createDefaultSetup());
  });
});

describe('normalizeActiveTab', () => {
  it('passes through every known tab', () => {
    for (const tab of ['admin', 'scoreboard', 'bracket', 'rankings', 'archive']) {
      expect(normalizeActiveTab(tab)).toBe(tab);
    }
  });

  it('falls back to bracket for an unknown or non-string value', () => {
    expect(normalizeActiveTab('not-a-tab')).toBe('bracket');
    expect(normalizeActiveTab(null)).toBe('bracket');
    expect(normalizeActiveTab(42)).toBe('bracket');
  });
});

describe('parseLiveEnvelope / serializeLiveEnvelope', () => {
  it('round-trips a valid envelope', () => {
    const envelope = {
      T: createDefaultTournamentState({ title: 'Round Trip Cup' }),
      setup: createDefaultSetup(),
      activeTab: 'rankings' as const,
    };
    const parsed = parseLiveEnvelope(serializeLiveEnvelope(envelope), fixedIds);
    expect(parsed.T.title).toBe('Round Trip Cup');
    expect(parsed.activeTab).toBe('rankings');
  });

  it('lets a malformed-JSON SyntaxError propagate uncaught', () => {
    expect(() => parseLiveEnvelope('not json', fixedIds)).toThrow(SyntaxError);
  });

  it('throws a TypeError for valid JSON that is not a top-level object', () => {
    expect(() => parseLiveEnvelope('[1,2,3]', fixedIds)).toThrow(TypeError);
    expect(() => parseLiveEnvelope('"just a string"', fixedIds)).toThrow(TypeError);
    expect(() => parseLiveEnvelope('null', fixedIds)).toThrow(TypeError);
  });
});
