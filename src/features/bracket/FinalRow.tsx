import { unitDisplay } from '../../domain/tournament/roster';
import { setFinalScore } from '../../domain/tournament/mutations';
import { finalScoreKey, scoredMemberSlots } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { CommitScoreInput, ScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { roomRowClass, rowSurfaceClasses } from '../tournament/components/result-row';
import { ManualMarker } from './RowMarks';
import { TeamMembers, TeamScoreFields, compactScoreClass } from './ScoreFields';
import type { GameColumn } from '../../domain/tournament/game-columns';
import { stickyEndClass, stickyLeadClass } from './game-columns';
import { GameCells } from './GameScores';
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

/**
 * The score inputs of one unit for the game being entered: one per member when every member takes a score (Sum of
 * members), else one box for the unit, on the defender's slot in Save your Buddy (`slots`: the slots that take a score).
 */
function FinalScoreEntry({
  activeTab,
  everyMemberHasBox,
  name,
  roundIndex,
  slots,
  state,
  team,
}: {
  activeTab: number;
  everyMemberHasBox: boolean;
  name: string;
  roundIndex: number;
  slots: number[];
  state: TournamentState;
  team: TournamentTeam | undefined;
}) {
  const app = useTournamentApp();
  const defenderSlot = everyMemberHasBox ? undefined : slots[0];
  return (
    <div className='mt-1 flex flex-wrap items-center gap-1.5'>
      <span className='text-[13px] text-muted'>G{activeTab}</span>
      {everyMemberHasBox ? (
        <TeamScoreFields>
          {slots.map((memberIndex) => {
            const member = team?.members?.[memberIndex];
            if (!member) {
              return <ScoreInput className={compactScoreClass} disabled key={memberIndex} placeholder='—' />;
            }
            const key = finalScoreKey(activeTab, name, memberIndex);
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
      ) : defenderSlot !== undefined && !team?.members?.[defenderSlot] ? (
        <ScoreInput className={compactScoreClass} disabled placeholder='—' />
      ) : (
        <FinalUnitScoreInput scoreKey={finalScoreKey(activeTab, name, defenderSlot)} state={state} />
      )}
    </div>
  );
}

export interface FinalRowProps {
  state: TournamentState;
  roundIndex: number;
  name: string;
  index: number;
  /** Every game is scored: the places show. */
  complete: boolean;
  perGame: Array<number | null>;
  /** The columns of the table: a game each, then the games not played in one. */
  columns: GameColumn[];
  /** The cumulative score, or the games won in the race Grand Final or a Best of. */
  total: number;
  showsWins: boolean;
  /** The game being entered is not needed: a Best-of Final already decided. */
  entryNotNeeded: boolean;
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
  const { state, roundIndex, name, index, complete, perGame, total, showsWins, followed, manual } = props;
  const { columns } = props;
  const { teamSize, team, entryGame, entryAnonymous, entryNotNeeded, inputsPerTeam } = props;
  // A box for every member takes the member line's place; Save your Buddy has one box, the defender's, like One score per team.
  const slots = inputsPerTeam ? scoredMemberSlots(state, name, roundIndex, inputsPerTeam) : [];
  const everyMemberHasBox = Boolean(inputsPerTeam) && slots.length === inputsPerTeam;
  return (
    <div className={cn(roomRowClass, rowSurfaceClasses(index, followed))}>
      <div className='flex items-center gap-2 bg-inherit'>
        <div className={cn('flex min-w-0 flex-1 items-center gap-2', stickyLeadClass)}>
          <span className='w-4.5 shrink-0 text-[13px] font-bold text-muted'>
            {complete ? index + 1 : null}
          </span>
          <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <span className='wrap-break-word text-[15px] font-semibold'>
              {unitDisplay(state, name).label}
              {manual ? <ManualMarker /> : null}
            </span>
            {teamSize && !everyMemberHasBox ? (
              <TeamMembers name={name} roundIndex={roundIndex} state={state} />
            ) : null}
          </span>
        </div>
        <GameCells columns={columns} scores={perGame} />
        <span
          className={cn('w-12 text-right text-[15px] font-extrabold', stickyEndClass)}
          title={showsWins ? 'Games won' : 'Cumulative Final score'}
        >
          {total}
        </span>
      </div>
      {entryGame > 0 && entryAnonymous ? (
        <div className='mt-1 text-[0.68rem] text-warning'>Scored anonymously — see side panel →</div>
      ) : null}
      {entryGame > 0 && entryNotNeeded ? (
        <div className='mt-1 text-[13px] text-muted'>G{entryGame} not needed — the match is decided</div>
      ) : null}
      {entryGame > 0 && !entryAnonymous && !entryNotNeeded ? (
        <FinalScoreEntry
          activeTab={entryGame}
          everyMemberHasBox={everyMemberHasBox}
          name={name}
          roundIndex={roundIndex}
          slots={slots}
          state={state}
          team={team}
        />
      ) : null}
    </div>
  );
}
