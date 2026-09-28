import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { scoreCurrentRound } from './play-through';
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

function buildTournament(overrides: Parameters<typeof createDefaultSetup>[0] = {}): TournamentState {
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
  return result.state;
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

  it('refuses a replacement graph whose entry total no longer matches the real entrant count', () => {
    const state = buildTournament();
    const mismatched = `
ROUNDS:
5 = 4x7
Final = 8 FINAL

ROUTES:
5.A: 1-4->Final, 5-7->eliminated
5.B: 1-4->Final, 5-7->eliminated
5.C: 1-7->eliminated
5.D: 1-7->eliminated
`;
    const result = applyWaterfallGraphEdit(state, mismatched);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('must match exactly');
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
