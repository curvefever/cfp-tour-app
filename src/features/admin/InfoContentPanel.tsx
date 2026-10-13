import { useEffect, useRef, useState } from 'react';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { Alert, Button, Field, Panel, PanelTitle, Textarea } from '../../components/ui';
import { shrinkImageFile } from '../info/image-shrink';
import { ScreenshotThumb } from '../info/ScreenshotThumb';
import { MAX_SCREENSHOTS } from '../tournaments/screenshots.shared';
import { deleteScreenshot, uploadScreenshot } from '../tournaments/screenshots.server-fns';
import { useTournamentApp } from '../tournament/TournamentProvider';

const FORMATTING_HINT =
  'A blank line starts a new paragraph. Start a line with "- " for a list. **bold**, [link text](https://address).';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}

/** The rules text, typed here and saved when the box is left, so what comes back from the database never cuts into it. */
function RulesTextField() {
  const { state, updateState, readOnly } = useTournamentApp();
  const stored = state.info?.rulesText ?? '';
  const [draft, setDraft] = useState(stored);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(stored);
  }, [stored]);
  function save() {
    focused.current = false;
    if (draft === stored) return;
    updateState((current) => ({
      ...current,
      info: { ...(current.info ?? createDefaultInfo()), rulesText: draft },
    }));
  }
  return (
    <Field label='Rules for this tournament' htmlFor='info-rules-text'>
      <Textarea
        id='info-rules-text'
        disabled={readOnly}
        value={draft}
        placeholder='Specific rules, shown on the Info tab…'
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={save}
      />
      <p className='mt-1 text-xs text-muted'>{FORMATTING_HINT}</p>
    </Field>
  );
}

function ScreenshotsControl() {
  const { state, readOnly } = useTournamentApp();
  const tournamentId = state.tournamentId;
  const imageIds = state.info?.screenshots ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!tournamentId) return null;
  const id = tournamentId;
  const room = MAX_SCREENSHOTS - imageIds.length;

  async function upload(files: File[]) {
    setError('');
    setBusy(true);
    try {
      for (const file of files.slice(0, Math.max(room, 0))) {
        await uploadScreenshot({ data: { tournamentId: id, dataUrl: await shrinkImageFile(file) } });
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId: string) {
    if (!window.confirm('Delete this screenshot?')) return;
    setError('');
    setBusy(true);
    try {
      await deleteScreenshot({ data: { tournamentId: id, imageId } });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field
      label={`Lobby screenshots (${imageIds.length} of ${MAX_SCREENSHOTS})`}
      htmlFor='info-screenshot-file'
    >
      <div className='flex flex-wrap gap-2.5'>
        {imageIds.map((imageId) => (
          <div key={imageId} className='flex flex-col items-start gap-1'>
            <ScreenshotThumb tournamentId={id} imageId={imageId} />
            <Button disabled={busy || readOnly} size='sm' onClick={() => void remove(imageId)}>
              Delete
            </Button>
          </div>
        ))}
      </div>
      {room > 0 ? (
        <input
          id='info-screenshot-file'
          accept='image/*'
          className='mt-2 block text-sm'
          disabled={busy || readOnly}
          multiple
          onChange={(event) => {
            void upload([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
          type='file'
        />
      ) : (
        <p className='mt-2 text-xs text-muted'>The limit is reached: delete one to add another.</p>
      )}
      {busy ? <p className='mt-1 text-xs text-muted'>Working…</p> : null}
      {error ? (
        <Alert tone='danger' className='mt-2'>
          {error}
        </Alert>
      ) : null}
    </Field>
  );
}

/** What visitors read on the Info tab besides the date: the specific rules and the lobby screenshots. */
export function InfoContentPanel() {
  return (
    <Panel>
      <PanelTitle>Info for visitors</PanelTitle>
      <RulesTextField />
      <ScreenshotsControl />
    </Panel>
  );
}
