import type { ReactNode } from 'react';
import { unitDisplay } from '../../domain/tournament/roster';
import { unneededGames } from '../../domain/tournament/match-format';
import { formatStandingValue } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { Badge, ScoreInput, cn } from '../../components/ui';
import { LuckyStar } from '../tournament/components/LuckyStar';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { type RowResult, roomRowClass, rowSurfaceClasses } from '../tournament/components/result-row';
import { ManualMarker } from './RowMarks';
import {
  BracketScoreInput,
  NotNeededNote,
  TeamMembers,
  TeamScoreFields,
  UnitScoreFields,
  compactScoreClass,
} from './ScoreFields';
import { GameColumns, GameScoresLine } from './GameScores';
import { type GameScoreLayout, roomGameScores, unitScoreSummary, winsSoFar } from './room-row-inputs';
import { memberLabel } from './team-member-line';

const markClassName = 'ml-0.5 px-1.5 py-px text-[0.6rem]';

/**
 * How a row's stripe sits: fixed beside a score input, or growing with the text. The margin leaves the usual 18 px
 * beside one 20 px line, or beside a team name and its member line (20 + 2 + 20 px); wrapped lines lengthen it.
 */
type StripeFit = 'fixed' | 'line' | 'member-line';

const STRIPE_MARGIN: Record<Exclude<StripeFit, 'fixed'>, string> = { line: 'my-px', 'member-line': 'my-3' };

/** A place as the row slot shows it: "2", or "=2" when shared. */
function placeLabel(place: number, shared: boolean): string {
  return shared ? `=${place}` : String(place);
}

/** One row of a room card: place, result stripe, name with its marks, and the score (or the score inputs). */
function RowLine({
  children,
  place,
  result,
  stripe = 'line',
}: {
  children: ReactNode;
  place: string | null;
  result: RowResult;
  stripe?: StripeFit;
}) {
  return (
    <div className='flex items-center gap-2'>
      <span className='w-4.5 shrink-0 text-[13px] font-bold text-muted'>{place}</span>
      <ResultStripe
        className={stripe === 'fixed' ? undefined : STRIPE_MARGIN[stripe]}
        compact
        result={result}
        stretch={stripe !== 'fixed'}
      />
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
}: {
  children: ReactNode;
  manual: boolean;
  pendingTie: boolean;
  resolvedTie: boolean;
  star: 'lucky' | 'candidate' | null;
}) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      <span className='min-w-0 wrap-break-word text-[15px] font-semibold'>{children}</span>
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
    <div className={cn(roomRowClass, rowSurfaceClasses(0, followed))}>
      <RowLine place={null} result=''>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='wrap-break-word text-[15px] font-semibold'>{label}</span>
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
  /** The row's place in the room (null until the room is complete). */
  place: number | null;
  /** Another unit on the same score shares the place. */
  sharedPlace: boolean;
  score: number | null;
  /** The unit was absent from the room: "ABS" takes the place of its score. */
  absent: boolean;
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
  /** How the row shows each game's score (none while its boxes show them, or in a single-game room). */
  gameLayout: GameScoreLayout;
}

/** The score inputs of an editable team row: one per member (and per game), then the total. */
function MemberInputs({ props, count }: { props: RoomRowProps; count: number }) {
  const { state, roundIndex, room, position, name, team, games } = props;
  const notNeeded = unneededGames(state, roundIndex, room);
  const summary = unitScoreSummary(state, roundIndex, room, position);
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
                  disabled={notNeeded.includes(gameIndex + 1)}
                />
              );
            })}
          </label>
        );
      })}
      {games > 1 ? (
        <span className='text-sm font-bold text-foreground'>
          {summary.label} {summary.value}
        </span>
      ) : null}
      <NotNeededNote games={notNeeded} />
    </TeamScoreFields>
  );
}

export function RoomRow(props: RoomRowProps) {
  const { state, roundIndex, room, position, name, index, score, result, star, showResults, rowsEditable } =
    props;
  const { absent } = props;
  const { place, sharedPlace } = props;
  const { followed, manual, pendingTie, resolvedTie, teamSize, inputsPerTeam } = props;
  const { memberInputs, games, gameLayout } = props;
  const unit = teamSize ? unitDisplay(state, name) : null;
  const label = unit?.label ?? name;
  const pointsColumn = props.points !== undefined;
  const gameColumns = gameLayout === 'columns';
  const gameScores =
    gameLayout !== 'none' && !absent ? roomGameScores(state, roundIndex, room, position) : null;
  // The result sits in a fixed-width column when a points column or the game columns need to line up with their header.
  const resultWidth = pointsColumn ? 'w-11.5' : gameColumns ? 'w-12' : undefined;
  // A Best-of match in progress shows the games won so far, in a lighter weight than a result.
  const playedSoFar = winsSoFar(state, roundIndex, room, position);
  const scoreText = absent ? (
    <span
      className={cn(
        'ml-auto flex shrink-0 items-center justify-end text-[13px] font-bold text-muted',
        resultWidth,
      )}
    >
      ABS
    </span>
  ) : showResults ? (
    <span
      className={cn('ml-auto flex shrink-0 items-center justify-end text-[15px] font-extrabold', resultWidth)}
    >
      {score}
    </span>
  ) : playedSoFar !== null && !rowsEditable ? (
    <span
      className={cn(
        'ml-auto flex shrink-0 items-center justify-end text-[15px] font-bold text-muted',
        resultWidth,
      )}
      title='Games won so far'
    >
      {playedSoFar}
    </span>
  ) : resultWidth ? (
    <span className={cn('ml-auto shrink-0', resultWidth)} />
  ) : null;
  // A single-game, non-team row takes its one input right in the line; every other editable row gets its inputs below.
  const inlineInput = rowsEditable && !teamSize && games <= 1;
  // The member line shows for a team with members, unless their score inputs take its place.
  const memberLine = Boolean(unit?.members?.length) && !inputsPerTeam;
  return (
    <div className={cn(roomRowClass, rowSurfaceClasses(index, followed))}>
      <RowLine
        place={showResults && place !== null ? placeLabel(place, sharedPlace) : null}
        result={result}
        stripe={inlineInput ? 'fixed' : memberLine ? 'member-line' : 'line'}
      >
        <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <NameWithMarks
            manual={manual}
            pendingTie={pendingTie}
            resolvedTie={showResults && resolvedTie}
            star={star}
          >
            {label}
          </NameWithMarks>
          {memberLine ? (
            <TeamMembers
              name={name}
              roundIndex={roundIndex}
              seat={showResults ? { room, position } : undefined}
              markSeat={{ room, position }}
              state={state}
            />
          ) : null}
          {gameLayout === 'line' && gameScores ? <GameScoresLine scores={gameScores} /> : null}
        </span>
        {gameColumns ? <GameColumns games={games} scores={gameScores} /> : null}
        {inlineInput ? (
          <UnitScoreFields games={1} position={position} room={room} roundIndex={roundIndex} state={state} />
        ) : (
          scoreText
        )}
        {pointsColumn ? (
          <span className='w-9 shrink-0 text-right text-sm font-bold text-cfp-sky'>
            {props.points === null || props.points === undefined
              ? null
              : `+${formatStandingValue(props.points)}`}
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
