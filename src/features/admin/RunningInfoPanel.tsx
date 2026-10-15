import { Input, SectionPanel } from '../../components/ui';
import { PresenceField } from '../presence/PresenceField';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { RulesTextField, ScreenshotsControl } from './InfoContentPanel';
import { ScheduledTimeField } from './ScheduledTimeField';

/** What visitors read on the Info tab, kept editable while the tournament runs: its name and time, the rules and the screenshots. */
export function RunningInfoPanel() {
  const { state, updateState, readOnly } = useTournamentApp();
  return (
    <SectionPanel
      hint='Shown on the Info tab · editable while the tournament runs'
      large
      padded={false}
      title='Info for visitors'
    >
      <div className='flex flex-col gap-5 px-5 py-4.5'>
        <div className='grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-4 gap-y-4'>
          <PresenceField className='mb-0' htmlFor='cfg-title' label='Name'>
            <Input
              disabled={readOnly}
              id='cfg-title'
              onChange={(event) => updateState((current) => ({ ...current, title: event.target.value }))}
              placeholder='Unnamed Tournament'
              type='text'
              value={state.title}
            />
          </PresenceField>
          <ScheduledTimeField id='running-scheduled-at' />
        </div>
        <div className='flex flex-wrap gap-5'>
          <div className='min-w-0 flex-[1_1_420px]'>
            <RulesTextField />
          </div>
          <div className='min-w-0 flex-[0_1_330px]'>
            <ScreenshotsControl />
          </div>
        </div>
      </div>
    </SectionPanel>
  );
}
