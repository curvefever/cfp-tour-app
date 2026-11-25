import { hasBlockingAbsenceQuestions, PENDING_ABSENCES_MESSAGE } from './absences';
import { withFinalistAliasesForLineup } from './anonymous-finalists';
import {
  hasPendingColumnTies,
  isStandingsCutoffRound,
  refreshRoundStandings,
  roomBasedComputeAdvancement,
} from './advancement';
import { advanceFromStandings, advanceWaterfallBracket } from './waterfall-advance';
import { advanceKingsValley, fitKingsValleyTail } from './kings-valley-advance';
import { advanceDoubleElimination } from './double-elimination-advance';
import { nextPowerOf2AndRounds } from './double-elimination';
import { lateJoinersOf } from './late-joiners';
import { likelyAbsentees } from './likely-absentees';
import { seedFromGroupStageRound } from './pooling';
import { discardDrawsAfter, drawnAheadStatus } from './redraw';
import { swissPair } from './swiss-pairing';
import {
  avoidSameGroupInFirstBracketRound,
  pairsAbsenteesInRound,
  recordRoomHistory,
  selectPoolingBye,
  sequentialSeed,
  seedFromPoolingExit,
  tieredSeed,
  type SeedCandidate,
} from './seeding';
import type { RoomSize, RoundAssignment, TournamentRound, TournamentState } from './types';
import { generatedConfig } from './generated-config';
import { currentColumn, nextColumnStart, usesDependencyPlay } from './round-columns';
import {
  cloneForTransition,
  fitNextRound,
  fitWaterfallRoundAt,
  MISSING_ROOM_SIZE_MESSAGE,
  PENDING_TIES_MESSAGE,
  reserveWindowAtCurrentRound,
  type RoundAdvanceResult,
} from './round-advance-tools';
import { advanceDependencyPlay, withPressesResumed } from './waterfall-steps';

/**
 * Next Round. `advanceTournamentRound` is the entry point; `advanceRound` makes the checks every format shares and
 * hands the press to its format (`double-elimination-advance.ts`, `kings-valley-advance.ts`,
 * `waterfall-advance.ts`, `waterfall-steps.ts` for dependency play). The ordinary round, of no format of its own,
 * is advanced here.
 */

function uniqueKeepingLast(candidates: SeedCandidate[]): SeedCandidate[] {
  const seen = new Set<string>();
  const output: SeedCandidate[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    output.unshift(candidate);
  }
  return output;
}

/**
 * A no-elimination pooling round advances everyone, but only the units seated in its rooms (and byes)
 * reach `advancing`. A unit added to the roster while the round was in play was never seated, so it is
 * drawn in with the others here.
 */
function withLateJoiners(advancing: SeedCandidate[], joiners: string[]): SeedCandidate[] {
  const present = new Set(advancing.map((entry) => entry.name));
  const absent = joiners.filter((name) => !present.has(name));
  return [...advancing, ...absent.map((name) => ({ name, isLucky: false }))];
}

/** Candidates for a bye: never a late joiner in their first round (a bye earns points), unless nobody else is left. */
function byeCandidates(advancing: SeedCandidate[], joiners: ReadonlySet<string>): SeedCandidate[] {
  const regular = advancing.filter((entry) => !joiners.has(entry.name));
  return regular.length ? regular : advancing;
}

/**
 * The bye of a head-to-head pooling round (a qualification table, the warm-ups) when the likely absentees pair
 * together (`pairsAbsenteesInRound`) and an odd number of them is left: the lowest ranked takes it, worth no points
 * while it is likely absent (`absentBye`). Undefined otherwise: the bye is picked as usual.
 */
function absenteeBye(
  state: TournamentState,
  round: TournamentRound,
  roundIndex: number,
  advancing: SeedCandidate[],
  idealRoomSize: number,
): SeedCandidate | undefined {
  if (idealRoomSize !== 2 || !pairsAbsenteesInRound(state, round, roundIndex)) return undefined;
  const likely = likelyAbsentees(state, roundIndex);
  const absentees = advancing.filter((entry) => likely.has(entry.name));
  return absentees.length % 2 === 1 ? absentees[absentees.length - 1] : undefined;
}

function malformedOrdinaryFinalMessage(actual: number): string {
  return `Can't advance to the Final — an odd number of teams (${actual}) would be heading into it, which can't form a clean head-to-head match. This usually means a team was removed mid-tournament; check Manage Teams before advancing.`;
}

type Advancement = ReturnType<typeof roomBasedComputeAdvancement>;

interface UnitsGoingOn {
  /** The working copy the rest of the advance writes to. */
  state: TournamentState;
  result: Advancement;
  /** In seeding order, each unit once: the byes of the round played first, late joiners last. */
  advancing: SeedCandidate[];
}

/** The units of the round played that go on, on a copy of `base` with the standings the cut was read from. */
function whoGoesOn(base: TournamentState, roundIndex: number, round: TournamentRound): UnitsGoingOn {
  const state = cloneForTransition(base);
  const result = roomBasedComputeAdvancement(state, roundIndex);
  if (result.qualTable) state.qualTable = result.qualTable;
  if (result.groupStandings) state.groupStandings = result.groupStandings;

  let advancing: SeedCandidate[] = result.advancing.map((entry) => ({
    ...entry,
  }));
  // At a standings cut-off the cumulative standings decide who advances, and a
  // bye unit is already ranked in them: prepending it would let it qualify
  // whatever its standing.
  if (state.byes[roundIndex]?.length && !isStandingsCutoffRound(state, roundIndex)) {
    advancing = [
      ...state.byes[roundIndex].map((name) => ({
        name,
        isLucky: false,
      })),
      ...advancing,
    ];
  }
  if (round.isNoElim && !round.isGroupStage && !isStandingsCutoffRound(state, roundIndex)) {
    advancing = withLateJoiners(advancing, lateJoinersOf(state, roundIndex));
  }
  advancing = uniqueKeepingLast(advancing);
  return { state, result, advancing };
}

/** The end of an ordinary advance, the next round seated: its lucky losers, its line-up and `curRound` on it. */
function finishOrdinaryRound(
  state: TournamentState,
  roundIndex: number,
  result: Advancement,
  seeded: RoundAssignment[],
): RoundAdvanceResult {
  // Set after the next round is seated, whatever its kind, the first Kings Valley one included -- its own
  // fitKingsValleyTail can rebuild state.luckyLosers wholesale when it
  // re-fits the tail, which would otherwise clobber an earlier write here.
  if (result.luckyNames !== null) {
    state.luckyLosers[roundIndex + 1] = result.luckyNames;
  }
  state.curRound += 1;
  state.assignments[state.curRound] = seeded;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

/** What seating the next round of an ordinary advance works with. */
interface NextSeating {
  /** The state the press was given, which some refusals hand back. */
  input: TournamentState;
  /** The working copy, which the other refusals hand back. */
  state: TournamentState;
  roundIndex: number;
  /** The round played. */
  round: TournamentRound;
  nextRound: TournamentRound;
  /** Who goes on (`whoGoesOn`). */
  advancing: SeedCandidate[];
  groupExit: Advancement['groupExit'];
}

type Refusal = Extract<RoundAdvanceResult, { status: 'blocked' }>;

/** The next round's line-up, or why it can't be seated. */
type Seating = { ok: true; seeded: RoundAssignment[] } | { ok: false; refusal: Refusal };

/** Who is left to seat and who sits the next round out with a bye, or why a bye can't be given. */
type ByeChoice =
  | { ok: true; advancing: SeedCandidate[]; newByes: SeedCandidate[]; absentByeNames: ReadonlySet<string> }
  | { ok: false; refusal: Refusal };

function seatFixedDraw({ state, roundIndex }: NextSeating, fixedDraw: RoundAssignment[]): Seating {
  // The whole schedule for this round was already decided at generation
  // time (fixed-draws.ts) -- roomHistory/poolingByeCounts for it were
  // already folded in there too (see generation.ts), so no
  // recordRoomHistory call here, unlike a round drawn from who goes on
  // (`seatAndAppendByes`).
  const seeded = fixedDraw.map((entry) => ({ ...entry }));
  state.byes[roundIndex + 1] = seeded.filter((entry) => entry.room === null).map((entry) => entry.name);
  return { ok: true, seeded };
}

function seatGroupRound({ state, roundIndex, nextRound }: NextSeating): Seating {
  const seeded = seedFromGroupStageRound(nextRound);
  state.byes[roundIndex + 1] = [...(nextRound.groupByes ?? [])];
  return { ok: true, seeded };
}

function seatSwissRound({ state, roundIndex, nextRound, advancing }: NextSeating): Seating {
  const config = generatedConfig(state);
  if (!config) {
    return {
      ok: false,
      refusal: {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      },
    };
  }
  const { roomSize } = config;
  const paired = swissPair({
    activeNames: advancing.map((entry) => entry.name),
    throughRoundIndex: roundIndex,
    roomSize,
    state,
    likelyAbsent: pairsAbsenteesInRound(state, nextRound, roundIndex + 1)
      ? likelyAbsentees(state, roundIndex + 1)
      : undefined,
  });
  const seeded = paired.seeded;
  state.poolingByeCounts = paired.poolingByeCounts;
  state.byes[roundIndex + 1] = paired.byeName ? [paired.byeName] : [];
  return { ok: true, seeded };
}

function seatFirstKingsValleyRound(seating: NextSeating): Seating {
  const { input, state, roundIndex, round, advancing, groupExit } = seating;
  // Kings Valley's room sizes are fixed at generation time (distributeRooms()
  // over the shrinking survivor count, no byes), so the units are seated into
  // them exactly with sequentialSeed, as advanceKingsValley does for every
  // later hop; this is the hop into the first Kings Valley round. A removal
  // during pooling (or a reserve added while this round's window is open) can
  // leave a survivor count that differs from the plan, and mutations.ts's
  // rebuildFutureRounds re-plans with state.cfg.qualAdv, not the real number
  // reaching the cutoff. So fitKingsValleyTail re-plans the whole ladder
  // (Final included) to the real count first.
  // The reshape at a roster change (rebuildFutureRounds) is a preview, so the Bracket shows the room sizes ahead:
  // it may fail or be skipped, and a removal is never blocked by it. Next Round fits each round to the units that
  // really arrive, and that is the rule.
  const fitFailure = fitKingsValleyTail(state, roundIndex + 1, advancing.length);
  if (fitFailure) return { ok: false, refusal: { status: 'blocked', ...fitFailure, state: input } };
  const fittedNextRound = state.rounds[roundIndex + 1];
  let seeded = sequentialSeed(
    advancing.map((entry) => entry.name),
    fittedNextRound.rooms,
  );
  if (round.isGroupStage) {
    seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups, groupExit);
  }
  return { ok: true, seeded };
}

/**
 * The byes the next round gives, taken out of who is left to seat. A bye of a no-elimination round is counted
 * on the working copy.
 */
function chooseByes(seating: NextSeating, roomSize: RoomSize): ByeChoice {
  const { state, roundIndex, nextRound } = seating;
  let { advancing } = seating;
  const newByes: SeedCandidate[] = [];
  const absentByeNames = new Set<string>();
  const joiners = new Set(lateJoinersOf(state, roundIndex));
  if (state.gamemodeConfig.oddCountStrategy === 'bye' && !nextRound.isWaterfall) {
    let needed = 0;
    if (nextRound.bracketPhaseFirstRound) {
      needed = nextPowerOf2AndRounds(advancing.length).bracketSize - advancing.length;
    } else if (advancing.length % roomSize.ideal !== 0) {
      needed = 1;
    }
    if (needed > 0) {
      if (nextRound.isFinal) {
        return {
          ok: false,
          refusal: {
            status: 'blocked',
            reason: 'malformed-final',
            message: malformedOrdinaryFinalMessage(advancing.length),
            state,
          },
        };
      }
      if (nextRound.isNoElim && needed === 1) {
        const absentBye = absenteeBye(state, nextRound, roundIndex + 1, advancing, roomSize.ideal);
        const chosen =
          absentBye ?? selectPoolingBye(byeCandidates(advancing, joiners), state.poolingByeCounts);
        if (absentBye) absentByeNames.add(absentBye.name);
        if (chosen) {
          newByes.push(chosen);
          advancing = advancing.filter((entry) => entry !== chosen);
          state.poolingByeCounts[chosen.name] = (state.poolingByeCounts[chosen.name] ?? 0) + 1;
        }
      } else {
        const taken = byeCandidates(advancing, joiners).slice(0, needed);
        newByes.push(...taken);
        advancing = advancing.filter((entry) => !taken.includes(entry));
      }
    }
  }
  return { ok: true, advancing, newByes, absentByeNames };
}

/** Fits the next round to who is left to seat, draws it, and adds the units with a bye to its line-up. */
function seatAndAppendByes(
  { input, state, roundIndex, round, nextRound, groupExit }: NextSeating,
  { advancing, newByes, absentByeNames }: Extract<ByeChoice, { ok: true }>,
): Seating {
  // A hand-authored waterfall graph keeps its room count and routes: fewer arrivals than it
  // declares are drawn short (fitWaterfallRoundAt, not distributeRooms), more block.
  const fitFailure = nextRound.isWaterfall
    ? fitWaterfallRoundAt(state, roundIndex + 1, advancing.length)
    : fitNextRound(state, roundIndex + 1, advancing.length, newByes.length);
  if (fitFailure) return { ok: false, refusal: { status: 'blocked', ...fitFailure, state: input } };
  const seedOptions = { state, roundIndex, advancing, seedingOverride: round.seedingOverride };
  const seeded = isStandingsCutoffRound(state, roundIndex)
    ? seedFromPoolingExit({ ...seedOptions, groupExit })
    : tieredSeed(seedOptions).seeded;
  state.roomHistory = recordRoomHistory(state.roomHistory, seeded, roundIndex + 1);
  if (newByes.length) {
    state.byes[roundIndex + 1] = newByes.map((entry) => entry.name);
    seeded.push(
      ...newByes.map((entry) => ({
        name: entry.name,
        room: null,
        isLucky: false,
        ...(absentByeNames.has(entry.name) ? { absentBye: true as const } : {}),
      })),
    );
  }
  return { ok: true, seeded };
}

/** A round of no special kind: its byes are chosen, then it is fitted to who is left and drawn. */
function seatSeededRound(seating: NextSeating): Seating {
  const { state } = seating;
  const config = generatedConfig(state);
  if (!config) {
    return {
      ok: false,
      refusal: {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      },
    };
  }
  const { roomSize } = config;
  const byes = chooseByes(seating, roomSize);
  if (!byes.ok) return byes;
  return seatAndAppendByes(seating, byes);
}

/** Seats the next round the way its kind asks for. */
function seatNextRound(seating: NextSeating): Seating {
  const { nextRound } = seating;
  if (nextRound.fixedRoomAssignments) return seatFixedDraw(seating, nextRound.fixedRoomAssignments);
  if (nextRound.isGroupStage) return seatGroupRound(seating);
  if (nextRound.isSwiss) return seatSwissRound(seating);
  if (nextRound.isKingsValley) return seatFirstKingsValleyRound(seating);
  return seatSeededRound(seating);
}

/**
 * Next Round of a round of no format of its own. `base` is the state to advance (the standings refreshed, a stale
 * draw ahead thrown away) and is what gets copied; `input` is the state the press was given. A refusal hands back
 * the working copy or `input`, depending on where it happens.
 */
function advanceOrdinaryRound(
  input: TournamentState,
  base: TournamentState,
  roundIndex: number,
  round: TournamentRound,
  nextRound: TournamentRound,
): RoundAdvanceResult {
  const { state, result, advancing } = whoGoesOn(base, roundIndex, round);
  const { groupExit } = result;
  const seating = seatNextRound({ input, state, roundIndex, round, nextRound, advancing, groupExit });
  if (!seating.ok) return seating.refusal;
  return finishOrdinaryRound(state, roundIndex, result, seating.seeded);
}

/**
 * Advances the tournament to its next round: the result carries the new state,
 * or why nothing happened. UI effects (alert, render, persistence and sync)
 * belong to the caller.
 */
export function advanceTournamentRound(input: TournamentState): RoundAdvanceResult {
  const result = advanceRound(input);
  return result.status === 'advanced'
    ? { ...result, state: withFinalistAliasesForLineup(result.state) }
    : result;
}

function advanceRound(input: TournamentState): RoundAdvanceResult {
  if (usesDependencyPlay(input)) return advanceDependencyPlay(input);
  const roundIndex = input.curRound;
  const round = input.rounds[roundIndex];
  const nextRound = input.rounds[nextColumnStart(input)];
  if (!round || !nextRound) {
    return { status: 'noop', reason: 'last-round', state: input };
  }

  const column = currentColumn(input);
  let prepared = input;
  for (let index = column.start; index <= column.end; index += 1) {
    prepared = refreshRoundStandings(prepared, index);
  }
  if (hasPendingColumnTies(prepared)) {
    return {
      status: 'blocked',
      reason: 'pending-ties',
      message: PENDING_TIES_MESSAGE,
      state: prepared,
    };
  }
  if (hasBlockingAbsenceQuestions(prepared)) {
    return {
      status: 'blocked',
      reason: 'pending-absences',
      message: PENDING_ABSENCES_MESSAGE,
      state: prepared,
    };
  }
  const drawnAhead = drawnAheadStatus(prepared, roundIndex);
  if (drawnAhead === 'locked') {
    const state = withPressesResumed({ ...prepared, curRound: nextColumnStart(prepared) });
    return { status: 'advanced', state: { ...state, reserveOpen: reserveWindowAtCurrentRound(state) } };
  }
  const base = drawnAhead === 'redraw' ? discardDrawsAfter(prepared, roundIndex) : prepared;
  if (round.bracket) {
    return advanceDoubleElimination(base, roundIndex, round);
  }
  if (round.isKingsValley) {
    return advanceKingsValley(base, roundIndex);
  }
  if (round.isWaterfall) {
    return advanceWaterfallBracket(base);
  }
  if (round.standingsRoutes) {
    return advanceFromStandings(base, roundIndex, round);
  }

  return advanceOrdinaryRound(input, base, roundIndex, round, nextRound);
}
