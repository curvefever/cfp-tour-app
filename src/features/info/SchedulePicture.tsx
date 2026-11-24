import { useEffect, useRef, useState } from 'react';
import { buildSchedulePicture } from './schedule-picture-draw';
import type { SchedulePictureModel } from './schedule-picture-types';

interface ShownPicture {
  url: string;
  width: number;
  height: number;
}

/**
 * The schedule as a PNG `<img>`, so a right-click (a long press on a phone) copies it. It is drawn again whenever the
 * model changes (compared by what it says, not by identity), keeps the previous picture while a new one is drawn,
 * and shows nothing where there is no canvas to draw on.
 */
export function SchedulePicture({ model }: { model: SchedulePictureModel }) {
  const [shown, setShown] = useState<ShownPicture | null>(null);
  const urlRef = useRef<string | null>(null);
  const key = JSON.stringify(model);

  useEffect(() => {
    let cancelled = false;
    buildSchedulePicture(JSON.parse(key) as SchedulePictureModel)
      .then((image) => {
        if (cancelled || !image) return;
        const url = URL.createObjectURL(image.blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setShown({ url, width: image.width, height: image.height });
      })
      .catch(() => {
        // A picture that cannot be drawn is left out; the rest of the page is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  if (!shown) return null;
  return (
    <div className='max-h-[80vh] overflow-auto rounded-xs'>
      <img
        alt={`The schedule of ${model.header.title}: every round, its rooms and where each place goes`}
        className='block h-auto max-w-none'
        height={shown.height}
        src={shown.url}
        style={{ width: shown.width }}
        width={shown.width}
      />
    </div>
  );
}
