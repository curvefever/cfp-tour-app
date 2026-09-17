import { describe, expect, it } from 'vitest';
import { bracketRowGroups, projectedSlotLabelText, projectFutureRoundSlots } from '../bracket';
import type { TournamentRound } from '../types';
import { buildRound } from './test-fixtures';

function project(rounds: TournamentRound[], curRound: number) {
  return projectFutureRoundSlots({ rounds, curRound });
}

describe('projectFutureRoundSlots', () => {
  it('projects a plain single-elimination hop as "Winner of Room N", room-major, chunked sequentially into the target room', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 3], players: 6, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual(['Winner of Room 1A', 'Winner of Room 1B']);
  });

  it('orders tier-major/room-minor for advPerRoom > 1, appending lucky-loser tokens last', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 3, 3], players: 9, advPerRoom: 2, luckyCount: 1 }),
      buildRound({ roundNum: 2, rooms: [7], players: 7, advPerRoom: 7, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Room 1A, Rank 1',
      'Room 1B, Rank 1',
      'Room 1C, Rank 1',
      'Room 1A, Rank 2',
      'Room 1B, Rank 2',
      'Room 1C, Rank 2',
      '★ Lucky loser (any room)',
    ]);
  });

  it("labels a WB round's losers-edge into an LB round by source-round identity, not room", () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'winners',
        winnersTo: null,
        losersTo: 1,
      }),
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0, bracket: 'losers' }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Dropped from WB Round 1',
      'Dropped from WB Round 1',
    ]);
  });

  it('labels an LB round\'s winners-edge by source-round identity ("Advanced from LB Round N")', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'losers',
        winnersTo: 1,
        losersTo: null,
      }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Advanced from LB Round 1',
      'Advanced from LB Round 1',
    ]);
  });

  it('gives every slot a uniform "seed TBD" label leaving the last qual round, ignoring the source round\'s own advPerRoom/luckyCount', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        isQual: true,
        isNoElim: true,
        advPerRoom: 5,
        luckyCount: 3,
      }),
      buildRound({ roundNum: 2, rooms: [3], players: 3, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
    ]);
  });

  it('gives every slot a uniform "seed TBD" label leaving the last group-stage round', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isGroupStage: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
    ]);
  });

  it('returns null for a Swiss round target (pairingTBD) and a group-stage round target', () => {
    const swissRounds = [
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, isSwiss: true, isNoElim: true, pairingTBD: true }),
    ];
    expect(project(swissRounds, 0)[1]).toBeNull();

    const groupRounds = [
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2, 2], players: 4, isGroupStage: true, isNoElim: true }),
    ];
    expect(project(groupRounds, 0)[1]).toBeNull();
  });

  it("projects a mid-pooling-phase hop (qual round 1 -> qual round 2, neither is the last) via the same per-room-rank shape as any other no-elim round -- everyone advances, ranked within their own room, then chunked tier-major into the target round's own declared room sizes (not tieredSeed-ed -- see bracket.ts's comment on why the projection deliberately diverges from the real transition's tieredSeed here, while still spreading same-source-room candidates across target rooms instead of collapsing to same-room carryover)", () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
    ];
    const result = project(rounds, 0);
    // Pool = [R1r1, R2r1, R1r2, R2r2] (tier-major: every room's rank-1, then
    // every room's rank-2); distributed round-robin (rotating one room per
    // tier) into 2 target rooms of size 2 each: room1 <- [R1r1, R2r2],
    // room2 <- [R2r1, R1r2] -- each target room draws from both source
    // rooms AND both rank tiers, instead of one tier's worth per room.
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual(['Room 1A, Rank 1', 'Room 1B, Rank 2']);
    expect(result[1]?.[1].map(projectedSlotLabelText)).toEqual(['Room 1B, Rank 1', 'Room 1A, Rank 2']);
  });

  it('projects a no-elim (e.g. "None" pooling warmup) round using each room\'s own size -- nobody is cut, but within-room rank still carries forward, and room sizes can differ; every target room\'s slot count always matches its own declared size exactly', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 2], players: 5, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [3, 2], players: 5, isNoElim: true }),
    ];
    const result = project(rounds, 0);
    // Pool = [R1r1, R2r1, R1r2, R2r2, R1r3] (tier-major: rank 1 from both
    // rooms, rank 2 from both rooms, rank 3 only from room 1 since room 2 is
    // smaller); distributed round-robin (rotating one room per tier) into
    // rooms sized [3, 2]: room1 (size 3) <- [R1r1, R2r2, R1r3], room2
    // (size 2) <- [R2r1, R1r2] -- room1 spans all three rank tiers instead
    // of only ranks 1-2.
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Room 1A, Rank 1',
      'Room 1B, Rank 2',
      'Room 1A, Rank 3',
    ]);
    expect(result[1]?.[1].map(projectedSlotLabelText)).toEqual(['Room 1B, Rank 1', 'Room 1A, Rank 2']);
  });

  it('resolves every round in a chain of no-elim rounds feeding a real elimination round -- poisoning no longer cascades past a no-elim predecessor', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 4, rooms: [1], players: 1, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]).not.toBeNull();
    expect(result[2]).not.toBeNull();
    expect(result[3]?.[0].map(projectedSlotLabelText)).toEqual(['Winner of Room 3A']);
  });

  it('falls back to null on a structural token-count mismatch (e.g. an unmodeled bye), and poisons downstream rounds', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, advPerRoom: 1, luckyCount: 0 }),
      // Only 2 tokens will be produced, but this round expects 3 -- an unmodeled bye.
      buildRound({ roundNum: 2, rooms: [3], players: 3, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
  });

  it('concatenates multiple predecessors feeding the same target in ascending source-round-index order', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2],
        players: 2,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'winners',
        winnersTo: 2,
        losersTo: null,
      }),
      buildRound({
        roundNum: 1,
        rooms: [2],
        players: 2,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'losers',
        winnersTo: 2,
        losersTo: null,
      }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[2]?.[0].map((slot) => slot.kind)).toEqual(['room-rank', 'round-edge']);
    expect(result[2]?.[0].map(projectedSlotLabelText)).toEqual([
      'Winner of Room 1A',
      'Advanced from LB Round 1',
    ]);
  });

  it('regression: a target room spanning multiple rank tiers gets a full spread of ranks and source rooms, not just the leading tier(s)', () => {
    // Reproduces a live-reported bug: 4 source rooms feeding a same-shaped
    // 8/7/7/7 target round used to chunk the first two whole rank-tiers
    // (ranks 1 and 2 from every source room) straight into target Room A,
    // so it looked like Room A would only ever hold the very best players.
    const rounds = [
      buildRound({ roundNum: 1, rooms: [8, 7, 7, 7], players: 29, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [8, 7, 7, 7], players: 29, isNoElim: true }),
    ];
    const result = project(rounds, 0);
    const roomA = result[1]?.[0] ?? [];
    expect(roomA).toHaveLength(8);

    const ranksInRoomA = new Set(roomA.map((slot) => (slot.kind === 'room-rank' ? slot.rank : null)));
    expect(ranksInRoomA.size).toBeGreaterThan(2);
    expect(
      Math.max(...[...ranksInRoomA].filter((rank): rank is number => rank !== null)),
    ).toBeGreaterThanOrEqual(5);

    const sourceRoomsInRoomA = new Set(roomA.map((slot) => (slot.kind === 'room-rank' ? slot.room : null)));
    expect(sourceRoomsInRoomA.size).toBeGreaterThan(1);
  });

  it('spreads ranks across uneven target room sizes on the ordinary cutting-round branch too', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [6, 6, 6], players: 18, advPerRoom: 3, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [4, 3, 2], players: 9, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.map((room) => room.length)).toEqual([4, 3, 2]);

    const roomA = result[1]?.[0] ?? [];
    const ranksInRoomA = new Set(roomA.map((slot) => (slot.kind === 'room-rank' ? slot.rank : null)));
    expect(ranksInRoomA.size).toBeGreaterThan(1);
  });
});

describe('bracketRowGroups', () => {
  it('splits a double-elimination (race) schedule into winners/losers rows, with the grand final appended to winners', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, bracket: 'winners', winnersTo: 2, losersTo: 1 }),
      buildRound({ roundNum: 1, rooms: [2], players: 2, bracket: 'losers', winnersTo: 2, losersTo: null }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, bracket: 'winners', winnersTo: 3, losersTo: null }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, bracket: 'grand-final', isFinal: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [], winners: [0, 2, 3], losers: [1] });
  });

  it('splits a double-elimination-shared-final schedule, identifying the untagged terminal Final round by isFinal + position', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, bracket: 'winners', winnersTo: 2, losersTo: 1 }),
      buildRound({ roundNum: 1, rooms: [2], players: 2, bracket: 'losers', winnersTo: 2, losersTo: null }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [], winners: [0, 2], losers: [1] });
  });

  it('degenerates to a single preBracket row, in original order, for single-elimination (no bracket field at all)', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0, isFinal: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [0, 1], winners: [], losers: [] });
  });

  it('degenerates to a single preBracket row for Kings Valley', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isKingsValley: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isKingsValley: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [0, 1], winners: [], losers: [] });
  });

  it('degenerates to a single preBracket row for a pooling-only schedule with no bracket phase', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [0, 1], winners: [], losers: [] });
  });

  it('captures only the leading pooling rounds in preBracket when a pooling phase feeds into a double-elimination bracket', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [4, 4], players: 8, bracket: 'winners', winnersTo: 4, losersTo: 3 }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, bracket: 'losers', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 4, rooms: [2], players: 2, bracket: 'grand-final', isFinal: true }),
    ];
    expect(bracketRowGroups({ rounds })).toEqual({ preBracket: [0, 1], winners: [2, 4], losers: [3] });
  });
});
