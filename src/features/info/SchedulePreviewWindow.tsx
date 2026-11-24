import { createPortal } from 'react-dom';
import { Button, Modal, ModalActions } from '../../components/ui';
import { SchedulePicture } from './SchedulePicture';
import type { SchedulePictureModel } from './schedule-picture-types';
import { useCloseOnEscape } from './useCloseOnEscape';

/**
 * The schedule picture at its own size in a window over the page, in a frame that scrolls both ways (a wide schedule
 * stays readable, unlike a full-size view that shrinks to fit). Escape and Close close it; the picture is drawn once
 * the window opens, and a right-click or a long press on it copies it.
 */
export function SchedulePreviewWindow({
  model,
  onClose,
}: {
  model: SchedulePictureModel;
  onClose: () => void;
}) {
  useCloseOnEscape(onClose);
  // Drawn into the page's body, like the full-size picture: a sticky header around the card never covers or clips it.
  return createPortal(
    <Modal className='max-w-[min(1200px,95vw)]' title='Schedule' titleId='schedule-preview-title'>
      <SchedulePicture model={model} />
      <ModalActions>
        <Button onClick={onClose}>Close</Button>
      </ModalActions>
    </Modal>,
    document.body,
  );
}
