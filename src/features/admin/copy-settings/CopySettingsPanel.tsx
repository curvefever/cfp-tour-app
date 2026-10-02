import { useState } from 'react';
import type { TournamentSettings } from '../../../domain/tournament/types';
import { useSharedArchiveIndex } from '../../archive/useSharedArchiveIndex';
import { fetchArchiveEntryOnce, fetchTournamentOnce } from '../../sync/firebase-client';
import { Alert, Button, ButtonRow, Field, Input, Panel, PanelTitle, Select } from '../../../components/ui';
import {
  archiveEntriesWithSettings,
  parseTournamentReference,
  settingsFromSnapshot,
  TOURNAMENT_NOT_FOUND_MESSAGE,
  TOURNAMENT_NO_SETTINGS_MESSAGE,
  TOURNAMENT_REFERENCE_INVALID_MESSAGE,
} from './past-tournament-settings';

export interface CopySettingsPanelProps {
  /** Applies the copied settings and returns the confirmation message (including any "generate/load again" notes) to show in this panel. */
  onApply(settings: TournamentSettings, sourceTitle: string): string;
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the tournament server — check your connection and try again.';

function archiveEmptyText(status: ReturnType<typeof useSharedArchiveIndex>['status']): string {
  if (status === 'loading') return 'Loading the archive…';
  if (status === 'ready') return 'No archived tournament has saved settings yet.';
  return 'The archive is unavailable right now.';
}

function ArchivePicker({ disabled, onCopy }: { disabled: boolean; onCopy(tournamentId: string): void }) {
  const archive = useSharedArchiveIndex();
  const [selectedId, setSelectedId] = useState('');
  const entries = archiveEntriesWithSettings(archive.entries);
  if (!entries.length) return <p className='text-xs text-muted'>{archiveEmptyText(archive.status)}</p>;
  return (
    <>
      <Select
        id='copy-settings-archive'
        value={selectedId}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        <option value=''>Select a tournament…</option>
        {entries.map((entry) => (
          <option key={entry.tournamentId} value={entry.tournamentId}>
            {entry.title} — {new Date(entry.dateSaved).toLocaleString()}
          </option>
        ))}
      </Select>
      <ButtonRow>
        <Button disabled={!selectedId || disabled} onClick={() => onCopy(selectedId)}>
          Copy settings
        </Button>
      </ButtonRow>
    </>
  );
}

export function CopySettingsPanel({ onApply }: CopySettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');

  /** Loads a stored tournament (or archive snapshot) and applies its settings, or shows why it can't be. */
  async function copyFrom(load: () => Promise<unknown>) {
    setError('');
    setFetching(true);
    try {
      const result = settingsFromSnapshot(await load());
      if (!result.ok) {
        setConfirmation('');
        setError(
          result.reason === 'not-found' ? TOURNAMENT_NOT_FOUND_MESSAGE : TOURNAMENT_NO_SETTINGS_MESSAGE,
        );
        return;
      }
      setConfirmation(onApply(result.settings, result.title));
    } catch {
      setConfirmation('');
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setFetching(false);
    }
  }

  function copyFromArchive(tournamentId: string) {
    return copyFrom(async () => (await fetchArchiveEntryOnce(tournamentId))?.snapshot ?? null);
  }

  function copyFromLink() {
    const tournamentId = parseTournamentReference(linkInput);
    if (!tournamentId) {
      setConfirmation('');
      setError(TOURNAMENT_REFERENCE_INVALID_MESSAGE);
      return Promise.resolve();
    }
    return copyFrom(() => fetchTournamentOnce(tournamentId));
  }

  return (
    <Panel>
      <PanelTitle>Copy settings from a past tournament</PanelTitle>
      {!expanded ? (
        <ButtonRow>
          <Button onClick={() => setExpanded(true)}>Choose…</Button>
        </ButtonRow>
      ) : (
        <>
          <Field label='From the archive' htmlFor='copy-settings-archive'>
            <ArchivePicker disabled={fetching} onCopy={(id) => void copyFromArchive(id)} />
          </Field>
          <Field label='Tournament link or id' htmlFor='copy-settings-link'>
            <Input
              id='copy-settings-link'
              type='text'
              placeholder='Tournament link or id'
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
            <ButtonRow>
              <Button disabled={fetching} onClick={() => void copyFromLink()}>
                Copy settings
              </Button>
            </ButtonRow>
          </Field>
          {error ? (
            <Alert id='copy-settings-error' tone='danger'>
              {error}
            </Alert>
          ) : null}
          {confirmation ? (
            <Alert id='copy-settings-confirmation' tone='success'>
              {confirmation}
            </Alert>
          ) : null}
        </>
      )}
    </Panel>
  );
}
