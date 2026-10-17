import { describe, expect, it } from 'vitest';
import { orderedQualificationTable } from '../advancement';
import { generateTournament } from '../generation';
import { removeRosterUnit, swapIndividual } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { playThrough, scoreCurrentRound } from './play-through';
import {
  ALL_ROUTED_GRAPHS,
  QUAL_GRAPH,
  buildQualWaterfall,
  playToQualificationExit,
  withoutColumns,
} from './qual-waterfall';
import { fixedIdSource } from './test-fixtures';

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

// The docstring's own worked example (waterfall-bracket.ts): a genuine
// skip-ahead (5.A ranks 1-4 -> SemiA) and non-contiguous bands (5.C: 1,4 / 2,3).
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

/** Generated before columns existed (every round played on its own) unless `columns` keeps the stored columns. */
function buildTournament(
  overrides: Parameters<typeof createDefaultSetup>[0] = {},
  columns = false,
): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 37, players: names(37) }),
    createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '32',
      waterfallGraph: SPREADSHEET_GRAPH,
      ...overrides,
    }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') {
    throw new Error(`fixture failed to generate: ${result.status === 'invalid' ? result.message : ''}`);
  }
  return columns ? result.state : withoutColumns(result.state);
}

/** Scores the current round with the real transition code and advances, distinctly and deterministically. */
function playOneRound(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status !== 'advanced') {
    throw new Error(`could not advance past round ${state.curRound}: ${result.status}`);
  }
  return result.state;
}

/** Plays rounds (scoring every one distinctly) until the current round has this customLabel. */
function playToLabel(state: TournamentState, label: string): TournamentState {
  let current = state;
  for (let guard = 0; guard < 30; guard += 1) {
    if (current.rounds[current.curRound].customLabel === label) return current;
    current = playOneRound(current);
  }
  throw new Error(`did not reach round "${label}" within 30 rounds`);
}

function namesInRoom(state: TournamentState, roundIndex: number, room: number): string[] {
  return (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .map((entry) => entry.name);
}

function currentText(state: TournamentState): string {
  return state.settings?.waterfallGraph ?? SPREADSHEET_GRAPH;
}

describe('applyWaterfallGraphEdit', () => {
  it('is a no-op on unchanged text: same rounds, same pending pools, nothing redrawn', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    const result = applyWaterfallGraphEdit(state, currentText(state));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.rounds.map((round) => round.customLabel)).toEqual(
      state.rounds.map((round) => round.customLabel),
    );
    expect(result.state.rounds).toEqual(state.rounds);
    expect(result.state.pendingBracketSeeds).toEqual(state.pendingBracketSeeds);
    expect(result.state.assignments[state.curRound]).toEqual(state.assignments[state.curRound]);
  });

  it('while still in pooling, accepts a whole-graph replacement (different round count) sized to the same entrant total', () => {
    const state = buildTournament(); // curRound is still in the qual-table phase
    const replacement = `
ROUNDS:
5 = 4x8
Final = 8 FINAL

ROUTES:
5.A: 1-4->Final, 5-8->eliminated
5.B: 1-4->Final, 5-8->eliminated
5.C: 1-8->eliminated
5.D: 1-8->eliminated
`;
    const result = applyWaterfallGraphEdit(state, replacement);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.rounds.map((round) => round.customLabel).filter(Boolean)).toEqual(['5', 'Final']);
  });

  it('reads an entry round of a different size as the qualification table sending that many ranks on', () => {
    const state = buildTournament();
    const smaller = `
ROUNDS:
5 = 4x7
Final = 8 FINAL

ROUTES:
5.A: 1-4->Final, 5-7->eliminated
5.B: 1-4->Final, 5-7->eliminated
5.C: 1-7->eliminated
5.D: 1-7->eliminated
`;
    const result = applyWaterfallGraphEdit(state, smaller);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No Qual line: ranks 1-28 go to the entry round, so "Advance to bracket" becomes 28.
    expect(result.state.cfg.qualAdv).toBe(28);
  });

  it('refuses a graph that routes more qualification ranks than there are units left in the roster', () => {
    const state = buildTournament();
    const tooMany = [
      'ROUNDS:',
      '5 = 5x8',
      'Final = 8 FINAL',
      '',
      'ROUTES:',
      'Qual: 1-40->5',
      '5.A: 1-2->Final, 3-8->eliminated',
      '5.B: 1-2->Final, 3-8->eliminated',
      '5.C: 1-2->Final, 3-8->eliminated',
      '5.D: 1-2->Final, 3-8->eliminated',
      '5.E: 1-8->eliminated',
    ].join(String.fromCharCode(10));
    const result = applyWaterfallGraphEdit(state, tooMany);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('rank 40');
    expect(result.error).toContain('only 37 players are registered');
  });

  it('current round = the entry round: changing its routes is saved, nothing re-drawn', () => {
    const state = playToLabel(buildTournament(), '5');
    const swapped = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-4->SemiA, 5,8->6C, 6,7->6B',
    );
    const result = applyWaterfallGraphEdit(state, swapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.rounds[state.curRound].waterfallRoutes).not.toEqual(
      state.rounds[state.curRound].waterfallRoutes,
    );
  });

  it('"Edit A": swapping which destination two ranks of a played round feed moves those names between the two pools, without touching the current round', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    const roundFive = state.curRound - 1; // "5" was just played to reach SemiA
    expect(state.rounds[roundFive].customLabel).toBe('5');
    const roomA = namesInRoom(state, roundFive, 1);
    const rank5Name = roomA[4];
    const rank6Name = roomA[5];

    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-4->SemiA, 6,8->6B, 5,7->6C',
    );
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();

    const sixBIndex = result.state.rounds.findIndex((round) => round.customLabel === '6B');
    const sixCIndex = result.state.rounds.findIndex((round) => round.customLabel === '6C');
    const sixBPool = (result.state.pendingBracketSeeds[sixBIndex] ?? []).map((seed) => seed.name);
    const sixCPool = (result.state.pendingBracketSeeds[sixCIndex] ?? []).map((seed) => seed.name);
    // Edited routing: rank 5 now goes to 6C (was 6B), rank 6 now goes to 6B (was 6C).
    expect(sixCPool).toContain(rank5Name);
    expect(sixBPool).toContain(rank6Name);
    expect(sixBPool).not.toContain(rank5Name);
    expect(sixCPool).not.toContain(rank6Name);
    // SemiA itself, the current round, is untouched.
    expect(result.state.assignments[state.curRound]).toEqual(state.assignments[state.curRound]);
  });

  it('"Edit B": a routing change that changes the current round\'s line-up re-draws it (no score yet) and rebuilds roomHistory to match a from-scratch replay', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    const roundFive = state.curRound - 1;
    const roomA = namesInRoom(state, roundFive, 1);
    const movedOutOfSemiA = roomA[3]; // rank 4, currently routed to SemiA

    // Same split (4 to SemiA, 2 to 6B, 2 to 6C) -- only membership changes:
    // rank 4 swaps places with rank 5.
    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-3,5->SemiA, 4,8->6B, 6,7->6C',
    );
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBe('SemiA');
    const newSemiANames = (result.state.assignments[state.curRound] ?? []).map((entry) => entry.name);
    expect(newSemiANames).not.toContain(movedOutOfSemiA);
    expect(newSemiANames).toHaveLength(state.rounds[state.curRound].players);

    // roomHistory: an unchanged-graph edit never redraws, so it must leave
    // roomHistory byte-for-byte as a real advance would have built it.
    const unchangedReplay = applyWaterfallGraphEdit(state, currentText(state));
    expect(unchangedReplay.ok).toBe(true);
    if (!unchangedReplay.ok) return;
    expect(unchangedReplay.redrawnRound).toBeNull();
    expect(unchangedReplay.state.roomHistory).toEqual(state.roomHistory);
  });

  it('on a drawPublication: "fixed" qual-table fixture, re-drawing the current round leaves every earlier-round roomHistory entry untouched', () => {
    // Fixed-draw qual rounds never call recordRoomHistory (see
    // transitions.ts), so this fixture's roomHistory holds only entries
    // recorded from the waterfall bracket's own (non-fixed) rounds -- a
    // meaningful check that the incremental fix, not a from-scratch rebuild,
    // is what actually runs.
    const state = playToLabel(buildTournament({ drawPublication: 'fixed' }), 'SemiA');
    expect(Object.keys(state.roomHistory).length).toBeGreaterThan(0);

    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-3,5->SemiA, 4,8->6B, 6,7->6C',
    );
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBe('SemiA');

    // Excludes pairs the redraw itself just re-seated together -- recordRoomHistory
    // correctly bumps THOSE to curRound (their true most-recent meeting now),
    // same as any ordinary advance would. Every other pair's history is untouched.
    const redrawnPairs = new Set<string>();
    const byRoom = new Map<number, string[]>();
    for (const entry of result.state.assignments[state.curRound] ?? []) {
      if (entry.room === null) continue;
      byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    for (const roomNames of byRoom.values()) {
      for (let first = 0; first < roomNames.length; first += 1) {
        for (let second = first + 1; second < roomNames.length; second += 1) {
          redrawnPairs.add(roomPairKey(roomNames[first], roomNames[second]));
        }
      }
    }
    let checked = 0;
    for (const [key, roundIndex] of Object.entries(state.roomHistory)) {
      if (roundIndex >= state.curRound || redrawnPairs.has(key)) continue;
      checked += 1;
      expect(result.state.roomHistory[key]).toBe(roundIndex);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the same line-up-changing edit is refused once a score has been entered in the current round', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    const scored = { ...state, scores: { ...state.scores, [`r${state.curRound}-rm1-p0`]: 100 } };

    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-3,5->SemiA, 4,8->6B, 6,7->6C',
    );
    const result = applyWaterfallGraphEdit(scored, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('SemiA');
    expect(result.error).toContain('score');
  });

  it('refuses an edit that would change the line-up of a round already played (two rounds played)', () => {
    // Play through "5", "SemiA" and "6B" so that, by the time 6C is current,
    // 6B's own recorded line-up is already in the past.
    const state = playToLabel(playToLabel(playToLabel(buildTournament(), 'SemiA'), '6B'), '6C');
    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-4->SemiA, 6,8->6B, 5,7->6C',
    );
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('already been played');
  });

  it.each([
    ['resize', 'SemiA = 8', 'SemiA = 2x4'],
    ['rename', 'SemiA = 8', 'Semis1 = 8'],
    ['un-Final', 'Final = 8 FINAL', 'Final = 8'],
  ])('refuses to %s a reached round', (_case, from, to) => {
    const state = playToLabel(buildTournament(), 'SemiA');
    let edited = SPREADSHEET_GRAPH.replace(from, to);
    if (to === 'Semis1 = 8') {
      edited = edited.replaceAll('SemiA', 'Semis1').replace('Semis1 = 8', 'Semis1 = 8'); // keep routes consistent
    }
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(false);
  });

  it('allows resizing, renaming and removing an unreached round', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    // 7A is unreached from SemiA (fed by 6B/6C, both still ahead).
    const renamed = SPREADSHEET_GRAPH.replaceAll('7A', 'Repechage');
    const result = applyWaterfallGraphEdit(state, renamed);
    expect(result.ok).toBe(true);
  });

  it('refuses a band from an unreached round into a reached one (the fixedPrefix violation)', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    // Route part of 7A (unreached) into SemiA (already played) instead of eliminated.
    const edited = SPREADSHEET_GRAPH.replace('7A: 1-4->SemiB, 5-8->eliminated', '7A: 1-4->SemiB, 5-8->SemiA');
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('semia');
  });

  it('case 9: inserting an unreached round that shifts the play order re-indexes waterfallRoutes, pending pools and roundNums', () => {
    // "5", "SemiA", "6B", "6C" and "7A" have all been played/reached; SemiB
    // and Final haven't. SemiA's bottom half is already waiting in
    // pendingBracketSeeds for SemiB, at SemiB's OLD absolute index.
    const state = playToLabel(buildTournament(), '7A');
    const semiAIndex = state.rounds.findIndex((round) => round.customLabel === 'SemiA');
    const oldSemiBIndex = state.rounds.findIndex((round) => round.customLabel === 'SemiB');
    const oldFinalIndex = state.rounds.findIndex((round) => round.customLabel === 'Final');
    const oldFinalRoundNum = state.rounds[oldFinalIndex].roundNum;
    expect(state.pendingBracketSeeds[oldSemiBIndex]?.length).toBeGreaterThan(0);
    expect(state.rounds[semiAIndex].waterfallRoutes?.[0][7]).toBe(oldSemiBIndex); // rank 8 -> SemiB

    // Route all of 7A's output through a new "Repechage" round instead of
    // straight to SemiB/eliminated -- 7A's shape (still reached) is
    // unchanged, only its own routing and everything after it in the graph.
    // Repechage is fed entirely by 7A (the CURRENT round, not yet played),
    // so nothing has fed it yet.
    const edited = `
ROUNDS:
5 = 4x8
6B = 8
6C = 8
7A = 8
Repechage = 8
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
7A: 1-8->Repechage
Repechage: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull(); // 7A (current round) isn't fed differently

    const newSemiBIndex = result.state.rounds.findIndex((round) => round.customLabel === 'SemiB');
    const newFinalIndex = result.state.rounds.findIndex((round) => round.customLabel === 'Final');
    const repechageIndex = result.state.rounds.findIndex((round) => round.customLabel === 'Repechage');
    expect(newSemiBIndex).not.toBe(oldSemiBIndex);
    expect(repechageIndex).toBe(oldSemiBIndex); // Repechage lands exactly where SemiB used to be

    // A played round's waterfallRoutes now point to the new indices.
    expect(result.state.rounds[semiAIndex].waterfallRoutes?.[0][7]).toBe(newSemiBIndex);

    // roundNums are renumbered: Final moved one slot later in the bracket.
    expect(result.state.rounds[newFinalIndex].roundNum).toBe(oldFinalRoundNum + 1);

    // No leftover entry at the old index -- it now belongs to Repechage,
    // which nobody has fed yet (7A, its only source, hasn't been played).
    expect(result.state.pendingBracketSeeds[oldSemiBIndex]).toBeUndefined();
    expect(result.state.pendingBracketSeeds[newSemiBIndex]?.length).toBe(4);
    expect(result.state.pendingBracketSeeds[newFinalIndex]?.length).toBe(4);
  });

  it('case 11: after an edit, play round by round with the real advance code to the Final, which keeps its numGames', () => {
    const state = playToLabel(buildTournament(), 'SemiA');
    // Same "Edit A"-style swap as above -- doesn't touch the current round.
    const edited = SPREADSHEET_GRAPH.replace(
      '5.A: 1-4->SemiA, 5,8->6B, 6,7->6C',
      '5.A: 1-4->SemiA, 6,8->6B, 5,7->6C',
    );
    const result = applyWaterfallGraphEdit(state, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let current = result.state;
    const finalIndex = current.rounds.findIndex((round) => round.isFinal);
    const finalNumGames = current.rounds[finalIndex].numGames;
    for (let guard = 0; guard < 20 && current.curRound < finalIndex; guard += 1) {
      const advanced = advanceTournamentRound(scoreCurrentRound(current, 0));
      expect(advanced.status).toBe('advanced');
      if (advanced.status !== 'advanced') return;
      current = advanced.state;
    }
    expect(current.curRound).toBe(finalIndex);
    expect(current.rounds[finalIndex].numGames).toBe(finalNumGames);
    expect(current.rounds[finalIndex].isFinal).toBe(true);
  });
});

describe('applyWaterfallGraphEdit -- a graph with a Qual source', () => {
  const standings = (state: TournamentState) =>
    orderedQualificationTable(state).ordered.map((entry) => entry.name);
  const indexOf = (state: TournamentState, label: string) =>
    state.rounds.findIndex((round) => round.customLabel === label);
  const pool = (state: TournamentState, label: string) =>
    (state.pendingBracketSeeds[indexOf(state, label)] ?? []).map((seed) => seed.name);
  const seated = (state: TournamentState, label: string) =>
    (state.assignments[indexOf(state, label)] ?? []).map((entry) => entry.name);
  const GAP_QUAL = 'Qual: 1-16->R1, 17-19->eliminated, 20-27->R1C';

  function enterBracket(registered: number): TournamentState {
    const result = advanceTournamentRound(playToQualificationExit(buildQualWaterfall(registered)));
    if (result.status !== 'advanced') throw new Error('the pooling exit did not advance');
    return result.state;
  }

  it('during qualification, moves a gap into the routing: 17-19 out, 20-27 to R1C, qualAdv follows (43 registered)', () => {
    const state = { ...buildQualWaterfall(43), tieResolutions: { 'qual-cutoff': ['P1'] } };
    expect(state.cfg.qualAdv).toBe(24);
    const result = applyWaterfallGraphEdit(state, QUAL_GRAPH.replace('Qual: 1-16->R1, 17-24->R1C', GAP_QUAL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.state;
    expect(edited.cfg.qualAdv).toBe(27);
    const lastQual = edited.rounds.filter((round) => round.isQual).at(-1);
    const r1 = indexOf(edited, 'R1');
    const r1c = indexOf(edited, 'R1C');
    expect(lastQual?.standingsRoutes).toEqual([
      ...Array(16).fill(r1),
      'eliminated',
      'eliminated',
      'eliminated',
      ...Array(8).fill(r1c),
    ]);
    // The old cut lines' tie resolution no longer applies.
    expect(edited.tieResolutions['qual-cutoff']).toBeUndefined();
    // Playing on routes by the new bands.
    const exit = playToQualificationExit(edited);
    const order = standings(exit);
    const next = advanceTournamentRound(exit);
    expect(next.status).toBe('advanced');
    if (next.status !== 'advanced') return;
    // The edit gave the tournament its columns, so R1C is drawn together with R1.
    expect(new Set(seated(next.state, 'R1C'))).toEqual(new Set(order.slice(19, 27)));
    expect(new Set(seated(next.state, 'R1'))).toEqual(new Set(order.slice(0, 16)));
  });

  it('during qualification, refuses a routing that reaches past the units still in the roster', () => {
    const start = buildQualWaterfall(31);
    // Four withdrawals leave 27 units; the graph still routes up to rank 27, so it is fine ...
    let state = start;
    for (const name of start.assignments[0].slice(0, 4).map((entry) => entry.name)) {
      state = removeRosterUnit(state, name);
    }
    expect(applyWaterfallGraphEdit(state, QUAL_GRAPH.replace('17-24->R1C', '20-27->R1C')).ok).toBe(true);
    // ... but one more withdrawal puts rank 27 out of reach, by roster size, not by the registered count.
    state = removeRosterUnit(state, start.assignments[0][4].name);
    const result = applyWaterfallGraphEdit(state, QUAL_GRAPH.replace('17-24->R1C', '20-27->R1C'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('only 26 players are registered');
  });

  it('once the bracket is entered, re-draws an unscored R1 when the edit changes its line-up', () => {
    const state = enterBracket(43);
    const order = standings(state);
    const swapped = QUAL_GRAPH.replace(
      'Qual: 1-16->R1, 17-24->R1C',
      'Qual: 1-15->R1, 16->R1C, 17->R1, 18-24->R1C',
    );
    const result = applyWaterfallGraphEdit(state, swapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBe('R1');
    expect(new Set(seated(result.state, 'R1'))).toEqual(new Set([...order.slice(0, 15), order[16]]));
    expect(pool(result.state, 'R1C')).toEqual([order[15], ...order.slice(17, 24)]);
  });

  it('once the bracket is entered, refuses an edit that would change a scored R1', () => {
    const state = scoreCurrentRound(enterBracket(43), 0);
    const swapped = QUAL_GRAPH.replace(
      'Qual: 1-16->R1, 17-24->R1C',
      'Qual: 1-15->R1, 16->R1C, 17->R1, 18-24->R1C',
    );
    const result = applyWaterfallGraphEdit(state, swapped);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('a score has already been entered in "R1"');
  });

  it("accepts an edit that only changes R1C's Qual band before R1C is drawn, and updates its pending pool", () => {
    const state = enterBracket(43);
    const order = standings(state);
    const shifted = QUAL_GRAPH.replace('17-24->R1C', '17-23->R1C, 25->R1C');
    const result = applyWaterfallGraphEdit(state, shifted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.cfg.qualAdv).toBe(25);
    expect(new Set(pool(result.state, 'R1C'))).toEqual(new Set([...order.slice(16, 23), order[24]]));
    // R1 keeps its rooms.
    expect(seated(result.state, 'R1')).toEqual(seated(state, 'R1'));
  });

  it('plays on to the Final after an edit during qualification', () => {
    const state = buildQualWaterfall(37);
    const edited = applyWaterfallGraphEdit(state, QUAL_GRAPH.replace('Qual: 1-16->R1, 17-24->R1C', GAP_QUAL));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(playThrough(edited.state, 0, null)).toEqual({ kind: 'ok' });
  });
});

describe('saving a graph after a withdrawal (Qual source)', () => {
  const advanced = (state: TournamentState): TournamentState => {
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
    return result.state;
  };
  const roundIndex = (state: TournamentState, label: string) =>
    state.rounds.findIndex((round) => round.customLabel === label);
  /** Everyone seated in a bracket-phase round or waiting in a pool (the qualification rounds are left out). */
  const allSeeded = (state: TournamentState) => [
    ...Object.values(state.pendingBracketSeeds).flatMap((seeds) => seeds.map((seed) => seed.name)),
    ...state.assignments
      .slice(state.rounds.findIndex((round) => round.isWaterfall))
      .flatMap((entries) => entries.map((entry) => entry.name)),
  ];
  const saved = (state: TournamentState, text = QUAL_GRAPH) => {
    const result = applyWaterfallGraphEdit(state, text);
    if (!result.ok) throw new Error(`save refused: ${result.error}`);
    return result;
  };

  it.each([37, 43])(
    '%i: after removing a unit that waits for R2 (R1 played), the unchanged graph saves and changes nothing',
    (registered) => {
      const atR1c = advanced(
        scoreCurrentRound(advanced(playToQualificationExit(buildQualWaterfall(registered))), 0),
      );
      const r2 = roundIndex(atR1c, 'R2');
      const removed = removeRosterUnit(atR1c, atR1c.pendingBracketSeeds[r2][0].name);

      const result = saved(removed);

      expect(result.redrawnRound).toBeNull();
      expect(result.state.pendingBracketSeeds).toEqual(removed.pendingBracketSeeds);
      expect(result.state.assignments.slice(0, removed.curRound + 1)).toEqual(removed.assignments);
      expect(
        result.state.rounds.map((round) => [round.customLabel, round.rooms, round.players, round.advTotal]),
      ).toEqual(
        removed.rounds.map((round) => [round.customLabel, round.rooms, round.players, round.advTotal]),
      );
    },
  );

  it.each([37, 43])(
    '%i: after removing a unit that waits for R1C, the unchanged graph saves, R1C stays at 7 and the next rank is not pulled in',
    (registered) => {
      const atR1 = advanced(playToQualificationExit(buildQualWaterfall(registered)));
      const r1c = roundIndex(atR1, 'R1C');
      const order = orderedQualificationTable(atR1).ordered.map((entry) => entry.name);
      const waiting = atR1.pendingBracketSeeds[r1c][2].name;
      const removed = removeRosterUnit(atR1, waiting);
      const nextRank = order.find((name) => !allSeeded(atR1).includes(name));

      const result = saved(removed);

      expect(result.redrawnRound).toBeNull();
      expect(result.state.pendingBracketSeeds[r1c]).toHaveLength(7);
      expect(result.state.pendingBracketSeeds).toEqual(removed.pendingBracketSeeds);
      expect(allSeeded(result.state)).not.toContain(waiting);
      if (nextRank !== undefined) expect(allSeeded(result.state)).not.toContain(nextRank);
    },
  );

  it('after R1C was drawn short, a save keeping its declared 8 passes the shape check and shrinking it to 7 is refused', () => {
    const atR1 = advanced(playToQualificationExit(buildQualWaterfall(37)));
    const r1c = roundIndex(atR1, 'R1C');
    const removed = removeRosterUnit(atR1, atR1.pendingBracketSeeds[r1c][0].name);
    const atR1c = advanced(scoreCurrentRound(removed, 0));
    expect(atR1c.rounds[r1c]).toMatchObject({ rooms: [7], players: 7, declaredRooms: [8] });

    const result = saved(atR1c);
    expect(result.state.rounds[r1c]).toMatchObject({
      rooms: [7],
      players: 7,
      declaredRooms: [8],
      advTotal: 4,
    });
    expect(result.state.assignments[r1c]).toEqual(atR1c.assignments[r1c]);

    const smaller = QUAL_GRAPH.replace('R1C = 8', 'R1C = 7')
      .replace('17-24->R1C', '17-23->R1C')
      .replace('R1C: 1-4->Final, 5-8->eliminated', 'R1C: 1-4->Final, 5-7->eliminated');
    const refused = applyWaterfallGraphEdit(atR1c, smaller);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('already started');
  });

  it('a short reached round recounts the ranks it still sends on when its bands change (advTotal)', () => {
    const graph = QUAL_GRAPH.replace('R1C: 1-4->Final, 5-8->eliminated', 'R1C: 1-5->Final, 6-8->eliminated');
    const atR1 = advanced(playToQualificationExit(buildQualWaterfall(37, QUAL_GRAPH)));
    const r1c = roundIndex(atR1, 'R1C');
    const removed = removeRosterUnit(atR1, atR1.pendingBracketSeeds[r1c][0].name);
    const atR1c = advanced(scoreCurrentRound(removed, 0));
    const finalWithFive = graph.replace('R2: 1-4->Final, 5-8->eliminated', 'R2: 1-3->Final, 4-8->eliminated');
    const result = saved(atR1c, finalWithFive);
    expect(result.state.rounds[r1c]).toMatchObject({ rooms: [7], declaredRooms: [8], advTotal: 5 });
  });

  it('a unit swapped in while waiting keeps its place in the rebuilt pool', () => {
    const atR1 = advanced(
      playToQualificationExit({ ...buildQualWaterfall(37, ALL_ROUTED_GRAPHS[37]), reserves: ['Sub'] }),
    );
    const r1c = roundIndex(atR1, 'R1C');
    const waiting = atR1.pendingBracketSeeds[r1c][4].name;
    const swapped = swapIndividual(atR1, waiting, 'Sub');
    expect(swapped.pendingBracketSeeds[r1c][4].name).toBe('Sub');

    const result = saved(swapped, ALL_ROUTED_GRAPHS[37]);

    expect(result.state.pendingBracketSeeds[r1c]).toEqual(swapped.pendingBracketSeeds[r1c]);
    expect(allSeeded(result.state)).not.toContain(waiting);
  });

  it('a tournament without a stored exit order still saves as before', () => {
    const atR1 = advanced(playToQualificationExit(buildQualWaterfall(37)));
    const qualIndex = atR1.rounds.findIndex((round) => round.standingsExitOrder);
    expect(qualIndex).toBeGreaterThanOrEqual(0);
    const stripped = {
      ...atR1,
      rounds: atR1.rounds.map((round, index) =>
        index === qualIndex ? { ...round, standingsExitOrder: undefined } : round,
      ),
    };
    const result = saved(stripped);
    expect(result.state.pendingBracketSeeds).toEqual(atR1.pendingBracketSeeds);
  });
});

describe('applyWaterfallGraphEdit -- columns', () => {
  // QUAL_GRAPH's columns: R1 and R1C (both fed by Qual only) together, then R2, then the Final.
  const COLUMNS: Record<string, number> = { R1: 1, R1C: 1, R2: 2, Final: 3 };
  // R1D joins the graph: ranks 25-30 of the qualification table, 2 of them on to the Final.
  const WITH_R1D = QUAL_GRAPH.replace('R1C = 8\n', 'R1C = 8\nR1D = 6\n')
    .replace('17-24->R1C', '17-24->R1C, 25-30->R1D')
    .replace(
      'R1C: 1-4->Final, 5-8->eliminated',
      'R1C: 1-2->Final, 3-8->eliminated\nR1D: 1-2->Final, 3-6->eliminated',
    );
  const indexOf = (state: TournamentState, label: string) =>
    state.rounds.findIndex((round) => round.customLabel === label);
  const columnsOf = (state: TournamentState) =>
    Object.fromEntries(
      state.rounds
        .filter((round) => round.isWaterfall)
        .map((round) => [round.customLabel, round.waterfallColumn]),
    );

  function enterBracket(columns: boolean): TournamentState {
    const exit = playToQualificationExit(buildQualWaterfall(37, QUAL_GRAPH, {}, { columns }));
    const result = advanceTournamentRound(exit);
    if (result.status !== 'advanced') throw new Error('the pooling exit did not advance');
    return result.state;
  }

  /** The bracket entered with its columns stored: R1 and R1C are drawn together. */
  const inFirstColumn = () => enterBracket(true);

  /** Scores the given round alone, with the real scoring helper. */
  function scoreRound(state: TournamentState, label: string): TournamentState {
    const scored = scoreCurrentRound({ ...state, curRound: indexOf(state, label) }, 0);
    return { ...scored, curRound: state.curRound };
  }

  const edit = (state: TournamentState, text: string) => applyWaterfallGraphEdit(state, text);
  const seatedIn = (state: TournamentState, label: string) =>
    new Set((state.assignments[indexOf(state, label)] ?? []).map((entry) => entry.name));

  it('saves unchanged text with both rounds of the column kept, nothing redrawn and every column stored', () => {
    const state = inFirstColumn();
    const result = edit(state, QUAL_GRAPH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(columnsOf(result.state)).toEqual(COLUMNS);
    expect(result.state.assignments.slice(0, state.assignments.length)).toEqual(state.assignments);
  });

  it('refuses a different column number for a round that has started, and accepts its own', () => {
    const state = inFirstColumn();
    const moved = edit(state, QUAL_GRAPH.replace('R1C = 8', 'R1C = 8 COLUMN 2'));
    expect(!moved.ok && moved.error).toBe('Round "R1C" has already started in column 1.');
    expect(edit(state, QUAL_GRAPH.replace('R1C = 8', 'R1C = 8 COLUMN 1')).ok).toBe(true);
  });

  it('refuses a number in a column that has started for a round that has not, and shows the first free one', () => {
    const state = inFirstColumn();
    const refused = edit(state, WITH_R1D.replace('R1D = 6', 'R1D = 6 COLUMN 1'));
    expect(!refused.ok && refused.error).toBe('Column 1 has already started -- choose column 2 or later.');
    const accepted = edit(state, WITH_R1D.replace('R1D = 6', 'R1D = 6 COLUMN 2'));
    expect(accepted.ok && columnsOf(accepted.state)).toEqual({ ...COLUMNS, R1D: 2 });
    expect(
      accepted.ok &&
        accepted.state.rounds.filter((round) => round.waterfallColumnSet).map((round) => round.customLabel),
    ).toEqual(['R1D']);
  });

  it('puts a round added after the bracket started, fed only by Qual, in the first column after the current one', () => {
    const result = edit(inFirstColumn(), WITH_R1D);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(columnsOf(result.state)).toEqual({ ...COLUMNS, R1D: 2 });
    expect(
      result.state.rounds.filter((round) => round.isWaterfall).map((round) => round.customLabel),
    ).toEqual(['R1', 'R1C', 'R1D', 'R2', 'Final']);
    expect(result.state.curRound).toBe(indexOf(result.state, 'R1'));
  });

  it('gives a tournament generated before columns existed its columns when the save comes before the bracket starts', () => {
    const legacy = buildQualWaterfall(37);
    expect(legacy.rounds.every((round) => round.waterfallColumn === undefined)).toBe(true);
    const numbered = QUAL_GRAPH.replace('R1C = 8', 'R1C = 8 COLUMN 2').replace('R2 = 8', 'R2 = 8 COLUMN 3');
    const result = edit(legacy, numbered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(columnsOf(result.state)).toEqual({ R1: 1, R1C: 2, R2: 3, Final: 4 });
    const numberedRounds = result.state.rounds.filter((round) => round.waterfallColumnSet);
    expect(numberedRounds.map((round) => round.customLabel)).toEqual(['R1C', 'R2']);
    const bracket = advanceTournamentRound(playToQualificationExit(result.state));
    expect(bracket.status).toBe('advanced');
    if (bracket.status !== 'advanced') return;
    expect(seatedIn(bracket.state, 'R1').size).toBe(16);
    expect(seatedIn(bracket.state, 'R1C').size).toBe(0);
    const unnumbered = edit(legacy, QUAL_GRAPH);
    expect(unnumbered.ok && columnsOf(unnumbered.state)).toEqual(COLUMNS);
  });

  it('keeps a state with no stored columns playing one round at a time, and refuses a COLUMN number in it', () => {
    const state = enterBracket(false);
    const edited = edit(state, WITH_R1D);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.state.rounds.every((round) => round.waterfallColumn === undefined)).toBe(true);
    const numbered = edit(state, WITH_R1D.replace('R1D = 6', 'R1D = 6 COLUMN 2'));
    expect(!numbered.ok && numbered.error).toBe(
      "This tournament's rounds are played one at a time -- columns can't be set once its bracket has started.",
    );
  });

  describe('when the edit changes the line-up of the rounds in the current column', () => {
    // Ranks 9-16 and 17-24 trade places: R1 and R1C both get different units.
    const SWAPPED = QUAL_GRAPH.replace('Qual: 1-16->R1, 17-24->R1C', 'Qual: 1-8, 17-24->R1, 9-16->R1C');

    it('re-draws every round of the column that has no score', () => {
      const state = inFirstColumn();
      const result = edit(state, SWAPPED);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.redrawnRound).toBe('R1 + R1C');
      const order = orderedQualificationTable(state).ordered.map((entry) => entry.name);
      expect(seatedIn(result.state, 'R1')).toEqual(new Set([...order.slice(0, 8), ...order.slice(16, 24)]));
      expect(seatedIn(result.state, 'R1C')).toEqual(new Set(order.slice(8, 16)));
    });

    it('refuses the edit when a score has been entered in a later round of the column', () => {
      const result = edit(scoreRound(inFirstColumn(), 'R1C'), SWAPPED);
      expect(!result.ok && result.error).toContain('a score has already been entered in "R1C"');
    });

    it('refuses the edit when a score has been entered in the first round of the column', () => {
      const result = edit(scoreRound(inFirstColumn(), 'R1'), SWAPPED);
      expect(!result.ok && result.error).toContain('a score has already been entered in "R1"');
    });
  });
});
