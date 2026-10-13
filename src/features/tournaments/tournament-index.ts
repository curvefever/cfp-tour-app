import type { GameFormatKey, PoolingPhaseKey, ScheduleLogicKey } from '../../domain/tournament/types';
import type { TournamentSummary } from './tournament-summary';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseSummary(id: string, raw: unknown): TournamentSummary | null {
  if (!isRecord(raw)) return null;
  const { status } = raw;
  if (status !== 'draft' && status !== 'published' && status !== 'finished') return null;
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    status,
    started: raw.started === true,
    testRun: raw.testRun === true,
    scheduledAt: numberOrNull(raw.scheduledAt),
    createdAt: numberOrNull(raw.createdAt) ?? 0,
    finishedAt: numberOrNull(raw.finishedAt),
    gameFormat: (typeof raw.gameFormat === 'string' ? raw.gameFormat : 'ffa-individual') as GameFormatKey,
    poolingPhase: (typeof raw.poolingPhase === 'string' ? raw.poolingPhase : 'none') as PoolingPhaseKey,
    scheduleLogic: (typeof raw.scheduleLogic === 'string'
      ? raw.scheduleLogic
      : 'single-elimination') as ScheduleLogicKey,
    unitCount: numberOrNull(raw.unitCount) ?? 0,
  };
}

/** Parses the decoded `index` node (an object keyed by tournament id), dropping malformed entries. */
export function parseTournamentIndex(raw: unknown): TournamentSummary[] {
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([id, entry]) => {
    const summary = parseSummary(id, entry);
    return summary ? [summary] : [];
  });
}

const newestFirst = (a: TournamentSummary, b: TournamentSummary) => b.createdAt - a.createdAt;

/** What the Admin list shows: drafts, published and ongoing tournaments, newest first. Finished ones are reached from Tournaments. */
export function adminListEntries(summaries: TournamentSummary[]): TournamentSummary[] {
  return summaries.filter((summary) => summary.status !== 'finished').sort(newestFirst);
}

/** What Copy settings offers: every tournament that is not a draft, newest first. */
export function copyableTournaments(summaries: TournamentSummary[]): TournamentSummary[] {
  return summaries.filter((summary) => summary.status !== 'draft').sort(newestFirst);
}
