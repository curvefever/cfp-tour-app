import { isPoolingRound } from './pooling';
import type { PersistedSetup, RoundNoteStage, RoundNotes, TournamentRound } from './types';
import { parseWaterfallGraph } from './waterfall-bracket';

export type RoundNoteKey = { kind: 'stage'; stage: RoundNoteStage } | { kind: 'round'; label: string };

export interface RoundNoteRow {
  key: RoundNoteKey;
  name: string;
  hint?: string;
  /** The stored text, '' when there is none. */
  note: string;
  /** A stored round label that is no longer in the graph. */
  orphan?: true;
}

export type RoundNoteSetup = Pick<PersistedSetup, 'scheduleLogic' | 'poolingPhase' | 'waterfallGraph'>;

const POOLING_ROW_NAMES: Record<RoundNoteSetup['poolingPhase'], string> = {
  none: 'Warm-up rounds',
  'qual-table': 'Qualification rounds',
  swiss: 'Swiss rounds',
  'group-stage': 'Group stage rounds',
};

/** The stage whose note covers this round. A waterfall round is always `bracket`: its own label's note replaces Semis and Final notes there. */
export function roundNoteStage(round: TournamentRound): RoundNoteStage {
  if (round.isWaterfall) return 'bracket';
  if (round.isFinal || round.bracket === 'grand-final') return 'final';
  if (round.isSemis) return 'semis';
  return isPoolingRound(round) ? 'pooling' : 'bracket';
}

const clean = (text: string | undefined): string => text?.trim() ?? '';

/** The note a round shows: its own label's (waterfall rounds), else its stage's, else for Semis and Final the `bracket` note; '' for none. */
export function roundNote(notes: RoundNotes | undefined, round: TournamentRound): string {
  if (!notes) return '';
  const own = round.isWaterfall && round.customLabel ? clean(notes.rounds?.[round.customLabel]) : '';
  if (own) return own;
  const stage = roundNoteStage(round);
  const staged = clean(notes.stages?.[stage]);
  if (staged || (stage !== 'semis' && stage !== 'final')) return staged;
  return clean(notes.stages?.bracket);
}

function waterfallLabels(graphText: string): string[] {
  const parsed = parseWaterfallGraph(graphText, { allowIncomplete: true });
  return parsed.ok ? parsed.value.roundLines.map((line) => line.label) : [];
}

function stageRow(
  notes: RoundNotes | undefined,
  stage: RoundNoteStage,
  name: string,
  hint?: string,
): RoundNoteRow {
  return {
    key: { kind: 'stage', stage },
    name,
    ...(hint ? { hint } : {}),
    note: notes?.stages?.[stage] ?? '',
  };
}

/** The rows the Setup editor lists: stages first, then a waterfall's round labels, then orphaned label notes. */
export function roundNoteRows(setup: RoundNoteSetup, notes: RoundNotes | undefined): RoundNoteRow[] {
  const isWaterfall = setup.scheduleLogic === 'waterfall-bracket';
  const rows = [stageRow(notes, 'pooling', POOLING_ROW_NAMES[setup.poolingPhase])];
  rows.push(
    isWaterfall
      ? stageRow(notes, 'bracket', 'Other bracket rounds', 'Every waterfall round without a note of its own')
      : stageRow(
          notes,
          'bracket',
          'Bracket rounds',
          'Every bracket round without a note of its own, Semis and Final included',
        ),
  );
  if (setup.scheduleLogic === 'single-elimination') rows.push(stageRow(notes, 'semis', 'Semis'));
  if (!isWaterfall) rows.push(stageRow(notes, 'final', 'Final'));
  const labels = isWaterfall ? waterfallLabels(setup.waterfallGraph) : [];
  for (const label of labels) {
    rows.push({ key: { kind: 'round', label }, name: label, note: notes?.rounds?.[label] ?? '' });
  }
  for (const [label, note] of Object.entries(notes?.rounds ?? {})) {
    if (!labels.includes(label))
      rows.push({ key: { kind: 'round', label }, name: label, note, orphan: true });
  }
  return rows;
}

function withEntry(
  map: Readonly<Record<string, string | undefined>> | undefined,
  key: string,
  value: string,
): Record<string, string> | undefined {
  const next: Record<string, string> = {};
  for (const [name, text] of Object.entries(map ?? {})) if (text && name !== key) next[name] = text;
  if (value) next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The notes with one changed: blank text deletes it, and an empty map is dropped (`undefined` when nothing is left). */
export function setRoundNote(
  notes: RoundNotes | undefined,
  key: RoundNoteKey,
  text: string,
): RoundNotes | undefined {
  const value = text.trim();
  const stages =
    key.kind === 'stage'
      ? (withEntry(notes?.stages, key.stage, value) as RoundNotes['stages'])
      : notes?.stages;
  const rounds = key.kind === 'round' ? withEntry(notes?.rounds, key.label, value) : notes?.rounds;
  if (!stages && !rounds) return undefined;
  return { ...(stages ? { stages } : {}), ...(rounds ? { rounds } : {}) };
}
