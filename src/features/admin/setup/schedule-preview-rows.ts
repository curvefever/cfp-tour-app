import { bracketRoundLabels, roundGameCount } from '../../../domain/tournament/bracket';
import type { TournamentRound, TournamentState } from '../../../domain/tournament/types';

export interface SchedulePreviewRow {
  name: string;
  /** How many rooms, and over how many games. */
  meta: string;
  /** The room sizes, the byes and what advances; empty when there is nothing to add. */
  detail: string;
}

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
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

function detailOf(round: TournamentRound, unitPlural: string): string {
  const parts: string[] = [];
  if (round.rooms.length) parts.push(`${round.rooms.join(' · ')} ${unitPlural}`);
  if (round.byeCount) parts.push(plural(round.byeCount, 'bye'));
  // A round that sends everyone on has no cut to show.
  if (round.advTotal && round.advTotal < round.players && !round.isFinal) {
    const lucky = round.luckyCount ? ` incl. ${plural(round.luckyCount, 'lucky loser')}` : '';
    parts.push(`${round.advTotal} advance${lucky}`);
  }
  return parts.join(', ');
}

/** One row per generated round for the Setup preview: its name, its rooms and games, and what it holds. */
export function schedulePreviewRows(state: TournamentState, unitPlural: string): SchedulePreviewRow[] {
  const labels = bracketRoundLabels(state);
  return state.rounds.map((round, index) => ({
    name: labels[index].label,
    meta: metaOf(state, round, index),
    detail: detailOf(round, unitPlural),
  }));
}
