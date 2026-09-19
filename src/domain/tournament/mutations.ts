import {
  computeGroupStandings,
  computeQualificationStandings,
  invalidateStaleTieResolutions,
} from './advancement';
import { isPlainFinalFullyScored, progressGrandFinalRace } from './finals';
import { getGameFormat } from './formats';
import { validateRoomCap } from './room-distribution';
import { isDisplayNameTaken, rosterKeys, unitDisplay } from './roster';
import { buildTournamentProgression, type TournamentProgressionInput } from './schedule-generation';
import { getFinalUnitScore, getUnitScore, scoreKeysForPosition, tieResolutionList } from './scoring';
import type {
  AnonymousFinalist,
  MaterializedGamemodeConfig,
  TournamentRoster,
  TournamentRound,
  TournamentState,
  TournamentTeam,
  WithdrawnUnit,
} from './types';

const MAX_ANONYMOUS_FINALISTS = 10;

function dirty(state: TournamentState): TournamentState {
  return { ...state, needsSave: true };
}

// Scores must be non-negative integers. Rejects (rather than truncates)
// decimals so "5.7" doesn't silently become "5", and rejects negatives --
// 0 is a real, complete score. Number(), not parseInt, so a fractional
// part is actually detected instead of silently dropped by truncation.
function isValidNonNegativeInteger(value: string): boolean {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0;
}

export function setRoundScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
  roundIndex: number,
  room: number,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : null;
  let next = {
    ...state,
    scores: { ...state.scores, [key]: parsed },
  };
  next = invalidateStaleTieResolutions(next, roundIndex, room);
  const round = next.rounds[next.curRound];
  if (round && (round.isQual || round.isSwiss)) {
    next = { ...next, qualTable: computeQualificationStandings(next) };
  }
  if (round?.isGroupStage) {
    next = { ...next, groupStandings: computeGroupStandings(next) };
  }
  return dirty(next);
}

export function setFinalScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : '';
  const updated = dirty({
    ...state,
    finalScores: { ...state.finalScores, [key]: parsed },
  });
  return progressGrandFinalRace(updated).state;
}

// Anonymous Finals matches (v1, individual formats only -- a team-format
// alias would need its own fabricated TournamentTeam/member list, since
// getFinalUnitScore's team branch reads real roster data via buildTeamMap()
// that an alias never has; out of scope, guarded below rather than half-built).

function findFinalRoundIndex(state: TournamentState): number {
  return state.rounds.findIndex((round) => round.isFinal);
}

export function flagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  if (getGameFormat(state.gameFormat)?.teamSize) return state;
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  // Grand-final race progression (progressGrandFinalRace) decides whether to
  // open the next game by reading the two real finalists' own keys directly
  // -- an anonymous game's score living under its alias instead would stall
  // the race forever. Out of scope for v1, not a half-built workaround.
  if (!round || round.bracket === 'grand-final') return state;
  const numGames = round.numGames ?? 0;
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > numGames) return state;
  if (round.anonymousGames?.includes(gameNumber)) return state;
  const assignments = state.assignments[roundIndex] ?? [];
  const alreadyScored = assignments.some(
    (assignment) => getFinalUnitScore(state, assignment.name, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;

  let anonymousFinalists = state.anonymousFinalists;
  if (anonymousFinalists.length === 0) {
    if (assignments.length === 0 || assignments.length > MAX_ANONYMOUS_FINALISTS) return state;
    anonymousFinalists = assignments.map((assignment, index): AnonymousFinalist => ({
      alias: `Finalist-${index + 1}`,
      realKey: assignment.name,
      connected: false,
    }));
  }

  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: [...(entry.anonymousGames ?? []), gameNumber] }
      : entry,
  );
  return dirty({ ...state, rounds, anonymousFinalists });
}

export function unflagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round?.anonymousGames?.includes(gameNumber)) return state;
  const alreadyScored = state.anonymousFinalists.some(
    (finalist) => getFinalUnitScore(state, finalist.alias, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;
  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: (entry.anonymousGames ?? []).filter((game) => game !== gameNumber) }
      : entry,
  );
  return dirty({ ...state, rounds });
}

export function connectAnonymousFinalist(state: TournamentState, alias: string): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round || !isPlainFinalFullyScored(state, roundIndex, round)) return state;
  const finalist = state.anonymousFinalists.find((entry) => entry.alias === alias);
  if (!finalist || finalist.connected) return state;
  const anonymousGames = round.anonymousGames ?? [];
  const finalScores = { ...state.finalScores };
  for (const gameNumber of anonymousGames) {
    const anonKey = `game${gameNumber}-${alias}`;
    const realKey = `game${gameNumber}-${finalist.realKey}`;
    if (finalScores[realKey] == null || finalScores[realKey] === '') {
      finalScores[realKey] = finalScores[anonKey] ?? null;
    }
  }
  const anonymousFinalists = state.anonymousFinalists.map((entry) =>
    entry.alias === alias ? { ...entry, connected: true } : entry,
  );
  return dirty({ ...state, finalScores, anonymousFinalists });
}

export function resolveTournamentTie(state: TournamentState, key: string, name: string): TournamentState {
  const list = [...tieResolutionList(state, key)];
  if (!list.includes(name)) list.push(name);
  return dirty({
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: list },
  });
}

export function renameIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return state;
  const players = state.players as string[];
  const reserves = state.reserves as string[];
  if (players.includes(trimmed) || reserves.includes(trimmed)) return state;
  const rename = (name: string) => (name === oldName ? trimmed : name);
  const finalScores: TournamentState['finalScores'] = {};
  for (const [key, score] of Object.entries(state.finalScores)) {
    const match = key.match(/^(game\d+)-(.*)$/u);
    finalScores[match?.[2] === oldName ? `${match[1]}-${trimmed}` : key] = score;
  }
  return dirty({
    ...state,
    players: players.map(rename),
    reserves: reserves.map(rename),
    assignments: state.assignments.map((round) =>
      round.map((entry) => ({ ...entry, name: rename(entry.name) })),
    ),
    qualTable: state.qualTable.map((entry) => ({ ...entry, name: rename(entry.name) })),
    luckyLosers: state.luckyLosers.map((round) => round.map(rename)),
    tieResolutions: Object.fromEntries(
      Object.entries(state.tieResolutions).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(rename) : rename(value),
      ]),
    ),
    finalScores,
  });
}

function rebuildFutureRounds(state: TournamentState): TournamentState | null {
  const round = state.rounds[state.curRound];
  if (!round?.isNoElim || state.cfg.poolingPhase === 'group-stage') return state;
  const format = getGameFormat(state.gameFormat);
  if (!format) return null;
  const config = state.gamemodeConfig as MaterializedGamemodeConfig;
  if (!config.roomSize || !config.bracketPhase) return null;
  const progression = buildTournamentProgression({
    bracketPhase: config.bracketPhase,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    config: {
      n: rosterKeys(state.players).length,
      qualAdv: state.cfg.qualAdv ?? rosterKeys(state.players).length,
      groupSize: state.cfg.groupSize ?? 4,
      roundRobinMode: state.cfg.roundRobinMode ?? 'single',
      qualifiersPerGroup: state.cfg.qualifiersPerGroup ?? 2,
    },
    format: config,
    roster: rosterKeys(state.players),
  } as TournamentProgressionInput);
  const rounds = [
    ...state.rounds.slice(0, state.curRound + 1),
    ...progression.rounds.slice(state.curRound + 1),
  ];
  if (validateRoomCap(rounds, format)) return null;
  const emptyTail = Array.from(
    { length: Math.max(0, rounds.length - state.curRound - 1) },
    () => [] as string[],
  );
  return {
    ...state,
    rounds,
    assignments: state.assignments.slice(0, state.curRound + 1),
    byes: [...state.byes.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
    luckyLosers: [...state.luckyLosers.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
  };
}

export type ReserveAddResult =
  | { status: 'added'; state: TournamentState }
  | {
      status: 'blocked';
      reason:
        | 'closed'
        | 'group-stage'
        | 'qualification-in-progress'
        | 'strict-room'
        | 'room-cap'
        | 'duplicate-name';
    }
  | { status: 'confirm-over-cap'; room: number; count: number };

export function addReserveUnit(
  state: TournamentState,
  key: string,
  options: { allowOverCap?: boolean } = {},
): ReserveAddResult {
  if (!state.reserveOpen) return { status: 'blocked', reason: 'closed' };
  if (state.cfg.poolingPhase === 'group-stage') {
    return { status: 'blocked', reason: 'group-stage' };
  }
  // A reserve joining a qualification-table/Swiss standings phase must still
  // get to play at least two of the remaining rounds themselves -- otherwise
  // a single lucky round could win a real qualifying spot outright, with no
  // volume discount once Fair Points is averaged rather than summed.
  const completedQualRounds = state.rounds
    .slice(0, state.curRound)
    .filter((round) => round.isQual || round.isSwiss).length;
  if (completedQualRounds > 1) {
    return { status: 'blocked', reason: 'qualification-in-progress' };
  }
  const format = getGameFormat(state.gameFormat);
  const roomSize = state.gamemodeConfig.roomSize;
  const round = state.rounds[state.curRound];
  if (!format || !roomSize || !round) return { status: 'blocked', reason: 'room-cap' };
  const assignments = state.assignments[state.curRound] ?? [];
  let room = 1;
  let count = assignments.filter((entry) => entry.room === room).length;
  for (let candidate = 2; candidate <= round.rooms.length; candidate += 1) {
    const candidateCount = assignments.filter((entry) => entry.room === candidate).length;
    if (candidateCount < count) {
      room = candidate;
      count = candidateCount;
    }
  }
  if (count >= roomSize.max && state.gamemodeConfig.oddCountStrategy === 'none') {
    return { status: 'blocked', reason: 'strict-room' };
  }
  if (count >= roomSize.max && !options.allowOverCap) {
    return { status: 'confirm-over-cap', room, count };
  }
  const team = format.teamSize
    ? (state.reserves as TournamentTeam[]).find((entry) => entry.teamId === key)
    : undefined;
  if (format.teamSize && !team) return { status: 'blocked', reason: 'room-cap' };
  const nextAssignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  nextAssignments[state.curRound] = [
    ...(nextAssignments[state.curRound] ?? []),
    { name: key, room, isLucky: false },
  ];
  let next: TournamentState = {
    ...state,
    assignments: nextAssignments,
    players: format.teamSize
      ? ([...(state.players as TournamentTeam[]), team as TournamentTeam] as TournamentRoster)
      : ([...(state.players as string[]), key] as TournamentRoster),
    reserves: format.teamSize
      ? (state.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (state.reserves as string[]).filter((entry) => entry !== key),
  };
  const rebuilt = rebuildFutureRounds(next);
  if (!rebuilt) return { status: 'blocked', reason: 'room-cap' };
  next = dirty(rebuilt);
  return { status: 'added', state: next };
}

export function addWalkUpIndividual(
  state: TournamentState,
  name: string,
  options: { allowOverCap?: boolean } = {},
): ReserveAddResult {
  const trimmed = name.trim();
  if (!trimmed || getGameFormat(state.gameFormat)?.teamSize) {
    return { status: 'blocked', reason: 'room-cap' };
  }
  if ((state.players as string[]).includes(trimmed) || (state.reserves as string[]).includes(trimmed)) {
    return { status: 'blocked', reason: 'duplicate-name' };
  }
  return addReserveUnit({ ...state, reserves: [...(state.reserves as string[]), trimmed] }, trimmed, options);
}

export function removeReserveUnit(state: TournamentState, key: string): TournamentState {
  const format = getGameFormat(state.gameFormat);
  return dirty({
    ...state,
    reserves: format?.teamSize
      ? (state.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (state.reserves as string[]).filter((entry) => entry !== key),
  });
}

function removeUnitFromCurrentRoom(state: TournamentState, key: string, teamSize: number): TournamentState {
  const roundIndex = state.curRound;
  const assignments = state.assignments[roundIndex] ?? [];
  const found = assignments.find((entry) => entry.name === key);
  if (!found || found.room === null) {
    return {
      ...state,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    };
  }
  const room = found.room;
  const roomUnits = assignments.filter((entry) => entry.room === room);
  const position = roomUnits.findIndex((entry) => entry.name === key);
  const scores = { ...state.scores };
  const round = state.rounds[roundIndex];
  const keysAtPosition = (positionIndex: number) =>
    scoreKeysForPosition({
      roundIndex,
      room,
      position: positionIndex,
      numGames: Math.max(round.numGames ?? 1, 1),
      teamSize: teamSize || undefined,
    });

  for (let index = position + 1; index < roomUnits.length; index += 1) {
    const from = keysAtPosition(index);
    const to = keysAtPosition(index - 1);
    from.forEach((fromKey, offset) => {
      const toKey = to[offset];
      if (scores[fromKey] !== undefined) scores[toKey] = scores[fromKey];
      else delete scores[toKey];
    });
  }
  for (const scoreKey of keysAtPosition(roomUnits.length - 1)) delete scores[scoreKey];
  return invalidateStaleTieResolutions(
    {
      ...state,
      scores,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    },
    roundIndex,
    room,
  );
}

/** The other name in a group-stage pair, given one of its two members. */
function otherMember(pair: [string, string], key: string): string {
  return pair[0] === key ? pair[1] : pair[0];
}

/**
 * Patches every not-yet-reached group-stage round (index > state.curRound)
 * so a roster change already applied to state.groups doesn't leave a ghost
 * name baked into that round's matches/groupByes -- removeRosterUnit's
 * strip() and swapIndividual/swapTeam's groups remap only ever touch
 * state.groups, never the future TournamentRound objects that were built
 * from group membership once, upfront, at generation time.
 *
 * newKey === null means "removed": oldKey's future match becomes a bye for
 * its surviving opponent -- the same fallback buildRoundRobinRounds already
 * uses when a group's own round-robin schedule runs out early. If oldKey was
 * already scheduled as a bye that round, it's simply dropped. Either way,
 * rooms/byeCount/players are recomputed, and a dropped match's roomGroups
 * entry (same index) is filtered in lockstep so room numbers -- derived
 * fresh from array position by seedFromGroupStageRound/BracketView -- keep
 * lining up with the right group label after the shift.
 *
 * newKey is a string for "swapped": oldKey is relabeled to newKey wherever
 * it appears. Group size is unchanged by a swap, so rooms/byeCount/players/
 * roomGroups are left untouched.
 *
 * A no-op outside group-stage pooling.
 */
function patchFutureGroupStageRounds(
  state: TournamentState,
  oldKey: string,
  newKey: string | null,
): TournamentRound[] {
  if (state.cfg.poolingPhase !== 'group-stage') return state.rounds;

  return state.rounds.map((round, index) => {
    if (index <= state.curRound || !round.isGroupStage) return round;
    const matches = round.matches ?? [];
    const groupByes = round.groupByes ?? [];

    if (newKey !== null) {
      const relabel = (name: string) => (name === oldKey ? newKey : name);
      const touchesOldKey =
        matches.some((match) => match.pair.includes(oldKey)) || groupByes.includes(oldKey);
      if (!touchesOldKey) return round;
      return {
        ...round,
        matches: matches.map((match) => ({ ...match, pair: match.pair.map(relabel) as [string, string] })),
        groupByes: groupByes.map(relabel),
      };
    }

    if (groupByes.includes(oldKey)) {
      const nextGroupByes = groupByes.filter((name) => name !== oldKey);
      return {
        ...round,
        groupByes: nextGroupByes,
        byeCount: nextGroupByes.length,
        players: round.players - 1,
      };
    }

    const matchIndex = matches.findIndex((match) => match.pair.includes(oldKey));
    if (matchIndex < 0) return round;
    const survivor = otherMember(matches[matchIndex].pair, oldKey);
    const nextMatches = matches.filter((_, position) => position !== matchIndex);
    const nextRoomGroups = round.roomGroups?.filter((_, position) => position !== matchIndex);
    const nextGroupByes = [...groupByes, survivor];
    return {
      ...round,
      matches: nextMatches,
      roomGroups: nextRoomGroups,
      groupByes: nextGroupByes,
      rooms: nextMatches.map(() => 2),
      byeCount: nextGroupByes.length,
      players: round.players - 1,
    };
  });
}

export function removeRosterUnit(state: TournamentState, key: string): TournamentState {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize ?? 0;
  let next = removeUnitFromCurrentRoom(recordWithdrawal(state, key, 'removed'), key, teamSize);
  const strip = (values: string[]) => values.filter((name) => name !== key);
  const tieResolutions = Object.fromEntries(
    Object.entries(next.tieResolutions).map(([tieKey, value]) => {
      const filtered = tieResolutionList(next, tieKey).filter((name) => name !== key);
      return [tieKey, Array.isArray(value) ? filtered : (filtered[0] ?? '')];
    }),
  );
  next = {
    ...next,
    players: teamSize
      ? (next.players as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (next.players as string[]).filter((entry) => entry !== key),
    reserves: teamSize
      ? (next.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (next.reserves as string[]).filter((entry) => entry !== key),
    qualTable: next.qualTable.filter((entry) => entry.name !== key),
    luckyLosers: next.luckyLosers.map(strip),
    byes: next.byes.map(strip),
    groups: next.groups.map((group) => ({ ...group, members: strip(group.members) })),
    tieResolutions,
    rounds: patchFutureGroupStageRounds(next, key, null),
  };
  return dirty(next);
}

/**
 * True if `key` was ever assigned to a real room (not a bye) or a Final slot
 * with at least one non-null score recorded. Final-round assignment entries
 * always carry room: null (scores live in state.finalScores, read via
 * getFinalUnitScore) -- a unit removed right after competing in the Final
 * must still count as having played, so that path is handled separately from
 * the room-based getUnitScore check every other round uses.
 */
function hasPlayedAnyMatch(state: TournamentState, key: string): boolean {
  return state.assignments.some((roundAssignments, roundIndex) => {
    const found = roundAssignments.find((entry) => entry.name === key);
    if (!found) return false;
    const round = state.rounds[roundIndex];
    if (round?.isFinal) {
      const games = round.numGames ?? 1;
      return Array.from({ length: games }, (_, i) => i + 1).some(
        (game) => getFinalUnitScore(state, key, game, null) !== null,
      );
    }
    if (found.room === null) return false;
    const roomAssignments = roundAssignments.filter((entry) => entry.room === found.room);
    const position = roomAssignments.findIndex((entry) => entry.name === key);
    return getUnitScore(state, roundIndex, found.room, position, null) !== null;
  });
}

/**
 * Records `key`'s outgoing display info before it's stripped from
 * state.players -- must be called with the pre-removal `state`, since
 * unitDisplay()/hasPlayedAnyMatch() both depend on state.players/reserves/
 * assignments still containing `key`. A team's display name doesn't survive
 * being removed from the roster (the live TournamentTeam object is gone),
 * so this snapshot is the only place that information can still be captured.
 */
function recordWithdrawal(
  state: TournamentState,
  key: string,
  reason: WithdrawnUnit['reason'],
): TournamentState {
  const info = unitDisplay(state, key);
  const entry: WithdrawnUnit = {
    name: key,
    label: info.label,
    members: info.members,
    playedAnyMatch: hasPlayedAnyMatch(state, key),
    reason,
  };
  return { ...state, withdrawnUnits: [...state.withdrawnUnits, entry] };
}

function replaceAssignedUnit(
  state: TournamentState,
  oldKey: string,
  newKey: string,
  teamSize?: number,
): TournamentState | null {
  const assignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  const current = assignments[state.curRound] ?? [];
  const assignmentIndex = current.findIndex((entry) => entry.name === oldKey);
  if (assignmentIndex < 0) return null;

  const room = current[assignmentIndex].room;
  const position = current.filter((entry) => entry.room === room).findIndex((entry) => entry.name === oldKey);
  current[assignmentIndex].name = newKey;

  const scores = { ...state.scores };
  if (room !== null) {
    for (const key of scoreKeysForPosition({
      roundIndex: state.curRound,
      room,
      position,
      numGames: Math.max(state.rounds[state.curRound].numGames ?? 1, 1),
      teamSize,
    }))
      delete scores[key];
  }

  const poolingByeCounts = { ...state.poolingByeCounts };
  if (poolingByeCounts[oldKey] !== undefined) {
    poolingByeCounts[newKey] = poolingByeCounts[oldKey];
    delete poolingByeCounts[oldKey];
  }

  let next: TournamentState = {
    ...state,
    scores,
    assignments,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    byes: state.byes.map((values, index) =>
      index === state.curRound ? values.map((name) => (name === oldKey ? newKey : name)) : values,
    ),
    poolingByeCounts,
  };
  if (room !== null) next = invalidateStaleTieResolutions(next, state.curRound, room);
  return next;
}

export function swapIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const trimmed = newName.trim();
  const players = state.players as string[];
  if (!trimmed || players.includes(trimmed)) return state;

  const replaced = replaceAssignedUnit(state, oldName, trimmed);
  if (!replaced) return state;
  const withdrawn = recordWithdrawal(state, oldName, 'swapped');

  return dirty({
    ...replaced,
    withdrawnUnits: withdrawn.withdrawnUnits,
    players: players.filter((name) => name !== oldName).concat(trimmed),
    reserves: (state.reserves as string[]).filter((name) => name !== trimmed),
    groups: state.groups.map((group) => ({
      ...group,
      members: group.members.map((name) => (name === oldName ? trimmed : name)),
    })),
    rounds: patchFutureGroupStageRounds(replaced, oldName, trimmed),
  });
}

export function swapTeam(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): TournamentState {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  if (!teamSize || (state.players as TournamentTeam[]).some((team) => team.teamId === replacement.teamId)) {
    return state;
  }
  // The outgoing team (oldTeamId) is excluded -- it's being removed by this
  // same swap, so a replacement sharing its exact name is not a collision.
  if (isDisplayNameTaken(state, replacement.teamName, oldTeamId)) return state;
  const replaced = replaceAssignedUnit(state, oldTeamId, replacement.teamId, teamSize);
  if (!replaced) return state;
  const withdrawn = recordWithdrawal(state, oldTeamId, 'swapped');

  return dirty({
    ...replaced,
    withdrawnUnits: withdrawn.withdrawnUnits,
    players: (state.players as TournamentTeam[])
      .filter((team) => team.teamId !== oldTeamId)
      .concat(replacement),
    reserves: (state.reserves as TournamentTeam[]).filter((team) => team.teamId !== replacement.teamId),
    groups: state.groups.map((group) => ({
      ...group,
      members: group.members.map((name) => (name === oldTeamId ? replacement.teamId : name)),
    })),
    rounds: patchFutureGroupStageRounds(replaced, oldTeamId, replacement.teamId),
  });
}

export function fillTeamSlot(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  member: { name: string; userId?: string },
  reserveIndex?: number,
): TournamentState {
  if (!state.reserveOpen) return state;
  const next = updateTeam(state, teamId, (team) => {
    if (team.members[memberIndex]) return team;
    const members = [...team.members];
    members[memberIndex] = member;
    return { ...team, members };
  });
  return reserveIndex === undefined
    ? next
    : {
        ...next,
        reserveIndividuals: next.reserveIndividuals.filter((_, index) => index !== reserveIndex),
      };
}

export function updateTeam(
  state: TournamentState,
  teamId: string,
  updater: (team: TournamentTeam) => TournamentTeam,
): TournamentState {
  return dirty({
    ...state,
    players: (state.players as TournamentTeam[]).map((team) =>
      team.teamId === teamId ? updater({ ...team, members: [...team.members] }) : team,
    ),
  });
}

export function setTeamDefender(state: TournamentState, teamId: string, memberIdx: number): TournamentState {
  const changes = [...(state.defenderChanges[teamId] ?? [])];
  const existing = changes.find((entry) => entry.round === state.curRound);
  if (existing) existing.memberIdx = memberIdx;
  else changes.push({ round: state.curRound, memberIdx });
  return dirty({
    ...state,
    defenderChanges: { ...state.defenderChanges, [teamId]: changes },
  });
}

/**
 * Clears just the registered roster (players/reserves/individual reserves)
 * plus anything derived from it that would otherwise go stale -- the
 * generated schedule preview, if "Generate Schedule" was already clicked
 * pre-start. Deliberately preserves title/gameFormat/scheduleLogic/cfg (the
 * Setup configuration itself) -- the complement of resetTournamentState()
 * below, which preserves the roster but clears live progress.
 */
export function resetRoster(state: TournamentState): TournamentState {
  return {
    ...state,
    players: [],
    reserves: [],
    reserveIndividuals: [],
    confirmedCount: null,
    rounds: [],
    groups: [],
    groupStandings: {},
    qualTable: [],
    gamemodeConfig: {},
    scores: {},
    finalScores: {},
    assignments: [],
    luckyLosers: [],
    byes: [],
    poolingByeCounts: {},
    pendingBracketSeeds: {},
    tieResolutions: {},
    defenderChanges: {},
    withdrawnUnits: [],
    roomHistory: {},
    anonymousFinalists: [],
    curRound: 0,
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: null,
  };
}

export function resetTournamentState(state: TournamentState): TournamentState {
  return {
    ...state,
    scores: {},
    finalScores: {},
    assignments: [],
    qualTable: [],
    groupStandings: {},
    poolingByeCounts: {},
    pendingBracketSeeds: {},
    tieResolutions: {},
    luckyLosers: [],
    byes: [],
    defenderChanges: {},
    withdrawnUnits: [],
    curRound: 0,
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: null,
  };
}
