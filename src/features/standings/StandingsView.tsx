import { useEffect, useMemo, useState } from 'react';
import { cutTieMarks, describeStandings } from '../../domain/tournament/standings-display';
import { readBracketFollow } from '../../lib/persistence/storage';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert } from '../../components/ui';
import { TournamentStandings } from './TournamentStandings';
import { standingsContextLine, standingsExplanation } from './standings-text';

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
      <p className='mb-2 text-sm font-semibold'>{standingsContextLine(display)}</p>
      <div className='mb-3.5 space-y-1 rounded-lg border border-surface-hover bg-surface px-4 py-3 text-xs text-muted'>
        {standingsExplanation(state, display).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      <TournamentStandings state={state} display={display} followKey={followKey} marks={marks} />
    </div>
  );
}
