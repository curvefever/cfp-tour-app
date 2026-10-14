import type { ReactNode } from 'react';
import { Badge, cn, columnTitleClassName } from '../../components/ui';
import type { RoundGameCount } from '../../domain/tournament/bracket';

/** "3 GAMES", or "UP TO 4 GAMES" for the race Grand Final. */
function gameCountText({ games, upTo }: RoundGameCount): string {
  return `${upTo ? 'UP TO ' : ''}${games} GAMES`;
}

function FoldButton({ onToggle, title }: { onToggle: () => void; title: string }) {
  return (
    <button
      aria-expanded='true'
      aria-label={`Fold ${title}`}
      className='flex size-8.5 shrink-0 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
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
 * The title bar above a Bracket column: its name, a NOW pill on the current round, the game count when there is
 * more than one game, anything extra the column wants at the right (an exit icon), and the fold chevron.
 */
export function ColumnTitleBar({
  badge,
  className,
  extra,
  gameCount,
  now = false,
  onToggle,
  title,
}: {
  /** A status tag after the title (the standings column's TEMPORARY / FINAL). */
  badge?: ReactNode;
  className?: string;
  extra?: ReactNode;
  gameCount?: RoundGameCount | null;
  now?: boolean;
  onToggle?: () => void;
  title: string;
}) {
  return (
    <div
      className={cn(
        'flex h-11.5 items-center gap-2 rounded bg-cfp-game-title pr-1.5 pl-3.5 whitespace-nowrap',
        className,
      )}
    >
      <h2 className={cn(columnTitleClassName, 'min-w-0 truncate')}>{title}</h2>
      {now ? (
        <Badge className='px-2.25 py-0.75 text-xs tracking-[0.04em]' tone='now'>
          NOW
        </Badge>
      ) : null}
      {gameCount ? (
        <span className='rounded-xs bg-foreground/10 px-1.75 py-0.75 text-[11px] leading-none font-extrabold text-cfp-text-soft'>
          {gameCountText(gameCount)}
        </span>
      ) : null}
      {badge}
      <div className='flex-1' />
      {extra}
      {onToggle ? <FoldButton onToggle={onToggle} title={title} /> : null}
    </div>
  );
}
