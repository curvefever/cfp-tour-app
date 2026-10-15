import { useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { TournamentSettingsRecap } from './RunningAdminStatus';
import { ProgressSection } from './ProgressSection';
import { RunningInfoPanel } from './RunningInfoPanel';

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
    <div className='flex flex-col gap-5' id='panel-running'>
      <TournamentSettingsRecap state={state} />
      <ProgressSection state={state} />
      <RunningInfoPanel />
      {resetError ? <Alert tone='danger'>{resetError}</Alert> : null}
      {app.readOnly ? null : (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2.5 pt-0.5'>
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
            variant='danger'
          >
            {resetting ? 'Resetting…' : 'Back to draft'}
          </Button>
          <div className='text-sm text-muted'>Keeps the roster and settings, clears the played rounds.</div>
        </div>
      )}
    </div>
  );
}
