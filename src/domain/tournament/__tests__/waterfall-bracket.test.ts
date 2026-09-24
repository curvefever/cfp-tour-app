import { describe, expect, it } from 'vitest';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
} from '../waterfall-bracket';
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

function parseAndValidate(text: string, entrantCount = 32, roomSize = ANY_ROOM_SIZE) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize, entrantCount });
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
    const result = parseWaterfallGraph('ROUNDS:\nSemi A = 8 FINAL\nROUTES:\n5: 1-8->eliminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid');
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

  it("rule 3: rejects a multi-room round missing one room's ROUTES line", () => {
    const text = 'ROUNDS:\n5 = 2x4\nFinal = 8 FINAL\nROUTES:\n5.A: 1-4->Final';
    const result = parseAndValidate(text, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('has no ROUTES line');
  });

  it("rule 4: rejects a gap in a room's rank coverage", () => {
    const text = 'ROUNDS:\n5 = 4\nFinal = 4 FINAL\nROUTES:\n5: 1-2->Final';
    const result = parseAndValidate(text, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('have no destination');
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
