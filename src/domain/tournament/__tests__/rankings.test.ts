import { describe, expect, it } from 'vitest';
import { compareStandings, isStandingsCutoffRound, orderedQualificationTable } from '../advancement';
import { addWalkUpIndividual } from '../mutations';
import { computeRankings, tournamentWinners } from '../rankings';
import { describeStandings } from '../standings-display';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentStanding, TournamentState } from '../types';
import { buildState, scoreCurrentRound } from './play-through';
import {
  buildShapedQualWaterfall as buildQualWaterfall,
  describeInBothShapes,
  playToQualificationExit,
} from './qual-waterfall';
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

  it('counts a unit waiting in a destination round pending pool as alive -- rank 2, routed to round 2 which is not drawn yet, is not ranked as eliminated', () => {
    const state = buildState();
    state.pendingBracketSeeds[2] = [{ name: 'P2', tierRank: 1, pct: 0.5 }];
    const rankings = computeRankings(state);
    expect(rankings?.eliminatedList.some((entry) => entry.name === 'P2')).toBe(false);
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toContain('P3');
  });

  it('still ranks a unit routed to eliminated as eliminated while other units wait in a pending pool', () => {
    const state = buildState();
    state.pendingBracketSeeds[2] = [{ name: 'P2', tierRank: 1, pct: 0.5 }];
    expect(computeRankings(state)?.eliminatedList.map((entry) => entry.name)).toEqual(['P3']);
  });
});

describe('computeRankings -- double elimination deferred drop', () => {
  // Round 0's loser drops to round 2 (a losers-bracket round not drawn yet), so the loser waits in
  // pendingBracketSeeds[2] instead of assignments[2].
  function buildDeferredDropState() {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [2],
          players: 2,
          advPerRoom: 1,
          bracket: 'winners',
          winnersTo: 1,
          losersTo: 2,
        }),
        buildRound({ roundNum: 2, rooms: [1], players: 1, bracket: 'winners' }),
        buildRound({ roundNum: 2, rooms: [1], players: 1, bracket: 'losers' }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [{ name: 'P1', room: 1, isLucky: false }],
        [],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200 },
    });
  }

  it('ranks the deferred loser as eliminated only when nothing is waiting for it', () => {
    expect(computeRankings(buildDeferredDropState())?.eliminatedList.map((entry) => entry.name)).toEqual([
      'P2',
    ]);
  });

  it('counts the loser waiting in the losers-bracket pool as alive', () => {
    const state = buildDeferredDropState();
    state.pendingBracketSeeds[2] = [{ name: 'P2', tierRank: 0, pct: 0 }];
    expect(computeRankings(state)?.eliminatedList).toEqual([]);
  });

  it('lists the loser waiting in the losers-bracket pool under still in tournament, waiting for that round', () => {
    const state = buildDeferredDropState();
    state.pendingBracketSeeds[2] = [{ name: 'P2', tierRank: 0, pct: 0 }];
    const waiting = computeRankings(state)?.stillActive.find((entry) => entry.name === 'P2');
    expect(waiting).toMatchObject({ room: null, waitingFor: 2 });
  });

  it('lists a unit that is both drawn and in a pool only once, as drawn', () => {
    const state = buildDeferredDropState();
    state.pendingBracketSeeds[2] = [
      { name: 'P2', tierRank: 0, pct: 0 },
      { name: 'P1', tierRank: 0, pct: 0 },
    ];
    const active = computeRankings(state)?.stillActive ?? [];
    expect(active.map((entry) => entry.name).sort()).toEqual(['P1', 'P2']);
    expect(active.find((entry) => entry.name === 'P1')).toMatchObject({ room: 1 });
    expect(active.find((entry) => entry.name === 'P1')?.waitingFor).toBeUndefined();
  });

  it('does not list pooled units as waiting once the Final is complete', () => {
    const state = buildDeferredDropState();
    state.pendingBracketSeeds[2] = [{ name: 'P2', tierRank: 0, pct: 0 }];
    state.rounds[1] = { ...state.rounds[1], isFinal: true, numGames: 1 };
    state.finalScores = { 'game1-P1': 100 };
    const ranked = computeRankings(state);
    expect(ranked?.finalComplete).toBe(true);
    expect(ranked?.stillActive.some((entry) => entry.waitingFor !== undefined)).toBe(false);
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

function finalCompleteState(): TournamentState {
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
  return state;
}

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
    const state = finalCompleteState();
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

  it('tells where each eliminated unit went out (room, place, not at a cut) without changing the order', () => {
    const rankings = computeRankings(finalCompleteState());
    expect(
      rankings?.eliminatedList.map((entry) => [
        entry.name,
        entry.seat,
        entry.place,
        entry.atCut,
        entry.poolRank,
      ]),
    ).toEqual([
      ['P3', 1, 3, false, null],
      ['P4', 1, 4, false, null],
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

describeInBothShapes('computeRankings -- a waterfall fed by the qualification table (Qual source)', () => {
  function afterQualification(registered: number) {
    const exit = playToQualificationExit(buildQualWaterfall(registered));
    const order = orderedQualificationTable(exit).ordered.map((entry) => entry.name);
    const result = advanceTournamentRound(exit);
    if (result.status !== 'advanced') throw new Error('expected the pooling exit to advance');
    return { state: result.state, order };
  }

  it.each([
    [31, 7],
    [37, 13],
    [43, 19],
    [53, 29],
  ])(
    'at %i registered: only the %i units below the routed ranks are eliminated, not 17-24 waiting for R1C',
    (registered, out) => {
      const { state, order } = afterQualification(registered);
      const eliminated = computeRankings(state)?.eliminatedList.map((entry) => entry.name) ?? [];
      expect(eliminated).toHaveLength(out);
      expect(new Set(eliminated)).toEqual(new Set(order.slice(24)));
      for (const name of order.slice(16, 24)) expect(eliminated).not.toContain(name);
    },
  );

  it('ranks the units below the routed ranks as eliminated at the qualification round', () => {
    const { state, order } = afterQualification(37);
    const entries = computeRankings(state)?.eliminatedList ?? [];
    const lastQualification = state.rounds.map((round) => Boolean(round.isQual)).lastIndexOf(true);
    expect(entries.every((entry) => entry.ri === lastQualification)).toBe(true);
    // Every eliminated unit ranks below the 24 that are still in.
    expect(entries.every((entry) => entry.rank > 24)).toBe(true);
    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(order.slice(24)));
  });
});

describeInBothShapes('computeRankings -- units waiting in a pending pool are still in the tournament', () => {
  function atPoolingExit(registered: number) {
    const exit = playToQualificationExit(buildQualWaterfall(registered));
    const order = orderedQualificationTable(exit).ordered.map((entry) => entry.name);
    const result = advanceTournamentRound(exit);
    if (result.status !== 'advanced') throw new Error('expected the pooling exit to advance');
    return { state: result.state, order };
  }

  it('at 37 registered: R1 plays, ranks 17-24 wait for R1C, ranks 25+ are eliminated from rank 25', () => {
    const { state, order } = atPoolingExit(37);
    const rankings = computeRankings(state);
    const r1c = state.rounds.findIndex((round) => round.customLabel === 'R1C');
    const active = rankings?.stillActive ?? [];
    expect(active).toHaveLength(24);
    const waiting = active.filter((entry) => entry.waitingFor !== undefined);
    expect(waiting.map((entry) => entry.name).sort()).toEqual(order.slice(16, 24).sort());
    expect(waiting.every((entry) => entry.waitingFor === r1c && entry.room === null)).toBe(true);
    expect(active.filter((entry) => entry.room !== null)).toHaveLength(16);
    expect(rankings?.eliminatedList).toHaveLength(13);
    expect(Math.min(...(rankings?.eliminatedList ?? []).map((entry) => entry.rank))).toBe(25);
  });

  it('at 53 registered: 24 still in, 29 eliminated', () => {
    const { state } = atPoolingExit(53);
    const rankings = computeRankings(state);
    expect(rankings?.stillActive).toHaveLength(24);
    expect(rankings?.eliminatedList).toHaveLength(29);
  });

  it('once R1 is played and R1C is drawn, those 8 are R1C entries with a room, not waiting', () => {
    const { state, order } = atPoolingExit(37);
    const next = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (next.status !== 'advanced') throw new Error('expected R1 to advance');
    const active = computeRankings(next.state)?.stillActive ?? [];
    const r1c = new Set(order.slice(16, 24));
    const inR1c = active.filter((entry) => r1c.has(entry.name));
    expect(inR1c).toHaveLength(8);
    expect(inR1c.every((entry) => entry.room !== null && entry.waitingFor === undefined)).toBe(true);
  });
});

describeInBothShapes('computeRankings -- a late joiner waiting for the next pooling round', () => {
  function atRound2() {
    const start = buildState({
      label: 'FFA qual 37',
      count: 37,
      setup: { poolingPhase: 'qual-table', qualAdv: '16' },
      teams: false,
    });
    if (!start) throw new Error('expected a generated tournament');
    const next = advanceTournamentRound(scoreCurrentRound(start, 0));
    if (next.status !== 'advanced') throw new Error('expected round 1 to advance');
    return next.state;
  }

  it('is listed once as still in, with no room, waiting for the round after the one in play', () => {
    const joined = addWalkUpIndividual(atRound2(), 'Late', { allowLateJoin: true });
    if (joined.status !== 'added') throw new Error('expected the joiner to be added');
    const active = computeRankings(joined.state)?.stillActive ?? [];
    expect(active).toHaveLength(38);
    const entries = active.filter((entry) => entry.name === 'Late');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ room: null, waitingFor: 2 });
    expect(active.filter((entry) => entry.waitingFor !== undefined)).toHaveLength(1);
    expect(computeRankings(joined.state)?.eliminatedList).toHaveLength(0);
  });

  it('marks the joiner as joining, and nobody else (a unit waiting in a pending pool is not joining)', () => {
    const joined = addWalkUpIndividual(atRound2(), 'Late', { allowLateJoin: true });
    if (joined.status !== 'added') throw new Error('expected the joiner to be added');
    const active = computeRankings(joined.state)?.stillActive ?? [];
    expect(active.filter((entry) => entry.joining).map((entry) => entry.name)).toEqual(['Late']);
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const result = advanceTournamentRound(exit);
    if (result.status !== 'advanced') throw new Error('expected the pooling exit to advance');
    const waiting = (computeRankings(result.state)?.stillActive ?? []).filter(
      (entry) => entry.waitingFor !== undefined,
    );
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.some((entry) => entry.joining)).toBe(false);
  });

  it('has a room and no waitingFor once Next Round draws them in', () => {
    const joined = addWalkUpIndividual(atRound2(), 'Late', { allowLateJoin: true });
    if (joined.status !== 'added') throw new Error('expected the joiner to be added');
    const next = advanceTournamentRound(scoreCurrentRound(joined.state, 0));
    if (next.status !== 'advanced') throw new Error('expected round 2 to advance');
    const entries = (computeRankings(next.state)?.stillActive ?? []).filter((entry) => entry.name === 'Late');
    expect(entries).toHaveLength(1);
    expect(entries[0].room).not.toBeNull();
    expect(entries[0].waitingFor).toBeUndefined();
  });
});

describe('tournamentWinners', () => {
  const nameOf = (index: number) => `P${String(index + 1).padStart(2, '0')}`;

  /** `count` players in rooms of up to 10, the first four of them in a Final of one game scored by `finalScores`. */
  function ffaWithFinal(count: number, finalScores: Record<string, number>, numGames = 1): TournamentState {
    const names = Array.from({ length: count }, (_, index) => nameOf(index));
    const rooms = Array.from({ length: Math.ceil(count / 10) }, (_, index) =>
      Math.min(10, count - index * 10),
    );
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: names,
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms, players: count, advPerRoom: 1 }),
        buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames }),
      ],
      assignments: [
        names.map((name, index) => ({ name, room: Math.floor(index / 10) + 1, isLucky: false })),
        names.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
      ],
      scores: Object.fromEntries(
        names.map((_, index) => [`r0-rm${Math.floor(index / 10) + 1}-p${index % 10}`, 900 - index]),
      ),
      finalScores,
    });
  }

  it('gives the unit ranked first of a 37-player tournament', () => {
    const state = ffaWithFinal(37, { 'game1-P01': 50, 'game1-P02': 90, 'game1-P03': 60, 'game1-P04': 10 });
    expect(tournamentWinners(state)).toEqual([{ label: 'P02', members: null }]);
  });

  it('is empty until the Final is complete', () => {
    expect(tournamentWinners(ffaWithFinal(37, {}))).toEqual([]);
    expect(tournamentWinners(ffaWithFinal(37, { 'game1-P01': 50, 'game1-P02': 90 }))).toEqual([]);
  });

  it('is empty while a 3-game Final has only its first game played (37 players)', () => {
    const state = ffaWithFinal(37, { 'game1-P01': 50, 'game1-P02': 90, 'game1-P03': 60, 'game1-P04': 10 }, 3);
    // Nobody is ranked before the last game is in: the finalists list is empty, so there is no first place yet.
    expect(computeRankings(state)?.finalists).toEqual([]);
    expect(tournamentWinners(state)).toEqual([]);
  });

  it('is empty while the Final has not been reached', () => {
    const state = ffaWithFinal(37, {});
    expect(
      tournamentWinners({
        ...state,
        curRound: 0,
        rounds: state.rounds.slice(0, 1),
        assignments: state.assignments.slice(0, 1),
      }),
    ).toEqual([]);
  });

  it('gives both teams of a tie for 1st, with their members (13 teams)', () => {
    const teams = Array.from({ length: 13 }, (_, index) => ({
      teamId: `t${index + 1}`,
      teamName: `Team ${index + 1}`,
      members: [{ name: `a${index + 1}` }, { name: `b${index + 1}` }],
    }));
    const ids = teams.map((team) => team.teamId);
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: teams,
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [4, 3, 3, 3], players: 13, advPerRoom: 1 }),
        buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames: 1 }),
      ],
      assignments: [
        ids.map((name, index) => ({
          name,
          room: index < 4 ? 1 : index < 7 ? 2 : index < 10 ? 3 : 4,
          isLucky: false,
        })),
        ids.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
      ],
      scores: {},
      // A team's score is its members' scores summed: 40 + 40 each for the tied teams.
      finalScores: Object.fromEntries(
        [80, 80, 60, 10].flatMap((total, index) => [
          [`game1-t${index + 1}-m0`, total / 2],
          [`game1-t${index + 1}-m1`, total / 2],
        ]),
      ),
    });
    expect(tournamentWinners(state)).toEqual([
      { label: 'Team 1', members: ['a1', 'b1'] },
      { label: 'Team 2', members: ['a2', 'b2'] },
    ]);
  });
});
