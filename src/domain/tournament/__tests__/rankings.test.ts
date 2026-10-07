import { describe, expect, it } from 'vitest';
import { compareStandings, isStandingsCutoffRound } from '../advancement';
import { computeRankings } from '../rankings';
import { describeStandings } from '../standings-display';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentStanding, TournamentState } from '../types';
import { buildState, scoreCurrentRound } from './play-through';
import { buildRound } from './test-fixtures';

describe('computeRankings -- Kings Valley room-depth tiebreak', () => {
  // Room1 (top): P1=100, P2=10 -- P2's pct = 10/110 ~= 0.091 (low).
  // Room2 (bottom, further from the top): P3=100, P4=90 -- P4's pct = 90/190 ~= 0.474 (high).
  // Room share alone would rank P4 above P2; the room-depth tiebreak should
  // instead rank P2 (room 1, closer to the top) above P4 regardless.
  function buildState(isKingsValley: boolean) {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      rounds: [
        buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isKingsValley }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 10,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
      },
    });
  }

  it('ranks a same-round elimination from a lower Kings Valley room above one from a higher room, regardless of room share', () => {
    const rankings = computeRankings(buildState(true));
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(['P2', 'P4']);
  });

  it('orders non-Kings-Valley same-round eliminations by place in the room, then relative room share (no room field populated)', () => {
    const rankings = computeRankings(buildState(false));
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(['P4', 'P2']);
  });
});

describe('computeRankings -- waterfall bracket elimination', () => {
  // Round 0 ("5") sends rank 1 -> round 1 (which turns out to be the Final)
  // and rank 2 -> round 2 (a different, still-unplayed destination); rank 3
  // is routed straight to 'eliminated'. This is the same round.bracket ->
  // round.bracket || round.isWaterfall generalization double-elimination
  // already used, now driven by waterfallRoutes' own distinct destinations
  // instead of a hardcoded winnersTo/losersTo pair.
  function buildState() {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3'],
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [3],
          players: 3,
          isWaterfall: true,
          customLabel: '5',
          waterfallRoutes: [[1, 2, 'eliminated']],
        }),
        buildRound({
          roundNum: 2,
          rooms: [1],
          players: 1,
          isWaterfall: true,
          customLabel: 'Final',
          isFinal: true,
        }),
        buildRound({ roundNum: 2, rooms: [1], players: 1, isWaterfall: true, customLabel: '6B' }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
        [{ name: 'P1', room: 1, isLucky: false }], // round 1 -- rank 1's real destination
        [], // round 2 -- rank 2's destination, not reached/finalized yet
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 },
    });
  }

  it('finds a survivor via the union of every distinct waterfallRoutes destination, not just an adjacent round -- P1 (rank 1, routed to the already-finalized Final) is never flagged eliminated', () => {
    const rankings = computeRankings(buildState());
    expect(rankings?.finalists.map((entry) => entry.name)).toEqual(['P1']);
    expect(rankings?.eliminatedList.some((entry) => entry.name === 'P1')).toBe(false);
  });

  it('routes rank 3 (an explicit "eliminated" band) into eliminatedList', () => {
    const rankings = computeRankings(buildState());
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toContain('P3');
  });

  it('documents a known, pre-existing characteristic shared with double-elimination: a destination round that has not been finalized yet reads as empty, so a unit legitimately routed there (rank 2 -> round 2, never reached) shows as eliminated until curRound actually catches up to it -- not a waterfall-specific regression, the exact same pendingBracketSeeds-finalize-on-a-delay timing double-elimination already has for any deferred LB target', () => {
    const rankings = computeRankings(buildState());
    expect(rankings?.eliminatedList.some((entry) => entry.name === 'P2')).toBe(true);
  });
});

describe('computeRankings -- DNF/no-show', () => {
  function buildActiveState(withdrawnUnits: TournamentState['withdrawnUnits'] = []) {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
      withdrawnUnits,
    });
  }

  it('puts a unit that played at least one match in dnfList, not noShows', () => {
    const rankings = computeRankings(
      buildActiveState([{ name: 'P3', label: 'P3', members: null, playedAnyMatch: true, reason: 'removed' }]),
    );
    expect(rankings?.dnfList.map((entry) => entry.name)).toEqual(['P3']);
    expect(rankings?.noShows).toEqual([]);
  });

  it('puts a unit that never played in noShows, not dnfList', () => {
    const rankings = computeRankings(
      buildActiveState([
        { name: 'P4', label: 'P4', members: null, playedAnyMatch: false, reason: 'swapped' },
      ]),
    );
    expect(rankings?.noShows.map((entry) => entry.name)).toEqual(['P4']);
    expect(rankings?.dnfList).toEqual([]);
  });

  it('leaves both lists empty when nobody has withdrawn (no effect on existing fixtures)', () => {
    const rankings = computeRankings(buildActiveState());
    expect(rankings?.dnfList).toEqual([]);
    expect(rankings?.noShows).toEqual([]);
  });

  it('keeps a withdrawn unit absent from eliminatedList even when historical assignments still reference its old name', () => {
    // P1 was swapped out for P3 after round 0 -- round 0's assignments still
    // say "P1", but the current roster (and round 1's assignments) say "P3".
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P2', 'P3'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 50,
        'r1-rm1-p0': 100,
        'r1-rm1-p1': 50,
      },
      withdrawnUnits: [{ name: 'P1', label: 'P1', members: null, playedAnyMatch: true, reason: 'swapped' }],
    });
    const rankings = computeRankings(state);
    expect(rankings?.eliminatedList.some((entry) => entry.name === 'P1')).toBe(false);
    expect(rankings?.dnfList.map((entry) => entry.name)).toEqual(['P1']);
  });

  it('excludes a ghost name from stillActive when it lingers in a pre-generated round after the unit was removed', () => {
    // Group-stage rounds are all pre-generated upfront, so a removed unit's
    // name can still appear in a later round's own assignments -- the
    // current roster (state.players) is the source of truth for who's
    // really still active, not the raw assignment list.
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P2', 'P3'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [2], players: 2, isGroupStage: true }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, isGroupStage: true }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [
          { name: 'P1', room: 1, isLucky: false }, // ghost -- P1 was removed, but round 2 was pre-built with it
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      withdrawnUnits: [{ name: 'P1', label: 'P1', members: null, playedAnyMatch: false, reason: 'removed' }],
    });
    const rankings = computeRankings(state);
    expect(rankings?.stillActive.map((entry) => entry.name)).toEqual(['P3']);
  });
});

describe('computeRankings -- pool rank badge', () => {
  it('ignores a partly scored room of the current round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      started: true,
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [2, 2], players: 4 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 100, 'r0-rm2-p0': 200 },
    });
    const byName = new Map(computeRankings(state)?.stillActive.map((unit) => [unit.name, unit.poolRank]));
    expect(byName.get('P1')?.rank).toBe(1);
    expect(byName.get('P2')?.rank).toBe(2);
    expect(byName.get('P3')).toBeNull();
    expect(byName.get('P4')).toBeNull();
    const complete = { ...state, scores: { ...state.scores, 'r0-rm2-p1': 50 } };
    const after = new Map(computeRankings(complete)?.stillActive.map((unit) => [unit.name, unit.poolRank]));
    expect(after.get('P3')?.rank).toBeDefined();
  });
});

describe('computeRankings -- eliminated at a standings cut', () => {
  function advance(state: TournamentState): TournamentState {
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`did not advance: ${JSON.stringify(result)}`);
    return result.state;
  }

  /** Plays and scores rounds until the current one is the standings cut-off round. */
  function playToCutoffRound(start: TournamentState, teamSize: number): TournamentState {
    let state = start;
    for (let guard = 0; guard < 20 && !isStandingsCutoffRound(state, state.curRound); guard += 1) {
      state = advance(scoreCurrentRound(state, teamSize));
    }
    return state;
  }

  /** Scenario B: 23 teams, 2v2v2v2, qualification table, 4 rounds with round 1 not counted, 16 qualify. */
  function afterTeamQualCut(): TournamentState {
    const start = buildState({
      label: 'scenario B',
      count: 23,
      teams: true,
      setup: {
        gameFormat: 'team-2v2v2v2',
        poolingPhase: 'qual-table',
        qualAdv: '16',
        qualRoundsOverride: '4',
        nonCountingRounds: '1',
      },
    }) as TournamentState;
    return advance(scoreCurrentRound(playToCutoffRound(start, 3), 3));
  }

  it('scenario B: the 7 teams the cut eliminated rank 17-23, in standings order', () => {
    const state = afterTeamQualCut();
    const rankings = computeRankings(state);
    const table = describeStandings(state)?.tables[0].entries ?? [];
    expect(rankings?.stillActive).toHaveLength(16);
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(
      table.slice(16).map((entry) => entry.name),
    );
    expect(rankings?.eliminatedList.map((entry) => entry.rank)).toEqual([17, 18, 19, 20, 21, 22, 23]);
  });

  it("a later-round elimination ranks above the cut's eliminated, and both sets sit below the still-active", () => {
    let state = afterTeamQualCut();
    const cutRoundIndex = state.curRound - 1;
    state = advance(scoreCurrentRound(state, 3));
    const rankings = computeRankings(state);
    const eliminated = rankings?.eliminatedList ?? [];
    const later = eliminated.filter((entry) => entry.ri > cutRoundIndex);
    const atCut = eliminated.filter((entry) => entry.ri === cutRoundIndex);
    expect(later.length).toBeGreaterThan(0);
    expect(atCut).toHaveLength(7);
    expect(eliminated.slice(0, later.length)).toEqual(later);
    const active = rankings?.stillActive.length ?? 0;
    expect(eliminated[0].rank).toBe(active + 1);
    expect(atCut.map((entry) => entry.rank)).toEqual([17, 18, 19, 20, 21, 22, 23]);
    expect(Math.max(...later.map((entry) => entry.rank))).toBeLessThan(17);
  });

  it('group stage (31 units, 2 per group go through): eliminated units are ordered by place in group, then standing', () => {
    let state = buildState({
      label: 'scenario D',
      count: 31,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '8',
        oddCountStrategy: 'bye',
      },
    }) as TournamentState;
    state = advance(scoreCurrentRound(playToCutoffRound(state, 0), 0));
    const rankings = computeRankings(state);
    const placed = new Map<string, { place: number; standing: TournamentStanding }>();
    for (const table of describeStandings(state)?.tables ?? []) {
      for (const [place, standing] of table.entries.entries()) placed.set(standing.name, { place, standing });
    }
    const eliminated = rankings?.eliminatedList ?? [];
    expect(eliminated.length).toBeGreaterThan(0);
    for (const [index, entry] of eliminated.entries()) {
      const next = eliminated[index + 1];
      if (!next) continue;
      const here = placed.get(entry.name);
      const there = placed.get(next.name);
      expect(here?.place).toBeLessThanOrEqual(there?.place ?? Infinity);
      if (here?.place === there?.place) {
        expect(
          compareStandings(here?.standing as TournamentStanding, there?.standing as TournamentStanding),
        ).toBeLessThanOrEqual(0);
      }
      expect(entry.rank).toBeLessThanOrEqual(next.rank);
    }
    expect(eliminated[0].rank).toBe((rankings?.stillActive.length ?? 0) + 1);
  });

  it.each([
    ['three picked in order', ['T1', 'T2', 'T3']],
    ['all four picked in order', ['T1', 'T2', 'T3', 'T4']],
  ])(
    'a 4-way cut tie straddling the cut with %s: the third pick ranks alone above the remainder',
    (_label, picks) => {
      // Room winners W1-W2 (share 1.8) lead; T1-T4 win with an identical 300-100 (share 1.5): 4 units for 2 places.
      const pairs: Array<[string, number, string, number]> = [
        ['W1', 900, 'L1', 100],
        ['W2', 900, 'L2', 100],
        ['T1', 300, 'L3', 100],
        ['T2', 300, 'L4', 100],
        ['T3', 300, 'L5', 100],
        ['T4', 300, 'L6', 100],
      ];
      const scores: Record<string, number> = {};
      const poolRound = pairs.flatMap(([winner, winnerScore, loser, loserScore], index) => {
        scores[`r0-rm${index + 1}-p0`] = winnerScore;
        scores[`r0-rm${index + 1}-p1`] = loserScore;
        return [
          { name: winner, room: index + 1, isLucky: false },
          { name: loser, room: index + 1, isLucky: false },
        ];
      });
      const state = createDefaultTournamentState({
        gameFormat: 'individual-1v1',
        players: poolRound.map((entry) => entry.name),
        started: true,
        curRound: 1,
        cfg: { poolingPhase: 'qual-table', qualAdv: 4 },
        gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
        rounds: [
          buildRound({ roundNum: 1, isQual: true, isNoElim: true, rooms: [2, 2, 2, 2, 2, 2], players: 12 }),
          buildRound({ roundNum: 2, rooms: [4], players: 4 }),
        ],
        assignments: [poolRound, ['W1', 'W2', 'T1', 'T2'].map((name) => ({ name, room: 1, isLucky: false }))],
        scores,
        tieResolutions: { 'qual-cutoff': picks },
      });
      const eliminated = computeRankings(state)?.eliminatedList ?? [];
      const rankOf = (name: string) => eliminated.find((entry) => entry.name === name)?.rank;
      expect(eliminated.slice(0, 2).map((entry) => entry.name)).toEqual(['T3', 'T4']);
      expect([rankOf('T3'), rankOf('T4')]).toEqual([5, 6]);
    },
  );

  it('with the Final complete the ranks are unchanged: finalists 1…n, then the eliminated', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], players: 4, advPerRoom: 2 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, isFinal: true, numGames: 1 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
      finalScores: { 'game1-P1': 50, 'game1-P2': 80 },
    });
    const rankings = computeRankings(state);
    expect(rankings?.finalComplete).toBe(true);
    expect(rankings?.finalists.map((entry) => [entry.name, entry.rank])).toEqual([
      ['P2', 1],
      ['P1', 2],
    ]);
    expect(rankings?.eliminatedList.map((entry) => [entry.name, entry.rank])).toEqual([
      ['P3', 3],
      ['P4', 4],
    ]);
  });
});

describe('computeRankings -- order within an elimination round', () => {
  /** Round 1 rooms hold the given scores (best first); the top `advancing` of each room play round 2. Unit names are `R<room>-<place>`. */
  function afterOneRound(rooms: number[][], advancing: number) {
    const assignments: Array<{ name: string; room: number; isLucky: boolean }> = [];
    const next: typeof assignments = [];
    const scores: Record<string, number> = {};
    for (const [roomIndex, roomScores] of rooms.entries()) {
      for (const [position, score] of roomScores.entries()) {
        const name = `R${roomIndex + 1}-${position + 1}`;
        assignments.push({ name, room: roomIndex + 1, isLucky: false });
        scores[`r0-rm${roomIndex + 1}-p${position}`] = score;
        if (position < advancing) next.push({ name, room: 1, isLucky: false });
      }
    }
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: assignments.map(({ name }) => name),
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: rooms.map((room) => room.length),
          players: assignments.length,
          advPerRoom: advancing,
        }),
        buildRound({ roundNum: 2, rooms: [next.length], players: next.length }),
      ],
      assignments: [assignments, next],
      scores,
    });
  }

  const ranked = (state: TournamentState) =>
    computeRankings(state)?.eliminatedList.map(({ name, rank }) => [name, rank]);

  function advance(state: TournamentState): TournamentState {
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`did not advance: ${JSON.stringify(result)}`);
    return result.state;
  }

  it('ranks the 3rd places of a room of 4 above a room of 3 at equal points: share is relative to the room size', () => {
    // 20 of 100 in a room of 4 is 0.80 of the room average; 20 of 80 in a room of 3 is only 0.75.
    const state = afterOneRound(
      [
        [30, 30, 20, 20],
        [30, 30, 20],
      ],
      2,
    );
    expect(ranked(state)).toEqual([
      ['R1-3', 5],
      ['R1-4', 5],
      ['R2-3', 7],
    ]);
  });

  it('orders by place in the room before room share, and level places by share', () => {
    const state = afterOneRound(
      [
        [100, 90, 80, 70, 60, 50, 10, 5],
        [200, 190, 180, 170, 20, 5, 5, 5],
      ],
      4,
    );
    // Room 1's 6th (relative share 1.36) no longer outranks room 2's 5th (0.21); room 2's three 5-point units tie for 6th.
    expect(ranked(state)).toEqual([
      ['R1-5', 9],
      ['R2-5', 10],
      ['R1-6', 11],
      ['R2-6', 12],
      ['R2-7', 12],
      ['R2-8', 12],
      ['R1-7', 15],
      ['R1-8', 16],
    ]);
  });

  it('shares one rank between all units of all-zero rooms when nothing else separates them (no pooling phase)', () => {
    const state = afterOneRound(
      [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      2,
    );
    expect(ranked(state)).toEqual([
      ['R1-3', 5],
      ['R1-4', 5],
      ['R2-3', 5],
      ['R2-4', 5],
    ]);
  });

  it('orders a waterfall round by place in the room, then relative share, across rooms of different size', () => {
    // Raw shares gave R1-2 (0.33), R1-3 (0.17), R2-2 (0.14); by place, R2-2 (place 2) now ranks above R1-3 (place 3).
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['R1-1', 'R1-2', 'R1-3', 'R2-1', 'R2-2'],
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [3, 2],
          players: 5,
          isWaterfall: true,
          waterfallRoutes: [
            [1, 'eliminated', 'eliminated'],
            [1, 'eliminated'],
          ],
        }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'R1-1', room: 1, isLucky: false },
          { name: 'R1-2', room: 1, isLucky: false },
          { name: 'R1-3', room: 1, isLucky: false },
          { name: 'R2-1', room: 2, isLucky: false },
          { name: 'R2-2', room: 2, isLucky: false },
        ],
        [
          { name: 'R1-1', room: 1, isLucky: false },
          { name: 'R2-1', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 30,
        'r0-rm1-p1': 20,
        'r0-rm1-p2': 10,
        'r0-rm2-p0': 30,
        'r0-rm2-p1': 5,
      },
    });
    expect(ranked(state)).toEqual([
      ['R1-2', 3],
      ['R2-2', 4],
      ['R1-3', 5],
    ]);
  });

  it('keeps the Kings Valley room order ahead of place and share', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['A1', 'A2', 'B1', 'B2'],
      rounds: [
        buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isKingsValley: true }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'A1', room: 1, isLucky: false },
          { name: 'A2', room: 1, isLucky: false },
          { name: 'B1', room: 2, isLucky: false },
          { name: 'B2', room: 2, isLucky: false },
        ],
        [
          { name: 'A1', room: 1, isLucky: false },
          { name: 'B1', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 90, 'r0-rm2-p0': 100, 'r0-rm2-p1': 10 },
    });
    expect(ranked(state)).toEqual([
      ['A2', 3],
      ['B2', 4],
    ]);
  });

  describe('level in the room: falls back to the pooling standings', () => {
    it('orders the units of all-zero rooms by their qualification standing', () => {
      // 23 teams, 2v2v2v2, 16 qualify: the first elimination round (rooms of 4, top 3 advance) is scored 0-0-0-0.
      let state = buildState({
        label: 'scenario B',
        count: 23,
        teams: true,
        setup: {
          gameFormat: 'team-2v2v2v2',
          poolingPhase: 'qual-table',
          qualAdv: '16',
          qualRoundsOverride: '4',
          nonCountingRounds: '1',
        },
      }) as TournamentState;
      while (!isStandingsCutoffRound(state, state.curRound)) state = advance(scoreCurrentRound(state, 3));
      state = advance(scoreCurrentRound(state, 3));
      const roundIndex = state.curRound;
      const distinct = scoreCurrentRound(state, 3);
      const scores = { ...distinct.scores };
      const tieResolutions = { ...state.tieResolutions };
      for (const room of new Set(state.assignments[roundIndex].map((entry) => entry.room))) {
        for (const key of Object.keys(scores)) {
          if (key.startsWith(`r${roundIndex}-rm${room}-`)) scores[key] = 0;
        }
        tieResolutions[`r${roundIndex}-rm${room}-s0`] = state.assignments[roundIndex]
          .filter((entry) => entry.room === room)
          .map(({ name }) => name);
      }
      state = advance({ ...state, scores, tieResolutions });

      const eliminated =
        computeRankings(state)?.eliminatedList.filter((entry) => entry.ri === roundIndex) ?? [];
      const table = describeStandings(state)?.tables[0].entries.map((entry) => entry.name) ?? [];
      const names = eliminated.map((entry) => entry.name);
      expect(names).toHaveLength(4);
      expect(names).toEqual([...names].sort((first, second) => table.indexOf(first) - table.indexOf(second)));
      expect(new Set(eliminated.map((entry) => entry.rank)).size).toBe(4);
    });

    it('shares a rank between units level on the standings too, and ranks the rest after them', () => {
      // Qualification: winners 300-100 in three rooms (identical standings), 300-50 in the fourth.
      const qualification = [
        ['W1', 300, 'L1', 100],
        ['W2', 300, 'L2', 100],
        ['W3', 300, 'L3', 100],
        ['W4', 300, 'L4', 50],
      ] as const;
      const scores: Record<string, number> = {};
      const qualRound = qualification.flatMap(([winner, winnerScore, loser, loserScore], index) => {
        scores[`r0-rm${index + 1}-p0`] = winnerScore;
        scores[`r0-rm${index + 1}-p1`] = loserScore;
        return [
          { name: winner, room: index + 1, isLucky: false },
          { name: loser, room: index + 1, isLucky: false },
        ];
      });
      const roomOf = (names: string[], room: number) => names.map((name) => ({ name, room, isLucky: false }));
      const state = createDefaultTournamentState({
        gameFormat: 'individual-1v1',
        players: qualRound.map((entry) => entry.name),
        started: true,
        curRound: 2,
        cfg: { poolingPhase: 'qual-table', qualAdv: 8 },
        gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
        rounds: [
          buildRound({ roundNum: 1, isQual: true, isNoElim: true, rooms: [2, 2, 2, 2], players: 8 }),
          buildRound({ roundNum: 2, rooms: [4, 4], players: 8, advPerRoom: 2 }),
          buildRound({ roundNum: 3, rooms: [4], players: 4 }),
        ],
        assignments: [
          qualRound,
          [...roomOf(['W1', 'W2', 'L4', 'L1'], 1), ...roomOf(['W3', 'W4', 'L3', 'L2'], 2)],
          roomOf(['W1', 'W2', 'W3', 'W4'], 1),
        ],
        scores, // round 2 is unscored: every unit is level in its room
      });
      expect(ranked(state)).toEqual([
        ['L1', 5],
        ['L2', 5],
        ['L3', 5],
        ['L4', 8],
      ]);
    });

    it('ranks a unit with a standing above a level unit without one (in no group), and they do not share', () => {
      // X1 is first on the roster but sits in no group, so it has no row in any table; only L1 has a standing.
      const roomOf = (names: string[], room: number) => names.map((name) => ({ name, room, isLucky: false }));
      const state = createDefaultTournamentState({
        gameFormat: 'individual-1v1',
        players: ['X1', 'W1', 'L1', 'W2', 'L2'],
        started: true,
        curRound: 2,
        cfg: { poolingPhase: 'group-stage', qualifiersPerGroup: 2 },
        gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
        groups: [{ label: 'A', members: ['W1', 'L1', 'W2', 'L2'] }],
        rounds: [
          buildRound({ roundNum: 1, isGroupStage: true, rooms: [2, 2], players: 4, roomGroups: ['A', 'A'] }),
          buildRound({ roundNum: 2, rooms: [4], players: 4, advPerRoom: 2 }),
          buildRound({ roundNum: 3, rooms: [2], players: 2 }),
        ],
        assignments: [
          [...roomOf(['W1', 'L1'], 1), ...roomOf(['W2', 'L2'], 2)],
          roomOf(['W1', 'W2', 'L1', 'X1'], 1),
          roomOf(['W1', 'W2'], 1),
        ],
        scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 100, 'r0-rm2-p0': 300, 'r0-rm2-p1': 100 }, // round 2 unscored
      });
      expect(ranked(state)).toEqual([
        ['L1', 3],
        ['X1', 4],
        ['L2', 5], // out in the earlier group round, so it ranks below both
      ]);
    });
  });

  it('37 individual players, first elimination round: sorted by place then share, rank shared only when both match', () => {
    let state = buildState({
      label: 'ffa 37',
      count: 37,
      teams: false,
      setup: { gameFormat: 'ffa-individual' },
    }) as TournamentState;
    for (let round = 0; round < 3; round += 1) state = advance(scoreCurrentRound(state, 0));
    const rankings = computeRankings(state);
    const eliminated = rankings?.eliminatedList ?? [];
    const roundIndex = eliminated[0].ri;

    // Place and relative share of every unit in its room, read straight from the scores.
    const measures = new Map<string, { place: number; share: number }>();
    const rooms = new Map<number, string[]>();
    for (const entry of state.assignments[roundIndex]) {
      rooms.set(entry.room as number, [...(rooms.get(entry.room as number) ?? []), entry.name]);
    }
    for (const [room, names] of rooms) {
      const roomScores = names.map(
        (_, position) => state.scores[`r${roundIndex}-rm${room}-p${position}`] ?? 0,
      );
      const total = roomScores.reduce((sum, score) => sum + score, 0);
      for (const [position, name] of names.entries()) {
        const score = roomScores[position];
        measures.set(name, {
          place: 1 + roomScores.filter((other) => other > score).length,
          share: total > 0 ? (score / total) * names.length : 1,
        });
      }
    }

    expect(eliminated.length).toBeGreaterThan(0);
    expect(eliminated[0].rank).toBe((rankings?.stillActive.length ?? 0) + 1);
    for (const [index, entry] of eliminated.entries()) {
      const next = eliminated[index + 1];
      if (!next) continue;
      const here = measures.get(entry.name) as { place: number; share: number };
      const there = measures.get(next.name) as { place: number; share: number };
      const level = here.place === there.place && Math.abs(here.share - there.share) < 1e-9;
      expect(
        here.place < there.place || (here.place === there.place && here.share >= there.share - 1e-9),
      ).toBe(true);
      expect(next.rank).toBe(level ? entry.rank : eliminated[0].rank + index + 1);
    }
  });

  it('final totals that are equal share a rank, and the next rank skips', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], players: 4, advPerRoom: 3 }),
        buildRound({ roundNum: 2, rooms: [3], players: 3, isFinal: true, numGames: 1 }),
      ],
      assignments: [
        ['P1', 'P2', 'P3', 'P4'].map((name) => ({ name, room: 1, isLucky: false })),
        ['P1', 'P2', 'P3'].map((name) => ({ name, room: 1, isLucky: false })),
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
      finalScores: { 'game1-P1': 50, 'game1-P2': 50, 'game1-P3': 20 },
    });
    const rankings = computeRankings(state);
    expect(rankings?.finalists.map((entry) => [entry.name, entry.rank])).toEqual([
      ['P1', 1],
      ['P2', 1],
      ['P3', 3],
    ]);
    expect(rankings?.eliminatedList.map((entry) => [entry.name, entry.rank])).toEqual([['P4', 4]]);
  });
});
