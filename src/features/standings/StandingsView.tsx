import { useEffect, useMemo, useState } from 'react';
import { getAllTies, isTieResolved, refreshRoundStandings } from '../../domain/tournament/advancement';
import { scoringSystemLabel, tieResolutionList } from '../../domain/tournament/scoring';
import { describeStandings, type StandingsDisplay } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { readBracketFollow } from '../../lib/persistence/storage';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert } from '../../components/ui';
import { TournamentStandings } from './TournamentStandings';
import { standingsContextLine } from './standings-text';

function explanationLine(state: TournamentState): string {
  const scoring = state.gamemodeConfig.scoring ?? 'fairpoints';
  const direction = scoring === 'positional-points' ? 'higher is better' : 'lower is better';
  return `${scoringSystemLabel(scoring)}: ${direction}. Equal points are separated by average room share: your score as a share of your room's total, averaged over counted rounds.`;
}

/** Names placed by a resolved cut-off tie, and names still in an unresolved cluster, per table key. */
function tieMarks(state: TournamentState, display: StandingsDisplay) {
  const ties = getAllTies(refreshRoundStandings(state, state.curRound), state.curRound);
  const placed: Record<string, string[]> = {};
  const pending: Record<string, string[]> = {};
  for (const table of display.tables) {
    const cluster = ties[table.key];
    if (!cluster) continue;
    if (isTieResolved(table.key, cluster, state)) placed[table.key] = tieResolutionList(state, table.key);
    else pending[table.key] = cluster.players.map((player) => player.name);
  }
  return { placed, pending };
}

export function StandingsView() {
  const { state, hydrated } = useTournamentApp();
  const [followKey, setFollowKey] = useState<string | null>(null);
  useEffect(() => {
    if (hydrated) setFollowKey(readBracketFollow(window.localStorage));
  }, [hydrated]);
  const display = useMemo(() => describeStandings(state), [state]);
  const marks = useMemo(() => (display ? tieMarks(state, display) : null), [state, display]);
  if (!display || !marks) {
    return <Alert>No standings table for this tournament format — check Bracket for live results.</Alert>;
  }
  return (
    <div id='st-content'>
      <p className='mb-1 text-sm font-semibold'>{standingsContextLine(display)}</p>
      <p className='mb-3.5 text-xs text-muted'>{explanationLine(state)}</p>
      <TournamentStandings
        state={state}
        display={display}
        followKey={followKey}
        placedNames={marks.placed}
        pendingNames={marks.pending}
      />
    </div>
  );
}
