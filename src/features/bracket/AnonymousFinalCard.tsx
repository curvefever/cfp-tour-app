import { anonymousFinalsProgressState, isPlainFinalFullyScored } from '../../domain/tournament/finals';
import { connectAnonymousFinalist, setFinalScore } from '../../domain/tournament/mutations';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { Button, CommitScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { roomRowClass, rowSurfaceClasses } from '../tournament/components/result-row';
import { compactScoreClass } from './ScoreFields';

/**
 * A sibling box to the Final's own column, one per Final round that has ever had a game flagged anonymous --
 * shows each placeholder alias's score strip (and, if editable, its live score-entry field for the currently
 * selected game), plus a "Connect & Reveal" action once every game is actually filled (real or placeholder).
 * realKey/the real name stays hidden (anonymousFinalsProgressState's own gate, not just a display choice here)
 * until that specific alias has been connected.
 */
export function AnonymousFinalCard({
  state,
  roundIndex,
  round,
  editable,
  activeTab,
}: {
  state: TournamentState;
  roundIndex: number;
  round: TournamentRound;
  editable: boolean;
  activeTab: number;
}) {
  const app = useTournamentApp();
  const progress = anonymousFinalsProgressState(state, round);
  if (progress.length === 0) return null;
  const readyToConnect = isPlainFinalFullyScored(state, roundIndex, round);
  const anonymousGames = round.anonymousGames ?? [];
  return (
    <div className='w-82.5 min-w-82.5 shrink-0 rounded-xs bg-cfp-game-deep outline-2 outline-cfp-game-frame'>
      <div className='flex h-8.5 items-center bg-cfp-game-fold pl-3 text-base font-semibold tracking-[0.04em] uppercase'>
        🎭 Anonymous matches
      </div>
      {progress.map((entry, index) => (
        <div className={cn(roomRowClass, rowSurfaceClasses(index, false))} key={entry.alias}>
          <div className='flex items-center gap-2'>
            <span className='min-w-0 flex-1 wrap-break-word text-[15px] font-semibold'>
              {entry.connected && entry.realKey
                ? `${entry.alias} → ${unitDisplay(state, entry.realKey).label}`
                : entry.alias}
            </span>
            {anonymousGames.map((game) => {
              const score = entry.perGame[game] ?? null;
              return (
                <span className='w-9.5 shrink-0 text-right text-sm text-muted' key={game}>
                  G{game} {score === null ? '—' : <b className='text-foreground'>{score}</b>}
                </span>
              );
            })}
          </div>
          {editable && !entry.connected && anonymousGames.includes(activeTab) ? (
            <div className='mt-1 flex flex-wrap items-center gap-1.5'>
              <span className='text-[13px] text-muted'>G{activeTab}</span>
              <CommitScoreInput
                className={compactScoreClass}
                min='0'
                step={1}
                value={String(state.finalScores[`game${activeTab}-${entry.alias}`] ?? '')}
                onCommit={(value) =>
                  app.updateState((current) =>
                    setFinalScore(current, `game${activeTab}-${entry.alias}`, value),
                  )
                }
              />
            </div>
          ) : null}
          {editable && !entry.connected && readyToConnect ? (
            <Button
              className='mt-1'
              onClick={() => app.updateState((current) => connectAnonymousFinalist(current, entry.alias))}
              size='sm'
              variant='warning'
            >
              🔓 Connect & reveal
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
