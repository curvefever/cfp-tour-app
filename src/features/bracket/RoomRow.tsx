import type { ReactNode } from 'react';
import { unitDisplay } from '../../domain/tournament/roster';
import { getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { Badge, ScoreInput, cn } from '../../components/ui';
import { LuckyStar } from '../tournament/components/LuckyStar';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { type RowResult, bracketRowBase, rowSurfaceClasses } from '../tournament/components/result-row';
import { ManualMarker } from './RowMarks';
import {
  BracketScoreInput,
  TeamMembers,
  TeamScoreFields,
  UnitScoreFields,
  compactScoreClass,
} from './ScoreFields';
import { memberLabel } from './team-member-line';

const markClassName = 'ml-0.5 px-1.5 py-px text-[0.6rem]';

/** One row of a room card: place, result stripe, name with its marks, and the score (or the score inputs). */
function RowLine({
  children,
  place,
  result,
}: {
  children: ReactNode;
  place: number | null;
  result: RowResult;
}) {
  return (
    <div className='flex items-center gap-2'>
      <span className='w-4.5 shrink-0 text-sm font-bold text-muted'>{place}</span>
      <ResultStripe result={result} />
      {children}
    </div>
  );
}

/** The name, then the marks that follow it (lucky star, set-by-organiser hand, tie-break marks). */
function NameWithMarks({
  children,
  manual,
  pendingTie,
  resolvedTie,
  star,
  title,
}: {
  children: ReactNode;
  manual: boolean;
  pendingTie: boolean;
  resolvedTie: boolean;
  star: 'lucky' | 'candidate' | null;
  title?: string;
}) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      <span className='truncate text-base font-bold' title={title}>
        {children}
      </span>
      {star ? <LuckyStar candidate={star === 'candidate'} /> : null}
      {manual ? <ManualMarker /> : null}
      {resolvedTie ? (
        <Badge className={markClassName} tone='warning'>
          ⚖ TB
        </Badge>
      ) : null}
      {pendingTie ? (
        <Badge className={markClassName} tone='danger'>
          ⚠ TB?
        </Badge>
      ) : null}
    </span>
  );
}

/** A lone unit of a room: no opponent, so no score and no result. */
export function LoneUnitRow({
  followed,
  name,
  state,
}: {
  followed: boolean;
  name: string;
  state: TournamentState;
}) {
  const label = unitDisplay(state, name).label;
  return (
    <div className={cn(bracketRowBase, 'min-h-9.5', rowSurfaceClasses(0, followed))}>
      <RowLine place={null} result=''>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-base font-bold' title={label}>
            {label}
          </span>
          <span className='text-sm text-muted'>No opponent — treated as a bye, no score needed</span>
        </span>
      </RowLine>
    </div>
  );
}

export interface RoomRowProps {
  state: TournamentState;
  roundIndex: number;
  room: number;
  /** Seat in the room (the score keys use it). */
  position: number;
  name: string;
  /** The row's place in the room's order (0-based), for the alternating ground. */
  index: number;
  score: number | null;
  result: RowResult;
  star: 'lucky' | 'candidate' | null;
  /** The room is complete: places, scores and tie marks show. */
  showResults: boolean;
  rowsEditable: boolean;
  followed: boolean;
  manual: boolean;
  pendingTie: boolean;
  resolvedTie: boolean;
  /** A pooling room of a counted round shows what each place earned: undefined without the column, null until earned. */
  points?: number | null;
  /** The team behind a team row, to label its member inputs. */
  team: TournamentTeam | undefined;
  teamSize: number;
  /** Member inputs shown per team while the row is editable (null: one input per team, or none). */
  inputsPerTeam: number | undefined;
  /** Whether the format scores each member (then the inputs are per member, not per team). */
  memberInputs: number | undefined;
  games: number;
}

/** The score inputs of an editable team row: one per member (and per game), then the total. */
function MemberInputs({ props, count }: { props: RoomRowProps; count: number }) {
  const { state, roundIndex, room, position, name, team, games } = props;
  return (
    <TeamScoreFields>
      {Array.from({ length: count }, (_, memberIndex) => {
        const member = team?.members?.[memberIndex];
        if (!member) {
          return <ScoreInput key={memberIndex} className={compactScoreClass} disabled placeholder='—' />;
        }
        const label = <span>{memberLabel(state, name, roundIndex, memberIndex, member.name)}</span>;
        if (games <= 1) {
          const key = `r${roundIndex}-rm${room}-p${position}-m${memberIndex}`;
          return (
            <label key={key}>
              {label}
              <BracketScoreInput state={state} scoreKey={key} roundIndex={roundIndex} room={room} />
            </label>
          );
        }
        return (
          <label key={memberIndex}>
            {label}
            {Array.from({ length: games }, (_, gameIndex) => {
              const key = `r${roundIndex}-rm${room}-p${position}-g${gameIndex + 1}-m${memberIndex}`;
              return (
                <BracketScoreInput
                  className={compactScoreClass}
                  key={key}
                  room={room}
                  roundIndex={roundIndex}
                  scoreKey={key}
                  state={state}
                />
              );
            })}
          </label>
        );
      })}
      {games > 1 ? (
        <span className='text-sm font-bold text-foreground'>
          Total {getUnitScore(state, roundIndex, room, position, 0)}
        </span>
      ) : null}
    </TeamScoreFields>
  );
}

export function RoomRow(props: RoomRowProps) {
  const { state, roundIndex, room, position, name, index, score, result, star, showResults, rowsEditable } =
    props;
  const { followed, manual, pendingTie, resolvedTie, teamSize, inputsPerTeam } = props;
  const { memberInputs, games } = props;
  const label = teamSize ? unitDisplay(state, name).label : name;
  const pointsColumn = props.points !== undefined;
  const scoreText = showResults ? (
    <span
      className={cn(
        'ml-auto flex shrink-0 items-center justify-end text-[17px] font-extrabold',
        pointsColumn && 'w-11.5',
      )}
    >
      {score}
    </span>
  ) : pointsColumn ? (
    <span className='ml-auto w-11.5 shrink-0' />
  ) : null;
  // A single-game, non-team row takes its one input right in the line; every other editable row gets its inputs below.
  const inlineInput = rowsEditable && !teamSize && games <= 1;
  return (
    <div className={cn(bracketRowBase, 'min-h-9.5', rowSurfaceClasses(index, followed))}>
      <RowLine place={showResults ? index + 1 : null} result={result}>
        <span className='flex min-w-0 flex-1 flex-col gap-px'>
          <NameWithMarks
            manual={manual}
            pendingTie={pendingTie}
            resolvedTie={showResults && resolvedTie}
            star={star}
            title={teamSize ? undefined : name}
          >
            {label}
          </NameWithMarks>
          {teamSize && !inputsPerTeam ? (
            <TeamMembers
              name={name}
              roundIndex={roundIndex}
              seat={showResults ? { room, position } : undefined}
              state={state}
            />
          ) : null}
        </span>
        {inlineInput ? (
          <UnitScoreFields games={1} position={position} room={room} roundIndex={roundIndex} state={state} />
        ) : (
          scoreText
        )}
        {pointsColumn ? (
          <span className='w-9 shrink-0 text-right text-[15px] font-bold text-cfp-sky'>
            {props.points === null || props.points === undefined ? null : `+${props.points}`}
          </span>
        ) : null}
      </RowLine>
      {inputsPerTeam ? <MemberInputs count={inputsPerTeam} props={props} /> : null}
      {rowsEditable && !inlineInput && !memberInputs ? (
        <div className='mt-1 flex'>
          <UnitScoreFields
            games={games}
            position={position}
            room={room}
            roundIndex={roundIndex}
            state={state}
          />
        </div>
      ) : null}
    </div>
  );
}
