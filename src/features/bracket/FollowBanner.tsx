import { useMemo } from 'react';
import { type BracketFollowStatus } from '../../domain/tournament/bracket';
import { describeStandings } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { followBannerText } from './follow-text';

/** The follow banner's bar: "Following Dune" and what comes after it. Shared by the Bracket and the Standings tab. */
export function FollowBar({ name, detail }: { name: string; detail: string }) {
  return (
    <div
      className='flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xs bg-cfp-game-banner px-3.5 py-1'
      role='status'
    >
      <span className='text-[15px] font-extrabold tracking-[0.03em] uppercase'>Following {name}</span>
      {detail ? <span className='text-[15px] text-cfp-text-soft'>{detail}</span> : null}
    </div>
  );
}

/**
 * The Bracket's follow banner: who is followed and where they are ("Following Dune · Quarters · Room B · 4th → Semi B").
 * No close button: emptying the follow box stops following.
 */
export function FollowBanner({
  state,
  followKey,
  follow,
}: {
  state: TournamentState;
  followKey: string | null;
  follow: BracketFollowStatus | null;
}) {
  const standings = useMemo(() => describeStandings(state), [state]);
  if (!followKey) return null;
  const { name, detail } = followBannerText(state, follow, standings, followKey);
  return <FollowBar detail={detail} name={name} />;
}
