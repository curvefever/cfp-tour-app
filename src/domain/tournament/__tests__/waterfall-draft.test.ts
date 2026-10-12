import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { RoomSize, TournamentState } from '../types';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import { scoreCurrentRound } from './play-through';
import { buildQualWaterfall, playToQualificationExit } from './qual-waterfall';
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
  waterfallDraftFromRounds,
  waterfallFlowEdges,
  waterfallQualAdvance,
  waterfallQualCounts,
  waterfallRoundIntake,
  type WaterfallDraft,
} from '../waterfall-draft';
import { fixedIdSource } from './test-fixtures';

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

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

/** 43 players, 24 advancing (3x8 entry). */
const THREE_ROOM_ENTRY_GRAPH = `ROUNDS:
R1 = 3x8
SemiA = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->SemiA, 5-8->eliminated
R1.B: 1-4->SemiA, 5-8->eliminated
R1.C: 1-8->eliminated
SemiA: 1-8->Final`;

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

  it('reads ->eliminated bands as out slots, and leaves out slots out of the text', () => {
    const draft = draftOf(SECOND_CHANCE_GRAPH);
    expect(draft.routes.R1[1][7]).toBeNull();
    const text = serializeWaterfallDraft(draft);
    expect(text).toContain('R1.A: 1-3->Final, 4-7->SemiB\n');
    expect(text).toContain('R1.B: 1-3->Final, 4-7->SemiB\n');
    expect(text).not.toContain('R1.B: 1-3->Final, 4-7->SemiB, 8');
    expect(draftOf(text)).toEqual(draft);
  });

  it('reads a rank no band covers as out, and a room with no line as all out', () => {
    const draft = draftOf('ROUNDS:\nR1 = 2x4\nFinal = 4 FINAL\nROUTES:\nR1.A: 1-2->Final');
    expect(draft.routes.R1).toEqual([['Final', 'Final', null, null], Array(4).fill(null)]);
    expect(serializeWaterfallDraft(draft)).toContain('R1.A: 1-2->Final');
    expect(serializeWaterfallDraft(draft)).not.toContain('R1.B');
  });

  it('still refuses a rank routed twice, even when one of the bands is ->eliminated', () => {
    const result = parseWaterfallDraft(
      'ROUNDS:\nR1 = 4\nFinal = 4 FINAL\nROUTES:\nR1: 1-4->eliminated, 2->Final',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('routed more than once');
  });

  it('treats empty text as an empty draft, and an empty draft as empty text', () => {
    expect(draftOf('')).toEqual({ rounds: [], routes: {}, qualRoutes: null });
    expect(serializeWaterfallDraft({ rounds: [], routes: {}, qualRoutes: null })).toBe('');
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

  it('reports the out ranks of a room as an edge to eliminated', () => {
    const draft = draftOf(SECOND_CHANCE_GRAPH);
    const toOut = waterfallFlowEdges(draft).find((edge) => edge.from === 'R1' && edge.to === 'eliminated');
    expect(toOut).toMatchObject({ players: 2, ranksByRoom: { 0: [8], 1: [8] } });
  });

  it('reports what each round receives, the starting round and the play order', () => {
    const intake = waterfallRoundIntake(draftOf(SECOND_CHANCE_GRAPH));
    expect(intake.incoming).toEqual({ R1: 0, SemiB: 8, Final: 8 });
    expect(intake.startingRound).toBe('R1');
    expect(intake.order).toEqual(['R1', 'SemiB', 'Final']);
  });

  it('puts a skipped-ahead round after every round that feeds it', () => {
    const intake = waterfallRoundIntake(draftOf(SPREADSHEET_GRAPH));
    expect(intake.order.indexOf('SemiA')).toBeLessThan(intake.order.indexOf('SemiB'));
    expect(intake.order.indexOf('7A')).toBeLessThan(intake.order.indexOf('SemiB'));
    expect(intake.order[intake.order.length - 1]).toBe('Final');
    expect(intake.incoming.SemiB).toBe(8);
  });

  it('has no starting round when two rounds have nothing routed in', () => {
    const draft = draftOf('ROUNDS:\nA = 8\nB = 8\nF = 8 FINAL\nROUTES:\nA: 1-4->F');
    const intake = waterfallRoundIntake(draft);
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
    expect(draft.routes.R1).toEqual(Array.from({ length: 3 }, () => Array(8).fill(null)));
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

  it('removes a round and makes every slot that pointed at it out', () => {
    const removed = removeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'SemiB');
    expect(removed.rounds.map((round) => round.label)).toEqual(['R1', 'Final']);
    expect(removed.routes.SemiB).toBeUndefined();
    expect(removed.routes.R1[0]).toEqual(['Final', 'Final', 'Final', null, null, null, null, null]);
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

  it('keeps the slots that still exist when a round is resized, and leaves new ones out', () => {
    const grown = resizeWaterfallRound(draftOf(SECOND_CHANCE_GRAPH), 'R1', 3, 8);
    expect(grown.routes.R1).toHaveLength(3);
    expect(grown.routes.R1[0]).toEqual(['Final', 'Final', 'Final', 'SemiB', 'SemiB', 'SemiB', 'SemiB', null]);
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

    it('sends the chosen slots to a round, and stores eliminated as out, leaving the input untouched', () => {
      const base = draftOf(SECOND_CHANCE_GRAPH);
      const sent = assignWaterfallSlots(base, 'R1', slots, 'Final');
      expect(sent.routes.R1[0][7]).toBe('Final');
      expect(sent.routes.R1[1][7]).toBe('Final');
      expect(base.routes.R1[0][7]).toBeNull();
      expect(assignWaterfallSlots(sent, 'R1', slots, 'eliminated').routes.R1[1][7]).toBeNull();
    });

    it('sets slots out when the destination is null', () => {
      const base = draftOf(SECOND_CHANCE_GRAPH);
      const sent = assignWaterfallSlots(base, 'R1', slots, 'Final');
      expect(assignWaterfallSlots(sent, 'R1', slots, null).routes.R1[0][7]).toBeNull();
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

    it('lets a rank left unrouted pass the real validator as eliminated', () => {
      const draft = assignWaterfallSlots(draftOf(SECOND_CHANCE_GRAPH), 'R1', slots, null);
      const result = validated(serializeWaterfallDraft(draft), 16);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.routes[0][0][7]).toBe('eliminated');
    });
  });
});

describe('waterfallDraftFromRounds', () => {
  it('shows a round drawn short with the room sizes the graph declared for it', () => {
    const atR1 = playToQualificationExit(buildQualWaterfall(37));
    const advanced = (state: TournamentState): TournamentState => {
      const result = advanceTournamentRound(state);
      if (result.status !== 'advanced') throw new Error('expected an advance');
      return result.state;
    };
    const r1 = advanced(atR1);
    const r1c = r1.rounds.findIndex((round) => round.customLabel === 'R1C');
    const removed = removeRosterUnit(r1, r1.pendingBracketSeeds[r1c][0].name);
    const atR1c = advanced(scoreCurrentRound(removed, 0));
    expect(atR1c.rounds[r1c]).toMatchObject({ rooms: [7], declaredRooms: [8] });

    const draft = waterfallDraftFromRounds(atR1c.rounds);

    expect(draft.rounds.find((round) => round.label === 'R1C')).toMatchObject({ roomCount: 1, roomSize: 8 });
    expect(serializeWaterfallDraft(draft)).toContain('R1C = 8');
  });

  it('turns the eliminated ranks of a generated round into out slots', () => {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 16, players: names(16) }),
      createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'waterfall-bracket',
        waterfallGraph: SECOND_CHANCE_GRAPH,
      }),
      createTournamentRuntime({ ids: fixedIdSource() }),
    );
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const r1 = result.state.rounds.find((round) => round.customLabel === 'R1');
    expect(r1?.waterfallRoutes?.[0][7]).toBe('eliminated');
    expect(waterfallDraftFromRounds(result.state.rounds).routes.R1[0][7]).toBeNull();
  });

  it.each([
    ['37 players, qual-table, 32 advancing', 37, 32, SPREADSHEET_GRAPH],
    ['43 players, qual-table, 24 advancing', 43, 24, THREE_ROOM_ENTRY_GRAPH],
  ])(
    'rebuilds a generated tournament -- with pooling rounds ahead of the bracket, so an absolute round index and a position among the waterfall rounds diverge -- as the same graph generation used (%s)',
    (_name, confirmedCount, qualAdv, graph) => {
      const state = createDefaultTournamentState({ confirmedCount, players: names(confirmedCount) });
      const form = createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'qual-table',
        qualAdv: String(qualAdv),
        waterfallGraph: graph,
      });
      const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
      expect(result.status).toBe('generated');
      if (result.status !== 'generated') return;
      // Sanity check that this fixture actually exercises the divergence the
      // test name promises: the waterfall entry round isn't at index 0.
      expect(result.state.rounds.findIndex((round) => round.isWaterfall)).toBeGreaterThan(0);

      const rebuiltText = serializeWaterfallDraft(waterfallDraftFromRounds(result.state.rounds));
      const rebuiltParsed = parseWaterfallGraph(rebuiltText);
      expect(rebuiltParsed.ok).toBe(true);
      if (!rebuiltParsed.ok) return;
      const rebuiltGraph = validateAndOrderWaterfallGraph(rebuiltParsed.value, {
        roomSize: result.state.gamemodeConfig.roomSize as RoomSize,
        entrantCount: confirmedCount,
        standingsSource: true,
      });
      expect(rebuiltGraph).toEqual({ ok: true, value: result.state.gamemodeConfig.graph });
    },
  );
});

describe('the Qual source in a draft', () => {
  const QUAL_DRAFT_GRAPH = `ROUNDS:
R1 = 2x8
R1C = 8
R2 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R1C: 1-4->Final, 5-8->eliminated
R2: 1-4->Final, 5-8->eliminated`;

  const qualOptions = { standingsSource: true as const };

  function qualDraft(text: string, rankCount?: number): WaterfallDraft {
    const parsed = parseWaterfallDraft(text, { ...qualOptions, rankCount });
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  function validatedQualRoutes(text: string, registered: number) {
    const raw = parseWaterfallGraph(text);
    if (!raw.ok) throw new Error(raw.error);
    const result = validateAndOrderWaterfallGraph(raw.value, {
      roomSize: FFA_ROOM_SIZE,
      entrantCount: registered,
      standingsSource: true,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value.qualRoutes;
  }

  it('reads the Qual line into one slot per rank, padded to the ranks shown', () => {
    const draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    expect(draft.qualRoutes).toHaveLength(37);
    expect(draft.qualRoutes?.slice(0, 16)).toEqual(Array(16).fill('R1'));
    expect(draft.qualRoutes?.slice(16, 24)).toEqual(Array(8).fill('R1C'));
    expect(draft.qualRoutes?.slice(24)).toEqual(Array(13).fill(null));
  });

  it('writes the Qual line first in ROUTES and leaves eliminated ranks out, and the text round-trips', () => {
    const draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    const text = serializeWaterfallDraft(draft);
    expect(text).toContain('ROUTES:\nQual: 1-16->R1, 17-24->R1C\nR1.A:');
    expect(qualDraft(text, 37)).toEqual(draft);
    expect(validatedQualRoutes(text, 37)).toEqual(validatedQualRoutes(QUAL_DRAFT_GRAPH, 37));
  });

  it('round-trips a gap: ranks 17-19 stay eliminated and 20-27 reach R1C', () => {
    const gapText = QUAL_DRAFT_GRAPH.replace(
      'Qual: 1-16->R1, 17-24->R1C',
      'Qual: 1-16->R1, 17-19->eliminated, 20-27->R1C',
    );
    const draft = qualDraft(gapText, 31);
    expect(draft.qualRoutes?.slice(16, 19)).toEqual([null, null, null]);
    expect(waterfallQualAdvance(draft)).toBe(27);
    const text = serializeWaterfallDraft(draft);
    expect(text).toContain('Qual: 1-16->R1, 20-27->R1C');
    expect(validatedQualRoutes(text, 31)).toEqual(validatedQualRoutes(gapText, 31));
  });

  it('reads a qualification-table graph with no Qual line as every rank going to the entry round', () => {
    const draft = qualDraft(SPREADSHEET_GRAPH, 37);
    expect(draft.qualRoutes).toHaveLength(37);
    expect(draft.qualRoutes?.slice(0, 32)).toEqual(Array(32).fill('5'));
    expect(draft.qualRoutes?.slice(32)).toEqual(Array(5).fill(null));
    // Writing it back adds the explicit line, and it validates to the same routing.
    const text = serializeWaterfallDraft(draft);
    expect(text).toContain('Qual: 1-32->5');
    expect(validatedQualRoutes(text, 37)).toEqual(validatedQualRoutes(SPREADSHEET_GRAPH, 37));
  });

  it('has no Qual source when the pooling phase is not a qualification table, and ignores a leftover Qual line', () => {
    const parsed = parseWaterfallDraft(QUAL_DRAFT_GRAPH);
    expect(parsed.ok && parsed.value.qualRoutes).toBeNull();
    if (parsed.ok) expect(serializeWaterfallDraft(parsed.value)).not.toContain('Qual');
  });

  it('writes an all-eliminated Qual routing as an explicit line, so it is never read as "no Qual line"', () => {
    const blank = blankWaterfallDraft(37, FFA_ROOM_SIZE, qualOptions);
    expect(blank.qualRoutes).toEqual(Array(37).fill(null));
    const text = serializeWaterfallDraft(blank);
    expect(text).toContain('Qual: 1-37->eliminated');
    expect(qualDraft(text, 37).qualRoutes).toEqual(Array(37).fill(null));
  });

  it('sends Qual slots with assignWaterfallSlots (label Qual): eliminated and unset are the same', () => {
    let draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    draft = assignWaterfallSlots(
      draft,
      'Qual',
      [
        { room: 0, rank: 30 },
        { room: 0, rank: 31 },
      ],
      'R1C',
    );
    expect(draft.qualRoutes?.slice(29, 31)).toEqual(['R1C', 'R1C']);
    draft = assignWaterfallSlots(draft, 'Qual', [{ room: 0, rank: 30 }], 'eliminated');
    expect(draft.qualRoutes?.[29]).toBeNull();
    // An unknown destination, or a rank past the last slot, leaves the draft as it was.
    expect(assignWaterfallSlots(draft, 'Qual', [{ room: 0, rank: 1 }], 'Nowhere')).toBe(draft);
    expect(assignWaterfallSlots(draft, 'Qual', [{ room: 0, rank: 99 }], 'R1').qualRoutes).toEqual(
      draft.qualRoutes,
    );
  });

  it('counts the Qual source in the flow edges and the round intake', () => {
    const draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    const edges = waterfallFlowEdges(draft);
    expect(edges.slice(0, 2)).toEqual([
      {
        from: 'Qual',
        to: 'R1',
        players: 16,
        ranksByRoom: { 0: Array.from({ length: 16 }, (_, i) => i + 1) },
      },
      {
        from: 'Qual',
        to: 'R1C',
        players: 8,
        ranksByRoom: { 0: Array.from({ length: 8 }, (_, i) => i + 17) },
      },
    ]);
    // The Qual source's open tail (ranks past the highest routed one) is not an edge.
    expect(edges.some((edge) => edge.from === 'Qual' && edge.to === 'eliminated')).toBe(false);
    const intake = waterfallRoundIntake(draft);
    expect(intake.incoming).toEqual({ R1: 16, R1C: 8, R2: 8, Final: 8 });
    expect(intake.startingRound).toBeNull();
    expect(intake.order).toEqual(['R1', 'R1C', 'R2', 'Final']);
  });

  it('counts the ranks sent on and eliminated against the registered head count', () => {
    const draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    expect(waterfallQualCounts(draft.qualRoutes ?? [], 37)).toEqual({ sentOn: 24, eliminated: 13 });
    expect(waterfallQualCounts(draft.qualRoutes ?? [], null)).toEqual({ sentOn: 24, eliminated: null });
  });

  it('un-sets Qual slots that pointed at a removed round, and follows a rename', () => {
    const draft = qualDraft(QUAL_DRAFT_GRAPH, 37);
    expect(removeWaterfallRound(draft, 'R1C').qualRoutes?.slice(16, 24)).toEqual(Array(8).fill(null));
    const renamed = renameWaterfallRound(draft, 'R1C', 'Repechage');
    expect(renamed.ok && renamed.value.qualRoutes?.slice(16, 24)).toEqual(Array(8).fill('Repechage'));
  });

  it('rebuilds the Qual routing of a generated tournament from its last qualification round', () => {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players: names(37) }),
      createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'qual-table',
        waterfallGraph: QUAL_DRAFT_GRAPH,
      }),
      createTournamentRuntime({ ids: fixedIdSource() }),
    );
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const draft = waterfallDraftFromRounds(result.state.rounds, { rankCount: 37 });
    expect(draft.qualRoutes).toEqual(qualDraft(QUAL_DRAFT_GRAPH, 37).qualRoutes);
    expect(serializeWaterfallDraft(draft)).toBe(serializeWaterfallDraft(qualDraft(QUAL_DRAFT_GRAPH, 37)));
  });
});
