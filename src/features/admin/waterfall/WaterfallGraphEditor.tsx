import { useMemo, useState } from 'react';
import type { RoomSize } from '../../../domain/tournament/types';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
} from '../../../domain/tournament/waterfall-bracket';
import {
  addWaterfallRound,
  assignWaterfallSlots,
  blankWaterfallDraft,
  parseWaterfallDraft,
  removeWaterfallRound,
  renameWaterfallRound,
  resizeWaterfallRound,
  serializeWaterfallDraft,
  setWaterfallFinal,
  waterfallRoundIntake,
  type WaterfallDraft,
} from '../../../domain/tournament/waterfall-draft';
import { WATERFALL_EXAMPLES } from '../../../domain/tournament/waterfall-examples';
import { Alert, Button, ButtonRow } from '../../../components/ui';
import { UNSET_OPTION, WaterfallRoundEditor, type RoundEditorActions } from './WaterfallRoundEditor';
import { WaterfallRoundList } from './WaterfallRoundList';
import { WaterfallSidePanel, type GraphStatus } from './WaterfallSidePanel';
import { parseSlotKey, slotKey } from './waterfall-format';

interface EditorProps {
  /** The persisted ROUNDS:/ROUTES: text; the editor reads it and writes it back on every change. */
  text: string;
  onChange: (text: string) => void;
  /** Players entering the bracket, or null while it can't be known yet. */
  entrantCount: number | null;
  roomSize: RoomSize;
}

function roundHasRoutedSlots(draft: WaterfallDraft, label: string): boolean {
  return (draft.routes[label] ?? []).some((room) => room.some((slot) => slot !== null));
}

function hasRoutedSlots(draft: WaterfallDraft): boolean {
  return draft.rounds.some((round) => roundHasRoutedSlots(draft, round.label));
}

function StartButtons({ onBlank, onExample }: { onBlank?: () => void; onExample: (text: string) => void }) {
  return (
    <>
      {onBlank ? (
        <Button onClick={onBlank} size='sm'>
          Blank start
        </Button>
      ) : null}
      {WATERFALL_EXAMPLES.map((example) => (
        <Button key={example.id} onClick={() => onExample(example.text)} size='sm'>
          Example: {example.label}
        </Button>
      ))}
    </>
  );
}

function DraftEditor({
  draft,
  text,
  status,
  onChange,
  entrantCount,
  roomSize,
}: EditorProps & { draft: WaterfallDraft; status: GraphStatus }) {
  const [selectedLabel, setSelectedLabel] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [lastRank, setLastRank] = useState<number | null>(null);
  const [mirror, setMirror] = useState(true);
  const round = draft.rounds.find((candidate) => candidate.label === selectedLabel) ?? draft.rounds[0];
  const intake = waterfallRoundIntake(draft);

  const clearPicked = () => {
    setPicked(new Set());
    setLastRank(null);
  };
  const commit = (next: WaterfallDraft) => {
    onChange(serializeWaterfallDraft(next));
    clearPicked();
  };
  const select = (label: string) => {
    setSelectedLabel(label);
    clearPicked();
  };
  const confirmReplace = () =>
    !hasRoutedSlots(draft) || window.confirm('Replace the current graph? Every routed rank will be lost.');

  const actions: RoundEditorActions = {
    onPickSlot: (room, rank, extend) => {
      const rooms = mirror ? Array.from({ length: round.roomCount }, (_, index) => index) : [room];
      const from = extend && lastRank !== null ? Math.min(lastRank, rank) : rank;
      const to = extend && lastRank !== null ? Math.max(lastRank, rank) : rank;
      const turnOn = !picked.has(slotKey(room, rank));
      const next = new Set(picked);
      for (const targetRoom of rooms) {
        for (let target = from; target <= to; target += 1) {
          if (turnOn) next.add(slotKey(targetRoom, target));
          else next.delete(slotKey(targetRoom, target));
        }
      }
      setPicked(next);
      setLastRank(rank);
    },
    onSelectAll: () => {
      const all = new Set<string>();
      for (let room = 0; room < round.roomCount; room += 1) {
        for (let rank = 1; rank <= round.roomSize; rank += 1) all.add(slotKey(room, rank));
      }
      setPicked(all);
    },
    onClearPicked: clearPicked,
    onMirrorChange: setMirror,
    onSend: (destination) => {
      const slots = [...picked].map(parseSlotKey);
      commit(
        assignWaterfallSlots(draft, round.label, slots, destination === UNSET_OPTION ? null : destination),
      );
    },
    onRename: (name) => {
      const result = renameWaterfallRound(draft, round.label, name);
      if (!result.ok) return result.error;
      setSelectedLabel(name);
      commit(result.value);
      return null;
    },
    onResize: (roomCount, roomSize) => commit(resizeWaterfallRound(draft, round.label, roomCount, roomSize)),
    onSetFinal: (isFinal) => {
      if (
        isFinal &&
        roundHasRoutedSlots(draft, round.label) &&
        !window.confirm(
          `Make ${round.label} the Final? Nothing routes out of the Final, so its routing is lost.`,
        )
      ) {
        return;
      }
      commit(setWaterfallFinal(draft, round.label, isFinal));
    },
    onDelete: () => {
      const isDestination = (intake.incoming[round.label] ?? 0) > 0;
      if (
        (roundHasRoutedSlots(draft, round.label) || isDestination) &&
        !window.confirm(
          `Delete ${round.label}? Its routing is lost, and ranks that pointed at it become unset.`,
        )
      ) {
        return;
      }
      setSelectedLabel('');
      commit(removeWaterfallRound(draft, round.label));
    },
  };

  const addRound = () => {
    const next = addWaterfallRound(draft, round.roomSize);
    const added = next.rounds.find((candidate) => !draft.rounds.some((old) => old.label === candidate.label));
    commit(next);
    setSelectedLabel(added?.label ?? '');
  };
  const startBlank = () => {
    if (!confirmReplace()) return;
    setSelectedLabel('');
    commit(blankWaterfallDraft(entrantCount, roomSize));
  };
  const loadExample = (exampleText: string) => {
    if (!confirmReplace()) return;
    setSelectedLabel('');
    onChange(exampleText);
    clearPicked();
  };

  return (
    <div>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <span className='text-sm'>
          Players entering the bracket: <b>{entrantCount ?? 'not known yet'}</b>
          {entrantCount === null ? (
            <span className='text-xs text-muted'> (load a roster and set "Advance to bracket")</span>
          ) : null}
        </span>
        <span className='flex-1' />
        <span className='text-xs text-muted'>Start over from:</span>
        <StartButtons onBlank={startBlank} onExample={loadExample} />
      </div>
      <div className='grid gap-4 min-[901px]:grid-cols-[11rem_minmax(0,1fr)_18rem]'>
        <div>
          <div className='mb-2 text-[0.72rem] font-semibold tracking-[0.12em] text-muted uppercase'>
            Rounds
          </div>
          <WaterfallRoundList
            draft={draft}
            entrantCount={entrantCount}
            intake={intake}
            onSelect={select}
            selected={round.label}
          />
          <Button className='mt-2 w-full' onClick={addRound} size='sm'>
            + Add round
          </Button>
        </div>
        <WaterfallRoundEditor
          actions={actions}
          draft={draft}
          incomingPlayers={intake.incoming[round.label] ?? 0}
          mirror={mirror}
          picked={picked}
          round={round}
        />
        <WaterfallSidePanel draft={draft} entrantCount={entrantCount} status={status} text={text} />
      </div>
    </div>
  );
}

export function WaterfallGraphEditor({ text, onChange, entrantCount, roomSize }: EditorProps) {
  const parsed = useMemo(() => parseWaterfallDraft(text), [text]);
  const { min, max, ideal } = roomSize;
  const status = useMemo<GraphStatus>(() => {
    const raw = parseWaterfallGraph(text, { allowIncomplete: true });
    if (!raw.ok) return { ok: false, error: raw.error };
    const validated = validateAndOrderWaterfallGraph(raw.value, {
      roomSize: { min, max, ideal },
      entrantCount: entrantCount ?? undefined,
    });
    return validated.ok ? { ok: true } : { ok: false, error: validated.error };
  }, [text, min, max, ideal, entrantCount]);

  if (!parsed.ok) {
    return (
      <div>
        <Alert tone='danger'>The saved graph text can't be read as a table: {parsed.error}</Alert>
        <pre className='mt-3 overflow-x-auto rounded-[5px] bg-background p-3 font-mono text-xs whitespace-pre-wrap'>
          {text}
        </pre>
        <ButtonRow>
          <Button
            onClick={() => {
              if (window.confirm('Discard this text and start a new graph?')) onChange('');
            }}
            variant='danger'
          >
            Discard and start over
          </Button>
        </ButtonRow>
      </div>
    );
  }

  if (parsed.value.rounds.length === 0) {
    return (
      <div className='rounded-lg bg-surface-low p-4'>
        <p className='text-sm'>
          No rounds yet. Start with an entry round and a Final and route every rank, or load an example to
          edit.
        </p>
        <ButtonRow>
          <Button
            onClick={() =>
              onChange(serializeWaterfallDraft(blankWaterfallDraft(entrantCount, { min, max, ideal })))
            }
            variant='primary'
          >
            Blank start
          </Button>
          <StartButtons onExample={onChange} />
        </ButtonRow>
      </div>
    );
  }

  return (
    <DraftEditor
      draft={parsed.value}
      entrantCount={entrantCount}
      onChange={onChange}
      roomSize={roomSize}
      status={status}
      text={text}
    />
  );
}
