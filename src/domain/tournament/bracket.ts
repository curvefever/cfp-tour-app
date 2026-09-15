import { lastAssignedRound } from './rankings';
import { sequentialSeed } from './seeding';
import type { TournamentRound, TournamentState } from './types';

interface BracketRoundLabel {
  label: string;
  accent: '' | 'wb' | 'lb' | 'gf';
  /** The round number as shown in `label` (the WB/LB-specific counter for bracket rounds, `roundNum` otherwise). */
  roundNumber: number;
}

export function bracketRoundLabels(state: Pick<TournamentState, 'rounds'>): BracketRoundLabel[] {
  let winnersRound = 0;
  let losersRound = 0;
  return state.rounds.map((round) => {
    if (round.bracket === 'winners') {
      winnersRound += 1;
      return { label: `WB Round ${winnersRound}`, accent: 'wb', roundNumber: winnersRound };
    }
    if (round.bracket === 'losers') {
      losersRound += 1;
      return { label: `LB Round ${losersRound}`, accent: 'lb', roundNumber: losersRound };
    }
    if (round.bracket === 'grand-final') {
      return { label: '🏆 Grand Final', accent: 'gf', roundNumber: round.roundNum };
    }
    const label = round.isFinal
      ? '🏆 Final'
      : round.isSemis
        ? '⚔ Semis'
        : round.isQual
          ? `Round ${round.roundNum} (Qual)`
          : round.isSwiss
            ? `Round ${round.roundNum} (Swiss)`
            : round.isGroupStage
              ? `Round ${round.roundNum} (Group)`
              : round.isKingsValley
                ? `Round ${round.roundNum} (Kings Valley)`
                : `Round ${round.roundNum}`;
    return { label, accent: '', roundNumber: round.roundNum };
  });
}

export interface BracketFollowStatus {
  key: string;
  rounds: Record<number, { room: number | null; isBye: boolean }>;
  lastRi: number;
  room: number | null;
  isBye: boolean;
  eliminated: boolean;
}

export function bracketFollowStatus(
  state: Pick<TournamentState, 'assignments' | 'byes'>,
  key: string | null,
): BracketFollowStatus | null {
  if (!key) return null;
  const rounds: BracketFollowStatus['rounds'] = {};
  let lastRi = -1;
  let room: number | null = null;
  let isBye = false;
  state.assignments.forEach((assignments, roundIndex) => {
    const entry = assignments.find((assignment) => assignment.name === key);
    const listedBye = !entry && Boolean(state.byes[roundIndex]?.includes(key));
    if (!entry && !listedBye) return;
    room = entry?.room ?? null;
    isBye = listedBye || room === null;
    rounds[roundIndex] = { room, isBye };
    lastRi = roundIndex;
  });
  if (lastRi < 0) return null;
  return {
    key,
    rounds,
    lastRi,
    room,
    isBye,
    eliminated: lastRi < lastAssignedRound(state),
  };
}

export function bracketRoundDefaultCollapsed(roundIndex: number, currentRound: number): boolean {
  return roundIndex < currentRound - 1;
}

/** Formats a 1-indexed room number as a letter (1 -> A, 26 -> Z, 27 -> AA, ...). */
export function roomLetter(room: number): string {
  let n = room;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label || '?';
}

export type ProjectedSlotLabel =
  | { kind: 'room-rank'; room: number; rank: number; advPerRoom: number; sourceRound: number }
  | { kind: 'lucky' }
  | { kind: 'qualifier-cutoff' }
  | { kind: 'round-edge'; sourceRoundIndex: number; edge: 'advanced' | 'dropped'; label: string };

export function projectedSlotLabelText(slot: ProjectedSlotLabel): string {
  switch (slot.kind) {
    case 'room-rank': {
      const tag = `${slot.sourceRound}${roomLetter(slot.room)}`;
      return slot.advPerRoom === 1 ? `Winner of Room ${tag}` : `Room ${tag}, Rank ${slot.rank}`;
    }
    case 'lucky':
      return '★ Lucky loser (any room)';
    case 'qualifier-cutoff':
      return 'Qualifier from standings (seed TBD)';
    case 'round-edge':
      return slot.label;
  }
}

function winnersSideCount(round: Pick<TournamentRound, 'advPerRoom' | 'rooms' | 'luckyCount'>): number {
  return (round.advPerRoom ?? 0) * round.rooms.length + round.luckyCount;
}

function losersSideCount(round: Pick<TournamentRound, 'advPerRoom' | 'rooms' | 'luckyCount'>): number {
  const roomSum = round.rooms.reduce((total, size) => total + size, 0);
  return roomSum - (round.advPerRoom ?? 0) * round.rooms.length - round.luckyCount;
}

function isLastPoolingRound(rounds: TournamentRound[], index: number): boolean {
  const round = rounds[index];
  const next = rounds[index + 1];
  return Boolean(round && (round.isQual || round.isSwiss) && !(next?.isQual || next?.isSwiss));
}

function isLastGroupStageRound(rounds: TournamentRound[], index: number): boolean {
  const round = rounds[index];
  const next = rounds[index + 1];
  return Boolean(round?.isGroupStage && !next?.isGroupStage);
}

interface PredecessorEdge {
  sourceIndex: number;
  edge: 'winners' | 'losers';
}

function predecessorsOf(rounds: TournamentRound[], targetIndex: number): PredecessorEdge[] {
  const predecessors: PredecessorEdge[] = [];
  for (let sourceIndex = 0; sourceIndex < targetIndex; sourceIndex += 1) {
    const source = rounds[sourceIndex];
    if (!source) continue;
    if (source.bracket) {
      if (source.winnersTo === targetIndex) predecessors.push({ sourceIndex, edge: 'winners' });
      if (source.losersTo === targetIndex) predecessors.push({ sourceIndex, edge: 'losers' });
    } else if (sourceIndex === targetIndex - 1) {
      predecessors.push({ sourceIndex, edge: 'winners' });
    }
  }
  return predecessors;
}

/**
 * Structural, score-independent projection of where each future round's slots will
 * likely come from. Computed once per render over the whole rounds array. A no-elim
 * predecessor (e.g. the "None" pooling phase's warmup rounds, or a mid-Qualification-
 * Table round) still contributes a real per-room projection -- nobody is cut, but
 * roomBasedComputeAdvancement ranks each room's occupants by score before handing the
 * whole room on, so the same room-rank shape applies, just with every position filled
 * instead of a top-N cut.
 *
 * Both the no-elim branch and the ordinary cutting-round branch below build their
 * room-rank tokens tier-major (every room's own rank-1 finisher, then every room's
 * own rank-2, ...) rather than room-major -- this deliberately spreads same-source-
 * room candidates across different target rooms once chunked, matching in spirit
 * (though not exactly) what the real transition's tiered/diversity-aware seeding
 * (tieredSeed, seeding.ts) actually tends to do, instead of the room-major ordering's
 * worst-case collapse into "every room carries straight over unchanged" whenever
 * source and target share the same room shape (see the chunking comment below).
 *
 * A round index maps to null when its origin genuinely can't be resolved ahead of
 * time (group-stage -- handled by real names elsewhere; Swiss -- handled by the
 * existing pairingTBD note; a mid-pooling-phase hop; or a structural token-count
 * mismatch, e.g. an unmodeled bye). A null result poisons every downstream round fed
 * (even indirectly) by that round.
 *
 * Each room-rank token also carries the source round's own display number
 * (bracketRoundLabels' WB/LB-specific counter for bracket rounds, roundNum
 * otherwise) so `projectedSlotLabelText` can render e.g. "Room 1A, Rank 2"
 * instead of a bare "Room A, Rank 2" -- once rooms are lettered, "Room A"
 * alone no longer identifies which round it's from.
 */
export function projectFutureRoundSlots(
  state: Pick<TournamentState, 'rounds' | 'curRound'>,
): Record<number, ProjectedSlotLabel[][] | null> {
  const { rounds } = state;
  const labels = bracketRoundLabels({ rounds });
  const result: Record<number, ProjectedSlotLabel[][] | null> = {};
  const unresolved = new Set<number>();

  for (let targetIndex = state.curRound + 1; targetIndex < rounds.length; targetIndex += 1) {
    const round = rounds[targetIndex];
    if (!round || round.isGroupStage || round.pairingTBD || round.isKingsValley) {
      result[targetIndex] = null;
      continue;
    }

    const predecessors = predecessorsOf(rounds, targetIndex);
    if (!predecessors.length) {
      result[targetIndex] = null;
      continue;
    }
    if (predecessors.some((edge) => unresolved.has(edge.sourceIndex))) {
      result[targetIndex] = null;
      unresolved.add(targetIndex);
      continue;
    }

    const cutoff = predecessors.some(
      ({ sourceIndex }) =>
        isLastPoolingRound(rounds, sourceIndex) || isLastGroupStageRound(rounds, sourceIndex),
    );
    if (cutoff) {
      result[targetIndex] = round.rooms.map((size) =>
        Array.from({ length: size }, (): ProjectedSlotLabel => ({ kind: 'qualifier-cutoff' })),
      );
      continue;
    }

    const pool: ProjectedSlotLabel[] = [];
    for (const { sourceIndex, edge } of predecessors) {
      const source = rounds[sourceIndex];
      const sourceLabel = labels[sourceIndex]?.label ?? `Round ${source.roundNum}`;
      const sourceRound = labels[sourceIndex]?.roundNumber ?? source.roundNum;
      if (edge === 'losers') {
        for (let i = 0; i < losersSideCount(source); i += 1) {
          pool.push({
            kind: 'round-edge',
            sourceRoundIndex: sourceIndex,
            edge: 'dropped',
            label: `Dropped from ${sourceLabel}`,
          });
        }
        continue;
      }
      if (source.bracket === 'losers') {
        for (let i = 0; i < winnersSideCount(source); i += 1) {
          pool.push({
            kind: 'round-edge',
            sourceRoundIndex: sourceIndex,
            edge: 'advanced',
            label: `Advanced from ${sourceLabel}`,
          });
        }
        continue;
      }
      if (source.isNoElim) {
        // Nobody is cut, but everyone's rank within their own room still
        // carries forward (roomBasedComputeAdvancement ranks a no-elim
        // room's occupants by score before handing the whole room on) --
        // project every position of every room using that room's own size,
        // rather than treating a no-elim round as unknowable. Room sizes can
        // differ (e.g. [8,8,7,7,7]), so this must be computed per room, not
        // from a single round-wide advPerRoom the way every other room-based
        // round already is. Tier-major (rank outer, room inner) -- see the
        // function doc comment above for why.
        const maxRoomSize = Math.max(0, ...source.rooms);
        for (let rank = 1; rank <= maxRoomSize; rank += 1) {
          for (let room = 1; room <= source.rooms.length; room += 1) {
            const roomSize = source.rooms[room - 1];
            if (rank > roomSize) continue;
            pool.push({ kind: 'room-rank', room, rank, advPerRoom: roomSize, sourceRound });
          }
        }
        continue;
      }
      const advPerRoom = source.advPerRoom ?? 0;
      // Tier-major (rank outer, room inner) -- see the function doc comment above.
      for (let rank = 1; rank <= advPerRoom; rank += 1) {
        for (let room = 1; room <= source.rooms.length; room += 1)
          pool.push({ kind: 'room-rank', room, rank, advPerRoom, sourceRound });
      }
      for (let i = 0; i < source.luckyCount; i += 1) pool.push({ kind: 'lucky' });
    }

    const expected = round.rooms.reduce((total, size) => total + size, 0);
    if (pool.length !== expected) {
      result[targetIndex] = null;
      unresolved.add(targetIndex);
      continue;
    }

    // Chunk the tier-major pool directly into round.rooms' declared sizes
    // rather than trying to mirror the real transition's own diversity/
    // recency-aware wave-based seeding (tieredSeed/tieredBracketSeed,
    // seeding.ts) exactly -- that seeding depends on live match history and
    // per-round scores this display doesn't have and shouldn't need.
    // Building the pool tier-major (see the function doc comment above)
    // already keeps same-source-room candidates apart across target rooms
    // in the common case (source and target sharing a room shape), so this
    // sequential chunk is a much closer approximation than a naive
    // room-major slice would be -- but the exact target-room assignment can
    // still drift from what the real transition produces. That residual
    // drift is accepted as the honest tradeoff: every projected slot always
    // matches its own room's displayed size exactly (no more blank dashes
    // or invisible overflow into another room), which is the property this
    // display is for.
    const seeded = sequentialSeed(
      pool.map((_, index) => String(index)),
      round.rooms,
    );
    const byRoom: ProjectedSlotLabel[][] = round.rooms.map(() => []);
    for (const assignment of seeded) {
      if (assignment.room === null) continue;
      byRoom[assignment.room - 1]?.push(pool[Number(assignment.name)]);
    }
    result[targetIndex] = byRoom;
  }
  return result;
}
