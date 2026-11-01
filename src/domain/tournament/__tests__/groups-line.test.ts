import { describe, expect, it } from 'vitest';
import {
  GROUP_BAND_KEY_PREFIX,
  getAllColumnTies,
  hasPendingColumnTies,
  isTieResolved,
  selectGroupExit,
} from '../advancement';
import { isFedOnlyByStandings } from '../bracket-replay';
import { expectedNextColumn } from '../expected-draw';
import { generateTournament } from '../generation';
import { resolveTournamentTie } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { parseWaterfallDraft, serializeWaterfallDraft } from '../waterfall-draft';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import { scoreCurrentRound } from './play-through';

type Setup = Parameters<typeof createDefaultSetup>[0];

const ROOM = { min: 2, max: 2, ideal: 2 };

/** 8 units through: R1 and R1C (4 each) play head to head, their winners meet in R2, and the Final follows. */
const TWO_BANDS = `
ROUNDS:
R1 = 2x2
R1C = 2x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
Groups: 1-4->R1, 5-8->R1C
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1C.A: 1->R2, 2->eliminated
R1C.B: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

function validate(text: string, options: Parameters<typeof validateAndOrderWaterfallGraph>[1]) {
  const parsed = parseWaterfallGraph(text, { allowIncomplete: true });
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, options);
}

function teamsOf(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: 4 }, (_, slot) => ({ name: `p${index}-${slot}` })),
  }));
}

function generate(count: number, graph: string, setup: Setup = {}) {
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teamsOf(count) }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '4',
      oddCountStrategy: 'bye',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: graph,
      ...setup,
    }),
    createTournamentRuntime(),
  );
}

function generated(count: number, graph: string, setup: Setup = {}): TournamentState {
  const result = generate(count, graph, setup);
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true };
}

/** Scores every room of the round in play with the first-listed team winning 30 to 20: the records repeat across the groups. */
function scoreLevel(state: TournamentState): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    for (const key of scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: 4,
    })) {
      scores[key] = position === 0 ? 30 : 20;
    }
  }
  return { ...state, scores };
}

function advanced(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return result.state;
}

/** Plays the group rounds, the last one scored but not advanced: the state a Next Round would leave the groups from. */
function atTheExit(
  start: TournamentState,
  score: (state: TournamentState) => TournamentState,
): TournamentState {
  let state = start;
  while (state.rounds[state.curRound + 1]?.isGroupStage) state = advanced(score(state));
  return score(state);
}

const roomsOf = (state: TournamentState, roundIndex: number) => {
  const rooms = new Map<number, string[]>();
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()];
};

const indexOfLabel = (state: TournamentState, label: string) =>
  state.rounds.findIndex((round) => round.customLabel === label);

const groupOf = (state: TournamentState, name: string) =>
  state.groups.find((group) => group.members.includes(name))?.label;

describe('the Groups line in the graph text', () => {
  it('is read under a group stage, as routes by group exit rank', () => {
    const graph = validate(TWO_BANDS, {
      roomSize: ROOM,
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
    });
    expect(graph.ok).toBe(true);
    if (graph.ok) expect(graph.value.qualRoutes).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('is refused under a qualification table and under no pooling phase, naming the right line', () => {
    const forQual = validate(TWO_BANDS, { roomSize: ROOM, entrantCount: 12, standingsSource: true });
    expect(forQual.ok).toBe(false);
    if (!forQual.ok) expect(forQual.error).toMatch(/Groups line routes a group stage.*use a Qual line/);
    const forNone = validate(TWO_BANDS, { roomSize: ROOM, entrantCount: 12 });
    expect(forNone.ok).toBe(false);
    if (!forNone.ok) expect(forNone.error).toMatch(/no group stage -- remove the Groups line/);
  });

  it('a Qual line is refused under a group stage, naming Groups', () => {
    const qual = TWO_BANDS.replace('Groups:', 'Qual:');
    const result = validate(qual, {
      roomSize: ROOM,
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Qual line routes a qualification table.*use a Groups line/);
  });

  it('without a line a group-stage graph is read as the entry round taking every rank', () => {
    const text = `
ROUNDS:
R1 = 4x2
Final = 2 FINAL

ROUTES:
R1.A: 1->Final
R1.B: 1->Final
`;
    const result = validate(text, {
      roomSize: ROOM,
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.qualRoutes).toHaveLength(8);
  });

  it.each([
    ['overlapping bands', 'Groups: 1-4->R1, 4-8->R1C', /rank 4 is routed more than once/],
    ['a room letter', 'Groups.A: 1-4->R1, 5-8->R1C', /gives "Groups" a room letter/],
    ['nothing sent on', 'Groups: 1-8->eliminated', /sends no group exit rank on/],
    ['an undeclared round', 'Groups: 1-4->R1, 5-8->Nowhere', /Groups routes to "Nowhere"/],
  ])('refuses %s', (_name, line, message) => {
    const text = TWO_BANDS.replace('Groups: 1-4->R1, 5-8->R1C', line);
    const result = validate(text, {
      roomSize: ROOM,
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it('a round named Groups is an error', () => {
    const text = TWO_BANDS.replace('R2 = 2x2', 'Groups = 2x2')
      .replaceAll('R2.', 'Groups.')
      .replaceAll('->R2', '->Groups');
    const parsed = parseWaterfallGraph(text, { allowIncomplete: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/"Groups" stands for the group stage/);
  });

  it('a graph cannot have both lines', () => {
    const parsed = parseWaterfallGraph(`${TWO_BANDS}\nQual: 1-8->R1\n`, { allowIncomplete: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/not both/);
  });
});

describe('the editor draft keeps the Groups line', () => {
  it('reads it under a group stage and writes it back as Groups', () => {
    const draft = parseWaterfallDraft(TWO_BANDS, {
      standingsSource: true,
      standingsKind: 'groups',
      rankCount: 12,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.standingsKind).toBe('groups');
    expect(draft.value.qualRoutes?.slice(0, 8)).toEqual(['R1', 'R1', 'R1', 'R1', 'R1C', 'R1C', 'R1C', 'R1C']);
    expect(serializeWaterfallDraft(draft.value)).toContain('Groups: 1-4->R1, 5-8->R1C');
  });

  it('refuses a Qual line under a group stage', () => {
    const draft = parseWaterfallDraft(TWO_BANDS.replace('Groups:', 'Qual:'), {
      standingsSource: true,
      standingsKind: 'groups',
    });
    expect(draft.ok).toBe(false);
  });
});

describe('generation with a Groups line', () => {
  it('13 teams (groups 5, 4, 4), fair cut, 8 through: the total is the highest routed rank', () => {
    const state = generated(13, TWO_BANDS, { groupExit: 'fair-cut', qualAdv: '2' });
    expect(state.groups.map((group) => group.members.length)).toEqual([5, 4, 4]);
    expect(state.cfg.qualAdv).toBe(8);
    expect(state.rounds.find((round) => round.isGroupStage && round.standingsRoutes)).toBeDefined();
  });

  it('even split accepts 8 over 3 groups', () => {
    expect(generate(13, TWO_BANDS, { groupExit: 'even-split' }).status).toBe('generated');
  });

  it('per group refuses a line that 3 groups cannot share, naming the numbers that work', () => {
    const result = generate(13, TWO_BANDS);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toBe(
        "The Groups line sends 8 on, but 3 groups can't each send the same number -- route 6 or 9, or choose Even split or Fair cut.",
      );
    }
  });

  it('per group derives the qualifiers per group: 16 teams in 4 groups, 8 on, is 2 each', () => {
    const state = generated(16, TWO_BANDS);
    expect(state.cfg.qualifiersPerGroup).toBe(2);
  });

  it('a line that routes more than the teams registered is refused', () => {
    const result = generate(6, TWO_BANDS, { groupExit: 'fair-cut' });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toMatch(/only 6 players are registered/);
  });
});

describe('the organiser example: 3 groups of 4, fair cut 8, Groups: 1-4->R1, 5-8->R1C', () => {
  const start = () => generated(12, TWO_BANDS, { groupExit: 'fair-cut' });

  it('draws R1 from exit ranks 1-4 and R1C from ranks 5-8, the rest are eliminated by the line', () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const exit = atTheExit(start(), (state) => seedScores(scoreCurrentRound(state, 4), seed));
      const order = selectGroupExit(exit, computedStandings(exit)).advancing;
      expect(order).toHaveLength(8);
      const next = advanced(exit);
      const r1 = roomsOf(next, indexOfLabel(next, 'R1')).flat();
      const r1c = roomsOf(next, indexOfLabel(next, 'R1C')).flat();
      expect([...r1].sort()).toEqual(order.slice(0, 4).sort());
      expect([...r1c].sort()).toEqual(order.slice(4).sort());
      for (const room of [
        ...roomsOf(next, indexOfLabel(next, 'R1')),
        ...roomsOf(next, indexOfLabel(next, 'R1C')),
      ]) {
        expect(new Set(room.map((name) => groupOf(next, name))).size, room.join()).toBe(room.length);
      }
    }
  });

  it('stores the exit order on the last group round', () => {
    const exit = atTheExit(start(), (state) => scoreCurrentRound(state, 4));
    const next = advanced(exit);
    const last = next.rounds.find((round) => round.standingsRoutes);
    expect(last?.standingsExitOrder).toHaveLength(8);
  });

  it('Rankings-style liveness: a band that waits is held in the pool, not lost', () => {
    const waiting = TWO_BANDS.replace('R1C = 2x2', 'R1C = 2x2 COLUMN 2').replace(
      'R2 = 2x2',
      'R2 = 2x2 COLUMN 3',
    );
    const exit = atTheExit(generated(12, waiting, { groupExit: 'fair-cut' }), (state) =>
      scoreCurrentRound(state, 4),
    );
    const next = advanced(exit);
    const waitingIndex = indexOfLabel(next, 'R1C');
    expect(next.pendingBracketSeeds[waitingIndex]).toHaveLength(4);
    expect(next.assignments[waitingIndex]).toBeUndefined();
  });
});

describe('a Groups-fed round that is also fed by another round keeps the wave fill', () => {
  const MIXED = `
ROUNDS:
R1 = 2x2
R2 = 3x2
R3 = 2x2
Final = 2 FINAL

ROUTES:
Groups: 1-4->R1, 5-8->R2
R1.A: 1->R3, 2->R2
R1.B: 1->R3, 2->R2
R2.A: 1->R3
R2.B: 1->R3
R3.A: 1->Final
R3.B: 1->Final
`;

  it('is told apart from a round fed only by the groups', () => {
    const state = generated(16, MIXED);
    expect(isFedOnlyByStandings(state.rounds, indexOfLabel(state, 'R1'))).toBe(true);
    expect(isFedOnlyByStandings(state.rounds, indexOfLabel(state, 'R2'))).toBe(false);
  });

  it('plays through the groups and R1, then draws R2 from both sources', () => {
    let state = advanced(atTheExit(generated(16, MIXED), (current) => scoreCurrentRound(current, 4)));
    expect(state.rounds[state.curRound].customLabel).toBe('R1');
    state = advanced(scoreCurrentRound(state, 4));
    expect(state.rounds[state.curRound].customLabel).toBe('R2');
    expect(roomsOf(state, state.curRound).flat()).toHaveLength(6);
  });
});

describe('31 teams, even split, a three-band line', () => {
  const THREE_BANDS = `
ROUNDS:
R1 = 4x2
R1C = 2x2
R1D = 2x2
R2 = 4x2
R3 = 2x2
Final = 2 FINAL

ROUTES:
Groups: 1-8->R1, 9-12->R1C, 13-16->R1D
R1.A: 1->R2
R1.B: 1->R2
R1.C: 1->R2
R1.D: 1->R2
R1C.A: 1->R2
R1C.B: 1->R2
R1D.A: 1->R2
R1D.B: 1->R2
R2.A: 1->R3
R2.B: 1->R3
R2.C: 1->R3
R2.D: 1->R3
R3.A: 1->Final
R3.B: 1->Final
`;

  it('sends the right units to each band, none twice', () => {
    const start = generated(31, THREE_BANDS, { groupExit: 'even-split' });
    expect(start.groups.map((group) => group.members.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 3]);
    const exit = atTheExit(start, (state) => scoreCurrentRound(state, 4));
    const order = selectGroupExit(exit, computedStandings(exit)).advancing;
    expect(order).toHaveLength(16);
    const next = advanced(exit);
    const bands = ['R1', 'R1C', 'R1D'].map((label) => roomsOf(next, indexOfLabel(next, label)).flat());
    expect(bands.map((band) => band.length)).toEqual([8, 4, 4]);
    expect(bands[0].sort()).toEqual(order.slice(0, 8).sort());
    expect(bands[1].sort()).toEqual(order.slice(8, 12).sort());
    expect(bands[2].sort()).toEqual(order.slice(12).sort());
    expect(new Set(bands.flat()).size).toBe(16);
  });
});

/** Picks the first units of every tie of the column but `keepKey`, until none of the others is pending. */
function resolveEveryTieBut(start: TournamentState, keepKey: string): TournamentState {
  let state = start;
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = Object.entries(getAllColumnTies(state)).find(
      ([key, tie]) => key !== keepKey && !isTieResolved(key, tie, state),
    );
    if (!pending) return state;
    const [key, tie] = pending;
    const next = tie.players
      .map((player) => player.name)
      .find((name) => !(state.tieResolutions[key] ?? []).includes(name));
    if (next === undefined) return state;
    state = resolveTournamentTie(state, key, next);
  }
  return state;
}

describe('a tie at a band boundary is the admin pick', () => {
  const levelExit = () => atTheExit(generated(12, TWO_BANDS, { groupExit: 'fair-cut' }), scoreLevel);

  it('raises group-band-<rank> where level runners-up straddle R1 and R1C, and blocks Next Round', () => {
    const exit = levelExit();
    const ties = getAllColumnTies(exit);
    const bandKeys = Object.keys(ties).filter((key) => key.startsWith(GROUP_BAND_KEY_PREFIX));
    expect(bandKeys).toEqual(['group-band-4']);
    expect(ties['group-band-4'].players).toHaveLength(3);
    expect(hasPendingColumnTies(exit)).toBe(true);
    expect(advanceTournamentRound(exit).status).toBe('blocked');
  });

  it('the pick decides which round each enters', () => {
    const settled = resolveEveryTieBut(levelExit(), 'group-band-4');
    const runners = getAllColumnTies(settled)['group-band-4'].players.map((player) => player.name);
    expect(runners).toHaveLength(3);
    let exit = resolveTournamentTie(settled, 'group-band-4', runners[2]);
    exit = resolveTournamentTie(exit, 'group-band-4', runners[1]);
    expect(hasPendingColumnTies(exit)).toBe(false);
    const next = advanced(exit);
    const r1 = roomsOf(next, indexOfLabel(next, 'R1')).flat();
    expect(r1).toContain(runners[2]);
    expect(r1).not.toContain(runners[0]);
    expect(roomsOf(next, indexOfLabel(next, 'R1C')).flat()).toContain(runners[0]);
  });

  it('a level pair inside one band raises nothing', () => {
    const oneBand = TWO_BANDS.replace('Groups: 1-4->R1, 5-8->R1C', 'Groups: 1-6->R1, 7-8->R1C')
      .replace('R1 = 2x2', 'R1 = 3x2')
      .replace('R1C = 2x2', 'R1C = 1x2')
      .replace('R1.B: 1->R2, 2->eliminated\n', 'R1.B: 1->R2, 2->eliminated\nR1.C: 1->R2, 2->eliminated\n')
      .replace('R1C.A: 1->R2, 2->eliminated\nR1C.B: 1->R2, 2->eliminated', 'R1C: 1->R2, 2->eliminated')
      .replace('R2 = 2x2', 'R2 = 2x2');
    const exit = atTheExit(generated(12, oneBand, { groupExit: 'fair-cut' }), scoreLevel);
    const bandKeys = Object.keys(getAllColumnTies(exit)).filter((key) =>
      key.startsWith(GROUP_BAND_KEY_PREFIX),
    );
    expect(bandKeys).toEqual([]);
  });
});

describe('a re-draw and the expected column give the first advance', () => {
  it('expectedNextColumn equals what Next Round draws, and a re-advance after Previous equals the first', () => {
    const exit = atTheExit(generated(12, TWO_BANDS, { groupExit: 'fair-cut' }), (state) =>
      scoreCurrentRound(state, 4),
    );
    const expected = expectedNextColumn(exit);
    const first = advanced(exit);
    expect(expected).not.toBeNull();
    for (const [roundIndex, round] of expected ?? []) {
      expect(round.assignments).toEqual(first.assignments[roundIndex]);
    }
    const again = advanced({ ...first, curRound: exit.curRound });
    expect(again.assignments).toEqual(first.assignments);
    expect(again.pendingBracketSeeds).toEqual(first.pendingBracketSeeds);
  });
});

describe('a stored group-stage waterfall without standingsRoutes advances as before', () => {
  it('leaves the groups through the one entry round', () => {
    const plain = `
ROUNDS:
R1 = 4x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
R1.A: 1->R2
R1.B: 1->R2
R1.C: 1->R2
R1.D: 1->R2
R2.A: 1->Final
R2.B: 1->Final
`;
    const state = generated(16, plain);
    const stored = {
      ...state,
      rounds: state.rounds.map((round) => {
        const { standingsRoutes: _routes, ...rest } = round;
        return rest;
      }),
    };
    const next = advanced(atTheExit(stored, (current) => scoreCurrentRound(current, 4)));
    expect(roomsOf(next, next.curRound).flat()).toHaveLength(8);
    expect(next.rounds[next.curRound].customLabel).toBe('R1');
  });
});

/** The group tables as the transition computes them (the stored ones are not kept up to date while a round is scored). */
function computedStandings(state: TournamentState) {
  const result = advanceTournamentRound(state);
  if (result.status === 'advanced') return result.state.groupStandings;
  return state.groupStandings;
}

/** Spreads the scores of the round in play with a seed, so the group tables come out differently. */
function seedScores(state: TournamentState, seed: number): TournamentState {
  let draw = seed * 7919 + state.curRound + 1;
  const scores = { ...state.scores };
  for (const key of Object.keys(scores)) {
    if (!key.startsWith(`r${state.curRound}-`)) continue;
    draw = (draw * 48271) % 2147483647;
    scores[key] = (100 + (draw % 900)) * 100 + (draw % 97);
  }
  return { ...state, scores };
}
