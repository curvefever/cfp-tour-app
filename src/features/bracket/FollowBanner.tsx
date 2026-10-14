import { useMemo } from 'react';
import {
  type StandingsDisplay,
  describeStandings,
  standingFor,
} from '../../domain/tournament/standings-display';
import { type BracketFollowStatus, bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, cn } from '../../components/ui';

/** " · #6 in standings" (or "in Group A") while the standings are still being decided; nothing after pooling. */
function standingsSuffix(standings: StandingsDisplay | null, followKey: string): string {
  if (!standings || standings.phase === 'final') return '';
  const standing = standingFor(standings, followKey);
  if (!standing) return '';
  return ` · #${standing.rank} in ${standing.groupLabel ? `Group ${standing.groupLabel}` : 'standings'}`;
}

export function FollowBanner({
  state,
  followKey,
  follow,
  clear,
}: {
  state: TournamentState;
  followKey: string | null;
  follow: BracketFollowStatus | null;
  clear(): void;
}) {
  const standings = useMemo(() => describeStandings(state), [state]);
  if (!followKey) return null;
  const label = unitDisplay(state, followKey).label;
  const out = !follow || follow.eliminated;
  const roundName = follow
    ? (bracketRoundLabels(state)[follow.lastRi]?.label ?? `Round ${follow.lastRi + 1}`)
    : '';
  const where = !follow
    ? 'not in this bracket'
    : follow.eliminated
      ? `out in ${roundName}`
      : follow.isBye || follow.room === null
        ? `${roundName} · BYE, advances automatically`
        : `${roundName} · Room ${roomLetter(follow.room)}`;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-surface-hover bg-primary-soft py-1 pr-1.5 pl-3 text-xs',
        out && 'bg-danger/10',
      )}
    >
      <strong className={out ? 'text-muted' : 'text-primary'}>Following {label}</strong> — {where}
      {standingsSuffix(standings, followKey)}
      <Button
        aria-label='Stop following'
        className='size-6 min-h-0 rounded-full p-0'
        onClick={clear}
        size='sm'
        title='Stop following'
        variant='ghost'
      >
        ✕
      </Button>
    </div>
  );
}
