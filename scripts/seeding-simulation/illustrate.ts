import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { unitDisplay } from '../../src/domain/tournament/roster';
import { recordRoomHistory, roomPairKey } from '../../src/domain/tournament/seeding';
import type { RoundAssignment, TournamentState } from '../../src/domain/tournament/types';
import { unmarshalFromFirebase } from '../../src/features/sync/firebase-marshal';
import { normalizeLiveTournamentState } from '../../src/lib/persistence/live-state';
import { drawAroundCuts, profileOf } from './cuts';

/**
 * The last qualifying round of a real tournament (read-only data: the stored record fetched with an HTTP GET) as the
 * policies would have drawn it, next to the real draw. The record is only read; nothing here writes to it.
 */

const TOURNAMENT_ID = '1792339397443';

interface Standing {
  name: string;
  rank: number;
  points: number;
}

/** The state as it stood before the last qualifying round: its scores removed and it left out of the standings, with the full meeting history of the earlier rounds. */
function beforeLastRound(state: TournamentState, lastRound: number): TournamentState {
  const scores = Object.fromEntries(
    Object.entries(state.scores).filter(([key]) => !key.startsWith(`r${lastRound}-`)),
  );
  let roomHistory: Record<string, number> = {};
  state.assignments.slice(0, lastRound).forEach((lineUp, index) => {
    roomHistory = recordRoomHistory(roomHistory, lineUp, index);
  });
  const tieResolutions = Object.fromEntries(
    Object.entries(state.tieResolutions).filter(([key]) => !key.startsWith(`r${lastRound}-`)),
  );
  return {
    ...state,
    scores,
    roomHistory,
    tieResolutions,
    rounds: state.rounds.map((round, index) =>
      index === lastRound ? { ...round, excludeFromStandings: true } : round,
    ),
  };
}

function roomsOf(lineUp: RoundAssignment[]): string[][] {
  const rooms: string[][] = [];
  for (const { name, room } of lineUp) {
    if (room !== null) (rooms[room - 1] ??= []).push(name);
  }
  return rooms;
}

/** Every pair in a room that already met in an earlier round, with the round of their last meeting (1-based). */
function repeatPairs(rooms: string[][], history: Record<string, number>): Array<[string, string, number]> {
  const pairs: Array<[string, string, number]> = [];
  for (const room of rooms) {
    for (let a = 0; a < room.length; a += 1) {
      for (let b = a + 1; b < room.length; b += 1) {
        const last = history[roomPairKey(room[a], room[b])];
        if (last !== undefined) pairs.push([room[a], room[b], last + 1]);
      }
    }
  }
  return pairs;
}

function describeDraw(
  title: string,
  rooms: string[][],
  state: TournamentState,
  standings: Map<string, Standing>,
  history: Record<string, number>,
): string {
  const label = (name: string) => unitDisplay(state, name).label;
  const repeats = repeatPairs(rooms, history);
  const lines = rooms.map((room, index) => {
    const members = [...room]
      .sort((a, b) => (standings.get(a)?.rank ?? 0) - (standings.get(b)?.rank ?? 0))
      .map((name) => {
        const entry = standings.get(name);
        return `${label(name)} (#${entry?.rank}, ${entry?.points} pts)`;
      });
    return `- Room ${String.fromCharCode(65 + index)} (${room.length}): ${members.join('; ')}`;
  });
  const repeatLines = repeats.map(
    ([first, second, round]) => `  - repeat: ${label(first)} – ${label(second)} (last met in round ${round})`,
  );
  return [
    `#### ${title}: ${repeats.length} repeat pairings`,
    '',
    ...lines,
    ...repeatLines,
    blockLine(rooms, standings, 8),
    '',
  ].join('\n');
}

/** Where the block of units on the points of #8 and #9 (the 8|9 cut) landed, and whether #8 and #9 share a room. */
function blockLine(rooms: string[][], standings: Map<string, Standing>, cut: number): string {
  const byRank = [...standings.values()].sort((a, b) => a.rank - b.rank);
  const above = byRank[cut - 1];
  const below = byRank[cut];
  if (above.points !== below.points) {
    return `- #${cut} and #${cut + 1} are on different points, so no block of equal points holds the ${cut}|${cut + 1} cut.`;
  }
  const block = byRank.filter((entry) => entry.points === above.points);
  const roomOf = (name: string) => rooms.findIndex((room) => room.includes(name));
  const places = [...new Set(block.map((entry) => roomOf(entry.name)))]
    .sort((a, b) => a - b)
    .map((room) => {
      const ranks = block.filter((entry) => roomOf(entry.name) === room).map((entry) => `#${entry.rank}`);
      return `Room ${String.fromCharCode(65 + room)}: ${ranks.join(', ')}`;
    });
  const shared = roomOf(above.name) === roomOf(below.name);
  const range = `#${block[0].rank}–#${block[block.length - 1].rank}`;
  return `- The ${above.points}-point block (${range}) lands as ${places.join(' | ')}; #${cut} and #${cut + 1} ${shared ? 'share a room' : 'do not share a room'}.`;
}

/** The markdown section for the stored record `raw` (the parsed JSON of the REST read). */
export function illustrate(raw: unknown): string {
  const state = normalizeLiveTournamentState(unmarshalFromFirebase(raw), {
    tournamentId: () => TOURNAMENT_ID,
  });
  const lastRound = state.rounds.map((round) => round.isQual).lastIndexOf(true);
  const before = beforeLastRound(state, lastRound);
  const standings = new Map<string, Standing>(
    computeQualificationStandings(before).map((entry, index) => [
      entry.name,
      { name: entry.name, rank: index + 1, points: entry.totalFP ?? 0 },
    ]),
  );
  const history = before.roomHistory;
  const draws: Array<[string, string[][]]> = [
    ['The real draw', roomsOf(state.assignments[lastRound])],
    [
      'Policy 6/P2: around the cuts, spread set aside in the last round',
      roomsOf(drawAroundCuts(before, lastRound, profileOf('P2', '2v2v2v2'), false)),
    ],
    [
      'Policy 7/P2: around the cuts, spread kept',
      roomsOf(drawAroundCuts(before, lastRound, profileOf('P2', '2v2v2v2'), true)),
    ],
  ];
  return [
    `## Illustration: the last qualifying round of tournament ${TOURNAMENT_ID}`,
    '',
    `Read-only: the stored record was fetched with an HTTP GET and never written to or opened in a browser. 2v2v2v2 Survival Teams, ${standings.size} teams, qualification round ${lastRound + 1} of ${lastRound + 1} (round 1 not counted). The standings are those after round ${lastRound}, rebuilt from the stored scores (ranks and points below); the repeat pairings count every pair in a room that met in an earlier round, from the full history rebuilt from the stored line-ups. The policies use profile P2.`,
    '',
    ...draws.map(([title, rooms]) => describeDraw(title, rooms, state, standings, history)),
  ].join('\n');
}
