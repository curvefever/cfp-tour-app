import { getGameFormat } from '../formats';
import { removeRosterUnit, renameIndividual, swapIndividual, swapTeam } from '../mutations';
import { rosterKeys } from '../roster';
import { roundsInPlay } from '../round-columns';
import { SHARED_TIE_MARK } from '../scoring';
import type { TournamentState } from '../types';

/**
 * Test helpers for the bookkeeping between the parts of a stored tournament. A correction (a removal, a swap, a rename, a
 * step back) changes one part and can forget another part that holds the same seat or the same name; the tests of a
 * correction check the part it is about. These check that the whole still agrees with itself.
 *
 * In an individual format a unit is its name, in a team format its team id: every store below holds that key.
 */

type Violations = string[];

/** The rule's violations of a state, each starting with the rule's name. */
type Rule = (state: TournamentState) => Violations;

const SEAT_KEY = /^r(\d+)-rm(\d+)-p(\d+)(?:-g(\d+))?(?:-m(\d+))?$/u;

function unitsOf(state: TournamentState): Set<string> {
  return new Set([...rosterKeys(state.players), ...state.withdrawnUnits.map((unit) => unit.name)]);
}

/** Every stored name with where it is stored, for the rule "each is a unit of the roster or a recorded withdrawal". */
function storedNames(state: TournamentState): Array<{ where: string; name: string }> {
  const names: Array<{ where: string; name: string }> = [];
  const add = (where: string, list: readonly string[]) => list.forEach((name) => names.push({ where, name }));
  state.assignments.forEach((round, index) =>
    add(
      `assignments[${index}]`,
      round.map((entry) => entry.name),
    ),
  );
  state.byes.forEach((round, index) => add(`byes[${index}]`, round));
  state.luckyLosers.forEach((round, index) => add(`luckyLosers[${index}]`, round));
  for (const [round, seeds] of Object.entries(state.pendingBracketSeeds)) {
    add(
      `pendingBracketSeeds[${round}]`,
      seeds.map((seed) => seed.name),
    );
  }
  add(
    'qualTable',
    state.qualTable.map((entry) => entry.name),
  );
  state.groups.forEach((group) => add(`groups[${group.label}]`, group.members));
  for (const [group, standings] of Object.entries(state.groupStandings)) {
    add(
      `groupStandings[${group}]`,
      standings.map((entry) => entry.name),
    );
  }
  for (const [tie, value] of Object.entries(state.tieResolutions)) {
    const decided = (Array.isArray(value) ? value : [value]).filter(
      (name) => name !== '' && name !== SHARED_TIE_MARK,
    );
    add(`tieResolutions[${tie}]`, decided);
  }
  add(
    'anonymousFinalists',
    state.anonymousFinalists.map((finalist) => finalist.realKey),
  );
  add(
    'withdrawnUnits.replacedBy',
    state.withdrawnUnits.flatMap((unit) => unit.replacedBy ?? []),
  );
  return names;
}

/** Every name stored anywhere is a unit of the roster or the name of a unit that left (catches a rename that missed a store). */
const everyNameIsAUnit: Rule = (state) => {
  const units = unitsOf(state);
  return storedNames(state)
    .filter(({ name }) => !units.has(name))
    .map(
      ({ where, name }) =>
        `every-name-is-a-unit: "${name}" in ${where} is neither on the roster nor withdrawn`,
    );
};

/** No unit sits in two rooms of one round, nor in a room and a bye of it. */
const oneSeatPerRound: Rule = (state) => {
  const violations: Violations = [];
  state.assignments.forEach((round, index) => {
    const seen = new Set<string>();
    for (const entry of round) {
      if (seen.has(entry.name))
        violations.push(`one-seat-per-round: "${entry.name}" twice in round ${index}`);
      seen.add(entry.name);
    }
    const seated = new Set(round.filter((entry) => entry.room !== null).map((entry) => entry.name));
    for (const name of state.byes[index] ?? []) {
      if (seated.has(name))
        violations.push(`one-seat-per-round: "${name}" in a room and a bye of round ${index}`);
    }
  });
  return violations;
};

/** Every absence answer's key points at a seat that exists: its round and room, a position inside the room, a game of the round, a member of the team. */
const absenceAnswersHaveASeat: Rule = (state) => {
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  return Object.keys(state.absences ?? {}).flatMap((key) => {
    const match = SEAT_KEY.exec(key);
    if (!match) return [`absence-answers-have-a-seat: "${key}" is not a seat key`];
    const [round, room, position, game, member] = [match[1], match[2], match[3], match[4], match[5]].map(
      (part) => (part === undefined ? null : Number(part)),
    ) as [number, number, number, number | null, number | null];
    const seats = (state.assignments[round] ?? []).filter((entry) => entry.room === room).length;
    const numGames = Math.max(state.rounds[round]?.numGames ?? 1, 1);
    const problem =
      state.rounds[round] === undefined
        ? 'no such round'
        : position >= seats
          ? `no seat ${position} in room ${room} (${seats} seated)`
          : game !== null && game > numGames
            ? `no game ${game}`
            : member !== null && member >= teamSize
              ? `no member ${member}`
              : null;
    return problem === null ? [] : [`absence-answers-have-a-seat: "${key}": ${problem}`];
  });
};

/** The anonymous finalists are empty while the Final is not drawn or has no marked game, and otherwise are exactly the Final's line-up (catches a list left from another Final). */
const anonymousFinalistsAreTheFinalLineup: Rule = (state) => {
  const index = state.rounds.findIndex((round) => round.isFinal);
  const lineup = (state.assignments[index] ?? []).map((entry) => entry.name);
  const listed = state.anonymousFinalists.map((finalist) => finalist.realKey);
  const marked = (state.rounds[index]?.anonymousGames ?? []).length > 0;
  if (lineup.length === 0 || !marked) {
    return listed.length === 0
      ? []
      : [
          `anonymous-finalists-are-the-final-lineup: ${listed.length} listed with the Final not drawn or unmarked`,
        ];
  }
  const same = listed.length === lineup.length && lineup.every((name) => listed.includes(name));
  return same
    ? []
    : [
        `anonymous-finalists-are-the-final-lineup: [${listed.join(', ')}] is not the line-up [${lineup.join(', ')}]`,
      ];
};

const RULES: Rule[] = [
  everyNameIsAUnit,
  oneSeatPerRound,
  absenceAnswersHaveASeat,
  anonymousFinalistsAreTheFinalLineup,
];

/**
 * Throws, naming each rule that broke, when the tournament disagrees with itself. With a `baseline` (the state before a
 * correction) the disagreements it already had are tolerated: the correction must not add one.
 */
export function expectConsistent(state: TournamentState, baseline?: TournamentState): void {
  const known = new Set(baseline ? RULES.flatMap((rule) => rule(baseline)) : []);
  const violations = RULES.flatMap((rule) => rule(state)).filter((violation) => !known.has(violation));
  if (violations.length > 0) {
    const shown = violations.slice(0, 8).join('\n  ');
    const more = violations.length > 8 ? `\n  … and ${violations.length - 8} more` : '';
    throw new Error(`The tournament is not consistent:\n  ${shown}${more}`);
  }
}

/** What one unit has in one round, read by the unit and not by its seat number. */
interface UnitRecord {
  room: number | null;
  bye: boolean;
  scores: Record<string, unknown>;
  absences: Record<string, unknown>;
}

function seatSuffixes(values: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const bySeat = new Map<string, Record<string, unknown>>();
  for (const [key, value] of Object.entries(values)) {
    const match = /^r(\d+)-rm(\d+)-p(\d+)(.*)$/u.exec(key);
    if (!match) continue;
    const seat = `${match[1]}:${match[2]}:${match[3]}`;
    bySeat.set(seat, { ...bySeat.get(seat), [match[4]]: value });
  }
  return bySeat;
}

function recordsOf(state: TournamentState, round: number): Map<string, UnitRecord> {
  const scores = seatSuffixes(state.scores);
  const absences = seatSuffixes(state.absences ?? {});
  const seated = new Map<number, number>();
  const records = new Map<string, UnitRecord>();
  for (const entry of state.assignments[round] ?? []) {
    const bye = (state.byes[round] ?? []).includes(entry.name);
    if (entry.room === null) {
      records.set(entry.name, { room: null, bye, scores: {}, absences: {} });
      continue;
    }
    const position = seated.get(entry.room) ?? 0;
    seated.set(entry.room, position + 1);
    const seat = `${round}:${entry.room}:${position}`;
    records.set(entry.name, {
      room: entry.room,
      bye,
      scores: scores.get(seat) ?? {},
      absences: absences.get(seat) ?? {},
    });
  }
  return records;
}

export interface CorrectionEffect {
  /** The units the correction is about: not compared (a removed unit, a swapped pair). */
  changed?: readonly string[];
  /** Old name to new name, for a rename: the unit is compared under its new name. */
  renamed?: Readonly<Record<string, string>>;
  /** The rounds to compare. By default every round reached: those up to the last round in play. */
  rounds?: readonly number[];
}

/**
 * Every unit the correction is not about keeps, in each round, its room and bye mark, its scores and its absence
 * answers: read by unit, so an answer that slid to the neighbour's seat shows (catches what no rule on one state can).
 */
export function expectOthersUnchanged(
  before: TournamentState,
  after: TournamentState,
  effect: CorrectionEffect = {},
): void {
  const changed = new Set(effect.changed ?? []);
  const renamed = effect.renamed ?? {};
  const reached = Math.max(before.curRound, ...roundsInPlay(before));
  const rounds = effect.rounds ?? Array.from({ length: reached + 1 }, (_, index) => index);
  const problems: Violations = [];
  for (const round of rounds) {
    const was = recordsOf(before, round);
    const now = recordsOf(after, round);
    const nowName = (name: string) => renamed[name] ?? name;
    for (const [unit, record] of was) {
      if (changed.has(unit)) continue;
      const found = now.get(nowName(unit));
      if (JSON.stringify(sorted(found)) !== JSON.stringify(sorted(record))) {
        problems.push(
          `others-unchanged: "${unit}" in round ${round} was ${JSON.stringify(sorted(record))}, now ${JSON.stringify(sorted(found))}`,
        );
      }
    }
    const previously = new Set([...was.keys()].map(nowName));
    for (const unit of now.keys()) {
      if (!previously.has(unit) && !changed.has(unit))
        problems.push(`others-unchanged: "${unit}" appeared in round ${round}`);
    }
  }
  if (problems.length > 0)
    throw new Error(`A correction moved other units:\n  ${problems.slice(0, 8).join('\n  ')}`);
}

/** A record with its keys in a fixed order, for comparing and printing. */
function sorted(record: UnitRecord | undefined): unknown {
  if (!record) return null;
  const ordered = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).sort());
  return { ...record, scores: ordered(record.scores), absences: ordered(record.absences) };
}

/** A correction (a removal, a swap, a rename) left the tournament consistent and every other unit's record as it was. */
export function expectCorrectionClean(
  before: TournamentState,
  after: TournamentState,
  effect: CorrectionEffect = {},
): void {
  expectConsistent(after, before);
  expectOthersUnchanged(before, after, effect);
}

/** The corrections under test, each checked: the tournament stays consistent and no other unit's record moves. */
export const removeChecked: typeof removeRosterUnit = (state, key) => {
  const after = removeRosterUnit(state, key);
  expectCorrectionClean(state, after, { changed: [key] });
  return after;
};

export const swapChecked: typeof swapIndividual = (state, oldName, newName) => {
  const after = swapIndividual(state, oldName, newName);
  expectCorrectionClean(state, after, { changed: [oldName, newName.trim()] });
  return after;
};

export const swapTeamChecked: typeof swapTeam = (state, oldTeamId, replacement) => {
  const after = swapTeam(state, oldTeamId, replacement);
  expectCorrectionClean(state, after, { changed: [oldTeamId, replacement.teamId] });
  return after;
};

export const renameChecked: typeof renameIndividual = (state, oldName, newName) => {
  const after = renameIndividual(state, oldName, newName);
  // A refused rename leaves the state as it was: no unit is under a new name.
  expectCorrectionClean(state, after, { renamed: after === state ? {} : { [oldName]: newName.trim() } });
  return after;
};
