import { useEffect, useRef, useState } from 'react';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { Alert, SectionPanel, Textarea } from '../../components/ui';
import { PresenceField } from '../presence/PresenceField';
import { shrinkImageFile } from '../info/image-shrink';
import { ScreenshotThumb } from '../info/ScreenshotThumb';
import { MAX_SCREENSHOTS } from '../tournaments/screenshots.shared';
import { deleteScreenshot, uploadScreenshot } from '../tournaments/screenshots.server-fns';
import { useTournamentApp } from '../tournament/TournamentProvider';

const FORMATTING_HINT =
  'A blank line starts a paragraph, "- " a list, **bold** for bold, [text](https://address) for a link. Saved when you leave the box.';

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
    <PresenceField className='mb-0' label='Rules for this tournament' htmlFor='info-rules-text'>
      <Textarea
        className='text-sm leading-normal'
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
      <p className='mt-1.5 text-[13px] text-muted'>{FORMATTING_HINT}</p>
    </PresenceField>
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
    <div className='flex flex-col gap-2'>
      <div className='text-sm font-bold'>
        Lobby screenshots{' '}
        <span className='font-normal text-muted'>
          {imageIds.length} of {MAX_SCREENSHOTS}
        </span>
      </div>
      <div className='flex flex-wrap gap-2.5'>
        {imageIds.map((imageId) => (
          <div className='relative' key={imageId}>
            <ScreenshotThumb
              className='h-22.5 w-37.5 rounded-sm border border-input-border'
              imageId={imageId}
              tournamentId={id}
            />
            <button
              aria-label='Delete screenshot'
              className='absolute top-1 right-1 size-6.5 cursor-pointer rounded-sm border-0 bg-background/85 text-sm text-cfp-danger-text hover:bg-background disabled:cursor-not-allowed disabled:opacity-50'
              disabled={busy || readOnly}
              onClick={() => void remove(imageId)}
              type='button'
            >
              ✕
            </button>
          </div>
        ))}
        {room > 0 ? (
          <label
            className={`flex h-22.5 w-37.5 items-center justify-center rounded-sm border border-dashed border-cfp-text-dim text-sm font-bold text-muted ${busy || readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-foreground'} focus-within:outline-2 focus-within:outline-primary`}
            htmlFor='info-screenshot-file'
          >
            + Upload
            <input
              id='info-screenshot-file'
              accept='image/*'
              className='sr-only'
              disabled={busy || readOnly}
              multiple
              onChange={(event) => {
                void upload([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
              type='file'
            />
          </label>
        ) : null}
      </div>
      {room > 0 ? null : (
        <p className='text-xs text-muted'>The limit is reached: delete one to add another.</p>
      )}
      {busy ? <p className='text-xs text-muted'>Working…</p> : null}
      {error ? <Alert tone='danger'>{error}</Alert> : null}
    </div>
  );
}

/** What visitors read on the Info tab besides the date: the specific rules and the lobby screenshots. */
export function InfoContentPanel() {
  return (
    <SectionPanel title='INFO FOR VISITORS'>
      <RulesTextField />
      <ScreenshotsControl />
    </SectionPanel>
  );
}
