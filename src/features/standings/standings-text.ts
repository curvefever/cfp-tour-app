import type { StandingsDisplay } from '../../domain/tournament/standings-display';

/** Context line shared by the Standings tab and the Bracket column: where the standings are and what they decide. */
export function standingsContextLine(display: StandingsDisplay): string {
  const cut = display.tables[0]?.cut ?? null;
  if (display.phase === 'upcoming') return `Standings start after Round ${display.firstCountedRoundNum}.`;
  const perGroup = display.perGroup ? 'per group ' : '';
  if (display.phase === 'final') {
    return cut === null
      ? 'Final standings · everyone qualified'
      : `Final standings · top ${cut} ${perGroup}qualified`;
  }
  const progress = `After ${display.roundsDone} of ${display.roundsTotal} rounds`;
  return cut === null
    ? `${progress} · everyone goes through`
    : `${progress} · top ${cut} ${perGroup}go through`;
}
