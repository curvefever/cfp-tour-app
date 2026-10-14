import { computeLuckyLoserStandings } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { formatTieBreak } from '../standings/standings-text';

export function LuckyLoserStandingsPanel({
  state,
  roundIndex,
}: {
  state: TournamentState;
  roundIndex: number;
}) {
  const standings = computeLuckyLoserStandings(state, roundIndex);
  if (!standings?.length) return null;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem]'>
      <div className='mb-1 font-semibold tracking-[0.05em] text-accent uppercase'>Lucky loser race</div>
      {standings.map((entry) => (
        <div
          className={cn(
            'flex items-center justify-between gap-2 py-px',
            entry.leading ? 'font-semibold text-accent' : 'text-muted',
          )}
          key={entry.name}
        >
          <span className='min-w-0 flex-1 truncate'>
            {entry.leading ? '★ ' : ''}Room {roomLetter(entry.room)} · {unitDisplay(state, entry.name).label}
          </span>
          <span>{formatTieBreak(entry.share)}</span>
        </div>
      ))}
    </div>
  );
}
