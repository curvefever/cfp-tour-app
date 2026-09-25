import { useState, type KeyboardEvent } from 'react';
import { MAX_ROOMS_PER_ROUND, roomIndexToLetter } from '../../../domain/tournament/waterfall-bracket';
import {
  groupRoomByDestination,
  MAX_WATERFALL_ROOM_SIZE,
  type WaterfallDraft,
  type WaterfallDraftRound,
} from '../../../domain/tournament/waterfall-draft';
import { Button, Input, Select } from '../../../components/ui';
import { cn } from '../../../components/ui/cn';
import { destinationColor, destinationName, formatRanks, slotKey, UNSET_COLOR } from './waterfall-format';

export const UNSET_OPTION = '__unset__';

export interface RoundEditorActions {
  onPickSlot: (room: number, rank: number, extend: boolean) => void;
  onSelectAll: () => void;
  onClearPicked: () => void;
  onMirrorChange: (mirror: boolean) => void;
  /** Destination is a round label, 'eliminated', or UNSET_OPTION. */
  onSend: (destination: string) => void;
  /** Returns an error message, or null when the rename went through. */
  onRename: (name: string) => string | null;
  onResize: (roomCount: number, roomSize: number) => void;
  onSetFinal: (isFinal: boolean) => void;
  onDelete: () => void;
}

const fieldLabelClass = 'block text-[0.72rem] font-semibold tracking-[0.08em] text-muted uppercase';

/** Whole number within [1, max], or null. */
function readCount(text: string, max: number): number | null {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

function RoundSettings({ round, actions }: { round: WaterfallDraftRound; actions: RoundEditorActions }) {
  const [name, setName] = useState(round.label);
  const [rooms, setRooms] = useState(String(round.roomCount));
  const [size, setSize] = useState(String(round.roomSize));
  const [nameError, setNameError] = useState('');
  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const commitName = () => {
    const wanted = name.trim();
    if (wanted === round.label) return setName(round.label);
    const error = actions.onRename(wanted);
    setNameError(error ?? '');
    if (error) setName(round.label);
  };
  const commitSize = () => {
    const nextRooms = readCount(rooms, MAX_ROOMS_PER_ROUND);
    const nextSize = readCount(size, MAX_WATERFALL_ROOM_SIZE);
    if (nextRooms === null || nextSize === null) {
      setRooms(String(round.roomCount));
      setSize(String(round.roomSize));
    } else if (nextRooms !== round.roomCount || nextSize !== round.roomSize) {
      actions.onResize(nextRooms, nextSize);
    }
  };

  return (
    <div>
      <div className='flex flex-wrap items-end gap-3'>
        <label className={cn(fieldLabelClass, 'w-32')}>
          Name
          <Input
            className='mt-1'
            maxLength={12}
            onBlur={commitName}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={blurOnEnter}
            value={name}
          />
        </label>
        <label className={cn(fieldLabelClass, 'w-24')}>
          Rooms
          <Input
            className='mt-1'
            inputMode='numeric'
            onBlur={commitSize}
            onChange={(event) => setRooms(event.target.value)}
            onKeyDown={blurOnEnter}
            value={rooms}
          />
        </label>
        <label className={cn(fieldLabelClass, 'w-28')}>
          Players per room
          <Input
            className='mt-1'
            inputMode='numeric'
            onBlur={commitSize}
            onChange={(event) => setSize(event.target.value)}
            onKeyDown={blurOnEnter}
            value={size}
          />
        </label>
        <label className='flex items-center gap-2 pb-2 text-sm'>
          <input
            checked={round.isFinal}
            className='size-4 accent-primary'
            onChange={(event) => actions.onSetFinal(event.target.checked)}
            type='checkbox'
          />
          This is the Final
        </label>
        <span className='flex-1' />
        <Button onClick={actions.onDelete} size='sm' variant='danger'>
          Delete round
        </Button>
      </div>
      {nameError ? <p className='mt-1 text-xs text-danger'>{nameError}</p> : null}
    </div>
  );
}

function SelectionToolbar({
  draft,
  round,
  pickedCount,
  mirror,
  actions,
}: {
  draft: WaterfallDraft;
  round: WaterfallDraftRound;
  pickedCount: number;
  mirror: boolean;
  actions: RoundEditorActions;
}) {
  const otherRounds = draft.rounds.filter((candidate) => candidate.label !== round.label);
  return (
    <div className='mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-surface-low px-3 py-2.5'>
      <span className='text-sm text-muted'>
        {pickedCount > 0
          ? `${pickedCount} slot${pickedCount > 1 ? 's' : ''} selected`
          : 'Click a rank to select it. Shift-click selects a range.'}
      </span>
      <Button onClick={actions.onSelectAll} size='sm' variant='ghost'>
        Select all
      </Button>
      <Button disabled={pickedCount === 0} onClick={actions.onClearPicked} size='sm' variant='ghost'>
        Clear selection
      </Button>
      <span className='flex-1' />
      <label className='flex items-center gap-2 text-sm'>
        <input
          checked={mirror}
          className='size-4 accent-primary'
          onChange={(event) => actions.onMirrorChange(event.target.checked)}
          type='checkbox'
        />
        Apply to every room
      </label>
      <div className='w-52'>
        <Select
          aria-label='Send selected ranks to'
          disabled={pickedCount === 0}
          onChange={(event) => event.target.value && actions.onSend(event.target.value)}
          value=''
        >
          <option value=''>Send selected to…</option>
          {otherRounds.map((candidate) => (
            <option key={candidate.label} value={candidate.label}>
              {candidate.label}
            </option>
          ))}
          <option value='eliminated'>Eliminated</option>
          <option value={UNSET_OPTION}>Clear destination</option>
        </Select>
      </div>
    </div>
  );
}

function slotDescription(destination: string | null): string {
  if (destination === null) return 'no destination';
  return destination === 'eliminated' ? 'eliminated' : `to ${destination}`;
}

function RoomSlots({
  draft,
  round,
  room,
  picked,
  onPickSlot,
}: {
  draft: WaterfallDraft;
  round: WaterfallDraftRound;
  room: number;
  picked: ReadonlySet<string>;
  onPickSlot: RoundEditorActions['onPickSlot'];
}) {
  const slots = draft.routes[round.label]?.[room] ?? [];
  const roomName = round.roomCount > 1 ? `Room ${roomIndexToLetter(room + 1)}` : 'The room';
  const summary = groupRoomByDestination(slots)
    .map(({ destination, ranks }) => `${formatRanks(ranks)} → ${destinationName(destination)}`)
    .join('  ·  ');
  return (
    <div className='mt-4'>
      <div className='mb-1.5 flex flex-wrap items-baseline justify-between gap-2'>
        <b>{roomName}</b>
        <span className='font-mono text-xs text-muted'>{summary || 'nothing routed yet'}</span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {slots.map((destination, index) => {
          const rank = index + 1;
          const isPicked = picked.has(slotKey(room, rank));
          const color = destinationColor(draft, destination);
          return (
            <button
              aria-label={`${roomName}, rank ${rank}, ${slotDescription(destination)}`}
              aria-pressed={isPicked}
              className={cn(
                'flex min-h-13 w-14 cursor-pointer flex-col items-center justify-center rounded-md border-2 px-0.5 leading-tight',
                destination === null && 'border-dashed',
                isPicked && 'ring-2 ring-foreground',
              )}
              key={rank}
              onClick={(event) => onPickSlot(room, rank, event.shiftKey)}
              style={{ borderColor: color, backgroundColor: `${color}22` }}
              type='button'
            >
              <span className='text-base font-semibold tabular-nums'>{rank}</span>
              <span
                className='max-w-13 truncate text-[0.65rem]'
                style={{ color: destination === null ? UNSET_COLOR : color }}
              >
                {destination === null ? 'unset' : destinationName(destination)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WaterfallRoundEditor({
  draft,
  round,
  incomingPlayers,
  picked,
  mirror,
  actions,
}: {
  draft: WaterfallDraft;
  round: WaterfallDraftRound;
  incomingPlayers: number;
  picked: ReadonlySet<string>;
  mirror: boolean;
  actions: RoundEditorActions;
}) {
  return (
    <div>
      <RoundSettings
        actions={actions}
        key={`${round.label}-${round.roomCount}-${round.roomSize}`}
        round={round}
      />
      {round.isFinal ? (
        <div className='mt-3 rounded-lg bg-surface-low p-4'>
          <b>Final</b>
          <p className='mt-1 text-sm text-muted'>
            Nothing routes out of the Final. It receives {incomingPlayers} of the{' '}
            {round.roomCount * round.roomSize} players it needs.
          </p>
        </div>
      ) : (
        <>
          <SelectionToolbar
            actions={actions}
            draft={draft}
            mirror={mirror}
            pickedCount={picked.size}
            round={round}
          />
          {Array.from({ length: round.roomCount }, (_, room) => (
            <RoomSlots
              draft={draft}
              key={room}
              onPickSlot={actions.onPickSlot}
              picked={picked}
              room={room}
              round={round}
            />
          ))}
        </>
      )}
    </div>
  );
}
