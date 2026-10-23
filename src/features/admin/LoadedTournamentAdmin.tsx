import { Alert, PageHeading } from '../../components/ui';
import { PresenceProvider } from '../presence/PresenceProvider';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { CopyViewerLink } from './CopyViewerLink';
import { RunningAdmin } from './RunningAdmin';
import { SetupView } from './SetupView';
import { SyncStatusLine } from './SyncStatusLine';
import { TournamentStatusPanel } from './TournamentStatusPanel';

/** The Admin tab for the loaded tournament: its Setup or running controls, once its stored state has arrived. */
export function LoadedTournamentAdmin() {
  const app = useTournamentApp();
  const kind = app.syncStatus.kind;
  const title = useTournamentTitle();
  return (
    <div className='mx-auto flex max-w-295 flex-col gap-5'>
      <button
        className='w-fit cursor-pointer text-[15px] font-bold text-cfp-sky hover:underline max-[700px]:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        onClick={() => void app.unloadTournament()}
      >
        ← All tournaments
      </button>
      <PageHeading
        actions={app.state.started ? <CopyViewerLink className='max-[700px]:hidden' /> : undefined}
        className='mb-0 items-end'
        label={app.state.started ? 'Admin' : 'Setup'}
        title={title}
      />
      {kind === 'connecting' ? <Alert tone='info'>Loading the tournament…</Alert> : null}
      {kind === 'waiting' ? <Alert tone='danger'>This tournament does not exist (any more).</Alert> : null}
      {kind === 'unavailable' ? (
        <Alert tone='danger'>
          Live sync is unavailable, so the tournament cannot be loaded. Reload the page.
        </Alert>
      ) : null}
      {kind === 'connecting' || kind === 'waiting' || kind === 'unavailable' ? null : (
        <PresenceProvider tournamentId={app.state.tournamentId ?? ''}>
          <div className='flex flex-col gap-5'>
            {app.state.started ? <SyncStatusLine /> : null}
            <TournamentStatusPanel />
            {app.state.started ? <CopyViewerLink className='min-[701px]:hidden max-[700px]:w-full' /> : null}
            {app.state.started ? <RunningAdmin /> : <SetupView />}
          </div>
        </PresenceProvider>
      )}
    </div>
  );
}
