import { useState, type ReactNode } from 'react';
import { cn } from '../../components/ui';
import { imageFiles } from '../info/clipboard-images';
import { FullSizeImage } from '../info/FullSizeImage';
import { shrinkImageFile } from '../info/image-shrink';
import { ScreenshotThumb } from '../info/ScreenshotThumb';
import { deleteNotePicture, uploadNotePicture } from '../tournaments/note-pictures.server-fns';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { errorText, NO_IMAGE_MESSAGE } from './image-upload';

const smallButton =
  'flex size-6.5 max-[700px]:size-11 cursor-pointer items-center justify-center rounded-sm border border-input-border bg-transparent p-0 text-sm text-muted hover:text-foreground focus-within:outline-2 focus-within:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The picture of one settings box (a round's or a game's): a dashed "+ Image" tile while empty (a file, or Ctrl+V
 * while the tile is focused); a thumbnail that opens full size, a replace button and a remove button beside it once
 * filled. The server functions do the work; the new picture arrives with the tournament.
 */
export function NotePictureControl({
  caption,
  imageId,
  onError,
  roundName,
  slot,
  title,
}: {
  /** What the full-size view shows under the picture: the box's text. */
  caption?: ReactNode;
  imageId: string | undefined;
  onError: (message: string) => void;
  roundName: string;
  slot: string;
  /** "Round 1 · Game 1": names the box for assistive technology and the full-size view. */
  title: string;
}) {
  const { state, readOnly } = useTournamentApp();
  const [busy, setBusy] = useState(false);
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const tournamentId = state.tournamentId;
  if (!tournamentId) return null;
  const id = tournamentId;
  const disabled = busy || readOnly;

  async function run(action: () => Promise<unknown>) {
    onError('');
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      onError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    void run(async () =>
      uploadNotePicture({
        data: { tournamentId: id, roundName, slot, dataUrl: await shrinkImageFile(file) },
      }),
    );
  }

  function remove() {
    void run(() => deleteNotePicture({ data: { tournamentId: id, roundName, slot } }));
  }

  const fileInput = (label: string) => (
    <input
      accept='image/*'
      aria-label={label}
      className='sr-only'
      disabled={disabled}
      onChange={(event) => {
        upload(event.target.files?.[0]);
        event.target.value = '';
      }}
      type='file'
    />
  );

  return (
    <div
      className='flex shrink-0 items-center gap-1.5'
      onPaste={(event) => {
        if (disabled) return;
        event.preventDefault();
        const image = imageFiles([...event.clipboardData.files])[0];
        if (image) upload(image);
        else onError(NO_IMAGE_MESSAGE);
      }}
    >
      {imageId ? (
        <>
          <ScreenshotThumb
            alt={`Picture of ${title}`}
            className='h-8.5 w-13 rounded-sm border-input-border max-[700px]:h-11 max-[700px]:w-17'
            imageId={imageId}
            onOpen={setOpenSrc}
            tournamentId={id}
          />
          <label
            className={cn(smallButton, disabled && 'cursor-not-allowed opacity-50')}
            title='Replace the picture (or press Ctrl+V here)'
          >
            ↻{fileInput(`Replace the picture of ${title}`)}
          </label>
          <button
            aria-label={`Remove the picture of ${title}`}
            className={cn(smallButton, 'text-cfp-danger-text')}
            disabled={disabled}
            onClick={remove}
            title='Remove the picture'
            type='button'
          >
            ✕
          </button>
        </>
      ) : (
        <label
          className={cn(
            'flex h-8.5 w-13 items-center justify-center rounded-sm border border-dashed border-cfp-text-dim text-xs font-bold text-muted focus-within:outline-2 focus-within:outline-primary max-[700px]:h-11 max-[700px]:w-17',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-foreground',
          )}
          title='Add a picture (or press Ctrl+V here)'
        >
          {busy ? '…' : '+ Image'}
          {fileInput(`Add a picture to ${title}`)}
        </label>
      )}
      {openSrc ? (
        <FullSizeImage caption={caption} onClose={() => setOpenSrc(null)} src={openSrc} title={title} />
      ) : null}
    </div>
  );
}
