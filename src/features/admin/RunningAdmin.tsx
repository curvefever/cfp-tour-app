import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ButtonRow,
  Field,
  Input,
  Modal,
  ModalActions,
  Panel,
  PanelTitle,
  Timeline,
  TimelineItem,
} from '../../components/ui';
import { saveArchiveEntry } from '../archive/archive-write.server-fns';
import { useSharedArchiveIndex } from '../archive/useSharedArchiveIndex';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { CorrectCurrentRoundPanel } from './live-corrections/CorrectCurrentRoundPanel';
import { LiveSyncCard, TournamentSettingsRecap } from './RunningAdminStatus';
import { ScheduledTimeField } from './ScheduledTimeField';
import { RunningWaterfallPanel } from './waterfall/RunningWaterfallPanel';

type AdminPrompt = { kind: 'overwrite'; savedAt: string } | { kind: 'reset' };

export function RunningAdmin() {
  const app = useTournamentApp();
  const state = app.state;
  const round = state.rounds[state.curRound];
  const [archiveStatus, setArchiveStatus] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState<AdminPrompt | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const archiveIndex = useSharedArchiveIndex();
  useEffect(() => {
    const showStatus = (event: Event) => {
      const { message, failed } = (event as CustomEvent<{ message: string; failed?: boolean }>).detail;
      if (failed) setArchiveError(message);
      else setArchiveStatus(message);
    };
    window.addEventListener('curve-tour:archive-status', showStatus);
    return () => window.removeEventListener('curve-tour:archive-status', showStatus);
  }, []);
  if (!round) return <Alert tone='danger'>The saved tournament has no current round.</Alert>;

  /** Publishes the current tournament to the shared archive; resolves true on success. */
  async function saveArchive(): Promise<boolean> {
    if (!state.tournamentId) return false;
    setArchiveError('');
    setArchiveStatus('');
    setSaving(true);
    try {
      await saveArchiveEntry({ data: { tournamentId: state.tournamentId, snapshot: state } });
      app.updateState((current) => ({ ...current, needsSave: false }));
      setArchiveStatus('Tournament saved to archive.');
      return true;
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Could not save to the archive.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmedSave() {
    setPrompt(null);
    await saveArchive();
  }

  function requestArchiveSave() {
    const existing = archiveIndex.entries.find((entry) => entry.tournamentId === state.tournamentId);
    if (existing) setPrompt({ kind: 'overwrite', savedAt: existing.dateSaved });
    else void saveArchive();
  }

  async function saveThen(next: () => void) {
    if (await saveArchive()) next();
  }

  async function backToDraftNow() {
    setPrompt(null);
    setResetError('');
    setResetting(true);
    const message = await app.backToDraft();
    setResetting(false);
    if (message) setResetError(message);
  }
  return (
    <div id='panel-running'>
      <Panel className='pb-1.5'>
        <PanelTitle>Tournament running</PanelTitle>
        <Field htmlFor='running-title' label='Tournament name'>
          <Input
            id='running-title'
            type='text'
            value={state.title}
            placeholder='Unnamed Tournament'
            onChange={(event) =>
              app.updateState((current) => ({ ...current, title: event.target.value, needsSave: true }))
            }
          />
        </Field>
        <ScheduledTimeField id='running-scheduled-at' />
      </Panel>
      <TournamentSettingsRecap state={state} />
      {state.rounds.some((entry) => entry.isWaterfall) ? <RunningWaterfallPanel state={state} /> : null}
      {archiveError && !prompt ? <Alert tone='danger'>{archiveError}</Alert> : null}
      {resetError ? <Alert tone='danger'>{resetError}</Alert> : null}
      {archiveStatus ? (
        <Alert tone='success' id='archive-save-status'>
          {archiveStatus}
        </Alert>
      ) : null}
      <LiveSyncCard />
      <CorrectCurrentRoundPanel state={state} />
      <Panel>
        <PanelTitle>Tournament progress</PanelTitle>
        <Timeline>
          {state.rounds.map((entry, index) => (
            <TimelineItem
              key={index}
              label={entry.isFinal ? 'Final' : entry.isSemis ? 'Semis' : `R${entry.roundNum}`}
              state={index < state.curRound ? 'done' : index === state.curRound ? 'current' : 'upcoming'}
            >
              {index < state.curRound ? '✓' : entry.isFinal ? '🏆' : entry.isSemis ? 'S' : entry.roundNum}
            </TimelineItem>
          ))}
        </Timeline>
      </Panel>
      <ButtonRow className='rounded-lg border border-surface-hover p-2.5'>
        <Button
          variant='accent'
          disabled={!state.tournamentId || saving}
          title={
            state.tournamentId ? undefined : 'Generate the tournament first: it has no ID to archive under.'
          }
          onClick={requestArchiveSave}
        >
          {saving ? 'Saving…' : '💾 Save to Archive'}
        </Button>
        <Button
          disabled={resetting}
          onClick={() => {
            if (state.needsSave) setPrompt({ kind: 'reset' });
            else if (
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
      {prompt?.kind === 'overwrite' ? (
        <Modal titleId='archive-save-title' title='Tournament already archived'>
          <p>Overwrite the archived copy saved {new Date(prompt.savedAt).toLocaleString()}?</p>
          <ModalActions>
            <Button variant='danger' onClick={() => void confirmedSave()}>
              Overwrite
            </Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
      {prompt?.kind === 'reset' ? (
        <Modal titleId='reset-title' title='Unsaved tournament'>
          <p>
            This tournament has changes that are not in the archive. Save a snapshot before sending it back to
            draft, discard the changes, or cancel?
          </p>
          {archiveError ? <Alert tone='danger'>{archiveError}</Alert> : null}
          <ModalActions>
            <Button
              variant='success'
              disabled={saving}
              onClick={() => void saveThen(() => void backToDraftNow())}
            >
              Save &amp; back to draft
            </Button>
            <Button variant='danger' disabled={saving} onClick={() => void backToDraftNow()}>
              Back to draft without saving
            </Button>
            <Button disabled={saving} onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </ModalActions>
        </Modal>
      ) : null}
    </div>
  );
}
