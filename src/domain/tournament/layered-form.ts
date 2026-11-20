import { deriveRoomSize, getGameFormat, POOLING_PHASE_WORDS } from './formats';
import { appWrittenStageOf } from './app-written-bracket';
import { layeredGraphText } from './layered-graph';
import {
  planLayered,
  USUAL_GAMES,
  type LayeredGames,
  type LayeredPlan,
  type LayeredTyped,
} from './layered-plan';
import { bestOfGameCount, matchFormatToken, parseMatchFormatToken } from './match-format';
import { matchFormatConfig, parseMatchOverrides, stageFormat } from './round-match-formats';
import { roundsBeforeBracket } from './pooling-rounds';
import type { GameFormatKey, PersistedSetup, PoolingPhaseKey, RoomSize } from './types';

/**
 * What the Setup form and a head count make of a layered bracket: the gate (which game formats and which pooling phases
 * it is written for), the plan, and the graph text the Custom bracket engine plays. The two lists are the only place
 * that says where it is offered: widening it means adding entries.
 */

/** The game formats a layered bracket is written for: free-for-all rooms. */
export const LAYERED_FORMATS: readonly GameFormatKey[] = ['ffa-individual'];

/** The pooling phases a layered bracket can follow: a qualification table, which ranks the players into levels. */
export const LAYERED_POOLING_PHASES: readonly PoolingPhaseKey[] = ['qual-table'];

/** Each pooling phase as a refusal names it. */
const POOLING_PHASE_WHERE: Record<PoolingPhaseKey, string> = {
  none: 'without a pooling phase',
  'qual-table': 'after a qualification table',
  swiss: 'after a Swiss',
  'group-stage': 'after a group stage',
};

const ALTERNATIVES =
  'pick the upper and lower bracket, single elimination or the Custom bracket (built by hand) instead';

export type LayeredForm = Pick<
  PersistedSetup,
  | 'gameFormat'
  | 'poolingPhase'
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'groupSize'
  | 'roundRobinMode'
  | 'nonCountingRounds'
  | 'poolingGames'
  | 'poolingBestOf'
  | 'bracketGames'
  | 'bracketBestOf'
  | 'semisGames'
  | 'semisBestOf'
  | 'finalsGames'
  | 'finalsBestOf'
  | 'losersGames'
  | 'losersBestOf'
  | 'matchOverrides'
  | 'layeredExpected'
  | 'layeredInBracket'
  | 'layeredRounds'
  | 'layeredLevels'
  | 'layeredTop'
  | 'layeredTopCounts'
  | 'layeredSemiOthers'
>;

/** Why a layered bracket is not offered for this game format and pooling phase, or null when it is. */
export function layeredGateRefusal(form: Pick<LayeredForm, 'gameFormat' | 'poolingPhase'>): string | null {
  if (!LAYERED_FORMATS.includes(form.gameFormat)) {
    const label = getGameFormat(form.gameFormat)?.label ?? form.gameFormat;
    const written = LAYERED_FORMATS.map((key) => getGameFormat(key)?.label ?? key).join(' or ');
    return `A layered bracket is not available for ${label} yet: it is written for ${written}. Please ${ALTERNATIVES}.`;
  }
  if (!LAYERED_POOLING_PHASES.includes(form.poolingPhase)) {
    const follows = LAYERED_POOLING_PHASES.map((phase) => POOLING_PHASE_WORDS[phase].recap.toLowerCase());
    return `A layered bracket cannot be written ${POOLING_PHASE_WHERE[form.poolingPhase]} yet: it follows the ${follows.join(' or the ')}. Choose a qualification table, or ${ALTERNATIVES}.`;
  }
  return null;
}

export type LayeredFormPlan =
  | {
      ok: true;
      plan: LayeredPlan;
      roomSize: RoomSize;
      firstRound: number;
      /** Typed top places of each room whose round name is no round of a bracket (a number before the first bracket round, or no such level): they no longer apply. */
      orphans: TopCountLine[];
    }
  | { ok: false; message: string };

/** One line of the typed top places of each room: a round's name ("Round 6 - Middle") and the number as typed. */
export interface TopCountLine {
  name: string;
  top: string;
}

/** The lines of the `layeredTopCounts` field, in the order typed. */
export function parseTopCounts(text: string): TopCountLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.lastIndexOf(':');
      return at < 0
        ? { name: line, top: '' }
        : { name: line.slice(0, at).trim(), top: line.slice(at + 1).trim() };
    });
}

export const topCountsText = (lines: TopCountLine[]): string =>
  lines.map((line) => `${line.name}: ${line.top}`).join('\n');

/** The field's text with the number of one round and level set, or taken out when `top` is empty. */
export function withTopCount(text: string, name: string, top: string): string {
  const lines = parseTopCounts(text);
  const known = lines.some((line) => line.name === name);
  const next = known
    ? lines.map((line) => (line.name === name ? { name, top } : line))
    : [...lines, { name, top }];
  return topCountsText(next.filter((line) => line.top.trim() !== ''));
}

const COUNT_NAME = /^Round (\d+) - (Upper|Middle|Lower)$/;

type Typed = { ok: true; typed: LayeredTyped; orphans: TopCountLine[] } | { ok: false; message: string };

/** A typed whole number, undefined when the field is empty, null when it is not a positive whole number. */
function wholeNumber(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  return /^[1-9][0-9]*$/.test(text) ? Number(text) : null;
}

/** What the organiser typed in the layered fields, or the first that is no number (the plan's own limits are checked by the plan). */
export function layeredTypedOf(form: LayeredForm, firstRound: number): Typed {
  const numbers = {
    play: [form.layeredExpected, 'Expected to play'],
    inBracket: [form.layeredInBracket, 'In the bracket'],
    bracketRounds: [form.layeredRounds, 'Bracket rounds'],
    topLevel: [form.layeredTop, 'Top level'],
  } as const;
  const typed: LayeredTyped = {};
  for (const [key, [raw, label]] of Object.entries(numbers)) {
    const value = wholeNumber(raw);
    if (value === null) return { ok: false, message: `${label} must be a whole number — got "${raw}".` };
    if (value !== undefined) typed[key as keyof typeof numbers] = value;
  }
  const levels = form.layeredLevels.trim();
  if (levels && levels !== '2' && levels !== '3') {
    return { ok: false, message: `Levels must be 2 or 3 — got "${form.layeredLevels}".` };
  }
  if (levels) typed.levels = levels === '2' ? 2 : 3;
  if (form.layeredSemiOthers) typed.semiOthers = form.layeredSemiOthers;
  const orphans: TopCountLine[] = [];
  const topCounts: NonNullable<LayeredTyped['topCounts']> = [];
  for (const line of parseTopCounts(form.layeredTopCounts)) {
    const top = wholeNumber(line.top);
    if (!top) {
      return {
        ok: false,
        message: `The top places of each room for ${line.name} must be a whole number — got "${line.top}".`,
      };
    }
    const named = COUNT_NAME.exec(line.name);
    const round = named ? Number(named[1]) - firstRound : -1;
    if (!named || round < 0) orphans.push(line);
    else topCounts.push({ round, level: named[2] as 'Upper' | 'Middle' | 'Lower', top });
  }
  if (topCounts.length > 0) typed.topCounts = topCounts;
  return { ok: true, typed, orphans };
}

/** The most games a room can need in a stage: a Best of N takes its deciding game, else the games summed. */
function gamesOfStage(games: string, bestOf: string, roomUnits: number): number {
  const best = Number.parseInt(bestOf, 10);
  return best ? bestOfGameCount(best, roomUnits) : Number.parseInt(games, 10) || 1;
}

/**
 * How the form's formats count the games of the whole tournament: every table round (pooling format), an ordinary
 * bracket round (bracket rounds format), a Semi-Final and the Final. Per-round overrides are not counted.
 */
export function layeredGamesOf(form: LayeredForm, roomSize: RoomSize, registered: number): LayeredGames {
  const room = roomSize.ideal;
  const table =
    roundsBeforeBracket(form, registered) * gamesOfStage(form.poolingGames, form.poolingBestOf, room);
  return {
    table,
    bracket: gamesOfStage(form.bracketGames, form.bracketBestOf, room),
    semis: gamesOfStage(form.semisGames, form.semisBestOf, room),
    final: gamesOfStage(form.finalsGames, form.finalsBestOf, room),
  };
}

/** The settings of the organiser's usual tournament: 4 table rounds with the first not counted, the Semi-Finals and the Final over two games each. */
export const USUAL_FORM_VALUES = {
  qualRoundsOverride: '4',
  nonCountingRounds: '1',
  semisGames: '2',
  semisBestOf: '',
  finalsGames: '2',
  finalsBestOf: '',
} as const satisfies Partial<PersistedSetup>;

/** Whether the form's table rounds, non-counting rounds, Semis or Finals format differ from the usual values. */
export function differsFromUsualValues(form: LayeredForm, registered: number): boolean {
  const games = layeredGamesOf(form, { min: 1, ideal: 8, max: 8 }, registered);
  const nonCounting = Number.parseInt(form.nonCountingRounds, 10) || 0;
  return (
    roundsBeforeBracket(form, registered) !== Number(USUAL_FORM_VALUES.qualRoundsOverride) ||
    nonCounting !== Number(USUAL_FORM_VALUES.nonCountingRounds) ||
    games.semis !== USUAL_GAMES.semis ||
    games.final !== USUAL_GAMES.final ||
    form.semisBestOf !== '' ||
    form.finalsBestOf !== ''
  );
}

/** The plan for the form and the head count, or why there is none: the gate first, then the plan's own refusals. */
export function planLayeredFor(form: LayeredForm, registered: number): LayeredFormPlan {
  const gate = layeredGateRefusal(form);
  if (gate) return { ok: false, message: gate };
  const format = getGameFormat(form.gameFormat);
  if (!format) return { ok: false, message: 'This game format is not available yet.' };
  const roomSize = deriveRoomSize(format);
  const firstRound = roundsBeforeBracket(form, registered) + 1;
  const typed = layeredTypedOf(form, firstRound);
  if (!typed.ok) return typed;
  const planned = planLayered({
    registered,
    roomSize,
    firstRound,
    games: layeredGamesOf(form, roomSize, registered),
    typed: typed.typed,
  });
  if (!planned.ok) return planned;
  return {
    ok: true,
    plan: planned.plan,
    roomSize,
    firstRound,
    orphans: typed.orphans,
  };
}

/** The graph text of the layered bracket for the form and the head count, or why there is none. */
export function layeredGraphFor(
  form: LayeredForm,
  registered: number,
): { ok: true; text: string; play: number } | { ok: false; message: string } {
  const planned = planLayeredFor(form, registered);
  if (!planned.ok) return planned;
  return {
    ok: true,
    text: layeredGraphText(planned.plan, planned.firstRound),
    play: planned.plan.play.value,
  };
}

/** The match format of a round as a ROUNDS-line token, or '' for the default single game (the Final carries none). */
function tokenOf(roundName: string, form: LayeredForm): string {
  if (roundName === 'Final') return '';
  const override = parseMatchFormatToken(parseMatchOverrides(form.matchOverrides)[roundName] ?? '');
  const match =
    override ?? stageFormat(appWrittenStageOf(roundName, false), matchFormatConfig(form, 'layered'));
  return match.bestOf !== undefined || match.games !== 1 ? matchFormatToken(match) : '';
}

/**
 * The graph text "Adjust rounds by hand" hands to the Custom bracket: the worked-out rounds, each with the match format
 * the Setup selects and the per-round overrides gave it.
 */
export function layeredByHand(
  form: LayeredForm,
  registered: number,
): { ok: true; text: string } | { ok: false; message: string } {
  const planned = planLayeredFor(form, registered);
  if (!planned.ok) return planned;
  return {
    ok: true,
    text: layeredGraphText(planned.plan, planned.firstRound, (roundName) => tokenOf(roundName, form)),
  };
}
