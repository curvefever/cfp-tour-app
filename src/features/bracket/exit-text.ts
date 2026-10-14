import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { type RoomExitBand, type StandingsExitBand } from '../../domain/tournament/room-exits';

export function destinationLabel(roundIndex: number, labels: ReturnType<typeof bracketRoundLabels>): string {
  return labels[roundIndex]?.label ?? `Round ${roundIndex + 1}`;
}

function rankRangeText(fromRank: number, toRank: number): string {
  return fromRank === toRank ? `${fromRank}` : `${fromRank}–${toRank}`;
}

/** The final standings of a Qual source by destination: "1–16 → R1 · 17–24 → R1C · 25+ out"; the open tail is dropped when nobody is ranked past the routed ranks. */
export function standingsBandsText(
  bands: StandingsExitBand[],
  rankedUnits: number,
  labels: ReturnType<typeof bracketRoundLabels>,
): string {
  return bands
    .filter((band) => band.to !== null || band.from <= rankedUnits)
    .map((band) => {
      const ranks = band.to === null ? `${band.from}+` : rankRangeText(band.from, band.to);
      return band.destination === 'eliminated'
        ? `${ranks} out`
        : `${ranks} → ${destinationLabel(band.destination, labels)}`;
    })
    .join(' · ');
}

export function exitBandTone(
  kind: RoomExitBand['kind'],
): 'success' | 'danger' | 'accent' | 'warning' | 'neutral' {
  switch (kind) {
    case 'advance':
    case 'promote':
      return 'success';
    case 'drop':
    case 'demote':
      return 'warning';
    case 'lucky-chance':
      return 'accent';
    case 'eliminate':
      return 'danger';
    case 'stay':
      return 'neutral';
  }
}

export function roomExitChipText(band: RoomExitBand, labels: ReturnType<typeof bracketRoundLabels>): string {
  switch (band.kind) {
    case 'advance':
    case 'drop':
      return `${rankRangeText(band.fromRank, band.toRank)} → ${destinationLabel(band.destination, labels)}`;
    case 'eliminate':
      return `${rankRangeText(band.fromRank, band.toRank)} out`;
    case 'lucky-chance':
      return `${band.rank} ★ lucky loser?`;
    case 'promote':
      return `${rankRangeText(band.fromRank, band.toRank)} ↑ Room ${roomLetter(band.targetRoom)}`;
    case 'stay':
      return `${rankRangeText(band.fromRank, band.toRank)} stay`;
    case 'demote':
      return `${rankRangeText(band.fromRank, band.toRank)} ↓ Room ${roomLetter(band.targetRoom)}`;
  }
}

/**
 * The round a scored row's own destination tag should name -- waterfall and
 * double-elimination rounds only (see the call site), null everywhere else
 * (an eliminated row, or a Kings Valley promote/stay/demote row, which never
 * gets a tag at all). A lucky-chance rank that actually won the spot reports
 * the room's own `advance` destination (the same place a direct advancer
 * from this room goes); one that didn't reports wherever `otherwise` sends
 * it -- a drop's real destination, or null when eliminated outright.
 */
export function exitBandDestination(
  band: RoomExitBand | null,
  isLucky: boolean,
  advanceDestination: number | undefined,
): number | null {
  if (!band) return null;
  if (band.kind === 'advance' || band.kind === 'drop') return band.destination;
  if (band.kind === 'lucky-chance') {
    if (isLucky) return advanceDestination ?? null;
    return band.otherwise === 'eliminate' ? null : band.otherwise.drop;
  }
  return null;
}
