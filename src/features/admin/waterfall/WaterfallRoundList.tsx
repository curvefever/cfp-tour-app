import type { WaterfallDraft, WaterfallIntake } from '../../../domain/tournament/waterfall-draft';
import { cn } from '../../../components/ui/cn';
import { destinationColor, roundIntakeBadge } from './waterfall-format';

const badgeClass = {
  ok: 'bg-success-soft text-success',
  bad: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-hover text-muted',
};

export function WaterfallRoundList({
  draft,
  intake,
  entrantCount,
  selected,
  onSelect,
}: {
  draft: WaterfallDraft;
  intake: WaterfallIntake;
  entrantCount: number | null;
  selected: string;
  onSelect: (label: string) => void;
}) {
  return (
    <div className='flex flex-row flex-wrap gap-1.5 min-[901px]:flex-col'>
      {intake.order.map((label) => {
        const round = draft.rounds.find((candidate) => candidate.label === label);
        if (!round) return null;
        const badge = roundIntakeBadge(round, intake, entrantCount);
        return (
          <button
            aria-pressed={label === selected}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 rounded-lg border-2 bg-surface-low px-3 py-2 text-left transition hover:bg-surface-hover',
              label === selected ? 'border-primary' : 'border-transparent',
            )}
            key={label}
            onClick={() => onSelect(label)}
            type='button'
          >
            <span className='flex items-center justify-between gap-2 font-semibold'>
              <span style={{ color: destinationColor(draft, label) }}>{label}</span>
              <span className={cn('rounded-full px-2 text-[0.7rem] tabular-nums', badgeClass[badge.state])}>
                {badge.text}
              </span>
            </span>
            <span className='text-xs text-muted'>
              {round.roomCount} × {round.roomSize}
              {round.isFinal ? ' · Final' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
