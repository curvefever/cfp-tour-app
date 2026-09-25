import { describe, expect, it } from 'vitest';
import type { RoomSize } from '../types';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import {
  addWaterfallRound,
  assignWaterfallSlots,
  blankWaterfallDraft,
  compressWaterfallRanks,
  groupRoomByDestination,
  parseWaterfallDraft,
  removeWaterfallRound,
  renameWaterfallRound,
  resizeWaterfallRound,
  serializeWaterfallDraft,
  setWaterfallFinal,
  waterfallFlowEdges,
  waterfallRoundIntake,
  type WaterfallDraft,
} from '../waterfall-draft';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };

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

const SECOND_CHANCE_GRAPH = `ROUNDS:
R1 = 2x8
SemiB = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-3->Final, 4-7->SemiB, 8->eliminated
R1.B: 1-3->Final, 4-7->SemiB, 8->eliminated
SemiB: 1-2->Final, 3-8->eliminated`;

function draftOf(text: string): WaterfallDraft {
  const result = parseWaterfallDraft(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function validated(text: string, entrantCount?: number) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize: FFA_ROOM_SIZE, entrantCount });
}

describe('parseWaterfallDraft / serializeWaterfallDraft round trip', () => {
  it.each([
    ['the spreadsheet example', SPREADSHEET_GRAPH, 32],
    ['the 16-player second-chance example', SECOND_CHANCE_GRAPH, 16],
  ])('writes %s back out as text the real validator reads identically', (_name, text, entrants) => {
    const original = validated(text, entrants);
    const roundTripped = validated(serializeWaterfallDraft(draftOf(text)), entrants);
    expect(original.ok).toBe(true);
    expect(roundTripped).toEqual(original);
  });

  it('keeps unset slots unset, and leaves them out of the text', () => {
    const draft = assignWaterfallSlots(draftOf(SECOND_CHANCE_GRAPH), 'R1', [{ room: 0, rank: 8 }], null);
    const text = serializeWaterfallDraft(draft);
    expect(text).toContain('R1.A: 1-3->Final, 4-7->SemiB\n');
    expect(text).toContain('R1.B: 1-3->Final, 4-7->SemiB, 8->eliminated');
    expect(draftOf(text)).toEqual(draft);
  });

  it('treats empty text as an empty draft, and an empty draft as empty text', () => {
    expect(draftOf('')).toEqual({ rounds: [], routes: {} });
    expect(serializeWaterfallDraft({ rounds: [], routes: {} })).toBe('');
  });

  it('reads rounds with no routes yet, which the strict parser rejects', () => {
    const text = 'ROUNDS:\nR1 = 2x8\nFinal = 8 FINAL\n\nROUTES:';
    expect(parseWaterfallGraph(text).ok).toBe(false);
    const draft = draftOf(text);
    expect(draft.rounds.map((round) => round.label)).toEqual(['R1', 'Final']);
    expect(draft.routes.R1).toEqual([Array(8).fill(null), Array(8).fill(null)]);
    expect(serializeWaterfallDraft(draft)).toBe(text);
  });

  it('accepts route lines that use a different letter case for a round name', () => {
    const draft = draftOf('ROUNDS:\nR1 = 8\nFinal = 8 FINAL\nROUTES:\nr1: 1-8->final');
    expect(draft.routes.R1[0]).toEqual(Array(8).fill('Final'));
  });

  it.each([
    ['a route to an undeclared round', 'ROUNDS:\nR1 = 8\nROUTES:\nR1: 1-8->Nowhere', "isn't declared"],
    ['a route line for an undeclared round', 'ROUNDS:\nR1 = 8\nROUTES:\nZ: 1-8->R1', "isn't declared"],
    ['an outgoing route from the Final', 'ROUNDS:\nF = 8 FINAL\nROUTES:\nF: 1-8->eliminated', 'FINAL'],
    ['a rank routed twice', 'ROUNDS:\nR1 = 8\nF = 8 FINAL\nROUTES:\nR1: 1-4->F, 4-8->F', 'more than once'],
    ['a rank outside the room', 'ROUNDS:\nR1 = 8\nF = 8 FINAL\nROUTES:\nR1: 1-9->F', 'out of range'],
    [
      'a multi-room round with no room letter',
      'ROUNDS:\nR1 = 2x8\nF = 8 FINAL\nROUTES:\nR1: 1-8->F',
      'room letter',
    ],
    [
      'a room letter past the last room',
      'ROUNDS:\nR1 = 2x8\nF = 8 FINAL\nROUTES:\nR1.C: 1-8->F',
      'only has 2',
    ],
  ])('reports %s', (_name, text, message) => {
    const result = parseWaterfallDraft(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe('waterfall-bracket parse options', () => {
  it('skips the entrant-count rule only when no count is given', () => {
    expect(validated(SECOND_CHANCE_GRAPH, 16).ok).toBe(true);
    expect(validated(SECOND_CHANCE_GRAPH).ok).toBe(true);
    const mismatch = validated(SECOND_CHANCE_GRAPH, 24);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toContain('must match exactly');
  });
});

describe('compressWaterfallRanks / groupRoomByDestination', () => {
  it('collapses runs and keeps gaps as separate tokens', () => {
    expect(compressWaterfallRanks([5, 1, 2, 3, 8])).toEqual(['1-3', '5', '8']);
    expect(compressWaterfallRanks([6, 7])).toEqual(['6-7']);
    expect(compressWaterfallRanks([])).toEqual([]);
  });

  it('groups a room by destination in order of each destination first appearing, skipping unset slots', () => {
    expect(groupRoomByDestination(['Final', null, 'SemiB', 'Final', 'SemiB', 'eliminated'])).toEqual([
      { destination: 'Final', ranks: [1, 4] },
      { destination: 'SemiB', ranks: [3, 5] },
      { destination: 'eliminated', ranks: [6] },
    ]);
  });
});

describe('waterfallFlowEdges / waterfallRoundIntake', () => {
  it('counts the players on every hop', () => {
    const edges = waterfallFlowEdges(draftOf(SECOND_CHANCE_GRAPH)).map((edge) => [
      edge.from,
      edge.to,
      edge.players,
    ]);
    expect(edges).toEqual([
      ['R1', 'Final', 6],
      ['R1', 'SemiB', 8],
      ['R1', 'eliminated', 2],
      ['SemiB', 'Final', 2],
      ['SemiB', 'eliminated', 6],
    ]);
  });

  it('reports what each round receives, the starting round and the play order', () => {
    const intake = waterfallRoundIntake(draftOf(SECOND_CHANCE_GRAPH));
    expect(intake.incoming).toEqual({ R1: 0, SemiB: 8, Final: 8 });
    expect(intake.startingRound).toBe('R1');
    expect(intake.order).toEqual(['R1', 'SemiB', 'Final']);
    expect(intake.unsetSlots).toBe(0);
  });

  it('puts a skipped-ahead round after every round that feeds it', () => {
    const intake = waterfallRoundIntake(draftOf(SPREADSHEET_GRAPH));
    expect(intake.order.indexOf('SemiA')).toBeLessThan(intake.order.indexOf('SemiB'));
    expect(intake.order.indexOf('7A')).toBeLessThan(intake.order.indexOf('SemiB'));
    expect(intake.order[intake.order.length - 1]).toBe('Final');
    expect(intake.incoming.SemiB).toBe(8);
  });

  it('counts unset slots and has no starting round when two rounds have nothing routed in', () => {
    const draft = draftOf('ROUNDS:\nA = 8\nB = 8\nF = 8 FINAL\nROUTES:\nA: 1-4->F');
    const intake = waterfallRoundIntake(draft);
    expect(intake.unsetSlots).toBe(4 + 8);
    expect(intake.startingRound).toBeNull();
  });

  it('falls back to the added order when the routing loops', () => {
    const draft = draftOf('ROUNDS:\nA = 8\nB = 8\nROUTES:\nA: 1-8->B\nB: 1-8->A');
    const intake = waterfallRoundIntake(draft);
    expect(intake.startingRound).toBeNull();
    expect(intake.order).toEqual(['A', 'B']);
  });
});

describe('waterfall draft edits', () => {
  it('starts blank with an entry round sized to the entrants when they divide into rooms', () => {
    const draft = blankWaterfallDraft(24, FFA_ROOM_SIZE);
    expect(draft.rounds).toEqual([
      { label: 'R1', roomCount: 3, roomSize: 8, isFinal: false },
      { label: 'Final', roomCount: 1, roomSize: 8, isFinal: true },
    ]);
    expect(waterfallRoundIntake(draft).unsetSlots).toBe(24);
  });

  it('starts with a single room when the entrants are unknown or do not divide evenly', () => {
    expect(blankWaterfallDraft(null, FFA_ROOM_SIZE).rounds[0].roomCount).toBe(1);
    expect(blankWaterfallDraft(21, FFA_ROOM_SIZE).rounds[0].roomCount).toBe(1);
  });

  it('adds a round before the Final, with a name nobody uses yet', () => {
    const base = draftOf(SECOND_CHANCE_GRAPH);
    const added = addWaterfallRound(base, 8);
    expect(added.rounds.map((round) => round.label)).toEqual(['R1', 'SemiB', 'R4', 'Final']);
    expect(added.routes.R4).toEqual([Array(8).fill(null)]);
    const clash = addWaterfallRound(draftOf('ROUNDS:\nR2 = 8\nF = 8 FINAL\nROUTES:'), 8);
    expect(clash.rounds.map((round) => round.label)).toEqual(['R2', 'R3', 'F']);
    expect(addWaterfallRound(draftOf('ROUNDS:\nR3 = 8\nF = 8 FINAL\nROUTES:'), 8).rounds[1].label).toBe('R4');
  });

  it('removes a round and unsets every slot that pointed at it', () => {
    const removed = removeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'SemiB');
    expect(removed.rounds.map((round) => round.label)).toEqual(['R1', 'Final']);
    expect(removed.routes.SemiB).toBeUndefined();
    expect(removed.routes.R1[0]).toEqual(['Final', 'Final', 'Final', null, null, null, null, 'eliminated']);
  });

  it('renames a round and every route that points at it', () => {
    const result = renameWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'SemiB', 'Repechage');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.map((round) => round.label)).toEqual(['R1', 'Repechage', 'Final']);
    expect(result.value.routes.R1[0][3]).toBe('Repechage');
    expect(result.value.routes.Repechage[0][0]).toBe('Final');
    expect(validated(serializeWaterfallDraft(result.value), 16).ok).toBe(true);
  });

  it.each([
    ['a name with a space', 'Semi B', 'letters and digits'],
    ['an empty name', '', 'letters and digits'],
    ['the reserved word', 'Eliminated', 'reserved'],
    ['a name another round has, in any letter case', 'final', 'already uses'],
  ])('refuses a rename to %s', (_name, to, message) => {
    const result = renameWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'SemiB', to);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('allows renaming a round to its own name', () => {
    expect(renameWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'SemiB', 'SemiB').ok).toBe(true);
  });

  it('keeps the slots that still exist when a round is resized, and leaves new ones unset', () => {
    const grown = resizeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'R1', 3, 8);
    expect(grown.routes.R1).toHaveLength(3);
    expect(grown.routes.R1[0]).toEqual([
      'Final',
      'Final',
      'Final',
      'SemiB',
      'SemiB',
      'SemiB',
      'SemiB',
      'eliminated',
    ]);
    expect(grown.routes.R1[2]).toEqual(Array(8).fill(null));
    const shrunk = resizeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'R1', 1, 6);
    expect(shrunk.routes.R1).toEqual([['Final', 'Final', 'Final', 'SemiB', 'SemiB', 'SemiB']]);
  });

  it('clamps a resize to the room limits', () => {
    const clamped = resizeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'R1', 999, 0);
    expect(clamped.rounds[0]).toMatchObject({ roomCount: 26, roomSize: 1 });
  });

  it('makes a round the only Final, dropping its outgoing routes, and can undo it', () => {
    const moved = setWaterfallFinal(draftOf(SECOND_CHANCE_GRAPH), 'SemiB', true);
    expect(moved.rounds.filter((round) => round.isFinal).map((round) => round.label)).toEqual(['SemiB']);
    expect(moved.routes.SemiB).toEqual([]);
    expect(moved.routes.Final).toEqual(Array(1).fill(Array(8).fill(null)));
    const cleared = setWaterfallFinal(moved, 'SemiB', false);
    expect(cleared.rounds.some((round) => round.isFinal)).toBe(false);
    expect(cleared.routes.SemiB).toEqual([Array(8).fill(null)]);
  });

  describe('assignWaterfallSlots', () => {
    const slots = [
      { room: 0, rank: 8 },
      { room: 1, rank: 8 },
    ];

    it('sends the chosen slots to a round or to eliminated, and leaves the input untouched', () => {
      const base = draftOf(SECOND_CHANCE_GRAPH);
      const sent = assignWaterfallSlots(base, 'R1', slots, 'Final');
      expect(sent.routes.R1[0][7]).toBe('Final');
      expect(sent.routes.R1[1][7]).toBe('Final');
      expect(base.routes.R1[0][7]).toBe('eliminated');
      expect(assignWaterfallSlots(sent, 'R1', slots, 'eliminated').routes.R1[1][7]).toBe('eliminated');
    });

    it('unsets slots when the destination is null', () => {
      expect(
        assignWaterfallSlots(draftOf(SECOND_CHANCE_GRAPH), 'R1', slots, null).routes.R1[0][7],
      ).toBeNull();
    });

    it.each([
      ['an undeclared round', 'Nowhere'],
      ['the round itself', 'R1'],
    ])('ignores a destination that is %s', (_name, destination) => {
      const base = draftOf(SECOND_CHANCE_GRAPH);
      expect(assignWaterfallSlots(base, 'R1', slots, destination)).toBe(base);
    });

    it('ignores the Final, an unknown round, and slots outside the room', () => {
      const base = draftOf(SECOND_CHANCE_GRAPH);
      expect(assignWaterfallSlots(base, 'Final', slots, 'R1')).toBe(base);
      expect(assignWaterfallSlots(base, 'Nope', slots, 'Final')).toBe(base);
      const outside = assignWaterfallSlots(
        base,
        'R1',
        [
          { room: 5, rank: 1 },
          { room: 0, rank: 9 },
          { room: 0, rank: 0 },
        ],
        'Final',
      );
      expect(outside.routes).toEqual(base.routes);
    });

    it('makes an incomplete graph fail the real validator until every slot is set, then pass', () => {
      let draft = assignWaterfallSlots(draftOf(SECOND_CHANCE_GRAPH), 'R1', slots, null);
      const incomplete = validated(serializeWaterfallDraft(draft), 16);
      expect(incomplete.ok).toBe(false);
      if (!incomplete.ok) expect(incomplete.error).toContain('rank(s) 8 have no destination');
      draft = assignWaterfallSlots(draft, 'R1', slots, 'eliminated');
      expect(validated(serializeWaterfallDraft(draft), 16).ok).toBe(true);
    });
  });
});
