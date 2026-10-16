import { describe, expect, it } from 'vitest';
import {
  applyQualCutoffOrder,
  getAllTies,
  hasPendingTies,
  orderedQualificationTable,
  qualTieBoundaryText,
  refreshRoundStandings,
} from '../advancement';
import { addReserveUnit, removeRosterUnit, resolveTournamentTie } from '../mutations';
import { scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound, routeStandings } from '../transitions';
import type { TournamentRound, TournamentState, TournamentStanding } from '../types';
import { playThrough, playWithRemovals, scoreCurrentRound } from './play-through';
import {
  QUAL_GRAPH,
  buildQualWaterfall,
  playToQualificationExit,
  playerNames,
  tiedQualExit,
} from './qual-waterfall';

function advanced(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
  return result.state;
}

function roundIndex(state: TournamentState, label: string): number {
  return state.rounds.findIndex((round) => round.customLabel === label);
}

function names(state: TournamentState, index: number): string[] {
  return (state.assignments[index] ?? []).map((entry) => entry.name);
}

function pendingNames(state: TournamentState, index: number): string[] {
  return (state.pendingBracketSeeds[index] ?? []).map((entry) => entry.name);
}

/** Everyone seated in a bracket-phase round or waiting in a bracket-phase pool. */
function bracketPhaseNames(state: TournamentState): Set<string> {
  const firstBracket = state.rounds.findIndex((round) => round.isWaterfall);
  return new Set([
    ...state.assignments.slice(firstBracket).flatMap((entries) => entries.map((entry) => entry.name)),
    ...Object.values(state.pendingBracketSeeds).flatMap((seeds) => seeds.map((seed) => seed.name)),
  ]);
}

/** The qualification standings in rank order, as the pooling exit reads them. */
function standingsOrder(state: TournamentState): string[] {
  return orderedQualificationTable(state).ordered.map((entry) => entry.name);
}

describe('the pooling exit of a waterfall graph with a Qual source', () => {
  it.each([
    [31, 7],
    [37, 13],
    [43, 19],
    [53, 29],
  ])(
    'at %i registered: R1 gets ranks 1-16, R1C waits with 17-24, the other %i are out',
    (registered, out) => {
      const exit = playToQualificationExit(buildQualWaterfall(registered));
      const order = standingsOrder(exit);
      expect(order).toHaveLength(registered);

      const next = advanced(exit);
      const r1 = roundIndex(next, 'R1');
      const r1c = roundIndex(next, 'R1C');
      expect(next.curRound).toBe(r1);
      expect(new Set(names(next, r1))).toEqual(new Set(order.slice(0, 16)));
      expect(next.rounds[r1].rooms).toEqual([8, 8]);
      // Ranks 1 and 2 are seeded into different rooms.
      const roomOf = (name: string) => next.assignments[r1].find((entry) => entry.name === name)?.room;
      expect(roomOf(order[0])).not.toBe(roomOf(order[1]));
      // 17-24 wait in R1C's pool, in standings order.
      expect(pendingNames(next, r1c)).toEqual(order.slice(16, 24));
      // Everyone else is in no assignment and no pool.
      const placed = bracketPhaseNames(next);
      const eliminated = order.slice(24);
      expect(eliminated).toHaveLength(out);
      for (const name of eliminated) expect(placed.has(name)).toBe(false);
    },
  );

  it('seeds R1 with the same balanced draw as any waterfall arrival: ranks 3-4 split across the two rooms too', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const order = standingsOrder(exit);
    const next = advanced(exit);
    const r1 = roundIndex(next, 'R1');
    const roomOf = (name: string) => next.assignments[r1].find((entry) => entry.name === name)?.room;
    expect(roomOf(order[2])).not.toBe(roomOf(order[3]));
  });

  it('draws R1C with exactly qualification ranks 17-24 once R1 has been played', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const order = standingsOrder(exit);
    const atR1 = advanced(exit);
    const atR1C = advanced(scoreCurrentRound(atR1, 0));
    const r1c = roundIndex(atR1C, 'R1C');
    expect(atR1C.curRound).toBe(r1c);
    expect(new Set(names(atR1C, r1c))).toEqual(new Set(order.slice(16, 24)));
    expect(atR1C.pendingBracketSeeds[r1c]).toBeUndefined();
  });

  it('keeps a gap graph exact: ranks 17-19 are out and 20-27 reach R1C', () => {
    const gapGraph = QUAL_GRAPH.replace(
      'Qual: 1-16->R1, 17-24->R1C',
      'Qual: 1-16->R1, 17-19->eliminated, 20-27->R1C',
    );
    const exit = playToQualificationExit(buildQualWaterfall(31, gapGraph));
    const order = standingsOrder(exit);
    const next = advanced(exit);
    const r1 = roundIndex(next, 'R1');
    const r1c = roundIndex(next, 'R1C');
    expect(new Set(names(next, r1))).toEqual(new Set(order.slice(0, 16)));
    expect(pendingNames(next, r1c)).toEqual(order.slice(19, 27));
    const placed = bracketPhaseNames(next);
    for (const name of [...order.slice(16, 19), ...order.slice(27)]) expect(placed.has(name)).toBe(false);
    expect(order.slice(27)).toHaveLength(4);
  });

  it('routes from the ordered table, not from the top-qualAdv names: tierRank is the position within its destination', () => {
    const table = playerNames(6).map((name, index): TournamentStanding => ({
      name,
      totalFP: 10 - index,
      totalScore: 0,
      played: 1,
      roomShare: 1 - index / 10,
    }));
    const round = { standingsRoutes: [5, 5, 7, 'eliminated', 7] } as unknown as TournamentRound;
    const routed = routeStandings(table, round);
    expect(routed.get(5)).toEqual([
      { name: 'P1', isLucky: false, tierRank: 0, pct: 1 },
      { name: 'P2', isLucky: false, tierRank: 1, pct: 0.9 },
    ]);
    expect(routed.get(7)?.map((seed) => [seed.name, seed.tierRank])).toEqual([
      ['P3', 0],
      ['P5', 1],
    ]);
    // P4 is eliminated and P6 lies past the end of the routing.
    expect([...routed.values()].flat().map((seed) => seed.name)).not.toContain('P4');
    expect([...routed.values()].flat().map((seed) => seed.name)).not.toContain('P6');
  });
});

describe('qualification ties at the band boundaries', () => {
  /** The exit state with a hand-made qualification table: ranks 1..n, with `tiedFrom..tiedTo` (1-based) level. */
  function withTiedPositions(tiedFrom: number, tiedTo: number): TournamentState {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const qualTable = playerNames(37).map((name, index): TournamentStanding => {
      const rank = index + 1;
      const level = rank >= tiedFrom && rank <= tiedTo;
      return {
        name,
        totalFP: level ? 100 - tiedFrom : 100 - rank,
        totalScore: 0,
        played: 3,
        roomShare: 1,
      };
    });
    return { ...exit, qualTable };
  }

  /** The hand-made table counts as the stored table of a past round; the current round is checked on fresh standings. */
  const asPastRound = (state: TournamentState): TournamentState => ({
    ...state,
    curRound: state.curRound + 1,
  });
  const exitRound = (state: TournamentState) => state.curRound;
  const tieKeys = (state: TournamentState) =>
    Object.keys(getAllTies(asPastRound(state), exitRound(state))).filter((key) => key.startsWith('qual-'));

  it('has no tie where level units all fall in the same band', () => {
    expect(tieKeys(withTiedPositions(3, 4))).toEqual([]);
    expect(tieKeys(withTiedPositions(18, 20))).toEqual([]);
  });

  it('has no tie where level units are all eliminated', () => {
    expect(tieKeys(withTiedPositions(26, 29))).toEqual([]);
  });

  it('keys a tie straddling the 16|17 boundary by its first rank', () => {
    expect(tieKeys(withTiedPositions(15, 17))).toEqual(['qual-band-15']);
  });

  it('keys a tie straddling the 24|25 boundary (the last routed rank) as qual-cutoff', () => {
    expect(tieKeys(withTiedPositions(24, 26))).toEqual(['qual-cutoff']);
  });

  it('treats one cluster straddling both boundaries as a single qual-cutoff tie', () => {
    const state = withTiedPositions(15, 26);
    expect(tieKeys(state)).toEqual(['qual-cutoff']);
    const cluster = getAllTies(asPastRound(state), exitRound(state))['qual-cutoff'];
    expect(cluster.players).toHaveLength(12);
  });

  it('reports two separate clusters when each boundary has its own tie', () => {
    const exit = withTiedPositions(16, 17);
    const qualTable = exit.qualTable.map((entry, index) =>
      index === 23 || index === 24 ? { ...entry, totalFP: 76 } : entry,
    );
    expect(tieKeys({ ...exit, qualTable })).toEqual(['qual-band-16', 'qual-cutoff']);
  });

  it('applies a band tie resolution to the order the routing reads', () => {
    const state = withTiedPositions(16, 17);
    const before = applyQualCutoffOrder(state.qualTable, state).map((entry) => entry.name);
    expect(before.slice(15, 17)).toEqual(['P16', 'P17']);
    const resolved = resolveTournamentTie(state, 'qual-band-16', 'P17');
    const after = applyQualCutoffOrder(resolved.qualTable, resolved).map((entry) => entry.name);
    expect(after.slice(15, 17)).toEqual(['P17', 'P16']);
  });

  it('counts a band tie as pending until resolved', () => {
    const state = withTiedPositions(16, 17);
    expect(hasPendingTies(asPastRound(state), exitRound(state))).toBe(true);
    const resolved = resolveTournamentTie(state, 'qual-band-16', 'P17');
    expect(hasPendingTies(asPastRound(resolved), exitRound(resolved))).toBe(false);
  });
});

describe('a real tie at the band boundaries blocks the exit until it is resolved', () => {
  it('names the destinations each cluster decides between', () => {
    const exit = tiedQualExit();
    const ties = getAllTies(refreshRoundStandings(exit, exit.curRound), exit.curRound);
    const text = (key: string) => {
      const tie = ties[key];
      return 'firstRank' in tie ? qualTieBoundaryText(exit, tie) : null;
    };
    expect(text('qual-band-13')).toBe('R1 and R1C');
    expect(text('qual-cutoff')).toBe('R1C and elimination');
  });

  it('blocks Next Round on the two clusters, then draws the picked units into the higher band', () => {
    const exit = tiedQualExit();
    const blocked = advanceTournamentRound(exit);
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') return;
    expect(blocked.reason).toBe('pending-ties');

    const ties = getAllTies(refreshRoundStandings(exit, exit.curRound), exit.curRound);
    expect(Object.keys(ties).filter((key) => key.startsWith('qual-'))).toEqual([
      'qual-band-13',
      'qual-cutoff',
    ]);

    // Rank each cluster in the order of its listed players, last-listed first so the pick matters.
    let state = exit;
    const picks = new Map<string, string[]>();
    for (const key of ['qual-band-13', 'qual-cutoff']) {
      const members = ties[key].players.map((player) => player.name);
      const order = [...members].reverse();
      picks.set(key, order);
      for (const name of order.slice(0, members.length - 1)) state = resolveTournamentTie(state, key, name);
    }
    const next = advanced(state);
    const r1 = roundIndex(next, 'R1');
    const r1c = roundIndex(next, 'R1C');
    const band = picks.get('qual-band-13') as string[];
    const cut = picks.get('qual-cutoff') as string[];
    // Band 13-16: the first two picks take ranks 13-14 (R1), the other two 15-16 (R1C).
    expect(names(next, r1)).toEqual(expect.arrayContaining(band.slice(0, 2)));
    expect(names(next, r1)).not.toEqual(expect.arrayContaining([band[2]]));
    expect(pendingNames(next, r1c)).toEqual(expect.arrayContaining([band[2], band[3]]));
    // Cut-off cluster 21-24: the first two picks take ranks 21-22 (R1C), the other two are out.
    expect(pendingNames(next, r1c)).toEqual(expect.arrayContaining(cut.slice(0, 2)));
    expect(bracketPhaseNames(next).has(cut[2])).toBe(false);
    expect(bracketPhaseNames(next).has(cut[3])).toBe(false);
    expect(pendingNames(next, r1c)).toHaveLength(8);
  });
});

describe('a withdrawal during qualification', () => {
  it('keeps the standings routing and the derived qualAdv, and still routes exactly 24 ranks', () => {
    const start = buildQualWaterfall(31);
    const victim = start.assignments[0][0].name;
    const removed = removeRosterUnit(start, victim);
    const lastQual = removed.rounds.filter((round) => round.isQual).at(-1);
    expect(removed.cfg.qualAdv).toBe(24);
    expect(lastQual?.standingsRoutes).toHaveLength(24);

    const exit = playToQualificationExit(removed);
    const order = standingsOrder(exit);
    expect(order).toHaveLength(30);
    const next = advanced(exit);
    expect(pendingNames(next, roundIndex(next, 'R1C'))).toEqual(order.slice(16, 24));
    expect(order.slice(24)).toHaveLength(6);
  });

  it('blocks Next Round, naming both numbers, when withdrawals leave fewer ranked units than routed ranks', () => {
    const play = playWithRemovals(buildQualWaterfall(25), 0, [0, 0]);
    expect(play.outcome.kind).toBe('blocked');
    if (play.outcome.kind !== 'blocked') return;
    expect(play.outcome.reason).toBe('too-few-units');
    expect(play.outcome.message).toContain('ranks 23 unit(s)');
    expect(play.outcome.message).toContain('up to 24');
    expect(play.outcome.message).toContain('Edit graph');
  });

  it('takes a late reserve during qualification without touching its rounds: the exit routing fits whoever arrives', () => {
    const state = { ...buildQualWaterfall(31), reserves: ['Late'], reserveOpen: true };
    const result = addReserveUnit(state, 'Late');
    expect(result.status).toBe('added');
    if (result.status === 'added') expect(result.state.rounds).toEqual(state.rounds);
  });
});

describe('a whole waterfall played from the qualification table', () => {
  it('plays a Qual-line graph end to end at 37 registered', () => {
    expect(playThrough(buildQualWaterfall(37), 0, null)).toEqual({ kind: 'ok' });
  });

  it('plays a qualification-table graph without a Qual line (read as Qual: 1-16 -> R1) end to end', () => {
    const graph = `
ROUNDS:
R1 = 2x8
SemiB = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-3->Final, 4-7->SemiB, 8->eliminated
R1.B: 1-3->Final, 4-7->SemiB, 8->eliminated
SemiB: 1-2->Final, 3-8->eliminated
`;
    const start = buildQualWaterfall(37, graph);
    expect(start.cfg.qualAdv).toBe(16);
    expect(playThrough(start, 0, null)).toEqual({ kind: 'ok' });
  });
});

describe('going back to the last qualification round after the pooling exit', () => {
  function goBack(state: TournamentState): TournamentState {
    return { ...state, curRound: state.curRound - 1 };
  }

  /** Raises one unit's score in the current round far above everyone else's. */
  function boostScore(state: TournamentState, name: string): TournamentState {
    const round = state.rounds[state.curRound];
    const entries = state.assignments[state.curRound] ?? [];
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry || entry.room === null) throw new Error(`${name} is not seated in a room`);
    const position = entries
      .filter((other) => other.room === entry.room)
      .findIndex((other) => other.name === name);
    const [key] = scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: undefined,
    });
    return { ...state, scores: { ...state.scores, [key]: 1_000_000 } };
  }

  it('re-draws R1 and rebuilds the R1C pool instead of adding the qualifiers a second time', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const order = standingsOrder(exit);
    const redrawn = advanced(goBack(advanced(exit)));
    const r1c = roundIndex(redrawn, 'R1C');
    expect(pendingNames(redrawn, r1c)).toEqual(order.slice(16, 24));
    expect(new Set(names(redrawn, roundIndex(redrawn, 'R1')))).toEqual(new Set(order.slice(0, 16)));
  });

  it('follows a corrected qualification score: the new order feeds R1 and the R1C pool, with no duplicates', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const before = standingsOrder(exit);
    const climber = before[16];
    const corrected = boostScore(exit, climber);
    const after = standingsOrder(corrected);
    expect(after.indexOf(climber)).toBeLessThan(16);

    const redrawn = advanced(boostScore(goBack(advanced(exit)), climber));
    const r1 = roundIndex(redrawn, 'R1');
    const r1c = roundIndex(redrawn, 'R1C');
    expect(new Set(names(redrawn, r1))).toEqual(new Set(after.slice(0, 16)));
    expect(names(redrawn, r1)).toContain(climber);
    expect(pendingNames(redrawn, r1c)).toEqual(after.slice(16, 24));
    expect(new Set(pendingNames(redrawn, r1c)).size).toBe(8);
  });

  it('plays on to the Final after the re-draw', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const redrawn = advanced(goBack(advanced(exit)));
    expect(playThrough(redrawn, 0, null)).toEqual({ kind: 'ok' });
  });
});
