import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import { automaticAdvanceText, WAITING_FOR_ROSTER_TEXT } from './bracket-entry-text';

const textAt = (setup: Parameters<typeof createDefaultSetup>[0], registered: number | null) =>
  automaticAdvanceText(createDefaultSetup(setup), registered);

describe('automaticAdvanceText', () => {
  it('names the number, where it comes from and the rooms it fills: FFA at 37', () => {
    expect(textAt({}, 37)).toEqual({
      placeholder: 'automatic: 28',
      hint: 'Empty: 28, 75-85% of the 33 expected to play (9 in 10 of 37 registered), in 4 rooms of 7.',
    });
  });

  it('names no rooms for a power of two: 1v1 single elimination at 43', () => {
    expect(textAt({ gameFormat: 'individual-1v1' }, 43)).toEqual({
      placeholder: 'automatic: 32',
      hint: 'Empty: 32, 75-85% of the 39 expected to play (9 in 10 of 43 registered).',
    });
  });

  it('says the nearest the bracket can seat when the count is outside 75-85%: FFA at 14, the floor of 12', () => {
    expect(textAt({}, 14).hint).toBe(
      'Empty: 12, the nearest the bracket can seat to 80% of the 13 expected to play (9 in 10 of 14 registered).',
    );
  });

  it('says the same of an upper and lower bracket that has no count in the range: 24 at 31', () => {
    expect(textAt({ scheduleLogic: 'upper-lower' }, 31)).toEqual({
      placeholder: 'automatic: 24',
      hint: 'Empty: 24, the nearest the bracket can seat to 80% of the 28 expected to play (9 in 10 of 31 registered).',
    });
  });

  it('keeps 75-85% for a count in the range that fills no equal rooms: 1v1 at 12', () => {
    expect(textAt({ gameFormat: 'individual-1v1' }, 12).hint).toBe(
      'Empty: 9, 75-85% of the 11 expected to play (9 in 10 of 12 registered).',
    );
  });

  it('picks among the counts an upper and lower bracket seats', () => {
    // A Group Stage total of an upper and lower bracket reads this field: from 12 teams it seats 8, not the 9 another
    // bracket takes.
    const groups = { gameFormat: 'team-4v4', poolingPhase: 'group-stage', groupExit: 'fair-cut' } as const;
    expect(textAt({ ...groups, scheduleLogic: 'upper-lower' }, 12).placeholder).toBe('automatic: 8');
    expect(textAt({ ...groups, scheduleLogic: 'single-elimination' }, 12).placeholder).toBe('automatic: 9');
    expect(textAt({ scheduleLogic: 'upper-lower' }, 53).placeholder).toBe('automatic: 32');
  });

  it.each([null, 0])('waits for a roster (%s registered)', (registered) => {
    expect(textAt({}, registered)).toEqual({ placeholder: 'automatic', hint: WAITING_FOR_ROSTER_TEXT });
  });
});
