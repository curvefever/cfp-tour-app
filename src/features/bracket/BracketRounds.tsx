import { Fragment, type ReactNode, useMemo, useRef, useState } from 'react';
import { describeStandings } from '../../domain/tournament/standings-display';
import {
  type BracketBox,
  type RoundGameCount,
  bracketBoxes,
  bracketRoundDefaultCollapsed,
  bracketRoundLabels,
  projectFutureRoundSlots,
  roundGameCount,
} from '../../domain/tournament/bracket';
import type { ExpectedRound } from '../../domain/tournament/expected-draw';
import { finalsProgressState } from '../../domain/tournament/finals';
import { isFinalComplete } from '../../domain/tournament/rankings';
import { roundNote, roundNoteNames } from '../../domain/tournament/round-notes';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { StandingsColumn } from './StandingsColumn';
import { phoneFullWidthClass, phoneHiddenClass } from './phone-box';
import { RoundStrip } from './RoundStrip';
import {
  type StripPick,
  defaultStripSelection,
  pickedItemKey,
  roundStrip,
  roundStripBoxLabels,
} from './round-strip';
import { AnonymousFinalCard } from './AnonymousFinalCard';
import { ColumnTitleBar } from './ColumnTitleBar';
import { FoldedBox, FoldedRoundBody } from './FoldedBox';
import { type FoldedRoundSummary, foldedColumnSummary, foldedRoundSummary } from './folded-round';
import { RoundBody } from './RoundBody';
import { StickyScrollbar, hiddenScrollbarClass } from './StickyScrollbar';
import type { RoomsScored } from './still-playing';
import {
  hasRoundNotes,
  isNotCountedRound,
  roundProgress,
  showsNowPill,
  sumProgress,
} from './title-bar-marks';
import { RoundSettingsBand, alignedBoxClass } from './RoundSettingsBand';
import { RoundSettingsPopup } from './RoundSettingsPopup';
import { currentColumn, isCurrentRound, isRoundDone } from '../../domain/tournament/round-columns';

/** The width-affecting classes of an open round column: fixed on a desktop, the page's width on a phone. */
export function roundColumnWidthClass() {
  return cn('w-82.5 min-w-82.5 shrink-0', phoneFullWidthClass);
}

/**
 * The rounds strip of a tournament with bands, on a desktop: a grid of three rows (title bar, band, body) that every
 * box spans, the open ones as subgrids, so the bands take the height of the tallest and the rooms start level.
 * The body row is flexible so a tall folded box or the standings column never stretches the other two.
 */
const bandedStripClass =
  'min-[701px]:grid min-[701px]:auto-cols-max min-[701px]:grid-flow-col min-[701px]:grid-rows-[2.875rem_auto_1fr] min-[701px]:justify-start min-[701px]:gap-y-0 min-[701px]:*:row-span-3';

/** One round (or one double-elimination wave) as a column: a title bar, then its room cards. */
export function RoundColumn({
  children,
  collapsed = false,
  current = false,
  expected = false,
  folded,
  gameCount,
  label,
  note = null,
  onToggle,
  phoneShown = true,
  progress,
  settingsNote = '',
}: {
  children: ReactNode;
  collapsed?: boolean;
  current?: boolean;
  /** The column holds the expected draw (the EXPECTED tag on its title bar). */
  expected?: boolean;
  /** What the folded box shows when the column is collapsed. */
  folded: FoldedRoundSummary;
  gameCount?: RoundGameCount | null;
  label: string;
  /** The round's settings note ('' for none) when the tournament has bands, null when it has none: no band then. */
  note?: string | null;
  onToggle?: () => void;
  /** The box is the one a phone shows (`RoundStrip`): always open there, whatever its fold state; others are hidden. */
  phoneShown?: boolean;
  /** The admin's rooms-scored tracker on the title bar (`ColumnTitleBar`); a folded box shows none. */
  progress?: RoomsScored | null;
  /** The round's note while the bands are hidden (`ColumnTitleBar` shows a button for it); '' for none. */
  settingsNote?: string;
}) {
  const banded = note !== null;
  const open = (
    <div
      className={cn(
        roundColumnWidthClass(),
        'flex flex-col',
        collapsed ? 'hidden max-[700px]:flex' : cn(phoneHiddenClass(phoneShown), banded && alignedBoxClass),
      )}
    >
      <ColumnTitleBar
        attached={banded}
        done={folded.done}
        expected={expected}
        gameCount={gameCount}
        notCounted={folded.notCounted}
        now={current}
        onToggle={onToggle}
        progress={progress}
        settingsNote={settingsNote}
        title={label}
      />
      {banded ? <RoundSettingsBand note={note} /> : null}
      <div className='mt-4.5 flex flex-col gap-5.5'>{children}</div>
    </div>
  );
  if (!collapsed) return open;
  // Folded on a desktop; a phone shows the same box open, so its body is rendered only while it is the shown one.
  return (
    <>
      <FoldedBox className='max-[700px]:hidden' done={folded.done} onUnfold={onToggle} title={label}>
        <FoldedRoundBody summary={folded} />
      </FoldedBox>
      {phoneShown ? open : null}
    </>
  );
}

/** A small caps sub-label inside a wave box ("WINNERS BRACKET", "LOSERS BRACKET"). */
function WaveLabel({ children }: { children: ReactNode }) {
  return <div className='text-xs font-extrabold tracking-[0.05em] text-muted uppercase'>{children}</div>;
}

/**
 * The heading of a losers round in a wave box ("Losers bracket", or "Round N" when the box holds several), with the
 * round's own settings band under it (its own height, quiet without a note), or, while the bands are hidden, the
 * round's pop-up button at the right.
 */
function WaveRoundHeading({
  children,
  note,
  popupNote,
  small,
}: {
  children: ReactNode;
  note: string | null;
  popupNote: string;
  small: boolean;
}) {
  const heading = small ? (
    <div className='text-xs font-bold text-muted'>{children}</div>
  ) : (
    <WaveLabel>{children}</WaveLabel>
  );
  return (
    <div className='flex flex-col gap-1.5'>
      {popupNote ? (
        <div className='flex items-center justify-between'>
          {heading}
          <RoundSettingsPopup note={popupNote} />
        </div>
      ) : (
        heading
      )}
      {note !== null ? <RoundSettingsBand className='rounded' note={note} /> : null}
    </div>
  );
}

/**
 * A `wave` box's content: the winners-bracket (WB) round's own rooms,
 * followed -- only when this wave actually has losers-bracket (LB) rounds
 * trailing it, which isn't guaranteed (the FFA/team shared-final
 * double-elimination variant can defer a WB round's drops into a *later*
 * round's LB absorption, leaving `losersRoundIndices` empty) -- by a thin
 * divider and every LB round's own rooms stacked beneath it. When two LB
 * rounds land in the same wave (the head-to-head/race variant's middle
 * rounds), each gets its own small round-identifying sub-label first,
 * since `roomLetter()` restarts at "Room A" independently per round and
 * two stacked "Room A" blocks would otherwise be ambiguous about which
 * round they belong to.
 */
function WaveBoxBody({
  state,
  box,
  editable,
  followKey,
  projectedSlots,
  expectedDraw,
  labels,
  noteOf,
  popupNoteOf,
}: {
  state: TournamentState;
  box: Extract<BracketBox, { kind: 'wave' }>;
  editable: boolean;
  followKey: string | null;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  expectedDraw: Map<number, ExpectedRound> | null;
  labels: ReturnType<typeof bracketRoundLabels>;
  /** A round's band note (null: no band shows) and the note its pop-up button opens ('' for none). */
  noteOf: (roundIndex: number) => string | null;
  popupNoteOf: (roundIndex: number) => string;
}) {
  const hasLosers = box.losersRoundIndices.length > 0;
  const severalLosers = box.losersRoundIndices.length > 1;
  return (
    <>
      <div className='flex flex-col gap-5.5'>
        {hasLosers ? <WaveLabel>Winners bracket</WaveLabel> : null}
        <RoundBody
          state={state}
          roundIndex={box.winnersRoundIndex}
          editable={editable}
          followKey={followKey}
          projected={projectedSlots[box.winnersRoundIndex] ?? null}
          labels={labels}
          expected={expectedDraw?.get(box.winnersRoundIndex) ?? null}
        />
      </div>
      {hasLosers ? (
        <div className='flex flex-col gap-5.5'>
          {severalLosers ? <WaveLabel>Losers bracket</WaveLabel> : null}
          {box.losersRoundIndices.map((roundIndex) => (
            <div className='flex flex-col gap-5.5' key={roundIndex}>
              <WaveRoundHeading
                note={noteOf(roundIndex)}
                popupNote={popupNoteOf(roundIndex)}
                small={severalLosers}
              >
                {severalLosers ? `Round ${state.rounds[roundIndex]?.roundNum}` : 'Losers bracket'}
              </WaveRoundHeading>
              <RoundBody
                state={state}
                roundIndex={roundIndex}
                editable={editable}
                followKey={followKey}
                projected={projectedSlots[roundIndex] ?? null}
                labels={labels}
                expected={expectedDraw?.get(roundIndex) ?? null}
              />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * What a phone shows (`RoundStrip`): the visitor's pick, or the default (the box in play) until they pick, and again
 * whenever the column in play changes. A pick that no longer exists falls back to the default.
 */
function useStripPick(state: TournamentState, hasStandings: boolean) {
  const start = currentColumn(state).start;
  const [chosen, setChosen] = useState<StripPick | null>(null);
  const [seenStart, setSeenStart] = useState(start);
  if (seenStart !== start) {
    setSeenStart(start);
    setChosen(null);
  }
  const boxCount = bracketBoxes(state).length;
  const valid = chosen !== null && (chosen.kind === 'standings' ? hasStandings : chosen.index < boxCount);
  const pick: StripPick = valid ? chosen : { kind: 'box', index: defaultStripSelection(state) };
  return { pick, selectPick: setChosen };
}

/**
 * Renders a tournament's rounds as one flowing row of boxes, one per
 * `bracketBoxes()` entry. A double-elimination winners-bracket (WB) round
 * and every losers-bracket (LB) round immediately following it share one
 * box (`WaveBoxBody` above) -- LB is a section *inside* WB's own box, not
 * a separate row or column, per the organiser's explicit request after
 * reviewing the previous two-row layout live. Every other round (pre-
 * bracket rounds, the terminal Final) is its own ordinary box, labeled via
 * `bracketRoundLabels()` exactly as before. Degenerates to the exact
 * original single-row rendering for every non-double-elimination format
 * (single-elimination, Kings Valley, pooling-only), by construction --
 * `bracketBoxes()` never produces a `wave` box when no round is tagged
 * `bracket === 'winners'`.
 */
export function BracketRounds({
  state,
  labels,
  projectedSlots,
  expectedDraw = null,
  editable,
  followKey,
  collapse,
  onToggleCollapse,
  standingsCollapsed = false,
  onToggleStandings,
  onOpenFullTable,
  showSettings = true,
}: {
  state: TournamentState;
  labels: ReturnType<typeof bracketRoundLabels>;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  /** The draw of the next column as Next Round would make it now, while it is determined (`expectedNextColumn`). */
  expectedDraw?: Map<number, ExpectedRound> | null;
  editable: boolean;
  followKey: string | null;
  collapse?: Record<number, boolean>;
  onToggleCollapse?: (roundIndex: number, collapsed: boolean) => void;
  standingsCollapsed?: boolean;
  onToggleStandings?: () => void;
  onOpenFullTable?: () => void;
  /** Whether the round settings bands show; off, a round with a note has a button on its title bar instead. */
  showSettings?: boolean;
}) {
  const boxes = bracketBoxes(state);
  const standings = useMemo(() => describeStandings(state), [state]);
  const { pick, selectPick } = useStripPick(state, standings !== null);
  const stripItems = roundStrip(state, standings);
  const boxShown = (boxIndex: number) => pick.kind === 'box' && pick.index === boxIndex;
  const finalRoundIndex = useMemo(() => state.rounds.findIndex((round) => round.isFinal), [state.rounds]);
  const finalRound = finalRoundIndex >= 0 ? state.rounds[finalRoundIndex] : null;
  const finalProgress = finalRound ? finalsProgressState(state, finalRoundIndex, finalRound) : null;
  const [finalTabOverride, setFinalTabOverride] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const finalTab = finalTabOverride ?? finalProgress?.nextGame ?? 1;
  const finalComplete = useMemo(() => isFinalComplete(state), [state]);
  const isNow = (roundIndex: number) => showsNowPill(state, roundIndex, finalComplete);
  const progressOf = (roundIndex: number) => roundProgress(state, roundIndex, editable);
  const hasNotes = useMemo(() => hasRoundNotes(state), [state]);
  const banded = hasNotes && showSettings;
  const noteNames = useMemo(() => roundNoteNames(state), [state]);
  const textOf = (roundIndex: number) => roundNote(state.info?.roundNotes, noteNames[roundIndex] ?? '');
  /** The note a round band shows; null when no band shows (no note anywhere, or the settings are hidden). */
  const noteOf = (roundIndex: number) => (banded ? textOf(roundIndex) : null);
  /** The note a round title bar button opens: only while the bands are hidden. */
  const popupNoteOf = (roundIndex: number) => (hasNotes && !showSettings ? textOf(roundIndex) : '');
  function renderSingle(roundIndex: number, shown: boolean) {
    const collapsed = collapse?.[roundIndex] ?? bracketRoundDefaultCollapsed(state, roundIndex);
    const column = (
      <RoundColumn
        collapsed={collapsed}
        current={isNow(roundIndex)}
        expected={expectedDraw?.has(roundIndex) ?? false}
        folded={foldedRoundSummary(state, roundIndex, followKey)}
        gameCount={roundGameCount(state, roundIndex)}
        key={roundIndex}
        label={labels[roundIndex]?.label ?? ''}
        note={noteOf(roundIndex)}
        onToggle={onToggleCollapse ? () => onToggleCollapse(roundIndex, collapsed) : undefined}
        phoneShown={shown}
        progress={progressOf(roundIndex)}
        settingsNote={popupNoteOf(roundIndex)}
      >
        <RoundBody
          state={state}
          roundIndex={roundIndex}
          editable={editable}
          followKey={followKey}
          projected={projectedSlots[roundIndex] ?? null}
          labels={labels}
          expected={expectedDraw?.get(roundIndex) ?? null}
          finalTab={roundIndex === finalRoundIndex ? finalTab : undefined}
          onFinalTabChange={roundIndex === finalRoundIndex ? setFinalTabOverride : undefined}
        />
      </RoundColumn>
    );
    if (roundIndex !== finalRoundIndex || !finalRound || state.anonymousFinalists.length === 0) return column;
    return (
      <Fragment key={roundIndex}>
        {column}
        <AnonymousFinalCard
          state={state}
          roundIndex={roundIndex}
          round={finalRound}
          editable={editable && isCurrentRound(state, roundIndex)}
          activeTab={finalTab}
          className={phoneHiddenClass(shown)}
        />
      </Fragment>
    );
  }
  /**
   * A waterfall column of several rounds, played together: one column whose title bar is the first round's,
   * then each further round under a title bar of its own (name and games, no NOW pill and no fold control).
   */
  function renderColumn(box: Extract<BracketBox, { kind: 'column' }>, shown: boolean) {
    const [first, ...others] = box.roundIndices;
    const collapsed = collapse?.[first] ?? bracketRoundDefaultCollapsed(state, first);
    const bodyOf = (roundIndex: number) => (
      <RoundBody
        state={state}
        roundIndex={roundIndex}
        editable={editable}
        followKey={followKey}
        projected={projectedSlots[roundIndex] ?? null}
        labels={labels}
        expected={expectedDraw?.get(roundIndex) ?? null}
      />
    );
    return (
      <RoundColumn
        collapsed={collapsed}
        current={isNow(first)}
        expected={expectedDraw?.has(first) ?? false}
        folded={foldedColumnSummary(state, box.roundIndices, followKey)}
        gameCount={roundGameCount(state, first)}
        key={first}
        label={labels[first]?.label ?? ''}
        note={noteOf(first)}
        onToggle={onToggleCollapse ? () => onToggleCollapse(first, collapsed) : undefined}
        phoneShown={shown}
        progress={progressOf(first)}
        settingsNote={popupNoteOf(first)}
      >
        {bodyOf(first)}
        {others.map((roundIndex) => (
          <div className='flex flex-col' key={roundIndex}>
            <ColumnTitleBar
              attached={banded}
              done={isRoundDone(state, roundIndex)}
              expected={expectedDraw?.has(roundIndex) ?? false}
              gameCount={roundGameCount(state, roundIndex)}
              notCounted={isNotCountedRound(state, roundIndex)}
              progress={progressOf(roundIndex)}
              settingsNote={popupNoteOf(roundIndex)}
              title={labels[roundIndex]?.label ?? ''}
            />
            {banded ? <RoundSettingsBand note={noteOf(roundIndex) ?? ''} /> : null}
            <div className='mt-4.5 flex flex-col gap-5.5'>{bodyOf(roundIndex)}</div>
          </div>
        ))}
      </RoundColumn>
    );
  }
  function renderWave(box: Extract<BracketBox, { kind: 'wave' }>, shown: boolean) {
    const constituents = [box.winnersRoundIndex, ...box.losersRoundIndices];
    const lastIndex = Math.max(...constituents);
    const collapsed = collapse?.[box.winnersRoundIndex] ?? bracketRoundDefaultCollapsed(state, lastIndex);
    return (
      <RoundColumn
        collapsed={collapsed}
        current={constituents.some(isNow)}
        expected={constituents.some((roundIndex) => expectedDraw?.has(roundIndex))}
        folded={{
          ...foldedRoundSummary(state, box.winnersRoundIndex, followKey),
          done: isRoundDone(state, lastIndex),
        }}
        gameCount={roundGameCount(state, box.winnersRoundIndex)}
        key={box.winnersRoundIndex}
        label={`Round ${state.rounds[box.winnersRoundIndex]?.roundNum}`}
        note={noteOf(box.winnersRoundIndex)}
        onToggle={onToggleCollapse ? () => onToggleCollapse(box.winnersRoundIndex, collapsed) : undefined}
        phoneShown={shown}
        progress={sumProgress(constituents.map(progressOf))}
        settingsNote={popupNoteOf(box.winnersRoundIndex)}
      >
        <WaveBoxBody
          state={state}
          box={box}
          editable={editable}
          followKey={followKey}
          projectedSlots={projectedSlots}
          expectedDraw={expectedDraw}
          labels={labels}
          noteOf={noteOf}
          popupNoteOf={popupNoteOf}
        />
      </RoundColumn>
    );
  }
  return (
    <div>
      <RoundStrip
        boxLabels={roundStripBoxLabels(state)}
        items={stripItems}
        onSelect={selectPick}
        selectedKey={pickedItemKey(stripItems, pick)}
      />
      <div
        className={cn(
          'flex max-w-full items-start gap-7 overflow-x-auto pb-3',
          banded && bandedStripClass,
          hiddenScrollbarClass,
        )}
        id='br-rounds'
        ref={strip}
      >
        {boxes.map((box, boxIndex) => {
          const shown = boxShown(boxIndex);
          if (box.kind === 'column') return renderColumn(box, shown);
          if (box.kind === 'wave') return renderWave(box, shown);
          if (!standings || box.roundIndex !== standings.lastStandingsRoundIndex)
            return renderSingle(box.roundIndex, shown);
          return (
            <Fragment key={box.roundIndex}>
              {renderSingle(box.roundIndex, shown)}
              <StandingsColumn
                display={standings}
                phoneShown={pick.kind === 'standings'}
                banded={banded}
                state={state}
                labels={labels}
                followKey={followKey}
                collapsed={standingsCollapsed}
                onToggle={onToggleStandings}
                onOpenFullTable={onOpenFullTable}
              />
            </Fragment>
          );
        })}
      </div>
      <StickyScrollbar target={strip} />
    </div>
  );
}
