import { unitLabelPluralLower } from '../../../domain/tournament/formats';
import { SectionPanel } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { ConfirmStartBar } from './ConfirmStartBar';
import { schedulePreviewRows } from './schedule-preview-rows';

/** The generated rounds, and (on a desktop) the Confirm & Start button; nothing before a schedule is generated or once started. */
export function SchedulePreviewPanel() {
  const { state, setup } = useTournamentApp();
  const unit = unitLabelPluralLower(setup.gameFormat);

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
      <ConfirmStartBar />
    </div>
  );
}
