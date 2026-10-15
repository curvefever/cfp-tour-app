import { cn } from '../../../components/ui';
import { panelLabelClassName } from '../../../components/ui/typography';
import type { RoomProgress } from '../progress-summary';

function roomStatus(room: RoomProgress): { label: string; dot: string; bar: string } {
  if (room.players > 0 && room.scored === room.players) {
    return { label: 'Scored', dot: 'bg-success', bar: 'bg-success' };
  }
  if (room.hasScores) return { label: 'Being scored', dot: 'bg-primary', bar: 'bg-primary' };
  return { label: 'Not started', dot: 'border-2 border-cfp-mid-stage-dot', bar: 'bg-primary' };
}

const ROW = 'grid grid-cols-[90px_90px_minmax(0,1fr)_150px_170px] items-center gap-4 px-3.5';

/** The current round's rooms, read-only: who plays, how many scores are in, and whether the line-up is locked. */
export function RoomsOverview({ rooms }: { rooms: RoomProgress[] }) {
  if (rooms.length === 0) return null;
  return (
    <div className='overflow-x-auto'>
      <div className='flex min-w-160 flex-col gap-1.5'>
        <div className={cn(ROW, panelLabelClassName)}>
          <div>ROOM</div>
          <div>PLAYERS</div>
          <div>SCORES</div>
          <div>STATUS</div>
          <div />
        </div>
        {rooms.map((room) => {
          const status = roomStatus(room);
          return (
            <div className={cn(ROW, 'min-h-11.5 rounded bg-surface-low')} key={room.name}>
              <div className='text-[15px] font-bold'>{room.name}</div>
              <div className='text-sm text-cfp-text-soft'>{room.players}</div>
              <div className='flex items-center gap-3'>
                <div aria-hidden='true' className='h-1.5 flex-1 overflow-hidden rounded-[3px] bg-input'>
                  <div
                    className={cn('h-1.5', status.bar)}
                    style={{ width: `${room.players ? Math.round((room.scored / room.players) * 100) : 0}%` }}
                  />
                </div>
                <div className='w-10 shrink-0 text-right text-[13px] font-bold'>
                  {room.scored}/{room.players}
                </div>
              </div>
              <div className='flex items-center gap-2 text-sm'>
                <span aria-hidden='true' className={cn('size-2 rounded-full', status.dot)} />
                {status.label}
              </div>
              <div className='text-right text-[13px] text-muted'>
                {room.hasScores ? 'Has scores · locked' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
