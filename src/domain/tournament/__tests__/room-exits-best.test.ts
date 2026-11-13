import { describe, expect, it } from 'vitest';
import { projectedSlotLabelText, projectFutureRoundSlots } from '../bracket';
import { roundExitGroups } from '../exit-groups';
import { computeRankings } from '../rankings';
import { exitBandAtRank, roundExitRule, type RoomExitBand } from '../room-exits';
import type { TournamentState } from '../types';
import { A, B, C, EXAMPLE, WITH_LOWER, scoreRooms, seatOf } from './best-place-fixtures';
import { atEntry, indexOf, pressed } from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';

/** The Bracket's description of a best place and what Rankings counts out (`plans/2026-11-13-best-of-a-place.md`, stage 4). */

const scoredExample = (graph = EXAMPLE) => {
  const entry = withDependencyPlay(atEntry(37, graph));
  return scoreRooms(entry, indexOf(entry, 'R4'), [A, B, C]);
};

function bandsOf(state: TournamentState, label = 'R4'): RoomExitBand[][] {
  const rule = roundExitRule(state, indexOf(state, label));
  if (rule.kind !== 'per-room') throw new Error('not a per-room round');
  return rule.rooms;
}

describe('the exit bands of a room with a best place', () => {
  it('has the best place between the places that go on and the places that are out', () => {
    const state = scoredExample();
    for (const bands of bandsOf(state)) {
      expect(bands).toEqual([
        { kind: 'advance', fromRank: 1, toRank: 5, destination: indexOf(state, 'R5') },
        {
          kind: 'best-place',
          rank: 6,
          spots: 1,
          rooms: 3,
          destination: indexOf(state, 'R5'),
          otherwise: 'eliminate',
        },
        { kind: 'eliminate', fromRank: 7, toRank: 8 },
      ]);
    }
  });

  it('is found by its rank like any band', () => {
    const state = scoredExample();
    expect(exitBandAtRank(bandsOf(state)[0], 6)?.kind).toBe('best-place');
    expect(exitBandAtRank(bandsOf(state)[0], 5)?.kind).toBe('advance');
  });

  it('names where the rest of the place go, in its own exit group, when a Lower round takes them', () => {
    const state = scoredExample(WITH_LOWER);
    const lower = indexOf(state, 'R5L');
    const groups = roundExitGroups(state, indexOf(state, 'R4'));
    expect(groups.get(indexOf(state, 'R5'))).toBe(0);
    expect(groups.get(lower)).toBe(1);
    expect(bandsOf(state)[1][1]).toMatchObject({
      kind: 'best-place',
      destination: indexOf(state, 'R5'),
      otherwise: { advance: lower, group: 1 },
    });
  });

  it('leaves out the best place in a room too short to have it', () => {
    const state = scoredExample();
    const r4 = indexOf(state, 'R4');
    // Room C keeps its first five units: a removal left it with no 6th place.
    let seen = 0;
    const kept = state.assignments[r4].filter((entry) => entry.room !== 3 || (seen += 1) <= 5);
    const short = {
      ...state,
      assignments: state.assignments.map((round, index) => (index === r4 ? kept : round)),
    };
    const bands = bandsOf(short)[2];
    expect(bands.some((band) => band.kind === 'best-place')).toBe(false);
  });
});

describe('the units a best place sends to a round that is not drawn yet', () => {
  it('gives the round one slot per chosen unit, named by its place and source', () => {
    const entry = withDependencyPlay(atEntry(37, EXAMPLE));
    const slots = projectFutureRoundSlots(entry)[indexOf(entry, 'R5')];
    const flat = (slots ?? []).flat();
    expect(flat).toHaveLength(16);
    const best = flat.filter((slot) => slot.kind === 'best-place');
    expect(best.map(projectedSlotLabelText)).toEqual(['★ Best 6th, R4']);
  });

  it('takes the chosen units off the round the rest of the place go to', () => {
    const entry = withDependencyPlay(atEntry(37, WITH_LOWER));
    const flat = (projectFutureRoundSlots(entry)[indexOf(entry, 'R5L')] ?? []).flat();
    expect(flat).toHaveLength(6);
    expect(flat.filter((slot) => slot.kind === 'waterfall-rank' && slot.rank === 6)).toHaveLength(2);
  });
});

describe('Rankings and a best place', () => {
  const rankedOut = (state: TournamentState) =>
    new Set(
      (computeRankings(state)?.eliminatedList ?? [])
        .filter((entry) => entry.ri === indexOf(state, 'R4'))
        .map((entry) => entry.name),
    );

  it('counts the 6ths out of no one while the round is not sent on: they are candidates', () => {
    const state = scoredExample();
    const out = rankedOut(state);
    for (const room of [1, 2, 3]) expect(out.has(seatOf(state, room, 5))).toBe(false);
    expect(out.has(seatOf(state, 1, 6))).toBe(true);
    expect(out.has(seatOf(state, 1, 7))).toBe(true);
  });

  it('counts out the 6ths that were not chosen, once the round is sent on, and not the chosen one', () => {
    const state = pressed(scoredExample());
    const out = rankedOut(state);
    expect(out.has(seatOf(state, 3, 5))).toBe(false);
    expect(out.has(seatOf(state, 1, 5))).toBe(true);
    expect(out.has(seatOf(state, 2, 5))).toBe(true);
  });

  it('counts out nobody of the 6ths when the rest go to a Lower round', () => {
    const state = pressed(scoredExample(WITH_LOWER));
    const out = rankedOut(state);
    for (const room of [1, 2, 3]) expect(out.has(seatOf(state, room, 5))).toBe(false);
  });
});
