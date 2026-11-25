import type { GameFormatDefinition, PersistedSetup, RoomSize, ScheduleLogicKey } from './types';

export interface GenerationForm extends PersistedSetup {
  /** A setting kept out of PersistedSetup, the stored shape of the Setup form. */
  lbQualifiers?: string;
}

/** What a step of the plan answers: the plan with its fields added, or the refusal the organiser reads. */
export type Planned<T> = { ok: true; plan: T } | { ok: false; message: string };

export function refuse(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

export interface PlanAfterRoster {
  unitCount: number;
  format: Readonly<GameFormatDefinition>;
  /** The Setup form's schedule logic. */
  chosen: ScheduleLogicKey;
  /** The bracket phase it is generated as. */
  schedule: ScheduleLogicKey;
  /** The format's room size with no odd-count strategy applied. */
  formatRoomSize: RoomSize;
  floorMin: number;
  unitPlural: string;
}

/**
 * The numbers of a tournament, worked out from the Setup form and the loaded roster before any round is built: no
 * names. Each step of `planTournament` reads the plan so far and returns it with its own fields added.
 */
export type TournamentPlan = PlanAfterRoster;
