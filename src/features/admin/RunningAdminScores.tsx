import { getAllTies, isTieResolved } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { resolveTournamentTie } from '../../domain/tournament/mutations';
import { unitDisplay } from '../../domain/tournament/roster';
import { tieResolutionList } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

export function TieBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const ties = getAllTies(state, state.curRound);
  return Object.entries(ties)
    .filter(([key, tie]) => !isTieResolved(key, tie, state))
    .map(([key, tie]) => {
      const resolved = tieResolutionList(state, key);
      const remaining = tie.players.filter((player) => !resolved.includes(player.name));
      const heading =
        'groupLabel' in tie && tie.groupLabel
          ? `⚠ Tie-break required — Group ${tie.groupLabel} qualification cutoff (${tie.fp.toFixed(5)} FP)`
          : 'score' in tie
            ? `⚠ Tie-break required — Room ${roomLetter(tie.rm)} (score ${tie.score})`
            : `⚠ Tie-break required — Qualification cutoff (${tie.fp.toFixed(5)} FP)`;
      return (
        <div
          className='mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-danger bg-danger-soft px-4.5 py-3.5'
          key={key}
        >
          <div>
            <div className='font-semibold text-danger'>{heading}</div>
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
