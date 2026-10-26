import { bracketRoundLabels, roundGameCount } from '../../../domain/tournament/bracket';
import {
  fairCutShape,
  fairCutSurvivors,
  roundCoversFairCut,
  type FairCutGroup,
} from '../../../domain/tournament/fair-cut';
import type { TournamentRound, TournamentState } from '../../../domain/tournament/types';
import { plural } from './plural';

export interface SchedulePreviewRow {
  name: string;
  /** How many rooms, and over how many games. */
  meta: string;
  /** The room sizes, the byes and what advances; empty when there is nothing to add. */
  detail: string;
}

function metaOf(state: TournamentState, round: TournamentRound, index: number): string {
  const parts = [
    round.rooms.length
      ? plural(round.rooms.length, 'room')
      : plural(round.matches?.length ?? 0, 'match', 'matches'),
  ];
  const games = roundGameCount(state, index);
  if (games) parts.push(`${games.upTo ? 'up to ' : ''}${plural(games.games, 'game')}`);
  return parts.join(' · ');
}

/** "rooms of 4 lose 4–5, the room of 3 loses 0–1": what each room size gives up in the fair cut. */
function lossText(group: FairCutGroup): string {
  const rooms = group.rooms.length;
  const subject = rooms === 1 ? `the room of ${group.size}` : `rooms of ${group.size}`;
  const verb = rooms === 1 ? 'loses' : 'lose';
  const total = group.size * rooms;
  const fewest = total - group.maxKeep;
  const most = total - group.minKeep;
  return `${subject} ${verb} ${fewest === most ? most : `${fewest}–${most}`}`;
}

/** The fair cut's wording of a cut over several room sizes; null when the round keeps the usual "incl. N lucky losers". */
function fairCutCut(state: TournamentState, round: TournamentRound): string | null {
  if (state.gamemodeConfig.cutVersion !== 2 || !roundCoversFairCut(round)) return null;
  const { groups } = fairCutShape(round.rooms, fairCutSurvivors(round, round.rooms));
  if (groups.length < 2) return null;
  return `${round.advTotal} advance: ${groups.map(lossText).join(', ')}`;
}

function detailOf(state: TournamentState, round: TournamentRound, unitPlural: string): string {
  const parts: string[] = [];
  if (round.rooms.length) parts.push(`${round.rooms.join(' · ')} ${unitPlural}`);
  if (round.byeCount) parts.push(plural(round.byeCount, 'bye'));
  // A round that sends everyone on has no cut to show.
  if (round.advTotal && round.advTotal < round.players && !round.isFinal) {
    const lucky = round.luckyCount ? ` incl. ${plural(round.luckyCount, 'lucky loser')}` : '';
    parts.push(fairCutCut(state, round) ?? `${round.advTotal} advance${lucky}`);
  }
  return parts.join(', ');
}

/** One row per generated round for the Setup preview: its name, its rooms and games, and what it holds. */
export function schedulePreviewRows(state: TournamentState, unitPlural: string): SchedulePreviewRow[] {
  const labels = bracketRoundLabels(state);
  return state.rounds.map((round, index) => ({
    name: labels[index].label,
    meta: metaOf(state, round, index),
    detail: detailOf(state, round, unitPlural),
  }));
}
