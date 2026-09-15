import { computeGroupStandings, computeQualificationStandings } from '../../domain/tournament/advancement';
import { getGameFormat } from '../../domain/tournament/formats';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { TournamentStandings } from '../tournament/components/TournamentStandings';
import { Alert, StatStrip } from '../../components/ui';

function ScoreboardStandings({ state }: { state: TournamentState }) {
  const hasGroups = state.rounds.slice(0, state.curRound + 1).some((round) => round.isGroupStage);
  const hasStandings = state.rounds
    .slice(0, state.curRound + 1)
    .some((round) => round.isQual || round.isSwiss);
  if (!hasGroups && !hasStandings) {
    return <Alert>No standings table for this tournament format — check Bracket for live results.</Alert>;
  }
  const groupStandings = hasGroups ? computeGroupStandings(state) : null;
  const tables = hasGroups
    ? state.groups.map((group) => [group.label, groupStandings?.[group.label] ?? []] as const)
    : [
        [
          state.cfg.poolingPhase === 'swiss' ? 'Swiss Standings' : 'Qualification Table',
          computeQualificationStandings(state),
        ] as const,
      ];
  return <TournamentStandings state={state} tables={tables} />;
}

export function ScoreboardView() {
  const { state } = useTournamentApp();
  if (!state.rounds.length || !state.started) {
    return <Alert>Start a tournament in Admin to see the live scoreboard.</Alert>;
  }
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  const format = getGameFormat(state.gameFormat);
  const phase = round.isFinal
    ? '🏆 Grand Final'
    : round.isSemis
      ? '⚔ Semi-Finals'
      : `Round ${round.roundNum}`;
  return (
    <div id='sb-content'>
      <StatStrip
        items={[
          { label: 'Round', value: phase },
          { label: format?.unitLabelPlural, value: assignments.length },
        ]}
      />
      <ScoreboardStandings state={state} />
    </div>
  );
}
