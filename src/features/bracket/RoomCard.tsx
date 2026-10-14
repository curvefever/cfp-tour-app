import { type ReactNode } from 'react';
import { isUncontestedRoom } from '../../domain/tournament/advancement';
import { type bracketRoundLabels } from '../../domain/tournament/bracket';
import { getGameFormat } from '../../domain/tournament/formats';
import { type RoundExitRule, exitBandAtRank } from '../../domain/tournament/room-exits';
import { type buildTeamMap } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomByScore, scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { roomHeaderClassName } from '../../components/ui';
import { RoomExitChips } from './RoomExits';
import { LoneUnitRow, RoomRow } from './RoomRow';
import { exitBandDestination } from './exit-text';
import { roomRowResult } from './room-row-result';
import { roomTitle } from './room-title';

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

export function RoomLabel({ children }: { children: ReactNode }) {
  return (
    <div className='mb-1 pl-0.5 text-[0.68rem] font-bold tracking-[0.05em] text-muted uppercase'>
      {children}
    </div>
  );
}

/** A room's card: a brand-blue header with its title, then the exit chips and the unit rows. */
function RoomFrame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className='rounded-xs bg-surface outline-2 outline-cfp-game-frame'>
      <div className='flex h-9.5 items-center bg-primary pr-1.5 pl-3 text-on-primary'>
        <h3 className={roomHeaderClassName}>{title}</h3>
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
}) {
  const round = state.rounds[roundIndex];
  const room = roomIndex + 1;
  const units = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  const bands = exitRule.kind === 'per-room' ? exitRule.rooms[roomIndex] : [];
  const title = roomTitle(round, roomIndex);
  // Only Kings Valley has a band for a lone room ("1 stay"); roundExitRule gives every other bye-like round none here.
  if (isByeLikeRound(round) && isUncontestedRoom(state, roundIndex, room)) {
    return (
      <RoomFrame title={title}>
        <RoomExitChips bands={bands} labels={labels} />
        <LoneUnitRow followed={followKey === units[0].name} name={units[0].name} state={state} />
      </RoomFrame>
    );
  }
  const advanceDestination = bands.find((band) => band.kind === 'advance')?.destination;
  // A destination tag is only meaningful where "which round" isn't already obvious from a single fixed next
  // round -- waterfall (a band can point several rounds ahead) and double-elimination (WB vs LB).
  const showDestinationTags = round.isWaterfall || Boolean(round.bracket);
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
    <RoomFrame title={title}>
      <RoomExitChips bands={bands} labels={labels} />
      {display.map((entry, index) => {
        const lucky = luckyNames.includes(entry.name);
        const pendingTie = showResults && pendingTieNames.has(entry.name);
        // The room's own band for this rank: the single source both the row's stripe and its destination tag read from.
        const band = exitBandAtRank(bands, index + 1);
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
            destination={
              showDestinationTags && showResults ? exitBandDestination(band, lucky, advanceDestination) : null
            }
            followed={followKey === entry.name}
            games={round.numGames ?? 1}
            index={index}
            inputsPerTeam={rowsEditable ? memberInputs : undefined}
            key={entry.name}
            labels={labels}
            manual={Boolean(units.find((unit) => unit.name === entry.name)?.manual)}
            memberInputs={memberInputs}
            name={entry.name}
            pendingTie={pendingTie}
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
