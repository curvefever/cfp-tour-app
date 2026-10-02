import type { TournamentState } from '../../domain/tournament/types';
import { TOURNAMENT_ID_PATTERN } from '../sync/tournament-write.shared';
import type { ArchiveAnnotation } from './shared-archive';

export const ARCHIVE_MAX_ANNOTATIONS = 200;
export const ARCHIVE_MAX_ANNOTATION_CHARS = 1000;

export type ArchiveSaveInput = { tournamentId: string; snapshot: TournamentState };
export type ArchiveDeleteInput = { tournamentId: string };
export type ArchiveAnnotationsInput = { tournamentId: string; annotations: ArchiveAnnotation[] };

function validateTournamentId(value: unknown): string {
  const tournamentId = typeof value === 'string' ? value.trim() : '';
  if (!TOURNAMENT_ID_PATTERN.test(tournamentId)) throw new Error('Invalid tournament ID.');
  return tournamentId;
}

export function validateArchiveSaveInput(input: ArchiveSaveInput): ArchiveSaveInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid archive update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  const snapshot = input.snapshot as unknown;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Invalid tournament data.');
  }
  const { rounds, title } = snapshot as Record<string, unknown>;
  if (!Array.isArray(rounds) || typeof title !== 'string') throw new Error('Invalid tournament data.');
  const cleaned = { ...(snapshot as Record<string, unknown>) };
  delete cleaned.adminProof;
  return { tournamentId, snapshot: cleaned as unknown as TournamentState };
}

export function validateArchiveDeleteInput(input: ArchiveDeleteInput): ArchiveDeleteInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid archive update.');
  return { tournamentId: validateTournamentId(input.tournamentId) };
}

function validateAnnotation(raw: unknown): ArchiveAnnotation {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid annotation.');
  const { text, timestamp } = raw as Record<string, unknown>;
  if (typeof text !== 'string' || typeof timestamp !== 'string') throw new Error('Invalid annotation.');
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > ARCHIVE_MAX_ANNOTATION_CHARS) {
    throw new Error(`Annotations must be 1-${ARCHIVE_MAX_ANNOTATION_CHARS} characters.`);
  }
  return { text: trimmed, timestamp };
}

export function validateArchiveAnnotationsInput(input: ArchiveAnnotationsInput): ArchiveAnnotationsInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid archive update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!Array.isArray(input.annotations) || input.annotations.length > ARCHIVE_MAX_ANNOTATIONS) {
    throw new Error(`An entry can hold at most ${ARCHIVE_MAX_ANNOTATIONS} annotations.`);
  }
  return { tournamentId, annotations: input.annotations.map(validateAnnotation) };
}
