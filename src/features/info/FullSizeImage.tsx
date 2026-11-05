import type { ReactNode } from 'react';
import { Button, Modal, ModalActions } from '../../components/ui';

/** A picture at its full size in a window of its own, with an optional line of text under it. */
export function FullSizeImage({
  caption,
  onClose,
  src,
  title,
}: {
  caption?: ReactNode;
  onClose: () => void;
  src: string;
  title: string;
}) {
  return (
    <Modal className='max-w-[min(1200px,95vw)]' title={title} titleId='full-size-image-title'>
      <img alt={`${title}, full size`} className='max-h-[70vh] w-full object-contain' src={src} />
      {caption ? <div className='mt-3 text-sm leading-5 wrap-break-word'>{caption}</div> : null}
      <ModalActions>
        <Button onClick={onClose}>Close</Button>
      </ModalActions>
    </Modal>
  );
}
