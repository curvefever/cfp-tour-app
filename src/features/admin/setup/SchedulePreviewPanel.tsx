import { useState } from 'react';
import { unitLabelPluralLower } from '../../../domain/tournament/formats';
import { scheduleMatchesRoster } from '../../../domain/tournament/pre-start-roster';
import { Alert, Button, SectionPanel } from '../../../components/ui';
import { transitionRefusal } from '../../tournaments/tournament-lifecycle';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { schedulePreviewRows } from './schedule-preview-rows';

const STALE_DRAW =
  'The roster changed since the schedule was generated — click Generate again before starting.';

/** The generated rounds, and the Confirm & Start button; nothing before a schedule is generated or once started. */
export function SchedulePreviewPanel() {
  const { state, setup, startTournamentNow } = useTournamentApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const unit = unitLabelPluralLower(setup.gameFormat);

  async function confirmAndStart() {
    setStartError('');
    setStarting(true);
    const message = await startTournamentNow();
    setStarting(false);
    if (message) setStartError(message);
  }

  const startRefusal =
    transitionRefusal('start', {
      status: state.lifecycle?.status ?? 'draft',
      started: false,
      testRun: state.lifecycle?.testRun ?? false,
      title: state.title,
      scheduledAt: state.info?.scheduledAt ?? null,
    }) ?? (scheduleMatchesRoster(state) ? null : STALE_DRAW);

  if (!state.rounds.length || state.started) return null;
  return (
    <div className='flex flex-col gap-3.5' id='preview-wrap'>
      <SectionPanel padded={false} title='SCHEDULE PREVIEW'>
        <ul className='py-2'>
          {schedulePreviewRows(state, unit).map((row, index) => (
            <li className='flex flex-col gap-0.5 border-b border-cfp-mid-row-line px-4.5 py-2.25' key={index}>
              <div className='flex items-baseline justify-between gap-2.5'>
                <span className='text-sm font-bold'>{row.name}</span>
                <span className='text-[13px] text-muted'>{row.meta}</span>
              </div>
              {row.detail ? <div className='text-[13px] text-cfp-text-soft'>{row.detail}</div> : null}
            </li>
          ))}
        </ul>
        <p className='px-4.5 pt-1 pb-4 text-[13px] leading-normal text-muted'>
          Room sizes, advancement and lucky losers are worked out for{' '}
          {state.confirmedCount ?? state.players.length} {unit}.
        </p>
      </SectionPanel>
      {startRefusal ? <p className='text-xs text-muted'>{startRefusal}</p> : null}
      {startError ? <Alert tone='danger'>{startError}</Alert> : null}
      <Button
        className='h-12 w-full text-base font-extrabold'
        variant='primary'
        disabled={Boolean(startRefusal) || starting}
        onClick={() => void confirmAndStart()}
      >
        {starting ? 'Starting…' : 'Confirm & Start'}
      </Button>
    </div>
  );
}
