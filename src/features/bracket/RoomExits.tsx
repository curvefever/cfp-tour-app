import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { type RoomExitBand, type RoundExitRule } from '../../domain/tournament/room-exits';
import { ordinal } from '../../lib/ordinal';
import { Badge } from '../../components/ui';
import { destinationLabel, exitBandTone, roomExitChipText, standingsBandsText } from './exit-text';

/** The small colour-coded chips under a room's own label describing exactly how it exits -- the same rule the row colours and destination tags (Stage 3) read from, so all three always agree. Renders in every state (future/current/past) since roundExitRule itself is score-independent. */
export function RoomExitChips({
  bands,
  labels,
}: {
  bands: RoomExitBand[];
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (!bands.length) return null;
  return (
    <div className='mb-1 flex flex-wrap gap-1'>
      {bands.map((band, index) => (
        <Badge
          className='rounded-md px-1.5 py-px text-[0.62rem] leading-snug normal-case tracking-normal whitespace-normal'
          key={index}
          title={
            band.kind === 'lucky-chance'
              ? `The best ${ordinal(band.rank)} place across all rooms, by share of its room's total, also advances (${band.spots} spot${band.spots === 1 ? '' : 's'})`
              : undefined
          }
          tone={exitBandTone(band.kind)}
        >
          {roomExitChipText(band, labels)}
        </Badge>
      ))}
    </div>
  );
}

/** The one round-level exit line for a round whose exit isn't per-room (a no-elim warm-up, a qual/Swiss/group-stage round, or the standings cut-off into the bracket) -- null for 'per-room' (room chips cover it) and 'none' (Final/grand-final, nothing to say). */
export function RoundExitSummary({
  rule,
  labels,
  rankedUnits,
}: {
  rule: RoundExitRule;
  labels: ReturnType<typeof bracketRoundLabels>;
  rankedUnits: number;
}) {
  if (rule.kind === 'per-room' || rule.kind === 'none') return null;
  const text =
    rule.kind === 'all-advance'
      ? 'Everyone advances'
      : rule.kind === 'standings'
        ? rule.counted
          ? 'Counts toward standings'
          : 'Seeding only, not counted'
        : rule.bands
          ? standingsBandsText(rule.bands, rankedUnits, labels)
          : `Top ${rule.advancing} ${rule.perGroup ? 'per group' : 'in standings'} → ${destinationLabel(rule.destination, labels)}`;
  return (
    <Badge
      className='mb-2 px-2 py-0.5 text-[0.65rem] leading-snug normal-case tracking-normal whitespace-normal'
      tone={rule.kind === 'standings' && !rule.counted ? 'neutral' : 'primary'}
    >
      {text}
    </Badge>
  );
}

/** A scored row's own small muted "→ SemiB" / "→ LB Round 4" -- see exitBandDestination for which rows get one. */
export function DestinationTag({
  destination,
  labels,
}: {
  destination: number | null;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (destination === null) return null;
  return (
    <span className='ml-1 text-[0.62rem] whitespace-nowrap text-muted'>
      → {destinationLabel(destination, labels)}
    </span>
  );
}
