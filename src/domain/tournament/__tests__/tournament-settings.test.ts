import { describe, expect, it } from 'vitest';
import type { PersistedSetup } from '../types';
import { createDefaultSetup } from '../state-defaults';
import {
  ROSTER_KEYS,
  SETTING_KEYS,
  applyTournamentSettings,
  readTournamentSettings,
  settingsFromForm,
} from '../tournament-settings';

describe('SETTING_KEYS / ROSTER_KEYS -- key-partition invariant', () => {
  it('covers every key of createDefaultSetup() exactly once between the two lists', () => {
    const defaultKeys = Object.keys(createDefaultSetup()).sort();
    const covered = [...SETTING_KEYS, ...ROSTER_KEYS].sort();
    expect(covered).toEqual(defaultKeys);
  });
});

/** A valid value for every setting key, distinct from createDefaultSetup()'s own value for that key. */
const ALTERNATE_SETTINGS: Pick<PersistedSetup, (typeof SETTING_KEYS)[number]> = {
  scheduleLogic: 'kings-valley',
  gameFormat: 'team-2v2v2v2',
  scoring: 'positional-points',
  positionalPointsTable: '10,8,6',
  drawPublication: 'fixed',
  poolingPhase: 'qual-table',
  qualAdv: '16',
  nonCountingRounds: '2',
  groupSize: '5',
  roundRobinMode: 'double',
  qualifiersPerGroup: '3',
  finalsGames: '5',
  semisGames: '2',
  grandFinalWbTarget: '4',
  grandFinalLbTarget: '5',
  semisOverride: '12',
  finalOverride: '8',
  qualRoundsOverride: '3',
  swissRoundsOverride: '4',
  eliminationRoundTargets: '32,24',
  eliminationSeedingOverrides: 'diversity,balance',
  waterfallGraph: 'ROUNDS:\nFinal = 4 FINAL\nROUTES:',
  oddCountStrategy: 'bye',
  teamScoringRule: 'sum-members',
};

describe('settingsFromForm', () => {
  it('has no roster keys', () => {
    const form = createDefaultSetup({ roster: 'P1\nP2', reserves: 'R1', reserveIndividuals: 'I1' });
    const settings = settingsFromForm(form);
    expect(settings).not.toHaveProperty('roster');
    expect(settings).not.toHaveProperty('reserves');
    expect(settings).not.toHaveProperty('reserveIndividuals');
  });

  it('defaults lbQualifiers to "2" when the form has none', () => {
    const form = createDefaultSetup();
    expect(settingsFromForm(form).lbQualifiers).toBe('2');
  });

  it('carries an explicit lbQualifiers through', () => {
    const form = createDefaultSetup();
    expect(settingsFromForm({ ...form, lbQualifiers: '3' }).lbQualifiers).toBe('3');
  });

  it('copies every other setting field verbatim', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: 'ROUNDS:\nFinal = 4 FINAL\nROUTES:',
    });
    const settings = settingsFromForm(form);
    expect(settings.scheduleLogic).toBe('waterfall-bracket');
    expect(settings.waterfallGraph).toBe('ROUNDS:\nFinal = 4 FINAL\nROUTES:');
  });

  it('equals the form with the roster keys stripped and lbQualifiers defaulted, built independently of settingsFromForm itself', () => {
    const form = createDefaultSetup({
      ...ALTERNATE_SETTINGS,
      roster: 'P1\nP2',
      reserves: 'R1',
      reserveIndividuals: 'I1',
    });
    const { roster: _roster, reserves: _reserves, reserveIndividuals: _reserveIndividuals, ...rest } = form;
    expect(settingsFromForm(form)).toEqual({ ...rest, lbQualifiers: '2' });
  });
});

describe('applyTournamentSettings', () => {
  it('overwrites every setting field, keeps the current roster/reserves/reserveIndividuals, and drops qual', () => {
    const setup = createDefaultSetup({
      roster: 'P1\nP2',
      reserves: 'R1',
      reserveIndividuals: 'I1',
      qual: 'yes',
    });
    const settings = settingsFromForm(createDefaultSetup(ALTERNATE_SETTINGS));
    const result = applyTournamentSettings(setup, settings);
    for (const key of SETTING_KEYS) {
      expect(result[key]).toBe(settings[key]);
    }
    expect(result.roster).toBe('P1\nP2');
    expect(result.reserves).toBe('R1');
    expect(result.reserveIndividuals).toBe('I1');
    expect(result.qual).toBeUndefined();
  });
});

describe('readTournamentSettings', () => {
  it.each([undefined, null, 'a string', ['an', 'array']])('returns null for %j', (raw) => {
    expect(readTournamentSettings(raw)).toBeNull();
  });

  it('fills a missing key from createDefaultSetup() defaults, plus lbQualifiers "2"', () => {
    const settings = readTournamentSettings({ scheduleLogic: 'kings-valley' });
    expect(settings).not.toBeNull();
    expect(settings?.scheduleLogic).toBe('kings-valley');
    expect(settings?.gameFormat).toBe(createDefaultSetup().gameFormat);
    expect(settings?.lbQualifiers).toBe('2');
  });

  it('ignores a non-string value and an unknown key', () => {
    const settings = readTournamentSettings({ qualAdv: 42, someFutureField: 'x' });
    expect(settings).not.toBeNull();
    expect(settings?.qualAdv).toBe(createDefaultSetup().qualAdv);
    expect(settings).not.toHaveProperty('someFutureField');
  });
});
