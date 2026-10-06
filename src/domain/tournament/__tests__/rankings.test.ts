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
  // Pure pct ordering would rank P4 above P2; the room-depth tiebreak should
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

  it('ranks a same-round elimination from a lower Kings Valley room above one from a higher room, regardless of pct', () => {
    const rankings = computeRankings(buildState(true));
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(['P2', 'P4']);
  });

  it('leaves non-Kings-Valley same-round eliminations ordered purely by pct (regression -- no room field populated)', () => {
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
