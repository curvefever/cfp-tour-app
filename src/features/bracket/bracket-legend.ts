import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { roundExitRule, type RoomExitBand } from '../../domain/tournament/room-exits';
import type { TournamentState } from '../../domain/tournament/types';
import type { StripeTone } from '../tournament/components/result-row';

export interface LegendRow {
  /** The stripe colour the row explains. */
  tone: StripeTone;
  name: string;
  meaning: string;
  /** A green star follows the name (a lucky loser). */
  star?: boolean;
}

export interface BracketLegend {
  rows: LegendRow[];
  /** The tournament has rounds with lucky-loser spots: the box adds a paragraph on how they work. */
  luckyLosers: boolean;
}

/** The distinct advance destinations of a room's bands, in the order the bands list them. */
function advanceDestinations(bands: RoomExitBand[]): number[] {
  const destinations: number[] = [];
  for (const band of bands) {
    if (band.kind === 'advance' && !destinations.includes(band.destination))
      destinations.push(band.destination);
  }
  return destinations;
}

/** The names of the second and the third destination any round can send units to (waterfall rooms and Qual sources). */
function extraDestinations(state: TournamentState): { second: string[]; third: string[] } {
  const labels = bracketRoundLabels(state);
  const second = new Set<string>();
  const third = new Set<string>();
  const nameOf = (index: number) => labels[index]?.label ?? `Round ${index + 1}`;
  state.rounds.forEach((_, roundIndex) => {
    const rule = roundExitRule(state, roundIndex);
    if (rule.kind === 'per-room') {
      for (const bands of rule.rooms) {
        const destinations = advanceDestinations(bands);
        if (destinations[1] !== undefined) second.add(nameOf(destinations[1]));
        if (destinations[2] !== undefined) third.add(nameOf(destinations[2]));
      }
    } else if (rule.kind === 'standings-cutoff' && rule.bands) {
      const destinations = rule.bands.flatMap((band) =>
        band.destination === 'eliminated' ? [] : [band.destination],
      );
      const distinct = [...new Set(destinations)];
      if (distinct[1] !== undefined) second.add(nameOf(distinct[1]));
      if (distinct[2] !== undefined) third.add(nameOf(distinct[2]));
    }
  });
  return { second: [...second], third: [...third] };
}

/**
 * What the colour key of a Bracket can show for this tournament, and only that: Through, Out and Undecided
 * always; the lucky-loser, losers-bracket and Kings Valley rows only where such rounds exist; and a row naming
 * the second and the third destination (yellow, purple) where a waterfall sends units to several rounds.
 * Purple means a drop to the losers bracket or a third destination, and a tournament has only one of the two:
 * drop bands come from double elimination, while a waterfall round has only advance and eliminate bands.
 */
export function bracketLegend(state: TournamentState): BracketLegend {
  const luckyLosers = state.rounds.some((round) => round.luckyCount > 0 && !round.isNoElim);
  const doubleElimination = state.rounds.some(
    (round) => round.bracket === 'winners' || round.bracket === 'losers',
  );
  const kingsValley = state.rounds.some((round) => round.isKingsValley);
  const { second, third } = extraDestinations(state);
  const rows: LegendRow[] = [{ tone: 'green', name: 'Through', meaning: 'Advances or qualifies' }];
  if (luckyLosers)
    rows.push({ tone: 'green', name: 'Lucky loser', meaning: 'Qualified on a spare spot', star: true });
  if (second.length > 0) {
    rows.push({
      tone: 'yellow',
      name: `Through to ${second.join(' or ')}`,
      meaning: 'A second group of places',
    });
  }
  if (third.length > 0) {
    rows.push({
      tone: 'purple',
      name: `Through to ${third.join(' or ')}`,
      meaning: 'A third group of places',
    });
  }
  rows.push({ tone: 'red', name: 'Out', meaning: 'Eliminated' });
  rows.push({ tone: 'dashed', name: 'Undecided', meaning: 'Not settled yet, or a tie-break pending' });
  if (doubleElimination) {
    rows.push({ tone: 'purple', name: 'Losers bracket', meaning: 'Dropped, still playing' });
  }
  if (kingsValley) {
    rows.push(
      { tone: 'green', name: 'Promoted', meaning: 'Kings Valley: moves up a room' },
      { tone: 'yellow', name: 'Stays', meaning: 'Kings Valley: same room' },
      { tone: 'orange', name: 'Demoted', meaning: 'Kings Valley: moves down a room' },
    );
  }
  return { rows, luckyLosers };
}
