import { Input, Panel, PanelTitle } from '../../../components/ui';
import { PresenceField } from '../../presence/PresenceField';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { ScheduledTimeField } from '../ScheduledTimeField';
import { usePublishMissing } from '../usePublishMissing';

/** The tournament's name and scheduled time. */
export function TournamentPanel() {
  const { state, updateState } = useTournamentApp();
  const publishMissing = usePublishMissing();
  return (
    <Panel>
      <PanelTitle>Tournament Name</PanelTitle>
      <PresenceField htmlFor='cfg-title' label='Tournament name'>
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
    </Panel>
  );
}
