import { generateTournament } from '../../src/domain/tournament/generation';
import { createTournamentRuntime } from '../../src/domain/tournament/runtime';
import { scoreKeysForPosition } from '../../src/domain/tournament/scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../../src/domain/tournament/state-defaults';
import { removeRosterUnit, withLoadedRoster } from '../../src/domain/tournament/mutations';
import { advanceTournamentRound } from '../../src/domain/tournament/transitions';
import type {
  PersistedSetup,
  RoundNotes,
  TournamentAnnotation,
  TournamentRound,
  TournamentState,
  TournamentTeam,
} from '../../src/domain/tournament/types';
import { marshalForFirebase } from '../../src/features/sync/firebase-marshal';
import {
  buildTournamentSummary,
  type TournamentDescription,
  type TournamentSummary,
} from '../../src/features/tournaments/tournament-summary';

/**
 * Fixture tournaments for the screenshot spec. Each one is generated and played with the real domain code and
 * seeded scores, so every run draws the same tournament and its screens can be compared with the design boards.
 */

type SetupOverrides = Partial<PersistedSetup>;

export interface FixtureTournament {
  id: string;
  state: TournamentState;
  status: 'published' | 'finished';
  /** The Setup form as the organiser left it, for a fixture that was never generated; a generated one takes it from `state.settings`. */
  setup?: SetupOverrides;
  /** The viewer tabs the spec captures for this fixture, by their button label. */
  tabs: string[];
  rulesText?: string;
  roundNotes?: RoundNotes;
  screenshotIds?: string[];
  /** A unit to follow in the Bracket: the spec types it into the follow box and captures that too. */
  follow?: string;
  /** Which exit icons (by position in the Bracket, counting every open room) the spec hovers to capture their pop-up. */
  exitPopups?: number[];
  /** The spec opens the "?" box of the Bracket and captures it. */
  infoBox?: boolean;
  /** The spec opens the notes panel of the Bracket and captures it. */
  notesPanel?: boolean;
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

const MEMBER_NAME_BASES = [
  'Sidewip',
  'Mellow',
  'Kurven',
  'Nobrake',
  'Wiggles',
  'Acecurv',
  'Pinkman',
  'Zigzag',
  'Basilsk',
  'Cobra',
  'Viper',
  'Moonwlk',
];

/** Teams of any size whose members have names of 8 to 12 characters, to see how members fit on a line. */
function namedMemberTeams(count: number, teamSize: number): TournamentTeam[] {
  return teams(count, teamSize).map((team, index) => ({
    ...team,
    members: team.members.map((_member, slot) => ({
      name: `${MEMBER_NAME_BASES[(index * teamSize + slot) % MEMBER_NAME_BASES.length]}_${String.fromCharCode(65 + index)}`,
    })),
  }));
}

/** Long names, to check that rows wrap instead of cutting names off (players by roster index). */
const LONG_PLAYER_NAMES: Record<number, string> = {
  2: 'Xx_TheUnstoppableCurveMaster_xX',
  7: 'Kurvenkönig von Wolfsburg',
  13: 'AnExtremelyLongNameWithoutAnySpacesAtAll',
  20: 'Sir Wiggles the Third of Curveshire',
  29: 'Mellow Yellow Submarine',
};

function longNamedIndividuals(count: number): string[] {
  return individuals(count).map((name, index) => LONG_PLAYER_NAMES[index] ?? name);
}

const LONG_TEAMS: Array<[string, string[]]> = [
  ['Gap Hunters International', ['Sideswipe', 'Mellow Yellow', 'Kurvenkönig']],
  ['Night Owls Esports', ['Vortex_Kid', 'Mellowdrama', 'NoBrakesJustCurves']],
  ['The Unbreakable Wall of Curves', ['Wigglemaster_99', 'Ace of Curves', 'Pinkman']],
  ['Owls', ['Ace', 'Bo', 'Cy']],
  ['Holes in One', ['Ace of Spades', 'Wiggles', 'Pink']],
  ['Curve Crusaders', ['Pinkman_the_Great', 'Zigzagger', 'Sloth']],
  ['TheLongestTeamNameWithoutAnySpaces', ['Xx_CurveLord_xX', 'Drift', 'Nova']],
  ['Last Line', ['Slothy', 'Rook', 'Kite']],
  ['Slithering Snakes of Doom', ['Basilisk', 'Cobra Commander', 'Viper']],
  ['Team 10', ['Tm10a', 'Tm10b', 'Tm10c']],
  ['Drift Kings', ['Mario Kurvenstein', 'Luigi', 'Peach']],
  ['Zig & Zag', ['Zig', 'Zag', 'Zog']],
  ['Midnight Curve Collective', ['Moonwalker', 'Starlight Express', 'Comet']],
];

function longNamedTeams(): TournamentTeam[] {
  return LONG_TEAMS.map(([teamName, members], index) => ({
    teamId: `t${index + 1}`,
    teamName,
    members: members.map((name) => ({ name })),
  }));
}

function generate(
  count: number,
  setup: SetupOverrides,
  teamSize = 0,
  players: string[] | TournamentTeam[] = teamSize ? teams(count, teamSize) : individuals(count),
): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players,
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

const FFA_SETUP: SetupOverrides = {
  gameFormat: 'ffa-individual',
  poolingPhase: 'qual-table',
  qualAdv: '24',
  scheduleLogic: 'single-elimination',
};

const TEAMS_2V2_SETUP: SetupOverrides = {
  gameFormat: 'team-2v2v2v2',
  poolingPhase: 'qual-table',
  qualAdv: '8',
  scheduleLogic: 'single-elimination',
};

function ffa37Like(count: number, overrides: SetupOverrides = {}, players?: string[]): TournamentState {
  return generate(count, { ...FFA_SETUP, ...overrides }, 0, players);
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

/**
 * 10 teams 4v4 in two groups of 5, scored by match results: the first group round has its first rooms scored (result
 * codes beside the points) and a team removed from the last room, so its opponent has a void match.
 */
function groupMatchResults(): TournamentState {
  const start = generate(
    10,
    {
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '5',
      qualifiersPerGroup: '2',
      scoring: 'match-results',
      scheduleLogic: 'single-elimination',
    },
    4,
  );
  const scored = scoreCurrentRound(start, { seed: 21, rooms: [1, 2, 3] });
  const lastRoom = Math.max(...scored.assignments[scored.curRound].map((entry) => entry.room ?? 0));
  const victim = scored.assignments[scored.curRound].find((entry) => entry.room === lastRoom);
  return victim ? removeRosterUnit(scored, victim.name) : scored;
}

function ffaQuarters(count: number, players?: string[]): TournamentState {
  const first = playUntil(ffa37Like(count, {}, players), (round) => isFirstLuckyRound(round), 1);
  return scoreCurrentRound(first, { seed: 5, rooms: [1, 2] });
}

function ffaFinal(count: number): TournamentState {
  return playUntil(ffa37Like(count), (round) => round.isFinal, 1);
}

function ffa37FinalComplete(): TournamentState {
  return scoreFinal(ffaFinal(37), 3);
}

function teams2v2Start(): TournamentState {
  return generate(13, TEAMS_2V2_SETUP, 2);
}

/** The 13-team tournament with its Final played: a podium of teams, for Rankings. */
function teams2v2FinalComplete(): TournamentState {
  return scoreFinal(
    playUntil(teams2v2Start(), (round) => round.isFinal, 1),
    3,
  );
}

/** 13 teams of three with long names, after the qualification table: the first bracket round has one room complete. */
function teams3LongStart(): TournamentState {
  return generate(
    13,
    {
      gameFormat: 'team-3v3v3',
      poolingPhase: 'qual-table',
      qualAdv: '6',
      scheduleLogic: 'single-elimination',
    },
    3,
    longNamedTeams(),
  );
}

function teams3Long(): TournamentState {
  const first = playUntil(
    teams3LongStart(),
    (round) => isFirstLuckyRound(round) || Boolean(round.isFinal),
    1,
  );
  return scoreCurrentRound(first, { seed: 6, rooms: [1] });
}

function teams3LongFinished(): TournamentState {
  return scoreFinal(
    playUntil(teams3LongStart(), (round) => round.isFinal, 1),
    3,
  );
}

const TEAMS_4V4_SETUP: SetupOverrides = {
  gameFormat: 'team-4v4',
  poolingPhase: 'swiss',
  qualAdv: '8',
  scheduleLogic: 'single-elimination',
  oddCountStrategy: 'bye',
  teamScoringRule: 'designated-player',
};

/** 13 teams of four, Swiss into a single elimination, "Save your Buddy" scoring: the first bracket round has one room scored. */
function teams4v4Bracket(): TournamentState {
  const start = generate(13, TEAMS_4V4_SETUP, 4, namedMemberTeams(13, 4));
  const first = playUntil(start, (round) => isFirstLuckyRound(round) || Boolean(round.isFinal), 1);
  return scoreCurrentRound(first, { seed: 7, rooms: [1] });
}

/** 13 players 1v1, Swiss into single elimination, every stage a Best of 3 (the Final a Best of 5): the first bracket round has one room scored. */
function bestOfEverywhere(): TournamentState {
  const start = generate(13, {
    gameFormat: 'individual-1v1',
    poolingPhase: 'swiss',
    qualAdv: '8',
    scheduleLogic: 'single-elimination',
    oddCountStrategy: 'bye',
    poolingBestOf: '3',
    bracketBestOf: '3',
    semisBestOf: '3',
    finalsBestOf: '5',
  });
  const first = playUntil(start, (round) => isFirstLuckyRound(round) || Boolean(round.isFinal), 1);
  return scoreCurrentRound(first, { seed: 8, rooms: [1] });
}

/** 11 teams of five, head-to-head single elimination, played to the end of the Final: a podium of teams of five. */
function teams5v5FinalComplete(): TournamentState {
  const start = generate(
    11,
    {
      gameFormat: 'team-5v5',
      poolingPhase: 'none',
      scheduleLogic: 'single-elimination',
      oddCountStrategy: 'bye',
    },
    5,
    namedMemberTeams(11, 5),
  );
  return scoreFinal(
    playUntil(start, (round) => round.isFinal, 1),
    3,
  );
}

/** 23 teams of two in rooms of 4-5 teams (10 players a room), a qualification table at its second round. */
function teams2x5Pooling(): TournamentState {
  const start = generate(
    23,
    {
      gameFormat: 'team-2v2v2v2v2',
      poolingPhase: 'qual-table',
      qualAdv: '8',
      scheduleLogic: 'single-elimination',
    },
    2,
    namedMemberTeams(23, 2),
  );
  return scoreCurrentRound(
    playUntil(start, (_round, index) => index === 1, 1),
    { seed: 10, rooms: [1, 2] },
  );
}

function teams2v2(): TournamentState {
  const start = teams2v2Start();
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

const COLUMN_GRAPH = `
ROUNDS:
Round 5 Upper = 2x4
Round 5 Lower = 2x4
Semi A = 4
Round 6 = 2x4
Round 7 = 4
Semi-B = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->Round 5 Upper, 9-16->Round 5 Lower
Round 5 Upper.A: 1-2->Semi A, 3-4->Round 6
Round 5 Upper.B: 1-2->Semi A, 3-4->Round 6
Round 5 Lower.A: 1-2->Round 6
Round 5 Lower.B: 1-2->Round 6
Semi A: 1-2->Final, 3-4->Semi-B
Round 6.A: 1-2->Round 7
Round 6.B: 1-2->Round 7
Round 7: 1-2->Semi-B
Semi-B: 1-2->Final
`;

/** The live tournament's shape: 2v2v2v2 teams, the graph with spaced names, in column 1 with scores in Round 5 Lower only. */
function waterfallColumn(): TournamentState {
  const start = generate(
    19,
    {
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '99',
      waterfallGraph: COLUMN_GRAPH,
    },
    2,
  );
  const inBracket = playUntil(start, (round) => Boolean(round.isWaterfall), 1);
  const lower = inBracket.rounds.findIndex((round) => round.customLabel === 'Round 5 Lower');
  const scored = scoreCurrentRound({ ...inBracket, curRound: lower }, { seed: 12 });
  return { ...scored, curRound: inBracket.curRound };
}

/** Round settings notes of every shape: one line, three lines, two lines, a Final note, a different note on each pooling round and rounds without one. */
const COLUMN_NOTES: RoundNotes = {
  'Round 1': 'Powers: **Ghost**',
  'Round 2': 'Powers: **Zap**',
  'Round 3': 'Target score: **50**',
  'Round 5 Upper': 'Target score: **80**\nMap size: large\nPowers: Ghost and Zap',
  'Round 5 Lower': 'Target score: **80**\nMap size: small',
  Final: 'Target score: **120**',
};

/** A wave box with one losers round (WB Round 3 and LB Round 4, both with a note) and one with two (WB Round 5, only LB Round 6 has one). */
const DOUBLE_ELIMINATION_NOTES: RoundNotes = {
  'Round 2': 'Target score: **40**',
  'WB Round 3': 'Target score: **60**',
  'LB Round 4': 'Powers: **Zap** only',
  'WB Round 5': 'Target score: **60**',
  'LB Round 6': 'Powers: Ghost\nMap: large',
  'Grand Final': 'Target score: **100**',
};

type LoadedRoster = Pick<TournamentState, 'players' | 'reserves' | 'reserveIndividuals'>;

/** A tournament before Confirm & Start, as the app stores it after Load roster: the roster and its format, nothing generated. */
function loadedRoster(setup: SetupOverrides, roster: LoadedRoster): TournamentState {
  return withLoadedRoster(
    createDefaultTournamentState({ title: 'Fixture Cup' }),
    setup.gameFormat ?? 'ffa-individual',
    roster,
  );
}

function upcoming(): TournamentState {
  return loadedRoster(FFA_SETUP, {
    players: individuals(37),
    reserves: ['Larch', 'Nimbus'],
    reserveIndividuals: [],
  });
}

function upcomingTeams(): TournamentState {
  return loadedRoster(TEAMS_2V2_SETUP, {
    players: teams(13, 2),
    reserves: [],
    reserveIndividuals: [],
  });
}

/** A generated schedule that is not started yet: what an admin has between Generate and Confirm & Start. */
function drawnFfa31(): TournamentState {
  return { ...ffa37Like(31), started: false };
}

const RULES_TEXT = `Welcome to the Autumn Cup!

Qualification: three rounds in rooms of up to 8. Your points are added up over the rounds; the best 24 go through to the Quarters.

Bracket: Quarters, Semis and a Final over 3 games.

Be in the lobby 15 minutes before the start. Use your Curve Fever Pro name. Questions: ask in the tournament channel.`;

// ---------- the catalogue ----------

const STARTED_TABS = ['Bracket', 'Qualification', 'Rankings', 'Info'];
// The standings tab is named after the pooling phase.
export const STANDINGS_TABS = ['Qualification', 'Swiss', 'Groups'];
// A format without a pooling phase that keeps standings has no standings tab.
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
    entry('groups-1v1-13', groupStage(), { tabs: ['Bracket', 'Groups', 'Rankings', 'Info'] }),
    entry('groups-4v4-match-results', groupMatchResults(), {
      tabs: ['Bracket', 'Groups', 'Rankings', 'Info'],
    }),
    entry('ffa43-quarters', ffaQuarters(43)),
    entry('ffa53-quarters', ffaQuarters(53)),
    entry('teams2v2-13', teams2v2(), { notesPanel: true }),
    entry('teams2v2-13-finished', teams2v2FinalComplete(), { status: 'finished' }),
    entry('long-names-ffa37', ffaQuarters(37, longNamedIndividuals(37))),
    entry('long-names-teams3-13', teams3Long()),
    entry('long-names-teams3-13-finished', teams3LongFinished(), { status: 'finished' }),
    entry('teams-4v4-13', teams4v4Bracket(), { tabs: ['Bracket', 'Swiss', 'Rankings', 'Info'] }),
    entry('best-of-1v1-13', bestOfEverywhere(), { tabs: ['Bracket', 'Swiss', 'Rankings', 'Info'] }),
    entry('teams-5v5-final', teams5v5FinalComplete(), { status: 'finished', tabs: NO_STANDINGS_TABS }),
    entry('teams-2x5-23', teams2x5Pooling()),
    entry('kings-valley-12', kingsValley(), { tabs: NO_STANDINGS_TABS, infoBox: true }),
    entry('double-elim-1v1-16', doubleElimination(), {
      tabs: NO_STANDINGS_TABS,
      infoBox: true,
      roundNotes: DOUBLE_ELIMINATION_NOTES,
    }),
    entry('waterfall-qual-37', waterfallQual(), { infoBox: true }),
    entry('waterfall-column-19', waterfallColumn(), { roundNotes: COLUMN_NOTES }),
    entry('upcoming-info', upcoming(), {
      setup: FFA_SETUP,
      tabs: ['Info', 'Players'],
      rulesText: RULES_TEXT,
      screenshotIds: ['shot1', 'shot2'],
    }),
    entry('upcoming-teams-13', upcomingTeams(), { setup: TEAMS_2V2_SETUP, tabs: ['Info', 'Players'] }),
    entry('drawn-ffa-31', drawnFfa31(), { tabs: ['Info', 'Players'] }),
  ];
}

// ---------- what the page is served ----------

/** The state of a fixture as the app holds it once loaded: with its id, lifecycle and info, which the database stores beside it. */
export function loadedState(fixture: FixtureTournament): TournamentState {
  const finished = fixture.status === 'finished';
  return {
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
      ...(fixture.roundNotes ? { roundNotes: fixture.roundNotes } : {}),
      screenshots: fixture.screenshotIds ?? [],
    },
  };
}

/** The stored state of a fixture as the database transport delivers it (markers for empty values). */
export function storedState(fixture: FixtureTournament): unknown {
  return marshalForFirebase(loadedState(fixture));
}

type IndexEntry = Omit<TournamentSummary, 'id'>;
type IndexDescription = Omit<TournamentDescription, 'title' | 'scheduledAt'>;

/** What the Tournaments list says about a tournament it builds without a fixture. */
const LIST_DESCRIPTION: IndexDescription = {
  gameFormat: 'ffa-individual',
  poolingPhase: 'qual-table',
  scheduleLogic: 'single-elimination',
  unitCount: 37,
};

/** One index entry (`TournamentSummary` without its id) for the Tournaments list. */
export function indexEntry(
  title: string,
  fields: {
    status: 'published' | 'finished';
    started: boolean;
    scheduledAt: number;
    testRun?: boolean;
    winners?: Array<{ label: string; members: string[] | null }>;
    description?: IndexDescription;
  },
): IndexEntry {
  const { gameFormat, poolingPhase, scheduleLogic, unitCount } = fields.description ?? LIST_DESCRIPTION;
  return {
    title,
    status: fields.status,
    started: fields.started,
    testRun: fields.testRun ?? false,
    scheduledAt: fields.scheduledAt,
    createdAt: 1,
    finishedAt: fields.status === 'finished' ? fields.scheduledAt + 3 * HOUR : null,
    gameFormat,
    poolingPhase,
    scheduleLogic,
    unitCount,
    ...(fields.winners ? { winners: fields.winners } : {}),
  };
}

/** The Setup form of a fixture: as the organiser left it, or as the generated schedule snapshotted it. */
export function setupOf(fixture: FixtureTournament): PersistedSetup {
  return createDefaultSetup(fixture.setup ?? fixture.state.settings);
}

/** A fixture's index entry, described by its own settings and roster. */
export function fixtureIndexEntry(fixture: FixtureTournament): IndexEntry {
  const { gameFormat, poolingPhase, scheduleLogic, unitCount } = buildTournamentSummary(
    fixture.state,
    setupOf(fixture),
  );
  return indexEntry(fixture.state.title, {
    status: fixture.status,
    started: fixture.state.started,
    scheduledAt: scheduledAtOf(fixture),
    description: { gameFormat, poolingPhase, scheduleLogic, unitCount },
  });
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
      winners: [{ label: 'Paper Planes', members: ['Halcyon', 'Marlowe', 'Pixelwolf', 'Saffron'] }],
    }),
    'older-cup': indexEntry('Spring Cup', {
      status: 'finished',
      started: true,
      scheduledAt: parisTime(-70),
    }),
    'oldest-cup': indexEntry('Winter Cup', {
      status: 'finished',
      started: true,
      scheduledAt: parisTime(-110),
      winners: [
        { label: 'Static', members: ['Cobalt', 'Wren', 'Ivo'] },
        { label: 'Mint Condition', members: ['Orrin', 'Gale'] },
      ],
    }),
    'ancient-cup': indexEntry('Autumn Cup', {
      status: 'finished',
      started: true,
      scheduledAt: parisTime(-150),
      winners: [{ label: 'Juniper', members: null }],
    }),
  };
}
