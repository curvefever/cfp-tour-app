import { describe, expect, it } from 'vitest';
import { computeRankings } from '../rankings';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
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
