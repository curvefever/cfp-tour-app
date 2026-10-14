import { unitDisplay } from '../../domain/tournament/roster';
import { setFinalScore } from '../../domain/tournament/mutations';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { CommitScoreInput, ScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { bracketRowBase, rowSurfaceClasses } from '../tournament/components/result-row';
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

/** The score inputs of one unit for the game being entered: one per member, or one for the unit. */
function FinalScoreEntry({
  activeTab,
  inputsPerTeam,
  name,
  roundIndex,
  state,
  team,
}: {
  activeTab: number;
  inputsPerTeam: number | undefined;
  name: string;
  roundIndex: number;
  state: TournamentState;
  team: TournamentTeam | undefined;
}) {
  const app = useTournamentApp();
  return (
    <div className='mt-1 flex flex-wrap items-center gap-1.5'>
      <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
      {inputsPerTeam ? (
        <TeamScoreFields>
          {Array.from({ length: inputsPerTeam }, (_, memberIndex) => {
            const member = team?.members?.[memberIndex];
            if (!member) {
              return <ScoreInput className={compactScoreClass} disabled key={memberIndex} placeholder='—' />;
            }
            const key = `game${activeTab}-${name}-m${memberIndex}`;
            return (
              <label key={key}>
                <span>{memberLabel(state, name, roundIndex, memberIndex, member.name)}</span>
                <CommitScoreInput
                  className={compactScoreClass}
                  min='0'
                  step={1}
                  value={String(state.finalScores[key] ?? '')}
                  onCommit={(value) => app.updateState((current) => setFinalScore(current, key, value))}
                />
              </label>
            );
          })}
        </TeamScoreFields>
      ) : (
        <FinalUnitScoreInput scoreKey={`game${activeTab}-${name}`} state={state} />
      )}
    </div>
  );
}

/** The Final's header row: PLAYER, one column per game, then the total (or the games won in the race Grand Final). */
export function FinalHeaderRow({ games, isGrandFinal }: { games: number; isGrandFinal: boolean }) {
  return (
    <div className='flex h-6 items-center gap-2 px-3 text-[11px] font-extrabold tracking-[0.08em] text-cfp-text-dim'>
      <span className='w-4.5 shrink-0' />
      <span className='flex-1'>PLAYER</span>
      {Array.from({ length: games }, (_, game) => (
        <span className='w-9.5 shrink-0 text-right' key={game}>
          G{game + 1}
        </span>
      ))}
      <span className='w-12 shrink-0 text-right'>{isGrandFinal ? 'WINS' : 'TOTAL'}</span>
    </div>
  );
}

export interface FinalRowProps {
  state: TournamentState;
  roundIndex: number;
  name: string;
  index: number;
  /** Every game is scored: places show, and the winner is marked. */
  complete: boolean;
  perGame: Array<number | null>;
  /** The cumulative score, or the games won in the race Grand Final. */
  total: number;
  isGrandFinal: boolean;
  followed: boolean;
  manual: boolean;
  teamSize: number;
  team: TournamentTeam | undefined;
  /** Admin entry: the game being entered (0 on the Total tab, where nothing is entered). */
  entryGame: number;
  entryAnonymous: boolean;
  inputsPerTeam: number | undefined;
}

/** One unit's row of the Final: place, name, the score of each game, the total and, for admins, the score inputs. */
export function FinalRow(props: FinalRowProps) {
  const { state, roundIndex, name, index, complete, perGame, total, isGrandFinal, followed, manual } = props;
  const { teamSize, team, entryGame, entryAnonymous, inputsPerTeam } = props;
  const winner = complete && index === 0;
  return (
    <div className={cn(bracketRowBase, 'min-h-9.5', rowSurfaceClasses(index, followed))}>
      <div className='flex items-center gap-2'>
        <span className='w-4.5 shrink-0 text-sm font-bold text-muted' title={winner ? 'Winner' : undefined}>
          {winner ? '🏆' : complete ? index + 1 : null}
        </span>
        <span className='flex min-w-0 flex-1 flex-col gap-px'>
          <span className='truncate text-base font-bold'>
            {unitDisplay(state, name).label}
            {manual ? <ManualMarker /> : null}
          </span>
          {teamSize && !inputsPerTeam ? (
            <TeamMembers name={name} roundIndex={roundIndex} state={state} />
          ) : null}
        </span>
        {perGame.map((score, game) => (
          <span className='w-9.5 shrink-0 text-right text-sm text-muted' key={game}>
            {score === null ? '—' : score}
          </span>
        ))}
        <span
          className='w-12 shrink-0 text-right text-[17px] font-extrabold'
          title={isGrandFinal ? 'Games won' : 'Cumulative Final score'}
        >
          {total}
        </span>
      </div>
      {entryGame > 0 && entryAnonymous ? (
        <div className='mt-1 text-[0.68rem] text-warning'>Scored anonymously — see side panel →</div>
      ) : null}
      {entryGame > 0 && !entryAnonymous ? (
        <FinalScoreEntry
          activeTab={entryGame}
          inputsPerTeam={inputsPerTeam}
          name={name}
          roundIndex={roundIndex}
          state={state}
          team={team}
        />
      ) : null}
    </div>
  );
}
