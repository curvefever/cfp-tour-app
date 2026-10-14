import { cn } from '../../components/ui';
import { Stripe } from '../tournament/components/ResultStripe';
import { bracketLegend } from './bracket-legend';
import type { TournamentState } from '../../domain/tournament/types';

/** The plain circled "?" at the far right of the follow row. */
export function InfoToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      aria-expanded={open}
      aria-label='How to read the bracket'
      className={cn(
        'flex size-11 cursor-pointer items-center justify-center hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
        open ? 'text-cfp-sky' : 'text-muted',
      )}
      onClick={onToggle}
      type='button'
    >
      <svg aria-hidden='true' height='28' viewBox='0 0 28 28' width='28'>
        <circle cx='14' cy='14' fill='none' r='12' stroke='currentColor' strokeWidth='2.2' />
        <path
          d='M10.6 11 C 10.6 8.8, 12.2 7.6, 14.1 7.6 C 16.1 7.6, 17.5 8.9, 17.5 10.7 C 17.5 12.9, 14.2 13.3, 14.2 15.9'
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeWidth='2.2'
        />
        <circle cx='14.2' cy='20' fill='currentColor' r='1.4' />
      </svg>
    </button>
  );
}

const sectionClassName = 'flex flex-col gap-1.5 border-t border-cfp-game-fold pt-2.5';

/** The colour key of the Bracket, with only what this tournament can show, and a few lines of explanation. */
export function BracketInfoBox({ state, onClose }: { state: TournamentState; onClose(): void }) {
  const legend = bracketLegend(state);
  return (
    <div
      aria-label='How to read the bracket'
      className='absolute top-14 right-0 z-20 flex w-105 max-w-[calc(100vw-40px)] flex-col gap-3 rounded-xs bg-cfp-game-deep px-4.5 py-4 shadow-[0_14px_40px_var(--shadow-floating)] outline-2 outline-primary'
      role='dialog'
    >
      <div className='flex items-center justify-between'>
        <h2 className='text-[15px] font-extrabold tracking-[0.04em] uppercase'>How to read the bracket</h2>
        <button
          aria-label='Close'
          className='flex size-7 cursor-pointer items-center justify-center rounded-xs bg-foreground/12 text-base font-bold'
          onClick={onClose}
          type='button'
        >
          ×
        </button>
      </div>
      <div className='flex flex-col gap-1.5'>
        {legend.rows.map((row) => (
          <div className='flex items-center gap-2.5 text-sm' key={`${row.tone}-${row.name}`}>
            <Stripe className='h-4.5' tone={row.tone} />
            <div className='w-40 shrink-0 font-bold'>
              {row.name}
              {row.star ? <span className='text-cfp-green'> ★</span> : null}
            </div>
            <div className='text-[13px] text-muted'>{row.meaning}</div>
          </div>
        ))}
      </div>
      {legend.luckyLosers ? (
        <div className={sectionClassName}>
          <div className='text-[13px] font-extrabold tracking-[0.04em] text-cfp-green uppercase'>
            ★ Lucky losers
          </div>
          <p className='text-[13px] leading-normal text-cfp-text-soft'>
            Some rounds keep spots for the best players who just missed out. Once every room of the round is
            scored, those players are compared by their score relative to their room&apos;s average, so a
            smaller room gives no head start. Until then they show as undecided, with a star.
          </p>
        </div>
      ) : null}
      <div className='border-t border-cfp-game-fold pt-2.5 text-[13px] leading-normal text-cfp-text-soft'>
        The arrow icon on a room shows who goes where from that room.
      </div>
    </div>
  );
}
