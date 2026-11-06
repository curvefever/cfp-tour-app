import { clickConfirmationAndSeat } from '../../domain/tournament/returning-unit';
import { useTournamentApp } from '../tournament/TournamentProvider';

/**
 * What a click on a name's "?" does, wherever the "?" is (the Players tab's toggle, the Bracket's likely-absent line):
 * the confirmation click, the returning unit's seat after the draw, and the alert that says where it went.
 */
export function useConfirmationClick(): (name: string) => void {
  const app = useTournamentApp();
  return (name) => {
    const { state, notice } = clickConfirmationAndSeat(app.state, name);
    app.updateState(state);
    if (notice) window.alert(notice);
  };
}
