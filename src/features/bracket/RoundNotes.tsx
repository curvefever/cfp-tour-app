import { computeLuckyLoserStandings } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { formatTieBreak } from '../standings/standings-text';
import { roomsStillPlaying, stillPlayingText } from './still-playing';

/**
 * The lucky-loser race of a round, under its rooms: how many spots there are, the candidates by their share of
 * their room total (the best first), and which rooms are still being played. How it works is explained in the
 * "?" box, not here.
 */
export function LuckyLoserStandingsPanel({
  state,
  roundIndex,
}: {
  state: TournamentState;
  roundIndex: number;
}) {
  const standings = computeLuckyLoserStandings(state, roundIndex);
  if (!standings?.length) return null;
  const spots = state.rounds[roundIndex].luckyCount;
  const playing = stillPlayingText(roomsStillPlaying(state, roundIndex));
  return (
    <div className='flex flex-col gap-1.5 rounded-xs bg-cfp-game-deep px-3 py-2.5 outline-2 outline-dashed outline-cfp-green-dim'>
      <div className='text-[13px] font-extrabold tracking-[0.05em] text-cfp-green'>
        ★ LUCKY LOSER RACE · {spots} {spots === 1 ? 'SPOT' : 'SPOTS'}
      </div>
      {standings.map((entry, index) => (
        <div className='flex items-center gap-2 text-[15px]' key={entry.name}>
          <span className='w-4 shrink-0 font-bold text-muted'>{index + 1}</span>
          <span className='min-w-0 flex-1 wrap-break-word font-bold'>
            {unitDisplay(state, entry.name).label}
          </span>
          <span className='shrink-0 text-muted'>Room {roomLetter(entry.room)}</span>
          <span className='w-11 shrink-0 text-right font-extrabold'>{formatTieBreak(entry.share)}</span>
        </div>
      ))}
      {playing ? <div className='text-[13px] text-muted'>{playing}</div> : null}
    </div>
  );
}
