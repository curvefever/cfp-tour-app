import { MAX_WIN_TARGET, MIN_WIN_TARGET } from './match-format';
import type { PersistedSetup, RoomSize } from './types';

/**
 * The uneven-wins Final of the built-in upper and lower bracket: in a head-to-head format the Final can be played
 * with a number of game wins for each finalist (`docs/rules.md`, "Upper and lower bracket"). The upper finalist is the
 * one the upper side sends straight to the Final (the earlier column), the lower finalist the winner of the last
 * Semi-Final. Three Setup fields: `finalsUnevenWins` ('yes' or ''), and the two targets, each '' = the default.
 */

/** The wins the upper and the lower finalist need when their box is left empty. */
export const DEFAULT_UPPER_WINS = 1;
export const DEFAULT_LOWER_WINS = 2;

/** The Setup value of `finalsUnevenWins` when uneven wins is chosen. */
export const UNEVEN_WINS_ON = 'yes';

export type UpperLowerWinsFields = Pick<
  PersistedSetup,
  'finalsUnevenWins' | 'finalsUpperWins' | 'finalsLowerWins'
>;

export interface UpperLowerFinalWins {
  upper: number;
  lower: number;
}

export type UpperLowerWinsResult =
  { ok: true; wins: UpperLowerFinalWins | null } | { ok: false; message: string };

/** Whether the format's rooms hold two units: only then is the Final two finalists (a multi-team or FFA Final holds more). */
export function isHeadToHeadRoom(roomSize: RoomSize): boolean {
  return roomSize.ideal === 2;
}

/** One typed target: the default when empty, else a whole number from 1 to 9, or why not. */
function targetOf(
  typed: string,
  fallback: number,
  label: string,
): { ok: true; wins: number } | { ok: false; message: string } {
  const text = typed.trim();
  if (!text) return { ok: true, wins: fallback };
  const wins = /^\d+$/.test(text) ? Number.parseInt(text, 10) : 0;
  if (wins < MIN_WIN_TARGET || wins > MAX_WIN_TARGET) {
    return {
      ok: false,
      message: `${label} must be a whole number from ${MIN_WIN_TARGET} to ${MAX_WIN_TARGET} — got "${typed}".`,
    };
  }
  return { ok: true, wins };
}

/**
 * The targets of the Final from the Setup fields (or a settings snapshot): null when uneven wins is off or the format
 * is no head-to-head one, else the two numbers (an empty box is its default), or why a typed one can't be used.
 */
export function upperLowerFinalWins(
  fields: Partial<UpperLowerWinsFields> | undefined,
  roomSize: RoomSize,
): UpperLowerWinsResult {
  if (fields?.finalsUnevenWins !== UNEVEN_WINS_ON || !isHeadToHeadRoom(roomSize))
    return { ok: true, wins: null };
  const upper = targetOf(fields.finalsUpperWins ?? '', DEFAULT_UPPER_WINS, 'Upper finalist needs');
  if (!upper.ok) return upper;
  const lower = targetOf(fields.finalsLowerWins ?? '', DEFAULT_LOWER_WINS, 'Lower finalist needs');
  return lower.ok ? { ok: true, wins: { upper: upper.wins, lower: lower.wins } } : lower;
}
