import { Alert } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

/** One line under the heading while live sync is not working; nothing while it is active. */
export function SyncStatusLine() {
  const { syncStatus } = useTournamentApp();
  switch (syncStatus.kind) {
    case 'active':
      return null;
    case 'unavailable':
      return (
        <Alert tone='danger'>
          Live sync is unavailable (the sync service could not be reached). Viewers need to refresh manually.
        </Alert>
      );
    case 'error':
      return (
        <Alert tone='danger'>Sync error: viewers may be seeing stale data ({syncStatus.message}).</Alert>
      );
    default:
      return <Alert tone='info'>Connecting to live sync…</Alert>;
  }
}
