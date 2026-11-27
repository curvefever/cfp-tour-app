import { useEffect, useRef, useState } from 'react';
import { readExited, readLastView, type ExitedMemory, type LastView } from '../../lib/persistence/storage';

/**
 * What a visit starts from, read once in the browser: the id in the address and the remembered last view and exited
 * tournament. `hydrated` turns true once they are read; until then nothing of the provider runs.
 */
export function useVisitMemory() {
  const [hydrated, setHydrated] = useState(false);
  const initialUrlId = useRef<string | null>(null);
  const memory = useRef<{ lastView: LastView | null; exited: ExitedMemory | null }>({
    lastView: null,
    exited: null,
  });

  useEffect(() => {
    initialUrlId.current = new URLSearchParams(window.location.search).get('t');
    memory.current = {
      lastView: readLastView(window.localStorage),
      exited: readExited(window.localStorage),
    };
    setHydrated(true);
  }, []);

  return { hydrated, initialUrlId, memory };
}
