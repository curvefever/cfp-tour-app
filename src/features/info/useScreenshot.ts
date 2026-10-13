import { useEffect, useState } from 'react';
import { fetchScreenshotOnce } from '../sync/firebase-client';
import { cacheScreenshot, readCachedScreenshot } from './screenshot-cache';

export type ScreenshotSource =
  { status: 'loading' } | { status: 'missing' } | { status: 'ready'; src: string };

/** One screenshot, read once when it is shown: from the cache of this browser if it has it, else from the database. */
export function useScreenshot(tournamentId: string, imageId: string): ScreenshotSource {
  const [source, setSource] = useState<ScreenshotSource>({ status: 'loading' });
  useEffect(() => {
    const cached = readCachedScreenshot(window.localStorage, imageId);
    if (cached) {
      setSource({ status: 'ready', src: cached });
      return;
    }
    let cancelled = false;
    setSource({ status: 'loading' });
    fetchScreenshotOnce(tournamentId, imageId).then(
      (dataUrl) => {
        if (cancelled) return;
        if (dataUrl === null) {
          setSource({ status: 'missing' });
          return;
        }
        cacheScreenshot(window.localStorage, imageId, dataUrl);
        setSource({ status: 'ready', src: dataUrl });
      },
      () => !cancelled && setSource({ status: 'missing' }),
    );
    return () => {
      cancelled = true;
    };
  }, [tournamentId, imageId]);
  return source;
}
