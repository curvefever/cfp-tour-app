import { bracketEntryCountFromSetup } from '../../../domain/tournament/bracket-entry';
import { deriveRoomSize, getGameFormat, resolveOddCountStrategy } from '../../../domain/tournament/formats';
import { computeSwissRoundCount, QUALIFICATION_ROUNDS } from '../../../domain/tournament/pooling';
import { getMinimumBracketUnits } from '../../../domain/tournament/schedule-generation';
import { waterfallGraphQualAdvance } from '../../../domain/tournament/waterfall-draft';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';

/** What the Setup panels work out from the form and the roster before drawing. */
export function setupDerived(setup: PersistedSetup, state: TournamentState, lbQualifiers: string) {
  const format = getGameFormat(setup.gameFormat);
  const isGroup = setup.poolingPhase === 'group-stage';
  const totalPoolingRounds =
    setup.poolingPhase === 'qual-table'
      ? QUALIFICATION_ROUNDS
      : setup.poolingPhase === 'swiss'
        ? computeSwissRoundCount(state.confirmedCount ?? 0)
        : 0;
  const isSingle = setup.scheduleLogic === 'single-elimination';
  const isRace = setup.scheduleLogic === 'double-elimination';
  const isShared = setup.scheduleLogic === 'double-elimination-shared-final';
  const isWaterfallBracket = setup.scheduleLogic === 'waterfall-bracket';
  const derivedRoomSize = format
    ? deriveRoomSize(format, resolveOddCountStrategy(format, setup.oddCountStrategy))
    : { min: 1, max: 1, ideal: 1 };
  // A shared Final's winners-bracket share: what the last elimination round target must be.
  const sharedFinalShare =
    (Number.parseInt(setup.finalOverride, 10) || derivedRoomSize.ideal) -
    (Number.parseInt(lbQualifiers, 10) || 0);
  // After a qualification table the graph routes the final standings itself (its Qual source), so
  // "Advance to bracket" is derived from it and the graph is checked against the registered head count.
  const waterfallStandingsSource = isWaterfallBracket && setup.poolingPhase === 'qual-table';
  const waterfallEntrantCount = waterfallStandingsSource
    ? state.confirmedCount || null
    : bracketEntryCountFromSetup(
        setup,
        state.confirmedCount,
        getMinimumBracketUnits('waterfall-bracket', derivedRoomSize),
      );
  const derivedAdvance = waterfallStandingsSource ? waterfallGraphQualAdvance(setup.waterfallGraph) : 0;
  return {
    derivedAdvance,
    derivedRoomSize,
    isGroup,
    isRace,
    isShared,
    isSingle,
    isWaterfallBracket,
    sharedFinalShare,
    totalPoolingRounds,
    waterfallEntrantCount,
    waterfallStandingsSource,
  };
}
