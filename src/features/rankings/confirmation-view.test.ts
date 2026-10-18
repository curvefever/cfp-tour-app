import { describe, expect, it } from 'vitest';
import { confirmationCountText, teamConfirmationText } from './confirmation-view';

describe('confirmationCountText', () => {
  it('counts players of an individual roster', () => {
    expect(confirmationCountText({ confirmed: 24, total: 37 })).toBe('24 of 37 confirmed');
  });

  it('counts teams, then players, of a team roster', () => {
    expect(confirmationCountText({ confirmed: 31, total: 39, teamsConfirmed: 9, teams: 13 })).toBe(
      '9 of 13 teams confirmed · 31 of 39 players',
    );
  });
});

describe('teamConfirmationText', () => {
  it('says what the dot shows', () => {
    expect(teamConfirmationText({ confirmed: 3, total: 3, level: 'all' })).toBe('all confirmed');
    expect(teamConfirmationText({ confirmed: 1, total: 3, level: 'some' })).toBe('1 of 3 confirmed');
    expect(teamConfirmationText({ confirmed: 0, total: 3, level: 'none' })).toBe('none confirmed');
  });
});
