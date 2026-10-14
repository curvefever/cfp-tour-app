import {
  anonymousFinalsProgressState,
  finalsProgressState,
  isPlainFinalFullyScored,
} from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import {
  connectAnonymousFinalist,
  flagFinalGameAnonymous,
  setFinalScore,
  unflagFinalGameAnonymous,
} from '../../domain/tournament/mutations';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { Button, CommitScoreInput, ScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { bracketRowBase } from '../tournament/components/result-row';
import { roundColumnWidthClass } from './BracketRounds';
import { ManualMarker } from './RowMarks';
import { TeamMembers, TeamScoreFields, compactScoreClass } from './ScoreFields';
import { memberLabel } from './team-member-line';

/** The Final's score input for one unit that takes a single score per game. */
function FinalUnitScoreInput({ state, scoreKey }: { state: TournamentState; scoreKey: string }) {
  const app = useTournamentApp();
  return (
    <CommitScoreInput
      className={compactScoreClass}
      min='0'
      step={1}
      value={String(state.finalScores[scoreKey] ?? '')}
      onCommit={(value) => app.updateState((current) => setFinalScore(current, scoreKey, value))}
    />
  );
}

export function FinalColumn({
  state,
  roundIndex,
  editable,
  followed,
  tab,
  onTabChange,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followed: string | null;
  tab: number;
  onTabChange: (tab: number) => void;
}) {
  const app = useTournamentApp();
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  const progress = finalsProgressState(state, roundIndex, round);
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const memberInputs = scoredTeamSize(state);
  const teamMap = buildTeamMap(state);
  const games = round.numGames ?? 1;
  const activeTab = Math.min(tab, games);
  const canFlagAnonymous =
    !teamSize &&
    round.bracket !== 'grand-final' &&
    activeTab > 0 &&
    !(round.anonymousGames ?? []).includes(activeTab) &&
    assignments.every(
      (assignment) =>
        progress.units.find((unit) => unit.name === assignment.name)?.perGame[activeTab - 1] == null,
    );
  const isActiveGameAnonymous = (round.anonymousGames ?? []).includes(activeTab);
  const inputsPerTeam = editable && tab !== 0 && !isActiveGameAnonymous ? memberInputs : undefined;
  const names = progress.complete
    ? progress.order.filter((name): name is string => Boolean(name))
    : assignments.map((entry) => entry.name);
  return (
    <>
      {progress.race ? (
        <div className='mb-2 text-xs leading-relaxed text-muted'>
          <span className='text-primary'>{unitDisplay(state, progress.race.wbName).label}</span>{' '}
          <b>{progress.race.wbWins}</b>/{progress.race.wbTarget} <span className='opacity-50'>·</span>{' '}
          <span className='text-warning'>{unitDisplay(state, progress.race.lbName).label}</span>{' '}
          <b>{progress.race.lbWins}</b>/{progress.race.lbTarget}{' '}
          {progress.race.decided ? (
            <span className='font-semibold text-success'>
              🏆 {unitDisplay(state, progress.race.winnerName as string).label} wins
            </span>
          ) : null}
        </div>
      ) : null}
      {editable && games > 1 ? (
        <div className='mb-1.5 flex flex-wrap gap-1'>
          {Array.from({ length: games }, (_, index) => (
            <Button
              key={index}
              size='sm'
              className={cn(
                'px-1.5 py-0.5 text-[0.68rem]',
                activeTab === index + 1 && tab !== 0 && 'border-primary bg-primary-soft text-primary',
                (round.anonymousGames ?? []).includes(index + 1) && 'border-warning text-warning',
              )}
              onClick={() => onTabChange(index + 1)}
            >
              G{index + 1}
            </Button>
          ))}
          <Button
            size='sm'
            className={cn(
              'px-1.5 py-0.5 text-[0.68rem]',
              tab === 0 && 'border-primary bg-primary-soft text-primary',
            )}
            onClick={() => onTabChange(0)}
          >
            📊 Total
          </Button>
        </div>
      ) : null}
      {editable && tab !== 0 ? (
        <div className='mb-1 flex flex-wrap items-center gap-1.5'>
          <span className='text-[0.68rem] font-semibold tracking-[0.05em] text-primary uppercase'>
            Game {activeTab} — enter scores
          </span>
          {canFlagAnonymous || isActiveGameAnonymous ? (
            <Button
              size='sm'
              className={cn(
                'px-1.5 py-0.5 text-[0.65rem]',
                isActiveGameAnonymous && 'border-warning text-warning',
              )}
              onClick={() =>
                app.updateState((current) =>
                  isActiveGameAnonymous
                    ? unflagFinalGameAnonymous(current, activeTab)
                    : flagFinalGameAnonymous(current, activeTab),
                )
              }
            >
              {isActiveGameAnonymous ? '🎭 Anonymous — click to undo' : '🎭 Make anonymous'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {names.map((name, index) => {
        const unit = progress.units.find((entry) => entry.name === name);
        if (!unit) return null;
        const winner = progress.complete && index === 0;
        const team = teamMap[name];
        return (
          <div
            className={cn(
              bracketRowBase,
              progress.complete && 'border-l-success text-success',
              followed === name && 'bg-primary-soft shadow-[inset_0_0_0_1px_var(--app-primary-ring)]',
            )}
            key={name}
          >
            <div className='flex items-center gap-1.5'>
              <span className='min-w-0 flex-1'>
                {winner ? '🏆 ' : ''}
                {unitDisplay(state, name).label}
                {assignments.find((entry) => entry.name === name)?.manual ? <ManualMarker /> : null}
              </span>
              <span
                className={cn('text-xs font-bold text-muted', winner && 'text-primary')}
                title={progress.isGrandFinal ? 'Games won' : 'Cumulative Final score'}
              >
                {progress.isGrandFinal ? unit.wins : unit.total}
              </span>
            </div>
            {teamSize && !inputsPerTeam ? (
              <TeamMembers state={state} name={name} roundIndex={roundIndex} />
            ) : null}
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {unit.perGame.map((score, game) => (
                <span className={score === null ? 'opacity-50' : ''} key={game}>
                  G{game + 1} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                </span>
              ))}
            </div>
            {editable && tab !== 0 && isActiveGameAnonymous ? (
              <div className='mt-1 text-[0.68rem] text-warning'>Scored anonymously — see side panel →</div>
            ) : null}
            {editable && tab !== 0 && !isActiveGameAnonymous ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
                {inputsPerTeam ? (
                  <TeamScoreFields>
                    {Array.from({ length: inputsPerTeam }, (_, memberIndex) => {
                      const member = team?.members?.[memberIndex];
                      if (!member)
                        return (
                          <ScoreInput
                            key={memberIndex}
                            className={compactScoreClass}
                            disabled
                            placeholder='—'
                          />
                        );
                      const key = `game${activeTab}-${name}-m${memberIndex}`;
                      return (
                        <label key={key}>
                          <span>{memberLabel(state, name, roundIndex, memberIndex, member.name)}</span>
                          <CommitScoreInput
                            className={compactScoreClass}
                            min='0'
                            step={1}
                            value={String(state.finalScores[key] ?? '')}
                            onCommit={(value) =>
                              app.updateState((current) => setFinalScore(current, key, value))
                            }
                          />
                        </label>
                      );
                    })}
                  </TeamScoreFields>
                ) : (
                  <FinalUnitScoreInput state={state} scoreKey={`game${activeTab}-${name}`} />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * A sibling box to the Final's own RoundColumn, one per Final round that has
 * ever had a game flagged anonymous -- shows each placeholder alias's score
 * strip (and, if editable, its live score-entry field for the currently
 * selected game), plus a "Connect & Reveal" action once every game is
 * actually filled (real or placeholder). realKey/the real name stays hidden
 * (anonymousFinalsProgressState's own gate, not just a display choice here)
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
    <div
      className={cn(
        roundColumnWidthClass(),
        'overflow-hidden rounded-lg border border-warning/40 bg-surface',
      )}
    >
      <div className='flex w-full items-center gap-1 border-b border-surface-hover bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-warning uppercase'>
        🎭 Anonymous matches
      </div>
      <div className='p-2.5'>
        {progress.map((entry) => (
          <div className={bracketRowBase} key={entry.alias}>
            <div className='flex items-center gap-1.5'>
              <span className='min-w-0 flex-1 truncate'>
                {entry.connected && entry.realKey
                  ? `${entry.alias} → ${unitDisplay(state, entry.realKey).label}`
                  : entry.alias}
              </span>
            </div>
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {anonymousGames.map((game) => {
                const score = entry.perGame[game] ?? null;
                return (
                  <span className={score === null ? 'opacity-50' : ''} key={game}>
                    G{game} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                  </span>
                );
              })}
            </div>
            {editable && !entry.connected && anonymousGames.includes(activeTab) ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
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
                size='sm'
                className='mt-1 border-warning px-1.5 py-0.5 text-[0.65rem] text-warning'
                onClick={() => app.updateState((current) => connectAnonymousFinalist(current, entry.alias))}
              >
                🔓 Connect & reveal
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
