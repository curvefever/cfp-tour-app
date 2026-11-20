import { describe, expect, it } from 'vitest';
import { layeredGraphFor } from '../layered-form';
import { createDefaultSetup } from '../state-defaults';

/** The graph text of a layered bracket, as the Custom bracket engine reads it: pinned for the counts of the organiser's practice. */

const form = createDefaultSetup({
  scheduleLogic: 'layered',
  gameFormat: 'ffa-individual',
  poolingPhase: 'qual-table',
});

function textFor(registered: number): string {
  const graph = layeredGraphFor(form, registered);
  if (!graph.ok) throw new Error(graph.message);
  return graph.text;
}

describe('the graph text of a layered bracket', () => {
  it('31 registered: Semi-Final A first, its other half waits for Semi-Final B, the Lower level 8 + 7 then 8', () => {
    expect(textFor(31)).toBe(`ROUNDS:
Semi-Final A = 8
Round 4 - Lower = 8+7
Round 5 - Lower = 8
Semi-Final B = 8
Final = 8 FINAL

ROUTES:
Qual: 1-8->Semi-Final A, 9-23->Round 4 - Lower
Semi-Final A: 1-4->Final, 5-8->Semi-Final B
Round 4 - Lower.A: 1-4->Round 5 - Lower
Round 4 - Lower.B: 1-4->Round 5 - Lower
Round 5 - Lower: 1-4->Semi-Final B
Semi-Final B: 1-4->Final
`);
  });

  it('53 registered: two levels, the first semi-final plays its other half on in the Lower level, rooms of 8 + 8 + 7', () => {
    expect(textFor(53)).toBe(`ROUNDS:
Round 4 - Upper = 2x8
Round 4 - Lower = 3x8
Semi-Final A = 8
Round 5 - Lower = 8+8+7
Round 6 - Lower = 2x8
Semi-Final B = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->Round 4 - Upper, 17-40->Round 4 - Lower
Round 4 - Upper.A: 1-4->Semi-Final A, 5-8->Round 5 - Lower
Round 4 - Upper.B: 1-4->Semi-Final A, 5-8->Round 5 - Lower
Round 4 - Lower.A: 1-5->Round 5 - Lower
Round 4 - Lower.B: 1-5->Round 5 - Lower
Round 4 - Lower.C: 1-5->Round 5 - Lower
Semi-Final A: 1-4->Final, 5-8->Round 6 - Lower
Round 5 - Lower.A: 1-4->Round 6 - Lower
Round 5 - Lower.B: 1-4->Round 6 - Lower
Round 5 - Lower.C: 1-4->Round 6 - Lower
Round 6 - Lower.A: 1-4->Semi-Final B
Round 6 - Lower.B: 1-4->Semi-Final B
Semi-Final B: 1-4->Final
`);
  });

  it('three levels (80 registered): the Middle level goes through to Semi-Final B and the rounds follow their levels', () => {
    const text = textFor(80);
    expect(text).toContain('Qual: 1-16->Round 4 - Upper, 17-28->Round 4 - Middle, 29-60->Round 4 - Lower');
    expect(text).toContain('Semi-Final A: 1-4->Final, 5-8->Round 6 - Middle');
    expect(text).toContain('Round 5 - Lower = 8+7+7');
    expect(text).toContain('Round 7 - Middle: 1-2->Semi-Final B, 3-6->Round 8 - Lower');
    expect(text).toContain('Round 8 - Lower.A: 1-3->Semi-Final B');
  });
});
