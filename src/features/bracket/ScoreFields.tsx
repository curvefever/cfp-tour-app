import { type ReactNode } from 'react';
import { setRoundScore } from '../../domain/tournament/mutations';
import { getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { CommitScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { teamMemberLine } from './team-member-line';

/** A score box in a room row: compact, numbers right-aligned, a comfortable touch height on the phone. */
export const compactScoreClass = 'h-8 w-16 shrink-0 px-2 text-right text-[15px] font-bold max-[700px]:h-11';

export function TeamMembers({
  state,
  name,
  roundIndex,
  seat,
}: {
  state: TournamentState;
  name: string;
  roundIndex: number;
  /** Where the team sits, once its room is complete: each member's own score then follows the name. */
  seat?: { room: number; position: number };
}) {
  const line = teamMemberLine(state, name, roundIndex, seat ?? null);
  if (!line) return null;
  return <span className='block wrap-break-word text-sm text-muted'>{line}</span>;
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
    <div className='mt-1.5 flex flex-wrap items-center gap-2 [&>label]:flex [&>label]:items-center [&>label]:gap-1.5 [&>label]:text-[13px] [&>label]:text-muted'>
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
      <span className='text-sm font-bold text-foreground'>
        Total {getUnitScore(state, roundIndex, room, position, 0)}
      </span>
    </TeamScoreFields>
  );
}
