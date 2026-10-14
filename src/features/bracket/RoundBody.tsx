import { detectTieBreaks, getAllTies, isTieResolved } from '../../domain/tournament/advancement';
import { type ProjectedSlotLabel, bracketRoundLabels } from '../../domain/tournament/bracket';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { ByeCard } from './ByeCard';
import { FinalColumn } from './FinalColumn';
import { PlaceholderRound } from './PlaceholderRound';
import { RoomCard } from './RoomCard';
import { RoundExitSummary } from './RoomExits';
import { KingsValleyDisclaimer, LuckyLoserDisclaimer, LuckyLoserStandingsPanel } from './RoundNotes';

function tieResolutionListSafe(state: TournamentState, key: string): string[] {
  const value = state.tieResolutions[key];
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function RoundBody({
  state,
  roundIndex,
  editable,
  followKey,
  projected,
  labels,
  finalTab,
  onFinalTabChange,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followKey: string | null;
  projected: ProjectedSlotLabel[][] | null;
  labels: ReturnType<typeof bracketRoundLabels>;
  finalTab?: number;
  onFinalTabChange?: (tab: number) => void;
}) {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (!assignments.length) {
    // A round already reached with nobody in it (a removal left it no units).
    if (roundIndex <= state.curRound)
      return <div className='text-sm text-muted'>Nobody reached this round.</div>;
    return (
      <PlaceholderRound
        round={round}
        roundIndex={roundIndex}
        state={state}
        projected={projected}
        labels={labels}
      />
    );
  }
  if (round.isFinal)
    return (
      <FinalColumn
        state={state}
        roundIndex={roundIndex}
        editable={editable && roundIndex === state.curRound}
        followed={followKey}
        tab={finalTab ?? 1}
        onTabChange={onFinalTabChange ?? (() => {})}
      />
    );
  const exitRule = roundExitRule(state, roundIndex);
  const teamMap = buildTeamMap(state);
  const rowsEditable = editable && roundIndex === state.curRound;
  const luckyNames = state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
  const roomTies = detectTieBreaks(roundIndex, round, state);
  const resolvedTieNames = new Set(
    Object.entries(roomTies)
      .filter(([key]) => tieResolutionListSafe(state, key).length > 0)
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  const pendingTieNames = new Set(
    Object.entries(getAllTies(state, roundIndex))
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  return (
    <>
      <RoundExitSummary rule={exitRule} labels={labels} rankedUnits={state.players.length} />
      {round.rooms.map((_, roomIndex) => (
        <RoomCard
          exitRule={exitRule}
          followKey={followKey}
          key={roomIndex}
          labels={labels}
          luckyNames={luckyNames}
          pendingTieNames={pendingTieNames}
          resolvedTieNames={resolvedTieNames}
          roomIndex={roomIndex}
          roundIndex={roundIndex}
          rowsEditable={rowsEditable}
          state={state}
          teamMap={teamMap}
        />
      ))}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.luckyCount > 0 && !round.isNoElim && roundIndex === state.curRound ? (
        <LuckyLoserStandingsPanel state={state} roundIndex={roundIndex} />
      ) : null}
      {round.isKingsValley ? <KingsValleyDisclaimer /> : null}
      {(state.byes[roundIndex] ?? []).map((name) => (
        <ByeCard followed={followKey === name} key={name} name={unitDisplay(state, name).label} />
      ))}
    </>
  );
}
