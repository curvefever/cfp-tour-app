import { type BracketBox, bracketBoxes, bracketRoundLabels } from '../../domain/tournament/bracket';
import { isFinalComplete } from '../../domain/tournament/rankings';
import { currentColumn, isRoundDone } from '../../domain/tournament/round-columns';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { standingsNames } from '../standings/standings-names';
import { showsNowPill } from './title-bar-marks';

/**
 * One item of the Bracket's round strip on a phone. A `box` stands for one `bracketBoxes` entry, a `group` for
 * the finished boxes before the column in play, and `standings` for the standings column.
 */
export interface RoundStripItem {
  kind: 'box' | 'group' | 'standings';
  key: string;
  label: string;
  /** The indices (into `bracketBoxes(state)`) of the boxes this item stands for; none for the standings column. */
  boxes: number[];
  /** Every round it stands for is finished (always false for the standings column). */
  done: boolean;
  /** One of its rounds is the one in play and the Final is not complete. */
  now: boolean;
}

/** Fewest finished boxes that fold into one group item. */
const MIN_GROUPED_BOXES = 2;

/** The round indices a box shows, in order. */
function boxRoundIndices(box: BracketBox): number[] {
  if (box.kind === 'single') return [box.roundIndex];
  if (box.kind === 'wave') return [box.winnersRoundIndex, ...box.losersRoundIndices];
  return box.roundIndices;
}

/** The index of the box showing round `roundIndex`, or -1 when none does. */
export function boxHoldingRound(boxes: readonly BracketBox[], roundIndex: number): number {
  return boxes.findIndex((box) => boxRoundIndices(box).includes(roundIndex));
}

/** A box's title: a round's own label, the first round's for a waterfall column, "Round N" for a wave. */
function boxLabel(state: TournamentState, box: BracketBox, labels: Array<{ label: string }>): string {
  if (box.kind === 'wave') return `Round ${state.rounds[box.winnersRoundIndex]?.roundNum}`;
  const first = box.kind === 'single' ? box.roundIndex : box.roundIndices[0];
  return labels[first]?.label ?? '';
}

/** A box is finished when its last round is before the column in play. */
function isBoxDone(state: TournamentState, box: BracketBox): boolean {
  return isRoundDone(state, Math.max(...boxRoundIndices(box)));
}

function boxItem(
  state: TournamentState,
  box: BracketBox,
  index: number,
  labels: Array<{ label: string }>,
  finalComplete: boolean,
): RoundStripItem {
  return {
    kind: 'box',
    key: `box-${index}`,
    label: boxLabel(state, box, labels),
    boxes: [index],
    done: isBoxDone(state, box),
    now: boxRoundIndices(box).some((roundIndex) => showsNowPill(state, roundIndex, finalComplete)),
  };
}

/** "R1–3": the round numbers of the first round of the first box and the last round of the last box. */
function groupLabel(state: TournamentState, grouped: BracketBox[]): string {
  const first = boxRoundIndices(grouped[0])[0];
  const lastRounds = boxRoundIndices(grouped[grouped.length - 1]);
  const last = lastRounds[lastRounds.length - 1];
  return `R${state.rounds[first]?.roundNum}–${state.rounds[last]?.roundNum}`;
}

/**
 * The items of the phone round strip, in order. Two or more finished boxes fold into one group item; the
 * standings column, named after the pooling phase, follows the box holding the last standings round (or the
 * group, when that box is folded into it).
 */
export function roundStrip(state: TournamentState, standings: StandingsDisplay | null): RoundStripItem[] {
  const boxes = bracketBoxes(state);
  const labels = bracketRoundLabels(state);
  const finalComplete = isFinalComplete(state);
  const doneCount = boxes.filter((box) => isBoxDone(state, box)).length;
  const groupSize = doneCount >= MIN_GROUPED_BOXES ? doneCount : 0;
  const standingsBox = standings ? boxHoldingRound(boxes, standings.lastStandingsRoundIndex) : -1;
  const standingsItem: RoundStripItem | null = standings
    ? {
        kind: 'standings',
        key: 'standings',
        label: standingsNames(standings.kind).title,
        boxes: [],
        done: false,
        now: false,
      }
    : null;

  const items: RoundStripItem[] = [];
  if (groupSize > 0) {
    const grouped = boxes.slice(0, groupSize);
    items.push({
      kind: 'group',
      key: 'group',
      label: groupLabel(state, grouped),
      boxes: grouped.map((_, index) => index),
      done: true,
      now: false,
    });
    if (standingsItem && standingsBox >= 0 && standingsBox < groupSize) items.push(standingsItem);
  }
  boxes.forEach((box, index) => {
    if (index < groupSize) return;
    items.push(boxItem(state, box, index, labels, finalComplete));
    if (standingsItem && index === standingsBox) items.push(standingsItem);
  });
  return items;
}

/**
 * The box shown by default: the one holding the first round of the column in play. That is the first box before
 * the start and the Final's box once the tournament is finished.
 */
export function defaultStripSelection(state: TournamentState): number {
  const boxes = bracketBoxes(state);
  const holding = boxHoldingRound(boxes, currentColumn(state).start);
  return holding >= 0 ? holding : Math.max(0, boxes.length - 1);
}
