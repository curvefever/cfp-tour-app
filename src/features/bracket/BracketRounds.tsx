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
import { finalsProgressState } from '../../domain/tournament/finals';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { StandingsColumn } from './StandingsColumn';
import { AnonymousFinalCard } from './AnonymousFinalCard';
import { ColumnTitleBar } from './ColumnTitleBar';
import { FoldedBox, FoldedRoundBody } from './FoldedBox';
import { type FoldedRoundSummary, foldedColumnSummary, foldedRoundSummary } from './folded-round';
import { RoundBody } from './RoundBody';
import { StickyScrollbar, hiddenScrollbarClass } from './StickyScrollbar';
import { isCurrentRound, isRoundDone } from '../../domain/tournament/round-columns';

/** The width-affecting classes of an open round column. */
export function roundColumnWidthClass() {
  return 'w-82.5 min-w-82.5 shrink-0';
}

/** One round (or one double-elimination wave) as a column: a title bar, then its room cards. */
export function RoundColumn({
  children,
  collapsed = false,
  current = false,
  folded,
  gameCount,
  label,
  onToggle,
}: {
  children: ReactNode;
  collapsed?: boolean;
  current?: boolean;
  /** What the folded box shows when the column is collapsed. */
  folded: FoldedRoundSummary;
  gameCount?: RoundGameCount | null;
  label: string;
  onToggle?: () => void;
}) {
  if (collapsed) {
    return (
      <FoldedBox done={folded.done} onUnfold={onToggle} title={label}>
        <FoldedRoundBody summary={folded} />
      </FoldedBox>
    );
  }
  return (
    <div className={cn(roundColumnWidthClass(), 'flex flex-col gap-4.5')}>
      <ColumnTitleBar gameCount={gameCount} now={current} onToggle={onToggle} title={label} />
      <div className='flex flex-col gap-5.5'>{children}</div>
    </div>
  );
}

/** A small caps sub-label inside a wave box ("WINNERS BRACKET", "LOSERS BRACKET"). */
function WaveLabel({ children }: { children: ReactNode }) {
  return <div className='text-xs font-extrabold tracking-[0.05em] text-muted uppercase'>{children}</div>;
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
  labels,
}: {
  state: TournamentState;
  box: Extract<BracketBox, { kind: 'wave' }>;
  editable: boolean;
  followKey: string | null;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  const hasLosers = box.losersRoundIndices.length > 0;
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
        />
      </div>
      {hasLosers ? (
        <div className='flex flex-col gap-5.5'>
          <WaveLabel>Losers bracket</WaveLabel>
          {box.losersRoundIndices.map((roundIndex) => (
            <div className='flex flex-col gap-5.5' key={roundIndex}>
              {box.losersRoundIndices.length > 1 ? (
                <div className='text-xs font-bold text-muted'>Round {state.rounds[roundIndex]?.roundNum}</div>
              ) : null}
              <RoundBody
                state={state}
                roundIndex={roundIndex}
                editable={editable}
                followKey={followKey}
                projected={projectedSlots[roundIndex] ?? null}
                labels={labels}
              />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
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
  editable,
  followKey,
  collapse,
  onToggleCollapse,
  standingsCollapsed = false,
  onToggleStandings,
  onOpenFullTable,
}: {
  state: TournamentState;
  labels: ReturnType<typeof bracketRoundLabels>;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  editable: boolean;
  followKey: string | null;
  collapse?: Record<number, boolean>;
  onToggleCollapse?: (roundIndex: number, collapsed: boolean) => void;
  standingsCollapsed?: boolean;
  onToggleStandings?: () => void;
  onOpenFullTable?: () => void;
}) {
  const boxes = bracketBoxes(state);
  const standings = useMemo(() => describeStandings(state), [state]);
  const finalRoundIndex = useMemo(() => state.rounds.findIndex((round) => round.isFinal), [state.rounds]);
  const finalRound = finalRoundIndex >= 0 ? state.rounds[finalRoundIndex] : null;
  const finalProgress = finalRound ? finalsProgressState(state, finalRoundIndex, finalRound) : null;
  const [finalTabOverride, setFinalTabOverride] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const finalTab = finalTabOverride ?? finalProgress?.nextGame ?? 1;
  function renderSingle(roundIndex: number) {
    const collapsed = collapse?.[roundIndex] ?? bracketRoundDefaultCollapsed(state, roundIndex);
    const column = (
      <RoundColumn
        collapsed={collapsed}
        current={isCurrentRound(state, roundIndex)}
        folded={foldedRoundSummary(state, roundIndex, followKey)}
        gameCount={roundGameCount(state, roundIndex)}
        key={roundIndex}
        label={labels[roundIndex]?.label ?? ''}
        onToggle={onToggleCollapse ? () => onToggleCollapse(roundIndex, collapsed) : undefined}
      >
        <RoundBody
          state={state}
          roundIndex={roundIndex}
          editable={editable}
          followKey={followKey}
          projected={projectedSlots[roundIndex] ?? null}
          labels={labels}
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
        />
      </Fragment>
    );
  }
  /**
   * A waterfall column of several rounds, played together: one column whose title bar is the first round's,
   * then each further round under a title bar of its own (name and games, no NOW pill and no fold control).
   */
  function renderColumn(box: Extract<BracketBox, { kind: 'column' }>) {
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
      />
    );
    return (
      <RoundColumn
        collapsed={collapsed}
        current={isCurrentRound(state, first)}
        folded={foldedColumnSummary(state, box.roundIndices, followKey)}
        gameCount={roundGameCount(state, first)}
        key={first}
        label={labels[first]?.label ?? ''}
        onToggle={onToggleCollapse ? () => onToggleCollapse(first, collapsed) : undefined}
      >
        {bodyOf(first)}
        {others.map((roundIndex) => (
          <div className='flex flex-col gap-4.5' key={roundIndex}>
            <ColumnTitleBar
              gameCount={roundGameCount(state, roundIndex)}
              title={labels[roundIndex]?.label ?? ''}
            />
            <div className='flex flex-col gap-5.5'>{bodyOf(roundIndex)}</div>
          </div>
        ))}
      </RoundColumn>
    );
  }
  function renderWave(box: Extract<BracketBox, { kind: 'wave' }>) {
    const constituents = [box.winnersRoundIndex, ...box.losersRoundIndices];
    const lastIndex = Math.max(...constituents);
    const collapsed = collapse?.[box.winnersRoundIndex] ?? bracketRoundDefaultCollapsed(state, lastIndex);
    return (
      <RoundColumn
        collapsed={collapsed}
        current={constituents.some((index) => isCurrentRound(state, index))}
        folded={{
          ...foldedRoundSummary(state, box.winnersRoundIndex, followKey),
          done: isRoundDone(state, lastIndex),
        }}
        gameCount={roundGameCount(state, box.winnersRoundIndex)}
        key={box.winnersRoundIndex}
        label={`Round ${state.rounds[box.winnersRoundIndex]?.roundNum}`}
        onToggle={onToggleCollapse ? () => onToggleCollapse(box.winnersRoundIndex, collapsed) : undefined}
      >
        <WaveBoxBody
          state={state}
          box={box}
          editable={editable}
          followKey={followKey}
          projectedSlots={projectedSlots}
          labels={labels}
        />
      </RoundColumn>
    );
  }
  return (
    <div>
      <div
        className={cn('flex max-w-full items-start gap-7 overflow-x-auto pb-3', hiddenScrollbarClass)}
        id='br-rounds'
        ref={strip}
      >
        {boxes.map((box) => {
          if (box.kind === 'column') return renderColumn(box);
          if (box.kind === 'wave') return renderWave(box);
          if (!standings || box.roundIndex !== standings.lastStandingsRoundIndex)
            return renderSingle(box.roundIndex);
          return (
            <Fragment key={box.roundIndex}>
              {renderSingle(box.roundIndex)}
              <StandingsColumn
                display={standings}
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
