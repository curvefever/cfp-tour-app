import { describe, expect, it } from 'vitest';
import { bracketRoundLabels } from '../bracket';
import { plainRoundName } from '../round-name';
import { buildRound } from './test-fixtures';

describe('plainRoundName', () => {
  it('is the organiser\'s label when the round has one, else "Round N"', () => {
    expect(plainRoundName(buildRound({ roundNum: 4, customLabel: 'SemiA' }))).toBe('SemiA');
    expect(plainRoundName(buildRound({ roundNum: 4 }))).toBe('Round 4');
  });

  it('never adds the built-in names the Bracket shows', () => {
    const rounds = [
      buildRound({ roundNum: 5, isFinal: true }),
      buildRound({ roundNum: 6, isSemis: true }),
      buildRound({ roundNum: 7, bracket: 'losers' }),
    ];
    expect(bracketRoundLabels({ rounds }).map((entry) => entry.label)).toEqual([
      'Final',
      'Semis',
      'LB Round 7',
    ]);
    expect(rounds.map(plainRoundName)).toEqual(['Round 5', 'Round 6', 'Round 7']);
  });

  it('reads "Round undefined" for a round that does not exist, as the hand-written copies did', () => {
    expect(plainRoundName(undefined)).toBe('Round undefined');
  });
});
