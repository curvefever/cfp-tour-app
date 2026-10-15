import type { GameFormatKey, PoolingPhaseKey, ScheduleLogicKey } from '../../domain/tournament/types';
import type { TournamentWinner } from '../../domain/tournament/rankings';
import type { TournamentSummary } from './tournament-summary';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The stored winners: the valid entries only, or nothing when there are none (older tournaments have no winners). */
export function parseWinners(raw: unknown): TournamentWinner[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const winners = raw.flatMap((entry): TournamentWinner[] => {
    if (!isRecord(entry) || typeof entry.label !== 'string' || !entry.label.trim()) return [];
    const members = Array.isArray(entry.members)
      ? entry.members.filter((member): member is string => typeof member === 'string')
      : [];
    return [{ label: entry.label, members: members.length ? members : null }];
  });
  return winners.length ? winners : undefined;
}

function winnersField(raw: unknown): { winners?: TournamentWinner[] } {
  const winners = parseWinners(raw);
  return winners ? { winners } : {};
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
    ...winnersField(raw.winners),
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
