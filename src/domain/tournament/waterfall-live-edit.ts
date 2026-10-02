import { rewindRoomHistory } from './seeding';
import { roundHasAnyScore } from './scoring';
import { routeWaterfallRound, seedRoundFromPendingPool } from './transitions';
import type { PendingBracketSeed, TournamentRound, TournamentState } from './types';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
} from './waterfall-bracket';

/**
 * Applying an edited waterfall graph to a running tournament: any round's
 * routing can change, including already-played rounds, as long as a played
 * round's own recorded line-up comes out identical after the edited routing
 * is replayed -- only the current round may be re-drawn, and only before it
 * has any score. `state.rounds` is the source of truth for what's actually
 * running, not the `settings.waterfallGraph` snapshot.
 */
export type WaterfallGraphEditResult =
  { ok: true; state: TournamentState; redrawnRound: string | null } | { ok: false; error: string };

const MISSING_CONFIG_MESSAGE =
  "Can't save — this tournament's gamemode configuration is missing a room size or Finals format. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.";

function sameNameSet(assignments: { name: string }[], seeds: PendingBracketSeed[]): boolean {
  const existing = new Set(assignments.map((entry) => entry.name));
  const replayed = new Set(seeds.map((seed) => seed.name));
  return existing.size === replayed.size && [...existing].every((name) => replayed.has(name));
}

export function applyWaterfallGraphEdit(state: TournamentState, text: string): WaterfallGraphEditResult {
  const firstWaterfallIndex = state.rounds.findIndex((round) => round.isWaterfall);
  if (firstWaterfallIndex === -1) {
    return { ok: false, error: 'This tournament has no waterfall bracket phase to edit.' };
  }
  const roomSize = state.gamemodeConfig.roomSize;
  const finalsGames = state.gamemodeConfig.finalsGames;
  if (!roomSize || finalsGames === undefined) {
    return { ok: false, error: MISSING_CONFIG_MESSAGE };
  }

  const entryRound = state.rounds[firstWaterfallIndex];
  const entrantCount = entryRound.players;
  // Empty while still in pooling (the bracket hasn't been entered yet).
  const reachedCount = Math.max(0, state.curRound - firstWaterfallIndex + 1);
  const reached = state.rounds.slice(firstWaterfallIndex, firstWaterfallIndex + reachedCount);
  const fixedPrefix = reached.map((round) => round.customLabel as string);

  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const validated = validateAndOrderWaterfallGraph(parsed.value, { roomSize, entrantCount, fixedPrefix });
  if (!validated.ok) return { ok: false, error: validated.error };
  const graph = validated.value;

  // Locked shape: a reached round keeps its label, room count, room size and
  // Final flag -- fixedPrefix already forces graph.rounds[0..reached.length)
  // to be these rounds in order, so this only needs to compare shape, not
  // identity.
  for (const [index, oldRound] of reached.entries()) {
    const spec = graph.rounds[index];
    const sameShape =
      spec &&
      spec.label === oldRound.customLabel &&
      spec.roomSizes.length === oldRound.rooms.length &&
      spec.roomSizes[0] === oldRound.rooms[0] &&
      spec.isFinal === oldRound.isFinal;
    if (!sameShape) {
      return {
        ok: false,
        error: `Can't save: "${oldRound.customLabel}" has already started, so its room count, room size and Final flag can't change. Only its routing can.`,
      };
    }
  }

  const materialized = waterfallBracketPhase(entrantCount, entryRound.roundNum, { graph, finalsGames });
  // Reached rounds keep their own round object (scores, numGames,
  // anonymousGames, ... untouched) -- only their routing and the advancement
  // total it implies are replaced. Unreached rounds are wholly new.
  const newBracketRounds: TournamentRound[] = materialized.map((spec, index) => {
    if (index >= reached.length) return spec;
    return { ...reached[index], waterfallRoutes: spec.waterfallRoutes, advTotal: spec.advTotal };
  });

  const keptLength = firstWaterfallIndex + reached.length;
  const tailLength = newBracketRounds.length - reached.length;
  const rounds = [...state.rounds.slice(0, firstWaterfallIndex), ...newBracketRounds];
  const assignments = [
    ...state.assignments.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): TournamentState['assignments'][number] => []),
  ];
  const byes = [
    ...state.byes.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): string[] => []),
  ];
  const luckyLosers = [
    ...state.luckyLosers.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): string[] => []),
  ];

  let working: TournamentState = { ...state, rounds, assignments, byes, luckyLosers };

  // Replay every already-played waterfall round (up to, but not including,
  // curRound -- curRound itself hasn't been advanced from yet) under the new
  // routing, accumulating per-destination pools exactly as advanceTournamentRound
  // would across a sequence of real advances.
  const replayPools = new Map<number, PendingBracketSeed[]>();
  for (let index = firstWaterfallIndex; index < state.curRound; index += 1) {
    const additions = routeWaterfallRound(working, index, working.rounds[index]);
    for (const [destination, seeds] of additions) {
      replayPools.set(destination, [...(replayPools.get(destination) ?? []), ...seeds]);
    }
  }

  // Compare every reached round but the entry round (which has no inbound
  // routes, so its line-up can never change) against what the new routing
  // would have produced.
  let redrawnRound: string | null = null;
  for (let index = firstWaterfallIndex + 1; index < keptLength; index += 1) {
    const round = working.rounds[index];
    if (sameNameSet(working.assignments[index] ?? [], replayPools.get(index) ?? [])) continue;
    if (index < state.curRound) {
      return {
        ok: false,
        error: `Can't save: "${round.customLabel}" has already been played with a different line-up. Undo the routing change that feeds it, or only edit rounds that haven't been played yet.`,
      };
    }
    if (roundHasAnyScore(state, index, state.rounds[index])) {
      return {
        ok: false,
        error: `Can't save: a score has already been entered in "${round.customLabel}", so its rooms can't be re-drawn. Undo the routing change that feeds it, or wait until the round is complete.`,
      };
    }
    redrawnRound = round.customLabel ?? null;
  }

  // Old pending pools keyed by an index that fell in the old waterfall
  // range but past curRound belong to rounds that no longer exist at that
  // index (the edit may have added, removed or reordered unreached rounds)
  // -- drop them and replace with the freshly replayed pools.
  const oldBracketLength = state.rounds.length - firstWaterfallIndex;
  const nextPending: Record<string, PendingBracketSeed[]> = {};
  for (const [key, seeds] of Object.entries(working.pendingBracketSeeds)) {
    const index = Number(key);
    const wasOldUnreachedWaterfallIndex =
      index >= firstWaterfallIndex &&
      index < firstWaterfallIndex + oldBracketLength &&
      index > state.curRound;
    if (wasOldUnreachedWaterfallIndex) continue;
    nextPending[key] = seeds;
  }
  for (const [destination, seeds] of replayPools) {
    if (destination > state.curRound) nextPending[destination] = seeds;
  }
  working = { ...working, pendingBracketSeeds: nextPending };

  if (redrawnRound !== null) {
    const curRound = state.curRound;
    working = {
      ...working,
      assignments: working.assignments.map((entry, index) => (index === curRound ? [] : entry)),
      byes: working.byes.map((entry, index) => (index === curRound ? [] : entry)),
      tieResolutions: Object.fromEntries(
        Object.entries(working.tieResolutions).filter(([key]) => !key.startsWith(`r${curRound}-`)),
      ),
      pendingBracketSeeds: { ...working.pendingBracketSeeds, [curRound]: replayPools.get(curRound) ?? [] },
    };
    working = {
      ...working,
      roomHistory: rewindRoomHistory(working.roomHistory, working.assignments, curRound),
    };
    const failure = seedRoundFromPendingPool(working, curRound);
    // Waterfall's headcount always fits exactly (validated against the
    // graph's own declared totals above); this is a defensive fallback.
    if (failure) return { ok: false, error: failure.message };
  }

  const settings = state.settings ? { ...state.settings, waterfallGraph: text } : state.settings;
  const gamemodeConfig =
    state.gamemodeConfig.graph !== undefined ? { ...state.gamemodeConfig, graph } : state.gamemodeConfig;
  working = { ...working, settings, gamemodeConfig, needsSave: true };

  return { ok: true, state: working, redrawnRound };
}
