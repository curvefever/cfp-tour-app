import { useState } from 'react';
import { Alert, Button, ButtonRow, Field, Input, Panel, PanelTitle } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { TournamentSettingsRecap } from './RunningAdminStatus';
import { InfoContentPanel } from './InfoContentPanel';
import { ProgressSection } from './ProgressSection';
import { ScheduledTimeField } from './ScheduledTimeField';

export function RunningAdmin() {
  const app = useTournamentApp();
  const state = app.state;
  const round = state.rounds[state.curRound];
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  if (!round) return <Alert tone='danger'>The saved tournament has no current round.</Alert>;

  async function backToDraftNow() {
    setResetError('');
    setResetting(true);
    const message = await app.backToDraft();
    setResetting(false);
    if (message) setResetError(message);
  }
  return (
    <div className='flex flex-col gap-5 [&>*]:mb-0' id='panel-running'>
      <Panel className='pb-1.5'>
        <PanelTitle>Tournament running</PanelTitle>
        <Field htmlFor='running-title' label='Tournament name'>
          <Input
            id='running-title'
            type='text'
            value={state.title}
            placeholder='Unnamed Tournament'
            disabled={app.readOnly}
            onChange={(event) => app.updateState((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <ScheduledTimeField id='running-scheduled-at' />
      </Panel>
      <InfoContentPanel />
      <TournamentSettingsRecap state={state} />
      <ProgressSection state={state} />
      {resetError ? <Alert tone='danger'>{resetError}</Alert> : null}
      {app.readOnly ? null : (
        <ButtonRow className='rounded-lg border border-surface-hover p-2.5'>
          <Button
            disabled={resetting}
            onClick={() => {
              if (
                window.confirm(
                  'Send this tournament back to draft? Its players and settings stay; every score and round played is cleared.',
                )
              )
                void backToDraftNow();
            }}
          >
            {resetting ? 'Resetting…' : '↩ Back to draft'}
          </Button>
        </ButtonRow>
      )}
    </div>
  );
}
