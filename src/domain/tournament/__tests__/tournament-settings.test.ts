import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../state-defaults';
import {
  ROSTER_KEYS,
  TOURNAMENT_SETTING_KEYS,
  applyTournamentSettings,
  readTournamentSettings,
  settingsFromForm,
} from '../tournament-settings';

describe('TOURNAMENT_SETTING_KEYS / ROSTER_KEYS -- key-partition invariant', () => {
  it('covers every key of createDefaultSetup() exactly once between the two lists', () => {
    const defaultKeys = Object.keys(createDefaultSetup()).sort();
    const covered = [...TOURNAMENT_SETTING_KEYS, ...ROSTER_KEYS].sort();
    expect(covered).toEqual(defaultKeys);
  });
});

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
});

describe('applyTournamentSettings', () => {
  it('overwrites every setting field, keeps the current roster/reserves/reserveIndividuals, and drops qual', () => {
    const setup = createDefaultSetup({
      roster: 'P1\nP2',
      reserves: 'R1',
      reserveIndividuals: 'I1',
      scheduleLogic: 'single-elimination',
      qual: 'yes',
    });
    const settings = settingsFromForm(createDefaultSetup({ scheduleLogic: 'kings-valley', qualAdv: '16' }));
    const result = applyTournamentSettings(setup, settings);
    expect(result.roster).toBe('P1\nP2');
    expect(result.reserves).toBe('R1');
    expect(result.reserveIndividuals).toBe('I1');
    expect(result.scheduleLogic).toBe('kings-valley');
    expect(result.qualAdv).toBe('16');
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
