import { useState } from 'react';
import { Button, Modal, ModalActions } from '../../components/ui';
import { ScreenshotThumb } from './ScreenshotThumb';

/** The lobby screenshots of a tournament, as thumbnails that open full size. */
export function ScreenshotGallery({ tournamentId, imageIds }: { tournamentId: string; imageIds: string[] }) {
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  if (!imageIds.length) return null;
  return (
    <>
      <div className='flex flex-wrap gap-2.5'>
        {imageIds.map((imageId) => (
          <ScreenshotThumb key={imageId} tournamentId={tournamentId} imageId={imageId} onOpen={setOpenSrc} />
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
