import { cn } from '../../../components/ui';

/** The solid shield shape, one text line high, in the current colour. */
export function ShieldShape({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden='true'
      className={cn('inline-block h-[1em] w-[0.875em] align-[-0.125em]', className)}
      viewBox='0 0 14 16'
    >
      <path
        d='M7 0.5 L13 2.8 V7.5 C13 11.3 10.4 14.2 7 15.5 C3.6 14.2 1 11.3 1 7.5 V2.8 Z'
        fill='currentColor'
      />
    </svg>
  );
}

/**
 * The Save your Buddy defender's mark: a solid blue shield with a "Defender" box above it on hover, and on tap or
 * keyboard focus where there is no hover.
 */
export function DefenderShield() {
  return (
    // Focusable, so a tap shows the box on a phone.
    <span aria-label='Defender' className='group relative inline-block outline-none' role='img' tabIndex={0}>
      <ShieldShape className='text-cfp-brand' />
      <span
        aria-hidden='true'
        className='pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded-xs bg-cfp-game-deep px-2 py-0.5 text-xs whitespace-nowrap text-foreground shadow-[0_4px_12px_var(--shadow-floating)] outline-1 outline-primary group-hover:visible group-focus:visible'
      >
        Defender
      </span>
    </span>
  );
}
