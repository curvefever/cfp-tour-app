import { isGroupBandKey, isGroupCutoffKey } from './advancement';
import { bestPlaceTieKey } from './best-place';
import { GROUP_EXIT_TIE_KEY, groupsLineExit } from './group-exit';
import { unitLabelPluralLower } from './formats';
import type { TournamentRound, TournamentState } from './types';

/**
 * The pooling exit a save of an edited waterfall graph reads: the standings round, the Groups line's settings, and the
 * tie decisions a save drops.
 */

/**
 * A qualification-table, Swiss or group-stage tournament's graph has a Qual or Groups source: the last pooling round
 * carries the standings routing (`standingsRoutes`) and the highest rank it sends on is the exit total. A group
 * stage or Swiss generated without a Groups or Qual line stores no routing and keeps the one entry round.
 */
export function standingsRoundIndex(state: TournamentState, firstWaterfallIndex: number): number {
  const phase = state.cfg.poolingPhase;
  if (phase !== 'group-stage' && phase !== 'qual-table' && phase !== 'swiss') return -1;
  const index = state.rounds
    .map((round) =>
      Boolean(
        phase === 'group-stage' ? round.isGroupStage : phase === 'swiss' ? round.isSwiss : round.isQual,
      ),
    )
    .lastIndexOf(true);
  if (index < 0 || index >= firstWaterfallIndex) return -1;
  return phase !== 'qual-table' && !state.rounds[index].standingsRoutes ? -1 : index;
}

/** Whether a tie resolution belongs to the Groups line's exit: a band boundary, or the cut-off the exit total sets. */
export function isGroupExitTieKey(key: string, includeCutoffs: boolean): boolean {
  return isGroupBandKey(key) || (includeCutoffs && (key === GROUP_EXIT_TIE_KEY || isGroupCutoffKey(key)));
}

type GroupsLineSettings = { ok: true; cfg: TournamentState['cfg'] } | { ok: false; error: string };

/**
 * The exit settings a Groups line implies. While the groups are played it sets the total (or the qualifiers per
 * group), checked against the groups as they stand now. Once the bracket is entered the exit is over: the line may
 * only route ranks that actually left the groups, and the settings stay.
 */
export function groupsLineSettings(
  state: TournamentState,
  sentOn: number,
  standingsRound: TournamentRound,
  bracketEntered: boolean,
): GroupsLineSettings {
  if (bracketEntered) {
    const left = standingsRound.standingsExitOrder?.length;
    if (left !== undefined && sentOn > left) {
      return {
        ok: false,
        error: `Can't save: only ${left} left the groups, so the Groups line can't route rank ${sentOn}.`,
      };
    }
    return { ok: true, cfg: state.cfg };
  }
  const exit = groupsLineExit(
    state.groups.map((group) => group.members.length),
    state.cfg.groupExit ?? 'per-group',
    sentOn,
    unitLabelPluralLower(state.settings?.gameFormat),
  );
  if (exit.refusal) return { ok: false, error: `Can't save: ${exit.refusal}` };
  return {
    ok: true,
    cfg: {
      ...state.cfg,
      qualAdv: exit.qualAdv ?? state.cfg.qualAdv,
      qualifiersPerGroup: exit.qualifiersPerGroup ?? state.cfg.qualifiersPerGroup,
    },
  };
}

/**
 * The tie decisions without those on a best of a place that the edit changed or removed: the organiser picked among
 * other units, and a leftover pick would count toward the new line's tie without deciding it.
 */
export function withoutChangedBestDecisions(
  tieResolutions: TournamentState['tieResolutions'],
  before: TournamentRound[],
  after: TournamentRound[],
  keptLength: number,
): TournamentState['tieResolutions'] {
  const kept = { ...tieResolutions };
  for (let index = 0; index < keptLength; index += 1) {
    if (JSON.stringify(before[index]?.waterfallBest) !== JSON.stringify(after[index]?.waterfallBest)) {
      delete kept[bestPlaceTieKey(index)];
    }
  }
  return kept;
}
