import { useEffect, useMemo, useState } from 'react';
import { PageHeading, cn } from '../../components/ui';
import { bracketLogicOf } from '../../domain/tournament/app-written-bracket';
import { ColumnTitleBar } from '../tournament/components/ColumnTitleBar';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { scheduledParts, tournamentFormatLine, type ScheduledParts } from '../tournaments/tournament-info';
import { RulesText } from './RulesText';
import { BracketIllustration } from './BracketIllustration';
import { SchedulePreviewWindow } from './SchedulePreviewWindow';
import { schedulePictureModel } from './schedule-picture-model';
import type { SchedulePictureModel } from './schedule-picture-types';
import { ScreenshotGallery } from './ScreenshotGallery';

const GENERAL_RULES_URL = 'https://info.curvefever.pro/tournaments/tournament-rules';

/** The scheduled time in the time zone of the viewer; empty until the page is in the browser, where that zone is known. */
function useScheduledParts(scheduledAt: number | null): ScheduledParts | null {
  const [parts, setParts] = useState<ScheduledParts | null>(null);
  useEffect(() => {
    if (scheduledAt === null) return;
    const refresh = () => setParts(scheduledParts(scheduledAt, Date.now()));
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [scheduledAt]);
  return scheduledAt === null ? null : parts;
}

/**
 * Leaves the loaded tournament. Only here: a player could read "Exit tournament" as unregistering. Next to the
 * heading on a desktop, at the end of the page on a phone: the page renders two, one hidden by CSS at each width.
 */
function ExitTournamentButton({ className, onExit }: { className?: string; onExit: () => void }) {
  return (
    <button
      className={cn(
        'flex h-10 cursor-pointer items-center gap-2 rounded border border-input-border px-3.5 text-sm font-bold whitespace-nowrap text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
      onClick={onExit}
    >
      <span aria-hidden='true' className='text-[15px]'>
        ✕
      </span>
      Exit tournament view
    </button>
  );
}

const CARD = 'rounded-xs bg-cfp-game-card outline-2 outline-cfp-game-frame';
const CARD_LABEL = 'text-xs font-extrabold tracking-[0.08em] text-muted uppercase';

/** When it starts, in the viewer's own time zone, named after the time ("Date to be announced" without a date). */
function WhenCard({ scheduledAt }: { scheduledAt: number | null }) {
  const parts = useScheduledParts(scheduledAt);
  return (
    <div className={`${CARD} flex flex-1 basis-80 flex-col gap-1.5 px-5 py-4.5`}>
      <div className={CARD_LABEL}>When</div>
      <div className='text-[26px] leading-[1.1] font-extrabold' suppressHydrationWarning>
        {scheduledAt === null ? 'Date to be announced' : (parts?.date ?? ' ')}
      </div>
      {parts?.relative ? <div className='text-base font-bold text-cfp-sky'>{parts.relative}</div> : null}
    </div>
  );
}

/** The format line, in a card of its own while there is no schedule to preview. */
function PlainFormatCard({ line }: { line: string }) {
  return (
    <div className={`${CARD} flex flex-1 basis-80 flex-col gap-1.5 px-5 py-4.5`}>
      <div className={CARD_LABEL}>Format</div>
      <div className='text-[22px] leading-tight font-extrabold'>{line}</div>
    </div>
  );
}

/**
 * The format line, and once the schedule has rounds the whole card is the way to the schedule picture: a link line
 * and a generic bracket drawing (to the right of the text, under the format line on a phone) open it in a window.
 */
function FormatCard({ line, schedule }: { line: string; schedule: SchedulePictureModel | null }) {
  const [open, setOpen] = useState(false);
  if (!schedule) return <PlainFormatCard line={line} />;
  return (
    <>
      <button
        className={cn(
          CARD,
          'grid flex-1 basis-80 cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-5 py-4.5 text-left hover:outline-cfp-brand focus-visible:outline-cfp-brand max-[700px]:grid-cols-1 max-[700px]:items-start',
        )}
        onClick={() => setOpen(true)}
        type='button'
      >
        <span className={`${CARD_LABEL} col-start-1`}>Format</span>
        <span className='col-start-1 text-[22px] leading-tight font-extrabold'>{line}</span>
        <BracketIllustration className='col-start-2 row-span-3 row-start-1 max-[700px]:col-start-1 max-[700px]:row-span-1 max-[700px]:row-start-auto max-[700px]:my-1' />
        <span className='col-start-1 text-base font-bold text-cfp-sky'>Preview the whole schedule →</span>
      </button>
      {open ? <SchedulePreviewWindow model={schedule} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The Info tab: what a visitor needs to know before and during the tournament. */
export function InfoView() {
  const { exitTournament, state, tournaments } = useTournamentApp();
  const summary = tournaments.summaries.find((entry) => entry.id === state.tournamentId);
  const scheduledAt = state.info?.scheduledAt ?? null;
  const format = summary ?? {
    gameFormat: state.gameFormat,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    scheduleLogic: bracketLogicOf(state),
  };
  const title = useTournamentTitle();
  const formatLine = tournamentFormatLine(format);
  const schedule = useMemo(
    () => schedulePictureModel(state, { title, formatLine }),
    [state, title, formatLine],
  );
  const rulesText = state.info?.rulesText.trim() ?? '';
  const imageIds = state.info?.screenshots ?? [];
  return (
    <div className='mx-auto flex max-w-270 flex-col gap-6'>
      <PageHeading
        actions={<ExitTournamentButton className='max-[700px]:hidden' onExit={() => void exitTournament()} />}
        className='mb-0'
        label='Info'
        title={title}
      />
      <section aria-label='When and what' className='flex flex-wrap gap-3.5'>
        <WhenCard scheduledAt={scheduledAt} />
        <FormatCard line={formatLine} schedule={schedule} />
      </section>
      {state.tournamentId && imageIds.length ? (
        <section className='flex flex-col gap-3'>
          <ColumnTitleBar title='Information' />
          <ScreenshotGallery tournamentId={state.tournamentId} imageIds={imageIds} />
        </section>
      ) : null}
      {rulesText ? (
        <section className='flex flex-col gap-3'>
          <ColumnTitleBar title='Rules' />
          <div className={`${CARD} max-w-205 px-6 py-5`}>
            <RulesText className='gap-3.5 text-[17px] leading-relaxed' text={rulesText} />
          </div>
        </section>
      ) : null}
      <a
        className='flex w-fit items-center text-base font-bold text-cfp-sky hover:underline max-[700px]:min-h-11'
        href={GENERAL_RULES_URL}
        rel='noopener noreferrer'
        target='_blank'
      >
        General tournament rules →
      </a>
      <ExitTournamentButton
        className='self-start max-[700px]:h-11 min-[701px]:hidden'
        onExit={() => void exitTournament()}
      />
    </div>
  );
}
