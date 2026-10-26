import { detectTieBreaks, pendingTieNames } from '../../domain/tournament/advancement';
import { type ProjectedSlotLabel, bracketRoundLabels } from '../../domain/tournament/bracket';
import type { ExpectedRound } from '../../domain/tournament/expected-draw';
import { usesFairCut } from '../../domain/tournament/fair-cut';
import { readTieResolution } from '../../domain/tournament/scoring';
import { describeStandings } from '../../domain/tournament/standings-display';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { ByeCard } from './ByeCard';
import { FinalColumn } from './FinalColumn';
import { PlaceholderRound } from './PlaceholderRound';
import { RoomCard } from './RoomCard';
import { roomPoints } from './room-points';
import { luckyLoserNames } from './room-row-inputs';
import { JoiningPanel, LuckyLoserStandingsPanel } from './RoundNotes';
import { isCurrentRound, isRoundReached, nextColumnStart } from '../../domain/tournament/round-columns';

/** The organiser decided this tie: picked who ranks next, or shared the points. */
function hasOrganiserDecision(state: TournamentState, key: string): boolean {
  const { ranked, shared } = readTieResolution(state, key);
  return ranked.length > 0 || shared.length > 0;
}

export function RoundBody({
  state,
  roundIndex,
  editable,
  followKey,
  projected,
  labels,
  expected = null,
  finalTab,
  onFinalTabChange,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followKey: string | null;
  projected: ProjectedSlotLabel[][] | null;
  labels: ReturnType<typeof bracketRoundLabels>;
  /** The expected draw of this round while it is not drawn yet (`expectedNextColumn`). */
  expected?: ExpectedRound | null;
  finalTab?: number;
  onFinalTabChange?: (tab: number) => void;
}) {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (!assignments.length) {
    // A round already reached with nobody in it (a removal left it no units).
    if (isRoundReached(state, roundIndex))
      return <div className='text-sm text-muted'>Nobody reached this round.</div>;
    return (
      <>
        <PlaceholderRound
          round={round}
          roundIndex={roundIndex}
          state={state}
          projected={projected}
          labels={labels}
          expected={expected}
        />
        {roundIndex === nextColumnStart(state) ? <JoiningPanel state={state} /> : null}
      </>
    );
  }
  if (round.isFinal)
    return (
      <FinalColumn
        state={state}
        roundIndex={roundIndex}
        editable={editable && isCurrentRound(state, roundIndex)}
        followed={followKey}
        tab={finalTab ?? 1}
        onTabChange={onFinalTabChange ?? (() => {})}
      />
    );
  const exitRule = roundExitRule(state, roundIndex);
  // Pooling rooms of a round that counts toward the standings show the points each place earned.
  const countsForPoints =
    (exitRule.kind === 'standings' && exitRule.counted) ||
    (exitRule.kind === 'standings-cutoff' && !round.excludeFromStandings);
  const points = countsForPoints ? roomPoints(describeStandings(state), roundIndex) : null;
  const teamMap = buildTeamMap(state);
  const rowsEditable = editable && isCurrentRound(state, roundIndex);
  const luckyNames = luckyLoserNames(state, roundIndex);
  const roomTies = detectTieBreaks(roundIndex, round, state);
  const resolvedTieNames = new Set(
    Object.entries(roomTies)
      .filter(([key]) => hasOrganiserDecision(state, key))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  const pendingTies = pendingTieNames(state, roundIndex);
  return (
    <>
      {round.rooms.map((_, roomIndex) => (
        <RoomCard
          exitRule={exitRule}
          followKey={followKey}
          key={roomIndex}
          labels={labels}
          luckyNames={luckyNames}
          pendingTieNames={pendingTies}
          resolvedTieNames={resolvedTieNames}
          roomIndex={roomIndex}
          roundIndex={roundIndex}
          rowsEditable={rowsEditable}
          state={state}
          points={points}
          teamMap={teamMap}
        />
      ))}
      {(round.luckyCount > 0 || usesFairCut(state, roundIndex)) &&
      !round.isNoElim &&
      isCurrentRound(state, roundIndex) ? (
        <LuckyLoserStandingsPanel state={state} roundIndex={roundIndex} />
      ) : null}
      {(state.byes[roundIndex] ?? []).map((name) => (
        <ByeCard followed={followKey === name} key={name} name={unitDisplay(state, name).label} />
      ))}
    </>
  );
}
