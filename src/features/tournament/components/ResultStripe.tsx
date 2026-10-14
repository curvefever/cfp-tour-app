import { cn } from '../../../components/ui';
import { stripeTone, type RowResult, type StripeTone } from './result-row';

const TONE_CLASSES: Record<StripeTone, string> = {
  green: 'bg-cfp-green',
  yellow: 'bg-cfp-yellow',
  orange: 'bg-cfp-orange',
  purple: 'bg-cfp-purple',
  red: 'bg-cfp-red',
  dashed: 'border border-dashed border-cfp-text-dim',
};

/** The small stripe between a row's place and its name, coloured by the row's result. Renders nothing for a row without one. */
export function ResultStripe({
  className,
  compact = false,
  result,
}: {
  className?: string;
  /** The shorter stripe of the standings column. */
  compact?: boolean;
  result: RowResult;
}) {
  const tone = stripeTone(result);
  if (tone === null) return null;
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-block w-1 shrink-0 rounded-xs',
        compact ? 'h-4.5' : 'h-5.5',
        TONE_CLASSES[tone],
        className,
      )}
    />
  );
}
