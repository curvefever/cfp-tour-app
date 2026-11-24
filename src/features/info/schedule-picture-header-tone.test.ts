import { describe, expect, it } from 'vitest';
import { headerTone } from './schedule-picture-header-tone';

describe('headerTone', () => {
  it('is green when nothing routes into the round', () => {
    expect(headerTone([])).toBe('green');
  });

  it('takes the earliest column, not the most favourable of all', () => {
    expect(
      headerTone([
        { column: 0, tone: 'yellow' },
        { column: 1, tone: 'green' },
      ]),
    ).toBe('yellow');
  });

  it('takes the most favourable tone of the earliest column', () => {
    expect(
      headerTone([
        { column: -1, tone: 'purple' },
        { column: -1, tone: 'orange' },
        { column: 0, tone: 'green' },
      ]),
    ).toBe('orange');
    expect(
      headerTone([
        { column: 2, tone: 'neutral' },
        { column: 2, tone: 'purple' },
      ]),
    ).toBe('purple');
  });
});
