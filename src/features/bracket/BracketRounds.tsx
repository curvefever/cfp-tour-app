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
  shownRoundNumbers,
} from '../../domain/tournament/bracket';
import type { ExpectedRound } from '../../domain/tournament/expected-draw';
import { finalsProgressState } from '../../domain/tournament/finals';
import { isFinalComplete } from '../../domain/tournament/rankings';
import { type RoundSettings, roundSettingsByRound } from '../../domain/tournament/round-notes';
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
import { isNotCountedRound, roundProgress, showsNowPill } from './title-bar-marks';
import { RoundSettingsBand } from './RoundSettingsBand';
import { isCurrentRound, isRoundDone, usesDependencyPlay } from '../../domain/tournament/round-columns';

/** The width-affecting classes of an open round column: fixed on a desktop, the page's width on a phone. */
export function roundColumnWidthClass() {
  return cn('w-82.5 min-w-82.5 shrink-0', phoneFullWidthClass);
}

/** One round (or one double-elimination wave) as a column: a title bar, then its room cards. */
export function RoundColumn({
  banded = false,
  children,
  collapsed = false,
  current = false,
  expected = false,
  folded,
  gameCount,
  label,
  onToggle,
  phoneShown = true,
  popupSettings = null,
  progress,
  settings = null,
  titleDone,
  tournamentId = '',
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
  /** The tournament shows settings bands: the box has a band. */
  banded?: boolean;
  onToggle?: () => void;
  /** The box is the one a phone shows (`RoundStrip`): always open there, whatever its fold state; others are hidden. */
  phoneShown?: boolean;
  /** The round's settings while the bands are hidden (`ColumnTitleBar` shows a button for them); null for none. */
  popupSettings?: RoundSettings | null;
  /** The admin's rooms-scored tracker on the title bar (`ColumnTitleBar`); a folded box shows none. */
  progress?: RoomsScored | null;
  /** What the band shows; null for a round with no settings (a quiet "No specific settings"). */
  settings?: RoundSettings | null;
  /** Whether the title bar's own round is done, when that is not what the folded box shows (a column of rounds sent on one by one). */
  titleDone?: boolean;
  /** Where the settings pictures are stored. */
  tournamentId?: string;
}) {
  const open = (
    <div
      className={cn(
        roundColumnWidthClass(),
        'flex flex-col',
        collapsed ? 'hidden max-[700px]:flex' : phoneHiddenClass(phoneShown),
      )}
    >
      <ColumnTitleBar
        attached={banded}
        done={titleDone ?? folded.done}
        expected={expected}
        gameCount={gameCount}
        notCounted={folded.notCounted}
        now={current}
        onToggle={onToggle}
        popupSettings={popupSettings}
        progress={progress}
        title={label}
        tournamentId={tournamentId}
      />
      {banded ? <RoundSettingsBand settings={settings} title={label} tournamentId={tournamentId} /> : null}
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

/**
 * A double-elimination round's title: "R4 · Winners" and "R4 · Losers" when the column holds both brackets, else
 * "Round 4", numbered by column (`shownRoundNumbers`). Short, so it fits beside NOW and the rooms counter ("Round 3 ·
 * Winners bracket" needs 268 px of ~240).
 */
function waveRoundTitle(
  state: TournamentState,
  roundIndex: number,
  side: 'Winners' | 'Losers' | null,
): string {
  const number = shownRoundNumbers(state)[roundIndex];
  return side ? `R${number} · ${side}` : `Round ${number}`;
}

/**
 * What a phone shows (`RoundStrip`): the visitor's pick, or the default (the box in play) until they pick, and again
 * whenever the column in play changes. A pick that no longer exists falls back to the default.
 */
function useStripPick(state: TournamentState, hasStandings: boolean) {
  // `curRound` is the first round in play: a press moves it only when that round changes.
  const start = state.curRound;
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
  /** The line-ups of undrawn rounds as Next Round would make them now, while they are determined (`expectedRounds`). */
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
  const settingsByRound = useMemo(() => roundSettingsByRound(state), [state]);
  const hasSettings = settingsByRound.some((settings) => settings !== null);
  const banded = hasSettings && showSettings;
  const tournamentId = state.tournamentId ?? '';
  /** The settings a round band shows; null for a round with none. */
  const settingsOf = (roundIndex: number) => settingsByRound[roundIndex] ?? null;
  /** The settings a round title bar button opens: only while the bands are hidden. */
  const popupSettingsOf = (roundIndex: number) =>
    hasSettings && !showSettings ? settingsOf(roundIndex) : null;
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
        banded={banded}
        onToggle={onToggleCollapse ? () => onToggleCollapse(roundIndex, collapsed) : undefined}
        phoneShown={shown}
        progress={progressOf(roundIndex)}
        popupSettings={popupSettingsOf(roundIndex)}
        settings={settingsOf(roundIndex)}
        tournamentId={tournamentId}
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
  /** A further round stacked in a column, under a title bar of its own (name and games, no NOW pill, no fold). */
  function renderStacked(roundIndex: number, title: string) {
    return (
      <div className='flex flex-col' key={roundIndex}>
        <ColumnTitleBar
          attached={banded}
          done={isRoundDone(state, roundIndex)}
          expected={expectedDraw?.has(roundIndex) ?? false}
          gameCount={roundGameCount(state, roundIndex)}
          notCounted={isNotCountedRound(state, roundIndex)}
          now={usesDependencyPlay(state) && isNow(roundIndex)}
          popupSettings={popupSettingsOf(roundIndex)}
          progress={progressOf(roundIndex)}
          tournamentId={tournamentId}
          title={title}
        />
        {banded ? (
          <RoundSettingsBand settings={settingsOf(roundIndex)} title={title} tournamentId={tournamentId} />
        ) : null}
        <div className='mt-4.5 flex flex-col gap-5.5'>{bodyOf(roundIndex)}</div>
      </div>
    );
  }
  function renderColumn(box: Extract<BracketBox, { kind: 'column' }>, shown: boolean) {
    const [first, ...others] = box.roundIndices;
    const collapsed = collapse?.[first] ?? bracketRoundDefaultCollapsed(state, first);
    return (
      <RoundColumn
        collapsed={collapsed}
        current={isNow(first)}
        expected={expectedDraw?.has(first) ?? false}
        folded={foldedColumnSummary(state, box.roundIndices, followKey)}
        gameCount={roundGameCount(state, first)}
        key={first}
        label={labels[first]?.label ?? ''}
        banded={banded}
        onToggle={onToggleCollapse ? () => onToggleCollapse(first, collapsed) : undefined}
        phoneShown={shown}
        progress={progressOf(first)}
        popupSettings={popupSettingsOf(first)}
        settings={settingsOf(first)}
        titleDone={usesDependencyPlay(state) ? isRoundDone(state, first) : undefined}
        tournamentId={tournamentId}
      >
        {bodyOf(first)}
        {others.map((roundIndex) => renderStacked(roundIndex, labels[roundIndex]?.label ?? ''))}
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
        label={waveRoundTitle(
          state,
          box.winnersRoundIndex,
          box.losersRoundIndices.length > 0 ? 'Winners' : null,
        )}
        banded={banded}
        onToggle={onToggleCollapse ? () => onToggleCollapse(box.winnersRoundIndex, collapsed) : undefined}
        phoneShown={shown}
        progress={progressOf(box.winnersRoundIndex)}
        popupSettings={popupSettingsOf(box.winnersRoundIndex)}
        settings={settingsOf(box.winnersRoundIndex)}
        tournamentId={tournamentId}
      >
        {bodyOf(box.winnersRoundIndex)}
        {box.losersRoundIndices.map((roundIndex) =>
          renderStacked(roundIndex, waveRoundTitle(state, roundIndex, 'Losers')),
        )}
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
        className={cn('flex max-w-full items-start gap-7 overflow-x-auto pb-3', hiddenScrollbarClass)}
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
