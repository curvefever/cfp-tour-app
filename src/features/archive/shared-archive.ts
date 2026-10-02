import type { TournamentState } from '../../domain/tournament/types';
import { unmarshalFromFirebase } from '../sync/live-sync';

export interface ArchiveAnnotation {
  text: string;
  timestamp: string;
}

export interface SharedArchiveSummary {
  tournamentId: string;
  title: string;
  dateSaved: string;
  playerCount: number;
  roundsPlayed: number;
  hasSettings: boolean;
}

export interface SharedArchiveEntry {
  tournamentId: string;
  title: string;
  dateSaved: string;
  snapshot: TournamentState;
  annotations: ArchiveAnnotation[];
}

export function archiveTitle(snapshot: Pick<TournamentState, 'title'>): string {
  return snapshot.title.trim() || 'Unnamed Tournament';
}

export function buildSharedArchiveSummary(
  tournamentId: string,
  snapshot: TournamentState,
  dateSaved: string,
): SharedArchiveSummary {
  return {
    tournamentId,
    title: archiveTitle(snapshot),
    dateSaved,
    playerCount: snapshot.players.length,
    roundsPlayed: snapshot.rounds[snapshot.curRound]?.roundNum ?? 0,
    hasSettings: Boolean(snapshot.settings),
  };
}

/** Newest first. */
export function sortArchiveIndex(entries: SharedArchiveSummary[]): SharedArchiveSummary[] {
  return [...entries].sort((a, b) => b.dateSaved.localeCompare(a.dateSaved));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAnnotation(value: unknown): value is ArchiveAnnotation {
  return isRecord(value) && typeof value.text === 'string' && typeof value.timestamp === 'string';
}

function parseSummary(raw: unknown): SharedArchiveSummary | null {
  if (!isRecord(raw)) return null;
  const { tournamentId, title, dateSaved, playerCount, roundsPlayed, hasSettings } = raw;
  if (typeof tournamentId !== 'string' || typeof title !== 'string' || typeof dateSaved !== 'string') {
    return null;
  }
  if (typeof playerCount !== 'number' || typeof roundsPlayed !== 'number') return null;
  return { tournamentId, title, dateSaved, playerCount, roundsPlayed, hasSettings: hasSettings === true };
}

/** Parses the raw `archive/index` node (an object keyed by tournament id), dropping malformed records. */
export function parseArchiveIndex(raw: unknown): SharedArchiveSummary[] {
  const value = unmarshalFromFirebase(raw);
  if (!isRecord(value)) return [];
  return sortArchiveIndex(
    Object.values(value)
      .map(parseSummary)
      .filter((summary): summary is SharedArchiveSummary => summary !== null),
  );
}

/** Parses one raw `archive/entries/{id}` node; `null` when missing or malformed. */
export function parseArchiveEntry(raw: unknown): SharedArchiveEntry | null {
  const value = unmarshalFromFirebase(raw);
  if (!isRecord(value)) return null;
  const { tournamentId, title, dateSaved, snapshot, annotations } = value;
  if (typeof tournamentId !== 'string' || typeof title !== 'string' || typeof dateSaved !== 'string') {
    return null;
  }
  if (!isRecord(snapshot) || !Array.isArray(snapshot.rounds)) return null;
  return {
    tournamentId,
    title,
    dateSaved,
    snapshot: snapshot as unknown as TournamentState,
    annotations: Array.isArray(annotations) ? annotations.filter(isAnnotation) : [],
  };
}
