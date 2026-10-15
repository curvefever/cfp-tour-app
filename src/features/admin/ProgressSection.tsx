import { cn, SectionPanel } from '../../components/ui';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { CorrectCurrentRoundPanel } from './live-corrections/CorrectCurrentRoundPanel';
import { progressSummary, type StageState } from './progress-summary';
import { RunningWaterfallPanel } from './waterfall/RunningWaterfallPanel';

const STAGE_DOT: Record<StageState, string> = {
  done: 'bg-success',
  now: 'bg-primary',
  upcoming: 'border-2 border-cfp-mid-stage-dot',
};

const STAGE_TEXT: Record<StageState, { label: string; className: string }> = {
  done: { label: 'Done', className: 'text-muted' },
  now: { label: 'Now', className: 'font-semibold text-cfp-sky' },
  upcoming: { label: 'Upcoming', className: 'text-muted' },
};

/** How far the current round is scored, as a bar and a line of text. */
function RoundProgress({ fraction, text }: { fraction: number; text: string }) {
  return (
    <div className='flex min-w-0 flex-[1_1_300px] flex-wrap items-center gap-x-4.5 gap-y-2'>
      <div
        aria-hidden='true'
        className='h-2 max-w-90 min-w-40 flex-[1_1_200px] overflow-hidden rounded bg-input'
      >
        <div className='h-2 bg-primary' style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <div className='text-sm text-cfp-text-soft'>{text}</div>
    </div>
  );
}

/** The running Admin's progress: every round and its state, then the corrections and the waterfall graph. */
export function ProgressSection({ state }: { state: TournamentState }) {
  const { readOnly } = useTournamentApp();
  const summary = progressSummary(state);
  return (
    <SectionPanel
      actions={<RoundProgress fraction={summary.fraction} text={summary.text} />}
      large
      padded={false}
      title='Tournament progress'
    >
      <ul className='px-5 py-1.5'>
        {summary.stages.map((stage, index) => (
          <li
            className='flex items-center gap-3.5 border-b border-cfp-mid-row-line py-2.75 last:border-b-0'
            key={index}
          >
            <span
              aria-hidden='true'
              className={cn('size-2.5 shrink-0 rounded-full', STAGE_DOT[stage.state])}
            />
            <span className='w-35 shrink-0 text-[15px] font-bold'>{stage.name}</span>
            <span className={cn('text-sm', STAGE_TEXT[stage.state].className)}>
              {STAGE_TEXT[stage.state].label}
            </span>
          </li>
        ))}
      </ul>
      {readOnly ? null : <CorrectCurrentRoundPanel state={state} summary={summary} />}
      {readOnly || !state.rounds.some((round) => round.isWaterfall) ? null : (
        <RunningWaterfallPanel state={state} />
      )}
    </SectionPanel>
  );
}
