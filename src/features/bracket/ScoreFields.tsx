import { type ReactNode } from 'react';
import { setRoundScore } from '../../domain/tournament/mutations';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { getDefenderIndex, getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { CommitScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

export const compactScoreClass = 'w-13 shrink-0 rounded-sm px-1.5 py-0.5 text-xs';

export function memberLabel(
  state: TournamentState,
  name: string,
  roundIndex: number,
  rawIndex: number,
  memberName: string,
) {
  const defender =
    state.gamemodeConfig.teamScoringRule === 'designated-player' &&
    getDefenderIndex(state, name, roundIndex) === rawIndex;
  return `${memberName}${defender ? ' 🛡' : ''}`;
}

export function TeamMembers({
  state,
  name,
  roundIndex,
}: {
  state: TournamentState;
  name: string;
  roundIndex: number;
}) {
  const info = unitDisplay(state, name);
  const team = buildTeamMap(state)[name];
  if (!info.members?.length) return null;
  return (
    <span className='mt-0.5 block text-[0.68rem] text-muted [overflow-wrap:anywhere]'>
      {info.members
        .map((member, index) => {
          const rawIndex = team?.members.findIndex((entry) => entry?.name === member) ?? index;
          return memberLabel(state, name, roundIndex, rawIndex, member);
        })
        .join(', ')}
    </span>
  );
}

export function BracketScoreInput({
  state,
  scoreKey,
  roundIndex,
  room,
  className = cn(compactScoreClass, 'ml-auto'),
}: {
  state: TournamentState;
  scoreKey: string;
  roundIndex: number;
  room: number;
  className?: string;
}) {
  const app = useTournamentApp();
  return (
    <CommitScoreInput
      className={className}
      min='0'
      step={1}
      value={String(state.scores[scoreKey] ?? '')}
      data-key={scoreKey}
      onCommit={(value) =>
        app.updateState((current) => setRoundScore(current, scoreKey, value, roundIndex, room))
      }
    />
  );
}

export function TeamScoreFields({ children }: { children: ReactNode }) {
  return (
    <div className='mt-1 flex flex-wrap gap-1.5 [&>label]:flex [&>label]:items-center [&>label]:gap-1 [&>label]:text-[0.68rem] [&>label]:text-muted'>
      {children}
    </div>
  );
}

/** The score inputs of one unit that takes a single score per game: one input, or G1..Gn plus a total. */
export function UnitScoreFields({
  state,
  roundIndex,
  room,
  position,
  games,
}: {
  state: TournamentState;
  roundIndex: number;
  room: number;
  position: number;
  games: number;
}) {
  const key = `r${roundIndex}-rm${room}-p${position}`;
  if (games <= 1)
    return <BracketScoreInput state={state} scoreKey={key} roundIndex={roundIndex} room={room} />;
  return (
    <TeamScoreFields>
      {Array.from({ length: games }, (_, gameIndex) => {
        const gameKey = `${key}-g${gameIndex + 1}`;
        return (
          <label key={gameKey}>
            <span>G{gameIndex + 1}</span>
            <BracketScoreInput
              state={state}
              scoreKey={gameKey}
              roundIndex={roundIndex}
              room={room}
              className={compactScoreClass}
            />
          </label>
        );
      })}
      <span className='text-[0.68rem] font-bold text-foreground'>
        Total {getUnitScore(state, roundIndex, room, position, 0)}
      </span>
    </TeamScoreFields>
  );
}
