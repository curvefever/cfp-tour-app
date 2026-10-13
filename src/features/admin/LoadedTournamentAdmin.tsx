import { Alert, Button, ButtonRow } from '../../components/ui';
import { PresenceProvider } from '../presence/PresenceProvider';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { RunningAdmin } from './RunningAdmin';
import { SetupView } from './SetupView';
import { TournamentStatusPanel } from './TournamentStatusPanel';

/** The Admin tab for the loaded tournament: its Setup or running controls, once its stored state has arrived. */
export function LoadedTournamentAdmin() {
  const app = useTournamentApp();
  const kind = app.syncStatus.kind;
  return (
    <>
      <ButtonRow>
        <Button size='sm' onClick={() => void app.unloadTournament()}>
          ← All tournaments
        </Button>
      </ButtonRow>
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
