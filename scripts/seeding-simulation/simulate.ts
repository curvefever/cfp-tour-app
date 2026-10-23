import { generateTournament } from '../../src/domain/tournament/generation';
import { getGameFormat } from '../../src/domain/tournament/formats';
import { createTournamentRuntime } from '../../src/domain/tournament/runtime';
import { scoredTeamSize, scoreKeysForPosition } from '../../src/domain/tournament/scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../../src/domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../src/domain/tournament/transitions';
import type { TournamentState, TournamentTeam } from '../../src/domain/tournament/types';
import { applyPolicy, type Policy } from './policies';
import { gaussian, seededRandom } from './random';

export type Kind = '2v2v2v2' | 'ffa';
/** A: four qualification rounds, the first not counted (the audited tournament). B: three rounds, all counted. */
export type Mode = 'A' | 'B';

export interface Config {
  kind: Kind;
  count: number;
  mode: Mode;
}

export const CUT: Record<Kind, number> = { '2v2v2v2': 16, ffa: 24 };

export function configKey(config: Config): string {
  return `${config.kind}-${config.count}-${config.mode}`;
}

const GAME_FORMAT = { '2v2v2v2': 'team-2v2v2v2', ffa: 'ffa-individual' } as const;

export interface RunResult {
  strengths: Map<string, number>;
  /** The state after the last qualification round was scored. */
  finalState: TournamentState;
  /** Each unit's place (0 = best) and room size in round 1. */
  roundOnePlaces: Map<string, { place: number; roomSize: number }>;
  qualRounds: number;
  firstCounted: number;
}

function buildTournament(config: Config, random: () => number): TournamentState {
  const teams = config.kind === '2v2v2v2';
  const teamSize = getGameFormat(GAME_FORMAT[config.kind])?.teamSize ?? 0;
  const players = teams
    ? Array.from({ length: config.count }, (_, index): TournamentTeam => ({
        teamId: `t${index + 1}`,
        teamName: `Team ${index + 1}`,
        members: Array.from({ length: teamSize }, (_, slot) => ({ name: `${'abc'[slot]}${index}` })),
      }))
    : Array.from({ length: config.count }, (_, index) => `P${index + 1}`);
  const setup = createDefaultSetup({
    gameFormat: GAME_FORMAT[config.kind],
    ...(teams ? { teamScoringRule: 'survival-teams' as const } : {}),
    scheduleLogic: 'single-elimination',
    poolingPhase: 'qual-table',
    qualAdv: String(CUT[config.kind]),
    qualRoundsOverride: config.mode === 'A' ? '4' : '3',
    nonCountingRounds: config.mode === 'A' ? '1' : '0',
  });
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: config.count, players }),
    setup,
    createTournamentRuntime({ random: { next: random } }),
  );
  if (result.status !== 'generated') throw new Error(`generation refused: ${configKey(config)}`);
  return { ...result.state, started: true };
}

/** Scores the current round: each seated unit performs at its strength plus noise, and a room's scores are distinct integers in that order. */
function scoreRound(
  state: TournamentState,
  strengths: Map<string, number>,
  noise: number,
  random: () => number,
): { state: TournamentState; places: Map<string, { place: number; roomSize: number }> } {
  const roundIndex = state.curRound;
  const scores = { ...state.scores };
  const places = new Map<string, { place: number; roomSize: number }>();
  const byRoom = new Map<number, string[]>();
  for (const { name, room } of state.assignments[roundIndex]) {
    if (room !== null) byRoom.set(room, [...(byRoom.get(room) ?? []), name]);
  }
  for (const [room, names] of byRoom) {
    const performance = new Map(
      names.map((name) => [name, (strengths.get(name) as number) + noise * gaussian(random)]),
    );
    const ranked = [...names].sort((a, b) => (performance.get(b) as number) - (performance.get(a) as number));
    ranked.forEach((name, place) => places.set(name, { place, roomSize: names.length }));
    const value = new Map<string, number>();
    let previous = Number.POSITIVE_INFINITY;
    for (const name of ranked) {
      previous = Math.min(Math.round(1000 + 100 * (performance.get(name) as number)), previous - 1);
      value.set(name, previous);
    }
    names.forEach((name, position) => {
      const keys = scoreKeysForPosition({ roundIndex, room, position, teamSize: scoredTeamSize(state) });
      keys.forEach((key, index) => {
        scores[key] = index === 0 ? (value.get(name) as number) : 1;
      });
    });
  }
  return { state: { ...state, scores }, places };
}

export function simulate(config: Config, policy: Policy, noise: number, seed: number): RunResult {
  const random = seededRandom(seed);
  let state = buildTournament(config, random);
  const qualRounds = state.rounds.filter((round) => round.isQual).length;
  const firstCounted = state.rounds.findIndex((round) => round.isQual && !round.excludeFromStandings);
  const strengths = new Map(state.assignments[0].map((entry) => [entry.name, gaussian(random)] as const));
  const policyRandom = seededRandom(seed ^ 0x9e3779b9);
  let roundOnePlaces = new Map<string, { place: number; roomSize: number }>();
  for (let round = 0; round < qualRounds; round += 1) {
    const scored = scoreRound(state, strengths, noise, random);
    if (round === 0) roundOnePlaces = scored.places;
    if (round === qualRounds - 1) {
      state = scored.state;
      break;
    }
    const advanced = advanceTournamentRound(scored.state);
    if (advanced.status !== 'advanced')
      throw new Error(`no advance in ${configKey(config)}: ${advanced.status}`);
    state = applyPolicy(advanced.state, round + 1, policy, {
      firstCounted,
      lastRound: qualRounds - 1,
      random: policyRandom,
    });
  }
  return { strengths, finalState: state, roundOnePlaces, qualRounds, firstCounted };
}
