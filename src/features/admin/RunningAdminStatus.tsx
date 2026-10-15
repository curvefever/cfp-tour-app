import type { TournamentState } from '../../domain/tournament/types';
import { SectionPanel } from '../../components/ui';
import { panelLabelClassName } from '../../components/ui/typography';
import { settingsRecapGroups } from './settings-recap';

/** The settings a running tournament was generated with: only the ones that apply to its format, in groups. */
export function TournamentSettingsRecap({ state }: { state: TournamentState }) {
  return (
    <SectionPanel
      hint='Fixed since the start · only the settings that apply to this format are listed'
      large
      padded={false}
      title='Settings'
    >
      <div className='grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-8 gap-y-1 px-5 pt-2 pb-5'>
        {settingsRecapGroups(state).map((group) => (
          <div className='flex flex-col pt-3.5' key={group.title}>
            <h3 className={`${panelLabelClassName} mb-1.5`}>{group.title}</h3>
            {group.items.map((item) => (
              <div
                className='flex gap-4 border-b border-cfp-mid-row-line py-2.25 text-sm last:border-b-0'
                key={item.label}
              >
                <div className='w-35 shrink-0 text-muted'>{item.label}</div>
                <div className='min-w-0 flex-1 font-semibold'>{item.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
