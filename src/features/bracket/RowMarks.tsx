import { Badge } from '../../components/ui';

/** Shown on a unit the organiser placed, moved or reinstated through a line-up correction. */
export function ManualMarker() {
  return (
    <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' title='Set by organiser' tone='accent'>
      ✋
    </Badge>
  );
}
