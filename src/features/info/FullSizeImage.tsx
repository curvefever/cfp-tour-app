import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, ModalActions } from '../../components/ui';

/** A picture at its full size in a window of its own, with an optional line of text under it; Escape and Close close it. */
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
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  // Drawn into the page's body, not where the picture was clicked: a pop-up or a sticky header around it never covers or clips it.
  return createPortal(
    <Modal className='max-w-[min(1200px,95vw)]' title={title} titleId='full-size-image-title'>
      <img alt={`${title}, full size`} className='max-h-[70vh] w-full object-contain' src={src} />
      {caption ? <div className='mt-3 text-sm leading-5 wrap-break-word'>{caption}</div> : null}
      <ModalActions>
        <Button onClick={onClose}>Close</Button>
      </ModalActions>
    </Modal>,
    document.body,
  );
}
