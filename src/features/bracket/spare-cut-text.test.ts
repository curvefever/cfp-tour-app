import { describe, expect, it } from 'vitest';
import type { FairCutUnit, SpareCutContender, SpareCutResult } from '../../domain/tournament/fair-cut';
import { spareCutText } from './spare-cut-text';

function contender(name: string, size: number, percentile: number): SpareCutContender {
  const unit: FairCutUnit = { name, room: 1, place: 3, relative: 1, roomScored: percentile >= 0 };
  return { size, unit, percentile };
}

const label = (name: string) => `Team ${name}`;

describe('spareCutText', () => {
  it('names both contenders with their standing and who goes out', () => {
    const cedar = contender('Cedar', 4, 0.14);
    const dune = contender('Dune', 3, 0.21);
    expect(spareCutText([{ contenders: [cedar, dune], out: cedar }], label, false)).toBe(
      'Spare cut: Team Cedar is in the bottom 14% of rooms of 4 so far, Team Dune in the bottom 21% of rooms of 3. Team Cedar goes out.',
    );
  });

  it('ends with the drop to the losers bracket in a double elimination winners round', () => {
    const cedar = contender('Cedar', 4, 0.14);
    const dune = contender('Dune', 3, 0.21);
    expect(spareCutText([{ contenders: [cedar, dune], out: cedar }], label, true)).toMatch(
      /Team Cedar drops to the losers bracket\.$/,
    );
  });

  it('with two spare cuts lists each contender once and names both who go out', () => {
    const [a, b, c] = [contender('A', 4, 0.1), contender('B', 3, 0.2), contender('C', 2, 0.3)];
    const cuts: SpareCutResult[] = [
      { contenders: [a, b, c], out: a },
      { contenders: [b, c], out: b },
    ];
    expect(spareCutText(cuts, label, false)).toBe(
      'Spare cuts: Team A is in the bottom 10% of rooms of 4 so far, Team B in the bottom 20% of rooms of 3, Team C in the bottom 30% of rooms of 2. Team A and Team B go out.',
    );
  });

  it('says so when a contender has no scores yet, and is null with nothing to settle', () => {
    const cedar = contender('Cedar', 4, -1);
    const dune = contender('Dune', 3, 0.5);
    expect(spareCutText([{ contenders: [cedar, dune], out: cedar }], label, false)).toContain(
      'Team Cedar is in a room with no scores yet',
    );
    expect(spareCutText([], label, false)).toBeNull();
  });
});
