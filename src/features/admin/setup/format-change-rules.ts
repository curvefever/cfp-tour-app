import { getGameFormat, resolveOddCountStrategy } from '../../../domain/tournament/formats';
import { scoringForPooling, tieMarginAfterFormatChange } from '../../../domain/tournament/match-results';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { nextTeamScoringRule } from './game-format-choice';

/**
 * What a change of the game format, the odd-count strategy or the scoring system does to the Setup form: the other
 * settings that follow from the choice. Each function returns the whole form after the change. Also the head-to-head
 * questions the Setup form asks of a game format.
 */

type GameFormatChoice = ReturnType<typeof getGameFormat>;

/** A format of two units to a room; false for an unknown one. */
export function isHeadToHead(format: GameFormatChoice): boolean {
  return format?.idealRoomSize === 2;
}

/** Whether the race double elimination can be drawn: head-to-head rooms that never hold a third unit. */
export function isRaceCompatible(
  format: GameFormatChoice,
  oddCountStrategy: PersistedSetup['oddCountStrategy'],
): boolean {
  return isHeadToHead(format) && oddCountStrategy !== 'flex';
}

/** Whether a Group Stage or a Swiss, which only head-to-head formats play, has to go with this format. */
export function leavesHeadToHeadPooling(
  poolingPhase: PersistedSetup['poolingPhase'],
  format: GameFormatChoice,
): boolean {
  return (poolingPhase === 'group-stage' || poolingPhase === 'swiss') && !isHeadToHead(format);
}

/**
 * A format or odd-count-strategy change can make the currently-selected
 * schedule logic unavailable (its own `<option>` disappears from the
 * dropdown) without resetting the already-selected value -- shared by
 * `setupAfterFormatChange` and `setupAfterOddCountChange` so the two callers can't drift
 * apart. `headToHeadOnly` alone decides the Kings Valley branch since an
 * odd-count-strategy change never flips it (the gate is by format only).
 */
export function reconcileScheduleLogicForFormat(
  current: PersistedSetup['scheduleLogic'],
  raceCompatible: boolean,
  headToHeadOnly: boolean,
): PersistedSetup['scheduleLogic'] {
  if (current === 'double-elimination' && !raceCompatible) return 'single-elimination';
  if (current === 'double-elimination-shared-final' && raceCompatible) return 'single-elimination';
  if (current === 'kings-valley' && headToHeadOnly) return 'single-elimination';
  return current;
}

/**
 * Odd-count strategy alone can flip raceCompatible (e.g. picking 'flex')
 * without the game format changing — reconcile scheduleLogic here too,
 * the same way `setupAfterFormatChange` does, so a stale 'double-elimination'
 * selection can never survive its own option disappearing from the list.
 * `renderedHeadToHead` is whether the format shown at the click was head-to-head.
 */
export function setupAfterOddCountChange(
  current: PersistedSetup,
  value: string,
  renderedHeadToHead: boolean,
): PersistedSetup {
  const strategy = value as PersistedSetup['oddCountStrategy'];
  const compatible = renderedHeadToHead && value !== 'flex';
  return {
    ...current,
    oddCountStrategy: strategy,
    scoring: scoringForPooling(current.scoring, current.poolingPhase, current.gameFormat, strategy),
    scheduleLogic: reconcileScheduleLogicForFormat(current.scheduleLogic, compatible, renderedHeadToHead),
  };
}

/** Picking Match results fills an empty tie margin with the game format's default. */
export function setupAfterScoringChange(
  current: PersistedSetup,
  value: PersistedSetup['scoring'],
): PersistedSetup {
  return {
    ...current,
    scoring: value,
    tieMargin:
      value === 'match-results'
        ? tieMarginAfterFormatChange(current.tieMargin, current.gameFormat, current.gameFormat)
        : current.tieMargin,
  };
}

/** `renderedPoolingPhase` is the pooling phase shown at the click: the scoring is decided by it. */
export function setupAfterFormatChange(
  current: PersistedSetup,
  value: PersistedSetup['gameFormat'],
  renderedPoolingPhase: PersistedSetup['poolingPhase'],
): PersistedSetup {
  const nextFormat = getGameFormat(value);
  const defaultOdd = (nextFormat && resolveOddCountStrategy(nextFormat, '')) ?? '';
  const compatible = isRaceCompatible(nextFormat, defaultOdd);
  const leavesPooling = leavesHeadToHeadPooling(renderedPoolingPhase, nextFormat);
  return {
    ...current,
    gameFormat: value,
    tieMargin: tieMarginAfterFormatChange(current.tieMargin, current.gameFormat, value),
    scoring: scoringForPooling(
      current.scoring,
      leavesPooling ? 'none' : current.poolingPhase,
      value,
      defaultOdd,
    ),
    oddCountStrategy: defaultOdd,
    teamScoringRule: nextTeamScoringRule(current, nextFormat?.teamSize),
    scheduleLogic: reconcileScheduleLogicForFormat(
      current.scheduleLogic,
      compatible,
      isHeadToHead(nextFormat),
    ),
    poolingPhase: leavesHeadToHeadPooling(current.poolingPhase, nextFormat) ? 'none' : current.poolingPhase,
  };
}
