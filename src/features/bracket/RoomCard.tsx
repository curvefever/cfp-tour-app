import { type ReactNode } from 'react';
import { isUncontestedRoom } from '../../domain/tournament/advancement';
import { type bracketRoundLabels } from '../../domain/tournament/bracket';
import { getGameFormat } from '../../domain/tournament/formats';
import { type RoundExitRule } from '../../domain/tournament/room-exits';
import { type buildTeamMap } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomByScore, scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { cn, roomHeaderClassName } from '../../components/ui';
import { ExitIcon } from './ExitIcon';
import { type ExitLine, poolingExitLines, roomExitLines } from './exit-lines';
import { LoneUnitRow, RoomRow } from './RoomRow';
import { roomRowResult } from './room-row-result';
import { roomTitle } from './room-title';

/** The small header of a pooling room that shows points: SCORE and PTS. */
function PointsHeader() {
  return (
    <div className='flex h-5 items-center gap-2 px-3 text-[11px] font-extrabold tracking-[0.08em] text-cfp-text-dim'>
      <span className='w-4.5 shrink-0' />
      <span className='flex-1' />
      <span className='w-11.5 shrink-0 text-right'>SCORE</span>
      <span className='w-9 shrink-0 text-right'>PTS</span>
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
  title,
}: {
  children: ReactNode;
  future?: boolean;
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
        <span className='flex-1' />
        <ExitIcon label={`Where players go from ${title}`} lines={lines} />
      </div>
      {children}
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
        <LoneUnitRow followed={followKey === units[0].name} name={units[0].name} state={state} />
      </RoomFrame>
    );
  }
  const scored = units.map((entry, position) => ({
    name: entry.name,
    position,
    score: getUnitScore(state, roundIndex, room, position, null),
  }));
  const complete = scored.length > 0 && scored.every((entry) => entry.score !== null);
  const showResults = roundIndex <= state.curRound && complete;
  // The room keeps its seating order until every unit is scored, so rows do not jump while a score is typed.
  const display = showResults
    ? orderRoomByScore(
        scored as Array<{ name: string; position: number; score: number }>,
        roundIndex,
        room,
        state,
      )
    : scored;
  const memberInputs = scoredTeamSize(state);
  return (
    <RoomFrame lines={lines} title={title}>
      {points ? <PointsHeader /> : null}
      {display.map((entry, index) => {
        const lucky = luckyNames.includes(entry.name);
        const pendingTie = showResults && pendingTieNames.has(entry.name);
        const { result, star } = roomRowResult({
          rule: exitRule,
          bands,
          rank: index + 1,
          lucky,
          pendingTie,
          roomComplete: showResults,
          roundDecided: roundIndex < state.curRound,
        });
        return (
          <RoomRow
            followed={followKey === entry.name}
            games={round.numGames ?? 1}
            index={index}
            inputsPerTeam={rowsEditable ? memberInputs : undefined}
            key={entry.name}
            manual={Boolean(units.find((unit) => unit.name === entry.name)?.manual)}
            memberInputs={memberInputs}
            name={entry.name}
            pendingTie={pendingTie}
            points={points ? (points.get(entry.name) ?? null) : undefined}
            position={entry.position}
            resolvedTie={resolvedTieNames.has(entry.name)}
            result={result}
            room={room}
            roundIndex={roundIndex}
            rowsEditable={rowsEditable}
            score={entry.score}
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
