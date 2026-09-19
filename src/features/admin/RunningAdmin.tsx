import { useEffect, useState } from 'react';
import { resetRoster, resetTournamentState } from '../../domain/tournament/mutations';
import {
  findLatestArchiveEntryForTournament,
  loadArchiveIndex,
  writeArchiveSnapshot,
  type ArchiveSummary,
} from '../../lib/persistence/archive';
import { saveBracketFollow } from '../../lib/persistence/storage';
import { archiveEntryStorageKey } from '../../lib/persistence/storage-keys';
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
import { useTournamentApp } from '../tournament/TournamentProvider';
import { LiveSyncCard, TournamentSettingsRecap } from './RunningAdminStatus';

type AdminPrompt =
  | { kind: 'save'; sameTournament?: ArchiveSummary; titleCollision?: ArchiveSummary }
  | { kind: 'reset' }
  | { kind: 'start-new' };

export function RunningAdmin() {
  const app = useTournamentApp();
  const state = app.state;
  const round = state.rounds[state.curRound];
  const [archiveStatus, setArchiveStatus] = useState('');
  const [prompt, setPrompt] = useState<AdminPrompt | null>(null);
  useEffect(() => {
    const showStatus = (event: Event) => setArchiveStatus((event as CustomEvent<string>).detail);
    window.addEventListener('curve-tour:archive-status', showStatus);
    return () => window.removeEventListener('curve-tour:archive-status', showStatus);
  }, []);
  if (!round) return <Alert tone='danger'>The saved tournament has no current round.</Alert>;

  function mintArchiveId(index = loadArchiveIndex(window.localStorage)) {
    let id = String(app.runtime.clock.now());
    while (
      index.some((entry) => String(entry.id) === id) ||
      window.localStorage.getItem(archiveEntryStorageKey(id)) !== null
    ) {
      id = String(Number(id) + 1);
    }
    return id;
  }

  function saveArchive(id: string, keepAnnotations: boolean, status = 'Tournament saved to archive.') {
    writeArchiveSnapshot({
      storage: window.localStorage,
      state,
      id,
      dateSaved: new Date(app.runtime.clock.now()).toISOString(),
      keepAnnotations,
    });
    app.updateState((current) => ({ ...current, needsSave: false }));
    setArchiveStatus(status);
    setPrompt(null);
  }

  function saveSilently() {
    const index = loadArchiveIndex(window.localStorage);
    const existing = findLatestArchiveEntryForTournament(index, state.tournamentId);
    saveArchive(existing?.id ?? mintArchiveId(index), Boolean(existing));
  }

  function requestArchiveSave() {
    const index = loadArchiveIndex(window.localStorage);
    const title = state.title.trim() || 'Unnamed Tournament';
    const sameTournament = findLatestArchiveEntryForTournament(index, state.tournamentId);
    if (sameTournament) {
      setPrompt({ kind: 'save', sameTournament });
      return;
    }
    const titleCollision = index.find((entry) => entry.title === title);
    if (titleCollision) {
      setPrompt({ kind: 'save', titleCollision });
      return;
    }
    saveArchive(mintArchiveId(index), false);
  }

  function resetNow() {
    saveBracketFollow(window.localStorage, null);
    app.updateState(resetTournamentState(state));
    setPrompt(null);
  }

  function startNewNow() {
    saveBracketFollow(window.localStorage, null);
    app.updateState(resetRoster(state));
    setPrompt(null);
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
      </Panel>
      <TournamentSettingsRecap state={state} />
      {archiveStatus ? (
        <Alert tone='success' id='archive-save-status'>
          {archiveStatus}
        </Alert>
      ) : null}
      <LiveSyncCard />
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
      <ButtonRow className='sticky bottom-2.5 z-20 rounded-lg border border-surface-hover bg-background/90 p-2.5 backdrop-blur-md'>
        <Button variant='accent' onClick={requestArchiveSave}>
          💾 Save to Archive
        </Button>
        <Button
          onClick={() => {
            if (state.needsSave) setPrompt({ kind: 'reset' });
            else if (window.confirm('Reset the full tournament? All scores will be lost.')) resetNow();
          }}
        >
          ↺ Reset
        </Button>
        <Button
          onClick={() => {
            if (state.needsSave) setPrompt({ kind: 'start-new' });
            else if (
              window.confirm(
                'Start a new tournament? This clears the current roster and schedule — archived tournaments are unaffected.',
              )
            )
              startNewNow();
          }}
        >
          🏁 Save & Start New Tournament
        </Button>
      </ButtonRow>
      {prompt?.kind === 'save' ? (
        <Modal
          titleId='archive-save-title'
          title={prompt.sameTournament ? 'Tournament already archived' : 'Title already used'}
        >
          <p>
            {prompt.sameTournament
              ? `A tournament named "${state.title.trim() || 'Unnamed Tournament'}" already exists. Overwrite, save as a new entry, or cancel?`
              : `A different archived tournament is also named "${state.title.trim() || 'Unnamed Tournament'}". Save this as a new entry, or cancel to rename it first?`}
          </p>
          <ModalActions>
            {prompt.sameTournament ? (
              <Button variant='danger' onClick={() => saveArchive(prompt.sameTournament!.id, true)}>
                Overwrite existing
              </Button>
            ) : null}
            <Button onClick={() => saveArchive(mintArchiveId(), false)}>Save as new entry</Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
      {prompt?.kind === 'reset' ? (
        <Modal titleId='reset-title' title='Unsaved tournament'>
          <p>
            This tournament has changes that are not in the archive. Save a snapshot before resetting, discard
            the changes, or cancel?
          </p>
          <ModalActions>
            <Button
              variant='success'
              onClick={() => {
                saveSilently();
                resetNow();
              }}
            >
              Save &amp; reset
            </Button>
            <Button variant='danger' onClick={resetNow}>
              Reset without saving
            </Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
      {prompt?.kind === 'start-new' ? (
        <Modal titleId='start-new-title' title='Unsaved tournament'>
          <p>
            This tournament has changes that are not in the archive. Save a snapshot before starting a new
            tournament, discard the changes, or cancel?
          </p>
          <ModalActions>
            <Button
              variant='success'
              onClick={() => {
                saveSilently();
                startNewNow();
              }}
            >
              Save &amp; start new
            </Button>
            <Button variant='danger' onClick={startNewNow}>
              Start new without saving
            </Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
    </div>
  );
}
