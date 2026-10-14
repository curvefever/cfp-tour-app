import { computeLuckyLoserStandings } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { formatTieBreak } from '../standings/standings-text';

export function LuckyLoserDisclaimer({ round }: { round: TournamentRound }) {
  const direct = round.advPerRoom ?? 0;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>★ Lucky loser{round.luckyCount === 1 ? '' : 's'}: </span>
      Top {direct} advance{direct === 1 ? 's' : ''} directly from each room. {round.luckyCount} extra spot
      {round.luckyCount === 1 ? '' : 's'} go{round.luckyCount === 1 ? 'es' : ''} to whoever's next-best
      finisher scores highest relative to their own room's average (100% = average) — compared across every
      room.
    </div>
  );
}

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

export function KingsValleyDisclaimer() {
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>⛰ Kings Valley: </span>
      Top finishers promote to the room above, bottom finishers demote to the room below, the rest stay. The
      lowest room with a real match eliminates its bottom finishers instead, and anyone alone in a room keeps
      their place — see each room's own chips above for the exact counts.
    </div>
  );
}
