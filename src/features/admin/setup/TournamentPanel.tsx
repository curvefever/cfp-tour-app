import { Input, SectionPanel } from '../../../components/ui';
import type { RoundNotes, TournamentSettings } from '../../../domain/tournament/types';
import { PresenceField } from '../../presence/PresenceField';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { CopySettings } from '../copy-settings/CopySettingsPanel';
import { ScheduledTimeField } from '../ScheduledTimeField';
import { usePublishMissing } from '../usePublishMissing';

/** The tournament's name and scheduled time, and the way to copy the settings of a past tournament. */
export function TournamentPanel({
  onApplyCopiedSettings,
}: {
  onApplyCopiedSettings: (
    settings: TournamentSettings,
    sourceTitle: string,
    rulesText: string,
    roundNotes: RoundNotes | undefined,
  ) => string;
}) {
  const { state, updateState } = useTournamentApp();
  const publishMissing = usePublishMissing();
  return (
    <SectionPanel title='TOURNAMENT'>
      <PresenceField className='mb-0' htmlFor='cfg-title' label='Name'>
        <Input
          aria-invalid={publishMissing.includes('title') || undefined}
          id='cfg-title'
          type='text'
          placeholder='Unnamed Tournament — click to name'
          value={state.title}
          onChange={(event) => updateState({ ...state, title: event.target.value })}
        />
      </PresenceField>
      <ScheduledTimeField id='cfg-scheduled-at' />
      <CopySettings onApply={onApplyCopiedSettings} />
    </SectionPanel>
  );
}
