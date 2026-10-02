import { useEffect, useState } from 'react';
import { getGameFormat } from '../../domain/tournament/formats';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import { ArchivedBracket } from '../bracket/BracketView';
import { RankingsContent } from '../rankings/RankingsView';
import { downloadRankingsImage } from '../rankings/rankings-image';
import { fetchArchiveEntryOnce } from '../sync/firebase-client';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert, Button, ButtonRow, Panel, PanelTitle, StatStrip, Textarea } from '../../components/ui';
import { deleteArchiveEntry, setArchiveAnnotations } from './archive-write.server-fns';
import type { ArchiveAnnotation, SharedArchiveEntry } from './shared-archive';

type LoadedEntry =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entry: SharedArchiveEntry };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ArchiveDetail({
  tournamentId,
  canAdmin,
  onBack,
}: {
  tournamentId: string;
  canAdmin: boolean;
  onBack: () => void;
}) {
  const app = useTournamentApp();
  const [loaded, setLoaded] = useState<LoadedEntry>({ status: 'loading' });
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchArchiveEntryOnce(tournamentId).then(
      (entry) => !cancelled && setLoaded(entry ? { status: 'ready', entry } : { status: 'missing' }),
      (error: unknown) =>
        !cancelled &&
        setLoaded({ status: 'error', message: errorMessage(error, 'Could not load this tournament.') }),
    );
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  const backButton = (
    <ButtonRow className='mt-0 mb-3.5'>
      <Button onClick={onBack}>← Back to Archive</Button>
    </ButtonRow>
  );
  if (loaded.status === 'loading') {
    return (
      <div id='ar-detail-view'>
        {backButton}
        <Alert>Loading…</Alert>
      </div>
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <div id='ar-detail-view'>
        {backButton}
        <Alert tone='danger'>
          {loaded.status === 'missing' ? 'This tournament is no longer in the archive.' : loaded.message}
        </Alert>
      </div>
    );
  }

  const { entry } = loaded;
  const state = normalizeLiveTournamentState(entry.snapshot, app.runtime.ids);
  const format = getGameFormat(state.gameFormat);

  async function saveAnnotations(annotations: ArchiveAnnotation[]): Promise<boolean> {
    setActionError('');
    try {
      await setArchiveAnnotations({ data: { tournamentId, annotations } });
      setLoaded({ status: 'ready', entry: { ...entry, annotations } });
      return true;
    } catch (error) {
      setActionError(errorMessage(error, 'Could not save the annotation.'));
      return false;
    }
  }

  async function addNote() {
    const text = note.trim();
    if (!text) return;
    const timestamp = new Date(app.runtime.clock.now()).toISOString();
    if (await saveAnnotations([...entry.annotations, { text, timestamp }])) setNote('');
  }

  async function removeNote(position: number) {
    if (!window.confirm('Delete this annotation? This cannot be undone.')) return;
    await saveAnnotations(entry.annotations.filter((_, kept) => kept !== position));
  }

  async function deleteEntry() {
    if (!window.confirm(`Permanently delete "${entry.title}" from the archive? This cannot be undone.`))
      return;
    setActionError('');
    try {
      await deleteArchiveEntry({ data: { tournamentId } });
      onBack();
    } catch (error) {
      setActionError(errorMessage(error, 'Could not delete this tournament.'));
    }
  }

  return (
    <div id='ar-detail-view'>
      <ButtonRow className='mt-0 mb-3.5'>
        <Button onClick={onBack}>← Back to Archive</Button>
        <Button onClick={() => void downloadRankingsImage(state)}>⬇ Rankings PNG</Button>
        {canAdmin ? (
          <Button variant='danger' onClick={() => void deleteEntry()}>
            Delete
          </Button>
        ) : null}
      </ButtonRow>
      {actionError ? <Alert tone='danger'>{actionError}</Alert> : null}
      <div id='ar-detail-summary'>
        <StatStrip
          items={[
            { label: 'Tournament', value: entry.title, valueClassName: 'text-primary' },
            { label: 'Saved', value: new Date(entry.dateSaved).toLocaleString() },
            { label: format?.unitLabelPlural ?? 'Players', value: state.players.length },
            { label: 'Rounds played', value: state.rounds[state.curRound]?.roundNum ?? '—' },
          ]}
        />
      </div>
      <Panel className='mt-4'>
        <PanelTitle>Organiser annotations</PanelTitle>
        <div id='ar-annotations-list'>
          {!entry.annotations.length ? (
            <div className='text-xs text-muted'>No annotations yet.</div>
          ) : (
            entry.annotations.map((annotation, position) => (
              <div
                className='mb-2 flex min-w-0 flex-col items-start gap-2 whitespace-pre-wrap rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
                key={`${annotation.timestamp}-${position}`}
              >
                <div className='flex w-full items-start justify-between gap-2.5 text-sm'>
                  <div>{annotation.text}</div>
                  {canAdmin ? (
                    <Button size='sm' title='Delete' onClick={() => void removeNote(position)}>
                      ✕
                    </Button>
                  ) : null}
                </div>
                <small className='text-[0.68rem] text-muted'>
                  {new Date(annotation.timestamp).toLocaleString()}
                </small>
              </div>
            ))
          )}
        </div>
        {canAdmin ? (
          <div className='flex items-start gap-2 max-[700px]:flex-col'>
            <Textarea
              className='min-h-19 flex-1 max-[700px]:w-full'
              id='ar-note-input'
              value={note}
              placeholder='Add a note about this tournament…'
              onChange={(event) => setNote(event.target.value)}
            />
            <Button onClick={() => void addNote()}>Add annotation</Button>
          </div>
        ) : null}
      </Panel>
      <Panel>
        <PanelTitle>Final rankings</PanelTitle>
        <RankingsContent state={state} downloads={false} />
      </Panel>
      <Panel>
        <PanelTitle>Tournament bracket</PanelTitle>
        <ArchivedBracket state={state} />
      </Panel>
    </div>
  );
}
