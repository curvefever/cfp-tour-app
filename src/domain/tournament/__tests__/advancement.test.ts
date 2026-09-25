import { describe, expect, it } from 'vitest';
import {
  buildAdvancementTiers,
  computeGroupStandings,
  computeLuckyLoserStandings,
  computeQualificationStandings,
  computeStandingsCutoffAdvancing,
  detectTieBreaks,
  doubleEliminationComputeAdvancement,
  hasPendingTies,
  invalidateStaleTieResolutions,
  isUncontestedRoom,
  isTieResolved,
  kingsValleyComputeAdvancement,
  rankStandings,
  roomBasedComputeAdvancement,
} from '../advancement';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { fairPoints } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentStanding, TournamentState } from '../types';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { buildAssignments, buildRound } from './test-fixtures';

describe('detectTieBreaks', () => {
  it('detects a tie on the multi-game total, not a single game score', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, numGames: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0-g1': 300,
        'r0-rm1-p0-g2': 200,
        'r0-rm1-p1-g1': 100,
        'r0-rm1-p1-g2': 400,
      },
    });
    const ties = detectTieBreaks(0, state.rounds[0], state);
    expect(Object.keys(ties)).toEqual(['r0-rm1-s500']);
    expect(ties['r0-rm1-s500'].players.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
  });

  it('does not report a tie when only a single game matches but totals differ', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, numGames: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0-g1': 300,
        'r0-rm1-p0-g2': 200,
        'r0-rm1-p1-g1': 300,
        'r0-rm1-p1-g2': 300,
      },
    });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });

  it('never reports a tie on the Final round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
    });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });
});

describe('isTieResolved / hasPendingTies', () => {
  const threeWayState = createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    rounds: [buildRound({ roundNum: 1, rooms: [3], players: 3 })],
    assignments: [
      [
        { name: 'P1', room: 1, isLucky: false },
        { name: 'P2', room: 1, isLucky: false },
        { name: 'P3', room: 1, isLucky: false },
      ],
    ],
    scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500, 'r0-rm1-p2': 500 },
  });

  it('requires K-1 resolutions for a K-way tie', () => {
    const ties = detectTieBreaks(0, threeWayState.rounds[0], threeWayState);
    const cluster = ties['r0-rm1-s500'];
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: {} })).toBe(false);
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: { 'r0-rm1-s500': ['P1'] } })).toBe(false);
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: { 'r0-rm1-s500': ['P1', 'P2'] } })).toBe(
      true,
    );
  });

  it('hasPendingTies flips from true to false once the tie is fully resolved', () => {
    const twoWayState = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
    });
    expect(hasPendingTies(twoWayState, 0)).toBe(true);
    const resolved = { ...twoWayState, tieResolutions: { 'r0-rm1-s500': ['P1'] } };
    expect(hasPendingTies(resolved, 0)).toBe(false);
  });
});

describe('invalidateStaleTieResolutions', () => {
  it('drops a resolution whose recorded cluster no longer exists at that key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      // P1 now scores 600, no longer tied with P2 at 500 -- the recorded
      // resolution for the old "r0-rm1-s500" cluster is now stale.
      scores: { 'r0-rm1-p0': 600, 'r0-rm1-p1': 500 },
      tieResolutions: { 'r0-rm1-s500': ['P1'] },
    });
    const result = invalidateStaleTieResolutions(state, 0, 1);
    expect(result.tieResolutions).toEqual({});
  });

  it('leaves a still-valid resolution untouched (same state reference, no change)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
      tieResolutions: { 'r0-rm1-s500': ['P1'] },
    });
    expect(invalidateStaleTieResolutions(state, 0, 1)).toBe(state);
  });
});

describe('computeQualificationStandings', () => {
  it('orders standings ascending by fairPoints across independent rooms', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table' },
      rounds: [buildRound({ roundNum: 1, isQual: true, rooms: [2, 2], players: 4 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      // room1: P1=100 (rank1), P2=50 (rank2). room2: P3=200 (rank1), P4=10 (rank2).
      // fairPoints(1,200) < fairPoints(1,100) < fairPoints(2,50) < fairPoints(2,10).
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 200, 'r0-rm2-p1': 10 },
    });
    expect(computeQualificationStandings(state).map((entry) => entry.name)).toEqual(['P3', 'P1', 'P2', 'P4']);
  });

  it('averages fairPoints across rounds played instead of summing, so a stronger multi-round record outranks a single lucky round', () => {
    // G plays 3 rounds: rank1, rank1, rank2 (strong, one slip).
    // H only plays the final round (e.g. joined late as a reserve): rank2, once.
    // H's raw SUM (one round) is smaller than G's SUM (three rounds) even
    // though G's actual rate of performance is clearly better -- averaging
    // is what correctly ranks G ahead of H.
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['G', 'H', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
      cfg: { poolingPhase: 'qual-table' },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 3, isQual: true, rooms: [4, 4], players: 8 }),
      ],
      assignments: [
        buildAssignments(['G', 'Y1', 'Y2', 'Y3'], [4]),
        buildAssignments(['G', 'Y1', 'Y2', 'Y3'], [4]),
        buildAssignments(['Y1', 'G', 'Y2', 'Y3', 'Y4', 'H', 'Y5', 'Y6'], [4, 4]),
      ],
      scores: {
        'r0-rm1-p0': 400,
        'r0-rm1-p1': 300,
        'r0-rm1-p2': 200,
        'r0-rm1-p3': 100,
        'r1-rm1-p0': 400,
        'r1-rm1-p1': 300,
        'r1-rm1-p2': 200,
        'r1-rm1-p3': 100,
        'r2-rm1-p0': 400,
        'r2-rm1-p1': 300,
        'r2-rm1-p2': 200,
        'r2-rm1-p3': 100,
        'r2-rm2-p0': 400,
        'r2-rm2-p1': 300,
        'r2-rm2-p2': 200,
        'r2-rm2-p3': 100,
      },
    });
    const standings = computeQualificationStandings(state);
    const g = standings.find((entry) => entry.name === 'G');
    const h = standings.find((entry) => entry.name === 'H');
    expect(g?.played).toBe(3);
    expect(h?.played).toBe(1);
    // Sanity check the raw sums would have flipped this the other way.
    expect((g?.totalFP as number) * 3).toBeGreaterThan((h?.totalFP as number) * 1);
    expect(g?.totalFP).toBeLessThan(h?.totalFP as number);
    expect(standings.findIndex((entry) => entry.name === 'G')).toBeLessThan(
      standings.findIndex((entry) => entry.name === 'H'),
    );
  });

  it('excludes a round flagged excludeFromStandings from both the count of rounds played and the averaged fairPoints, even though it was actually played', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      cfg: { poolingPhase: 'qual-table' },
      rounds: [
        // Round 1 is a non-counting round: P1 finishes last (rank2) here, a
        // real result -- but it must never enter the average.
        buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2, excludeFromStandings: true }),
        buildRound({ roundNum: 2, isQual: true, rooms: [2], players: 2 }),
      ],
      assignments: [buildAssignments(['P1', 'P2'], [2]), buildAssignments(['P1', 'P2'], [2])],
      scores: {
        'r0-rm1-p0': 10, // P1: rank 2 (worst) in the excluded round.
        'r0-rm1-p1': 100, // P2: rank 1 in the excluded round.
        'r1-rm1-p0': 100, // P1: rank 1 in the counted round.
        'r1-rm1-p1': 10, // P2: rank 2 in the counted round.
      },
    });
    const standings = computeQualificationStandings(state);
    const p1 = standings.find((entry) => entry.name === 'P1');
    const p2 = standings.find((entry) => entry.name === 'P2');
    // Each unit only has ONE round counted, not two.
    expect(p1?.played).toBe(1);
    expect(p2?.played).toBe(1);
    // If the excluded round's rank-2 result leaked into the average, P1
    // would rank behind P2 here instead of ahead.
    expect(p1?.totalFP).toBe(fairPoints(1, 100));
    expect(p2?.totalFP).toBe(fairPoints(2, 10));
    expect(standings.findIndex((entry) => entry.name === 'P1')).toBeLessThan(
      standings.findIndex((entry) => entry.name === 'P2'),
    );
  });
});

describe('computeQualificationStandings -- positional-points scoring', () => {
  it('uses the positional-points table instead of fairPoints, sorted descending (highest points first)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table' },
      gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: [10, 8, 6, 5] },
      rounds: [buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 })],
      assignments: [buildAssignments(['P1', 'P2', 'P3', 'P4'], [4])],
      // P4=400 (rank1, 10pts), P2=300 (rank2, 8pts), P1=200 (rank3, 6pts), P3=100 (rank4, 5pts).
      scores: { 'r0-rm1-p0': 200, 'r0-rm1-p1': 300, 'r0-rm1-p2': 100, 'r0-rm1-p3': 400 },
    });
    const standings = computeQualificationStandings(state);
    expect(standings.map((entry) => entry.name)).toEqual(['P4', 'P2', 'P1', 'P3']);
    expect(standings.map((entry) => entry.totalFP)).toEqual([10, 8, 6, 5]);
  });

  it('sums positional points across rounds instead of averaging like fairPoints, so more rounds played at equal performance yields more total points', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['G', 'H', 'Y1', 'Y2'],
      cfg: { poolingPhase: 'qual-table' },
      gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: [10, 8] },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [2, 2], players: 4 }),
      ],
      assignments: [buildAssignments(['G', 'Y1'], [2]), buildAssignments(['G', 'Y1', 'H', 'Y2'], [2, 2])],
      scores: {
        'r0-rm1-p0': 100, // G rank1
        'r0-rm1-p1': 10, // Y1 rank2
        'r1-rm1-p0': 100, // G rank1
        'r1-rm1-p1': 10, // Y1 rank2
        'r1-rm2-p0': 100, // H rank1
        'r1-rm2-p1': 10, // Y2 rank2
      },
    });
    const standings = computeQualificationStandings(state);
    const g = standings.find((entry) => entry.name === 'G');
    const h = standings.find((entry) => entry.name === 'H');
    expect(g?.played).toBe(2);
    expect(h?.played).toBe(1);
    expect(g?.totalFP).toBe(20);
    expect(h?.totalFP).toBe(10);
    expect(standings.findIndex((entry) => entry.name === 'G')).toBeLessThan(
      standings.findIndex((entry) => entry.name === 'H'),
    );
  });
});

describe('roomBasedComputeAdvancement -- positional-points scoring', () => {
  it('advances the highest-points units at a qualification cutoff, not the lowest (descending-order regression guard)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: [10, 8, 6, 5] },
      rounds: [buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 })],
      assignments: [buildAssignments(['P1', 'P2', 'P3', 'P4'], [4])],
      // P4=400 (rank1, 10pts), P2=300 (rank2, 8pts), P1=200 (rank3, 6pts), P3=100 (rank4, 5pts).
      scores: { 'r0-rm1-p0': 200, 'r0-rm1-p1': 300, 'r0-rm1-p2': 100, 'r0-rm1-p3': 400 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.advancing.map((unit) => unit.name)).toEqual(['P4', 'P2']);
  });
});

describe('computeGroupStandings', () => {
  it('partitions standings by group, independently of overall performance', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      groups: [
        { label: 'A', members: ['P1', 'P2'] },
        { label: 'B', members: ['P3', 'P4'] },
      ],
      rounds: [
        buildRound({
          roundNum: 1,
          isGroupStage: true,
          rooms: [2, 2],
          roomGroups: ['A', 'B'],
          players: 4,
        }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 5, 'r0-rm2-p1': 1 },
    });
    const standings = computeGroupStandings(state);
    expect(standings.A.map((entry) => entry.name)).toEqual(['P1', 'P2']);
    expect(standings.B.map((entry) => entry.name)).toEqual(['P3', 'P4']);
  });

  it('averages fairPoints across rounds played, same as the qualification-table path, since both share materializeStandings', () => {
    // G plays both rounds (rank1, then rank2). H only plays round 2 (a
    // round-robin bye left them out of round 1) with a single rank1 result.
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      groups: [{ label: 'A', members: ['G', 'H', 'Y1', 'Y2'] }],
      rounds: [
        buildRound({ roundNum: 1, isGroupStage: true, rooms: [3], roomGroups: ['A'], players: 3 }),
        buildRound({ roundNum: 2, isGroupStage: true, rooms: [3], roomGroups: ['A'], players: 3 }),
      ],
      assignments: [buildAssignments(['G', 'Y1', 'Y2'], [3]), buildAssignments(['H', 'G', 'Y1'], [3])],
      scores: {
        'r0-rm1-p0': 300,
        'r0-rm1-p1': 200,
        'r0-rm1-p2': 100,
        'r1-rm1-p0': 300,
        'r1-rm1-p1': 200,
        'r1-rm1-p2': 100,
      },
    });
    const standings = computeGroupStandings(state).A;
    const g = standings.find((entry) => entry.name === 'G');
    const h = standings.find((entry) => entry.name === 'H');
    expect(g?.played).toBe(2);
    expect(h?.played).toBe(1);
    // G: (fp(1,300) + fp(2,200)) / 2. H: fp(1,300) / 1.
    expect(g?.totalFP).toBeCloseTo((0.997 + 1.998) / 2, 5);
    expect(h?.totalFP).toBeCloseTo(0.997, 5);
  });

  it('sums positional points (not averaged) within a group, sorted descending', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      groups: [{ label: 'A', members: ['G', 'H', 'Y1'] }],
      gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: [10, 8, 6] },
      rounds: [
        buildRound({ roundNum: 1, isGroupStage: true, rooms: [3], roomGroups: ['A'], players: 3 }),
        buildRound({ roundNum: 2, isGroupStage: true, rooms: [3], roomGroups: ['A'], players: 3 }),
      ],
      assignments: [buildAssignments(['G', 'Y1', 'H'], [3]), buildAssignments(['G', 'H', 'Y1'], [3])],
      scores: {
        // Round 1: G rank1 (10), Y1 rank2 (8), H rank3 (6).
        'r0-rm1-p0': 300,
        'r0-rm1-p1': 200,
        'r0-rm1-p2': 100,
        // Round 2: G rank1 (10), H rank2 (8), Y1 rank3 (6).
        'r1-rm1-p0': 300,
        'r1-rm1-p1': 200,
        'r1-rm1-p2': 100,
      },
    });
    const standings = computeGroupStandings(state).A;
    // G: 10+10=20. H: 6+8=14. Y1: 8+6=14 -- tied with H, stable order preserved.
    expect(standings.map((entry) => entry.name)).toEqual(['G', 'H', 'Y1']);
    expect(standings.map((entry) => entry.totalFP)).toEqual([20, 14, 14]);
  });
});

describe('roomBasedComputeAdvancement', () => {
  it('excludes an all-zero-score room from lucky-loser candidacy even though it structurally qualifies', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({ roundNum: 1, rooms: [8, 8], advPerRoom: 6, luckyCount: 1, advTotal: 13, players: 16 }),
      ],
      assignments: [
        [
          ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((name) => ({
            name,
            room: 1,
            isLucky: false,
          })),
          ...['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'].map((name) => ({
            name,
            room: 2,
            isLucky: false,
          })),
        ],
      ],
      scores: {
        'r0-rm1-p0': 800,
        'r0-rm1-p1': 700,
        'r0-rm1-p2': 600,
        'r0-rm1-p3': 500,
        'r0-rm1-p4': 400,
        'r0-rm1-p5': 300,
        'r0-rm1-p6': 200,
        'r0-rm1-p7': 100,
        'r0-rm2-p0': 0,
        'r0-rm2-p1': 0,
        'r0-rm2-p2': 0,
        'r0-rm2-p3': 0,
        'r0-rm2-p4': 0,
        'r0-rm2-p5': 0,
        'r0-rm2-p6': 0,
        'r0-rm2-p7': 0,
      },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    // Room 2's candidate (Q7) sits at the boundary too, but its room total is
    // 0, so it's excluded rather than dividing by zero -- P7 is the only
    // lucky loser even though both rooms "structurally" have a candidate.
    expect(result.luckyNames).toEqual(['P7']);
  });

  it('picks the top-luckyCount candidates by relative (pct) score across rooms', () => {
    const buildRoomAssignments = (prefix: string, room: number) =>
      Array.from({ length: 8 }, (_, index) => ({ name: `${prefix}${index + 1}`, room, isLucky: false }));
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [8, 8, 8],
          advPerRoom: 6,
          luckyCount: 2,
          advTotal: 20,
          players: 24,
        }),
      ],
      assignments: [
        [...buildRoomAssignments('P', 1), ...buildRoomAssignments('Q', 2), ...buildRoomAssignments('R', 3)],
      ],
      scores: {
        // Room 1 (P): candidate P7=150, total=2900, pct~=0.0517 (highest)
        'r0-rm1-p0': 700,
        'r0-rm1-p1': 600,
        'r0-rm1-p2': 500,
        'r0-rm1-p3': 400,
        'r0-rm1-p4': 300,
        'r0-rm1-p5': 200,
        'r0-rm1-p6': 150,
        'r0-rm1-p7': 50,
        // Room 2 (Q): candidate Q7=50, total=2760, pct~=0.0181 (lowest)
        'r0-rm2-p0': 700,
        'r0-rm2-p1': 600,
        'r0-rm2-p2': 500,
        'r0-rm2-p3': 400,
        'r0-rm2-p4': 300,
        'r0-rm2-p5': 200,
        'r0-rm2-p6': 50,
        'r0-rm2-p7': 10,
        // Room 3 (R): candidate R7=100, total=2890, pct~=0.0346 (middle)
        'r0-rm3-p0': 700,
        'r0-rm3-p1': 600,
        'r0-rm3-p2': 500,
        'r0-rm3-p3': 400,
        'r0-rm3-p4': 300,
        'r0-rm3-p5': 200,
        'r0-rm3-p6': 100,
        'r0-rm3-p7': 90,
      },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.luckyNames).toEqual(['P7', 'R7']);
  });

  it('advances everyone in a no-elim round regardless of luckyCount', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isNoElim: true, rooms: [3], advTotal: 3, players: 3 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.advancing.map((entry) => entry.name)).toEqual(['P1', 'P2', 'P3']);
    expect(result.luckyNames).toEqual([]);
  });

  it('at a qualification-table cutoff, slices the fairPoints-ordered standings to qualAdv', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, isQual: false, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.advancing).toEqual([
      { name: 'P1', isLucky: false },
      { name: 'P2', isLucky: false },
    ]);
    expect(result.luckyNames).toBeNull();
    expect(result.qualTable).toHaveLength(4);
  });

  it('at a group-stage handoff, interleaves cross-group qualifiers by finish tier', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      cfg: { qualifiersPerGroup: 2 },
      groups: [
        { label: 'A', members: ['P1', 'P2'] },
        { label: 'B', members: ['P3', 'P4'] },
      ],
      rounds: [
        buildRound({
          roundNum: 1,
          isGroupStage: true,
          rooms: [2, 2],
          roomGroups: ['A', 'B'],
          players: 4,
        }),
        buildRound({ roundNum: 2, isGroupStage: false, rooms: [4], players: 4 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      // Group A: P1 beats P2. Group B: P4 beats P3 (P4's fairPoints will beat P1's).
      scores: { 'r0-rm1-p0': 50, 'r0-rm1-p1': 10, 'r0-rm2-p0': 5, 'r0-rm2-p1': 100 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    // Tier 1 (rank-1 finishers, sorted among themselves by fairPoints) first,
    // then tier 2 (rank-2 finishers) -- never clustered by group.
    expect(result.advancing.map((entry) => entry.name)).toEqual(['P4', 'P1', 'P2', 'P3']);
  });
});

describe('computeStandingsCutoffAdvancing', () => {
  it('returns the real cutoff advancing set for the last qualification-table round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, isQual: false, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toEqual(new Set(['P1', 'P2']));
  });

  it('returns the real cutoff advancing set for the last group-stage round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      cfg: { qualifiersPerGroup: 2 },
      groups: [
        { label: 'A', members: ['P1', 'P2'] },
        { label: 'B', members: ['P3', 'P4'] },
      ],
      rounds: [
        buildRound({
          roundNum: 1,
          isGroupStage: true,
          rooms: [2, 2],
          roomGroups: ['A', 'B'],
          players: 4,
        }),
        buildRound({ roundNum: 2, isGroupStage: false, rooms: [4], players: 4 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 50, 'r0-rm1-p1': 10, 'r0-rm2-p0': 5, 'r0-rm2-p1': 100 },
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toEqual(new Set(['P1', 'P2', 'P3', 'P4']));
  });

  it('returns null for an ordinary no-elim round (nobody is cut by a cross-round cutoff)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isNoElim: true, rooms: [3], advTotal: 3, players: 3 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 },
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toBeNull();
  });

  it('returns null for an ordinary elimination round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [4], advPerRoom: 2, luckyCount: 0, players: 4 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toBeNull();
  });

  it('returns null for a Kings Valley round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [4],
          players: 4,
          isKingsValley: true,
          kvPromoteCounts: [1],
          kvDemoteCounts: [0],
          kvEliminateCount: 1,
        }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toBeNull();
  });

  it('returns null for a Final round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
    });
    expect(computeStandingsCutoffAdvancing(state, 0)).toBeNull();
  });
});

describe('doubleEliminationComputeAdvancement', () => {
  it('routes the top advPerRoom per room to winners and the rest to losers', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [4], advPerRoom: 2, luckyCount: 0, bracket: 'winners' })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
    const result = doubleEliminationComputeAdvancement(state, 0);
    expect(result.winners.map((entry) => entry.name)).toEqual(['P1', 'P2']);
    expect(result.losers.map((entry) => entry.name)).toEqual(['P3', 'P4']);
    expect(result.luckyNames).toEqual([]);
  });

  it('excludes a lucky-loser winner from the losers list (promoted, not double-counted)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [8, 8],
          advPerRoom: 6,
          luckyCount: 1,
          bracket: 'winners',
          players: 16,
        }),
      ],
      assignments: [
        [
          ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((name) => ({
            name,
            room: 1,
            isLucky: false,
          })),
          ...['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'].map((name) => ({
            name,
            room: 2,
            isLucky: false,
          })),
        ],
      ],
      scores: {
        'r0-rm1-p0': 800,
        'r0-rm1-p1': 700,
        'r0-rm1-p2': 600,
        'r0-rm1-p3': 500,
        'r0-rm1-p4': 400,
        'r0-rm1-p5': 300,
        'r0-rm1-p6': 250,
        'r0-rm1-p7': 50,
        'r0-rm2-p0': 800,
        'r0-rm2-p1': 700,
        'r0-rm2-p2': 600,
        'r0-rm2-p3': 500,
        'r0-rm2-p4': 400,
        'r0-rm2-p5': 300,
        'r0-rm2-p6': 10,
        'r0-rm2-p7': 5,
      },
    });
    const result = doubleEliminationComputeAdvancement(state, 0);
    expect(result.luckyNames).toEqual(['P7']);
    expect(result.winners.map((entry) => entry.name)).toContain('P7');
    expect(result.losers.map((entry) => entry.name)).not.toContain('P7');
    expect(result.losers.map((entry) => entry.name)).toEqual(['P8', 'Q7', 'Q8']);
  });
});

describe('computeLuckyLoserStandings', () => {
  it("ranks each room's near-miss candidate by score share of their own room total, leading = top luckyCount", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [3, 3, 3], players: 9, advPerRoom: 1, luckyCount: 1 })],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 2, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 3, isLucky: false },
          { name: 'H', room: 3, isLucky: false },
          { name: 'I', room: 3, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90, // candidate: 90/200 = 0.45
        'r0-rm1-p2': 10,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 95, // candidate: 95/200 = 0.475 — leading
        'r0-rm2-p2': 5,
        'r0-rm3-p0': 50,
        'r0-rm3-p1': 10, // candidate: 10/61 ≈ 0.164
        'r0-rm3-p2': 1,
      },
    });
    const standings = computeLuckyLoserStandings(state, 0);
    expect(standings?.map((entry) => entry.name)).toEqual(['E', 'B', 'H']);
    expect(standings?.map((entry) => entry.leading)).toEqual([true, false, false]);
    expect(standings?.[0].room).toBe(2);
    expect(standings?.[0].pct).toBeCloseTo(0.475);
  });

  it('returns null for isNoElim, isFinal, and zero-luckyCount rounds', () => {
    const base = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      assignments: [[{ name: 'A', room: 1, isLucky: false }]],
      scores: { 'r0-rm1-p0': 100 },
    });
    expect(
      computeLuckyLoserStandings(
        { ...base, rounds: [buildRound({ roundNum: 1, rooms: [1], isNoElim: true, luckyCount: 1 })] },
        0,
      ),
    ).toBeNull();
    expect(
      computeLuckyLoserStandings(
        { ...base, rounds: [buildRound({ roundNum: 1, rooms: [1], isFinal: true, luckyCount: 1 })] },
        0,
      ),
    ).toBeNull();
    expect(
      computeLuckyLoserStandings(
        { ...base, rounds: [buildRound({ roundNum: 1, rooms: [1], luckyCount: 0 })] },
        0,
      ),
    ).toBeNull();
  });

  it('excludes a room with zero total score instead of including it as non-leading', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2, 2], players: 4, advPerRoom: 1, luckyCount: 1 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 0,
        'r0-rm1-p1': 0,
        'r0-rm2-p0': 10,
        'r0-rm2-p1': 5,
      },
    });
    const standings = computeLuckyLoserStandings(state, 0);
    expect(standings).toHaveLength(1);
    expect(standings?.[0].name).toBe('P4');
    expect(standings?.[0].leading).toBe(true);
  });

  it('applies identically to a double-elimination losers-bracket round — no bracket-side branching needed', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [3, 3, 3],
          players: 9,
          advPerRoom: 1,
          luckyCount: 1,
          bracket: 'losers',
        }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 2, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 3, isLucky: false },
          { name: 'H', room: 3, isLucky: false },
          { name: 'I', room: 3, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 10,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 95,
        'r0-rm2-p2': 5,
        'r0-rm3-p0': 50,
        'r0-rm3-p1': 10,
        'r0-rm3-p2': 1,
      },
    });
    const standings = computeLuckyLoserStandings(state, 0);
    expect(standings?.map((entry) => entry.name)).toEqual(['E', 'B', 'H']);
    expect(standings?.map((entry) => entry.leading)).toEqual([true, false, false]);
  });
});

describe('kingsValleyComputeAdvancement', () => {
  it('merges a 3-room round exactly per the hand-derived promote/stay/demote-or-eliminate bands', () => {
    // Room1(top) 4: A>B>C>D. Room2 4: E>F>G>H. Room3(bottom) 4: I>J>K>L.
    // promote=1/demote=1 for rooms 1-2; room3 promote=1/eliminate=2.
    // Room1_next = own-promote[A] + own-stay[B,C] + room2-promote-inflow[E]
    // Room2_next = room1-demote-inflow[D] + own-stay[F,G] + room3-promote-inflow[I]
    // Room3_next = room2-demote-inflow[H] + own-stay[J]  (room3's own promote/eliminate excluded)
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [4, 4, 4],
          players: 12,
          isKingsValley: true,
          kvPromoteCounts: [1, 1, 1],
          kvDemoteCounts: [1, 1, 0],
          kvEliminateCount: 2,
        }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 1, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 2, isLucky: false },
          { name: 'H', room: 2, isLucky: false },
          { name: 'I', room: 3, isLucky: false },
          { name: 'J', room: 3, isLucky: false },
          { name: 'K', room: 3, isLucky: false },
          { name: 'L', room: 3, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 80,
        'r0-rm1-p3': 70,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
        'r0-rm2-p2': 80,
        'r0-rm2-p3': 70,
        'r0-rm3-p0': 100,
        'r0-rm3-p1': 90,
        'r0-rm3-p2': 80,
        'r0-rm3-p3': 70,
      },
    });
    const { nextRoomOrder, eliminatedNames } = kingsValleyComputeAdvancement(state, 0);
    expect(nextRoomOrder).toEqual(['A', 'B', 'C', 'E', 'D', 'F', 'G', 'I', 'H', 'J']);
    expect(eliminatedNames).toEqual(['K', 'L']);
  });

  it("redirects the top room's own promote band to the front of its own next-round list (not dropped), and the bottom room gets no inflow from below", () => {
    // Room1(top) 4: A>B>C>D. Room2(bottom) 4: E>F>G>H.
    // promote=1/demote=1 for room1; room2 promote=1/eliminate=2.
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [4, 4],
          players: 8,
          isKingsValley: true,
          kvPromoteCounts: [1, 1],
          kvDemoteCounts: [1, 0],
          kvEliminateCount: 2,
        }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 1, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 2, isLucky: false },
          { name: 'H', room: 2, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 80,
        'r0-rm1-p3': 70,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
        'r0-rm2-p2': 80,
        'r0-rm2-p3': 70,
      },
    });
    const { nextRoomOrder, eliminatedNames } = kingsValleyComputeAdvancement(state, 0);
    // A (room1's own promote band) leads, followed by room1's stay band, then
    // room2's promote band feeding in from below; then room1's demote band
    // feeding room2, then room2's own stay band, with no room-3 inflow.
    expect(nextRoomOrder).toEqual(['A', 'B', 'C', 'E', 'D', 'F']);
    expect(eliminatedNames).toEqual(['G', 'H']);
  });
});

describe('buildAdvancementTiers', () => {
  it('groups by room-rank position, tie-broken by pct within a rank -- never comparing pct across ranks', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isNoElim: true })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 10, 'r0-rm2-p1': 90 },
    });
    // Room 1: P1=100 (rank0, pct 100/150=.667), P2=50 (rank1, pct .333).
    // Room 2: sorted desc -> P4=90 (rank0, pct 90/100=.9), P3=10 (rank1, pct .1).
    const tiers = buildAdvancementTiers(state, 0, ['P1', 'P2', 'P3', 'P4']);
    expect(tiers.map((tier) => tier.rank)).toEqual([0, 1]);
    // Rank 0: P4's pct (.9) beats P1's (.667) -- both are room winners, only
    // their OWN room's pct decides tiebreak order between them.
    expect(tiers[0].members.map((member) => member.name)).toEqual(['P4', 'P1']);
    expect(tiers[0].members[0].pct).toBeCloseTo(0.9);
    expect(tiers[0].members[1].pct).toBeCloseTo(100 / 150);
    // Rank 1: P2's pct (.333) beats P3's (.1).
    expect(tiers[1].members.map((member) => member.name)).toEqual(['P2', 'P3']);
  });

  it('keeps a lucky loser at their real room-rank position instead of dropping them', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [3], players: 3, advPerRoom: 1, luckyCount: 1 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm1-p2': 10 },
    });
    // Only P1 (direct qualifier, rank0) and P3 (a lucky loser who actually
    // finished 3rd/rank2) are in the advancing list -- P2 (rank1) did not
    // advance at all, so rank1 has no tier.
    const tiers = buildAdvancementTiers(state, 0, ['P1', 'P3']);
    expect(tiers.map((tier) => tier.rank)).toEqual([0, 2]);
    expect(tiers[0].members.map((member) => member.name)).toEqual(['P1']);
    expect(tiers[1].members.map((member) => member.name)).toEqual(['P3']);
  });

  it('folds a carried-over bye (present in `names` but absent from every room) into rank 0 with pct 1', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isNoElim: true })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
      byes: [['P5']],
    });
    const tiers = buildAdvancementTiers(state, 0, ['P1', 'P2', 'P5']);
    expect(tiers.map((tier) => tier.rank)).toEqual([0, 1]);
    // P5 (pct 1, a bye "beats" everyone by construction) sorts ahead of P1
    // (real room winner, pct .667) within rank 0.
    expect(tiers[0].members.map((member) => member.name)).toEqual(['P5', 'P1']);
    const bye = tiers[0].members.find((member) => member.name === 'P5');
    expect(bye?.pct).toBe(1);
    expect(bye?.sourceRoom).toBe(0);
    expect(tiers[1].members.map((member) => member.name)).toEqual(['P2']);
  });
});

describe('rankStandings', () => {
  function standing(name: string, totalFP: number | null): TournamentStanding {
    return { name, totalFP, totalScore: 0, played: totalFP === null ? 0 : 1 };
  }

  it('assigns plain sequential ranks when nobody is tied', () => {
    const entries = [standing('P1', 1), standing('P2', 2), standing('P3', 3)];
    expect(rankStandings(entries).map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('gives a tie a shared rank, and the next distinct entry correctly skips ahead', () => {
    const entries = [
      standing('P1', 1),
      standing('P2', 2),
      standing('P3', 2),
      standing('P4', 2),
      standing('P5', 5),
    ];
    expect(rankStandings(entries).map((entry) => entry.rank)).toEqual([1, 2, 2, 2, 5]);
  });

  it('gives an entry with no rounds played (totalFP null) a null rank instead of a sequential number', () => {
    const entries = [standing('P1', 1), standing('P2', null), standing('P3', null)];
    expect(rankStandings(entries).map((entry) => entry.rank)).toEqual([1, null, null]);
  });
});

describe('uncontested rooms (a room with exactly one assigned unit is not a match)', () => {
  type SetupOverrides = Parameters<typeof createDefaultSetup>[0];

  function generate(count: number, setup: SetupOverrides, teams = false): TournamentState {
    const players = teams
      ? Array.from({ length: count }, (_, index) => ({
          teamId: `t${index + 1}`,
          teamName: `Team ${index + 1}`,
          members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
        }))
      : Array.from({ length: count }, (_, index) => `P${index + 1}`);
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players }),
      createDefaultSetup(setup),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
    return result.state;
  }

  /** Scores every occupied room of `roundIndex`: first listed unit highest. */
  function scoreRound(state: TournamentState, roundIndex: number): TournamentState {
    const scores = { ...state.scores };
    const seen = new Map<number, number>();
    for (const entry of state.assignments[roundIndex]) {
      if (entry.room === null) continue;
      const position = seen.get(entry.room) ?? 0;
      seen.set(entry.room, position + 1);
      const value = 1000 - position * 100;
      if (state.gameFormat.startsWith('team')) {
        for (let member = 0; member < 3; member += 1) {
          scores[`r${roundIndex}-rm${entry.room}-p${position}-m${member}`] = value;
        }
      } else {
        scores[`r${roundIndex}-rm${entry.room}-p${position}`] = value;
      }
    }
    return { ...state, scores };
  }

  function advance(state: TournamentState): TournamentState {
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    return result.state;
  }

  /** The first room of a round with two units, and the unit that is left alone once one is removed. */
  function pairRoom(state: TournamentState, roundIndex: number) {
    const room = state.assignments[roundIndex].find(
      (entry) =>
        entry.room !== null &&
        state.assignments[roundIndex].filter((other) => other.room === entry.room).length === 2,
    )?.room as number;
    const [removed, lone] = state.assignments[roundIndex]
      .filter((entry) => entry.room === room)
      .map((entry) => entry.name);
    return { room, removed, lone };
  }

  const standingOf = (state: TournamentState, name: string) =>
    computeQualificationStandings(state).find((entry) => entry.name === name);

  it('isUncontestedRoom counts assigned units, not scored ones', () => {
    const state = createDefaultTournamentState({
      rounds: [buildRound({ roundNum: 1, rooms: [1, 2], players: 3 })],
      assignments: [buildAssignments(['A', 'B', 'C'], [1, 2])],
      scores: { 'r0-rm2-p0': 5 },
    });
    expect(isUncontestedRoom(state, 0, 1)).toBe(true);
    expect(isUncontestedRoom(state, 0, 2)).toBe(false);
    expect(isUncontestedRoom(state, 0, 3)).toBe(false);
  });

  it('adaptive Swiss (11 players): a unit left alone by a removal keeps its earlier standing, gains no round from a typed score, and still advances', () => {
    let live = advance(
      scoreRound(
        generate(11, {
          gameFormat: 'individual-1v1',
          poolingPhase: 'swiss',
          qualAdv: '4',
          oddCountStrategy: 'bye',
        }),
        0,
      ),
    );
    const { room, removed, lone } = pairRoom(live, 1);
    const before = standingOf(live, lone);
    expect(before?.played).toBe(1);

    live = removeRosterUnit(live, removed);
    expect(live.assignments[1].filter((entry) => entry.room === room)).toHaveLength(1);
    live = scoreRound(live, 1);
    const after = standingOf(live, lone);
    expect(after?.played).toBe(1);
    expect(after?.totalFP).toBe(before?.totalFP);

    live = advance(live);
    expect(live.assignments[2].map((entry) => entry.name)).toContain(lone);
  });

  it('group stage (9 players): a lone unit is left out of the group standings for that round', () => {
    let live = generate(9, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      qualAdv: '4',
      groupSize: '4',
      oddCountStrategy: 'bye',
    });
    const { removed, lone } = pairRoom(live, 0);
    live = removeRosterUnit(live, removed);
    live = scoreRound(live, 0);
    const entry = Object.values(computeGroupStandings(live))
      .flat()
      .find((standing) => standing.name === lone);
    expect(entry?.played).toBe(0);
    expect(entry?.totalFP).toBeNull();
  });

  it('team-3v3v3 qualification table (13 teams): a 2-team room reduced to one team is excluded from standings', () => {
    let live = generate(13, { gameFormat: 'team-3v3v3', poolingPhase: 'qual-table', qualAdv: '6' }, true);
    const { removed, lone } = pairRoom(live, 0);
    live = scoreRound(removeRosterUnit(live, removed), 0);
    expect(standingOf(live, lone)?.played).toBe(0);
    expect(standingOf(live, lone)?.totalFP).toBeNull();
  });

  it.each([
    ['fairpoints', {}],
    ['positional-points', { scoring: 'positional-points' as const, positionalPointsTable: '10,8' }],
  ])(
    'qualification table 1v1 (11 players, odd-count strategy unset, so one unit starts alone) with %s: the lone unit gets no result for that round',
    (_label, scoringSetup) => {
      let live = generate(11, {
        gameFormat: 'individual-1v1',
        poolingPhase: 'qual-table',
        qualAdv: '4',
        ...scoringSetup,
      });
      const alone = live.assignments[0].filter(
        (entry) =>
          entry.room !== null &&
          live.assignments[0].filter((other) => other.room === entry.room).length === 1,
      );
      expect(alone).toHaveLength(1);
      live = scoreRound(live, 0);
      const standing = standingOf(live, alone[0].name);
      expect(standing?.played).toBe(0);
      expect(standing?.totalFP).toBeNull();
      expect(computeQualificationStandings(live).filter((entry) => entry.played === 1)).toHaveLength(10);
    },
  );

  it('a two-unit room with one score missing is still a normal match: the scored unit still ranks (regression)', () => {
    let live = generate(11, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      qualAdv: '4',
      oddCountStrategy: 'bye',
    });
    const { room, removed, lone } = pairRoom(live, 0);
    live = scoreRound(live, 0);
    const position = live.assignments[0]
      .filter((entry) => entry.room === room)
      .findIndex((entry) => entry.name === removed);
    live = { ...live, scores: { ...live.scores, [`r0-rm${room}-p${position}`]: null } };
    expect(standingOf(live, lone)?.played).toBe(1);
    expect(standingOf(live, removed)?.played).toBe(0);
  });

  it('an elimination round (one advancing per room): a unit left alone by a removal still advances', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['A', 'B', 'C', 'D'],
      rounds: [
        buildRound({ roundNum: 1, rooms: [2, 2], players: 4, advPerRoom: 1, advTotal: 2 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [buildAssignments(['A', 'B', 'C', 'D'], [2, 2])],
      scores: { 'r0-rm1-p0': 9, 'r0-rm1-p1': 5, 'r0-rm2-p0': 8, 'r0-rm2-p1': 4 },
    });
    const live = removeRosterUnit(state, 'B');
    expect(isUncontestedRoom(live, 0, 1)).toBe(true);
    expect(roomBasedComputeAdvancement(live, 0).advancing.map((entry) => entry.name)).toEqual(['A', 'C']);
  });
});
