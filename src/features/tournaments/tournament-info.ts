import type { GameFormatKey, PoolingPhaseKey, ScheduleLogicKey } from '../../domain/tournament/types';

const FORMAT_NAMES: Record<GameFormatKey, string> = {
  'ffa-individual': 'FFA',
  'team-2v2v2v2': '2v2v2v2',
  'team-3v3v3': '3v3v3',
  'team-3v3': '3v3',
  'individual-1v1': '1v1',
};

const POOLING_NAMES: Record<PoolingPhaseKey, string | null> = {
  none: null,
  'qual-table': 'Qualification table',
  swiss: 'Swiss',
  'group-stage': 'Group stage',
};

const BRACKET_NAMES: Record<ScheduleLogicKey, string> = {
  'single-elimination': 'Single elimination',
  'double-elimination': 'Double elimination',
  'double-elimination-shared-final': 'Double elimination',
  'kings-valley': 'Kings Valley',
  'waterfall-bracket': 'Waterfall bracket',
};

/** One line describing how a tournament is played, without round counts: "1v1 · Swiss · Single elimination". */
export function tournamentFormatLine(format: {
  gameFormat: GameFormatKey;
  poolingPhase: PoolingPhaseKey;
  scheduleLogic: ScheduleLogicKey;
}): string {
  return [
    FORMAT_NAMES[format.gameFormat],
    POOLING_NAMES[format.poolingPhase],
    BRACKET_NAMES[format.scheduleLogic],
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export interface DateFormatOptions {
  /** The language of the weekday and month names; the browser's own by default. */
  locale?: string;
  /** An IANA time zone; the browser's own by default. */
  timeZone?: string;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** "45 min", "3 h" or "2 days": the size of a gap, in the largest sensible unit. */
function describeGap(gapMs: number): string {
  const minutes = Math.round(gapMs / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(gapMs / HOUR_MS);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

function relativePart(scheduledMs: number, nowMs: number): string {
  const gap = scheduledMs - nowMs;
  if (Math.abs(gap) < MINUTE_MS) return gap >= 0 ? 'starting now' : 'just started';
  return gap > 0 ? `in ${describeGap(gap)}` : `started ${describeGap(-gap)} ago`;
}

/**
 * The scheduled time as the viewer reads it: weekday, date and time in their own time zone, then how far away it
 * is ("Sat 18 Oct, 20:00 · in 2 days"). It depends on the browser and the clock, so render it after hydration only.
 */
export function formatScheduledAt(
  scheduledMs: number,
  nowMs: number,
  options: DateFormatOptions = {},
): string {
  const parts = new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
  }).formatToParts(new Date(scheduledMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const date = `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
  return `${date} · ${relativePart(scheduledMs, nowMs)}`;
}
