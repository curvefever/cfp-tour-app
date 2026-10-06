import { useEffect, useMemo, useState } from 'react';
import { scoringSystemLabel } from '../../domain/tournament/scoring';
import { cutTieMarks, describeStandings } from '../../domain/tournament/standings-display';
import { readBracketFollow } from '../../lib/persistence/storage';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert } from '../../components/ui';
import { TournamentStandings } from './TournamentStandings';
import { standingsContextLine } from './standings-text';

function explanationLine(): string {
  return `${scoringSystemLabel()}: higher is better. Equal points are separated by average room share: your score as a share of your room's total, averaged over counted rounds.`;
}

export function StandingsView() {
  const { state, hydrated } = useTournamentApp();
  const [followKey, setFollowKey] = useState<string | null>(null);
  useEffect(() => {
    if (hydrated) setFollowKey(readBracketFollow(window.localStorage));
  }, [hydrated]);
  const display = useMemo(() => describeStandings(state), [state]);
  const marks = useMemo(() => (display ? cutTieMarks(state, display) : null), [state, display]);
  if (!display || !marks) {
    return <Alert>No standings table for this tournament format — check Bracket for live results.</Alert>;
  }
  return (
    <div id='st-content'>
      <p className='mb-1 text-sm font-semibold'>{standingsContextLine(display)}</p>
      <p className='mb-3.5 text-xs text-muted'>{explanationLine()}</p>
      <TournamentStandings state={state} display={display} followKey={followKey} marks={marks} />
    </div>
  );
}
