import { Fragment } from 'react';
import {
  waterfallColumnGroups,
  waterfallQualCounts,
  type WaterfallColumnGroup,
  type WaterfallDraft,
  type WaterfallIntake,
} from '../../../domain/tournament/waterfall-draft';
import { QUAL_LABEL } from '../../../domain/tournament/waterfall-bracket';
import { cn } from '../../../components/ui/cn';
import { destinationColor, QUAL_DISPLAY_NAME, roundIntakeBadge } from './waterfall-format';

const badgeClass = {
  ok: 'bg-success-soft text-success',
  bad: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-hover text-muted',
};

const columnHeadingClass = 'mt-1 text-[0.68rem] font-semibold tracking-[0.12em] text-muted uppercase';

export function WaterfallRoundList({
  draft,
  intake,
  entrantCount,
  selected,
  onSelect,
  lockedRounds,
  currentRoundLabels,
  showColumns = true,
}: {
  draft: WaterfallDraft;
  intake: WaterfallIntake;
  entrantCount: number | null;
  selected: string;
  onSelect: (label: string) => void;
  lockedRounds?: ReadonlySet<string>;
  /** The rounds being played now (every round of the current column). */
  currentRoundLabels?: ReadonlySet<string>;
  /** Group the rounds under their column; false (or columns that can't be worked out) lists them in play order. */
  showColumns?: boolean;
}) {
  const groups: WaterfallColumnGroup[] = (showColumns ? waterfallColumnGroups(draft) : null) ?? [
    { column: 0, labels: intake.order },
  ];
  const renderRound = (label: string) => {
    const round = draft.rounds.find((candidate) => candidate.label === label);
    if (!round) return null;
    const badge = roundIntakeBadge(round, intake, entrantCount);
    const isCurrent = currentRoundLabels?.has(label) ?? false;
    const isLocked = lockedRounds?.has(label) && !isCurrent;
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
        {round.column === null ? null : (
          <span className='w-fit rounded-full bg-surface-hover px-2 text-[0.68rem] font-semibold text-muted'>
            set
          </span>
        )}
        {isCurrent || isLocked ? (
          <span className='text-[0.68rem] font-semibold tracking-wide text-muted uppercase'>
            {isCurrent ? 'current' : 'played'}
          </span>
        ) : null}
      </button>
    );
  };
  return (
    <div className='flex flex-row flex-wrap gap-1.5 min-[901px]:flex-col'>
      {draft.qualRoutes ? (
        <button
          aria-pressed={selected === QUAL_LABEL}
          className={cn(
            'flex cursor-pointer flex-col gap-0.5 rounded-lg border-2 bg-surface-low px-3 py-2 text-left transition hover:bg-surface-hover',
            selected === QUAL_LABEL ? 'border-primary' : 'border-transparent',
          )}
          onClick={() => onSelect(QUAL_LABEL)}
          type='button'
        >
          <span className='flex items-center justify-between gap-2 font-semibold'>
            <span>{QUAL_DISPLAY_NAME}</span>
          </span>
          <span className='text-xs text-muted'>
            {waterfallQualCounts(draft.qualRoutes, entrantCount).sentOn} sent on
          </span>
        </button>
      ) : null}
      {groups.map((group) => (
        <Fragment key={group.column}>
          {showColumns && group.column > 0 ? (
            <div className={columnHeadingClass}>Column {group.column}</div>
          ) : null}
          {group.labels.map(renderRound)}
        </Fragment>
      ))}
    </div>
  );
}
