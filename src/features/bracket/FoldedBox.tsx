import type { ReactNode } from 'react';
import { cn } from '../../components/ui';
import type { FoldedRoundSummary } from './folded-round';

/**
 * A folded Bracket column: one small box, all of it the button that unfolds it. A lighter bar carries the name,
 * a green DONE for a finished round and a down chevron; the body is whatever the column wants to keep in view.
 */
export function FoldedBox({
  children,
  className,
  done = false,
  onUnfold,
  title,
}: {
  children?: ReactNode;
  className?: string;
  done?: boolean;
  onUnfold?: () => void;
  title: string;
}) {
  const boxClassName = cn(
    'w-42.5 shrink-0 overflow-hidden rounded-xs bg-cfp-game-deep text-left text-foreground outline-2 outline-cfp-game-frame shadow-[inset_0_-4px_0_var(--app-button-edge)]',
    onUnfold && 'cursor-pointer focus-visible:outline-primary',
    className,
  );
  const content = (
    <>
      <div className='flex h-11.5 items-center gap-2 bg-cfp-game-fold pr-1.5 pl-3'>
        <span className='text-[15px] font-extrabold tracking-[0.03em] whitespace-nowrap uppercase'>
          {title}
        </span>
        {done ? <span className='text-xs font-extrabold tracking-[0.04em] text-cfp-green'>DONE</span> : null}
        <span className='flex-1' />
        <svg aria-hidden='true' height='18' viewBox='0 0 16 16' width='18'>
          <path
            d='M3.5 6 L8 10.5 L12.5 6'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2.2'
          />
        </svg>
      </div>
      {children ? <div className='flex flex-col gap-1.5 px-2.5 pt-2.25 pb-3'>{children}</div> : null}
    </>
  );
  return onUnfold ? (
    <button aria-label={`Show ${title}`} className={boxClassName} onClick={onUnfold}>
      {content}
    </button>
  ) : (
    <div className={boxClassName}>{content}</div>
  );
}

function RoomsLine({ rooms }: { rooms: number }) {
  return (
    <div className='text-[13px] text-muted'>
      {rooms} {rooms === 1 ? 'room' : 'rooms'}
    </div>
  );
}

/** The body of a folded round: its room count and, for a followed unit that played it, its room and place. */
export function FoldedRoundBody({ summary }: { summary: FoldedRoundSummary }) {
  return (
    <>
      <RoomsLine rooms={summary.rooms} />
      {summary.followed ? (
        <>
          <div className='text-[13px] text-muted'>{summary.followed.label}</div>
          <div className='text-base font-bold text-cfp-sky'>{summary.followed.detail}</div>
        </>
      ) : null}
    </>
  );
}
