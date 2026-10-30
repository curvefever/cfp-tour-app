import { finalsProgressState } from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import { unneededGames } from '../../domain/tournament/match-format';
import { flagFinalGameAnonymous, unflagFinalGameAnonymous } from '../../domain/tournament/mutations';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { FinalHeaderRow, FinalRow } from './FinalRow';
import { RoomFrame } from './RoomCard';
import { roomTitle } from './room-title';

/** The Grand Final race: who is ahead of whom, and who has won. */
function RaceLine({
  race,
  state,
}: {
  race: NonNullable<ReturnType<typeof finalsProgressState>['race']>;
  state: TournamentState;
}) {
  return (
    <div className='text-sm leading-relaxed text-muted'>
      <span className='text-primary'>{unitDisplay(state, race.wbName).label}</span> <b>{race.wbWins}</b>/
      {race.wbTarget} <span className='opacity-50'>·</span>{' '}
      <span className='text-warning'>{unitDisplay(state, race.lbName).label}</span> <b>{race.lbWins}</b>/
      {race.lbTarget}{' '}
      {race.decided ? (
        <span className='font-semibold text-success'>
          🏆 {unitDisplay(state, race.winnerName as string).label} wins
        </span>
      ) : null}
    </div>
  );
}

/** The game tabs and the Total tab (admins): the active one is the primary button, an anonymous game the warning one. */
function GameTabs({
  activeTab,
  anonymousGames,
  games,
  notNeeded,
  onTabChange,
  tab,
  totalLabel,
}: {
  activeTab: number;
  anonymousGames: number[];
  games: number;
  /** Games after the deciding game of a Best-of Final: their tabs are off. */
  notNeeded: number[];
  onTabChange: (tab: number) => void;
  tab: number;
  totalLabel: string;
}) {
  return (
    <ButtonRow className='mt-0'>
      {Array.from({ length: games }, (_, index) => (
        <Button
          disabled={notNeeded.includes(index + 1)}
          key={index}
          onClick={() => onTabChange(index + 1)}
          title={notNeeded.includes(index + 1) ? 'Not needed: the match is decided' : undefined}
          size='sm'
          variant={
            activeTab === index + 1 && tab !== 0
              ? 'primary'
              : anonymousGames.includes(index + 1)
                ? 'warning'
                : 'secondary'
          }
        >
          G{index + 1}
        </Button>
      ))}
      <Button onClick={() => onTabChange(0)} size='sm' variant={tab === 0 ? 'primary' : 'secondary'}>
        📊 {totalLabel}
      </Button>
    </ButtonRow>
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
  const teamMap = buildTeamMap(state);
  const games = round.numGames ?? 1;
  const showsWins = progress.isGrandFinal || round.bestOf !== undefined;
  const notNeeded = unneededGames(state, roundIndex, 1);
  const activeTab = Math.min(tab, games);
  const anonymousGames = round.anonymousGames ?? [];
  const isActiveGameAnonymous = anonymousGames.includes(activeTab);
  const canFlagAnonymous =
    !teamSize &&
    round.bracket !== 'grand-final' &&
    activeTab > 0 &&
    !isActiveGameAnonymous &&
    assignments.every(
      (assignment) =>
        progress.units.find((unit) => unit.name === assignment.name)?.perGame[activeTab - 1] == null,
    );
  const entering = editable && tab !== 0;
  const inputsPerTeam = entering && !isActiveGameAnonymous ? scoredTeamSize(state) : undefined;
  const names = progress.complete
    ? progress.order.filter((name): name is string => Boolean(name))
    : assignments.map((entry) => entry.name);
  return (
    <div className='flex flex-col gap-3'>
      {progress.race ? <RaceLine race={progress.race} state={state} /> : null}
      {editable && games > 1 ? (
        <GameTabs
          activeTab={activeTab}
          anonymousGames={anonymousGames}
          games={games}
          notNeeded={notNeeded}
          onTabChange={onTabChange}
          tab={tab}
          totalLabel={round.bestOf === undefined ? 'Total' : 'Wins'}
        />
      ) : null}
      {entering ? (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-xs font-extrabold tracking-[0.05em] text-primary uppercase'>
            Game {activeTab} — enter scores
          </span>
          {canFlagAnonymous || isActiveGameAnonymous ? (
            <Button
              onClick={() =>
                app.updateState((current) =>
                  isActiveGameAnonymous
                    ? unflagFinalGameAnonymous(current, activeTab)
                    : flagFinalGameAnonymous(current, activeTab),
                )
              }
              size='sm'
              variant={isActiveGameAnonymous ? 'warning' : 'secondary'}
            >
              {isActiveGameAnonymous ? '🎭 Anonymous — click to undo' : '🎭 Make anonymous'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <RoomFrame title={roomTitle(round, 0)}>
        <FinalHeaderRow games={games} showsWins={showsWins} />
        {names.map((name, index) => {
          const unit = progress.units.find((entry) => entry.name === name);
          if (!unit) return null;
          return (
            <FinalRow
              complete={progress.complete}
              entryAnonymous={isActiveGameAnonymous}
              entryGame={entering ? activeTab : 0}
              entryNotNeeded={notNeeded.includes(activeTab)}
              followed={followed === name}
              index={index}
              inputsPerTeam={inputsPerTeam}
              key={name}
              manual={Boolean(assignments.find((entry) => entry.name === name)?.manual)}
              name={name}
              perGame={unit.perGame}
              roundIndex={roundIndex}
              state={state}
              team={teamMap[name]}
              teamSize={teamSize}
              showsWins={showsWins}
              total={showsWins ? unit.wins : unit.total}
            />
          );
        })}
      </RoomFrame>
    </div>
  );
}
