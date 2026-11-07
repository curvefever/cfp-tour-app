import { useMemo, useState } from 'react';
import { groupExitRankLabels } from '../../../domain/tournament/group-exit';
import type { GroupExitMode, RoomSize } from '../../../domain/tournament/types';
import {
  normalizeRoundLabel,
  parseWaterfallGraph,
  QUAL_LABEL,
  validateAndOrderWaterfallGraph,
  type StandingsSourceKind,
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
  setWaterfallColumn,
  setWaterfallMatch,
  setWaterfallFinal,
  setWaterfallRanking,
  waterfallColumnChoices,
  waterfallDraftColumns,
  waterfallQualCounts,
  waterfallRoundIntake,
  type WaterfallDraft,
  type WaterfallMatch,
  type WaterfallSlotDestination,
} from '../../../domain/tournament/waterfall-draft';
import { WATERFALL_EXAMPLES } from '../../../domain/tournament/waterfall-examples';
import { Alert, Button, ButtonRow } from '../../../components/ui';
import {
  QualificationTableEditor,
  WaterfallRoundEditor,
  type RoundEditorActions,
} from './WaterfallRoundEditor';
import { WaterfallRoundList } from './WaterfallRoundList';
import { WaterfallSidePanel, type GraphStatus } from './WaterfallSidePanel';
import { parseSlotKey, slotKey } from './waterfall-format';

interface EditorProps {
  /** The persisted ROUNDS:/ROUTES: text; the editor reads it and writes it back on every change. */
  text: string;
  /** Writes the graph text back. `renamed` is set when the change renames a round by hand, so what is kept under the round's name (notes, pictures) can follow it. */
  onChange: (text: string, renamed?: { from: string; to: string }) => void;
  /** The number a new round's default name starts from: the round after the pooling rounds before the bracket ("Round 4" after 3 qualification rounds). */
  firstRoundNumber: number;
  /** Players entering the bracket (with `standingsSource`: the players registered), or null while it can't be known yet. */
  entrantCount: number | null;
  roomSize: RoomSize;
  /** The graph is fed by a qualification table or a group stage: the final standings (or the group exit order) are a source of the graph, routed by rank. Default false. */
  standingsSource?: boolean;
  /** Which of the two feeds the graph when `standingsSource` is set: 'qual' (the default) or 'groups'. */
  standingsKind?: StandingsSourceKind;
  /** After a group stage: the sizes of the groups the roster splits into, null while no roster is loaded. */
  groupSizes?: readonly number[] | null;
  /** After a group stage: how many go through, per group, an even split or a fair cut (the labels of the ranks follow it). */
  groupExit?: GroupExitMode;
  /** No control that changes the graph is rendered; the round list, room tables and side panel still show. */
  readOnly?: boolean;
  /** Labels of rounds that have already started: rename/resize/remove/Final-toggle are hidden for them, but their own routing stays editable. */
  lockedRounds?: ReadonlySet<string>;
  /** The rounds being played now (every round of the current column), shown with their own badge in the round list (a "played" badge covers every other locked round). */
  currentRoundLabels?: ReadonlySet<string>;
  /** The columns of the rounds that have started (a running tournament), by label; they stay where they are, and no other round can use them. */
  startedColumns?: Record<string, number>;
  /** false when the tournament's rounds aren't played in columns: no Column select, the list stays in play order. Default true. */
  showColumns?: boolean;
  /** false hides "Blank start" and the examples, which would replace locked rounds too. Ignored when readOnly. Default true. */
  allowReplace?: boolean;
  /** The Finals format (games in the Final), shown on the Final's default Match option. */
  finalsMatch?: WaterfallMatch;
}

function roundHasRoutedSlots(draft: WaterfallDraft, label: string): boolean {
  return (draft.routes[label] ?? []).some((room) => room.some((slot) => slot !== null));
}

function hasRoutedSlots(draft: WaterfallDraft): boolean {
  return (
    draft.rounds.some((round) => roundHasRoutedSlots(draft, round.label)) ||
    (draft.qualRoutes ?? []).some((slot) => slot !== null)
  );
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

/** "Players registered: 37 · sent on: 24 · eliminated: 13"; after groups "… · groups: 5, 4, 4 · sent on: 8 …". */
function QualificationHeader({
  entrantCount,
  qualRoutes,
  groupSizes,
  afterGroups = false,
}: {
  entrantCount: number | null;
  qualRoutes: WaterfallSlotDestination[];
  groupSizes?: readonly number[] | null;
  afterGroups?: boolean;
}) {
  const { sentOn, eliminated } = waterfallQualCounts(qualRoutes, entrantCount);
  return (
    <span className='text-sm'>
      Players registered: <b>{entrantCount ?? 'not known yet'}</b>
      {afterGroups ? (
        groupSizes ? (
          <>
            {' '}
            · groups: <b>{groupSizes.join(', ')}</b>
          </>
        ) : (
          <span className='text-xs text-muted'> (load a roster to see the groups)</span>
        )
      ) : null}{' '}
      · sent on: <b>{sentOn}</b>
      {eliminated === null ? (
        <span className='text-xs text-muted'> (load a roster to see how many are eliminated)</span>
      ) : (
        <>
          {' '}
          · eliminated: <b>{eliminated}</b>
        </>
      )}
    </span>
  );
}

function DraftEditor({
  draft,
  status,
  onChange,
  firstRoundNumber,
  entrantCount,
  roomSize,
  readOnly,
  lockedRounds,
  currentRoundLabels,
  startedColumns,
  showColumns = true,
  allowReplace = true,
  standingsSource = false,
  standingsKind,
  groupSizes,
  groupExit = 'per-group',
  finalsMatch,
  onAddRanks,
}: Omit<EditorProps, 'text'> & { draft: WaterfallDraft; status: GraphStatus; onAddRanks?: () => void }) {
  const [selectedLabel, setSelectedLabel] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [lastRank, setLastRank] = useState<number | null>(null);
  const [mirror, setMirror] = useState(true);
  const round = draft.rounds.find((candidate) => candidate.label === selectedLabel) ?? draft.rounds[0];
  const qualSelected = draft.qualRoutes !== null && (selectedLabel === QUAL_LABEL || selectedLabel === '');
  // The slots being picked: a round's rooms, or the qualification table's single row of ranks.
  const roomCount = qualSelected ? 1 : round.roomCount;
  const slotsPerRoom = qualSelected ? (draft.qualRoutes?.length ?? 0) : round.roomSize;
  const intake = waterfallRoundIntake(draft);
  const afterGroups = standingsSource && standingsKind === 'groups';
  // What each rank of the group exit is: for the ranks the line sends on (the total follows the highest routed one).
  const highestRouted = draft.qualRoutes
    ? draft.qualRoutes.reduce((highest, slot, index) => (slot === null ? highest : index + 1), 0)
    : 0;
  const rankLabels = useMemo(
    () =>
      afterGroups && groupSizes && highestRouted > 0
        ? groupExitRankLabels(groupSizes, groupExit, highestRouted)
        : afterGroups && groupSizes
          ? []
          : null,
    [afterGroups, groupSizes, groupExit, highestRouted],
  );

  const clearPicked = () => {
    setPicked(new Set());
    setLastRank(null);
  };
  const commit = (next: WaterfallDraft, renamed?: { from: string; to: string }) => {
    onChange(serializeWaterfallDraft(next), renamed);
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
      const rooms = mirror && !qualSelected ? Array.from({ length: roomCount }, (_, index) => index) : [room];
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
      for (let room = 0; room < roomCount; room += 1) {
        for (let rank = 1; rank <= slotsPerRoom; rank += 1) all.add(slotKey(room, rank));
      }
      setPicked(all);
    },
    onClearPicked: clearPicked,
    onMirrorChange: setMirror,
    onSend: (destination) => {
      const slots = [...picked].map(parseSlotKey);
      commit(assignWaterfallSlots(draft, qualSelected ? QUAL_LABEL : round.label, slots, destination));
    },
    onRename: (name) => {
      const result = renameWaterfallRound(draft, round.label, name);
      if (!result.ok) return result.error;
      const to = normalizeRoundLabel(name);
      setSelectedLabel(to);
      commit(result.value, { from: round.label, to });
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
    onSetRanking: (isRanking) => {
      if (
        isRanking &&
        roundHasRoutedSlots(draft, round.label) &&
        !window.confirm(
          `Make ${round.label} a ranking match? Everyone in it goes out, so its routing is lost.`,
        )
      ) {
        return;
      }
      commit(setWaterfallRanking(draft, round.label, isRanking));
    },
    onSetColumn: (column) => commit(setWaterfallColumn(draft, round.label, column)),
    onSetMatch: (match) => commit(setWaterfallMatch(draft, round.label, match)),
    onAddRanks,
    onDelete: () => {
      const isDestination = (intake.incoming[round.label] ?? 0) > 0;
      if (
        (roundHasRoutedSlots(draft, round.label) || isDestination) &&
        !window.confirm(
          `Delete ${round.label}? Its routing is lost, and ranks that pointed at it become out.`,
        )
      ) {
        return;
      }
      setSelectedLabel('');
      commit(removeWaterfallRound(draft, round.label));
    },
  };

  const draftColumns = showColumns ? waterfallDraftColumns(draft, startedColumns) : null;
  const columnInfo = showColumns
    ? {
        current: draftColumns?.[round.label],
        choices: waterfallColumnChoices(draft, round.label, startedColumns),
      }
    : undefined;

  const addRound = () => {
    const next = addWaterfallRound(draft, round.roomSize, firstRoundNumber);
    const added = next.rounds.find((candidate) => !draft.rounds.some((old) => old.label === candidate.label));
    commit(next);
    setSelectedLabel(added?.label ?? '');
  };
  const startBlank = () => {
    if (!confirmReplace()) return;
    setSelectedLabel('');
    commit(blankWaterfallDraft(entrantCount, roomSize, { standingsSource, standingsKind, firstRoundNumber }));
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
        {standingsSource && draft.qualRoutes ? (
          <QualificationHeader
            afterGroups={afterGroups}
            entrantCount={entrantCount}
            groupSizes={groupSizes}
            qualRoutes={draft.qualRoutes}
          />
        ) : (
          <span className='text-sm'>
            Players entering the bracket: <b>{entrantCount ?? 'not known yet'}</b>
            {entrantCount === null ? (
              <span className='text-xs text-muted'> (load a roster and set "Advance to bracket")</span>
            ) : null}
          </span>
        )}
        {readOnly || !allowReplace ? null : (
          <>
            <span className='flex-1' />
            <span className='text-xs text-muted'>Start over from:</span>
            <StartButtons onBlank={startBlank} onExample={loadExample} />
          </>
        )}
      </div>
      {/* The three columns follow the editor's own width, not the window's: Setup and Admin give it about half the page. */}
      <div className='@container'>
        <div className='grid gap-4 @min-[52rem]:grid-cols-[11rem_minmax(0,1fr)_18rem]'>
          <div>
            <div className='mb-2 text-[0.72rem] font-semibold tracking-[0.12em] text-muted uppercase'>
              Rounds
            </div>
            <WaterfallRoundList
              currentRoundLabels={currentRoundLabels}
              draft={draft}
              entrantCount={entrantCount}
              intake={intake}
              lockedRounds={lockedRounds}
              onSelect={select}
              selected={qualSelected ? QUAL_LABEL : round.label}
              showColumns={showColumns}
              startedColumns={startedColumns}
            />
            {readOnly ? null : (
              <Button className='mt-2 w-full' onClick={addRound} size='sm'>
                + Add round
              </Button>
            )}
          </div>
          {qualSelected ? (
            <QualificationTableEditor
              actions={readOnly ? undefined : actions}
              draft={draft}
              picked={picked}
              rankLabels={rankLabels}
            />
          ) : (
            <WaterfallRoundEditor
              actions={readOnly ? undefined : actions}
              columns={columnInfo}
              draft={draft}
              finalsMatch={finalsMatch}
              incomingPlayers={intake.incoming[round.label] ?? 0}
              locked={lockedRounds?.has(round.label)}
              matchEditable={currentRoundLabels?.has(round.label)}
              mirror={mirror}
              picked={picked}
              round={round}
            />
          )}
          <WaterfallSidePanel
            draft={draft}
            entrantCount={entrantCount}
            standingsSource={standingsSource}
            status={status}
          />
        </div>
      </div>
    </div>
  );
}

export function WaterfallGraphEditor({
  text,
  onChange,
  firstRoundNumber,
  entrantCount,
  roomSize,
  readOnly,
  lockedRounds,
  currentRoundLabels,
  startedColumns,
  showColumns = true,
  allowReplace = true,
  standingsSource = false,
  standingsKind,
  groupSizes,
  groupExit,
  finalsMatch,
}: EditorProps) {
  // Ranks shown past the last routed one while the head count isn't known ("+ Add ranks").
  const [extraRanks, setExtraRanks] = useState(0);
  const { min, max, ideal } = roomSize;
  const parsed = useMemo(
    () =>
      parseWaterfallDraft(text, {
        standingsSource,
        standingsKind,
        rankCount: entrantCount ?? undefined,
        padRanks: max + extraRanks,
      }),
    [text, standingsSource, standingsKind, entrantCount, max, extraRanks],
  );
  const raw = useMemo(() => parseWaterfallGraph(text, { allowIncomplete: true }), [text]);
  const status = useMemo<GraphStatus>(() => {
    if (!raw.ok) return { ok: false, error: raw.error };
    const validated = validateAndOrderWaterfallGraph(raw.value, {
      roomSize: { min, max, ideal },
      entrantCount: entrantCount ?? undefined,
      standingsSource,
      standingsKind,
    });
    return validated.ok ? { ok: true } : { ok: false, error: validated.error };
  }, [raw, min, max, ideal, entrantCount, standingsSource, standingsKind]);
  // A Qual or Groups line left over from another pooling phase: the table below ignores it, and writing the graph back drops it.
  const hasStrayQualLine = !standingsSource && raw.ok && raw.value.qualBands !== null;
  // The other of the two lines than this tournament's pooling phase feeds: it can be switched to the right one.
  const wrongLine =
    standingsSource &&
    raw.ok &&
    raw.value.standingsKind !== null &&
    raw.value.standingsKind !== (standingsKind ?? 'qual')
      ? raw.value.standingsKind
      : null;

  if (!parsed.ok && wrongLine !== null && !readOnly) {
    const right = (standingsKind ?? 'qual') === 'groups' ? 'Groups' : 'Qual';
    const wrong = wrongLine === 'groups' ? 'Groups' : 'Qual';
    return (
      <Alert tone='info'>
        <p>
          This graph has a {wrong} line, but this tournament's pooling phase needs a {right} line.
        </p>
        <ButtonRow className='mt-2'>
          <Button
            onClick={() => onChange(text.replace(new RegExp(`^(\\s*)${wrong}\\s*:`, 'im'), `$1${right}:`))}
            size='sm'
          >
            Use it as the {right} line
          </Button>
        </ButtonRow>
      </Alert>
    );
  }

  if (!parsed.ok) {
    return (
      <div>
        <Alert tone='danger'>The saved graph text can't be read as a table: {parsed.error}</Alert>
        <pre className='mt-3 overflow-x-auto rounded-[5px] bg-background p-3 font-mono text-xs whitespace-pre-wrap'>
          {text}
        </pre>
        {readOnly || !allowReplace ? null : (
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
        )}
      </div>
    );
  }

  if (parsed.value.rounds.length === 0) {
    return (
      <div className='rounded-lg bg-surface-low p-4'>
        <p className='text-sm'>
          No rounds yet. Start with an entry round and a Final and route the ranks that go on (the rest are
          out), or load an example to edit.
        </p>
        {readOnly || !allowReplace ? null : (
          <ButtonRow>
            <Button
              onClick={() =>
                onChange(
                  serializeWaterfallDraft(
                    blankWaterfallDraft(
                      entrantCount,
                      { min, max, ideal },
                      { standingsSource, standingsKind, firstRoundNumber },
                    ),
                  ),
                )
              }
              variant='primary'
            >
              Blank start
            </Button>
            <StartButtons onExample={onChange} />
          </ButtonRow>
        )}
      </div>
    );
  }

  return (
    <>
      {hasStrayQualLine && !readOnly ? (
        <Alert className='mb-3' tone='info'>
          <p>
            This graph has a {raw.ok && raw.value.standingsKind === 'groups' ? 'Groups' : 'Qual'} line, but
            this tournament has no{' '}
            {raw.ok && raw.value.standingsKind === 'groups' ? 'group stage' : 'qualification table'}, so it
            can't be used.
          </p>
          <ButtonRow className='mt-2'>
            <Button onClick={() => onChange(serializeWaterfallDraft(parsed.value))} size='sm'>
              Remove the {raw.ok && raw.value.standingsKind === 'groups' ? 'Groups' : 'Qual'} line
            </Button>
          </ButtonRow>
        </Alert>
      ) : null}
      <DraftEditor
        allowReplace={allowReplace}
        currentRoundLabels={currentRoundLabels}
        draft={parsed.value}
        entrantCount={entrantCount}
        finalsMatch={finalsMatch}
        firstRoundNumber={firstRoundNumber}
        lockedRounds={lockedRounds}
        onAddRanks={entrantCount === null ? () => setExtraRanks((count) => count + max) : undefined}
        onChange={onChange}
        readOnly={readOnly}
        roomSize={roomSize}
        groupExit={groupExit}
        groupSizes={groupSizes}
        showColumns={showColumns}
        standingsKind={standingsKind}
        standingsSource={standingsSource}
        startedColumns={startedColumns}
        status={status}
      />
    </>
  );
}
