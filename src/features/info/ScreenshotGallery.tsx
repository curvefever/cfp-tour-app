import { useState } from 'react';
import { Button, Modal, ModalActions } from '../../components/ui';
import { ScreenshotThumb } from './ScreenshotThumb';

/** The lobby screenshots of a tournament, as thumbnails that open full size. */
export function ScreenshotGallery({ tournamentId, imageIds }: { tournamentId: string; imageIds: string[] }) {
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  if (!imageIds.length) return null;
  return (
    <>
      {/* A phone shows one row of small thumbnails that scrolls sideways inside its own frame. */}
      <div className='grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3 max-[700px]:flex max-[700px]:gap-2 max-[700px]:overflow-x-auto max-[700px]:p-0.5'>
        {imageIds.map((imageId) => (
          <ScreenshotThumb
            className='aspect-[16/10] h-auto w-full rounded-xs border-0 bg-cfp-game-fold outline-2 outline-cfp-game-frame max-[700px]:h-25 max-[700px]:w-40 max-[700px]:shrink-0'
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
