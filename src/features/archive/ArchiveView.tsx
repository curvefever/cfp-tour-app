import { useEffect, useState } from 'react';
import { archiveBundle, loadArchiveIndex } from '../../lib/persistence/archive';
import { unitLabelPluralLower } from '../../domain/tournament/formats';
import { downloadJson } from '../../lib/browser-download';
import { Alert, Button } from '../../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { ArchiveDetail } from './ArchiveDetail';
import { useSharedArchiveIndex } from './useSharedArchiveIndex';

/** How many tournaments the old, browser-local archive still holds here (0 when storage is unreadable). */
function useLocalArchiveCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    try {
      setCount(loadArchiveIndex(window.localStorage).length);
    } catch {
      setCount(0);
    }
  }, []);
  return count;
}

function LocalArchiveNotice({ count }: { count: number }) {
  const app = useTournamentApp();
  function download() {
    const now = new Date(app.runtime.clock.now()).toISOString();
    downloadJson(
      `curve-tournament-archive_${now.slice(0, 10)}.json`,
      archiveBundle(window.localStorage, now),
    );
  }
  return (
    <Alert id='ar-local-notice'>
      This browser holds {count} tournament{count === 1 ? '' : 's'} from the old, local-only archive.{' '}
      <Button size='sm' onClick={download}>
        Download this browser&apos;s old archive (JSON)
      </Button>
    </Alert>
  );
}

function emptyMessage(status: ReturnType<typeof useSharedArchiveIndex>['status']): string {
  if (status === 'loading') return 'Loading the archive…';
  if (status === 'unavailable') return 'Archive unavailable: live sync is offline.';
  if (status === 'error') return 'Could not load the archive.';
  return 'No tournaments archived yet.';
}

export function ArchiveView() {
  const auth = useAuth();
  const archive = useSharedArchiveIndex();
  const localCount = useLocalArchiveCount();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return (
      <ArchiveDetail tournamentId={selectedId} canAdmin={auth.canAdmin} onBack={() => setSelectedId(null)} />
    );
  }

  return (
    <div id='ar-list-view'>
      <div className='mb-4.5'>
        <h2 className='mb-1 text-2xl font-bold text-primary'>Tournament Archive</h2>
        <p className='text-muted'>Finished tournaments saved by the organisers.</p>
      </div>
      {auth.canAdmin && localCount ? <LocalArchiveNotice count={localCount} /> : null}
      {!archive.entries.length ? (
        <Alert id='ar-empty'>{emptyMessage(archive.status)}</Alert>
      ) : (
        <div id='ar-list' className='grid gap-2'>
          {archive.entries.map((summary) => (
            <button
              className='flex w-full cursor-pointer flex-col items-start gap-1 rounded-lg border border-surface-hover bg-surface px-4 py-3 text-left text-foreground transition hover:border-primary hover:bg-primary-soft focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary'
              key={summary.tournamentId}
              onClick={() => setSelectedId(summary.tournamentId)}
            >
              <span className='text-lg font-bold'>{summary.title}</span>
              <span className='text-xs text-muted'>
                {new Date(summary.dateSaved).toLocaleString()} · {summary.playerCount}{' '}
                {unitLabelPluralLower(summary.gameFormat)} · {summary.roundsPlayed} round
                {summary.roundsPlayed === 1 ? '' : 's'} played
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
