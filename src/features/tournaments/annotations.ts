import type { TournamentAnnotation } from '../../domain/tournament/types';

export const MAX_ANNOTATION_CHARS = 1000;

/** The notes with a new one added at the end; the same notes when the text is empty or too long. */
export function addAnnotation(
  annotations: readonly TournamentAnnotation[],
  text: string,
  timestamp: string,
): TournamentAnnotation[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_ANNOTATION_CHARS) return [...annotations];
  return [...annotations, { text: trimmed, timestamp }];
}

/** The notes without the one at `position`. */
export function removeAnnotation(
  annotations: readonly TournamentAnnotation[],
  position: number,
): TournamentAnnotation[] {
  return annotations.filter((_, index) => index !== position);
}

export interface PositionedAnnotation extends TournamentAnnotation {
  /** Where the note is in the stored list, which is what deleting it needs. */
  position: number;
}

/** The notes as the panel lists them, the most recent first. */
export function annotationsNewestFirst(annotations: readonly TournamentAnnotation[]): PositionedAnnotation[] {
  return annotations
    .map((annotation, position) => ({ ...annotation, position }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.position - a.position);
}
