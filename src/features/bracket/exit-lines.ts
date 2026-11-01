import { roomPointsByPlace } from '../../domain/tournament/advancement';
import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import type { GroupExitShape } from '../../domain/tournament/group-exit';
import { matchResultSettings } from '../../domain/tournament/match-results';
import { roundExitRule, type RoomExitBand } from '../../domain/tournament/room-exits';
import { formatStandingValue } from '../../domain/tournament/scoring';
import {
  standingsKind,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { ordinal } from '../../lib/ordinal';
import { chanceSpots } from '../standings/group-exit-text';
import { standingsNames } from '../standings/standings-names';
import { standingsRowResult, stripeTone, type StripeTone } from '../tournament/components/result-row';
import { destinationLabel } from './exit-text';
import { advanceResult } from './room-row-result';

/** One line of an exit pop-up: a stripe colour (none for pooling rooms), the places it covers and where they go. */
export interface ExitLine {
  tone: StripeTone | null;
  places: string;
  where: string;
}

type Labels = ReturnType<typeof bracketRoundLabels>;

function rankRange(from: number, to: number): string {
  return from === to ? `${from}` : `${from}–${to}`;
}

/** "2 spots", or with several room sizes "2–3 spots, rooms of 4" / "0–1 spot, room of 3". */
function luckySpots(band: Extract<RoomExitBand, { kind: 'lucky-chance' }>): string {
  const spots = `${band.spots} spot${band.spots === 1 ? '' : 's'}`;
  if (band.size === undefined) return spots;
  const range = band.minSpots === band.spots ? `${band.spots}` : `${band.minSpots}–${band.spots}`;
  const group = band.rooms === 1 ? `room of ${band.size}` : `rooms of ${band.size}`;
  return `${range} spot${band.spots === 1 ? '' : 's'}, ${group}`;
}

function roomBandLine(band: RoomExitBand, bands: RoomExitBand[], labels: Labels): ExitLine {
  switch (band.kind) {
    case 'advance':
      return {
        tone: stripeTone(advanceResult(bands, band.destination)),
        places: rankRange(band.fromRank, band.toRank),
        where: `→ ${destinationLabel(band.destination, labels)}`,
      };
    case 'drop':
      return {
        tone: 'purple',
        places: rankRange(band.fromRank, band.toRank),
        where: `→ ${destinationLabel(band.destination, labels)}`,
      };
    case 'lucky-chance':
      return { tone: 'dashed', places: `${band.rank} ★`, where: `lucky loser? (${luckySpots(band)})` };
    case 'eliminate':
      return { tone: 'red', places: rankRange(band.fromRank, band.toRank), where: 'out' };
    case 'promote':
      return {
        tone: 'green',
        places: rankRange(band.fromRank, band.toRank),
        where: `→ Room ${roomLetter(band.targetRoom)}`,
      };
    case 'stay':
      return { tone: 'yellow', places: rankRange(band.fromRank, band.toRank), where: 'stay' };
    case 'demote':
      return {
        tone: 'orange',
        places: rankRange(band.fromRank, band.toRank),
        where: `→ Room ${roomLetter(band.targetRoom)}`,
      };
  }
}

/** The lines of a room's exit pop-up, one per band, coloured like the rows they describe. */
export function roomExitLines(bands: RoomExitBand[], labels: Labels): ExitLine[] {
  return bands.map((band) => roomBandLine(band, bands, labels));
}

/** "1st +8", then "2nd +7 … 7th +2 points": what the places of a room of `roomSize` earn, from the tournament's own scoring. */
function pointsLines(state: TournamentState, roomSize: number): ExitLine[] {
  const points = roomPointsByPlace(state, roomSize).slice(0, roomSize);
  if (points.length === 0) return [];
  const at = (index: number) => `${ordinal(index + 1)} +${points[index]}`;
  const first = at(0);
  if (points.length === 1) return [{ tone: null, places: first, where: '' }];
  if (points.length === 2) return [{ tone: null, places: first, where: at(1) }];
  return [{ tone: null, places: first, where: `${at(1)} … ${at(points.length - 1)} points` }];
}

/** "W +3 · TW +2 · T +1.5" and "TL +1 · L +0": what the result of a game earns under match results, best first, all in one style (the margin is in the standings' explanation). */
function matchResultLines(state: TournamentState): ExitLine[] {
  const settings = matchResultSettings(state);
  if (!settings) return [];
  const [win, tieWin, tieLoss, loss] = settings.points;
  const earns = (code: string, value: number) => `${code} +${formatStandingValue(value)}`;
  const line = (...parts: string[]): ExitLine => ({ tone: null, places: parts.join(' · '), where: '' });
  return [
    line(earns('W', win), earns('TW', tieWin), earns('T', (tieWin + tieLoss) / 2)),
    line(earns('TL', tieLoss), earns('L', loss)),
  ];
}

/** The standings named as their tab is, inside a line: "qualification", "Swiss", "groups". */
function standingsInline(state: TournamentState): string {
  const kind = standingsKind(state);
  return kind === null ? 'standings' : standingsNames(kind).inline;
}

/**
 * The exit pop-up of a pooling room of `roomSize` units: what each of its places earns in a counted round and
 * that everyone goes to the standings ("All → qualification"); a round that does not count is seeding only; a
 * warm-up round sends everyone on. Empty for rounds that have a stripe of their own (bracket rooms, the Final).
 */
export function poolingExitLines(state: TournamentState, roundIndex: number, roomSize: number): ExitLine[] {
  const rule = roundExitRule(state, roundIndex);
  const counted =
    rule.kind === 'standings'
      ? rule.counted
      : rule.kind === 'standings-cutoff' && !state.rounds[roundIndex]?.excludeFromStandings;
  if (rule.kind === 'standings' || rule.kind === 'standings-cutoff') {
    return counted
      ? [
          ...(matchResultSettings(state) ? matchResultLines(state) : pointsLines(state, roomSize)),
          { tone: null, places: 'All', where: `→ ${standingsInline(state)}` },
        ]
      : [{ tone: null, places: 'All', where: 'seeding only, not counted' }];
  }
  if (rule.kind === 'all-advance') {
    const labels = bracketRoundLabels(state);
    return [{ tone: null, places: 'All', where: `→ ${destinationLabel(roundIndex + 1, labels)}` }];
  }
  return [];
}

/** "1 spot", "0–1 spot": the fewest and most spots of a size's chance places, with the noun. */
function spotRange(minSpots: number, maxSpots: number): string {
  const range = minSpots === maxSpots ? `${maxSpots}` : `${minSpots}–${maxSpots}`;
  return `${range} spot${maxSpots === 1 ? '' : 's'}`;
}

/**
 * A group stage that sends a total: the direct places of each group size, then the chance places (even split: the
 * best of one place across the groups; fair cut: per size, the places and how many spots they have), then the rest out.
 */
function groupExitLines(
  shape: GroupExitShape,
  destination: string,
  directTone: StripeTone | null,
): ExitLine[] {
  const to = `→ ${destination}`;
  const sameDirect = shape.classes.every((cls) => cls.direct === shape.classes[0].direct);
  const direct: ExitLine[] = sameDirect
    ? [{ tone: directTone, places: `${rankRange(1, shape.classes[0].direct)} (each group)`, where: to }]
    : shape.classes.map((cls) => ({
        tone: directTone,
        places: `${rankRange(1, cls.direct)} (${cls.groups.length === 1 ? 'group' : 'each group'} of ${cls.sizes[0]})`,
        where: to,
      }));
  const chance: ExitLine[] =
    shape.mode === 'even-split'
      ? chanceSpots(shape) > 0
        ? [
            {
              tone: 'dashed',
              places: `${ordinal(shape.classes[0].direct + 1)}: best ${chanceSpots(shape)} of ${shape.classes[0].groups.length}`,
              where: '',
            },
          ]
        : []
      : shape.classes
          .filter((cls) => cls.maxSpots > 0)
          .map((cls) => ({
            tone: 'dashed',
            places: `${cls.chancePlaces.map((place) => ordinal(place.place)).join(', ')} (${cls.groups.length === 1 ? 'group' : 'each group'} of ${cls.sizes[0]})`,
            where: spotRange(cls.minSpots, cls.maxSpots),
          }));
  return [...direct, ...chance, { tone: 'red', places: 'rest', where: 'out' }];
}

/**
 * The exit pop-up of a standings table: each run of standings with its destination ("1–16 → R1", "17–24 → R1C",
 * "25–37 out"), or the single cut into the first bracket round. A group stage's table repeats per group, so
 * its lines read "1–2 (each group)" and "3+ out".
 */
export function standingsExitLines(
  table: StandingsDisplayTable,
  display: Pick<StandingsDisplay, 'lastStandingsRoundIndex' | 'perGroup' | 'groupExit'>,
  labels: Labels,
): ExitLine[] {
  const total = table.entries.length;
  // The stripe of a line is the stripe of its first row, so the pop-up and the table can never disagree.
  const toneAt = (index: number) => stripeTone(standingsRowResult(index, table, 'live'));
  if (table.bands && table.bands.length > 0) {
    return table.bands.map((band, index) => {
      const next = table.bands?.[index + 1];
      return {
        tone: toneAt(band.start),
        places: rankRange(band.start + 1, next ? next.start : total),
        where: band.destination === 'out' ? 'out' : `→ ${band.destination}`,
      };
    });
  }
  const destination = destinationLabel(display.lastStandingsRoundIndex + 1, labels);
  if (table.cut === null || table.cut >= total) {
    return [{ tone: toneAt(0), places: 'All', where: `→ ${destination}` }];
  }
  if (display.perGroup && display.groupExit && display.groupExit.mode !== 'per-group') {
    return groupExitLines(display.groupExit, destination, toneAt(0));
  }
  if (display.perGroup) {
    return [
      { tone: toneAt(0), places: `${rankRange(1, table.cut)} (each group)`, where: `→ ${destination}` },
      { tone: toneAt(table.cut), places: `${table.cut + 1}+`, where: 'out' },
    ];
  }
  return [
    { tone: toneAt(0), places: rankRange(1, table.cut), where: `→ ${destination}` },
    { tone: toneAt(table.cut), places: rankRange(table.cut + 1, total), where: 'out' },
  ];
}
