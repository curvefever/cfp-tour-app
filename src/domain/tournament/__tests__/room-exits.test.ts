import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { exitBandAtRank, roundExitRule, type RoomExitBand } from '../room-exits';
import { getUnitScore, orderRoomByScore } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { createTournamentRuntime } from '../runtime';
import { advanceTournamentRound } from '../transitions';
import type { RoundAssignment, TournamentRound, TournamentState } from '../types';
import { waterfallBracketPhase, type OrderedWaterfallGraph } from '../waterfall-bracket';
import { buildAssignments, buildRound } from './test-fixtures';

function names(count: number, prefix = 'P'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function generate(count: number, setup: Partial<Parameters<typeof createDefaultSetup>[0]>): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: names(count) }),
    createDefaultSetup(setup),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
  return result.state;
}

/**
 * Jumps straight to `roundIndex` of an already-generated tournament with
 * synthetic occupants, bypassing every earlier round -- roundExitRule only
 * reads this round's own fields plus state.assignments[roundIndex], so
 * nothing upstream needs to actually be played first. Used only to reach a
 * round that isn't round 0 (round 0 already has real generation-time
 * assignments and needs none of this).
 */
function stateAtRound(base: TournamentState, roundIndex: number): TournamentState {
  const round = base.rounds[roundIndex];
  const assignments = base.rounds.map((r, index) =>
    index === roundIndex ? buildAssignments(names(r.players, `R${index}-`), round.rooms) : [],
  );
  return createDefaultTournamentState({
    gameFormat: base.gameFormat,
    gamemodeConfig: base.gamemodeConfig,
    cfg: base.cfg,
    rounds: base.rounds,
    assignments,
    byes: base.rounds.map(() => []),
    luckyLosers: base.rounds.map(() => []),
    curRound: roundIndex,
  });
}

/** Scores a round's real occupants with strictly decreasing values in assignment order, so every room's own rank order exactly matches its assignment order and nothing ties anywhere in the round. */
function scoreInAssignmentOrder(state: TournamentState, roundIndex: number): TournamentState {
  const scores = { ...state.scores };
  const seenPerRoom = new Map<number, number>();
  let counter = 0;
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = seenPerRoom.get(entry.room) ?? 0;
    seenPerRoom.set(entry.room, position + 1);
    scores[`r${roundIndex}-rm${entry.room}-p${position}`] = 1_000_000 - counter;
    counter += 1;
  }
  return { ...state, scores };
}

function orderedRoomNames(state: TournamentState, roundIndex: number, room: number): string[] {
  const scored = (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .map((entry, position) => ({
      name: entry.name,
      position,
      score: getUnitScore(state, roundIndex, room, position, 0) as number,
    }));
  return orderRoomByScore(scored, roundIndex, room, state).map((entry) => entry.name);
}

function perRoomBands(state: TournamentState, roundIndex: number): RoomExitBand[][] {
  const rule = roundExitRule(state, roundIndex);
  if (rule.kind !== 'per-room') throw new Error(`expected a per-room rule, got ${rule.kind}`);
  return rule.rooms;
}

/** Whether `name` shows up (assigned or merely pending) at round `destination`. */
function presentAt(state: TournamentState, destination: number, name: string): boolean {
  const assigned = (state.assignments[destination] ?? []).some((entry) => entry.name === name);
  const pending = (state.pendingBracketSeeds[destination] ?? []).some((seed) => seed.name === name);
  return assigned || pending;
}

/**
 * Walks every room in real rank order and resolves each rank's band into a
 * concrete outcome, using `realLuckyNames` (read from the real advance's own
 * `state.luckyLosers[destination]`) to settle any `lucky-chance` band -- the
 * one band kind whose outcome depends on something roundExitRule itself
 * never decides.
 */
function expectedOutcomes(
  state: TournamentState,
  roundIndex: number,
  realLuckyNames: string[],
): Map<string, { kind: 'advance' | 'drop' | 'eliminate'; destination?: number }> {
  const round = state.rounds[roundIndex];
  const rooms = perRoomBands(state, roundIndex);
  const outcomes = new Map<string, { kind: 'advance' | 'drop' | 'eliminate'; destination?: number }>();
  for (let roomIndex = 0; roomIndex < round.rooms.length; roomIndex += 1) {
    const room = roomIndex + 1;
    const bands = rooms[roomIndex];
    const advanceDestination = bands.find((band) => band.kind === 'advance')?.destination;
    for (const [index, name] of orderedRoomNames(state, roundIndex, room).entries()) {
      const band = exitBandAtRank(bands, index + 1);
      if (!band) continue;
      if (band.kind === 'advance') outcomes.set(name, { kind: 'advance', destination: band.destination });
      else if (band.kind === 'drop') outcomes.set(name, { kind: 'drop', destination: band.destination });
      else if (band.kind === 'eliminate') outcomes.set(name, { kind: 'eliminate' });
      else if (band.kind === 'lucky-chance') {
        if (realLuckyNames.includes(name)) {
          outcomes.set(name, { kind: 'advance', destination: advanceDestination });
        } else if (band.otherwise === 'eliminate') {
          outcomes.set(name, { kind: 'eliminate' });
        } else {
          outcomes.set(name, { kind: 'drop', destination: band.otherwise.drop });
        }
      }
    }
  }
  return outcomes;
}

describe('roundExitRule -- single elimination (with lucky losers)', () => {
  // FFA 37: awkward, non-round count, per AGENTS.md's "Scoping work".
  const state = generate(37, { gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
  const luckyRoundIndex = state.rounds.findIndex(
    (round) => !round.isFinal && !round.isNoElim && round.luckyCount > 0,
  );

  it('found a round with lucky losers to test against (a sanity check on the fixture, not the function under test)', () => {
    expect(luckyRoundIndex).toBeGreaterThanOrEqual(0);
  });

  it('per room: advance / lucky-chance / eliminate bands, clipped to the room and covering it exactly', () => {
    const round = state.rounds[luckyRoundIndex];
    const rooms = perRoomBands(state, luckyRoundIndex);
    expect(rooms).toHaveLength(round.rooms.length);
    rooms.forEach((bands, roomIndex) => {
      const size = round.rooms[roomIndex];
      const advPerRoom = round.advPerRoom ?? 0;
      expect(bands[0]).toMatchObject({
        kind: 'advance',
        fromRank: 1,
        toRank: advPerRoom,
        destination: luckyRoundIndex + 1,
      });
      if (round.luckyCount > 0 && size > advPerRoom) {
        expect(bands[1]).toMatchObject({
          kind: 'lucky-chance',
          rank: advPerRoom + 1,
          spots: round.luckyCount,
          otherwise: 'eliminate',
        });
      }
      const last = bands[bands.length - 1];
      if (last.kind === 'eliminate') expect(last.toRank).toBe(size);
      // Every band's own span stays within the room's declared size.
      for (const band of bands) {
        if ('toRank' in band) expect(band.toRank).toBeLessThanOrEqual(size);
      }
    });
  });

  it('Semis -> per-room bands into the Final; Final -> none', () => {
    const semisIndex = state.rounds.findIndex((round) => round.isSemis);
    const finalIndex = state.rounds.findIndex((round) => round.isFinal);
    expect(roundExitRule(state, finalIndex)).toEqual({ kind: 'none' });
    const rule = roundExitRule(state, semisIndex);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    for (const bands of rule.rooms) {
      const advance = bands.find((band) => band.kind === 'advance');
      if (advance) expect(advance).toMatchObject({ destination: finalIndex });
    }
  });

  it('the reported shape (FFA 16, no pooling): warm-ups -> all-advance; Semis -> 1-4 -> Final, 5-8 eliminate', () => {
    const ffa16 = generate(16, { gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const warmups = ffa16.rounds.filter((round) => round.isNoElim);
    expect(warmups.length).toBeGreaterThan(0);
    warmups.forEach((_, index) => {
      const roundIndex = ffa16.rounds.findIndex((round) => round === warmups[index]);
      expect(roundExitRule(ffa16, roundIndex)).toEqual({ kind: 'all-advance' });
    });
    const semisIndex = ffa16.rounds.findIndex((round) => round.isSemis);
    const finalIndex = ffa16.rounds.findIndex((round) => round.isFinal);
    const rule = roundExitRule(ffa16, semisIndex);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    for (const bands of rule.rooms) {
      expect(bands).toEqual([
        { kind: 'advance', fromRank: 1, toRank: 4, destination: finalIndex },
        { kind: 'eliminate', fromRank: 5, toRank: 8 },
      ]);
    }
  });

  it('consistency: bands + the real lucky-loser pick agree exactly with what advanceTournamentRound produces', () => {
    const scored = scoreInAssignmentOrder(stateAtRound(state, luckyRoundIndex), luckyRoundIndex);
    const result = advanceTournamentRound(scored);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    const realLucky = result.state.luckyLosers[luckyRoundIndex + 1] ?? [];
    expect(realLucky.length).toBeGreaterThan(0); // the fixture is chosen specifically to have lucky spots
    const expected = expectedOutcomes(scored, luckyRoundIndex, realLucky);
    expect(expected.size).toBe(scored.assignments[luckyRoundIndex].length);
    for (const [name, outcome] of expected) {
      if (outcome.kind === 'eliminate') {
        expect(presentAt(result.state, luckyRoundIndex + 1, name)).toBe(false);
      } else {
        expect(presentAt(result.state, outcome.destination as number, name)).toBe(true);
      }
    }
  });
});

describe('roundExitRule -- double elimination', () => {
  it('a WB round: advance to winnersTo, drop to losersTo (1v1 11, race)', () => {
    const state = generate(11, { gameFormat: 'individual-1v1', scheduleLogic: 'double-elimination' });
    const wb0 = state.rounds.findIndex((round) => round.bracket === 'winners');
    const round = state.rounds[wb0];
    const rule = roundExitRule(state, wb0);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    for (const bands of rule.rooms) {
      expect(bands).toEqual([
        { kind: 'advance', fromRank: 1, toRank: 1, destination: round.winnersTo },
        { kind: 'drop', fromRank: 2, toRank: 2, destination: round.losersTo },
      ]);
    }
  });

  it('an LB round: the rest is eliminate, not drop (losersTo is always null on a losers-bracket round)', () => {
    const state = generate(11, { gameFormat: 'individual-1v1', scheduleLogic: 'double-elimination' });
    const lb0 = state.rounds.findIndex((round) => round.bracket === 'losers');
    const round = state.rounds[lb0];
    expect(round.losersTo).toBeNull();
    const rule = roundExitRule(state, lb0);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    for (const bands of rule.rooms) {
      expect(bands.at(-1)).toMatchObject({ kind: 'eliminate' });
    }
  });

  it('grand final (race) and the shared terminal Final both -> none', () => {
    const race = generate(11, { gameFormat: 'individual-1v1', scheduleLogic: 'double-elimination' });
    const grandFinal = race.rounds.findIndex((round) => round.bracket === 'grand-final');
    expect(roundExitRule(race, grandFinal)).toEqual({ kind: 'none' });

    // FFA 17: awkward, non-round count.
    const shared = generate(17, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
    });
    const finalIndex = shared.rounds.findIndex((round) => round.isFinal);
    expect(roundExitRule(shared, finalIndex)).toEqual({ kind: 'none' });
  });

  it('consistency: bands agree exactly with what advanceTournamentRound produces (a WB round, 1v1 11 race -- no lucky losers on a race bracket)', () => {
    const state = generate(11, { gameFormat: 'individual-1v1', scheduleLogic: 'double-elimination' });
    // The default 'none' pooling phase prepends 2 no-elim warm-up rounds
    // ahead of every bracket phase, so the first WB round isn't curRound --
    // jump straight to it, same as the single-elimination lucky-round case
    // above.
    const wb0 = state.rounds.findIndex((round) => round.bracket === 'winners');
    const scored = scoreInAssignmentOrder(stateAtRound(state, wb0), wb0);
    const result = advanceTournamentRound(scored);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    const expected = expectedOutcomes(scored, wb0, []);
    expect(expected.size).toBe(scored.assignments[wb0].length);
    for (const [name, outcome] of expected) {
      expect(outcome.kind).not.toBe('eliminate'); // every WB round row either advances or drops
      expect(presentAt(result.state, outcome.destination as number, name)).toBe(true);
    }
  });

  it('a WB round with lucky losers (FFA 37 shared-Final): a lucky-chance rank drops to the losers bracket instead of being eliminated', () => {
    // The one shape a race bracket can never produce (luckyCount is always 0
    // there): a shared-Final WB round whose lucky-chance rank falls back to
    // `{ drop: losersTo }`, not 'eliminate'.
    const state = generate(37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
    });
    const luckyWb = state.rounds.findIndex((round) => round.bracket === 'winners' && round.luckyCount > 0);
    expect(luckyWb).toBeGreaterThanOrEqual(0); // sanity check on the fixture, not the function under test

    const round = state.rounds[luckyWb];
    const rule = roundExitRule(state, luckyWb);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    let sawLuckyBand = false;
    for (const bands of rule.rooms) {
      const lucky = bands.find(
        (band): band is Extract<RoomExitBand, { kind: 'lucky-chance' }> => band.kind === 'lucky-chance',
      );
      if (lucky) {
        sawLuckyBand = true;
        expect(lucky.otherwise).toEqual({ drop: round.losersTo });
      }
    }
    expect(sawLuckyBand).toBe(true);

    const scored = scoreInAssignmentOrder(stateAtRound(state, luckyWb), luckyWb);
    const result = advanceTournamentRound(scored);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    const realLucky = result.state.luckyLosers[round.winnersTo as number] ?? [];
    expect(realLucky.length).toBeGreaterThan(0); // the fixture is chosen to actually have lucky spots
    const expected = expectedOutcomes(scored, luckyWb, realLucky);
    expect(expected.size).toBe(scored.assignments[luckyWb].length);
    for (const [name, outcome] of expected) {
      expect(outcome.kind).not.toBe('eliminate'); // a WB round row either advances or drops, never eliminates
      expect(presentAt(result.state, outcome.destination as number, name)).toBe(true);
    }
  });
});

describe('roundExitRule -- Kings Valley', () => {
  // FFA 29: awkward, non-round count.
  const state = generate(29, { gameFormat: 'ffa-individual', scheduleLogic: 'kings-valley' });
  const kvIndex = state.rounds.findIndex((round) => round.isKingsValley);
  const round = state.rounds[kvIndex];

  it('has at least top, middle and bottom rooms to distinguish', () => {
    expect(round.rooms.length).toBeGreaterThanOrEqual(3);
  });

  it('top room: no promote band (folds into stay), a demote band at the bottom', () => {
    const rule = roundExitRule(state, kvIndex);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    const bands = rule.rooms[0];
    expect(bands.some((band) => band.kind === 'promote')).toBe(false);
    expect(bands[0].kind).toBe('stay');
    expect(bands.at(-1)?.kind).toBe('demote');
    expect(bands.at(-1)).toMatchObject({ targetRoom: 2 });
  });

  it('a middle room: promote, stay and demote bands, in that order', () => {
    const rule = roundExitRule(state, kvIndex);
    if (rule.kind !== 'per-room') return;
    const middle = 1;
    const bands = rule.rooms[middle];
    expect(bands.map((band) => band.kind)).toEqual(['promote', 'stay', 'demote']);
    expect(bands[0]).toMatchObject({ targetRoom: middle }); // room above, 1-indexed
    expect(bands.at(-1)).toMatchObject({ targetRoom: middle + 2 }); // room below, 1-indexed
  });

  it('bottom room: a promote band, then eliminate (not demote)', () => {
    const rule = roundExitRule(state, kvIndex);
    if (rule.kind !== 'per-room') return;
    const bottom = round.rooms.length - 1;
    const bands = rule.rooms[bottom];
    expect(bands[0].kind).toBe('promote');
    expect(bands.at(-1)?.kind).toBe('eliminate');
    expect(bands.some((band) => band.kind === 'demote')).toBe(false);
  });

  it('every room: bands cover the room exactly, and a real promote/demote count matches kvPromoteCounts/kvDemoteCounts', () => {
    const rule = roundExitRule(state, kvIndex);
    if (rule.kind !== 'per-room') return;
    round.rooms.forEach((size, roomIndex) => {
      const isBottom = roomIndex === round.rooms.length - 1;
      const isTop = roomIndex === 0;
      const bands = rule.rooms[roomIndex];
      const total = bands.reduce(
        (sum, band) => sum + ('toRank' in band ? band.toRank - band.fromRank + 1 : 0),
        0,
      );
      expect(total).toBe(size);
      const promote = bands.find(
        (band): band is Extract<RoomExitBand, { kind: 'promote' }> => band.kind === 'promote',
      );
      if (!isTop) expect(promote?.toRank).toBe(round.kvPromoteCounts?.[roomIndex] ?? 0);
      const demote = bands.find(
        (band): band is Extract<RoomExitBand, { kind: 'demote' }> => band.kind === 'demote',
      );
      if (!isBottom && demote) {
        expect(demote.toRank - demote.fromRank + 1).toBe(round.kvDemoteCounts?.[roomIndex] ?? 0);
      }
    });
  });
});

describe('roundExitRule -- waterfall', () => {
  it('uneven [7,6] rooms splitting differently: each room’s own bands, not a shared shape', () => {
    const graph: OrderedWaterfallGraph = {
      rounds: [
        { label: 'R1', roomSizes: [7, 6], isFinal: false },
        { label: 'R2', roomSizes: [7], isFinal: false },
        { label: 'R3', roomSizes: [2], isFinal: false },
        { label: 'Final', roomSizes: [6], isFinal: true },
      ],
      routes: [
        [
          [1, 1, 1, 1, 1, 'eliminated', 'eliminated'],
          [2, 2, 1, 1, 'eliminated', 'eliminated'],
        ],
        [[3, 3, 3, 3, 'eliminated', 'eliminated', 'eliminated']],
        [[3, 3]],
        [],
      ],
    };
    const rounds = waterfallBracketPhase(13, 1, { graph, finalsGames: 1 });
    const state = createDefaultTournamentState({ rounds });
    const rule = roundExitRule(state, 0);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    expect(rule.rooms[0]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 5, destination: 1 },
      { kind: 'eliminate', fromRank: 6, toRank: 7 },
    ]);
    expect(rule.rooms[1]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 2, destination: 2 },
      { kind: 'advance', fromRank: 3, toRank: 4, destination: 1 },
      { kind: 'eliminate', fromRank: 5, toRank: 6 },
    ]);
  });

  it('non-consecutive routes (same destination, twice, with a different destination between): bands are never merged across the gap', () => {
    const round = buildRound({
      roundNum: 1,
      isWaterfall: true,
      rooms: [4],
      players: 4,
      waterfallRoutes: [[1, 2, 1, 'eliminated']],
    });
    const state = createDefaultTournamentState({
      rounds: [round, buildRound({ roundNum: 2 }), buildRound({ roundNum: 3 })],
    });
    const rule = roundExitRule(state, 0);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    // Four separate bands, one per rank: rank 1 and rank 3 both route to
    // round 1, but aren't adjacent (rank 2 routes elsewhere), so they stay
    // two distinct bands rather than folding together.
    expect(rule.rooms[0]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 1, destination: 1 },
      { kind: 'advance', fromRank: 2, toRank: 2, destination: 2 },
      { kind: 'advance', fromRank: 3, toRank: 3, destination: 1 },
      { kind: 'eliminate', fromRank: 4, toRank: 4 },
    ]);
  });
});

describe('roundExitRule -- qualification table / Swiss / Group Stage standings', () => {
  it('qual table 1v1 13, one non-counting round: excluded vs counted rounds, then a standings-cutoff', () => {
    // 13: awkward, non-round count.
    const state = generate(13, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'qual-table',
      nonCountingRounds: '1',
      qualAdv: '4',
    });
    const qualRounds = state.rounds.filter((round) => round.isQual);
    expect(qualRounds.length).toBeGreaterThanOrEqual(2);
    const firstIndex = state.rounds.indexOf(qualRounds[0]);
    const lastIndex = state.rounds.indexOf(qualRounds[qualRounds.length - 1]);
    expect(qualRounds[0].excludeFromStandings).toBe(true);
    expect(roundExitRule(state, firstIndex)).toEqual({ kind: 'standings', counted: false });
    if (qualRounds.length > 2) {
      const middleIndex = state.rounds.indexOf(qualRounds[1]);
      expect(roundExitRule(state, middleIndex)).toEqual({ kind: 'standings', counted: true });
    }
    expect(roundExitRule(state, lastIndex)).toEqual({
      kind: 'standings-cutoff',
      advancing: 4,
      perGroup: false,
      destination: lastIndex + 1,
    });
  });

  it('Group Stage: a per-group standings-cutoff on the last round', () => {
    // 13: awkward, non-round count.
    const state = generate(13, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      qualifiersPerGroup: '2',
    });
    const groupRounds = state.rounds.filter((round) => round.isGroupStage);
    const lastIndex = state.rounds.indexOf(groupRounds[groupRounds.length - 1]);
    expect(roundExitRule(state, lastIndex)).toEqual({
      kind: 'standings-cutoff',
      advancing: 2,
      perGroup: true,
      destination: lastIndex + 1,
    });
    if (groupRounds.length > 1) {
      const firstIndex = state.rounds.indexOf(groupRounds[0]);
      expect(roundExitRule(state, firstIndex)).toEqual({ kind: 'standings', counted: true });
    }
  });
});

describe('roundExitRule -- after a removal (a room short of its declared size)', () => {
  it('a room with 7 of 8 declared seats filled and advPerRoom 4: bands clip to 7, not 8', () => {
    const round: TournamentRound = buildRound({
      roundNum: 1,
      rooms: [8],
      players: 8,
      advPerRoom: 4,
      luckyCount: 0,
    });
    const assignments: RoundAssignment[][] = [buildAssignments(names(7), [7])];
    const state = createDefaultTournamentState({ rounds: [round, buildRound({ roundNum: 2 })], assignments });
    const rule = roundExitRule(state, 0);
    expect(rule.kind).toBe('per-room');
    if (rule.kind !== 'per-room') return;
    expect(rule.rooms[0]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 1 },
      { kind: 'eliminate', fromRank: 5, toRank: 7 },
    ]);
  });
});

describe('exitBandAtRank', () => {
  it('finds the band covering a fromRank/toRank rank', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
      { kind: 'eliminate', fromRank: 5, toRank: 8 },
    ];
    expect(exitBandAtRank(bands, 3)).toEqual(bands[0]);
    expect(exitBandAtRank(bands, 5)).toEqual(bands[1]);
  });

  it('finds a lucky-chance band by its exact rank, not a range', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
      { kind: 'lucky-chance', rank: 5, spots: 1, otherwise: 'eliminate' },
    ];
    expect(exitBandAtRank(bands, 5)).toEqual(bands[1]);
    expect(exitBandAtRank(bands, 6)).toBeNull();
  });

  it('returns null past every band', () => {
    expect(exitBandAtRank([{ kind: 'eliminate', fromRank: 1, toRank: 2 }], 3)).toBeNull();
  });
});
