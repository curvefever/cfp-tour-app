import { getAllColumnTies, isTieResolved, qualTieBoundaryText } from '../../domain/tournament/advancement';
import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { resolveTournamentTie, shareTiedPoints } from '../../domain/tournament/mutations';
import { GROUP_EXIT_TIE_KEY } from '../../domain/tournament/group-exit';
import { isPoolingRound, swissRoutesItsStandings } from '../../domain/tournament/pooling';
import { unitDisplay } from '../../domain/tournament/roster';
import { roundsInPlay } from '../../domain/tournament/round-columns';
import { formatStandingValue, tieResolutionList } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { cutoffTieHeading } from './cutoff-tie-heading';

/** The tied value of a cut-off tie: "7 pts", or "1.3 pts per match" in a group stage with per-match standings. */
function cutoffPointsText(tie: { fp: number; players: ReadonlyArray<{ averagePoints?: number }> }): string {
  const perMatch = tie.players[0]?.averagePoints;
  return perMatch === undefined
    ? `${formatStandingValue(tie.fp)} pts`
    : `${formatStandingValue(perMatch)} pts per match`;
}

export function TieBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const ties = getAllColumnTies(state);
  const round = state.rounds[state.curRound];
  const several = roundsInPlay(state).length > 1;
  const labels = bracketRoundLabels(state);
  // Several rounds in play name the round a room tie belongs to (the key starts "r<round index>-").
  const roundLabelOf = (key: string): string =>
    several ? (labels[Number(/^r(\d+)-/.exec(key)?.[1])]?.label ?? '') : '';
  const poolingRound = round ? isPoolingRound(round) : false;
  // A Swiss whose graph has a Qual line routes its standings like a qualification table.
  const afterSwiss = swissRoutesItsStandings(state);
  const tiedLabel = (name: string): string => {
    const group = state.groups.find((entry) => entry.members.includes(name))?.label;
    return `${unitDisplay(state, name).label}${group ? ` (Group ${group})` : ''}`;
  };
  return Object.entries(ties)
    .filter(([key, tie]) => !isTieResolved(key, tie, state))
    .map(([key, tie]) => {
      const resolved = tieResolutionList(state, key);
      const remaining = tie.players.filter((player) => !resolved.includes(player.name));
      const isCutoff = !('score' in tie);
      const canShare = !isCutoff && poolingRound;
      const boundaryText = 'firstRank' in tie ? qualTieBoundaryText(state, tie) : null;
      const cutoffValue = isCutoff ? cutoffPointsText(tie) : '';
      const isExitTie = key === GROUP_EXIT_TIE_KEY;
      const heading = !isCutoff
        ? `⚠ Tie-break required — ${roundLabelOf(key) ? `${roundLabelOf(key)} · ` : ''}Room ${roomLetter(tie.rm)} (score ${tie.score})`
        : cutoffTieHeading(key, tie, boundaryText, cutoffValue, afterSwiss);
      return (
        <div
          className={cn(
            'mb-4.5 flex flex-wrap items-center justify-between gap-2.5 rounded-xs px-4 py-3 outline-2',
            isCutoff ? 'bg-warning/10 outline-warning/55' : 'bg-danger/12 outline-danger/55',
          )}
          key={key}
        >
          <div>
            <div
              className={cn(
                'text-base font-bold',
                isCutoff ? 'text-cfp-orange-text' : 'text-cfp-danger-text',
              )}
            >
              {heading}
            </div>
            <div className='mt-1 text-[13px] text-cfp-text-soft'>
              {resolved.length
                ? `Ranked so far: ${resolved.map((name) => unitDisplay(state, name).label).join(' > ')} — `
                : ''}
              tied: {tie.players.map((player) => tiedLabel(player.name)).join(', ')} —{' '}
              {isExitTie ? 'pick who goes through' : 'pick who ranks next'}
              {canShare ? ', or share points' : ''}
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
                {unitDisplay(state, player.name).label} {isExitTie ? 'goes through' : 'ranks next'}
              </Button>
            ))}
            {canShare ? (
              <Button
                size='sm'
                onClick={() =>
                  app.updateState((current) =>
                    shareTiedPoints(
                      current,
                      key,
                      remaining.map((player) => player.name),
                    ),
                  )
                }
              >
                Share points
              </Button>
            ) : null}
          </ButtonRow>
        </div>
      );
    });
}
