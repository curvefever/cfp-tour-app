import { describe, expect, it } from 'vitest';
import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import type { TournamentState } from '../../domain/tournament/types';
import { nextRoundPlan } from '../../domain/tournament/waterfall-steps';
import { nextRoundLine, reopenedNote } from './next-round-line';
import { incompleteRoomsMessage } from './next-round-warning';

function fixture(id: string): TournamentState {
  const found = fixtureTournaments().find((entry) => entry.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return loadedState(found);
}

const lineOf = (id: string) => {
  const state = fixture(id);
  return nextRoundLine(state, nextRoundPlan(state));
};

describe('the line under the Next Round button', () => {
  it('says what a press draws and what stays in play', () => {
    expect(lineOf('dependency-play-draws')).toBe('Draws R6R and R6L. SemiA stays in play.');
  });

  it('says what a press sends when there is nothing to draw yet', () => {
    expect(lineOf('dependency-play-in-play')).toBe(
      'Sends on R6R; nothing to draw yet. SemiA and R6L stay in play.',
    );
  });

  it('says it asks first when nothing is finished', () => {
    expect(lineOf('dependency-play-nothing-finished')).toBe(
      'Nothing is finished: Next Round sends on SemiA, R6R and R6L as they stand.',
    );
  });

  it('adds the rounds of a reopened press, sent on again as they stand', () => {
    expect(lineOf('dependency-play-reopened')).toBe(
      'Sends on R6L; nothing to draw yet. SemiA and R6R stay in play. R5R and R5L are sent on again as they stand.',
    );
  });

  it('is empty when there is no press', () => {
    const state = fixture('dependency-play-draws');
    expect(nextRoundLine(state, { ...nextRoundPlan(state), hidden: true })).toBeNull();
  });
});

describe('the note about a reopened press', () => {
  it('names the open rounds and the draws a correction will not change', () => {
    expect(reopenedNote(fixture('dependency-play-reopened'))).toBe(
      "R5R and R5L are open again. R6R and R6L are already drawn: a correction here won't change their draw.",
    );
  });

  it('is null when nothing is reopened', () => {
    expect(reopenedNote(fixture('dependency-play-in-play'))).toBeNull();
  });
});

describe('the confirmation in dependency play', () => {
  it('names each room with its round', () => {
    const state = fixture('dependency-play-nothing-finished');
    const plan = nextRoundPlan(state);
    expect(plan.confirm).toBe(true);
    const message = incompleteRoomsMessage(state, plan.roomsToConfirm);
    expect(message).toMatch(/^Not all scores in: .*SemiA · Room A.*\. Go on anyway\?$/);
    expect(message).toContain('R6R · Room A');
  });
});
