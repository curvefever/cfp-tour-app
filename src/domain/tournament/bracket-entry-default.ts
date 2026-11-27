import { getMinimumBracketUnits } from './schedule-generation';
import type { PersistedSetup, RoomSize, ScheduleLogicKey } from './types';

/**
 * "Advance to bracket" left empty: the number the app works out from the field (`docs/rules.md`, "Pooling phase"). It
 * is 75-85% of those expected to play, picked to fill equal rooms; head-to-head single elimination and the race double
 * elimination take a power of two first. A bracket that seats only some counts (upper and lower) is picked among those.
 */

export interface PracticeBracketEntry {
  count: number;
  /** The number expected to play, which the range is a share of. */
  play: number;
  /** Whether the count is within 75-85% of those expected to play. */
  inRange: boolean;
  /** The equal rooms the choice fills; null for a power of two and for a count with no such split. */
  rooms: { count: number; size: number } | null;
}

interface PracticeInput {
  registered: number;
  roomSize: RoomSize;
  scheduleLogic: ScheduleLogicKey;
  /** The only counts the bracket can seat; left out, every count from its floor up. */
  allowed?: readonly number[];
}

/** How many of those registered are expected to play: 9 in 10. */
export const expectedToPlay = (registered: number): number => Math.round((9 * registered) / 10);

/** "Advance to bracket" as typed in Setup; null unless it starts with a positive whole number. */
export function parseAdvanceToBracket(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

const isPowerOfTwo = (count: number): boolean => Number.isInteger(Math.log2(count));

/** Closest to 80% of those expected to play, then the larger. Compared in fifths, so no rounding decides a tie. */
function closestToTarget(counts: number[], play: number): number | undefined {
  const distance = (count: number) => Math.abs(5 * count - 4 * play);
  return [...counts].sort((first, second) => distance(first) - distance(second) || second - first)[0];
}

/** The pick in the range, by class: a power of two where it applies, then equal rooms from the ideal size down. */
function pickInRange(counts: number[], input: PracticeInput, play: number) {
  const { roomSize, scheduleLogic } = input;
  const elimination = scheduleLogic === 'single-elimination' || scheduleLogic === 'double-elimination';
  if (elimination && roomSize.ideal === 2) {
    const count = closestToTarget(counts.filter(isPowerOfTwo), play);
    if (count !== undefined) return { count, rooms: null };
  }
  for (let size = roomSize.ideal; size >= roomSize.min; size -= 1) {
    const count = closestToTarget(
      counts.filter((candidate) => candidate % size === 0),
      play,
    );
    if (count !== undefined) return { count, rooms: { count: count / size, size } };
  }
  return null;
}

/** The counts the bracket can take: from its floor to everyone registered, only the allowed ones when it has some. */
function candidateCounts({ registered, roomSize, scheduleLogic, allowed }: PracticeInput): number[] {
  const floor = getMinimumBracketUnits(scheduleLogic, roomSize);
  const counts = Array.from({ length: Math.max(0, registered - floor + 1) }, (_, index) => floor + index);
  return allowed ? counts.filter((count) => allowed.includes(count)) : counts;
}

export function practiceBracketEntry(input: PracticeInput): PracticeBracketEntry {
  const play = expectedToPlay(input.registered);
  const counts = candidateCounts(input);
  const from = Math.ceil((3 * play) / 4);
  const to = Math.floor((17 * play) / 20);
  const isInRange = (count: number) => count >= from && count <= to;
  const picked = pickInRange(counts.filter(isInRange), input, play);
  if (picked) return { ...picked, play, inRange: true };
  // No class has a count in the range: the count closest to 80%; everyone in a field under the floor.
  const count = closestToTarget(counts, play) ?? input.registered;
  return { count, play, inRange: isInRange(count), rooms: null };
}

/**
 * How many the Setup form asks to advance: the typed "Advance to bracket" (null when it is no positive whole number),
 * or, left empty, the number worked out for this head count, among the `allowed` counts when only some can be seated.
 * The one reader of the form's `qualAdv`.
 */
export function requestedBracketEntry(
  setup: Pick<PersistedSetup, 'qualAdv' | 'scheduleLogic'>,
  registered: number,
  roomSize: RoomSize,
  allowed?: readonly number[],
): number | null {
  if (setup.qualAdv.trim()) return parseAdvanceToBracket(setup.qualAdv);
  const { scheduleLogic } = setup;
  return practiceBracketEntry({ registered, roomSize, scheduleLogic, allowed }).count;
}
