import { generateTournament } from '../generation';
import { planLayered, type LayeredInput, type LayeredPlan } from '../layered-plan';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { indexOf } from './dependency-play-fixtures';
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
