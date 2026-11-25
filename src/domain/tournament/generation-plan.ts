import { getGameFormat, deriveRoomSize } from './formats';
import { layeredGateRefusal } from './layered-form';
import { rosterFitsFormat, rosterKeys } from './roster';
import { getMinimumBracketUnits } from './schedule-generation';
import {
  type GenerationForm,
  type PlanAfterRoster,
  type Planned,
  refuse,
  type TournamentPlan,
} from './generation-plan-types';
import type { RoomSize, ScheduleLogicKey, TournamentState } from './types';

/** Why too few units are registered for a schedule logic (its floor, `getMinimumBracketUnits`), or null. */
export function registeredBelowFloorMessage(
  schedule: ScheduleLogicKey,
  roomSize: RoomSize,
  unitPlural: string,
  unitCount: number,
): string | null {
  const floorMin = getMinimumBracketUnits(schedule, roomSize);
  if (unitCount >= floorMin) return null;
  const reason =
    schedule === 'single-elimination' ? ` (Semis needs 2 rooms of at least ${roomSize.min})` : '';
  return `This format needs at least ${floorMin} registered ${unitPlural}${reason}. Registered: ${unitCount}.`;
}

/** The roster, the game format, the minimum head count and the layered gate. */
function planRoster(form: GenerationForm, current: TournamentState): Planned<PlanAfterRoster> {
  if (current.confirmedCount === null || current.confirmedCount === undefined) {
    return refuse('Load a roster first — click "Load roster & reserves" before generating a schedule.');
  }
  // The roster is the count of record: `confirmedCount` is only set when a roster is loaded, so a unit
  // added or removed since then makes it stale.
  const unitCount = rosterKeys(current.players).length;
  const format = getGameFormat(form.gameFormat);
  if (!format) return refuse('This game format is not available yet.');
  if (!rosterFitsFormat(current, form.gameFormat)) {
    return refuse(
      'The roster was loaded for a different game format — click "Load roster & reserves" again before generating.',
    );
  }
  // An upper and lower bracket or a layered bracket is generated as a Custom bracket over a graph the app derives; the
  // choice is kept in the form (and so in the settings snapshot) and on the config (`upperLowerVersion`,
  // `layeredVersion`), never in `state.scheduleLogic`.
  const chosen = form.scheduleLogic;
  const schedule = chosen === 'upper-lower' || chosen === 'layered' ? 'waterfall-bracket' : chosen;
  if (!format.defaultRoomSize && !format.idealRoomSize) {
    return refuse('This game format has no room size.');
  }
  const formatRoomSize = deriveRoomSize(format);
  const floorMin = getMinimumBracketUnits(chosen, formatRoomSize);
  const unitPlural = format.unitLabelPlural.toLowerCase();
  const belowFloor = registeredBelowFloorMessage(chosen, formatRoomSize, unitPlural, unitCount);
  if (belowFloor) return refuse(belowFloor);
  const layeredGate = chosen === 'layered' ? layeredGateRefusal(form) : null;
  if (layeredGate) return refuse(layeredGate);

  return {
    ok: true,
    plan: { unitCount, format, chosen, schedule, formatRoomSize, floorMin, unitPlural },
  };
}

/** Everything a tournament is worked out as before a round is built, or why it can't be. No side effect. */
export function planTournament(form: GenerationForm, current: TournamentState): Planned<TournamentPlan> {
  return planRoster(form, current);
}
