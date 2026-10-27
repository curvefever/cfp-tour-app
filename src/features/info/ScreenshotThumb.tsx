import { cn } from '../../components/ui';
import { useScreenshot } from './useScreenshot';

/** A lobby screenshot as a small picture; clicking it asks for the full size. */
export function ScreenshotThumb({
  tournamentId,
  imageId,
  onOpen,
  className,
}: {
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
      <img alt='Screenshot' className='h-full w-full object-cover' src={source.src} />
    </button>
  );
}
