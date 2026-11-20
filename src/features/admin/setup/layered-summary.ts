import { getGameFormat } from '../../../domain/tournament/formats';
import type { LevelRound } from '../../../domain/tournament/layered-search';
import {
  differsFromUsualValues,
  parseTopCounts,
  planLayeredFor,
  type LayeredForm,
  type TopCountLine,
} from '../../../domain/tournament/layered-form';
import type { LayeredNumber, LayeredPlan } from '../../../domain/tournament/layered-plan';
import type { RoomSize } from '../../../domain/tournament/types';

/**
 * What the Setup panel of a layered bracket says for this form and head count: the numbers the app worked out, each with
 * who set it and why, the grid of rounds by levels, the flags in words, and whether the form differs from the usual
 * values; or why there is no bracket (the words generation refuses with), or that it waits for a roster. Pure.
 */

export const NO_LAYERED_ROSTER_TEXT =
  'Works out the levels, rooms and rounds from the head count once a roster is loaded.';

/** One number of the plan as the list shows it. */
export interface SummaryNumber {
  key: 'play' | 'inBracket' | 'levels' | 'topLevel' | 'bracketRounds';
  label: string;
  value: string;
  /** "the app's: <reason>", "yours", or "yours: <what the app made of it>". */
  source: string;
}

/** A room of a cell: its seats and the top places that go on (null for the Final, where the title is decided). */
export interface GridRoom {
  seats: number;
  top: number | null;
}

/** What one level plays in one round. `name` is the level's own, or a semi-final's or the Final's. */
export interface GridCell {
  name: string;
  rooms: GridRoom[];
  /** Where the top places go when it is not the next round of the same level, or what the others do. */
  note: string;
}

export interface GridColumn {
  title: string;
  /** One entry per row of the grid (`SummaryGrid.rows`): null where the level plays nothing this round. */
  cells: Array<GridCell | null>;
  /** Players sitting out this round, waiting for Semi-Final B. */
  waiting: number;
  /** Players out of the bracket after this round. */
  out: number;
}

export interface SummaryGrid {
  /** The levels, the top level first. */
  rows: string[];
  columns: GridColumn[];
}

/** One level of one bracket round, with the top places of each room the plan gives it and what was typed for it. */
export interface TopCountRow {
  /** "Round 6 - Middle": the name the typed line is kept under. */
  name: string;
  /** The top places of each room in the plan: the typed number where one was typed. */
  top: number;
  /** The number as typed, '' for none. */
  typed: string;
}

/** What the first semi-final's other half do in the plan, and what was typed. */
export interface SemiOthersRow {
  value: 'play-on' | 'wait' | 'last-semi';
  typed: '' | 'play-on' | 'wait';
  /** Typed, and the first semi-final is in the last round: its other half go to Semi-Final B whatever is chosen. */
  noLongerApplies: boolean;
}

export type LayeredSummary =
  | { kind: 'waiting'; message: string }
  | {
      kind: 'refused';
      message: string;
      /** What was typed for the top places of each room, so that it can be cleared while the bracket is refused. */
      typedTopCounts: TopCountLine[];
    }
  | {
      kind: 'ready';
      heading: string;
      numbers: SummaryNumber[];
      flags: string[];
      grid: SummaryGrid;
      topCounts: TopCountRow[];
      /** Typed top places of each room for a round or level this plan does not have. */
      noLongerApply: TopCountLine[];
      semiOthers: SemiOthersRow;
      /** The form's table rounds, Semis or Finals format differ from the usual values. */
      differsFromUsual: boolean;
    };

const sourceOf = (number: LayeredNumber): string => {
  if (number.setBy === 'app') return `the app's: ${number.reason}`;
  return number.reason ? `yours: ${number.reason}` : 'yours';
};

function numbersOf(plan: LayeredPlan): SummaryNumber[] {
  const levels = plan.levels.map((level) => `${level.name} ${level.players}`).join(' · ');
  return [
    { key: 'play', label: 'Expected to play', value: `${plan.play.value}`, source: sourceOf(plan.play) },
    {
      key: 'inBracket',
      label: 'In the bracket',
      value: `${plan.inBracket.value}`,
      source: sourceOf(plan.inBracket),
    },
    {
      key: 'levels',
      label: 'Levels',
      value: `${plan.levelCount.value}: ${levels}`,
      source: sourceOf(plan.levelCount),
    },
    { key: 'topLevel', label: 'Top level', value: `${plan.topLevel.value}`, source: sourceOf(plan.topLevel) },
    {
      key: 'bracketRounds',
      label: 'Bracket rounds',
      value: `${plan.bracketRounds.value}`,
      source: sourceOf(plan.bracketRounds),
    },
  ];
}

const roomsWord = (count: number): string => (count === 1 ? '1 room' : `${count} rooms`);

/** The plan's flags in words: rooms of a size outside the normal ones, and rooms where more than half do not stay. */
function flagsOf(plan: LayeredPlan, roomSize: RoomSize): string[] {
  const flags: string[] = [];
  if (plan.lastResortRooms > 0) {
    flags.push(
      `${roomsWord(plan.lastResortRooms)} of a size outside ${roomSize.min} to ${roomSize.max}, the last resort to seat everyone`,
    );
  }
  if (plan.longShotRooms > 0) {
    flags.push(
      `${roomsWord(plan.longShotRooms)} where more than half of the players do not stay in their level`,
    );
  }
  return flags;
}

function levelNote(level: LevelRound): string {
  if (level.topGoes === 'stay') return '';
  return level.rooms.length === 1
    ? `the top ${level.top} go to Semi-Final B`
    : `the top ${level.top} of each room go to Semi-Final B`;
}

function levelCell(level: LevelRound): GridCell {
  return {
    name: level.level,
    rooms: level.rooms.map((seats) => ({ seats, top: level.top })),
    note: levelNote(level),
  };
}

const SEMI_A_NOTE: Record<'play-on' | 'wait' | 'last-semi', string> = {
  'play-on': 'the others play on in the level below',
  wait: 'the others wait for Semi-Final B',
  'last-semi': 'the others go to Semi-Final B',
};

/** The grid: a column per round and a row per level; Semi-Final A takes the top row in its round, Semi-Final B and the Final close it. */
export function gridOf(plan: LayeredPlan, firstRound: number): SummaryGrid {
  const rows = plan.levels.map((level) => level.name);
  const rowOf = (name: string): number => rows.indexOf(name as (typeof rows)[number]);
  const half = plan.lastSemiFinal.toFinal;
  const full = plan.finalPlayers;
  const columns: GridColumn[] = plan.rounds.map((round, index) => {
    const cells: Array<GridCell | null> = rows.map(() => null);
    for (const level of round.levels) cells[rowOf(level.level)] = levelCell(level);
    if (round.firstSemiFinal) {
      cells[0] = {
        name: 'Semi-Final A',
        rooms: [{ seats: full, top: half }],
        note: SEMI_A_NOTE[round.firstSemiFinal.others],
      };
    }
    return { title: `Round ${firstRound + index}`, cells, waiting: round.waiting, out: round.out };
  });
  const closing = (title: string, top: number | null, note: string): GridColumn => ({
    title,
    cells: rows.map((_, row) => (row === 0 ? { name: title, rooms: [{ seats: full, top }], note } : null)),
    waiting: 0,
    out: top === null ? 0 : full - half,
  });
  columns.push(closing('Semi-Final B', half, ''), closing('Final', null, 'the title is decided here'));
  return { rows, columns };
}

const topCountName = (firstRound: number, round: number, level: string): string =>
  `Round ${firstRound + round} - ${level}`;

/** A row for every level of every round the plan has (the first semi-final's room has no choice of its own). */
function topCountRowsOf(plan: LayeredPlan, firstRound: number, typedText: string): TopCountRow[] {
  const typed = new Map(parseTopCounts(typedText).map((line) => [line.name, line.top]));
  return plan.rounds.flatMap((round, index) =>
    round.levels.map((level) => {
      const name = topCountName(firstRound, index, level.level);
      return { name, top: level.top, typed: typed.get(name) ?? '' };
    }),
  );
}

/** The typed lines whose round or level the plan does not have: lines that name no round of a bracket, and typed numbers the plan marks as not applying. */
function noLongerApplyOf(plan: LayeredPlan, firstRound: number, orphans: TopCountLine[]): TopCountLine[] {
  const unused = plan.topCounts
    .filter((entry) => !entry.applies)
    .map((entry) => ({ name: topCountName(firstRound, entry.round, entry.level), top: `${entry.top}` }));
  return [...orphans, ...unused];
}

/** The one line over a plan: the players, the bracket, who is out at the table, and the games. */
export function planHeading(plan: LayeredPlan, registered: number): string {
  return `${registered} registered · ${plan.play.value} expected to play · ${plan.inBracket.value} in the bracket · ${plan.outAtTable} out at the table · ${plan.games} games`;
}

/** The summary of the layered bracket for this form and head count (null before a roster is loaded). */
export function layeredSummary(
  form: LayeredForm,
  registered: number | null,
  /** The number of the first bracket round when the tournament is under way and numbers it itself. */
  firstRoundNumber?: number,
): LayeredSummary {
  const format = getGameFormat(form.gameFormat);
  if (!format || registered === null) return { kind: 'waiting', message: NO_LAYERED_ROSTER_TEXT };
  const planned = planLayeredFor(form, registered, firstRoundNumber);
  if (!planned.ok) {
    return {
      kind: 'refused',
      message: planned.message,
      typedTopCounts: parseTopCounts(form.layeredTopCounts),
    };
  }
  const { plan, roomSize, firstRound } = planned;
  return {
    kind: 'ready',
    heading: planHeading(plan, registered),
    numbers: numbersOf(plan),
    flags: flagsOf(plan, roomSize),
    grid: gridOf(plan, firstRound),
    topCounts: topCountRowsOf(plan, firstRound, form.layeredTopCounts),
    noLongerApply: noLongerApplyOf(plan, firstRound, planned.orphans),
    semiOthers: {
      value: plan.semiOthers.value,
      typed: form.layeredSemiOthers,
      noLongerApplies: form.layeredSemiOthers !== '' && plan.semiOthers.value === 'last-semi',
    },
    differsFromUsual: differsFromUsualValues(form, registered),
  };
}

/** The placeholders of the typed fields: the number the app works out, given what else is typed ("automatic" when there is no plan). */
export function layeredPlaceholders(
  form: LayeredForm,
  registered: number | null,
): Record<SummaryNumber['key'], string> {
  const automatic = 'automatic';
  const none = {
    play: automatic,
    inBracket: automatic,
    levels: automatic,
    topLevel: automatic,
    bracketRounds: automatic,
  };
  if (registered === null) return none;
  const planned = planLayeredFor(form, registered);
  if (!planned.ok) return none;
  const { plan } = planned;
  return {
    play: `${plan.play.value}`,
    inBracket: `${plan.inBracket.value}`,
    levels: `${plan.levelCount.value}`,
    topLevel: `${plan.topLevel.value}`,
    bracketRounds: `${plan.bracketRounds.value}`,
  };
}
