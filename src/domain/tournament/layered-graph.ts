import type { LayeredPlan } from './layered-plan';
import type { BracketRound, EntryLevel, LevelName, LevelRound } from './layered-search';
import { QUAL_LABEL, roomIndexToLetter } from './waterfall-bracket';

/**
 * The layered bracket as Custom bracket graph text (`ROUNDS:` / `ROUTES:`), the form the Custom bracket engine plays
 * (`docs/rules.md`, "Layered bracket"). Pure: the plan says every room and who goes where; this file only names the
 * rounds and writes the lines. `formatOf` gives the match format token of a round ("BO3", "GAMES 2", or none): the text
 * the app derives has none, the text "Adjust rounds by hand" writes carries the formats the Setup selects said. Names: "Round n - Upper", "Round n - Middle", "Round n - Lower" (n counted on from the
 * rounds played before the bracket), "Semi-Final A" for the top level's full room, "Semi-Final B" and "Final".
 */

const SEMI_FINAL_A = 'Semi-Final A';
const SEMI_FINAL_B = 'Semi-Final B';
const FINAL = 'Final';

/** A rank band of a room: `to` null is a rank no line routes, which goes out. */
interface Band {
  first: number;
  last: number;
  to: string;
}

const bandsText = (bands: Band[]): string =>
  bands
    .map((band) => `${band.first === band.last ? band.first : `${band.first}-${band.last}`}->${band.to}`)
    .join(', ');

/** The seats of a round's rooms as a ROUNDS line writes them: `8`, `2x8`, or `8+8+7` when the rooms differ. */
function seatsText(rooms: number[]): string {
  if (rooms.length === 1) return `${rooms[0]}`;
  return new Set(rooms).size === 1 ? `${rooms.length}x${rooms[0]}` : rooms.join('+');
}

/** What a plan's rounds are called, and where each level's next round is. */
class RoundNames {
  constructor(
    private readonly rounds: BracketRound[],
    private readonly firstRoundNumber: number,
  ) {}

  /** The round of `level` in bracket round `index`: the top level's full room is Semi-Final A. */
  of(index: number, level: LevelName): string {
    if (level === 'Upper' && this.rounds[index].firstSemiFinal) return SEMI_FINAL_A;
    return `Round ${this.firstRoundNumber + index} - ${level}`;
  }

  /** Where the first semi-final's other half goes: down a level and on, or to the last semi-final. */
  afterSemiFinalA(index: number): { upperHalf: string; others: string } {
    const { firstSemiFinal } = this.rounds[index];
    const level = this.rounds[index].levels[0]?.level;
    const playOn = firstSemiFinal?.others === 'play-on' && level !== undefined;
    return { upperHalf: FINAL, others: playOn ? this.of(index + 1, level) : SEMI_FINAL_B };
  }
}

/** Where the top `k` of each room and the rest go: the top half to the same level (or the last semi-final), the rest a level down, or out. */
function levelBands(
  level: LevelRound,
  index: number,
  roomIndex: number,
  names: RoundNames,
  below: LevelName | undefined,
): Band[] {
  const seats = level.rooms[roomIndex];
  const top = level.topGoes === 'stay' ? names.of(index + 1, level.level) : SEMI_FINAL_B;
  const bands = [{ first: 1, last: level.top, to: top }];
  if (below !== undefined) bands.push({ first: level.top + 1, last: seats, to: names.of(index + 1, below) });
  return bands;
}

/** A ROUNDS line: the name, the seats and the round's match format token when there is one (the Final carries none). */
function roundLine(name: string, seats: string, formatOf: (roundName: string) => string): string {
  const token = formatOf(name);
  return `${name} = ${seats}${token ? ` ${token}` : ''}`;
}

function routeLines(name: string, bandsOfRooms: Band[][]): string[] {
  return bandsOfRooms.flatMap((bands, room) => {
    const address = bandsOfRooms.length > 1 ? `${name}.${roomIndexToLetter(room + 1)}` : name;
    return [`${address}: ${bandsText(bands)}`];
  });
}

/** The `Qual` line: the table's ranks go to the levels, the Upper level first; ranks below the last level are out at the table. */
function qualLine(entry: EntryLevel[], names: RoundNames): string {
  let next = 1;
  const bands = entry.map(({ name, players }) => {
    const band = { first: next, last: next + players - 1, to: names.of(0, name) };
    next += players;
    return band;
  });
  return `${QUAL_LABEL}: ${bandsText(bands)}`;
}

/**
 * The graph text of a plan. `firstRoundNumber` is the number of the first bracket round ("Round 5" after four table
 * rounds). Nothing is declared or routed twice: the first semi-final is a round of its own in place of the top level's
 * rounds, and a level with players waiting for the last semi-final sends them there directly.
 */
export function layeredGraphText(
  plan: LayeredPlan,
  firstRoundNumber: number,
  formatOf: (roundName: string) => string = () => '',
): string {
  const names = new RoundNames(plan.rounds, firstRoundNumber);
  const full = plan.finalPlayers;
  const roundLines: string[] = [];
  const routes: string[] = [qualLine(plan.levels, names)];
  plan.rounds.forEach((round, index) => {
    if (round.firstSemiFinal) {
      const { upperHalf, others } = names.afterSemiFinalA(index);
      const half = plan.lastSemiFinal.toFinal;
      roundLines.push(roundLine(SEMI_FINAL_A, `${full}`, formatOf));
      routes.push(
        `${SEMI_FINAL_A}: ${bandsText([
          { first: 1, last: half, to: upperHalf },
          { first: half + 1, last: full, to: others },
        ])}`,
      );
    }
    round.levels.forEach((level, position) => {
      const name = names.of(index, level.level);
      const below = round.levels[position + 1]?.level;
      roundLines.push(roundLine(name, seatsText(level.rooms), formatOf));
      routes.push(
        ...routeLines(
          name,
          level.rooms.map((_, room) => levelBands(level, index, room, names, below)),
        ),
      );
    });
  });
  roundLines.push(roundLine(SEMI_FINAL_B, `${full}`, formatOf), `${FINAL} = ${full} FINAL`);
  routes.push(`${SEMI_FINAL_B}: ${bandsText([{ first: 1, last: plan.lastSemiFinal.toFinal, to: FINAL }])}`);
  return ['ROUNDS:', ...roundLines, '', 'ROUTES:', ...routes, ''].join('\n');
}
