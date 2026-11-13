import { describe, expect, it } from 'vitest';
import { getAllTies } from '../../domain/tournament/advancement';
import { bestPlaceTieKey } from '../../domain/tournament/best-place';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { atEntry, indexOf } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { scoreKeysForPosition } from '../../domain/tournament/scoring';
import { bestPlaceHeading } from './best-place-heading';

const labels = [{ label: 'R4' }, { label: 'R5' }, { label: 'Final' }];

describe('the heading of a best-place tie card', () => {
  it('names the round, the place, the spots left and the round they go to', () => {
    expect(bestPlaceHeading({ roundIndex: 0, place: 6, spots: 1, destination: 1 }, labels)).toBe(
      '⚠ Tie-break required — R4 · best 6th (1 spot in R5)',
    );
    expect(bestPlaceHeading({ roundIndex: 1, place: 2, spots: 2, destination: 2 }, labels)).toBe(
      '⚠ Tie-break required — R5 · best 2nd (2 spots in Final)',
    );
  });

  it('reads the labels of a real tie card, which knows its own round', () => {
    const text = `ROUNDS:\nR4 = 3x8\nR5 = 2x8\nFinal = 8 FINAL\n\nROUTES:\nQual: 1-24->R4\n${['A', 'B', 'C']
      .map((room) => `R4.${room}: 1-5->R5, 6-8->eliminated`)
      .join(
        '\n',
      )}\nR4.BEST: 1 OF 6->R5\nR5.A: 1-4->Final, 5-8->eliminated\nR5.B: 1-4->Final, 5-8->eliminated`;
    const entry = atEntry(37, text);
    const r4 = indexOf(entry, 'R4');
    const scores = { ...entry.scores };
    const sameRoom = [80, 70, 60, 50, 40, 35, 20, 15];
    for (const room of [1, 2, 3]) {
      sameRoom.forEach((score, position) => {
        scores[scoreKeysForPosition({ roundIndex: r4, room, position })[0]] = score;
      });
    }
    const state = { ...entry, scores };
    const tie = getAllTies(state, r4)[bestPlaceTieKey(r4)];
    expect(tie && 'spots' in tie ? bestPlaceHeading(tie, bracketRoundLabels(state)) : '').toBe(
      '⚠ Tie-break required — R4 · best 6th (1 spot in R5)',
    );
  });
});
