import { isStandingsCutoffRound, isUncontestedRoom } from './advancement';
import { kingsValleyRoundMoves, type KingsValleyRoomBandCounts } from './kings-valley';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';
import { waterfallDestination } from './waterfall-bracket';

/**
 * One structural description of "what happens to this rank in this room,"
 * shared by the exit chips, the row colours and the row destination tags
 * (BracketView.tsx) -- built once here so all three always agree, instead of
 * each re-deriving its own version of the same cutoff maths (the recurring
 * bug class this exists to close, see HANDOFF_LOG.md "Fix: Bracket showed
 * every player in a waterfall round as eliminated" and the sibling
 * double-elimination WB-drop bug it shares a root cause with). Ranks are
 * 1-indexed and inclusive; `destination`/`targetRoom` values describe where
 * a band goes, never why -- this file never re-decides advancement, only
 * describes what the real transition (transitions.ts) and advancement
 * (advancement.ts) already compute.
 */
export type RoomExitBand =
  | { kind: 'advance'; fromRank: number; toRank: number; destination: number } // absolute round index
  | { kind: 'drop'; fromRank: number; toRank: number; destination: number } // double-elim: to the losers bracket
  | { kind: 'lucky-chance'; rank: number; spots: number; otherwise: 'eliminate' | { drop: number } }
  | { kind: 'eliminate'; fromRank: number; toRank: number }
  // Kings Valley -- three separate members (not one `'promote' | 'stay' | 'demote'` kind field)
  // so a consumer's `band.kind === 'promote'` check discriminates cleanly via Extract<>,
  // which a single merged member with a union `kind` can't do (Extract needs the whole
  // member, not just its `kind` field, assignable to the filter). `targetRoom` is always
  // present on a real promote/demote band -- the one case with no real target (the top
  // room's own promote count) never becomes a 'promote' band at all; see kingsValleyRoomBands.
  | { kind: 'promote'; fromRank: number; toRank: number; targetRoom: number }
  | { kind: 'stay'; fromRank: number; toRank: number }
  | { kind: 'demote'; fromRank: number; toRank: number; targetRoom: number };

export type RoundExitRule =
  | { kind: 'per-room'; rooms: RoomExitBand[][] } // index-aligned with round.rooms
  | { kind: 'all-advance' } // no-elim warm-up round
  | { kind: 'standings'; counted: boolean } // a non-final qual/Swiss/group round
  | { kind: 'standings-cutoff'; advancing: number; perGroup: boolean; destination: number }
  | { kind: 'none' }; // Final, grand final

/**
 * The number of units actually occupying a room, once the round has real
 * assignments (a removal can shrink a room below its declared size) -- the
 * declared `round.rooms[roomIndex]` otherwise (a future round, or one whose
 * assignments haven't been generated yet). Mirrors the "assignments present
 * = this round has been reached" convention documented on
 * TournamentRound.fixedRoomAssignments/matches.
 */
function actualRoomSize(
  assignments: RoundAssignment[] | undefined,
  roomIndex: number,
  declaredSize: number,
): number {
  if (!assignments || assignments.length === 0) return declaredSize;
  return assignments.filter((entry) => entry.room === roomIndex + 1).length;
}

/**
 * The shared shape behind every "N-1..advPerRoom advance, one more rank gets
 * a lucky-loser chance, the rest drop or are eliminated" room -- used for
 * both ordinary elimination rounds (single-elimination, Semis: `rest` is
 * always 'eliminate') and double-elimination WB/LB rounds (`rest` is
 * `{ drop: losersTo }` when the round has a losers-bracket target, else
 * 'eliminate' -- an LB round's own losers, which have nowhere left to go).
 * Mirrors roomBasedComputeAdvancement/doubleEliminationComputeAdvancement's
 * shared shape: exactly one lucky-loser-eligible rank, immediately after the
 * direct-advance cut, never further down the room.
 */
function cutRoomBands(
  actualSize: number,
  advPerRoom: number,
  luckyCount: number,
  advanceDestination: number,
  rest: 'eliminate' | { drop: number },
): RoomExitBand[] {
  const bands: RoomExitBand[] = [];
  const advanceTo = Math.min(Math.max(advPerRoom, 0), actualSize);
  if (advanceTo > 0) {
    bands.push({ kind: 'advance', fromRank: 1, toRank: advanceTo, destination: advanceDestination });
  }
  let rank = advanceTo + 1;
  if (rank > actualSize) return bands;

  if (luckyCount > 0) {
    bands.push({ kind: 'lucky-chance', rank, spots: luckyCount, otherwise: rest });
    rank += 1;
    if (rank > actualSize) return bands;
  }

  bands.push(
    rest === 'eliminate'
      ? { kind: 'eliminate', fromRank: rank, toRank: actualSize }
      : { kind: 'drop', fromRank: rank, toRank: actualSize, destination: rest.drop },
  );
  return bands;
}

/**
 * Kings Valley's promote/stay/demote-or-eliminate split for one room, in
 * rank order -- mirrors kingsValleyComputeAdvancement's own band maths
 * exactly (advancement.ts). `band` is this room's own entry from
 * kingsValleyRoundMoves, computed once for the whole round from every
 * room's real size (see the roundExitRule call site) so a lone room and the
 * real effective bottom always agree with the real advance. Two edge cases:
 * the top room's own promote band has nowhere to go and folds into its stay
 * band (there's no room above room 1), and a room with `band.eliminates` cuts
 * via elimination, not a move to the room below -- not necessarily the
 * literal last room, since a lone (holding) room can sit below it.
 */
function kingsValleyRoomBands(
  band: KingsValleyRoomBandCounts,
  roomIndex: number,
  actualSize: number,
): RoomExitBand[] {
  const room = roomIndex + 1;
  const isTop = room === 1;

  const promoteCount = band.promote;
  const cutCount = band.cut;
  const stayCount = actualSize - promoteCount - cutCount;

  const bands: RoomExitBand[] = [];
  let rank = 1;
  if (!isTop && promoteCount > 0) {
    bands.push({ kind: 'promote', fromRank: rank, toRank: rank + promoteCount - 1, targetRoom: room - 1 });
    rank += promoteCount;
  }
  // The top room's own promote band never leaves -- it folds into the stay
  // band below instead of getting its own band, so `rank` stays at 1 and
  // the stay band below absorbs those ranks too.
  const combinedStayCount = isTop ? promoteCount + stayCount : stayCount;
  if (combinedStayCount > 0) {
    bands.push({ kind: 'stay', fromRank: rank, toRank: rank + combinedStayCount - 1 });
    rank += combinedStayCount;
  }

  if (cutCount > 0) {
    bands.push(
      band.eliminates
        ? { kind: 'eliminate', fromRank: rank, toRank: rank + cutCount - 1 }
        : { kind: 'demote', fromRank: rank, toRank: rank + cutCount - 1, targetRoom: room + 1 },
    );
  }
  return bands;
}

/**
 * A waterfall room's bands, read straight off `round.waterfallRoutes` via
 * `waterfallDestination` (the same lookup advanceWaterfallBracket and
 * Bracket's row colouring both already use) -- consecutive ranks routing to
 * the exact same destination (including consecutive eliminated ranks) merge
 * into one band; two ranks that happen to share a destination but aren't
 * adjacent (a real, deliberate shape -- e.g. "ranks 1 and 3 both go to
 * SemiA, but rank 2 goes elsewhere") stay as separate bands, never merged
 * across the gap.
 */
function waterfallRoomBands(round: TournamentRound, roomIndex: number, actualSize: number): RoomExitBand[] {
  const room = roomIndex + 1;
  const bands: RoomExitBand[] = [];
  let start = 0; // 0-indexed rank, matching waterfallDestination's own convention
  while (start < actualSize) {
    const destination = waterfallDestination(round, room, start);
    let end = start;
    while (end + 1 < actualSize && waterfallDestination(round, room, end + 1) === destination) {
      end += 1;
    }
    bands.push(
      destination === null
        ? { kind: 'eliminate', fromRank: start + 1, toRank: end + 1 }
        : { kind: 'advance', fromRank: start + 1, toRank: end + 1, destination },
    );
    start = end + 1;
  }
  return bands;
}

function perRoomRule(
  round: TournamentRound,
  assignments: RoundAssignment[] | undefined,
  bandsFor: (roomIndex: number, actualSize: number) => RoomExitBand[],
): RoundExitRule {
  return {
    kind: 'per-room',
    rooms: round.rooms.map((declaredSize, roomIndex) =>
      bandsFor(roomIndex, actualRoomSize(assignments, roomIndex, declaredSize)),
    ),
  };
}

/**
 * The one structural description of how a round's occupants exit it --
 * never re-decides advancement, only describes what the real transition
 * (transitions.ts) and advancement (advancement.ts) already compute. See the
 * module doc comment above for why this exists, and docs/views.md (Bracket)
 * for how it's consumed.
 */
export function roundExitRule(state: TournamentState, roundIndex: number): RoundExitRule {
  const round = state.rounds[roundIndex];
  if (round.isFinal || round.bracket === 'grand-final') return { kind: 'none' };

  if (isStandingsCutoffRound(state, roundIndex)) {
    const perGroup = Boolean(round.isGroupStage);
    return {
      kind: 'standings-cutoff',
      advancing: perGroup ? (state.cfg.qualifiersPerGroup ?? 0) : (state.cfg.qualAdv ?? 0),
      perGroup,
      destination: roundIndex + 1,
    };
  }

  if (round.isQual || round.isSwiss || round.isGroupStage) {
    return { kind: 'standings', counted: !round.excludeFromStandings };
  }

  if (round.isNoElim) return { kind: 'all-advance' };

  const assignments = state.assignments[roundIndex];

  if (round.isKingsValley) {
    // Bypasses perRoomRule -- kingsValleyRoundMoves needs every room's
    // real size up front to find the effective bottom, so actualSize is
    // already computed here; reusing it (instead of perRoomRule's own
    // per-room actualRoomSize call) avoids computing it twice per room.
    const actualSizes = round.rooms.map((size, index) => actualRoomSize(assignments, index, size));
    const { bands } = kingsValleyRoundMoves(actualSizes, state.gamemodeConfig.roomSize);
    return {
      kind: 'per-room',
      rooms: round.rooms.map((_, roomIndex) =>
        kingsValleyRoomBands(bands[roomIndex], roomIndex, actualSizes[roomIndex]),
      ),
    };
  }

  if (round.isWaterfall) {
    return perRoomRule(round, assignments, (roomIndex, actualSize) =>
      waterfallRoomBands(round, roomIndex, actualSize),
    );
  }

  if (round.bracket === 'winners' || round.bracket === 'losers') {
    const rest: 'eliminate' | { drop: number } =
      round.losersTo != null ? { drop: round.losersTo } : 'eliminate';
    return perRoomRule(round, assignments, (roomIndex, actualSize) =>
      cutRoomBands(
        actualSize,
        round.advPerRoom ?? 0,
        round.luckyCount,
        round.winnersTo ?? roundIndex + 1,
        rest,
      ),
    );
  }

  // Every other room-based round: single elimination, Semis.
  return perRoomRule(round, assignments, (roomIndex, actualSize) => {
    if (isUncontestedRoom(state, roundIndex, roomIndex + 1)) return [];
    return cutRoomBands(actualSize, round.advPerRoom ?? 0, round.luckyCount, roundIndex + 1, 'eliminate');
  });
}

/** The band covering `rank` (1-indexed) in one room's band list, or null if none does. */
export function exitBandAtRank(bands: RoomExitBand[], rank: number): RoomExitBand | null {
  for (const band of bands) {
    if (band.kind === 'lucky-chance') {
      if (band.rank === rank) return band;
      continue;
    }
    if (rank >= band.fromRank && rank <= band.toRank) return band;
  }
  return null;
}
