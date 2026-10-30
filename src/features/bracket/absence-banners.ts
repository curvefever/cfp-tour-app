import { type AbsenceQuestion, zeroScoresInPlay } from '../../domain/tournament/absences';
import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { isOneScorePerTeam } from '../../domain/tournament/formats';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import type { AbsenceAnswer, TournamentState } from '../../domain/tournament/types';

/** A button of the bar: answers every key in `keys` with `answer`. */
export interface AbsenceBannerButton {
  label: string;
  keys: string[];
  answer: AbsenceAnswer;
}

/** One room's bar: the heading, the line under it, and the buttons. */
export interface AbsenceBannerRow {
  key: string;
  /** Danger when an unanswered 0 blocks Next Round, warning in One score per team where it counts as played. */
  tone: 'danger' | 'warning';
  heading: string;
  detail: string;
  buttons: AbsenceBannerButton[];
}

/** Who a score key belongs to as the bar names it: "Carol", "Alice (Red)", with " · game 2" in a multi-game round. */
export function questionLabel(state: TournamentState, question: AbsenceQuestion): string {
  const unit = unitDisplay(state, question.unit).label;
  const member =
    question.memberIndex === undefined
      ? null
      : buildTeamMap(state)[question.unit]?.members[question.memberIndex]?.name;
  const who = member ? `${member} (${unit})` : unit;
  return question.game === undefined ? who : `${who} · game ${question.game}`;
}

const ONE_SCORE_NOTE = 'counted as played unless marked';

function shortcutLabel(count: number, answer: AbsenceAnswer): string {
  return count === 2 ? `Both ${answer}` : `All ${count} ${answer}`;
}

/** One absent button per unit still to answer, then the two shortcuts; a lone unit gets absent and played. */
function buttonsOf(pending: Array<{ key: string; label: string }>): AbsenceBannerButton[] {
  if (pending.length === 1) {
    const [only] = pending;
    return [
      { label: `${only.label} absent`, keys: [only.key], answer: 'absent' },
      { label: `${only.label} played`, keys: [only.key], answer: 'played' },
    ];
  }
  const keys = pending.map((question) => question.key);
  return [
    ...pending.map((question) => ({
      label: `${question.label} absent`,
      keys: [question.key],
      answer: 'absent' as const,
    })),
    { label: shortcutLabel(pending.length, 'absent'), keys, answer: 'absent' },
    { label: shortcutLabel(pending.length, 'played'), keys, answer: 'played' },
  ];
}

function namesOf(list: Array<{ label: string }>): string {
  return list.map((question) => question.label).join(', ');
}

/**
 * The bars for the scores of 0 in the column in play that still have an unanswered question, one per room, in the
 * same place and pattern as the tie banners. Each names its round by the name the Bracket shows (a double elimination
 * numbers its rounds by column). Once some of a room's 0s are answered the heading counts what is left and the line lists the answers.
 */
export function absenceBannerRows(state: TournamentState): AbsenceBannerRow[] {
  const oneScorePerTeam = isOneScorePerTeam(state);
  const labels = bracketRoundLabels(state);
  return zeroScoresInPlay(state).flatMap((roomQuestions): AbsenceBannerRow[] => {
    const named = roomQuestions.questions.map((question) => ({
      key: question.key,
      label: questionLabel(state, question),
      answer: state.absences[question.key],
    }));
    const pending = named.filter((question) => !question.answer);
    if (!pending.length) return [];
    const roundName = `${labels[roomQuestions.roundIndex]?.label ?? ''} · `;
    const answered = named.length > pending.length;
    const given = (answer: AbsenceAnswer, title: string) => {
      const list = named.filter((question) => question.answer === answer);
      return list.length ? [`${title}: ${namesOf(list)}`] : [];
    };
    const detail = answered
      ? [
          ...given('absent', 'Absent'),
          ...given('played', 'Played'),
          `still to answer: ${namesOf(pending)}`,
        ].join(' — ')
      : `${namesOf(pending)} scored 0 — pick who was absent; the others played`;
    return [
      {
        key: `${roomQuestions.roundIndex}-${roomQuestions.room}`,
        tone: oneScorePerTeam ? 'warning' : 'danger',
        heading: `⚠ Score of 0 — ${roundName}Room ${roomLetter(roomQuestions.room)} (${pending.length} ${answered ? 'left' : 'at 0'})`,
        detail: oneScorePerTeam ? `${detail} — ${ONE_SCORE_NOTE}` : detail,
        buttons: buttonsOf(pending),
      },
    ];
  });
}
