import { describe, expect, it } from 'vitest';
import {
  createDefaultInfo,
  createDefaultSetup,
  createDefaultTournamentState,
} from '../../domain/tournament/state-defaults';
import {
  buildTournamentSummary,
  changedDescription,
  parseDescriptionFields,
  setupDescription,
  stateDescription,
  type TournamentDescription,
} from './tournament-summary';

describe('buildTournamentSummary', () => {
  it('describes a 37-player roster from the setup form and the state', () => {
    const state = createDefaultTournamentState({
      title: 'Autumn Cup',
      players: Array.from({ length: 37 }, (_, index) => `P${index + 1}`),
      info: createDefaultInfo({ scheduledAt: 1_790_000_000_000 }),
    });
    const setup = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      scheduleLogic: 'double-elimination',
    });
    expect(buildTournamentSummary(state, setup)).toEqual({
      title: 'Autumn Cup',
      scheduledAt: 1_790_000_000_000,
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      scheduleLogic: 'double-elimination',
      unitCount: 37,
    });
  });

  it('counts teams, not their members, in a team format', () => {
    const teams = Array.from({ length: 12 }, (_, index) => ({
      teamId: `t${index + 1}`,
      teamName: `Team ${index + 1}`,
      members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
    }));
    const state = createDefaultTournamentState({ gameFormat: 'team-3v3v3', players: teams });
    const summary = buildTournamentSummary(state, createDefaultSetup({ gameFormat: 'team-3v3v3' }));
    expect(summary.unitCount).toBe(12);
  });

  it('has no date until one is set', () => {
    const summary = buildTournamentSummary(createDefaultTournamentState(), createDefaultSetup());
    expect(summary.scheduledAt).toBeNull();
    expect(summary.unitCount).toBe(0);
  });
});

describe('parseDescriptionFields', () => {
  it('keeps the known fields and drops the rest, including status fields', () => {
    expect(parseDescriptionFields({ title: 'T', unitCount: 3, status: 'finished', started: true })).toEqual({
      title: 'T',
      unitCount: 3,
    });
  });

  it('accepts a null date and rejects badly typed fields', () => {
    expect(parseDescriptionFields({ scheduledAt: null })).toEqual({ scheduledAt: null });
    expect(() => parseDescriptionFields({ scheduledAt: '2026' })).toThrow('scheduledAt');
    expect(() => parseDescriptionFields({ unitCount: 2.5 })).toThrow('unitCount');
    expect(() => parseDescriptionFields({ unitCount: -1 })).toThrow('unitCount');
    expect(() => parseDescriptionFields({ title: 5 })).toThrow('title');
  });

  it('rejects a summary that is not an object', () => {
    expect(() => parseDescriptionFields(null)).toThrow('Invalid tournament summary.');
    expect(() => parseDescriptionFields([])).toThrow('Invalid tournament summary.');
  });
});

describe('stateDescription and setupDescription', () => {
  it('split the summary between what the state decides and what the Setup form decides', () => {
    const state = createDefaultTournamentState({ title: 'Cup', players: ['A', 'B'] });
    const setup = createDefaultSetup({ gameFormat: 'individual-1v1', poolingPhase: 'swiss' });
    expect(stateDescription(state)).toEqual({ title: 'Cup', scheduledAt: null, unitCount: 2 });
    expect(setupDescription(setup)).toEqual({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      scheduleLogic: setup.scheduleLogic,
    });
    expect(buildTournamentSummary(state, setup)).toEqual({
      ...stateDescription(state),
      ...setupDescription(setup),
    });
  });
});

describe('changedDescription', () => {
  it('keeps only the fields whose value differs', () => {
    const previous: Partial<TournamentDescription> = { title: 'A', unitCount: 3, scheduledAt: null };
    const next: Partial<TournamentDescription> = { title: 'B', unitCount: 3, scheduledAt: 5 };
    expect(changedDescription(previous, next)).toEqual({ title: 'B', scheduledAt: 5 });
  });

  it('is empty when nothing changed', () => {
    expect(changedDescription({ title: 'A' }, { title: 'A' })).toEqual({});
  });
});
