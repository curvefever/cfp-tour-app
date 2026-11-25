import { type ReactNode } from 'react';
import { isUncontestedRoom } from '../../domain/tournament/room-results';
import { groupSeats } from '../../domain/tournament/group-standings';
import { usesGroupAverages } from '../../domain/tournament/rule-versions';
import { type bracketRoundLabels } from '../../domain/tournament/bracket';
import { latestAbsenceRound, likelyAbsentInRound } from '../../domain/tournament/likely-absentees';
import { getGameFormat } from '../../domain/tournament/formats';
import { type RoundExitRule } from '../../domain/tournament/room-exits';
import { type buildTeamMap } from '../../domain/tournament/roster';
import { roomRows } from '../../domain/tournament/room-rows';
import { isMatchRound } from '../../domain/tournament/match-format';
import { roundMatchTag } from '../tournament/components/match-format-tag';
import { scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { cn, roomHeaderClassName } from '../../components/ui';
import { ExitIcon } from '../tournament/components/ExitIcon';
import { type ExitLine, poolingExitLines, roomExitLines } from '../tournament/components/exit-lines';
import { GamesHeader } from './GameScores';
import { roomGameColumns } from '../../domain/tournament/game-columns';
import { placesLine, type RankingRoomPlaces } from '../../domain/tournament/ranking-places';
import { roomShowsGameColumns, scrollableCardClass, scrollableRowsClass } from './game-columns';
import { LoneUnitRow, RoomRow } from './RoomRow';
import { roomRowResult } from '../../domain/tournament/room-row-result';
import { roomTitle } from '../tournament/components/room-title';
import { destinationLabel } from '../tournament/components/exit-text';
import { isRoundDone, isRoundReached } from '../../domain/tournament/round-columns';

/** The units of a group room that make its match void for the others: the absent ones, and the ones removed from the group. */
function voidingUnits(
  state: TournamentState,
  units: Array<{ name: string }>,
  absentNames: string[],
): string[] {
  const seats = groupSeats(state);
  return units.map((unit) => unit.name).filter((name) => absentNames.includes(name) || seats.isRemoved(name));
}

/** The round a likely absentee was last absent from, as the "ABS?" mark names it; undefined for any other unit. */
function absentSinceOf(
  state: TournamentState,
  roundIndex: number,
  name: string,
  likelyAbsent: Set<string>,
  labels: ReturnType<typeof bracketRoundLabels>,
): string | undefined {
  if (!likelyAbsent.has(name)) return undefined;
  const since = latestAbsenceRound(state, name, roundIndex);
  return since === null ? undefined : destinationLabel(since, labels);
}

/** The small header of a pooling room that shows points: SCORE and PTS. */
function PointsHeader({ wide }: { wide: boolean }) {
  return (
    <div className='flex h-5 items-center gap-2 px-3 text-[11px] font-extrabold tracking-[0.08em] text-cfp-text-dim'>
      <span className='w-4.5 shrink-0' />
      <span className='flex-1' />
      <span className='w-11.5 shrink-0 text-right'>SCORE</span>
      <span className={cn('shrink-0 text-right', wide ? 'w-16' : 'w-9')}>PTS</span>
    </div>
  );
}

/**
 * Whether a lone unit's room reads as "treated as a bye": true for rounds
 * whose results feed standings or plain per-room advancement (pooling,
 * no-elim warm-up, single elimination, Semis) and for Kings Valley (a lone
 * room holds its place -- neither promoted nor cut, per
 * kingsValleyRoundMoves, kings-valley.ts -- so it plays next round same
 * as an ordinary bye). Not for waterfall rounds (fixed rank bands per room)
 * or double-elimination rounds (winners/losers routing).
 */
function isByeLikeRound(round: TournamentRound): boolean {
  return !round.isWaterfall && !round.bracket && !round.isFinal;
}

/** A room's card: a header with its title (brand blue; the lighter fold ground for a room not drawn yet), then its content. */
export function RoomFrame({
  children,
  future = false,
  lines = [],
  matchTag,
  note,
  scrolls = false,
  title,
}: {
  children: ReactNode;
  future?: boolean;
  /** The round's match format ("BEST OF 3"), repeated small in the header; none for a round of one game. */
  matchTag?: string;
  /** A line under the title: the places a ranking room decides. */
  note?: string;
  /** The rows have game columns: a phone scrolls them sideways inside the card, the names fixed on the left. */
  scrolls?: boolean;
  /** Where the room's places go: shown by the arrow icon at the right of the header (no icon without lines). */
  lines?: ExitLine[];
  title: string;
}) {
  return (
    <div className='relative rounded-xs bg-surface outline-2 outline-cfp-game-frame'>
      <div
        className={cn(
          'flex h-8.5 items-center pr-1.5 pl-3',
          future ? 'bg-cfp-game-fold text-foreground' : 'bg-primary text-on-primary',
        )}
      >
        <h3 className={roomHeaderClassName}>{title}</h3>
        {matchTag ? (
          <span
            className={cn(
              'ml-2 rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-extrabold whitespace-nowrap',
              future ? 'bg-foreground/10 text-cfp-text-soft' : 'bg-on-primary/20 text-on-primary',
            )}
          >
            {matchTag}
          </span>
        ) : null}
        <span className='flex-1' />
        <ExitIcon label={`Where players go from ${title}`} lines={lines} />
      </div>
      {note ? <div className='px-3 pt-1.5 pb-0.5 text-xs font-bold text-muted'>{note}</div> : null}
      {scrolls ? (
        <div className={scrollableCardClass}>
          <div className={scrollableRowsClass}>{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function RoomCard({
  state,
  roundIndex,
  roomIndex,
  exitRule,
  rowsEditable,
  followKey,
  labels,
  luckyNames,
  resolvedTieNames,
  pendingTieNames,
  teamMap,
  points,
  resultCodes,
  rankingPlaces,
}: {
  state: TournamentState;
  roundIndex: number;
  roomIndex: number;
  exitRule: RoundExitRule;
  rowsEditable: boolean;
  followKey: string | null;
  labels: ReturnType<typeof bracketRoundLabels>;
  luckyNames: string[];
  resolvedTieNames: Set<string>;
  pendingTieNames: Set<string>;
  teamMap: ReturnType<typeof buildTeamMap>;
  /** What each unit earned in this round (a pooling round that counts), or null when the round shows no points. */
  points: Map<string, number> | null;
  /** Match-result scoring: each unit's result codes in this round, shown beside its points; null otherwise. */
  resultCodes: Map<string, string> | null;
  /** The places a ranking round's rooms decide, as Rankings numbers them; null elsewhere and until Rankings has them. */
  rankingPlaces: RankingRoomPlaces | null;
}) {
  const round = state.rounds[roundIndex];
  const room = roomIndex + 1;
  const units = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  const bands = exitRule.kind === 'per-room' ? exitRule.rooms[roomIndex] : [];
  const title = roomTitle(round, roomIndex);
  const lines =
    exitRule.kind === 'per-room'
      ? roomExitLines(bands, labels)
      : poolingExitLines(state, roundIndex, units.length);
  // Only Kings Valley has a band for a lone room ("1 stay"); roundExitRule gives every other bye-like round none here.
  if (isByeLikeRound(round) && isUncontestedRoom(state, roundIndex, room)) {
    return (
      <RoomFrame lines={lines} title={title}>
        <LoneUnitRow
          followed={followKey === units[0].name}
          name={units[0].name}
          note={
            round.isGroupStage && usesGroupAverages(state)
              ? 'No opponent — the match is void, no score needed'
              : undefined
          }
          state={state}
        />
      </RoomFrame>
    );
  }
  const reached = isRoundReached(state, roundIndex);
  const { rows, complete } = roomRows(state, roundIndex, room, { ordered: reached });
  const showResults = reached && complete;
  const absentNames = rows.filter((row) => row.absent).map((row) => row.name);
  const likelyAbsent = likelyAbsentInRound(state, roundIndex, room);
  // A group room with an absent or removed unit is void for the unit that turned up (per-match standings).
  const gone = round.isGroupStage && usesGroupAverages(state) ? voidingUnits(state, units, absentNames) : [];
  const voidMatch = gone.length > 0 && gone.length < units.length;
  const memberInputs = scoredTeamSize(state);
  const placesRange = rankingPlaces?.byRoom.get(room);
  const placesNote = placesRange ? placesLine(placesRange) : undefined;
  // Where the boxes don't show each game's score, a multi-game room shows it in columns (the Final has its own view).
  const gameColumns = roomShowsGameColumns(round, rowsEditable);
  const columns = gameColumns ? roomGameColumns(state, roundIndex, room) : [];
  return (
    <RoomFrame
      lines={lines}
      matchTag={roundMatchTag(state, roundIndex)}
      note={placesNote}
      scrolls={gameColumns}
      title={title}
    >
      {gameColumns ? (
        <GamesHeader
          columns={columns}
          label={points ? 'SCORE' : isMatchRound(round) ? 'WINS' : 'TOTAL'}
          points={Boolean(points)}
        />
      ) : points ? (
        <PointsHeader wide={resultCodes !== null} />
      ) : null}
      {rows.map((entry, index) => {
        const lucky = luckyNames.includes(entry.name);
        const pendingTie = showResults && pendingTieNames.has(entry.name);
        const { result, star } = roomRowResult({
          rule: exitRule,
          bands,
          rank: entry.rank,
          absentee: entry.fate,
          lucky,
          pendingTie,
          roomComplete: showResults,
          roundDecided: isRoundDone(state, roundIndex),
        });
        return (
          <RoomRow
            absentSince={absentSinceOf(state, roundIndex, entry.name, likelyAbsent, labels)}
            followed={followKey === entry.name}
            gameColumns={gameColumns}
            columns={columns}
            finalPlace={rankingPlaces?.byName.get(entry.name)}
            games={round.numGames ?? 1}
            index={index}
            inputsPerTeam={rowsEditable ? memberInputs : undefined}
            key={entry.name}
            manual={Boolean(units.find((unit) => unit.name === entry.name)?.manual)}
            pendingTie={pendingTie}
            points={points ? (points.get(entry.name) ?? null) : undefined}
            resultCode={resultCodes?.get(entry.name)}
            voided={voidMatch && !gone.includes(entry.name)}
            widePoints={resultCodes !== null}
            resolvedTie={resolvedTieNames.has(entry.name)}
            result={result}
            room={room}
            row={entry}
            roundIndex={roundIndex}
            rowsEditable={rowsEditable}
            showResults={showResults}
            star={star}
            state={state}
            team={teamMap[entry.name]}
            teamSize={getGameFormat(state.gameFormat)?.teamSize ?? 0}
          />
        );
      })}
    </RoomFrame>
  );
}
