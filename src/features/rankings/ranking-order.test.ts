import { describe, expect, it } from 'vitest';
import { naturalByLabel } from './ranking-order';

const named = (...labels: string[]) => labels.map((label) => ({ label }));

describe('naturalByLabel', () => {
  it('puts Team 2 before Team 10 and Player 9 before Player 10', () => {
    expect(
      naturalByLabel(named('Team 10', 'Team 2', 'Team 1', 'Team 13', 'Team 12')).map((u) => u.label),
    ).toEqual(['Team 1', 'Team 2', 'Team 10', 'Team 12', 'Team 13']);
    expect(naturalByLabel(named('Player 10', 'Player 9')).map((u) => u.label)).toEqual([
      'Player 9',
      'Player 10',
    ]);
  });

  it('stays alphabetical for names without numbers and does not change its input', () => {
    const input = named('Wren', 'Ash', 'Moss');
    expect(naturalByLabel(input).map((u) => u.label)).toEqual(['Ash', 'Moss', 'Wren']);
    expect(input.map((u) => u.label)).toEqual(['Wren', 'Ash', 'Moss']);
  });

  it('sorts 13 teams numbered 1 to 13 in numeric order', () => {
    const labels = Array.from({ length: 13 }, (_, index) => `Team ${13 - index}`);
    expect(naturalByLabel(named(...labels)).map((u) => u.label)).toEqual(
      Array.from({ length: 13 }, (_, index) => `Team ${index + 1}`),
    );
  });
});
