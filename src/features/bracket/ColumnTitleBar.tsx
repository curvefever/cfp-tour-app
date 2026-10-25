import type { ReactNode } from 'react';
import { Badge, cn, columnTitleClassName } from '../../components/ui';
import type { RoundGameCount } from '../../domain/tournament/bracket';
import { RoundSettingsPopup } from './RoundSettingsPopup';
import type { RoomsScored } from './still-playing';

/** "1 GAME", "3 GAMES", or "UP TO 4 GAMES" for the race Grand Final. */
function gameCountText({ games, upTo }: RoundGameCount): string {
  return `${upTo ? 'UP TO ' : ''}${games} ${games === 1 ? 'GAME' : 'GAMES'}`;
}

/** A small caps tag after a title bar's name: the game count, EXPECTED. */
function TitleTag({ children }: { children: ReactNode }) {
  return (
    <span className='rounded-xs bg-foreground/10 px-1.75 py-0.75 text-[11px] leading-none font-extrabold text-cfp-text-soft'>
      {children}
    </span>
  );
}

/** The admin's "4/6": rooms fully scored out of the round's rooms, green once all are in. */
function RoomsScoredTag({ progress: { scored, total } }: { progress: RoomsScored }) {
  const label = `${scored} of ${total} rooms scored`;
  return (
    <span
      aria-label={label}
      className={cn(
        'px-1.5 text-[13px] font-bold tabular-nums',
        scored === total ? 'text-cfp-green-text' : 'text-cfp-text-soft',
      )}
      title={label}
    >
      {scored}/{total}
    </span>
  );
}

function FoldButton({ onToggle, title }: { onToggle: () => void; title: string }) {
  return (
    <button
      aria-expanded='true'
      aria-label={`Fold ${title}`}
      className='flex size-7 shrink-0 cursor-pointer items-center justify-center max-[700px]:hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
      onClick={onToggle}
    >
      <svg aria-hidden='true' height='18' viewBox='0 0 16 16' width='18'>
        <path
          d='M3.5 10.5 L8 6 L12.5 10.5'
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='2.2'
        />
      </svg>
    </button>
  );
}

/**
 * The title bar above a Bracket column: its name, a NOW pill on the current round, the game count (`roundGameCount`
 * decides when there is one), and at the right the admin's rooms-scored tracker, anything extra the column wants (an
 * exit icon) and the fold chevron.
 */
export function ColumnTitleBar({
  attached = false,
  badge,
  className,
  expected = false,
  extra,
  gameCount,
  now = false,
  onToggle,
  progress = null,
  settingsNote = '',
  title,
}: {
  /** A settings band follows directly under the bar: its bottom corners are square. */
  attached?: boolean;
  /** A status tag after the title (the standings column's TEMPORARY / FINAL). */
  badge?: ReactNode;
  className?: string;
  /** The round's line-up is the expected draw, not yet made (`expectedNextColumn`). */
  expected?: boolean;
  extra?: ReactNode;
  gameCount?: RoundGameCount | null;
  now?: boolean;
  onToggle?: () => void;
  /** Rooms scored out of the round's rooms, for an admin on a round in play; nothing when null or without rooms. */
  progress?: RoomsScored | null;
  /** The round's settings note, while the bands are hidden: the bar then has a button that opens it in a pop-up. */
  settingsNote?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        'flex h-11.5 items-center gap-1.5 rounded bg-cfp-game-title pr-1.5 pl-3.5 whitespace-nowrap',
        attached && 'rounded-b-none',
        className,
      )}
    >
      <h2 className={cn(columnTitleClassName, 'min-w-0 truncate')}>{title}</h2>
      {now ? (
        <Badge className='px-2.25 py-0.75 text-xs tracking-[0.04em]' tone='now'>
          NOW
        </Badge>
      ) : null}
      {gameCount ? <TitleTag>{gameCountText(gameCount)}</TitleTag> : null}
      {expected ? <TitleTag>EXPECTED</TitleTag> : null}
      {badge}
      <div className='ml-auto flex shrink-0 items-center'>
        {progress && progress.total > 0 ? <RoomsScoredTag progress={progress} /> : null}
        {extra}
        {settingsNote ? <RoundSettingsPopup note={settingsNote} /> : null}
        {onToggle ? <FoldButton onToggle={onToggle} title={title} /> : null}
      </div>
    </div>
  );
}
