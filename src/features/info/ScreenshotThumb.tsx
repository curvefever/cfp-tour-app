import { cn } from '../../components/ui';
import { useScreenshot } from './useScreenshot';

/** A stored picture (a lobby screenshot, a settings picture) as a small image; clicking it asks for the full size. */
export function ScreenshotThumb({
  alt = 'Screenshot',
  tournamentId,
  imageId,
  onOpen,
  className,
}: {
  alt?: string;
  tournamentId: string;
  imageId: string;
  onOpen?: (src: string) => void;
  className?: string;
}) {
  const source = useScreenshot(tournamentId, imageId);
  const frame = cn(
    'flex h-24 w-36 items-center justify-center overflow-hidden rounded-[5px] border border-surface-hover bg-surface-low text-xs text-muted',
    className,
  );
  if (source.status === 'loading') return <div className={frame}>Loading…</div>;
  if (source.status === 'missing') return <div className={frame}>Not available</div>;
  return (
    <button
      className={cn(frame, 'cursor-zoom-in p-0 focus-visible:outline-2 focus-visible:outline-primary')}
      onClick={() => onOpen?.(source.src)}
      type='button'
    >
      <img alt={alt} className='h-full w-full object-cover' src={source.src} />
    </button>
  );
}
