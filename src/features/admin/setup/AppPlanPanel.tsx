import { useState } from 'react';
import { Alert, Input, SectionPanel, cn } from '../../../components/ui';
import { bracketLogicOf } from '../../../domain/tournament/app-written-bracket';
import { unitLabelPluralLower } from '../../../domain/tournament/formats';
import type { GenerationForm } from '../../../domain/tournament/generation-plan-types';
import type { SchedulePreview } from '../../../domain/tournament/schedule-preview';
import { formDiffersFromSettings } from '../../../domain/tournament/tournament-settings';
import type { TournamentState } from '../../../domain/tournament/types';
import { SchedulePreviewWindow } from '../../info/SchedulePreviewWindow';
import { schedulePictureModel } from '../../info/schedule-picture-model';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { useTournamentTitle } from '../../tournament/useTournamentTitle';
import { tournamentFormatLine } from '../../tournaments/tournament-info';
import { ConfirmStartBar } from './ConfirmStartBar';
import { planDecisions, type PlanDecision } from './plan-decisions';
import { schedulePreviewRows, type SchedulePreviewRow } from './schedule-preview-rows';
import { MAX_TYPED_COUNT, useAppPlan } from './useAppPlan';

const NOTHING_TO_PLAN = 'Type a head count, or load the roster, to see the plan.';
const STALE_SCHEDULE =
  'The generated schedule uses the earlier settings: Generate again before Confirm & Start.';

const SOURCE_TAGS: Record<PlanDecision['source'], string> = {
  app: 'border-cfp-brand text-cfp-sky',
  typed: 'border-cfp-yellow bg-cfp-yellow text-cfp-brand-ink',
};

function HeadCountRow({
  unit,
  typed,
  rosterCount,
  isRoster,
  onChange,
}: {
  unit: string;
  typed: string | null;
  rosterCount: number | null;
  /** The plan is for the loaded roster's count. */
  isRoster: boolean;
  onChange: (typed: string | null) => void;
}) {
  return (
    <div className='flex items-center gap-2 border-b border-cfp-mid-row-line px-4.5 py-3 text-sm'>
      <label htmlFor='app-plan-count'>For</label>
      <Input
        aria-label={`Number of ${unit} the plan is for`}
        className='w-22'
        id='app-plan-count'
        min='1'
        // An emptied field shows the roster's number again once it is left.
        onBlur={() => (typed === '' ? onChange(null) : undefined)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={rosterCount === null ? '' : String(rosterCount)}
        type='number'
        value={typed ?? rosterCount ?? ''}
      />
      <span>{unit}</span>
      {isRoster ? <span className='text-muted'>(the roster)</span> : null}
    </div>
  );
}

function DecisionList({ lines }: { lines: PlanDecision[] }) {
  return (
    <ul aria-label="The plan's numbers" className='border-b border-cfp-mid-row-line py-2'>
      {lines.map((line) => (
        <li className='flex items-start justify-between gap-2.5 px-4.5 py-1 text-sm' key={line.label}>
          <span className='min-w-0'>
            <span className='text-muted'>{line.label}: </span>
            <span className='font-bold'>{line.text}</span>
          </span>
          <span className={cn('rounded border px-1.5 text-xs font-bold', SOURCE_TAGS[line.source])}>
            {line.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RoundRows({ rows }: { rows: SchedulePreviewRow[] }) {
  return (
    <ul aria-label="The plan's rounds" className='py-2'>
      {rows.map((row, index) => (
        <li className='flex flex-col gap-0.5 border-b border-cfp-mid-row-line px-4.5 py-2.25' key={index}>
          <div className='flex items-baseline justify-between gap-2.5'>
            <span className='text-sm font-bold'>{row.name}</span>
            <span className='text-[13px] text-muted'>{row.meta}</span>
          </div>
          {row.detail ? <div className='text-[13px] text-cfp-text-soft'>{row.detail}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** The link that opens the schedule picture of the previewed schedule, in the window the Info tab uses. */
function SchedulePictureLink({ schedule }: { schedule: TournamentState }) {
  const [open, setOpen] = useState(false);
  const title = useTournamentTitle();
  const formatLine = tournamentFormatLine({
    gameFormat: schedule.gameFormat,
    poolingPhase: schedule.cfg.poolingPhase ?? 'none',
    scheduleLogic: bracketLogicOf(schedule),
  });
  const model = open ? schedulePictureModel(schedule, { title, formatLine }) : null;
  return (
    <>
      <button
        className='w-fit cursor-pointer text-sm font-bold text-cfp-sky hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[700px]:min-h-11'
        onClick={() => setOpen(true)}
        type='button'
      >
        Schedule picture →
      </button>
      {model ? <SchedulePreviewWindow model={model} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The plan's numbers and rounds, or generation's refusal in their place. */
function PlanBody({ form, preview }: { form: GenerationForm; preview: SchedulePreview }) {
  if (preview.status === 'invalid') {
    return (
      <Alert className='m-4.5' id='app-plan-refusal' tone='warning'>
        {preview.message}
      </Alert>
    );
  }
  const unit = unitLabelPluralLower(form.gameFormat);
  return (
    <>
      <DecisionList lines={planDecisions(form, preview)} />
      <RoundRows rows={schedulePreviewRows(preview.state, unit)} />
      <div className='flex flex-col items-start gap-2 px-4.5 pt-1 pb-4'>
        <p className='text-[13px] leading-normal text-muted'>
          Room sizes, advancement and lucky losers are worked out for {preview.plan.unitCount} {unit}.
        </p>
        <SchedulePictureLink schedule={preview.state} />
      </div>
    </>
  );
}

/**
 * THE APP'S PLAN: what the Setup form comes to for a head count, before and after Generate, each number the app's or
 * typed. Under it, once a schedule is generated, the (on a desktop) Confirm & Start button. Nothing once started.
 */
export function AppPlanPanel({ lbQualifiers }: { lbQualifiers: string }) {
  const { state } = useTournamentApp();
  const [typed, setTyped] = useState<string | null>(null);
  const { form, rosterCount, count, tooMany, preview } = useAppPlan(typed, lbQualifiers);
  if (state.started) return null;
  const stale = state.rounds.length > 0 && formDiffersFromSettings(state.settings, form);
  return (
    <div className='flex flex-col gap-3.5' id='preview-wrap'>
      <SectionPanel padded={false} title="THE APP'S PLAN">
        <HeadCountRow
          isRoster={rosterCount !== null && count === rosterCount}
          onChange={setTyped}
          rosterCount={rosterCount}
          typed={typed}
          unit={unitLabelPluralLower(form.gameFormat)}
        />
        {stale ? (
          <Alert className='mx-4.5 mt-3' id='app-plan-stale' tone='warning'>
            {STALE_SCHEDULE}
          </Alert>
        ) : null}
        {count === null ? <p className='px-4.5 py-4 text-sm text-muted'>{NOTHING_TO_PLAN}</p> : null}
        {tooMany ? (
          <p className='px-4.5 py-4 text-sm text-muted'>
            Type up to {MAX_TYPED_COUNT} {unitLabelPluralLower(form.gameFormat)} to see the plan.
          </p>
        ) : null}
        {preview ? <PlanBody form={form} preview={preview} /> : null}
      </SectionPanel>
      <ConfirmStartBar />
    </div>
  );
}
