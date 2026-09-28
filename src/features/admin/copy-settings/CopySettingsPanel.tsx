import { useState } from 'react';
import type { TournamentSettings } from '../../../domain/tournament/types';
import { loadArchiveEntry } from '../../../lib/persistence/archive';
import { fetchTournamentOnce } from '../../sync/firebase-client';
import { Alert, Button, ButtonRow, Field, Input, Panel, PanelTitle, Select } from '../../../components/ui';
import {
  archiveEntriesWithSettings,
  parseTournamentReference,
  settingsFromSnapshot,
  TOURNAMENT_NOT_FOUND_MESSAGE,
  TOURNAMENT_NO_SETTINGS_MESSAGE,
  TOURNAMENT_REFERENCE_INVALID_MESSAGE,
  type ArchiveEntryWithSettings,
} from './past-tournament-settings';

export interface CopySettingsPanelProps {
  onApply(settings: TournamentSettings, sourceTitle: string): void;
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the tournament server — check your connection and try again.';

export function CopySettingsPanel({ onApply }: CopySettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntryWithSettings[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  function expand() {
    setArchiveEntries(archiveEntriesWithSettings(window.localStorage));
    setExpanded(true);
  }

  function copyFromArchive() {
    const entry = selectedArchiveId ? loadArchiveEntry(window.localStorage, selectedArchiveId) : null;
    const result = entry ? settingsFromSnapshot(entry.snapshot) : null;
    // The archive list is already filtered to entries with readable settings,
    // so a failure here would mean the entry disappeared underneath us.
    if (!result || !result.ok) return;
    setError('');
    onApply(result.settings, result.title);
  }

  async function copyFromLink() {
    const tournamentId = parseTournamentReference(linkInput);
    if (!tournamentId) {
      setError(TOURNAMENT_REFERENCE_INVALID_MESSAGE);
      return;
    }
    setError('');
    setFetching(true);
    try {
      const raw = await fetchTournamentOnce(tournamentId);
      const result = settingsFromSnapshot(raw);
      if (!result.ok) {
        setError(
          result.reason === 'not-found' ? TOURNAMENT_NOT_FOUND_MESSAGE : TOURNAMENT_NO_SETTINGS_MESSAGE,
        );
        return;
      }
      onApply(result.settings, result.title);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setFetching(false);
    }
  }

  return (
    <Panel>
      <PanelTitle>Copy settings from a past tournament</PanelTitle>
      {!expanded ? (
        <ButtonRow>
          <Button onClick={expand}>Choose…</Button>
        </ButtonRow>
      ) : (
        <>
          <Field label='From the archive'>
            {archiveEntries.length ? (
              <>
                <Select
                  id='copy-settings-archive'
                  value={selectedArchiveId}
                  onChange={(e) => setSelectedArchiveId(e.target.value)}
                >
                  <option value=''>Select a tournament…</option>
                  {archiveEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title} — {new Date(entry.dateSaved).toLocaleString()}
                    </option>
                  ))}
                </Select>
                <ButtonRow>
                  <Button disabled={!selectedArchiveId} onClick={copyFromArchive}>
                    Copy settings
                  </Button>
                </ButtonRow>
              </>
            ) : (
              <p className='text-xs text-muted'>
                No archived tournament on this browser has saved settings yet.
              </p>
            )}
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
        </>
      )}
    </Panel>
  );
}
