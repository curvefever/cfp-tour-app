import { advancementEditScope } from '../../../domain/tournament/live-advancement-edit';
import { lineupEditScope } from '../../../domain/tournament/lineup-edit';
import type { TournamentState } from '../../../domain/tournament/types';
import { Alert } from '../../../components/ui';
import { ProgressSubsection } from '../ProgressSubsection';
import type { ProgressSummary } from '../progress-summary';
import { AdvancementSection } from './AdvancementSection';
import { LineupSection } from './LineupSection';
import { RoomsOverview } from './RoomsOverview';

/**
 * The Admin tab's mid-tournament corrections: the current round's rooms at a glance, then its line-up and
 * the advancement counts. Shown only while at least one of the two is in scope; each section decides for
 * itself what to show.
 */
export function CorrectCurrentRoundPanel({
  state,
  summary,
}: {
  state: TournamentState;
  summary: ProgressSummary;
}) {
  const lineup = lineupEditScope(state);
  const advancement = advancementEditScope(state);
  if (!lineup.ok && advancement.kind === 'none') return null;
  return (
    <ProgressSubsection
      hint='Line-up and advancement'
      title={`CORRECT CURRENT ROUND · ${summary.roundName.toUpperCase()}`}
    >
      <Alert className='flex items-center gap-2.5' tone='warning'>
        <svg aria-hidden='true' className='shrink-0' height='16' viewBox='0 0 16 16' width='16'>
          <path
            d='M8 1.5 L15 14 H1 Z'
            fill='none'
            stroke='currentColor'
            strokeLinejoin='round'
            strokeWidth='1.5'
          />
          <path d='M8 6 V9.5' stroke='currentColor' strokeLinecap='round' strokeWidth='1.5' />
          <circle cx='8' cy='11.8' fill='currentColor' r='0.9' />
        </svg>
        <span>Changes apply immediately for everyone watching.</span>
      </Alert>
      <RoomsOverview rooms={summary.rooms} />
      <div className='flex flex-col gap-3.5'>
        <LineupSection state={state} />
        <AdvancementSection state={state} />
      </div>
    </ProgressSubsection>
  );
}
