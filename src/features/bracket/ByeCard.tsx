import { Badge, cn } from '../../components/ui';
import { rowSurfaceClasses } from '../tournament/components/result-row';

/** A unit sitting a round out: a one-row card with an orange BYE tag and the name. */
export function ByeCard({ followed = false, name }: { followed?: boolean; name: string }) {
  return (
    <div className='rounded-xs bg-surface outline-2 outline-cfp-game-frame'>
      <div className={cn('flex min-h-8 items-center gap-2 px-3 py-1', rowSurfaceClasses(0, followed))}>
        <Badge tone='warning'>BYE</Badge>
        <span className='truncate text-[15px] font-semibold'>{name}</span>
      </div>
    </div>
  );
}
