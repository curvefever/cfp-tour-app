import { Alert, Button, ButtonRow, PageHeading } from '../../components/ui';
import { PresenceProvider } from '../presence/PresenceProvider';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { RunningAdmin } from './RunningAdmin';
import { SetupView } from './SetupView';
import { TournamentStatusPanel } from './TournamentStatusPanel';

/** The Admin tab for the loaded tournament: its Setup or running controls, once its stored state has arrived. */
export function LoadedTournamentAdmin() {
  const app = useTournamentApp();
  const kind = app.syncStatus.kind;
  const title = useTournamentTitle();
  return (
    <>
      <ButtonRow>
        <Button size='sm' onClick={() => void app.unloadTournament()}>
          ← All tournaments
        </Button>
      </ButtonRow>
      <PageHeading label={app.state.started ? 'Admin' : 'Setup'} title={title} />
      {kind === 'connecting' ? <Alert tone='info'>Loading the tournament…</Alert> : null}
      {kind === 'waiting' ? <Alert tone='danger'>This tournament does not exist (any more).</Alert> : null}
      {kind === 'unavailable' ? (
        <Alert tone='danger'>
          Live sync is unavailable, so the tournament cannot be loaded. Reload the page.
        </Alert>
      ) : null}
      {kind === 'connecting' || kind === 'waiting' || kind === 'unavailable' ? null : (
        <PresenceProvider tournamentId={app.state.tournamentId ?? ''}>
          <TournamentStatusPanel />
          {app.state.started ? <RunningAdmin /> : <SetupView />}
        </PresenceProvider>
      )}
    </>
  );
}
