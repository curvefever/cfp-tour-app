import {
  type ProjectedSlotLabel,
  bracketRoundLabels,
  projectedSlotLabelText,
  roomLetter,
} from '../../domain/tournament/bracket';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { bracketRowBase } from '../tournament/components/result-row';
import { RoomLabel } from './RoomCard';
import { RoomExitChips, RoundExitSummary } from './RoomExits';
import { KingsValleyDisclaimer, LuckyLoserDisclaimer } from './RoundNotes';

export function PlaceholderRound({
  round,
  roundIndex,
  state,
  projected,
  labels,
}: {
  round: TournamentRound;
  roundIndex: number;
  state: TournamentState;
  projected: ProjectedSlotLabel[][] | null;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (!round.rooms.length) return <div className='text-muted'>Not yet seeded</div>;
  const rule = roundExitRule(state, roundIndex);
  const summary = <RoundExitSummary rule={rule} labels={labels} rankedUnits={state.players.length} />;
  if (round.fixedRoomAssignments) {
    // A pre-published draw -- the real room assignment is already fully
    // decided at generation time (see fixed-draws.ts / docs/seeding.md), so
    // show it directly instead of a projected/TBD placeholder, matching the
    // whole point of publishing a draw upfront.
    const byRoom = new Map<number, string[]>();
    const byes: string[] = [];
    for (const entry of round.fixedRoomAssignments) {
      if (entry.room === null) {
        byes.push(entry.name);
      } else {
        byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
      }
    }
    return (
      <>
        {summary}
        {round.rooms.map((slots, roomIndex) => (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomLetter(roomIndex + 1)} ({slots})
            </RoomLabel>
            {(byRoom.get(roomIndex + 1) ?? []).map((name) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={name}
              >
                {unitDisplay(state, name).label}
              </div>
            ))}
          </div>
        ))}
        {byes.map((name) => (
          <div
            className='mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning'
            key={name}
          >
            <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
            {unitDisplay(state, name).label}
          </div>
        ))}
      </>
    );
  }
  if (round.isGroupStage) {
    return (
      <>
        {summary}
        {(round.matches ?? []).map((match, roomIndex) => (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Group {match.group} · Room {roomLetter(roomIndex + 1)} ({round.rooms[roomIndex]})
            </RoomLabel>
            {match.pair.map((name) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={name}
              >
                {unitDisplay(state, name).label}
              </div>
            ))}
          </div>
        ))}
        {(round.groupByes ?? []).map((name) => (
          <div
            className='mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning'
            key={name}
          >
            <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
            {unitDisplay(state, name).label}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {summary}
      {round.rooms.map((slots, roomIndex) => {
        const roomLabels = projected?.[roomIndex] ?? null;
        const bands = rule.kind === 'per-room' ? rule.rooms[roomIndex] : [];
        return (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomLetter(roomIndex + 1)} ({slots})
            </RoomLabel>
            <RoomExitChips bands={bands} labels={labels} />
            {Array.from({ length: slots }, (_, slot) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={slot}
              >
                {roomLabels?.[slot] ? projectedSlotLabelText(roomLabels[slot]) : '—'}
              </div>
            ))}
          </div>
        );
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.isKingsValley ? <KingsValleyDisclaimer /> : null}
      {round.pairingTBD ? (
        <div className='mt-1.5 text-[0.68rem] text-warning'>Pairings determined live</div>
      ) : null}
    </>
  );
}
