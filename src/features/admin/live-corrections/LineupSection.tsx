import { useState } from 'react';
import { roomLetter } from '../../../domain/tournament/bracket';
import { applyLineupEdit, lineupEditScope } from '../../../domain/tournament/lineup-edit';
import { unitDisplay } from '../../../domain/tournament/roster';
import type { RoundAssignment, TournamentState } from '../../../domain/tournament/types';
import { Alert, Badge, Button, ButtonRow, Select, cn } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { changedNames, eliminateUnit, eliminatedNames, moveUnit, reinstateUnit } from './lineup-draft';

type Scope = Extract<ReturnType<typeof lineupEditScope>, { ok: true }>;

function RoomOptions({ roomCount }: { roomCount: number }) {
  return (
    <>
      {Array.from({ length: roomCount }, (_, index) => (
        <option key={index} value={index + 1}>
          Room {roomLetter(index + 1)}
        </option>
      ))}
    </>
  );
}

function UnitRow({
  state,
  entry,
  roomCount,
  changed,
  canEliminate,
  onMove,
  onEliminate,
}: {
  state: TournamentState;
  entry: RoundAssignment;
  roomCount: number;
  changed: boolean;
  canEliminate: boolean;
  onMove: (room: number) => void;
  onEliminate: () => void;
}) {
  const label = unitDisplay(state, entry.name).label;
  return (
    <div className={cn('flex items-center gap-2 py-1', changed && 'text-primary')}>
      <span className='min-w-0 flex-1 truncate' title={label}>
        {label}
      </span>
      {entry.room === null ? (
        <Badge>Bye</Badge>
      ) : (
        <Select
          aria-label={`Room for ${label}`}
          className='w-auto'
          value={entry.room}
          onChange={(event) => onMove(Number(event.target.value))}
        >
          <RoomOptions roomCount={roomCount} />
        </Select>
      )}
      {canEliminate ? (
        <Button size='sm' variant='danger' onClick={onEliminate}>
          Eliminate
        </Button>
      ) : null}
    </div>
  );
}

function ReinstateRow({
  state,
  names,
  roomCount,
  onReinstate,
}: {
  state: TournamentState;
  names: string[];
  roomCount: number;
  onReinstate: (name: string, room: number) => void;
}) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState(1);
  const selected = names.includes(name) ? name : (names[0] ?? '');
  if (names.length === 0) return null;
  return (
    <div className='mt-3 flex flex-wrap items-center gap-2'>
      <span className='text-sm text-muted'>Reinstate (eliminated in the previous round):</span>
      <Select
        aria-label='Unit to reinstate'
        className='w-auto'
        value={selected}
        onChange={(event) => setName(event.target.value)}
      >
        {names.map((entry) => (
          <option key={entry} value={entry}>
            {unitDisplay(state, entry).label}
          </option>
        ))}
      </Select>
      <span className='text-sm text-muted'>into</span>
      <Select
        aria-label='Room to reinstate into'
        className='w-auto'
        value={room}
        onChange={(event) => setRoom(Number(event.target.value))}
      >
        <RoomOptions roomCount={roomCount} />
      </Select>
      <Button size='sm' onClick={() => onReinstate(selected, room)}>
        Reinstate
      </Button>
    </div>
  );
}

function LineupEditor({ scope }: { scope: Scope }) {
  const app = useTournamentApp();
  const state = app.state;
  const base = state.assignments[scope.roundIndex];
  const [draft, setDraft] = useState<RoundAssignment[]>(base);
  const [error, setError] = useState('');
  const roomCount = scope.rooms.length;
  const changed = changedNames(base, draft);
  const eliminated = eliminatedNames(base, draft);
  const dirty = changed.size > 0;
  const available = scope.reinstatable.filter((name) => !draft.some((entry) => entry.name === name));

  function save() {
    const result = applyLineupEdit(app.state, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    app.updateState(result.state);
  }

  function discard() {
    setDraft(base);
    setError('');
  }

  return (
    <div>
      {scope.rooms.map(({ room }) => (
        <div className='mb-2' key={room}>
          <div className='text-xs font-semibold tracking-[0.08em] text-muted uppercase'>
            Room {roomLetter(room)}
          </div>
          {draft
            .filter((entry) => entry.room === room)
            .map((entry) => (
              <UnitRow
                key={entry.name}
                state={state}
                entry={entry}
                roomCount={roomCount}
                changed={changed.has(entry.name)}
                canEliminate={scope.canEliminate}
                onMove={(next) => setDraft(moveUnit(draft, entry.name, next))}
                onEliminate={() => setDraft(eliminateUnit(draft, entry.name))}
              />
            ))}
        </div>
      ))}
      {draft.some((entry) => entry.room === null) ? (
        <div className='mb-2'>
          <div className='text-xs font-semibold tracking-[0.08em] text-muted uppercase'>Byes</div>
          {draft
            .filter((entry) => entry.room === null)
            .map((entry) => (
              <UnitRow
                key={entry.name}
                state={state}
                entry={entry}
                roomCount={roomCount}
                changed={changed.has(entry.name)}
                canEliminate={scope.canEliminate}
                onMove={() => {}}
                onEliminate={() => setDraft(eliminateUnit(draft, entry.name))}
              />
            ))}
        </div>
      ) : null}
      {eliminated.length > 0 ? (
        <p className='mb-2 text-sm text-danger'>
          Eliminated: {eliminated.map((name) => unitDisplay(state, name).label).join(', ')}
        </p>
      ) : null}
      {scope.canEliminate ? (
        <ReinstateRow
          state={state}
          names={available}
          roomCount={roomCount}
          onReinstate={(name, room) => setDraft(reinstateUnit(draft, name, room))}
        />
      ) : null}
      {error ? (
        <Alert className='mt-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow className='mt-3'>
        <Button disabled={!dirty} variant='primary' onClick={save}>
          Save line-up
        </Button>
        <Button disabled={!dirty} onClick={discard}>
          Discard
        </Button>
      </ButtonRow>
    </div>
  );
}

/** The line-up half of "Correct current round": either the editor or one line saying why it's locked. */
export function LineupSection({ state }: { state: TournamentState }) {
  const scope = lineupEditScope(state);
  if (!scope.ok) return <p className='text-sm text-muted'>{scope.reason}</p>;
  const round = state.rounds[scope.roundIndex];
  // Re-key on the current line-up so a saved edit or an advance starts a fresh draft.
  const signature = state.assignments[scope.roundIndex]
    .map((entry) => `${entry.name}@${entry.room}`)
    .join('|');
  return (
    <div>
      <h3 className='mb-2 text-sm font-semibold'>Correct line-up — Round {round.roundNum} (no scores yet)</h3>
      <LineupEditor key={`${scope.roundIndex}:${signature}`} scope={scope} />
    </div>
  );
}
