import type { ReactNode } from 'react';
import { cn } from './cn';

export function TimelineDots({ children }: { children: ReactNode }) {
  return <div className='flex items-center gap-1'>{children}</div>;
}

export function TimelineDot({
  milestone = false,
  state = 'upcoming',
  tooltip,
}: {
  milestone?: boolean;
  state?: 'done' | 'current' | 'upcoming';
  tooltip: string;
}) {
  return (
    <div
      title={tooltip}
      className={cn(
        'rounded-full transition',
        milestone ? 'size-3' : 'size-1.5',
        state === 'done' && 'bg-success',
        state === 'current' && cn('bg-primary', milestone && 'shadow-[0_0_8px_var(--app-primary-soft)]'),
        state === 'upcoming' && 'bg-surface-hover',
      )}
    />
  );
}
