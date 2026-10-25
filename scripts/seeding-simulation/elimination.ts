import { relativeRoomShare, roomBasedComputeAdvancement } from '../../src/domain/tournament/advancement';
import { advanceTournamentRound } from '../../src/domain/tournament/transitions';
import type { TournamentState } from '../../src/domain/tournament/types';
import { shareBeaten } from './calibrate';
import { gaussian, seededRandom } from './random';
import { scoreRound, startTournament, type Kind } from './simulate';
import type { ScoreModel } from './score-model';

/**
 * Shape E: warm-up rounds, then single elimination (`poolingPhase: 'none'`), played with the engine's own advancement.
 * Every elimination round with mixed room sizes before the Semis is recorded as it was scored, so any cut rule can be
 * applied to it after the fact.
 */

export interface EliminationUnit {
  name: string;
  room: number;
  roomSize: number;
  /** 0 = best of its room. */
  place: number;
  /** Score ÷ room average. */
  relative: number;
  /** (room size − place − 1) ÷ (room size − 1). */
  share: number;
  /** 1 = the truly strongest unit among those in this round. */
  trueRank: number;
}

export interface EliminationRound {
  /** 0 for the first measured round of the run. */
  order: number;
  roundIndex: number;
  advPerRoom: number;
  luckyCount: number;
  /** The units that advance under the engine's own rule. */
  engine: Set<string>;
  units: EliminationUnit[];
  /** Relative scores of every scored room of the tournament so far, this round included, by room size. */
  sizePools: Map<number, number[]>;
}

export interface EliminationRun {
  kind: Kind;
  count: number;
  /** Measure the first elimination round whatever its room sizes (equal-room controls) instead of the mixed ones. */
  control: boolean;
  /** Stop after this many measured rounds. */
  rounds: number;
}

function hasMixedRooms(rooms: number[]): boolean {
  return new Set(rooms).size > 1;
}

/** The engine's own formula, so that equal shares tie exactly as they do for the engine's lucky-loser race. */
function roomRelatives(scores: number[]): number[] {
  const entries = scores.map((score) => ({ score }));
  return scores.map((score) => relativeRoomShare(score, entries));
}

function addToPools(pools: Map<number, number[]>, scored: ReturnType<typeof scoreRound>): void {
  for (const room of scored.rooms) {
    const pool = pools.get(room.units.length) ?? [];
    pool.push(...roomRelatives(room.scores));
    pools.set(room.units.length, pool);
  }
}

function recordRound(
  state: TournamentState,
  scored: ReturnType<typeof scoreRound>,
  strengths: Map<string, number>,
  order: number,
  pools: Map<number, number[]>,
): EliminationRound {
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  const names = scored.rooms.flatMap((room) => room.units);
  const byStrength = [...names].sort((a, b) => (strengths.get(b) as number) - (strengths.get(a) as number));
  const byRoomNumber = [...scored.rooms].sort((a, b) => a.room - b.room);
  const units = byRoomNumber.flatMap((room) => {
    const relative = roomRelatives(room.scores);
    return room.units.map((name, place) => ({
      name,
      room: room.room,
      roomSize: room.units.length,
      place,
      relative: relative[place],
      share: shareBeaten(place, room.units.length),
      trueRank: byStrength.indexOf(name) + 1,
    }));
  });
  const engine = roomBasedComputeAdvancement(scored.state, roundIndex).advancing.map((entry) => entry.name);
  return {
    order,
    roundIndex,
    advPerRoom: round.advPerRoom ?? 0,
    luckyCount: round.luckyCount,
    engine: new Set(engine),
    units,
    sizePools: new Map([...pools].map(([size, values]) => [size, [...values]])),
  };
}

/** Plays a tournament of the kind to its Semis (or until enough rounds are measured) and returns the measured rounds. */
export function simulateElimination(
  run: EliminationRun,
  noise: number,
  seed: number,
  model: ScoreModel,
): EliminationRound[] {
  const random = seededRandom(seed);
  let state = startTournament(run, { poolingPhase: 'none' }, random);
  const strengths = new Map(state.assignments[0].map((entry) => [entry.name, gaussian(random)] as const));
  const modelRandom = seededRandom(seed ^ 0x85ebca6b);
  const measured: EliminationRound[] = [];
  const pools = new Map<number, number[]>();
  while (measured.length < run.rounds) {
    const round = state.rounds[state.curRound];
    if (round.isSemis || round.isFinal) break;
    const scored = scoreRound(state, strengths, noise, random, model, modelRandom);
    addToPools(pools, scored);
    const worth = !round.isNoElim && (run.control || hasMixedRooms(round.rooms));
    if (worth) measured.push(recordRound(state, scored, strengths, measured.length, pools));
    if (measured.length >= run.rounds) break;
    const advanced = advanceTournamentRound(scored.state);
    if (advanced.status !== 'advanced') throw new Error(`no advance: ${advanced.status}`);
    state = advanced.state;
  }
  return measured;
}
