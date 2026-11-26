import { answerAbsence } from '../absence-answers';
import { generateTournament } from '../generation';
import { addWalkUpIndividual } from '../reserves';
import { rosterKeys } from '../roster';
import { planLayered, type LayeredInput, type LayeredPlan } from '../layered-plan';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { indexOf } from './dependency-play-fixtures';
import { pressNextRound, scoreCurrentRound } from './play-through';
import { rosterFor, startedState, testRuntime, type Setup } from './test-fixtures';

/** What the tests of a layered bracket generated from the Setup form share. */

export const FFA_QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
export const FFA_ROOM = { min: 6, ideal: 8, max: 8 };

/** The first bracket round's number: "Round 4" after three qualification rounds. */
export const FIRST_ROUND = 4;

export function generate(count: number, setup: Setup = FFA_QUAL) {
  const form = createDefaultSetup({ scheduleLogic: 'layered', ...setup });
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
}

export function built(count: number, setup: Setup = FFA_QUAL): TournamentState {
  return startedState(generate(count, setup));
}

/** The plan the engine makes for a field, for the form's own typed numbers when `typed` is given. */
export function planFor(count: number, typed?: LayeredInput['typed']): LayeredPlan {
  const planned = planLayered({ registered: count, roomSize: FFA_ROOM, firstRound: FIRST_ROUND, typed });
  if (!planned.ok) throw new Error(planned.message);
  return planned.plan;
}

export const roomsOf = (state: TournamentState, label: string): number[] =>
  state.rounds[indexOf(state, label)].rooms;

/** The names the plan gives its rounds, in the order the plan has them, with the rooms each plays. */
export function plannedRounds(plan: LayeredPlan): Array<{ name: string; rooms: number[] }> {
  const rounds = plan.rounds.flatMap((round, index) => {
    const semi = round.firstSemiFinal ? [{ name: 'Semi-Final A', rooms: [plan.finalPlayers] }] : [];
    const levels = round.levels.map((level) => ({
      name: `Round ${FIRST_ROUND + index} - ${level.level}`,
      rooms: level.rooms,
    }));
    return [...semi, ...levels];
  });
  const full = [plan.finalPlayers];
  return [...rounds, { name: 'Semi-Final B', rooms: full }, { name: 'Final', rooms: full }];
}

/** The seats each room of a round really holds once it is drawn. */
export function seatedRooms(state: TournamentState, label: string): number[] {
  const rooms = state.rounds[indexOf(state, label)].rooms;
  const seated = state.assignments[indexOf(state, label)] ?? [];
  return rooms.map((_, room) => seated.filter((entry) => entry.room === room + 1).length);
}

/** The score key of a unit's seat in a round, from the line-up. */
function seatKey(state: TournamentState, round: number, name: string): string {
  const seated: Record<number, number> = {};
  for (const entry of state.assignments[round] ?? []) {
    if (entry.room === null) continue;
    const position = (seated[entry.room] = (seated[entry.room] ?? -1) + 1);
    if (entry.name === name) return `r${round}-rm${entry.room}-p${position}`;
  }
  throw new Error(`${name} has no seat in round ${round}`);
}

/** The round in play scored, the given units answered absent in it, and Next Round pressed. */
export function playRound(state: TournamentState, absent: string[]): TournamentState {
  const keys = absent.map((name) => seatKey(state, state.curRound, name));
  const scored = scoreCurrentRound(state, 0);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  return pressNextRound(answerAbsence(zeroed, keys, 'absent'));
}

export const players = (state: TournamentState): string[] => rosterKeys(state.players);

/** 31 registered, round 1 played with three absent, round 2 in play: 28 play. */
export function afterThreeAbsent(setup: Setup = FFA_QUAL): TournamentState {
  const state = built(31, setup);
  return playRound(state, players(state).slice(0, 3));
}

/** The same with two more absent as well as the first three (they stay absent in round 2): 26 play. */
export function afterFiveAbsent(setup: Setup = FFA_QUAL): TournamentState {
  const state = afterThreeAbsent(setup);
  return playRound(state, players(state).slice(0, 5));
}

/** `count` late joiners added to the roster, each drawn in at the next round. */
export function withLateJoiners(state: TournamentState, count: number): TournamentState {
  let joined = state;
  for (let index = 1; index <= count; index += 1) {
    const added = addWalkUpIndividual(joined, `Late ${index}`, { allowLateJoin: true });
    if (added.status !== 'added') throw new Error(JSON.stringify(added));
    joined = added.state;
  }
  return joined;
}

/**
 * 31 registered, three absent from round 1, seven late joiners in round 2 (38 registered): round 3, the last table
 * round, in play with 35 playing. The plan for 35 changes the bracket's shape (one Upper room becomes two), so a card.
 */
export function afterSevenJoined(setup: Setup = FFA_QUAL): TournamentState {
  const state = afterThreeAbsent(setup);
  return playRound(withLateJoiners(state, 7), players(state).slice(0, 3));
}
