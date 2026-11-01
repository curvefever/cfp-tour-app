import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { computeRankings } from '../rankings';
import { currentColumn } from '../round-columns';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { parseWaterfallDraft, serializeWaterfallDraft } from '../waterfall-draft';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import { scoreCurrentRound } from './play-through';

/** The organiser's 12-team layout: placement matches for the teams out of Round 4 - Lower and Round 5 - Lower. */
const RANKING_GRAPH = `
ROUNDS:
Round 4 - Upper = 2x2
Round 4 - Lower = 2x2
Semi-Final A = 2 BO3
Semi-Final B = 2 BO3
Round 5 - Lower = 2x2
Round 5 - Ranking = 2 RANKING
Round 6 - Lower = 2
Round 6 - Ranking = 2 RANKING
Final = 2 FINAL BO3

ROUTES:
Groups: 1-4->Round 4 - Upper, 5-8->Round 4 - Lower
Round 4 - Upper.A: 1->Semi-Final A, 2->Round 5 - Lower
Round 4 - Upper.B: 1->Semi-Final A, 2->Round 5 - Lower
Round 4 - Lower.A: 1->Round 5 - Lower, 2->Round 5 - Ranking
Round 4 - Lower.B: 1->Round 5 - Lower, 2->Round 5 - Ranking
Semi-Final A: 1->Final, 2->Semi-Final B
Semi-Final B: 1->Final
Round 5 - Lower.A: 1->Round 6 - Lower, 2->Round 6 - Ranking
Round 5 - Lower.B: 1->Round 6 - Lower, 2->Round 6 - Ranking
Round 6 - Lower: 1->Semi-Final B
`;

const ROOM = { min: 2, max: 2, ideal: 2 };
const GROUPS = { roomSize: ROOM, entrantCount: 12, standingsSource: true, standingsKind: 'groups' } as const;

function validate(text: string) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, GROUPS);
}

function teamsOf(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: 4 }, (_, slot) => ({ name: `p${index}-${slot}` })),
  }));
}

function generated(count: number, graph: string): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teamsOf(count) }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '4',
      qualifiersPerGroup: '2',
      groupExit: 'fair-cut',
      qualAdv: '8',
      oddCountStrategy: 'bye',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: graph,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true };
}

function advanced(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return result.state;
}

/** Scores every round of the column in play (a group round is a column of its own). */
function scoreColumn(state: TournamentState): TournamentState {
  const { start, end } = state.rounds[state.curRound].isWaterfall
    ? currentColumn(state)
    : { start: state.curRound, end: state.curRound };
  let current = state;
  for (let index = start; index <= end; index += 1) {
    current = { ...scoreCurrentRound({ ...current, curRound: index }, 4), curRound: state.curRound };
  }
  return current;
}

const labelOf = (state: TournamentState, ri: number) => state.rounds[ri].customLabel ?? 'Groups';

describe('RANKING rounds', () => {
  it('accept a round that sends nobody on and place it first in its column', () => {
    const result = validate(RANKING_GRAPH);
    if (!result.ok) throw new Error(result.error);
    const order = result.value.rounds.map((round, index) => `${result.value.columns[index]}:${round.label}`);
    expect(order).toEqual([
      '1:Round 4 - Upper',
      '1:Round 4 - Lower',
      '2:Round 5 - Ranking',
      '2:Semi-Final A',
      '2:Round 5 - Lower',
      '3:Round 6 - Ranking',
      '3:Round 6 - Lower',
      '4:Semi-Final B',
      '5:Final',
    ]);
    expect(result.value.rounds[2].isRanking).toBe(true);
  });

  it('still refuses an unmarked round that sends nobody on', () => {
    const result = validate(RANKING_GRAPH.replace('Round 5 - Ranking = 2 RANKING', 'Round 5 - Ranking = 2'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Round "Round 5 - Ranking" sends nobody on');
  });

  it('refuses a RANKING round that routes ranks on, and FINAL with RANKING', () => {
    const routed = validate(`${RANKING_GRAPH}Round 6 - Ranking: 1->Semi-Final B\n`);
    expect(routed.ok).toBe(false);
    if (!routed.ok) expect(routed.error).toContain('is marked RANKING but routes ranks on');
    const both = parseWaterfallGraph(
      RANKING_GRAPH.replace('Final = 2 FINAL BO3', 'Final = 2 FINAL RANKING BO3'),
    );
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.error).toContain('marked both FINAL and RANKING');
  });

  it('keeps the mark through the graph editor and a running tournament', () => {
    const draft = parseWaterfallDraft(RANKING_GRAPH, { standingsSource: true, standingsKind: 'groups' });
    if (!draft.ok) throw new Error(draft.error);
    expect(serializeWaterfallDraft(draft.value)).toContain('Round 5 - Ranking = 2 RANKING');
    const state = generated(12, RANKING_GRAPH);
    const stored = state.rounds.filter((round) => round.waterfallRanking).map((round) => round.customLabel);
    expect(stored).toEqual(['Round 5 - Ranking', 'Round 6 - Ranking']);
  });

  it('12 teams: the placement matches rank below the other eliminations of their column', () => {
    let state = generated(12, RANKING_GRAPH);
    const final = state.rounds.findIndex((round) => round.isFinal);
    for (let guard = 0; guard < 20 && state.curRound < final; guard += 1)
      state = advanced(scoreColumn(state));
    expect(state.curRound).toBe(final);

    const out = computeRankings(state)?.eliminatedList ?? [];
    const placed = out.map((entry) => `${entry.rank}:${labelOf(state, entry.ri)}`);
    expect(placed.slice(0, 6)).toEqual([
      '3:Semi-Final B',
      '4:Round 6 - Lower',
      '5:Round 6 - Ranking',
      '6:Round 6 - Ranking',
      '7:Round 5 - Ranking',
      '8:Round 5 - Ranking',
    ]);
    expect(placed.slice(6).every((entry) => entry.endsWith(':Groups'))).toBe(true);
    expect(out).toHaveLength(10);
  });
});
