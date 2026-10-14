import { useEffect, useMemo, useState } from 'react';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import { cutTieMarks, describeStandings } from '../../domain/tournament/standings-display';
import { readBracketFollow } from '../../lib/persistence/storage';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert, PageHeading } from '../../components/ui';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { FollowBar } from '../bracket/FollowBanner';
import { standingsFollowDetail } from '../bracket/follow-text';
import { TournamentStandings } from './TournamentStandings';
import { standingsExplanation } from './standings-text';

export function StandingsView() {
  const { state, hydrated } = useTournamentApp();
  const title = useTournamentTitle();
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
    <>
      <PageHeading label='Standings' title={title} />
      <div className='flex flex-col gap-5' id='st-content'>
        {followKey ? (
          <div className='flex'>
            <FollowBar
              detail={standingsFollowDetail(display, followKey, bracketRoundLabels(state))}
              name={unitDisplay(state, followKey).label}
            />
          </div>
        ) : null}
        <section className='flex flex-col gap-1.5 rounded-xs bg-cfp-game-deep px-5 py-4 outline-2 outline-cfp-game-frame'>
          <h2 className='text-sm font-extrabold tracking-[0.05em] text-muted uppercase'>
            How the standings work
          </h2>
          <div className='flex max-w-225 flex-col gap-1.5 text-base leading-[1.55]'>
            {standingsExplanation(state, display).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        </section>
        <TournamentStandings state={state} display={display} followKey={followKey} marks={marks} />
      </div>
    </>
  );
}
