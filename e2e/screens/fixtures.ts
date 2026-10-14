import { generateTournament } from '../../src/domain/tournament/generation';
import { createTournamentRuntime } from '../../src/domain/tournament/runtime';
import { scoreKeysForPosition } from '../../src/domain/tournament/scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../../src/domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../src/domain/tournament/transitions';
import type {
  PersistedSetup,
  TournamentAnnotation,
  TournamentRound,
  TournamentState,
  TournamentTeam,
} from '../../src/domain/tournament/types';
import { marshalForFirebase } from '../../src/features/sync/firebase-marshal';

/**
 * Fixture tournaments for the screenshot spec. Each one is generated and played with the real domain code and
 * seeded scores, so every run draws the same tournament and its screens can be compared with the design boards.
 */

type SetupOverrides = Partial<PersistedSetup>;

export interface FixtureTournament {
  id: string;
  state: TournamentState;
  status: 'published' | 'finished';
  /** The viewer tabs the spec captures for this fixture, by their button label. */
  tabs: string[];
  rulesText?: string;
  screenshotIds?: string[];
  /** A unit to follow in the Bracket: the spec types it into the follow box and captures that too. */
  follow?: string;
  /** Which exit icons (by position in the Bracket, counting every open room) the spec hovers to capture their pop-up. */
  exitPopups?: number[];
  /** The spec opens the "?" box of the Bracket and captures it. */
  infoBox?: boolean;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TIME_ZONE = 'Europe/Paris';

/** Hours that Paris is ahead of UTC at `instant` (1 or 2). */
function parisOffsetHours(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return (hour - new Date(instant).getUTCHours() + 24) % 24;
}

/** `hour`:00 Paris time, `daysAhead` calendar days from today, so a screen's date line only changes with the day. */
export function parisTime(daysAhead: number, hour = 20): number {
  const day = new Date(Date.now() + daysAhead * DAY);
  const utc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour);
  return utc - parisOffsetHours(utc) * HOUR;
}

/** When a fixture's scheduled start is: an ongoing one began a while ago, an upcoming one is at 20:00 a few days ahead. */
export function scheduledAtOf(fixture: Pick<FixtureTournament, 'state'>): number {
  return fixture.state.started ? Date.now() - 2 * HOUR : parisTime(4);
}

// ---------- deterministic scoring ----------

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distinct totals for one room: a seeded shuffle of 20, 29, 38, ... plus a little noise (spacing 9 > noise 8). */
function roomTotals(size: number, random: () => number, scale: number): number[] {
  const order = Array.from({ length: size }, (_, index) => index);
  for (let index = size - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order.map((slot) => (20 + slot * 9 + Math.floor(random() * 8)) * scale);
}

/** Splits a team total over its members so that the members sum to it (the default team scoring rule). */
function memberScores(total: number, teamSize: number): number[] {
  const share = Math.floor(total / teamSize);
  return Array.from({ length: teamSize }, (_, index) =>
    index === 0 ? total - share * (teamSize - 1) : share,
  );
}

function teamSizeOf(state: TournamentState): number {
  const first = state.players[0];
  return typeof first === 'object' ? first.members.length : 0;
}

interface ScoreOptions {
  seed: number;
  /** Rooms (1-based) to score; every room when omitted. */
  rooms?: number[];
}

/** Scores rooms of the current round (a pooling or bracket round, not the Final). */
export function scoreCurrentRound(state: TournamentState, { seed, rooms }: ScoreOptions): TournamentState {
  const round = state.rounds[state.curRound];
  const teamSize = teamSizeOf(state);
  const random = seededRandom(seed * 1000 + state.curRound);
  const scores = { ...state.scores };
  const byRoom = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room !== null) byRoom.set(entry.room, (byRoom.get(entry.room) ?? 0) + 1);
  }
  for (const [room, size] of [...byRoom].sort((a, b) => a[0] - b[0])) {
    const numGames = round.numGames ?? 1;
    const gameTotals = Array.from({ length: numGames }, () => roomTotals(size, random, 1));
    if (rooms && !rooms.includes(room)) continue;
    for (let position = 0; position < size; position += 1) {
      const keys = scoreKeysForPosition({
        roundIndex: state.curRound,
        room,
        position,
        numGames,
        teamSize: teamSize || undefined,
      });
      keys.forEach((key, index) => {
        const game = Math.floor(index / Math.max(teamSize, 1));
        const member = teamSize ? index % teamSize : 0;
        const total = gameTotals[game][position];
        scores[key] = teamSize ? memberScores(total, teamSize)[member] : total;
      });
    }
  }
  return { ...state, scores };
}

/** Scores every game of the Final. */
export function scoreFinal(state: TournamentState, seed: number): TournamentState {
  const round = state.rounds[state.curRound];
  const entries = state.assignments[state.curRound] ?? [];
  const teamSize = teamSizeOf(state);
  const random = seededRandom(seed * 1000 + 777);
  const finalScores = { ...state.finalScores };
  for (let game = 1; game <= (round.numGames ?? 1); game += 1) {
    const totals = roomTotals(entries.length, random, 1);
    entries.forEach((entry, position) => {
      if (teamSize) {
        memberScores(totals[position], teamSize).forEach((value, member) => {
          finalScores[`game${game}-${entry.name}-m${member}`] = value;
        });
      } else {
        finalScores[`game${game}-${entry.name}`] = totals[position];
      }
    });
  }
  return { ...state, finalScores };
}

/** Scores the current round fully and advances, trying other seeds if a tie blocks the advance. */
function advanceScored(state: TournamentState, seed: number): TournamentState {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = advanceTournamentRound(scoreCurrentRound(state, { seed: seed + attempt }));
    if (result.status === 'advanced') return result.state;
    if (result.status !== 'blocked') break;
  }
  throw new Error(`could not advance round ${state.curRound}`);
}

/** Plays whole rounds until the current round matches `stop`; the stopped-at round is left unscored. */
function playUntil(
  start: TournamentState,
  stop: (round: TournamentRound, index: number) => boolean,
  seed: number,
): TournamentState {
  let state = start;
  for (let guard = 0; guard < 40; guard += 1) {
    if (stop(state.rounds[state.curRound], state.curRound)) return state;
    state = advanceScored(state, seed);
  }
  throw new Error('the tournament did not reach the requested round');
}

// ---------- building ----------

function individuals(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Player ${String(index + 1).padStart(2, '0')}`);
}

function teams(count: number, teamSize: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: teamSize }, (_, member) => ({
      name: `T${index + 1}-${'ab'[member] ?? member}`,
    })),
  }));
}

function generate(count: number, setup: SetupOverrides, teamSize = 0): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: teamSize ? teams(count, teamSize) : individuals(count),
      title: 'Fixture Cup',
    }),
    createDefaultSetup(setup),
    createTournamentRuntime({ random: { next: seededRandom(2026) } }),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true, tournamentId: 'fixture' };
}

const isFirstLuckyRound = (round: TournamentRound) =>
  !round.isQual && !round.isNoElim && !round.isSwiss && !round.isFinal && !round.isSemis;

function ffaPooling(count: number): TournamentState {
  const state = ffa37Like(count);
  const lastQual = state.rounds.map((round) => round.isQual).lastIndexOf(true);
  const atLastQual = playUntil(state, (_round, index) => index === lastQual, 1);
  return scoreCurrentRound(atLastQual, { seed: 9, rooms: [1, 2] });
}

function ffa37Like(count: number, overrides: SetupOverrides = {}): TournamentState {
  return generate(count, {
    poolingPhase: 'qual-table',
    qualAdv: '24',
    scheduleLogic: 'single-elimination',
    ...overrides,
  });
}

/** A qualification table whose later rounds are published up front: future cards show their unit names. */
function ffaFixedDraws(): TournamentState {
  const first = ffa37Like(37, { drawPublication: 'fixed' });
  return scoreCurrentRound(first, { seed: 11, rooms: [1, 2] });
}

/** A 13-player 1v1 group stage: an odd count, so groups have byes; the first group round is drawn, the next ones are not. */
function groupStage(): TournamentState {
  const start = generate(13, {
    gameFormat: 'individual-1v1',
    poolingPhase: 'group-stage',
    groupSize: '4',
    qualifiersPerGroup: '2',
    oddCountStrategy: 'bye',
    scheduleLogic: 'single-elimination',
  });
  return scoreCurrentRound(start, { seed: 12, rooms: [1, 2] });
}

function ffaQuarters(count: number): TournamentState {
  const first = playUntil(ffa37Like(count), (round) => isFirstLuckyRound(round), 1);
  return scoreCurrentRound(first, { seed: 5, rooms: [1, 2] });
}

function ffaFinal(count: number): TournamentState {
  return playUntil(ffa37Like(count), (round) => round.isFinal, 1);
}

function ffa37FinalComplete(): TournamentState {
  return scoreFinal(ffaFinal(37), 3);
}

function teams2v2(): TournamentState {
  const start = generate(
    13,
    {
      gameFormat: 'team-2v2v2v2',
      poolingPhase: 'qual-table',
      qualAdv: '8',
      scheduleLogic: 'single-elimination',
    },
    2,
  );
  const semis = playUntil(start, (round) => round.isSemis, 1);
  return {
    ...scoreCurrentRound(semis, { seed: 4, rooms: [1] }),
    annotations: [
      { text: 'Room B is delayed by ten minutes.', timestamp: '2026-10-14T19:20:00.000Z' },
      { text: 'Semis rooms are 2 games shorter than announced.', timestamp: '2026-10-14T19:48:00.000Z' },
    ] satisfies TournamentAnnotation[],
  };
}

function kingsValley(): TournamentState {
  const start = generate(
    12,
    { gameFormat: 'team-2v2v2v2', scheduleLogic: 'kings-valley', poolingPhase: 'none' },
    2,
  );
  return scoreCurrentRound(
    playUntil(start, (_round, index) => index === 2, 1),
    { seed: 6, rooms: [1] },
  );
}

function doubleElimination(): TournamentState {
  const start = generate(16, {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'double-elimination',
    poolingPhase: 'none',
    oddCountStrategy: 'bye',
  });
  return scoreCurrentRound(
    playUntil(start, (_round, index) => index === 2, 1),
    { seed: 2, rooms: [1, 2, 3] },
  );
}

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

function waterfallQual(): TournamentState {
  const start = generate(37, {
    scheduleLogic: 'waterfall-bracket',
    poolingPhase: 'qual-table',
    qualAdv: '99',
    waterfallGraph: QUAL_GRAPH,
  });
  const lastQual = start.rounds.map((round) => round.isQual).lastIndexOf(true);
  return scoreCurrentRound(
    playUntil(start, (_round, index) => index === lastQual, 1),
    { seed: 8 },
  );
}

function upcoming(): TournamentState {
  return {
    ...generate(37, { poolingPhase: 'qual-table', qualAdv: '24' }),
    started: false,
    title: 'Autumn Cup',
  };
}

const RULES_TEXT = `Welcome to the Autumn Cup!

Qualification: three rounds in rooms of up to 8. Your points are added up over the rounds; the best 24 go through to the Quarters.

Bracket: Quarters, Semis and a Final over 3 games.

Be in the lobby 15 minutes before the start. Use your Curve Fever Pro name. Questions: ask in the tournament channel.`;

// ---------- the catalogue ----------

const STARTED_TABS = ['Bracket', 'Standings', 'Rankings', 'Info'];
// A format without a qualification table has no Standings tab.
const NO_STANDINGS_TABS = ['Bracket', 'Rankings', 'Info'];

function entry(
  id: string,
  state: TournamentState,
  extra: Partial<FixtureTournament> = {},
): FixtureTournament {
  return { id, state: { ...state, title: titleOf(id) }, status: 'published', tabs: STARTED_TABS, ...extra };
}

function titleOf(id: string): string {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function fixtureTournaments(): FixtureTournament[] {
  return [
    entry('ffa37-pooling', ffaPooling(37)),
    entry('ffa37-quarters', ffaQuarters(37), { follow: 'Player 14', exitPopups: [0, 5], infoBox: true }),
    entry('ffa37-final-complete', ffa37FinalComplete()),
    entry('ffa37-finished', ffa37FinalComplete(), { status: 'finished' }),
    entry('ffa31-pooling', ffaPooling(31)),
    entry('fixed-draws-ffa-37', ffaFixedDraws()),
    entry('groups-1v1-13', groupStage()),
    entry('ffa43-quarters', ffaQuarters(43)),
    entry('ffa53-quarters', ffaQuarters(53)),
    entry('teams2v2-13', teams2v2()),
    entry('kings-valley-12', kingsValley(), { tabs: NO_STANDINGS_TABS, infoBox: true }),
    entry('double-elim-1v1-16', doubleElimination(), { tabs: NO_STANDINGS_TABS, infoBox: true }),
    entry('waterfall-qual-37', waterfallQual(), { infoBox: true }),
    entry('upcoming-info', upcoming(), {
      tabs: ['Info', 'Players'],
      rulesText: RULES_TEXT,
      screenshotIds: ['shot1', 'shot2'],
    }),
  ];
}

// ---------- what the page is served ----------

/** The stored state of a fixture as the database transport delivers it (markers for empty values). */
export function storedState(fixture: FixtureTournament): unknown {
  const finished = fixture.status === 'finished';
  return marshalForFirebase({
    ...fixture.state,
    tournamentId: fixture.id,
    lifecycle: {
      status: fixture.status,
      testRun: false,
      createdAt: 1,
      finishedAt: finished ? Date.now() - 24 * HOUR : null,
    },
    info: {
      scheduledAt: scheduledAtOf(fixture),
      rulesText: fixture.rulesText ?? '',
      screenshots: fixture.screenshotIds ?? [],
    },
  });
}

/** One index entry (`TournamentSummary` without its id) for the Tournaments list. */
export function indexEntry(
  title: string,
  fields: { status: 'published' | 'finished'; started: boolean; scheduledAt: number; testRun?: boolean },
): Record<string, unknown> {
  return {
    title,
    status: fields.status,
    started: fields.started,
    testRun: fields.testRun ?? false,
    scheduledAt: fields.scheduledAt,
    createdAt: 1,
    finishedAt: fields.status === 'finished' ? fields.scheduledAt + 3 * HOUR : null,
    gameFormat: 'ffa-individual',
    poolingPhase: 'qual-table',
    scheduleLogic: 'single-elimination',
    unitCount: 37,
  };
}

/** The Tournaments list: one ongoing tournament, two upcoming (one starting soon, one test run) and two finished. */
export function tournamentListIndex(now: number): Record<string, unknown> {
  return {
    'live-cup': indexEntry('Live Cup', { status: 'published', started: true, scheduledAt: now - 2 * HOUR }),
    'soon-cup': indexEntry('Starting Soon Cup', {
      status: 'published',
      started: false,
      scheduledAt: now + 40 * 60 * 1000,
    }),
    'later-cup': indexEntry('Later Cup', {
      status: 'published',
      started: false,
      scheduledAt: parisTime(6),
    }),
    'rehearsal-cup': indexEntry('Rehearsal Cup', {
      status: 'published',
      started: false,
      scheduledAt: parisTime(9),
      testRun: true,
    }),
    'old-cup': indexEntry('Summer Cup', {
      status: 'finished',
      started: true,
      scheduledAt: parisTime(-30),
    }),
    'older-cup': indexEntry('Spring Cup', {
      status: 'finished',
      started: true,
      scheduledAt: parisTime(-70),
    }),
  };
}
