import { describe, expect, it } from 'vitest';
import { projectedSlotLabelText, projectFutureRoundSlots } from '../../domain/tournament/bracket';
import { rosterKeys } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { isDrawPreview, withoutDraw } from './draw-preview';

/** Everything a round's draw is stored in, as text: a unit's name anywhere in it is a leak. */
function drawText(state: TournamentState): string {
  return JSON.stringify([
    state.assignments,
    state.byes,
    state.luckyLosers,
    state.pendingBracketSeeds,
    state.rounds.map((round) => [round.fixedRoomAssignments, round.matches, round.groupByes]),
  ]);
}

function namesIn(state: TournamentState, text: string): string[] {
  return rosterKeys(state.players).filter((name) => text.includes(`"${name}"`));
}

const GROUP_STAGE = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'group-stage',
  groupSize: '4',
  qualifiersPerGroup: '2',
  oddCountStrategy: 'bye',
  scheduleLogic: 'single-elimination',
} as const;

const FIXED_DRAWS = {
  gameFormat: 'ffa-individual',
  poolingPhase: 'qual-table',
  qualAdv: '24',
  scheduleLogic: 'single-elimination',
  drawPublication: 'fixed',
} as const;

describe('withoutDraw', () => {
  it.each([
    ['a group stage of 13', generated(13, GROUP_STAGE)],
    ['a fixed-draw qualification table of 37', generated(37, FIXED_DRAWS)],
    ['a drawn qualification table of 43', generated(43, { ...FIXED_DRAWS, drawPublication: 'adaptive' })],
  ])('leaves no unit in a round of %s, and the projected labels name none', (_name, state) => {
    expect(namesIn(state, drawText(state)).length).toBeGreaterThan(0);
    const bare = withoutDraw(state);
    expect(namesIn(bare, drawText(bare))).toEqual([]);
    const labels = Object.values(projectFutureRoundSlots(bare)).flatMap((rooms) =>
      (rooms ?? []).flat().map(projectedSlotLabelText),
    );
    const names = rosterKeys(state.players);
    expect(labels.filter((label) => names.some((name) => label.includes(name)))).toEqual([]);
  });

  it('keeps every round and its rooms, so the preview shows the same shape', () => {
    const state = generated(13, GROUP_STAGE);
    const bare = withoutDraw(state);
    expect(bare.rounds.map((round) => round.rooms)).toEqual(state.rounds.map((round) => round.rooms));
    expect(bare.rounds.map((round) => round.roomGroups)).toEqual(
      state.rounds.map((round) => round.roomGroups),
    );
    expect(bare.assignments).toHaveLength(state.assignments.length);
  });

  it('does not change the state it is given', () => {
    const state = generated(13, GROUP_STAGE);
    const before = JSON.stringify(state);
    withoutDraw(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('isDrawPreview', () => {
  it('is for a viewer of a tournament that has not started', () => {
    expect(isDrawPreview({ started: false }, true)).toBe(true);
    expect(isDrawPreview({ started: false }, false)).toBe(false);
    expect(isDrawPreview({ started: true }, true)).toBe(false);
  });
});
