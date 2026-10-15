import { useState } from 'react';
import { Button, Modal, ModalActions } from '../../components/ui';
import { ScreenshotThumb } from './ScreenshotThumb';

/** The lobby screenshots of a tournament, as thumbnails that open full size. */
export function ScreenshotGallery({ tournamentId, imageIds }: { tournamentId: string; imageIds: string[] }) {
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  if (!imageIds.length) return null;
  return (
    <>
      <div className='grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3'>
        {imageIds.map((imageId) => (
          <ScreenshotThumb
            className='aspect-[16/10] h-auto w-full rounded-xs border-0 bg-cfp-game-fold outline-2 outline-cfp-game-frame'
            imageId={imageId}
            key={imageId}
            onOpen={setOpenSrc}
            tournamentId={tournamentId}
          />
        ))}
      </div>
      {openSrc ? (
        <Modal className='max-w-[min(1200px,95vw)]' title='Lobby screenshot' titleId='screenshot-title'>
          <img
            alt='Lobby screenshot, full size'
            className='max-h-[70vh] w-full object-contain'
            src={openSrc}
          />
          <ModalActions>
            <Button onClick={() => setOpenSrc(null)}>Close</Button>
          </ModalActions>
        </Modal>
      ) : null}
    </>
  );
}
