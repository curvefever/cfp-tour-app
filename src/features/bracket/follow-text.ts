import { type BracketFollowStatus, bracketRoundLabels } from '../../domain/tournament/bracket';
import { exitBandAtRank, roundExitRule } from '../../domain/tournament/room-exits';
import { unitDisplay } from '../../domain/tournament/roster';
import {
  standingFor,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { ordinal } from '../../lib/ordinal';
import { standingsNames } from '../standings/standings-names';
import { destinationLabel } from './exit-text';
import { placeInRoom } from './folded-round';
import { roomTitle } from './room-title';

type Labels = ReturnType<typeof bracketRoundLabels>;

export interface FollowBannerText {
  /** The followed unit's name. */
  name: string;
  /** Where it is and what comes next: "Quarters · Room B · 4th → Semi B". */
  detail: string;
}

function isPooling(round: TournamentRound | undefined): boolean {
  return Boolean(round?.isQual || round?.isSwiss || round?.isGroupStage);
}

/** Where a unit cut at the standings went out: "qualification · #25", "Swiss · #25", "Group B · #3"; null if unranked. */
function outAtStandings(standings: StandingsDisplay | null, key: string): string | null {
  const standing = standings ? standingFor(standings, key) : null;
  if (!standings || !standing) return null;
  const table = standing.groupLabel ? `Group ${standing.groupLabel}` : standingsNames(standings.kind).inline;
  return `${table} · #${standing.rank}`;
}

/**
 * " · #6 in qualification" (or "in Swiss") while the standings can still change; in a group stage "#2 in Group B",
 * or "#2 in group" when the room's title already names the group.
 */
function standingsSuffix(standings: StandingsDisplay | null, key: string, groupNamed: boolean): string {
  if (!standings || standings.phase === 'final') return '';
  const standing = standingFor(standings, key);
  if (!standing) return '';
  const where = !standing.groupLabel
    ? standingsNames(standings.kind).inline
    : groupNamed
      ? 'group'
      : `Group ${standing.groupLabel}`;
  return ` · #${standing.rank} in ${where}`;
}

/** Where the place `place` of a room of a bracket round leads, as a short phrase ("→ Semis", "out"); null if unknown. */
function placeDestination(
  state: TournamentState,
  roundIndex: number,
  room: number,
  place: number,
  labels: Labels,
): string | null {
  const rule = roundExitRule(state, roundIndex);
  const band = rule.kind === 'per-room' ? exitBandAtRank(rule.rooms[room - 1] ?? [], place) : null;
  if (!band) return null;
  switch (band.kind) {
    case 'advance':
    case 'drop':
      return `→ ${destinationLabel(band.destination, labels)}`;
    case 'promote':
    case 'demote':
      return `→ ${roomTitle(state.rounds[roundIndex], band.targetRoom - 1)}`;
    case 'stay':
      return 'stays';
    case 'eliminate':
      return 'out';
    case 'lucky-chance':
      return roundIndex < state.curRound ? null : '· lucky loser?';
  }
}

/**
 * What the follow banner says about a followed unit, from the round it last played: its room; once the room is
 * complete, its place and where that place goes (the room it was drawn into when the next round is already
 * drawn); in the pooling rounds, its standing while that can still change; a bye; "Out in ..."; or that it is not
 * in this bracket.
 */
export function followBannerText(
  state: TournamentState,
  follow: BracketFollowStatus | null,
  standings: StandingsDisplay | null,
  key: string,
): FollowBannerText {
  const labels = bracketRoundLabels(state);
  const name = unitDisplay(state, key).label;
  if (!follow) return { name, detail: 'Not in this bracket' };
  // A round drawn ahead of the current one is shown as the next step of the last round the unit played.
  const played = Object.keys(follow.rounds)
    .map(Number)
    .filter((index) => index <= state.curRound)
    .at(-1);
  const drawnAhead = follow.lastRi > state.curRound && played !== undefined;
  const roundIndex = drawnAhead ? played : follow.lastRi;
  const round = state.rounds[roundIndex];
  const roundName = destinationLabel(roundIndex, labels);
  const entry = follow.rounds[roundIndex];
  if (!entry || entry.isBye || entry.room === null) {
    return { name, detail: follow.eliminated && !drawnAhead ? `Out in ${roundName}` : `${roundName} · Bye` };
  }
  const where = `${roundName} · ${roomTitle(round, entry.room - 1)}`;
  if (isPooling(round)) {
    if (follow.eliminated && !drawnAhead) {
      return { name, detail: `Out in ${outAtStandings(standings, key) ?? where}` };
    }
    return { name, detail: `${where}${standingsSuffix(standings, key, Boolean(round.isGroupStage))}` };
  }
  const place = placeInRoom(state, roundIndex, entry.room, key);
  const placeText = place === null ? '' : ` · ${ordinal(place)}`;
  if (follow.eliminated && !drawnAhead) return { name, detail: `Out in ${where}${placeText}` };
  if (place === null) return { name, detail: where };
  const nextRoom = drawnAhead ? follow.rounds[follow.lastRi]?.room : null;
  const next =
    nextRoom !== null && nextRoom !== undefined
      ? `→ ${roomTitle(state.rounds[follow.lastRi], nextRoom - 1)}`
      : placeDestination(state, roundIndex, entry.room, place, labels);
  return { name, detail: `${where}${placeText}${next ? ` ${next}` : ''}` };
}

/** The Standings tab's follow banner: "#14 · → Round 4", "#30 · out"; null when the unit has no rank yet. */
export function standingsFollowText(display: StandingsDisplay, key: string, labels: Labels): string | null {
  for (const table of display.tables) {
    const index = table.entries.findIndex((entry) => entry.name === key);
    if (index === -1) continue;
    const rank = table.entries[index].rank;
    if (rank === null) return null;
    return `#${rank} · ${standingsDestination(table, display, index, labels)}`;
  }
  return null;
}

/**
 * What the Standings tab's follow banner says after the name: "#14 · → Round 4", nothing while the unit has no rank
 * yet, "Not in these standings" when it is in no table (for instance a unit followed in another tournament).
 */
export function standingsFollowDetail(display: StandingsDisplay, key: string, labels: Labels): string {
  const listed = display.tables.some((table) => table.entries.some((entry) => entry.name === key));
  return standingsFollowText(display, key, labels) ?? (listed ? '' : 'Not in these standings');
}

function standingsDestination(
  table: StandingsDisplayTable,
  display: StandingsDisplay,
  index: number,
  labels: Labels,
): string {
  if (table.bands && table.bands.length > 0) {
    const band = [...table.bands].reverse().find((candidate) => candidate.start <= index) ?? table.bands[0];
    return band.destination === 'out' ? 'out' : `→ ${band.destination}`;
  }
  if (table.cut !== null && index >= table.cut) return 'out';
  return `→ ${destinationLabel(display.lastStandingsRoundIndex + 1, labels)}`;
}
