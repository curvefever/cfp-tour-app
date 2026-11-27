import { bracketEntryCountFromSetup } from '../../../domain/tournament/bracket-entry';
import { deriveRoomSize, getGameFormat, resolveOddCountStrategy } from '../../../domain/tournament/formats';
import { roundsBeforeBracket } from '../../../domain/tournament/pooling-rounds';
import { getMinimumBracketUnits } from '../../../domain/tournament/schedule-generation';
import { groupSettingsOf, groupSizesOf } from '../../../domain/tournament/group-settings';
import { standingsKindOfSetup } from '../../../domain/tournament/waterfall-numbering';
import { waterfallGraphQualAdvance } from '../../../domain/tournament/waterfall-draft';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';

/** What the Setup panels work out from the form and the roster before drawing. */
export function setupDerived(setup: PersistedSetup, state: TournamentState, lbQualifiers: string) {
  const format = getGameFormat(setup.gameFormat);
  const isGroup = setup.poolingPhase === 'group-stage';
  // The rounds "Non-counting rounds" counts from, an override included: only a table and a Swiss have that field.
  const totalPoolingRounds =
    setup.poolingPhase === 'qual-table' || setup.poolingPhase === 'swiss'
      ? roundsBeforeBracket(setup, state.confirmedCount ?? 0)
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
  // After a qualification table or a group stage the graph routes the pooling exit itself (its Qual or Groups
  // source), so "Advance to bracket" is derived from it and the graph is checked against the registered head count.
  const waterfallStandingsKind = standingsKindOfSetup(setup);
  const waterfallStandingsSource = waterfallStandingsKind !== null;
  const waterfallEntrantCount = waterfallStandingsSource
    ? state.confirmedCount || null
    : bracketEntryCountFromSetup(
        setup,
        state.confirmedCount,
        getMinimumBracketUnits('waterfall-bracket', derivedRoomSize),
        derivedRoomSize,
      );
  const derivedAdvance = waterfallStandingsKind
    ? waterfallGraphQualAdvance(setup.waterfallGraph, waterfallStandingsKind)
    : 0;
  // The groups the roster splits into, when the Groups line decides the exit (null while no roster is loaded).
  const waterfallGroupSizes =
    waterfallStandingsKind === 'groups' && state.confirmedCount
      ? groupSizesOf(state.confirmedCount, groupSettingsOf(setup).groupSize)
      : null;
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
    waterfallGroupSizes,
    waterfallStandingsKind,
    waterfallStandingsSource,
  };
}
