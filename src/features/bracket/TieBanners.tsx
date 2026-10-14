import { getAllTies, isTieResolved, qualTieBoundaryText } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { resolveTournamentTie } from '../../domain/tournament/mutations';
import { unitDisplay } from '../../domain/tournament/roster';
import { formatStandingValue, tieResolutionList } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

export function TieBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const ties = getAllTies(state, state.curRound);
  return Object.entries(ties)
    .filter(([key, tie]) => !isTieResolved(key, tie, state))
    .map(([key, tie]) => {
      const resolved = tieResolutionList(state, key);
      const remaining = tie.players.filter((player) => !resolved.includes(player.name));
      const isCutoff = !('score' in tie);
      const boundaryText = 'firstRank' in tie ? qualTieBoundaryText(state, tie) : null;
      const cutoffValue = isCutoff ? `${formatStandingValue(tie.fp)} pts` : '';
      const heading = !isCutoff
        ? `⚠ Tie-break required — Room ${roomLetter(tie.rm)} (score ${tie.score})`
        : 'groupLabel' in tie && tie.groupLabel
          ? `⚖ Group ${tie.groupLabel} qualification tie at the cut-off (${cutoffValue})`
          : boundaryText
            ? `⚖ Qualification tie between ${boundaryText} (${cutoffValue})`
            : `⚖ Qualification tie at the cut-off (${cutoffValue})`;
      return (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border px-4.5 py-3.5',
            isCutoff ? 'border-warning bg-warning-soft' : 'border-danger bg-danger-soft',
          )}
          key={key}
        >
          <div>
            <div className={cn('font-semibold', isCutoff ? 'text-warning' : 'text-danger')}>{heading}</div>
            <div className='mt-1 text-xs text-muted'>
              {resolved.length
                ? `Ranked so far: ${resolved.map((name) => unitDisplay(state, name).label).join(' > ')} — `
                : ''}
              tied: {tie.players.map((player) => unitDisplay(state, player.name).label).join(', ')} — pick who
              ranks next
            </div>
          </div>
          <ButtonRow className='mt-0'>
            {remaining.map((player) => (
              <Button
                size='sm'
                variant='warning'
                key={player.name}
                onClick={() => app.updateState((current) => resolveTournamentTie(current, key, player.name))}
              >
                {unitDisplay(state, player.name).label} ranks next
              </Button>
            ))}
          </ButtonRow>
        </div>
      );
    });
}
