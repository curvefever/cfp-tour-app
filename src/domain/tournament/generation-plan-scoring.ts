import {
  type MatchResultPoints,
  matchResultsAllowed,
  parseMatchResultPoints,
  resolveTieMargin,
} from './match-results';
import {
  type GenerationForm,
  type PlanAfterBracketEntry,
  type PlanAfterScoring,
  type Planned,
  refuse,
} from './generation-plan-types';

/** The Custom points table or the match-results settings, when the scoring system needs one. */
export function planScoring(form: GenerationForm, plan: PlanAfterBracketEntry): Planned<PlanAfterScoring> {
  const { config, format, roomSize } = plan;

  let positionalPointsTable: number[] | undefined;
  if (config.scoring === 'positional-points') {
    if (!form.positionalPointsTable.trim()) {
      return refuse(
        'Positional-points scoring needs a rank-to-points table — enter one value per rank, highest rank first (e.g. "10,8,6,5,4,3,2,1").',
      );
    }
    const parts = form.positionalPointsTable.split(',').map((part) => part.trim());
    const values = parts.map((part) => Number.parseInt(part, 10));
    const isValidInteger = (value: number, part: string) =>
      Number.isFinite(value) && value >= 0 && String(value) === part;
    if (values.some((value, index) => !isValidInteger(value, parts[index]))) {
      return refuse(
        `Positional-points table must be a comma-separated list of non-negative whole numbers — got "${form.positionalPointsTable}".`,
      );
    }
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[index - 1]) {
        return refuse(
          `Positional-points table must not increase from rank to rank — got ${values.join(',')}.`,
        );
      }
    }
    if (values.length < roomSize.max) {
      return refuse(
        `Positional-points table needs at least ${roomSize.max} entries (the largest possible room size for this format) — got ${values.length}.`,
      );
    }
    positionalPointsTable = values;
  }

  let matchResults: { points: MatchResultPoints; tieMargin: number } | undefined;
  if (config.scoring === 'match-results') {
    if (!matchResultsAllowed(config.poolingPhase, form.gameFormat, form.oddCountStrategy)) {
      return refuse(
        'Match results scoring is only available for a Group Stage, or for Swiss or a qualification table when every room holds two units (a head-to-head format without Flex) — pick Standard points or a Custom points table.',
      );
    }
    const points = parseMatchResultPoints(form.matchResultPoints);
    if (!points.ok) return refuse(points.message);
    const tieMargin = resolveTieMargin(form.tieMargin, form.gameFormat, format.label);
    if (!tieMargin.ok) return refuse(tieMargin.message);
    matchResults = { points: points.value, tieMargin: tieMargin.value };
  }

  return { ok: true, plan: { ...plan, positionalPointsTable, matchResults } };
}
