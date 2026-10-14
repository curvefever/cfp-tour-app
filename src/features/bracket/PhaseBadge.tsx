import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import { cn } from '../../components/ui';

/** TEMPORARY while the standings can still change, FINAL once the last pooling round is over; nothing before they start. */
export function PhaseBadge({ phase }: { phase: StandingsDisplay['phase'] }) {
  if (phase === 'upcoming') return null;
  const live = phase === 'live';
  return (
    <span
      className={cn(
        'rounded-xs px-1.75 py-0.75 text-[11px] leading-none font-extrabold tracking-[0.05em]',
        live ? 'bg-warning/18 text-cfp-orange-text' : 'bg-success/18 text-cfp-green-text',
      )}
    >
      {live ? 'TEMPORARY' : 'FINAL'}
    </span>
  );
}
