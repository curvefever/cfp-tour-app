import { useEffect } from 'react';

/** Calls `onClose` when Escape is pressed, for as long as the window that uses it is open. */
export function useCloseOnEscape(onClose: () => void): void {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
}
