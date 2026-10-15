import type { ReactNode } from 'react';
import {
  type ProjectedSlotLabel,
  bracketRoundLabels,
  projectedSlotLabelText,
} from '../../domain/tournament/bracket';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { bracketRowBase, rowSurfaceClasses } from '../tournament/components/result-row';
import { ByeCard } from './ByeCard';
import { RoomFrame } from './RoomCard';
import { type ExitLine, poolingExitLines, roomExitLines } from './exit-lines';
import { roomTitle } from './room-title';

/** One slot of a room that is not drawn yet: an empty dashed stripe, and what will fill it (or the unit already known). */
function SlotRow({ index, known, label }: { index: number; known: boolean; label: string }) {
  return (
    <div className={cn(bracketRowBase, 'flex min-h-8 items-center gap-2', rowSurfaceClasses(index, false))}>
      <span className='w-4.5 shrink-0' />
      <ResultStripe result='undecided' />
      <span className={cn('min-w-0 truncate', known ? 'text-[15px] font-semibold' : 'text-sm text-muted')}>
        {label}
      </span>
    </div>
  );
}

/** A room of a round that is not played yet: a lighter header, then one row per slot. */
function FutureRoom({
  children,
  lines,
  round,
  roomIndex,
}: {
  children: ReactNode;
  lines: ExitLine[];
  round: TournamentRound;
  roomIndex: number;
}) {
  return (
    <RoomFrame future lines={lines} title={roomTitle(round, roomIndex)}>
      {children}
    </RoomFrame>
  );
}

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
  if (!round.rooms.length) return <div className='text-sm text-muted'>Not yet seeded</div>;
  const rule = roundExitRule(state, roundIndex);
  // Where the places of a room go: its bands for a bracket round, what a place earns for a pooling round.
  const linesOf = (roomIndex: number) =>
    rule.kind === 'per-room'
      ? roomExitLines(rule.rooms[roomIndex] ?? [], labels)
      : poolingExitLines(state, roundIndex, round.rooms[roomIndex]);
  const knownRow = (name: string, index: number) => (
    <SlotRow index={index} key={name} known label={unitDisplay(state, name).label} />
  );
  if (round.fixedRoomAssignments) {
    // A pre-published draw -- the real room assignment is already fully decided at generation time (see
    // fixed-draws.ts / docs/seeding.md), so show it directly instead of a projected/TBD placeholder.
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
        {round.rooms.map((_, roomIndex) => (
          <FutureRoom key={roomIndex} lines={linesOf(roomIndex)} round={round} roomIndex={roomIndex}>
            {(byRoom.get(roomIndex + 1) ?? []).map(knownRow)}
          </FutureRoom>
        ))}
        {byes.map((name) => (
          <ByeCard key={name} name={unitDisplay(state, name).label} />
        ))}
      </>
    );
  }
  if (round.isGroupStage) {
    return (
      <>
        {(round.matches ?? []).map((match, roomIndex) => (
          <FutureRoom key={roomIndex} lines={linesOf(roomIndex)} round={round} roomIndex={roomIndex}>
            {match.pair.map(knownRow)}
          </FutureRoom>
        ))}
        {(round.groupByes ?? []).map((name) => (
          <ByeCard key={name} name={unitDisplay(state, name).label} />
        ))}
      </>
    );
  }
  return (
    <>
      {round.rooms.map((slots, roomIndex) => {
        const roomLabels = projected?.[roomIndex] ?? null;
        return (
          <FutureRoom lines={linesOf(roomIndex)} key={roomIndex} round={round} roomIndex={roomIndex}>
            {Array.from({ length: slots }, (_, slot) => (
              <SlotRow
                index={slot}
                key={slot}
                known={false}
                label={roomLabels?.[slot] ? projectedSlotLabelText(roomLabels[slot]) : '—'}
              />
            ))}
          </FutureRoom>
        );
      })}
      {round.pairingTBD ? <div className='text-[0.68rem] text-muted'>Pairings determined live</div> : null}
    </>
  );
}
