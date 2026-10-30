import { useState, type KeyboardEvent } from 'react';
import { MAX_ROOMS_PER_ROUND, roomIndexToLetter } from '../../../domain/tournament/waterfall-bracket';
import {
  groupRoomByDestination,
  groupRoomWithOut,
  MAX_WATERFALL_ROOM_SIZE,
  type WaterfallColumnChoices,
  type WaterfallDraft,
  type WaterfallDraftRound,
  type WaterfallMatch,
  type WaterfallSlotDestination,
} from '../../../domain/tournament/waterfall-draft';
import { Button, Input, Select } from '../../../components/ui';
import { cn } from '../../../components/ui/cn';
import {
  destinationColor,
  destinationName,
  formatRanks,
  QUAL_DISPLAY_NAME,
  slotKey,
} from './waterfall-format';

export interface RoundEditorActions {
  onPickSlot: (room: number, rank: number, extend: boolean) => void;
  onSelectAll: () => void;
  onClearPicked: () => void;
  onMirrorChange: (mirror: boolean) => void;
  /** Destination is a round label or 'eliminated'. */
  onSend: (destination: string) => void;
  /** Returns an error message, or null when the rename went through. */
  onRename: (name: string) => string | null;
  onResize: (roomCount: number, roomSize: number) => void;
  onSetFinal: (isFinal: boolean) => void;
  /** A whole column number, or null to leave the round's column automatic. */
  onSetColumn: (column: number | null) => void;
  /** The round's own match format, or null for the default. */
  onSetMatch: (match: WaterfallMatch | null) => void;
  onDelete: () => void;
  /** Shows more ranks in the qualification table (only offered while the head count isn't known). */
  onAddRanks?: () => void;
}

const MAX_ROUND_NAME_LENGTH = 30;
const fieldLabelClass = 'block text-[0.72rem] font-semibold tracking-[0.08em] text-muted uppercase';

/** Where the Column select gets its numbers; absent when the columns aren't shown. */
export interface RoundColumnInfo {
  /** The round's column as validation numbers it, undefined while that can't be worked out. */
  current?: number;
  /** What the select offers, null while the columns can't be worked out. */
  choices: WaterfallColumnChoices | null;
}

const AUTOMATIC_VALUE = 'automatic';

/** The round's column: a select the organiser changes, or the same select disabled (a round that has started, or a read-only view). */
function ColumnField({
  round,
  info,
  onSetColumn,
}: {
  round: WaterfallDraftRound;
  info: RoundColumnInfo;
  onSetColumn?: (column: number | null) => void;
}) {
  const { choices } = info;
  if (!onSetColumn) {
    return (
      <label className={cn(fieldLabelClass, 'w-52')}>
        Column
        <Select className='mt-1' disabled value='shown'>
          <option value='shown'>
            {info.current === undefined ? 'Not known' : `Column ${info.current}`}
            {round.column === null ? ' (automatic)' : ''}
          </option>
        </Select>
      </label>
    );
  }
  const numbers = choices?.numbers ?? (round.column === null ? [] : [round.column]);
  return (
    <label className={cn(fieldLabelClass, 'w-52')}>
      Column
      <Select
        className='mt-1'
        onChange={(event) =>
          onSetColumn(event.target.value === AUTOMATIC_VALUE ? null : Number(event.target.value))
        }
        value={round.column === null ? AUTOMATIC_VALUE : String(round.column)}
      >
        <option value={AUTOMATIC_VALUE}>
          {choices ? `Automatic (column ${choices.automatic})` : 'Automatic'}
        </option>
        {numbers.map((number) => (
          <option key={number} value={number}>
            Column {number}
          </option>
        ))}
      </Select>
    </label>
  );
}

const DEFAULT_MATCH_VALUE = 'default';
const MATCH_CHOICES: WaterfallMatch[] = [
  { kind: 'games', games: 2 },
  { kind: 'games', games: 3 },
  { kind: 'games', games: 4 },
  { kind: 'best-of', bestOf: 3 },
  { kind: 'best-of', bestOf: 5 },
  { kind: 'best-of', bestOf: 7 },
];

function matchValue(match: WaterfallMatch | null): string {
  if (match === null) return DEFAULT_MATCH_VALUE;
  return match.kind === 'best-of' ? `best-of-${match.bestOf}` : `games-${match.games}`;
}

function matchLabel(match: WaterfallMatch): string {
  if (match.kind === 'best-of') return `Best of ${match.bestOf}`;
  return match.games === 1 ? '1 game' : `${match.games} games, summed`;
}

/** The round's match format: a select the organiser changes, or the same select disabled (a round that has started, or a read-only view). */
function MatchField({
  round,
  finalsGames,
  onSetMatch,
}: {
  round: WaterfallDraftRound;
  finalsGames?: number;
  onSetMatch?: (match: WaterfallMatch | null) => void;
}) {
  const defaultLabel = !round.isFinal
    ? '1 game'
    : finalsGames === undefined
      ? 'Finals format'
      : `Finals format (${finalsGames} ${finalsGames === 1 ? 'game' : 'games'})`;
  // A format typed into the graph text that the list doesn't offer (BO9, GAMES 1 on the Final) stays selectable.
  const unlisted =
    round.match !== null && !MATCH_CHOICES.some((choice) => matchValue(choice) === matchValue(round.match))
      ? round.match
      : null;
  const choices = unlisted ? [...MATCH_CHOICES, unlisted] : MATCH_CHOICES;
  return (
    <label className={cn(fieldLabelClass, 'w-52')}>
      Match
      <Select
        className='mt-1'
        disabled={!onSetMatch}
        onChange={(event) =>
          onSetMatch?.(choices.find((choice) => matchValue(choice) === event.target.value) ?? null)
        }
        value={matchValue(round.match)}
      >
        <option value={DEFAULT_MATCH_VALUE}>{defaultLabel}</option>
        {choices.map((choice) => (
          <option key={matchValue(choice)} value={matchValue(choice)}>
            {matchLabel(choice)}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Whole number within [1, max], or null. */
function readCount(text: string, max: number): number | null {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

function RoundSettings({
  round,
  actions,
  columns,
  finalsGames,
}: {
  round: WaterfallDraftRound;
  actions: RoundEditorActions;
  columns?: RoundColumnInfo;
  finalsGames?: number;
}) {
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
            maxLength={MAX_ROUND_NAME_LENGTH}
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
        {columns ? <ColumnField info={columns} onSetColumn={actions.onSetColumn} round={round} /> : null}
        <MatchField finalsGames={finalsGames} onSetMatch={actions.onSetMatch} round={round} />
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
  destinations,
  pickedCount,
  mirror,
  showMirror,
  actions,
}: {
  destinations: WaterfallDraftRound[];
  pickedCount: number;
  mirror: boolean;
  /** "Apply to every room": a round has rooms, the qualification table doesn't. */
  showMirror: boolean;
  actions: RoundEditorActions;
}) {
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
      {showMirror ? (
        <label className='flex items-center gap-2 text-sm'>
          <input
            checked={mirror}
            className='size-4 accent-primary'
            onChange={(event) => actions.onMirrorChange(event.target.checked)}
            type='checkbox'
          />
          Apply to every room
        </label>
      ) : null}
      <div className='w-52'>
        <Select
          aria-label='Send selected ranks to'
          disabled={pickedCount === 0}
          onChange={(event) => event.target.value && actions.onSend(event.target.value)}
          value=''
        >
          <option value=''>Send selected to…</option>
          {destinations.map((candidate) => (
            <option key={candidate.label} value={candidate.label}>
              {candidate.label}
            </option>
          ))}
          <option value='eliminated'>Eliminated</option>
        </Select>
      </div>
    </div>
  );
}

function slotDescription(destination: string | null): string {
  return destination === null ? 'eliminated' : `to ${destination}`;
}

/** One row of clickable rank slots: a room of a round, or the qualification table's standings. */
function SlotGrid({
  draft,
  slots,
  room,
  name,
  summarizeOut,
  picked,
  onPickSlot,
}: {
  draft: WaterfallDraft;
  slots: WaterfallSlotDestination[];
  room: number;
  name: string;
  /** The summary line also says where the ranks that are out go: a room does, the qualification table's open tail doesn't. */
  summarizeOut: boolean;
  picked: ReadonlySet<string>;
  onPickSlot?: RoundEditorActions['onPickSlot'];
}) {
  const summary = (summarizeOut ? groupRoomWithOut(slots) : groupRoomByDestination(slots))
    .map(({ destination, ranks }) => `${formatRanks(ranks)} → ${destinationName(destination)}`)
    .join('  ·  ');
  return (
    <div className='mt-4'>
      <div className='mb-1.5 flex flex-wrap items-baseline justify-between gap-2'>
        <b>{name}</b>
        <span className='font-mono text-xs text-muted'>{summary || 'nothing routed yet'}</span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {slots.map((destination, index) => {
          const rank = index + 1;
          const isPicked = picked.has(slotKey(room, rank));
          const color = destinationColor(draft, destination);
          const className = cn(
            'flex min-h-13 w-14 flex-col items-center justify-center rounded-md border-2 px-0.5 leading-tight',
            isPicked && 'ring-2 ring-foreground',
          );
          const style = {
            borderColor: color,
            backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
          };
          const content = (
            <>
              <span className='text-base font-semibold tabular-nums'>{rank}</span>
              <span className='max-w-13 truncate text-[0.65rem]' style={{ color }}>
                {destinationName(destination)}
              </span>
            </>
          );
          const label = `${name}, rank ${rank}, ${slotDescription(destination)}`;
          // No onPickSlot (a read-only editor): a plain div, not a button --
          // out of the tab order and with no click/hover affordance at all,
          // rather than a button that merely does nothing when pressed.
          return onPickSlot ? (
            <button
              aria-label={label}
              aria-pressed={isPicked}
              className={cn(className, 'cursor-pointer')}
              key={rank}
              onClick={(event) => onPickSlot(room, rank, event.shiftKey)}
              style={style}
              type='button'
            >
              {content}
            </button>
          ) : (
            <div aria-label={label} className={className} key={rank} style={style}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  onPickSlot?: RoundEditorActions['onPickSlot'];
}) {
  return (
    <SlotGrid
      draft={draft}
      name={round.roomCount > 1 ? `Room ${roomIndexToLetter(room + 1)}` : 'The room'}
      onPickSlot={onPickSlot}
      picked={picked}
      room={room}
      slots={draft.routes[round.label]?.[room] ?? []}
      summarizeOut
    />
  );
}

/** The qualification table as a source: one slot per final standing, routed like a room's ranks. A rank left as "out" is eliminated. */
export function QualificationTableEditor({
  draft,
  picked,
  actions,
}: {
  draft: WaterfallDraft;
  picked: ReadonlySet<string>;
  actions?: RoundEditorActions;
}) {
  const slots = draft.qualRoutes ?? [];
  return (
    <div>
      <div className='flex flex-wrap items-center gap-3'>
        <b>{QUAL_DISPLAY_NAME}</b>
        <span className='text-sm text-muted'>
          Where each final standing goes. Rank 1 is the top of the table; a rank left as "out" is eliminated
          when qualification ends.
        </span>
      </div>
      {actions ? (
        <SelectionToolbar
          actions={actions}
          destinations={draft.rounds}
          mirror={false}
          pickedCount={picked.size}
          showMirror={false}
        />
      ) : null}
      <SlotGrid
        draft={draft}
        name={QUAL_DISPLAY_NAME}
        onPickSlot={actions?.onPickSlot}
        picked={picked}
        room={0}
        slots={slots}
        summarizeOut={false}
      />
      {actions?.onAddRanks ? (
        <Button className='mt-3' onClick={actions.onAddRanks} size='sm'>
          + Add ranks
        </Button>
      ) : null}
    </div>
  );
}

function RoundSummary({
  round,
  columns,
  finalsGames,
  onSetMatch,
}: {
  round: WaterfallDraftRound;
  columns?: RoundColumnInfo;
  finalsGames?: number;
  /** Given for a round in play: its match format can still change; a finished round shows it disabled. */
  onSetMatch?: (match: WaterfallMatch | null) => void;
}) {
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <b>{round.label}</b>
      <span className='text-sm text-muted'>
        {round.roomCount > 1 ? `${round.roomCount} rooms × ${round.roomSize}` : `${round.roomSize} players`}
        {round.isFinal ? ' · Final' : ''}
      </span>
      {columns ? <ColumnField info={columns} round={round} /> : null}
      <MatchField finalsGames={finalsGames} onSetMatch={onSetMatch} round={round} />
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
  locked,
  columns,
  finalsGames,
  matchEditable,
}: {
  draft: WaterfallDraft;
  round: WaterfallDraftRound;
  incomingPlayers: number;
  picked: ReadonlySet<string>;
  mirror: boolean;
  /** Omitted for a read-only editor: no control that changes anything is rendered. */
  actions?: RoundEditorActions;
  /** This round already started: its own routing is still editable, but rename/resize/remove/Final-toggle aren't. */
  locked?: boolean;
  /** The Column select's numbers; omitted when the tournament's rounds aren't played in columns. */
  columns?: RoundColumnInfo;
  /** The Finals format, shown on the Final's default Match option. */
  finalsGames?: number;
  /** This round is in play: its Match select works though the round is locked. */
  matchEditable?: boolean;
}) {
  return (
    <div>
      {actions && !locked ? (
        <RoundSettings
          actions={actions}
          columns={columns}
          finalsGames={finalsGames}
          key={`${round.label}-${round.roomCount}-${round.roomSize}`}
          round={round}
        />
      ) : (
        <RoundSummary
          columns={columns}
          finalsGames={finalsGames}
          onSetMatch={actions && matchEditable ? actions.onSetMatch : undefined}
          round={round}
        />
      )}
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
          {actions ? (
            <SelectionToolbar
              actions={actions}
              destinations={draft.rounds.filter((candidate) => candidate.label !== round.label)}
              mirror={mirror}
              pickedCount={picked.size}
              showMirror
            />
          ) : null}
          <p className='mt-3 text-sm text-muted'>A rank left as "out" is eliminated.</p>
          {Array.from({ length: round.roomCount }, (_, room) => (
            <RoomSlots
              draft={draft}
              key={room}
              onPickSlot={actions?.onPickSlot}
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
