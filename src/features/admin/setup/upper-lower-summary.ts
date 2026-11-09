import { getGameFormat } from '../../../domain/tournament/formats';
import type { PersistedSetup, PoolingPhaseKey } from '../../../domain/tournament/types';
import { planUpperLowerFor } from '../../../domain/tournament/upper-lower-form';
import {
  upperLowerShape,
  type UpperLowerBand,
  type UpperLowerRound,
} from '../../../domain/tournament/upper-lower';

export const NO_ROSTER_TEXT = 'Works out the rooms from the head count once a roster is loaded.';

/** One round of the bracket as the Setup panel lists it: its name, its rooms and where its units go. */
export interface UpperLowerSummaryRound {
  name: string;
  rooms: string;
  goes: string;
}

export type UpperLowerSummary =
  | { kind: 'waiting'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'ready'; heading: string; rounds: UpperLowerSummaryRound[] };

const OUT_AT: Record<PoolingPhaseKey, string> = {
  none: 'before the bracket',
  'qual-table': 'in the qualification table',
  swiss: 'in the Swiss',
  'group-stage': 'in the groups',
};

const ranksText = (band: Pick<UpperLowerBand, 'first' | 'last'>): string =>
  band.first === band.last ? `${band.first}` : `${band.first}–${band.last}`;

function roomsText(real: number[]): string {
  return real.length === 1 ? `1 room of ${real[0]}` : `${real.length} rooms: ${real.join(', ')}`;
}

/** Where the units of a round go: its first room's bands, the ranks no band covers (eliminated) named last. */
function goesText(round: UpperLowerRound): string {
  if (round.isFinal) return 'the title is decided here';
  if (round.isRanking) return 'placement match: everyone is out after it';
  const bands = round.rooms[0];
  const parts = bands.map((band) => `${ranksText(band)} → ${band.to}`);
  const covered = bands.at(-1)?.last ?? 0;
  if (covered < round.declared[0])
    parts.push(`${ranksText({ first: covered + 1, last: round.declared[0] })} out`);
  return parts.join(' · ');
}

/**
 * What the Setup panel of an upper and lower bracket says for this form and head count: the rooms that come out of it
 * and the rounds that follow, or why there is no bracket (the same words generation refuses with), or that it waits for
 * a roster.
 */
export function upperLowerSummary(setup: PersistedSetup, registered: number | null): UpperLowerSummary {
  const format = getGameFormat(setup.gameFormat);
  if (!format || registered === null) return { kind: 'waiting', message: NO_ROSTER_TEXT };
  const planned = planUpperLowerFor(setup, registered);
  if (!planned.ok) return { kind: 'refused', message: planned.message };
  const { plan, roomSize } = planned;
  const shape = upperLowerShape(plan.entry, roomSize, plan.firstRound, plan.upper);
  const out = registered - plan.entry;
  const outText = out > 0 ? ` (${out} out ${OUT_AT[setup.poolingPhase]})` : '';
  return {
    kind: 'ready',
    heading: `${plan.entry} of ${registered} enter${outText}: upper ${shape.upper.join(', ')} · lower ${shape.lower.join(', ')}`,
    rounds: shape.rounds.map((round) => ({
      name: round.name,
      rooms: roomsText(round.real),
      goes: goesText(round),
    })),
  };
}
