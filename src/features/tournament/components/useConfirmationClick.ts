import { clickConfirmationAndSeat, moveReturningUnit } from '../../../domain/tournament/returning-unit';
import { useTournamentApp } from '../TournamentProvider';

/**
 * What a click on a name's "?" does, wherever the "?" is (the Players tab's toggle, the Bracket's likely-absent line):
 * the confirmation click, the returning unit's seat after the draw, and the alert that says where it went. A unit
 * back from an absence whose room is shared with another likely absentee is asked about (`window.confirm`): the app
 * moves it to a real match only on a "yes".
 */
export function useConfirmationClick(): (name: string) => void {
  const app = useTournamentApp();
  return (name) => {
    const { state, notice, question } = clickConfirmationAndSeat(app.state, name);
    app.updateState(state);
    if (!question) {
      if (notice) window.alert(notice);
      return;
    }
    if (!window.confirm(question.question)) {
      window.alert(question.declined);
      return;
    }
    const moved = moveReturningUnit(state, name);
    if (moved.ok) app.updateState(moved.state);
    else window.alert(moved.error);
  };
}
