import { describe, expect, it } from 'vitest';
import {
  bracketBoxes,
  bracketFollowStatus,
  bracketRoundLabels,
  projectedSlotLabelText,
  projectFutureRoundSlots,
} from '../bracket';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentRound } from '../types';
import { buildRound } from './test-fixtures';

function project(rounds: TournamentRound[], curRound: number) {
  return projectFutureRoundSlots({ rounds, curRound });
}

describe('bracketRoundLabels', () => {
  it("labels a WB/LB round by its own roundNum, not a separate WB/LB-specific counter -- regression for a box header ('Round N') and its content (this label) citing different numbers", () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4 }), // pre-bracket, no bracket tag
      buildRound({ roundNum: 2, rooms: [4], players: 4 }), // pre-bracket, no bracket tag
      buildRound({ roundNum: 3, rooms: [3], players: 3, bracket: 'winners' }), // 1st WB round, but roundNum 3
      buildRound({ roundNum: 4, rooms: [2], players: 2, bracket: 'losers' }), // 1st LB round, but roundNum 4
    ];
    const labels = bracketRoundLabels({ rounds });
    expect(labels[2]).toEqual({ label: 'WB Round 3', accent: 'wb', roundNumber: 3 });
    expect(labels[3]).toEqual({ label: 'LB Round 4', accent: 'lb', roundNumber: 4 });
  });

  it('reads a waterfall round\'s own customLabel instead of a synthetic "Round N" label, prefixing the trophy emoji when it\'s also the Final', () => {
    const rounds = [
      buildRound({ roundNum: 3, rooms: [8], players: 8, isWaterfall: true, customLabel: 'SemiA' }),
      buildRound({
        roundNum: 4,
        rooms: [8],
        players: 8,
        isWaterfall: true,
        customLabel: 'Final',
        isFinal: true,
      }),
    ];
    const labels = bracketRoundLabels({ rounds });
    expect(labels[0]).toEqual({ label: 'SemiA', accent: '', roundNumber: 3 });
    expect(labels[1]).toEqual({ label: '🏆 Final', accent: '', roundNumber: 4 });
  });
});

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

  it("uses the source round's own roundNum for a WB losers-edge label, not a WB-specific counter, when a pre-bracket round shifts roundNum out of sync with it", () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, advPerRoom: 4, luckyCount: 0 }), // pre-bracket, no bracket tag
      buildRound({
        roundNum: 2,
        rooms: [2, 2],
        players: 4,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'winners',
        winnersTo: null,
        losersTo: 2,
      }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0, bracket: 'losers' }),
    ];
    const result = project(rounds, 0);
    expect(result[2]?.[0].map(projectedSlotLabelText)).toEqual([
      'Dropped from WB Round 2',
      'Dropped from WB Round 2',
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

  it('projects a waterfall band as rank-precise "Room X, Rank N", never collapsing to "Winner of Room X" even for a single-person band', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [4],
        players: 4,
        isWaterfall: true,
        customLabel: '5',
        waterfallRoutes: [[1, 'eliminated', 'eliminated', 'eliminated']], // only rank 1 routes onward
      }),
      buildRound({
        roundNum: 2,
        rooms: [1],
        players: 1,
        isWaterfall: true,
        customLabel: 'SemiA',
        isFinal: true,
      }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map((slot) => slot.kind)).toEqual(['waterfall-rank']);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual(['Room 1A, Rank 1']);
  });

  it('projects an N-way waterfall convergence with non-contiguous rank bands, tier-major across every contributing room', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [4, 4, 4],
        players: 12,
        isWaterfall: true,
        customLabel: '5',
        waterfallRoutes: [
          [1, 'eliminated', 'eliminated', 1], // room A: ranks 1 and 4 -> target
          [1, 1, 'eliminated', 'eliminated'], // room B: ranks 1 and 2 -> target
          ['eliminated', 'eliminated', 1, 'eliminated'], // room C: rank 3 -> target
        ],
      }),
      buildRound({ roundNum: 2, rooms: [5], players: 5, isWaterfall: true, customLabel: '6B' }),
    ];
    const result = project(rounds, 0);
    // Tier-major: rank 1 across A and B, then rank 2 (B only), rank 3 (C
    // only), rank 4 (A only) -- not room-major, and not a contiguous range.
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Room 1A, Rank 1',
      'Room 1B, Rank 1',
      'Room 1B, Rank 2',
      'Room 1C, Rank 3',
      'Room 1A, Rank 4',
    ]);
  });

  it('resolves a waterfall predecessor even when the source is not the immediately preceding round (a genuine skip-ahead target), and ignores an unrelated intervening waterfall round entirely', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [4],
        players: 4,
        isWaterfall: true,
        customLabel: '5',
        waterfallRoutes: [[2, 2, 'eliminated', 'eliminated']], // ranks 1-2 skip straight to index 2
      }),
      buildRound({
        roundNum: 2,
        rooms: [4],
        players: 4,
        isWaterfall: true,
        customLabel: '6B',
        waterfallRoutes: [[3, 3, 3, 3]], // routes elsewhere entirely -- not a predecessor of index 2
      }),
      buildRound({
        roundNum: 3,
        rooms: [2],
        players: 2,
        isWaterfall: true,
        customLabel: 'SemiA',
        isFinal: true,
      }),
    ];
    const result = project(rounds, 0);
    expect(result[2]?.[0].map(projectedSlotLabelText)).toEqual(['Room 1A, Rank 1', 'Room 1A, Rank 2']);
  });
});

describe('bracketBoxes', () => {
  it('groups a double-elimination (race) schedule into waves, each anchored on a winners round -- middle wave gets 2 trailing losers rounds, first/last get 1', () => {
    // Mirrors raceDoubleEliminationBracketPhase's real sequence shape for
    // winnersRoundCount=3: wb0, lb0, wb1, lb1, lb2, wb2, lb3, gf.
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, bracket: 'winners', winnersTo: 2, losersTo: 1 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, bracket: 'losers', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 3, rooms: [2, 2], players: 4, bracket: 'winners', winnersTo: 5, losersTo: 3 }),
      buildRound({ roundNum: 4, rooms: [4], players: 4, bracket: 'losers', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 5, rooms: [2], players: 2, bracket: 'losers', winnersTo: 5, losersTo: null }),
      buildRound({ roundNum: 6, rooms: [2], players: 2, bracket: 'winners', winnersTo: 6, losersTo: null }),
      buildRound({ roundNum: 7, rooms: [2], players: 2, bracket: 'losers', winnersTo: 6, losersTo: null }),
      buildRound({ roundNum: 8, rooms: [2], players: 2, bracket: 'grand-final', isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'wave', winnersRoundIndex: 0, losersRoundIndices: [1] },
      { kind: 'wave', winnersRoundIndex: 2, losersRoundIndices: [3, 4] },
      { kind: 'wave', winnersRoundIndex: 5, losersRoundIndices: [6] },
      { kind: 'single', roundIndex: 7 },
    ]);
  });

  it('handles the minimum 2-winners-round race bracket -- both rounds hit the "first or last" branch, so no middle (2-loser) wave exists', () => {
    // raceDoubleEliminationBracketPhase's minimum shape: wb0, lb0, wb1, lb1, gf.
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, bracket: 'winners', winnersTo: 2, losersTo: 1 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, bracket: 'losers', winnersTo: 2, losersTo: null }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, bracket: 'winners', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 4, rooms: [2], players: 2, bracket: 'losers', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 5, rooms: [2], players: 2, bracket: 'grand-final', isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'wave', winnersRoundIndex: 0, losersRoundIndices: [1] },
      { kind: 'wave', winnersRoundIndex: 2, losersRoundIndices: [3] },
      { kind: 'single', roundIndex: 4 },
    ]);
  });

  it('produces a wave with an empty losersRoundIndices when a shared-final schedule has two winners rounds back to back (a real, guaranteed-occurring shape, not hypothetical)', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, bracket: 'winners', winnersTo: 1, losersTo: null }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, bracket: 'winners', winnersTo: 2, losersTo: 2 }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, bracket: 'losers', winnersTo: 3, losersTo: null }),
      buildRound({ roundNum: 4, rooms: [4], players: 4, isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'wave', winnersRoundIndex: 0, losersRoundIndices: [] },
      { kind: 'wave', winnersRoundIndex: 1, losersRoundIndices: [2] },
      { kind: 'single', roundIndex: 3 },
    ]);
  });

  it("groups a double-elimination-shared-final schedule's ordinary case, identifying the untagged terminal Final round by isFinal + position", () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, bracket: 'winners', winnersTo: 2, losersTo: 1 }),
      buildRound({ roundNum: 1, rooms: [2], players: 2, bracket: 'losers', winnersTo: 2, losersTo: null }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'wave', winnersRoundIndex: 0, losersRoundIndices: [1] },
      { kind: 'single', roundIndex: 2 },
    ]);
  });

  it('degenerates to single boxes, in original order, for single-elimination (no bracket field at all)', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0, isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'single', roundIndex: 0 },
      { kind: 'single', roundIndex: 1 },
    ]);
  });

  it('degenerates to single boxes for Kings Valley', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isKingsValley: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isKingsValley: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'single', roundIndex: 0 },
      { kind: 'single', roundIndex: 1 },
    ]);
  });

  it('degenerates to single boxes for a pooling-only schedule with no bracket phase', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'single', roundIndex: 0 },
      { kind: 'single', roundIndex: 1 },
    ]);
  });

  it('leaves the leading pooling rounds as single boxes when a pooling phase feeds into a double-elimination bracket', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [4, 4], players: 8, bracket: 'winners', winnersTo: 4, losersTo: 3 }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, bracket: 'losers', winnersTo: 4, losersTo: null }),
      buildRound({ roundNum: 4, rooms: [2], players: 2, bracket: 'grand-final', isFinal: true }),
    ];
    expect(bracketBoxes({ rounds })).toEqual([
      { kind: 'single', roundIndex: 0 },
      { kind: 'single', roundIndex: 1 },
      { kind: 'wave', winnersRoundIndex: 2, losersRoundIndices: [3] },
      { kind: 'single', roundIndex: 4 },
    ]);
  });
});

// bracketFollowStatus and lastAssignedRound (rankings.ts) are pure functions
// of state.assignments/state.byes, with no round-type awareness at all -- the
// plan for this feature called for confirming that directly, against a
// waterfall-shaped fixture, rather than assuming it from reading the code.
describe('bracketFollowStatus — against a waterfall skip-ahead fixture', () => {
  it('follows a name across a round it never appeared in at all (a genuine skip-ahead gap), needing no round-type awareness', () => {
    const state = {
      assignments: [
        [{ name: 'P1', room: 2, isLucky: false }], // round 0 ("5")
        [{ name: 'P2', room: 1, isLucky: false }], // round 1 ("6B") -- P1 skipped this entirely
        [{ name: 'P1', room: 1, isLucky: false }], // round 2 ("SemiA") -- the skip-ahead destination
      ],
      byes: [[], [], []],
    };
    const status = bracketFollowStatus(state, 'P1');
    expect(status?.rounds).toEqual({ 0: { room: 2, isBye: false }, 2: { room: 1, isBye: false } });
    expect(status?.lastRi).toBe(2);
    expect(status?.room).toBe(1);
    expect(status?.eliminated).toBe(false);
  });

  it("marks eliminated once a unit's own lastRi falls behind the tournament's overall lastAssignedRound", () => {
    const state = {
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [{ name: 'P2', room: 1, isLucky: false }], // P1 didn't survive this round
      ],
      byes: [[], []],
    };
    const status = bracketFollowStatus(state, 'P1');
    expect(status?.lastRi).toBe(0);
    expect(status?.eliminated).toBe(true);
  });
});

describe('projectFutureRoundSlots -- fixed-draw rounds', () => {
  it('still projects the rounds after the pooling phase once a removal has patched the published rounds (an odd field gains byes there)', () => {
    const players = Array.from({ length: 11 }, (_, index) => `P${index + 1}`);
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 11, players }),
      createDefaultSetup({
        gameFormat: 'individual-1v1',
        poolingPhase: 'swiss',
        qualAdv: '4',
        oddCountStrategy: 'bye',
        drawPublication: 'fixed',
      }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error('generation failed');
    const removed = removeRosterUnit(result.state, 'P3');

    const projected = project(removed.rounds, removed.curRound);
    const firstBracketRound = removed.rounds.findIndex((round) => !round.isSwiss);
    expect(projected[firstBracketRound]?.flat().map((slot) => slot.kind)).toEqual(
      Array(4).fill('qualifier-cutoff'),
    );
    expect(projected[removed.rounds.length - 1]).not.toBeNull();
  });
});
