import { roundExitGroups } from '../../domain/tournament/exit-groups';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { usesFairCut } from '../../domain/tournament/fair-cut';
import { roundDestinations } from '../../domain/tournament/waterfall-best';
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
  /** A round has a "best of a place" (a Custom bracket route): the lucky-loser row and paragraph speak of it. */
  bestOfPlace: boolean;
  /** The paragraph on how lucky-loser spots are awarded: the fair cut's rule for a tournament with `cutVersion`, else the earlier sentence. */
  luckyText: string;
}

const FAIR_CUT_LUCKY_TEXT =
  "Each room size loses its fair share of the cut. Within a size, places count first, then score relative to the room's average. A spare cut falls on whichever next in line ranks lower against every room of their size so far.";
const BEST_OF_PLACE_TEXT = "The best of a place is chosen by score relative to the room's average.";
const EARLIER_LUCKY_TEXT = "Spare spots are awarded to players by score relative to their room's average.";

/** A fair-cut round has a place where only some units of a room size advance. */
function hasLuckyChance(state: TournamentState, roundIndex: number): boolean {
  const rule = roundExitRule(state, roundIndex);
  return (
    rule.kind === 'per-room' && rule.rooms.some((bands) => bands.some((band) => band.kind === 'lucky-chance'))
  );
}

/** Whether any round has a second, or a third, group of destinations (waterfall rooms and Qual bands). */
function extraDestinations(state: TournamentState): { hasSecond: boolean; hasThird: boolean } {
  const groups = state.rounds.flatMap((_, roundIndex) => [...roundExitGroups(state, roundIndex).values()]);
  return { hasSecond: groups.some((group) => group === 1), hasThird: groups.some((group) => group >= 2) };
}

/** Whether some round sends units to a ranking round (they play for places there, in a stripe of their own). */
function sendsToRankingRoom(state: TournamentState): boolean {
  return state.rounds.some((round) =>
    roundDestinations(round).some((destination) => state.rounds[destination]?.waterfallRanking),
  );
}

/**
 * What the colour key of a Bracket can show for this tournament, and only that: Through, Out and Undecided
 * always; the lucky-loser, losers-bracket and Kings Valley rows only where such rounds exist; and a generic row
 * for the second and for the third destination (yellow, purple) where a Custom bracket sends units to several
 * rounds (the room's arrow shows which round), and a grey row where units go to a ranking room.
 * Purple means a drop to the losers bracket or a third destination, and a tournament has only one of the two:
 * drop bands come from double elimination, while a waterfall round has only advance and eliminate bands.
 */
export function bracketLegend(state: TournamentState): BracketLegend {
  const bestOfPlace = state.rounds.some((round) => round.waterfallBest);
  const luckyLosers =
    bestOfPlace ||
    state.rounds.some((round, index) =>
      usesFairCut(state, index) ? hasLuckyChance(state, index) : round.luckyCount > 0 && !round.isNoElim,
    );
  const doubleElimination = state.rounds.some(
    (round) => round.bracket === 'winners' || round.bracket === 'losers',
  );
  const kingsValley = state.rounds.some((round) => round.isKingsValley);
  const { hasSecond, hasThird } = extraDestinations(state);
  const rows: LegendRow[] = [{ tone: 'green', name: 'Through', meaning: 'Advances or qualifies' }];
  if (luckyLosers && !bestOfPlace)
    rows.push({ tone: 'green', name: 'Lucky loser', meaning: 'Qualified on a spare spot', star: true });
  if (bestOfPlace) {
    rows.push({
      tone: 'green',
      name: 'Best of a place',
      meaning: 'Sent on as the best of its place',
      star: true,
    });
  }
  if (hasSecond) {
    rows.push({
      tone: 'yellow',
      name: 'Through to another round',
      meaning: "A second group of places; a room's arrow shows where",
    });
  }
  if (hasThird) {
    rows.push({ tone: 'purple', name: 'Through to a third round', meaning: 'A third group of places' });
  }
  if (sendsToRankingRoom(state)) {
    rows.push(
      { tone: 'neutral', name: 'Plays for places', meaning: 'Goes to a ranking room, or plays in one' },
      { tone: 'neutral', name: 'Final place', meaning: 'What a ranking room gives, as in Rankings' },
    );
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
  const luckyText = bestOfPlace
    ? BEST_OF_PLACE_TEXT
    : state.gamemodeConfig.cutVersion === 2
      ? FAIR_CUT_LUCKY_TEXT
      : EARLIER_LUCKY_TEXT;
  return { rows, luckyLosers, bestOfPlace, luckyText };
}
