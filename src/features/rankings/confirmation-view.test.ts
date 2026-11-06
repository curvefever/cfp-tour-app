import { r1WithFiveAbsent } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import { markBack } from '../../domain/tournament/likely-absentees';
import { describe, expect, it } from 'vitest';
import {
  confirmationCountText,
  confirmationView,
  teamConfirmationText,
  toggleTitle,
} from './confirmation-view';

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

describe('the toggle of a likely absentee and of a unit marked back', () => {
  const state = r1WithFiveAbsent();
  const room = state.assignments[state.curRound]
    .filter((entry) => entry.room === 1)
    .map((entry) => entry.name);
  const [present, absent] = [room[0], room[4]];

  it('reads "?" with the round it was absent from, and its title says so', () => {
    const mark = confirmationView(state).toggle(absent);
    expect(mark).toEqual({ source: null, round: 'R1' });
    expect(toggleTitle(mark)).toBe('Absent in R1 — click when back');
  });

  it('reads ✓ and "Back from" once marked back', () => {
    const mark = confirmationView(markBack(state, absent)).toggle(absent);
    expect(mark).toEqual({ source: 'back', round: 'R1' });
    expect(toggleTitle(mark)).toBe('Back from R1 — click to undo');
  });

  it('keeps the titles of a scored player, a manual mark and a name nobody confirmed', () => {
    expect(confirmationView(state).toggle(present)).toEqual({ source: 'score', round: null });
    expect(toggleTitle({ source: 'score', round: null })).toBe('Confirmed — has a score');
    expect(toggleTitle({ source: 'manual', round: null })).toBe('Confirmed — click to undo');
    expect(toggleTitle({ source: null, round: null })).toBe('Not confirmed yet — click to confirm');
  });
});
