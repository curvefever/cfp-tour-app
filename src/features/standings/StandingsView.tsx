import { useEffect, useMemo, useState } from 'react';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import {
  cutTieMarks,
  describeStandings,
  type StandingsDisplay,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { readBracketFollow } from '../../lib/persistence/storage';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert, PageHeading, cn } from '../../components/ui';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { FollowBar } from '../bracket/FollowBanner';
import { rememberedFollow, standingsFollowDetail } from '../bracket/follow-text';
import { TournamentStandings } from './TournamentStandings';
import { standingsNames } from './standings-names';
import { standingsExplanation } from './standings-text';

/**
 * The "how it works" box: open on a desktop; on a phone it is one line that unfolds (the heading becomes that
 * line's button).
 */
function Explanation({ display, state }: { display: StandingsDisplay; state: TournamentState }) {
  const [open, setOpen] = useState(false);
  const names = standingsNames(display.kind);
  return (
    <section className='flex flex-col rounded-xs bg-cfp-game-deep px-5 py-4 outline-2 outline-cfp-game-frame max-[700px]:p-0'>
      <h2 className='text-sm font-extrabold tracking-[0.05em] text-muted uppercase max-[700px]:hidden'>
        {names.explainer}
      </h2>
      <button
        aria-expanded={open}
        className='flex min-h-11 cursor-pointer items-center gap-2 px-3 text-left text-sm font-bold min-[701px]:hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
        onClick={() => setOpen((current) => !current)}
        type='button'
      >
        {names.explainer}
        <span className='flex-1' />
        <svg aria-hidden='true' height='16' viewBox='0 0 16 16' width='16'>
          <path
            d={open ? 'M3.5 10.5 L8 6 L12.5 10.5' : 'M3.5 6 L8 10.5 L12.5 6'}
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2.2'
          />
        </svg>
      </button>
      <div
        className={cn(
          'mt-1.5 flex max-w-225 flex-col gap-1.5 text-base leading-[1.55] max-[700px]:mx-3 max-[700px]:mb-3',
          !open && 'max-[700px]:hidden',
        )}
      >
        {standingsExplanation(state, display).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
    </section>
  );
}

export function StandingsView() {
  const { state, hydrated } = useTournamentApp();
  const title = useTournamentTitle();
  const [followKey, setFollowKey] = useState<string | null>(null);
  const rosterLoaded = state.players.length > 0;
  useEffect(() => {
    if (hydrated) setFollowKey(rememberedFollow(state, readBracketFollow(window.localStorage)));
    // Read again when another tournament loads and once its roster arrives, not on every state change.
  }, [hydrated, state.tournamentId, rosterLoaded]);
  const display = useMemo(() => describeStandings(state), [state]);
  const marks = useMemo(() => (display ? cutTieMarks(state, display) : null), [state, display]);
  if (!display || !marks) {
    return <Alert>No standings table for this tournament format — check Bracket for live results.</Alert>;
  }
  const names = standingsNames(display.kind);
  return (
    <>
      <PageHeading label={names.title} title={title} />
      <div className='flex flex-col gap-5' id='st-content'>
        {followKey ? (
          <div className='flex'>
            <FollowBar
              detail={standingsFollowDetail(display, followKey, bracketRoundLabels(state))}
              name={unitDisplay(state, followKey).label}
            />
          </div>
        ) : null}
        <Explanation display={display} state={state} />
        <TournamentStandings state={state} display={display} followKey={followKey} marks={marks} />
      </div>
    </>
  );
}
