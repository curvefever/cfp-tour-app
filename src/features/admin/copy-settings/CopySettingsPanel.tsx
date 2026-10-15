import { useState } from 'react';
import type { TournamentSettings } from '../../../domain/tournament/types';
import { fetchSetupOnce, fetchTournamentOnce } from '../../sync/firebase-client';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { copyScreenshots } from '../../tournaments/screenshots.server-fns';
import { copyableTournaments } from '../../tournaments/tournament-index';
import { useTournamentIndex, type TournamentIndexState } from '../../tournaments/useTournamentIndex';
import { Alert, Button, ButtonRow, Field, Input, Select } from '../../../components/ui';
import {
  parseTournamentReference,
  settingsFromSnapshot,
  TOURNAMENT_NOT_FOUND_MESSAGE,
  TOURNAMENT_NO_SETTINGS_MESSAGE,
  TOURNAMENT_REFERENCE_INVALID_MESSAGE,
} from './past-tournament-settings';

export interface CopySettingsProps {
  /** Applies the copied settings and returns the confirmation message (including any "generate/load again" notes) to show in this panel. */
  onApply(settings: TournamentSettings, sourceTitle: string, rulesText: string): string;
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the tournament server — check your connection and try again.';

function listEmptyText(status: TournamentIndexState['status']): string {
  if (status === 'loading') return 'Loading the tournaments…';
  if (status === 'ready') return 'No tournament has been published yet.';
  return 'The tournament list is unavailable right now.';
}

function TournamentPicker({ disabled, onCopy }: { disabled: boolean; onCopy(tournamentId: string): void }) {
  const list = useTournamentIndex();
  const [selectedId, setSelectedId] = useState('');
  const entries = copyableTournaments(list.summaries);
  if (!entries.length) return <p className='text-xs text-muted'>{listEmptyText(list.status)}</p>;
  return (
    <>
      <Select
        id='copy-settings-tournament'
        value={selectedId}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        <option value=''>Select a tournament…</option>
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.title || 'Unnamed Tournament'}
            {entry.scheduledAt !== null ? ` — ${new Date(entry.scheduledAt).toLocaleString()}` : ''}
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

/** "Copy settings from another tournament": the part of the Tournament panel that fills the form from a past tournament. */
export function CopySettings({ onApply }: CopySettingsProps) {
  const app = useTournamentApp();
  const [expanded, setExpanded] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');

  /** Copies the screenshots of the source tournament onto the one being set up; the text to add to the confirmation. */
  async function copyScreenshotsFrom(sourceId: string, count: number): Promise<string> {
    if (!count || !app.state.tournamentId) return '';
    try {
      const { copied } = await copyScreenshots({
        data: { fromTournamentId: sourceId, toTournamentId: app.state.tournamentId },
      });
      return copied ? ` ${copied} screenshot${copied === 1 ? '' : 's'} copied.` : '';
    } catch (error) {
      return ` The screenshots could not be copied: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  }

  /** Loads a stored tournament and its Setup form, and applies its settings, or shows why it cannot be. */
  async function copyFrom(tournamentId: string) {
    setError('');
    setFetching(true);
    try {
      const [tournament, setupForm] = await Promise.all([
        fetchTournamentOnce(tournamentId),
        fetchSetupOnce(tournamentId),
      ]);
      const result = settingsFromSnapshot(tournament, setupForm);
      if (!result.ok) {
        setConfirmation('');
        setError(
          result.reason === 'not-found' ? TOURNAMENT_NOT_FOUND_MESSAGE : TOURNAMENT_NO_SETTINGS_MESSAGE,
        );
        return;
      }
      const message = onApply(result.settings, result.title, result.rulesText);
      setConfirmation(`${message}${await copyScreenshotsFrom(tournamentId, result.screenshotCount)}`);
    } catch {
      setConfirmation('');
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setFetching(false);
    }
  }

  function copyFromLink() {
    const tournamentId = parseTournamentReference(linkInput);
    if (!tournamentId) {
      setConfirmation('');
      setError(TOURNAMENT_REFERENCE_INVALID_MESSAGE);
      return Promise.resolve();
    }
    return copyFrom(tournamentId);
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='text-sm font-bold'>Copy settings from another tournament</div>
      {!expanded ? (
        <ButtonRow>
          <Button onClick={() => setExpanded(true)}>Choose…</Button>
        </ButtonRow>
      ) : (
        <>
          <Field label='From a published tournament' htmlFor='copy-settings-tournament'>
            <TournamentPicker disabled={fetching} onCopy={(id) => void copyFrom(id)} />
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
    </div>
  );
}
