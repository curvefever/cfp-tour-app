import { describe, expect, it } from 'vitest';
import { orderRoomByScore } from '../scoring';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import {
  fitWaterfallRound,
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
  waterfallDestination,
  waterfallStandingsRoutes,
  type OrderedWaterfallGraph,
} from '../waterfall-bracket';
import { buildAssignments, buildRound } from './test-fixtures';
import type { RoomSize } from '../types';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
// Permissive bound for tests that aren't exercising rule 1 (room-size bounds)
// specifically -- keeps minimal, small-room fixtures from spuriously
// tripping that rule before the one actually under test.
const ANY_ROOM_SIZE: RoomSize = { min: 1, max: 20, ideal: 8 };

// The exact structure traced cell-by-cell from the real organiser
// spreadsheet ("Matches 40p" tab) that this whole feature was built
// against -- see HANDOFF_LOG.md.
const SPREADSHEET_GRAPH = `
ROUNDS:
5 = 4x8
6B = 8
6C = 8
7A = 8
SemiA = 8
SemiB = 8
Final = 8 FINAL

ROUTES:
5.A: 1-4->SemiA, 5,8->6B, 6,7->6C
5.B: 1-4->SemiA, 6,7->6B, 5,8->6C
5.C: 1,4->6C, 2,3->6B, 5-8->eliminated
5.D: 1,4->6B, 2,3->6C, 5-8->eliminated
SemiA: 1-4->Final, 5-8->SemiB
6B: 1-4->7A, 5-8->eliminated
6C: 1-4->7A, 5-8->eliminated
7A: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;

function parseAndValidate(text: string, entrantCount = 32, roomSize = ANY_ROOM_SIZE, fixedPrefix?: string[]) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize, entrantCount, fixedPrefix });
}

describe('parseWaterfallGraph + validateAndOrderWaterfallGraph -- the worked spreadsheet example', () => {
  it('parses and orders the real 40-player structure exactly, resolving every band to the right index', () => {
    const result = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Kahn's algorithm, FIFO queue: "5" first (the only round with no
    // incoming routes), then everything that becomes ready in the same
    // wave (SemiA, 6B, 6C -- all fed only by "5") in declaration order,
    // then 7A (fed by both 6B and 6C), then SemiB (fed by SemiA's bottom
    // half and 7A), then Final last.
    expect(result.value.rounds.map((round) => round.label)).toEqual([
      '5',
      'SemiA',
      '6B',
      '6C',
      '7A',
      'SemiB',
      'Final',
    ]);
    expect(result.value.rounds.map((round) => round.roomSizes)).toEqual([
      [8, 8, 8, 8],
      [8],
      [8],
      [8],
      [8],
      [8],
      [8],
    ]);
    expect(result.value.rounds.map((round) => round.isFinal)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);

    // index map: 5=0, SemiA=1, 6B=2, 6C=3, 7A=4, SemiB=5, Final=6
    // Room 5.A: 1-4->SemiA(1), 5,8->6B(2), 6,7->6C(3)
    expect(result.value.routes[0][0]).toEqual([1, 1, 1, 1, 2, 3, 3, 2]);
    // Room 5.D: 1,4->6B(2), 2,3->6C(3), 5-8->eliminated
    expect(result.value.routes[0][3]).toEqual([
      2,
      3,
      3,
      2,
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
    ]);

    // SemiA (index 1): 1-4->Final(6), 5-8->SemiB(5)
    expect(result.value.routes[1][0]).toEqual([6, 6, 6, 6, 5, 5, 5, 5]);
    // 6B (index 2): 1-4->7A(4), 5-8->eliminated
    expect(result.value.routes[2][0]).toEqual([
      4,
      4,
      4,
      4,
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
    ]);
    // Final (index 6): no outgoing routes
    expect(result.value.routes[6]).toEqual([]);
  });
});

describe('parseWaterfallGraph -- syntax-level errors', () => {
  it('rejects a ROUNDS line missing "="', () => {
    const result = parseWaterfallGraph('ROUNDS:\n5 4x8\nROUTES:\n5.A: 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing "="');
  });

  it('rejects an invalid round label', () => {
    const result = parseWaterfallGraph('ROUNDS:\nSemi.A = 8 FINAL\nROUTES:\n5: 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        'Round label "Semi.A" is invalid -- labels use letters, digits, spaces and dashes, and start and end with a letter or digit.',
      );
    }
  });

  it('rejects a duplicate round label', () => {
    const result = parseWaterfallGraph('ROUNDS:\n5 = 8\n5 = 8 FINAL\nROUTES:\n5: 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Duplicate round label');
  });

  it('rejects an unrecognized size spec', () => {
    const result = parseWaterfallGraph('ROUNDS:\n5 = abc\nROUTES:\n5: 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unrecognized size');
  });

  it('rejects a ROUTES line missing ":"', () => {
    const result = parseWaterfallGraph('ROUNDS:\n5 = 8 FINAL\nROUTES:\n5 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing ":"');
  });

  it('rejects a dangling rank with no destination', () => {
    const result = parseWaterfallGraph('ROUNDS:\n5 = 8\nFinal = 8 FINAL\nROUTES:\n5: 1-4->Final, 5-8');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ends without a destination');
  });

  it('rejects a backwards rank range', () => {
    const graph = parseWaterfallGraph('ROUNDS:\n5 = 8\nFinal = 8 FINAL\nROUTES:\n5: 4-1->Final');
    expect(graph.ok).toBe(true);
    if (!graph.ok) return;
    const result = validateAndOrderWaterfallGraph(graph.value, { roomSize: FFA_ROOM_SIZE, entrantCount: 8 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('backwards');
  });

  it('reports missing ROUNDS/ROUTES sections', () => {
    expect(parseWaterfallGraph('ROUTES:\n5: 1-8->eliminated').ok).toBe(false);
    expect(parseWaterfallGraph('ROUNDS:\n5 = 8 FINAL').ok).toBe(false);
  });
});

describe('validateAndOrderWaterfallGraph -- validation rules', () => {
  it('rule 1: rejects a room size outside the format bounds', () => {
    // FFA_ROOM_SIZE caps rooms at 8 -- a declared room of 10 exceeds that.
    const text = 'ROUNDS:\n5 = 1x10\nFinal = 10 FINAL\nROUTES:\n5: 1-10->Final';
    const result = parseAndValidate(text, 10, FFA_ROOM_SIZE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('outside this format');
  });

  it('rule 2: rejects a graph with no FINAL round', () => {
    const text = 'ROUNDS:\n5 = 8\n6 = 8\nROUTES:\n5: 1-8->6\n6: 1-8->eliminated';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('No round is marked FINAL');
  });

  it('rule 2: rejects a graph with two FINAL rounds', () => {
    const text = 'ROUNDS:\n5 = 8\n6 = 8 FINAL\n7 = 8 FINAL\nROUTES:\n5: 1-8->6';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('More than one round is marked FINAL');
  });

  it('rule 2: rejects an outgoing ROUTES line for the FINAL round', () => {
    const text = 'ROUNDS:\n5 = 8\nFinal = 8 FINAL\nROUTES:\n5: 1-8->Final\nFinal: 1-8->eliminated';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('nothing routes out of the Final');
  });

  it('rule 3: rejects a bare address for a multi-room round', () => {
    const text = 'ROUNDS:\n5 = 2x4\nFinal = 8 FINAL\nROUTES:\n5: 1-4->Final';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('address each one as');
  });

  it('rule 3: rejects a lettered address for a single-room round', () => {
    const text = 'ROUNDS:\n5 = 8\nFinal = 8 FINAL\nROUTES:\n5.A: 1-8->Final';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('only 1 room');
  });

  it("rule 3: reads a multi-room round's room with no ROUTES line as all eliminated", () => {
    const text = 'ROUNDS:\n5 = 2x4\nFinal = 4 FINAL\nROUTES:\n5.A: 1-4->Final';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routes[0]).toEqual([
      [1, 1, 1, 1],
      ['eliminated', 'eliminated', 'eliminated', 'eliminated'],
    ]);
  });

  it('rule 3: refuses a single-room round with no ROUTES line as a dead end', () => {
    const text = 'ROUNDS:\n5 = 4\n6 = 2\nFinal = 2 FINAL\nROUTES:\n5: 1-2->6, 3-4->Final';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Round "6" sends nobody on');
  });

  it('rule 4: reads a rank no band routes as eliminated', () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 2 FINAL\nROUTES:\n5: 1-2->Final';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routes[0]).toEqual([[1, 1, 'eliminated', 'eliminated']]);
  });

  it('rule 4: refuses a multi-room round whose every room eliminates every rank (a dead end)', () => {
    for (const routes of ['', '6.A: 1-2->eliminated\n6.B: 1-2->eliminated']) {
      const text = `ROUNDS:\n5 = 2x4\n6 = 2x2\nFinal = 4 FINAL\nROUTES:\n5.A: 1-2->6, 3-4->Final\n5.B: 1-2->6, 3-4->Final\n${routes}`;
      const result = parseAndValidate(text, 8);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Round "6" sends nobody on');
    }
  });

  it("rule 4: rejects an overlap in a room's rank coverage", () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Final, 2->eliminated';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('routed more than once');
  });

  it('rule 5: rejects a destination that was never declared in ROUNDS', () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Ghost';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("isn't declared in ROUNDS");
  });

  it('rule 5: rejects a self-loop', () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->5';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('routes to itself');
  });

  it('rule 6: rejects a cycle', () => {
    const text = 'ROUNDS:\nA = 4\nB = 4\nFinal = 4 FINAL\nROUTES:\nA: 1-4->B\nB: 1-4->A';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cycle');
  });

  it('rule 7: rejects a round whose declared size does not match its incoming bands', () => {
    // "6" declares 8 but only 4 ranks of "5" route into it.
    const text = 'ROUNDS:\n5 = 4\n6 = 8\nFinal = 4 FINAL\nROUTES:\n5: 1-4->6\n6: 1-4->Final, 5-8->eliminated';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must exactly match what routes into it');
  });

  it('rule 8: rejects an unreachable round (a second, disconnected source)', () => {
    const text = 'ROUNDS:\n5 = 4\nGhost = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Final\nGhost: 1-4->Final';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('there must be exactly one starting round');
  });

  it('rule 9: rejects an entry round whose total does not match the real entrant count', () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Final';
    const result = parseAndValidate(text, 5); // 5 real entrants, but "5" only declares 4
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must match exactly');
  });

  it('accepts a plateau-free minimal 2-round graph as a sanity baseline', () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Final';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.map((round) => round.label)).toEqual(['5', 'Final']);
    expect(result.value.routes[0][0]).toEqual([1, 1, 1, 1]);
  });
});

describe('waterfallBracketPhase', () => {
  it('materializes the spreadsheet graph into TournamentRounds, resolving every route to an absolute round index', () => {
    const parsed = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // startRoundNum = 4 (this phase isn't the tournament's first round) so
    // that a passing test can't be hiding an accidental off-by-one against
    // startRoundNum, or a mixup between roundNum and array index.
    const rounds = waterfallBracketPhase(32, 4, { graph: parsed.value, finalsGames: 3 });

    expect(rounds.map((round) => round.customLabel)).toEqual([
      '5',
      'SemiA',
      '6B',
      '6C',
      '7A',
      'SemiB',
      'Final',
    ]);
    expect(rounds.map((round) => round.roundNum)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(rounds.every((round) => round.isWaterfall)).toBe(true);
    expect(rounds.map((round) => round.isFinal)).toEqual([false, false, false, false, false, false, true]);

    // Round "5" (array index 0): rooms/players/byes/advancement-agnostic
    // fields all read straight off the graph; no bye/lucky-loser concept.
    const round5 = rounds[0];
    expect(round5.rooms).toEqual([8, 8, 8, 8]);
    expect(round5.players).toBe(32);
    expect(round5.byeCount).toBe(0);
    expect(round5.advPerRoom).toBeNull();
    expect(round5.luckyCount).toBe(0);
    // 5.C and 5.D each eliminate 4 (ranks 5-8); 5.A/5.B eliminate none.
    expect(round5.advTotal).toBe(24);

    // Room 5.A: 1-4->SemiA(array index 1), 5,8->6B(2), 6,7->6C(3) -- resolved
    // to absolute indices via startRoundNum-1 (=3) + relative index.
    expect(round5.waterfallRoutes?.[0]).toEqual([4, 4, 4, 4, 5, 6, 6, 5]);
    // Room 5.D: 1,4->6B(2), 2,3->6C(3), 5-8->eliminated.
    expect(round5.waterfallRoutes?.[3]).toEqual([
      5,
      6,
      6,
      5,
      'eliminated',
      'eliminated',
      'eliminated',
      'eliminated',
    ]);

    // SemiA (array index 1, absolute round index 4): a genuine skip-ahead
    // destination -- reached directly from Round 5, several rounds before
    // 6B/6C/7A finish feeding SemiB.
    const semiA = rounds[1];
    expect(semiA.customLabel).toBe('SemiA');
    expect(semiA.rooms).toEqual([8]);
    // 1-4->Final(array index 6), 5-8->SemiB(array index 5).
    expect(semiA.waterfallRoutes?.[0]).toEqual([9, 9, 9, 9, 8, 8, 8, 8]);
    expect(semiA.advTotal).toBe(8); // nobody eliminated out of SemiA itself

    // Final (array index 6): no outgoing routes, advTotal forced to 1 (the
    // eventual champion) regardless of players, matching every other
    // builder's own Final convention.
    const final = rounds[6];
    expect(final.customLabel).toBe('Final');
    expect(final.isFinal).toBe(true);
    expect(final.rooms).toEqual([8]);
    expect(final.players).toBe(8);
    expect(final.waterfallRoutes).toEqual([]);
    expect(final.advTotal).toBe(1);
  });

  it('throws if seedTotal does not match the graph’s own validated entry total (internal consistency guard)', () => {
    const parsed = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(() => waterfallBracketPhase(31, 1, { graph: parsed.value, finalsGames: 3 })).toThrow(
      /doesn't match the graph's own validated entry-round total/,
    );
  });

  it('builds a minimal 2-round graph correctly, including the Final-round advTotal override', () => {
    const parsed = parseAndValidate('ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-4->Final', 4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rounds = waterfallBracketPhase(4, 1, { graph: parsed.value, finalsGames: 3 });
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({
      roundNum: 1,
      players: 4,
      rooms: [4],
      isFinal: false,
      isWaterfall: true,
      customLabel: '5',
      advTotal: 4,
      waterfallRoutes: [[1, 1, 1, 1]],
    });
    expect(rounds[1]).toMatchObject({
      roundNum: 2,
      players: 4,
      rooms: [4],
      isFinal: true,
      advTotal: 1,
      waterfallRoutes: [],
    });
  });

  it("gives only the Final round the organiser's chosen number of games", () => {
    const parsed = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rounds = waterfallBracketPhase(32, 1, { graph: parsed.value, finalsGames: 4 });
    expect(rounds[rounds.length - 1].numGames).toBe(4);
    expect(rounds.slice(0, -1).every((round) => round.numGames === undefined)).toBe(true);
  });
});

describe('waterfallDestination', () => {
  // Uneven [7,6] R1 whose two rooms split differently -- deliberately not
  // authorable through the ROUNDS/ROUTES text (a round's rooms are all the
  // same size there), so the graph is written out directly; the routing
  // logic is room-size-agnostic and a removal can leave rooms uneven anyway.
  const UNEVEN_GRAPH: OrderedWaterfallGraph = {
    rounds: [
      { label: 'R1', roomSizes: [7, 6], isFinal: false },
      { label: 'R2', roomSizes: [7], isFinal: false },
      { label: 'R3', roomSizes: [2], isFinal: false },
      { label: 'Final', roomSizes: [6], isFinal: true },
    ],
    columns: [1, 2, 3, 4],
    routes: [
      [
        // Room A: ranks 1-5 -> R2, 6-7 eliminated.
        [1, 1, 1, 1, 1, 'eliminated', 'eliminated'],
        // Room B: ranks 1-2 -> R3 (skips R2), 3-4 -> R2, 5-6 eliminated.
        [2, 2, 1, 1, 'eliminated', 'eliminated'],
      ],
      [[3, 3, 3, 3, 'eliminated', 'eliminated', 'eliminated']],
      [[3, 3]],
      [],
    ],
  };
  const START_ROUND_NUM = 1;
  const rounds = waterfallBracketPhase(13, START_ROUND_NUM, { graph: UNEVEN_GRAPH, finalsGames: 1 });

  it('returns the absolute round index for a routed rank, including a non-adjacent skip', () => {
    expect(waterfallDestination(rounds[0], 1, 0)).toBe(1);
    expect(waterfallDestination(rounds[0], 1, 4)).toBe(1);
    expect(waterfallDestination(rounds[0], 2, 0)).toBe(2);
    expect(waterfallDestination(rounds[0], 2, 2)).toBe(1);
  });

  it('returns null for an eliminated rank, per room', () => {
    expect(waterfallDestination(rounds[0], 1, 5)).toBeNull();
    expect(waterfallDestination(rounds[0], 1, 6)).toBeNull();
    expect(waterfallDestination(rounds[0], 2, 4)).toBeNull();
    expect(waterfallDestination(rounds[0], 2, 5)).toBeNull();
  });

  it('returns null for a rank index or room beyond the routes', () => {
    expect(waterfallDestination(rounds[0], 2, 6)).toBeNull();
    expect(waterfallDestination(rounds[0], 3, 0)).toBeNull();
    expect(waterfallDestination(rounds[0], 0, 0)).toBeNull();
  });

  it('returns null for a round with no waterfall routes', () => {
    expect(waterfallDestination(buildRound({ roundNum: 1, rooms: [4], players: 4 }), 1, 0)).toBeNull();
    expect(waterfallDestination(rounds[3], 1, 0)).toBeNull();
  });

  it('agrees with what advanceTournamentRound actually routes, using each room’s resolved rank order', () => {
    const roomA = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
    const roomB = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    const scores: Record<string, number> = {};
    // Room A: A5 and A6 tie on 200 straddling the 5th/6th (advance/eliminated)
    // boundary; the tie is resolved in A6's favour, so A6 advances, A5 doesn't.
    [700, 600, 500, 400, 200, 200, 100].forEach((score, position) => {
      scores[`r0-rm1-p${position}`] = score;
    });
    // Room B: scored out of seating order so rank != position.
    [100, 600, 300, 500, 200, 400].forEach((score, position) => {
      scores[`r0-rm2-p${position}`] = score;
    });
    const state = createDefaultTournamentState({
      rounds,
      assignments: [buildAssignments([...roomA, ...roomB], [7, 6])],
      scores,
      tieResolutions: { 'r0-rm1-s200': ['A6', 'A5'] },
      curRound: 0,
    });

    const expectedByDestination = new Map<number, string[]>();
    const rooms = [roomA, roomB];
    rooms.forEach((names, roomIndex) => {
      const room = roomIndex + 1;
      const scored = names.map((name, position) => ({
        name,
        position,
        score: scores[`r0-rm${room}-p${position}`],
      }));
      orderRoomByScore(scored, 0, room, state).forEach((entry, rankIndex) => {
        const destination = waterfallDestination(rounds[0], room, rankIndex);
        if (destination === null) return;
        expectedByDestination.set(destination, [
          ...(expectedByDestination.get(destination) ?? []),
          entry.name,
        ]);
      });
    });
    // The resolved tie decides the boundary: A6 advances, A5 is out.
    expect(expectedByDestination.get(1)).toContain('A6');
    expect(expectedByDestination.get(1)).not.toContain('A5');

    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;

    const actualR2 = (result.state.assignments[1] ?? []).map((entry) => entry.name).sort();
    const pendingR3 = (result.state.pendingBracketSeeds[2] ?? []).map((seed) => seed.name).sort();
    expect(actualR2).toEqual([...(expectedByDestination.get(1) ?? [])].sort());
    expect(pendingR3).toEqual([...(expectedByDestination.get(2) ?? [])].sort());
    expect(actualR2).toHaveLength(7);
    expect(pendingR3).toEqual(['B2', 'B4']);
  });
});

describe('validateAndOrderWaterfallGraph -- fixedPrefix', () => {
  it('starts the returned order with exactly the given prefix, in that order, then the rest via Kahn as normal', () => {
    const result = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE, ['5', 'SemiA']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.map((round) => round.label)).toEqual([
      '5',
      'SemiA',
      '6B',
      '6C',
      '7A',
      'SemiB',
      'Final',
    ]);
  });

  it('leaves the order and every other rule unaffected when the prefix is empty', () => {
    expect(parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE, [])).toEqual(
      parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE),
    );
  });

  it('refuses a prefix round fed by a round outside the prefix', () => {
    // 7A is fed by 6B and 6C, neither of which is in this prefix.
    const result = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE, ['5', '7A']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"7A"');
    expect(result.error).toContain("hasn't been played yet");
  });

  it('refuses a prefix that names a round the graph no longer declares', () => {
    const result = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE, ['5', 'Nonexistent']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"Nonexistent"');
    expect(result.error).toContain('no longer declares');
  });

  it("refuses a prefix whose first round isn't the graph's actual entry round", () => {
    // SemiA is fed by "5", but this prefix claims SemiA was played before "5".
    const result = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE, ['SemiA', '5']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"SemiA"');
    expect(result.error).toContain('entry round');
  });

  it('refuses a prefix round fed by a prefix round that comes after it, with a correct entry round in position 0', () => {
    const chain = `
ROUNDS:
E = 8
B = 8
C = 8
F = 8 FINAL

ROUTES:
E: 1-8->B
B: 1-8->C
C: 1-8->F
`;
    const parsed = parseWaterfallGraph(chain);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Correct order is E, B, C -- this prefix has C played before B.
    const result = validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: FFA_ROOM_SIZE,
      entrantCount: 8,
      fixedPrefix: ['E', 'C', 'B'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"C"');
    expect(result.error).toContain('played after it');
  });
});

describe('the Qual source (the qualification table as a route source)', () => {
  const QUAL_GRAPH = `
ROUNDS:
R1 = 2x8
R1C = 8
R2 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R1C: 1-4->Final, 5-8->eliminated
R2: 1-4->Final, 5-8->eliminated
`;

  function validateQual(text: string, entrantCount?: number, fixedPrefix?: string[]) {
    const parsed = parseWaterfallGraph(text);
    if (!parsed.ok) return parsed;
    return validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: FFA_ROOM_SIZE,
      entrantCount,
      standingsSource: true,
      fixedPrefix,
    });
  }

  it('orders the rounds from the Qual source and resolves the Qual ranks to graph indices', () => {
    const result = validateQual(QUAL_GRAPH, 37);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.map((round) => round.label)).toEqual(['R1', 'R1C', 'R2', 'Final']);
    expect(result.value.qualRoutes).toEqual([...Array(16).fill(0), ...Array(8).fill(1)]);
  });

  it('keeps an explicit eliminated band in the middle of the Qual line and counts the highest routed rank as its length', () => {
    const gapGraph = QUAL_GRAPH.replace(
      'Qual: 1-16->R1, 17-24->R1C',
      'Qual: 1-16->R1, 17-19->eliminated, 20-27->R1C',
    );
    const result = validateQual(gapGraph, 31);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.qualRoutes).toHaveLength(27);
    expect(result.value.qualRoutes?.slice(16, 19)).toEqual(['eliminated', 'eliminated', 'eliminated']);
    expect(result.value.qualRoutes?.slice(19)).toEqual(Array(8).fill(1));
  });

  it('treats a rank the Qual line never mentions as eliminated', () => {
    const result = validateQual(QUAL_GRAPH.replace('17-24->R1C', '20-27->R1C'), 31);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.qualRoutes?.slice(16, 19)).toEqual(['eliminated', 'eliminated', 'eliminated']);
  });

  it('refuses a graph that routes more qualification ranks than there are registered players (rule 9)', () => {
    const result = validateQual(QUAL_GRAPH, 20);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      'The graph sends qualification rank 24 on, but only 20 players are registered -- route fewer ranks or wait for more registrations.',
    );
  });

  it('skips rule 9 while the head count is not known yet', () => {
    expect(validateQual(QUAL_GRAPH).ok).toBe(true);
  });

  it.each([31, 37, 43, 53])('accepts the same graph at %i registered players', (registered) => {
    expect(validateQual(QUAL_GRAPH, registered).ok).toBe(true);
  });

  it('reads a qualification-table graph with no Qual line as "Qual: 1-<entry total> -> <entry round>"', () => {
    const result = validateQual(SPREADSHEET_GRAPH, 40);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds[0].label).toBe('5');
    expect(result.value.qualRoutes).toEqual(Array(32).fill(0));
  });

  it('refuses a Qual line when the tournament has no qualification table', () => {
    const parsed = parseWaterfallGraph(QUAL_GRAPH);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: FFA_ROOM_SIZE,
      entrantCount: 24,
      standingsSource: false,
    });
    expect(result).toEqual({
      ok: false,
      error:
        'The Qual line routes the qualification table, but this tournament has no qualification table -- remove the Qual line.',
    });
  });

  it('refuses a round declared as Qual, whatever the pooling phase', () => {
    const result = validateQual(QUAL_GRAPH.replace('R1C = 8', 'Qual = 8'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('reserved');
  });

  it('refuses a room letter on the Qual line', () => {
    const result = validateQual(QUAL_GRAPH.replace('Qual:', 'Qual.A:'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('no rooms');
  });

  it('refuses overlapping Qual ranks', () => {
    const result = validateQual(QUAL_GRAPH.replace('17-24->R1C', '16-23->R1C, 24->R1C'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('rank 16 is routed more than once');
  });

  it('refuses a Qual rank below 1', () => {
    const result = validateQual(QUAL_GRAPH.replace('1-16->R1', '0-16->R1'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('start at 1');
  });

  it('refuses a Qual destination that is not declared', () => {
    const result = validateQual(QUAL_GRAPH.replace('17-24->R1C', '17-24->Nowhere'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"Nowhere"');
  });

  it('refuses a round that nothing feeds', () => {
    const orphan = QUAL_GRAPH.replace('R1C = 8', 'R1C = 8\nSide = 8').replace(
      'R2: 1-4->Final, 5-8->eliminated',
      'R2: 1-4->Final, 5-8->eliminated\nSide: 1-8->eliminated',
    );
    const result = validateQual(orphan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      'Round "Side" has nothing routing into it -- send it a qualification rank or route another round into it.',
    );
  });

  it('refuses a round whose declared size differs from what Qual sends it (rule 7)', () => {
    const result = validateQual(QUAL_GRAPH.replace('17-24->R1C', '17-23->R1C'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Round "R1C" declares 8 player(s) but its routing bands only send it 7');
  });

  it('refuses a Qual line that routes nothing on', () => {
    const result = validateQual(QUAL_GRAPH.replace('Qual: 1-16->R1, 17-24->R1C', 'Qual: 1-24->eliminated'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('sends no qualification rank on');
  });

  it('lets the prefix of reached rounds start with any Qual-fed round', () => {
    const result = validateQual(QUAL_GRAPH, 37, ['R1C', 'R1']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.slice(0, 2).map((round) => round.label)).toEqual(['R1C', 'R1']);
  });

  it('materializes the rounds against the highest routed Qual rank and exposes absolute standings routes', () => {
    const result = validateQual(QUAL_GRAPH, 37);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pooling phase of 3 rounds: the bracket starts at round number 4 (array index 3).
    const rounds = waterfallBracketPhase(24, 4, { graph: result.value, finalsGames: 3 });
    expect(rounds.map((round) => round.customLabel)).toEqual(['R1', 'R1C', 'R2', 'Final']);
    expect(waterfallStandingsRoutes(result.value, 4)).toEqual([...Array(16).fill(3), ...Array(8).fill(4)]);
  });

  it('throws when the pooling phase would seed a different number than the highest routed Qual rank', () => {
    const result = validateQual(QUAL_GRAPH, 37);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => waterfallBracketPhase(16, 4, { graph: result.value, finalsGames: 3 })).toThrow(
      /highest routed qualification rank \(24\)/,
    );
  });

  it('has no standings routes for a graph without a Qual source', () => {
    const parsed = parseAndValidate(SPREADSHEET_GRAPH, 32, FFA_ROOM_SIZE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.qualRoutes).toBeUndefined();
    expect(waterfallStandingsRoutes(parsed.value, 4)).toBeUndefined();
  });
});

describe('round names with spaces and dashes', () => {
  // The 2v2v2v2 Survival Teams graph of the live tournament, in its two spellings.
  const PLAIN_GRAPH = `
ROUNDS:
Round5Upper = 2x4
Round5Lower = 2x4
SemiA = 4
Round6 = 2x4
Round7 = 4
SemiB = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->Round5Upper, 9-16->Round5Lower
Round5Upper.A: 1-2->SemiA, 3-4->Round6
Round5Upper.B: 1-2->SemiA, 3-4->Round6
Round5Lower.A: 1-2->Round6
Round5Lower.B: 1-2->Round6
SemiA: 1-2->Final, 3-4->SemiB
Round6.A: 1-2->Round7
Round6.B: 1-2->Round7
Round7: 1-2->SemiB
SemiB: 1-2->Final
`;
  const SPACED_GRAPH = PLAIN_GRAPH.replaceAll('Round5Upper', 'Round 5 Upper')
    .replaceAll('Round5Lower', 'Round 5 Lower')
    .replaceAll('SemiA', 'Semi A')
    .replaceAll('Round6', 'Round 6')
    .replaceAll('Round7', 'Round 7')
    .replaceAll('SemiB', 'Semi-B');
  const TEAM_ROOM_SIZE: RoomSize = { min: 3, max: 4, ideal: 4 };

  function validate(text: string, entrantCount = 19) {
    const parsed = parseWaterfallGraph(text);
    if (!parsed.ok) return parsed;
    return validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: TEAM_ROOM_SIZE,
      entrantCount,
      standingsSource: true,
    });
  }

  /** The graph without its labels: room sizes, routes (destinations are play-order indices) and Qual routes. */
  function shape(result: ReturnType<typeof validate>) {
    if (!result.ok) throw new Error(result.error);
    return {
      rooms: result.value.rounds.map((round) => round.roomSizes),
      routes: result.value.routes,
      qualRoutes: result.value.qualRoutes,
    };
  }

  it('reads the live graph with spaced names at 19 teams as the same routes as the original', () => {
    const spaced = validate(SPACED_GRAPH);
    expect(spaced.ok && spaced.value.rounds.map((round) => round.label)).toEqual([
      'Round 5 Upper',
      'Round 5 Lower',
      'Semi A',
      'Round 6',
      'Round 7',
      'Semi-B',
      'Final',
    ]);
    expect(shape(spaced)).toEqual(shape(validate(PLAIN_GRAPH)));
  });

  it('resolves a destination with a dash or extra spaces, and matches names case-insensitively', () => {
    const text = SPACED_GRAPH.replace(
      'Round 5 Upper.A: 1-2->Semi A, 3-4->Round 6',
      'round  5 upper.A: 1-2->semi a, 3-4-> Round  6',
    );
    expect(shape(validate(text))).toEqual(shape(validate(SPACED_GRAPH)));
    expect(validate(SPACED_GRAPH.replaceAll('Semi A', 'Semi-A')).ok).toBe(true);
  });

  it('collapses a run of spaces in a name to one', () => {
    const result = parseWaterfallGraph(
      'ROUNDS:\nSemi    A = 4\nFinal = 4 FINAL\nROUTES:\nSemi A: 1-4->Final',
    );
    expect(result.ok && result.value.roundLines[0].label).toBe('Semi A');
  });

  it.each(['round  5', 'ROUND 5'])('treats "%s" and "Round 5" as the same round name', (second) => {
    const result = parseWaterfallGraph(
      `ROUNDS:\nRound 5 = 4\n${second} = 4\nFinal = 4 FINAL\nROUTES:\nRound 5: 1-4->Final`,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Duplicate round label');
  });

  it.each([
    '-A',
    'A-',
    'Semi.A',
    'Semi,A',
    'Semi:A',
    'Semi>A',
    'Semi=A',
    '-',
    '',
    'Qual',
    ' qual ',
    'Eliminated',
  ])('refuses the round name "%s"', (name) => {
    const result = parseWaterfallGraph(`ROUNDS:\n${name} = 4 FINAL\nROUTES:\nX: 1-4->eliminated`);
    expect(result.ok).toBe(false);
  });
});

describe('waterfall columns', () => {
  const LIVE_GRAPH = `
ROUNDS:
Round5Upper = 2x4
Round5Lower = 2x4
SemiA = 4
Round6 = 2x4
Round7 = 4
SemiB = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->Round5Upper, 9-16->Round5Lower
Round5Upper.A: 1-2->SemiA, 3-4->Round6
Round5Upper.B: 1-2->SemiA, 3-4->Round6
Round5Lower.A: 1-2->Round6
Round5Lower.B: 1-2->Round6
SemiA: 1-2->Final, 3-4->SemiB
Round6.A: 1-2->Round7
Round6.B: 1-2->Round7
Round7: 1-2->SemiB
SemiB: 1-2->Final
`;
  const TEAM_ROOM_SIZE: RoomSize = { min: 3, max: 4, ideal: 4 };
  const STARTED = { fixedPrefix: ['Round5Upper', 'Round5Lower'], fixedColumns: [1, 1], firstOpenColumn: 2 };

  function validateLive(
    text: string,
    options: { fixedPrefix?: string[]; fixedColumns?: number[]; firstOpenColumn?: number } = {},
  ) {
    const parsed = parseWaterfallGraph(text);
    if (!parsed.ok) return parsed;
    return validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: TEAM_ROOM_SIZE,
      entrantCount: 19,
      standingsSource: true,
      ...options,
    });
  }

  /** The play order as "label:column" pairs. */
  function layout(
    text: string,
    validate: (text: string) => ReturnType<typeof validateLive> = (graphText) => validateLive(graphText),
  ) {
    const result = validate(text);
    if (!result.ok) throw new Error(result.error);
    return result.value.rounds.map((round, index) => `${round.label}:${result.value.columns[index]}`);
  }

  function withColumn(text: string, label: string, column: number) {
    return text.replace(new RegExp(`^${label} = (.*)$`, 'm'), `${label} = $1 COLUMN ${column}`);
  }

  function refusal(text: string, options = {}) {
    const result = validateLive(text, options);
    if (result.ok) throw new Error('expected a refusal');
    return result.error;
  }

  it('numbers the live graph automatically: both qualification-fed rounds in column 1, then SemiA with Round6', () => {
    expect(layout(LIVE_GRAPH)).toEqual([
      'Round5Upper:1',
      'Round5Lower:1',
      'SemiA:2',
      'Round6:2',
      'Round7:3',
      'SemiB:4',
      'Final:5',
    ]);
  });

  it('numbers the worked 32-player example [5], [SemiA, 6B, 6C], [7A], [SemiB], [Final] and keeps its order', () => {
    const validate = (text: string) => parseAndValidate(text, 32, FFA_ROOM_SIZE);
    expect(layout(SPREADSHEET_GRAPH, validate)).toEqual([
      '5:1',
      'SemiA:2',
      '6B:2',
      '6C:2',
      '7A:3',
      'SemiB:4',
      'Final:5',
    ]);
  });

  it('gives the same columns when every round is numbered as automatic would number it', () => {
    let numbered = LIVE_GRAPH;
    for (const [label, column] of [
      ['Round5Upper', 1],
      ['Round5Lower', 1],
      ['SemiA', 2],
      ['Round6', 2],
      ['Round7', 3],
      ['SemiB', 4],
    ] as const) {
      numbered = withColumn(numbered, label, column);
    }
    numbered = numbered.replace('Final = 4 FINAL', 'Final = 4 column 5 FINAL');
    expect(layout(numbered)).toEqual(layout(LIVE_GRAPH));
  });

  it('plays a round with a manual column later: SemiA COLUMN 3 moves it after Round6, the rest follow', () => {
    expect(layout(withColumn(LIVE_GRAPH, 'SemiA', 3))).toEqual([
      'Round5Upper:1',
      'Round5Lower:1',
      'Round6:2',
      'SemiA:3',
      'Round7:3',
      'SemiB:4',
      'Final:5',
    ]);
  });

  it('puts one room host short in a column of its own: R6C COLUMN 3 on the 32-player example', () => {
    const validate = (text: string) => parseAndValidate(text, 32, FFA_ROOM_SIZE);
    expect(layout(SPREADSHEET_GRAPH.replace('6C = 8', '6C = 8 COLUMN 3'), validate)).toEqual([
      '5:1',
      'SemiA:2',
      '6B:2',
      '6C:3',
      '7A:4',
      'SemiB:5',
      'Final:6',
    ]);
  });

  it('keeps the Final alone in its column in every case above', () => {
    for (const text of [
      LIVE_GRAPH,
      withColumn(LIVE_GRAPH, 'SemiA', 3),
      withColumn(LIVE_GRAPH, 'Round6', 3),
    ]) {
      const placed = layout(text);
      const finalColumn = placed.at(-1)?.split(':')[1];
      expect(placed.filter((entry) => entry.endsWith(`:${finalColumn}`))).toHaveLength(1);
    }
  });

  it('still plays the qualification-fed rounds first when SemiA is declared before them', () => {
    const reordered = LIVE_GRAPH.replace('SemiA = 4\n', '').replace(
      'Round5Upper = 2x4\n',
      'SemiA = 4\nRound5Upper = 2x4\n',
    );
    expect(layout(reordered)).toEqual(layout(LIVE_GRAPH));
  });

  it('refuses a column that is not later than a round routing into it', () => {
    expect(refusal(withColumn(LIVE_GRAPH, 'Round6', 1))).toBe(
      'Round "Round6" can\'t be in column 1: round "Round5Upper" routes into it and is in column 1.',
    );
  });

  it('refuses a layout that leaves a column empty', () => {
    expect(refusal(withColumn(LIVE_GRAPH, 'SemiB', 6))).toBe(
      'Column 4 has no round -- renumber the later columns or set a round to column 4.',
    );
  });

  it('moves an automatic round after a new feeder, and refuses the same edit when the round is numbered', () => {
    const rerouted = LIVE_GRAPH.replace(
      'Round5Upper.B: 1-2->SemiA, 3-4->Round6',
      'Round5Upper.B: 1->SemiA, 2-3->Round6',
    ).replace('Round6.A: 1-2->Round7', 'Round6.A: 1-2->Round7, 3->SemiA');
    expect(layout(rerouted)).toEqual([
      'Round5Upper:1',
      'Round5Lower:1',
      'Round6:2',
      'Round7:3',
      'SemiA:3',
      'SemiB:4',
      'Final:5',
    ]);
    expect(refusal(withColumn(rerouted, 'SemiA', 2))).toBe(
      'Round "SemiA" can\'t be in column 2: round "Round6" routes into it and is in column 2.',
    );
  });

  it('keeps a started round in its column and refuses another number for it', () => {
    expect(validateLive(LIVE_GRAPH, STARTED).ok).toBe(true);
    expect(refusal(withColumn(LIVE_GRAPH, 'Round5Lower', 2), STARTED)).toBe(
      'Round "Round5Lower" has already started in column 1.',
    );
    expect(validateLive(withColumn(LIVE_GRAPH, 'Round5Lower', 1), STARTED).ok).toBe(true);
  });

  it('keeps the play order of an automatic graph the same with or without a started prefix', () => {
    const started = validateLive(LIVE_GRAPH, STARTED);
    expect(started.ok && started.value.rounds.map((round) => round.label)).toEqual(
      layout(LIVE_GRAPH).map((entry) => entry.split(':')[0]),
    );
  });
});

describe('the COLUMN keyword in a ROUNDS line', () => {
  function roundLine(line: string) {
    const parsed = parseWaterfallGraph(`ROUNDS:\n${line}\nROUTES:\nX: 1-4->eliminated`);
    return parsed.ok ? parsed.value.roundLines[0] : parsed.error;
  }

  it.each([
    ['Semi A = 4 COLUMN 2', { isFinal: false, column: 2 }],
    ['Semi A = 4 column 12', { isFinal: false, column: 12 }],
    ['Final = 4 FINAL COLUMN 5', { isFinal: true, column: 5 }],
    ['Final = 4 column 5 final', { isFinal: true, column: 5 }],
    ['Semi A = 4', { isFinal: false, column: null }],
  ])('reads "%s"', (line, expected) => {
    expect(roundLine(line)).toMatchObject(expected);
  });

  it.each([
    ['Semi A = 4 COLUMN', 'needs a whole number from 1 after COLUMN'],
    ['Semi A = 4 COLUMN 0', 'needs a whole number from 1 after COLUMN'],
    ['Semi A = 4 COLUMN x', 'needs a whole number from 1 after COLUMN'],
    ['Semi A = 4 COLUMN 2.5', 'needs a whole number from 1 after COLUMN'],
    ['Semi A = 4 COLUMN FINAL', 'needs a whole number from 1 after COLUMN'],
    ['Semi A = 4 COLUMN 2 COLUMN 3', 'repeats COLUMN'],
    ['Semi A = 4 FINAL FINAL', 'repeats FINAL'],
    [
      'Semi A = 4 LAST',
      'only "FINAL", "COLUMN <number>", "BO<number>" and "GAMES <number>" are allowed after the size',
    ],
  ])('refuses "%s"', (line, message) => {
    expect(roundLine(line)).toContain(message);
  });
});

describe('waterfallBracketPhase -- match formats', () => {
  function roundsWith(
    overrides: Array<{ bestOf?: number; games?: number; roomSizes?: number[] }>,
    seedTotal = 8,
  ) {
    const parsed = parseAndValidate(
      'ROUNDS:\nR1 = 2x4\nFinal = 4 FINAL\nROUTES:\nR1.A: 1-2->Final\nR1.B: 1-2->Final',
      8,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const graph = {
      ...parsed.value,
      rounds: parsed.value.rounds.map((spec, index) => ({ ...spec, ...overrides[index] })),
    };
    return waterfallBracketPhase(seedTotal, 1, { graph, finalsGames: 2 });
  }

  it('writes bestOf and the most games the largest room can need', () => {
    const rounds = roundsWith([{ bestOf: 3 }, { bestOf: 5 }]);
    expect(rounds[0]).toMatchObject({ bestOf: 3, numGames: 5 });
    expect(rounds[1]).toMatchObject({ bestOf: 5, numGames: 9 });
  });

  it('counts a short round by its largest room: rooms of 4 and 3 teams still need 5 games', () => {
    expect(roundsWith([{ bestOf: 3, roomSizes: [4, 3] }], 7)[0]).toMatchObject({ bestOf: 3, numGames: 5 });
    expect(roundsWith([{ bestOf: 3, roomSizes: [2, 2] }], 4)[0]).toMatchObject({ bestOf: 3, numGames: 3 });
  });

  it('writes the games of a summed round, and leaves a round with no format as it was', () => {
    const rounds = roundsWith([{ games: 3 }, {}]);
    expect(rounds[0]).toMatchObject({ numGames: 3 });
    expect(rounds[0].bestOf).toBeUndefined();
    expect(rounds[1].numGames).toBe(2);
    const plain = roundsWith([{}, {}]);
    expect(plain[0].numGames).toBeUndefined();
    expect(plain[1].numGames).toBe(2);
  });

  it('lets a Final take its own game count over the Finals format, and a single game count as one', () => {
    expect(roundsWith([{ games: 1 }, { games: 1 }]).map((round) => round.numGames)).toEqual([undefined, 1]);
    expect(roundsWith([{}, { games: 4 }])[1].numGames).toBe(4);
  });

  it('keeps the game count of a round drawn short', () => {
    const round = roundsWith([{ bestOf: 3 }])[0];
    const fitted = fitWaterfallRound(round, 7);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted).toMatchObject({ bestOf: 3, numGames: 5, rooms: [4, 3] });
  });
});

describe('the BO and GAMES keywords in a ROUNDS line', () => {
  function roundLine(line: string) {
    const parsed = parseWaterfallGraph(`ROUNDS:
${line}
ROUTES:
X: 1-4->eliminated`);
    return parsed.ok ? parsed.value.roundLines[0] : parsed.error;
  }

  it.each([
    ['Semi A = 2 BO3', { bestOf: 3, isFinal: false, column: null }],
    ['Semi A = 2 bo5', { bestOf: 5, isFinal: false, column: null }],
    ['Semi A = 2 BO7 COLUMN 3', { bestOf: 7, column: 3 }],
    ['Semi A = 2 COLUMN 3 BO9', { bestOf: 9, column: 3 }],
    ['Final = 2 FINAL BO5', { bestOf: 5, isFinal: true }],
    ['Final = 2 BO3 FINAL COLUMN 4', { bestOf: 3, isFinal: true, column: 4 }],
    ['R1 = 4x2 GAMES 2', { games: 2, isFinal: false }],
    ['R1 = 4x2 games 4 column 2', { games: 4, column: 2 }],
    ['Final = 2 GAMES 1 FINAL', { games: 1, isFinal: true }],
  ])('reads "%s"', (line, expected) => {
    expect(roundLine(line)).toMatchObject(expected);
  });

  it('leaves a line with no format without either field', () => {
    const line = roundLine('Semi A = 2 FINAL');
    expect(line).not.toHaveProperty('bestOf');
    expect(line).not.toHaveProperty('games');
  });

  it.each([
    ['Semi A = 2 BO', 'needs an odd number from 3 to 9 after BO -- for example "BO3"'],
    ['Semi A = 2 BO2', 'needs an odd number from 3 to 9 after BO'],
    ['Semi A = 2 BO1', 'needs an odd number from 3 to 9 after BO'],
    ['Semi A = 2 BO11', 'needs an odd number from 3 to 9 after BO'],
    ['Semi A = 2 BO3 BO3', 'repeats BO3 -- write it once.'],
    ['Semi A = 2 BO3 BO5', 'repeats BO5 -- write it once.'],
    ['Semi A = 2 GAMES', 'needs a whole number from 1 to 4 after GAMES -- for example "GAMES 2"'],
    ['Semi A = 2 GAMES 0', 'needs a whole number from 1 to 4 after GAMES'],
    ['Semi A = 2 GAMES 5', 'needs a whole number from 1 to 4 after GAMES'],
    ['Semi A = 2 GAMES x', 'needs a whole number from 1 to 4 after GAMES'],
    ['Semi A = 2 GAMES 2 GAMES 3', 'repeats GAMES -- write it once.'],
    ['Semi A = 2 BO3 GAMES 2', 'has both BO3 and GAMES 2 -- choose one match format.'],
    ['Semi A = 2 GAMES 2 BO3', 'has both GAMES 2 and BO3 -- choose one match format.'],
  ])('refuses "%s"', (line, message) => {
    expect(roundLine(line)).toContain(message);
  });

  it('passes the format into the validated graph', () => {
    const parsed = parseAndValidate(
      'ROUNDS:\nR1 = 2x4 BO3\nSemi = 4 GAMES 2\nFinal = 4 FINAL BO5\nROUTES:\nR1.A: 1-2->Semi\nR1.B: 1-2->Semi\nSemi: 1-4->Final',
      8,
    );
    expect(parsed.ok && parsed.value.rounds.map(({ bestOf, games }) => ({ bestOf, games }))).toEqual([
      { bestOf: 3, games: undefined },
      { bestOf: undefined, games: 2 },
      { bestOf: 5, games: undefined },
    ]);
  });
});
