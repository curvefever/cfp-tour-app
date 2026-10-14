import { type ReactNode } from 'react';
import { isUncontestedRoom } from '../../domain/tournament/advancement';
import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { getGameFormat } from '../../domain/tournament/formats';
import { type RoundExitRule, exitBandAtRank } from '../../domain/tournament/room-exits';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomByScore, scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { Badge, ScoreInput, cn } from '../../components/ui';
import { LuckyStar } from '../tournament/components/LuckyStar';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { bracketRowBase, rowSurfaceClasses } from '../tournament/components/result-row';
import { DestinationTag, RoomExitChips } from './RoomExits';
import { ManualMarker } from './RowMarks';
import {
  BracketScoreInput,
  TeamMembers,
  TeamScoreFields,
  UnitScoreFields,
  compactScoreClass,
  memberLabel,
} from './ScoreFields';
import { exitBandDestination } from './exit-text';
import { roomRowResult } from './room-row-result';

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
  const assignments = state.assignments[roundIndex] ?? [];
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const memberInputs = scoredTeamSize(state);
  const inputsPerTeam = rowsEditable ? memberInputs : undefined;
  const games = round.numGames ?? 1;
  const room = roomIndex + 1;
  const units = assignments.filter((entry) => entry.room === room);
  const bands = exitRule.kind === 'per-room' ? exitRule.rooms[roomIndex] : [];
  if (isByeLikeRound(round) && isUncontestedRoom(state, roundIndex, room)) {
    // Only Kings Valley has a band for a lone room ("1 stay");
    // roundExitRule gives every other bye-like round none here.
    return (
      <div className='mb-2'>
        <RoomLabel>
          {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {roomLetter(room)} (1)
        </RoomLabel>
        <RoomExitChips bands={bands} labels={labels} />
        <div className={cn(bracketRowBase, rowSurfaceClasses(0, followKey === units[0].name))}>
          <span className='block truncate' title={unitDisplay(state, units[0].name).label}>
            {unitDisplay(state, units[0].name).label}
          </span>
          <span className='block text-xs text-muted'>No opponent — treated as a bye, no score needed</span>
        </div>
      </div>
    );
  }
  const advanceDestination = bands.find((band) => band.kind === 'advance')?.destination;
  // A destination tag is only meaningful where "which round" isn't
  // already obvious from a single fixed next round -- waterfall (a
  // band can point several rounds ahead) and double-elimination (WB
  // vs LB). Single elimination and Kings Valley never get one.
  const showDestinationTags = round.isWaterfall || Boolean(round.bracket);
  const scored = units.map((entry, position) => ({
    name: entry.name,
    position,
    score: getUnitScore(state, roundIndex, room, position, null),
  }));
  const complete = scored.length > 0 && scored.every((entry) => entry.score !== null);
  const showResults = roundIndex <= state.curRound && complete;
  const display = showResults
    ? orderRoomByScore(
        scored as Array<{ name: string; position: number; score: number }>,
        roundIndex,
        room,
        state,
      )
    : scored;
  return (
    <div className='mb-2'>
      <RoomLabel>
        {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {roomLetter(room)} (
        {units.length})
      </RoomLabel>
      <RoomExitChips bands={bands} labels={labels} />
      {display.map((entry, index) => {
        const lucky = luckyNames.includes(entry.name);
        const pending = showResults && pendingTieNames.has(entry.name);
        // The room's own band for this rank -- the single source both
        // the row colour and its destination tag read from, so they
        // can never disagree. Only meaningful once bands exist (a
        // 'per-room' exit rule); standings-cutoff and no-elim rounds
        // keep their own existing paths below, unchanged.
        const band = exitBandAtRank(bands, index + 1);
        const { result, star } = roomRowResult({
          rule: exitRule,
          bands,
          rank: index + 1,
          lucky,
          pendingTie: pending,
          roomComplete: showResults,
          roundDecided: roundIndex < state.curRound,
        });
        const destination =
          showDestinationTags && showResults ? exitBandDestination(band, lucky, advanceDestination) : null;
        const followed = followKey === entry.name;
        const kvLabel =
          round.isKingsValley && showResults
            ? result === 'promote'
              ? '▲ Promotes'
              : result === 'demote'
                ? '▼ Demotes'
                : result === 'eliminate'
                  ? '☠ Eliminated'
                  : '— Stays'
            : null;
        const badges = (
          <>
            {star ? <LuckyStar candidate={star === 'candidate'} /> : null}
            {units.find((unit) => unit.name === entry.name)?.manual ? <ManualMarker /> : null}
            {kvLabel ? (
              <Badge
                className='ml-0.5 px-1.5 py-px text-[0.6rem]'
                tone={
                  result === 'promote'
                    ? 'success'
                    : result === 'demote'
                      ? 'warning'
                      : result === 'eliminate'
                        ? 'danger'
                        : 'neutral'
                }
              >
                {kvLabel}
              </Badge>
            ) : null}
            {showResults && resolvedTieNames.has(entry.name) ? (
              <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' tone='warning'>
                ⚖ TB
              </Badge>
            ) : null}
            {pending ? (
              <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' tone='danger'>
                ⚠ TB?
              </Badge>
            ) : null}
          </>
        );
        if (teamSize) {
          const team = teamMap[entry.name];
          return (
            <div className={cn(bracketRowBase, rowSurfaceClasses(index, followed))} key={entry.name}>
              <div className='flex items-center gap-1.5'>
                <ResultStripe result={result} />
                <span className='min-w-0 flex-1'>
                  {badges}
                  <span>{unitDisplay(state, entry.name).label}</span>
                  {inputsPerTeam ? null : (
                    <TeamMembers state={state} name={entry.name} roundIndex={roundIndex} />
                  )}
                </span>
                {showResults ? (
                  <span className='ml-auto flex items-center text-xs font-bold text-muted'>
                    {entry.score}
                    <DestinationTag destination={destination} labels={labels} />
                  </span>
                ) : null}
              </div>
              {inputsPerTeam ? (
                <TeamScoreFields>
                  {Array.from({ length: inputsPerTeam }, (_, memberIndex) => {
                    const member = team?.members?.[memberIndex];
                    if (!member)
                      return (
                        <ScoreInput
                          key={memberIndex}
                          className={compactScoreClass}
                          disabled
                          placeholder='—'
                        />
                      );
                    if (games <= 1) {
                      const key = `r${roundIndex}-rm${room}-p${entry.position}-m${memberIndex}`;
                      return (
                        <label key={key}>
                          <span>{memberLabel(state, entry.name, roundIndex, memberIndex, member.name)}</span>
                          <BracketScoreInput
                            state={state}
                            scoreKey={key}
                            roundIndex={roundIndex}
                            room={room}
                          />
                        </label>
                      );
                    }
                    return (
                      <label key={memberIndex}>
                        <span>{memberLabel(state, entry.name, roundIndex, memberIndex, member.name)}</span>
                        {Array.from({ length: games }, (_, gameIndex) => {
                          const key = `r${roundIndex}-rm${room}-p${entry.position}-g${gameIndex + 1}-m${memberIndex}`;
                          return (
                            <BracketScoreInput
                              key={key}
                              state={state}
                              scoreKey={key}
                              roundIndex={roundIndex}
                              room={room}
                              className={compactScoreClass}
                            />
                          );
                        })}
                      </label>
                    );
                  })}
                  {games > 1 ? (
                    <span className='text-[0.68rem] font-bold text-foreground'>
                      Total {getUnitScore(state, roundIndex, room, entry.position, 0)}
                    </span>
                  ) : null}
                </TeamScoreFields>
              ) : null}
              {rowsEditable && !memberInputs ? (
                <div className='mt-1 flex'>
                  <UnitScoreFields
                    state={state}
                    roundIndex={roundIndex}
                    room={room}
                    position={entry.position}
                    games={games}
                  />
                </div>
              ) : null}
            </div>
          );
        }
        if (rowsEditable && games > 1) {
          return (
            <div className={cn(bracketRowBase, rowSurfaceClasses(index, followed))} key={entry.name}>
              <div className='flex items-center gap-1.5'>
                <ResultStripe result={result} />
                <span className='min-w-0 flex-1 truncate' title={entry.name}>
                  {badges}
                  {entry.name}
                </span>
              </div>
              <UnitScoreFields
                state={state}
                roundIndex={roundIndex}
                room={room}
                position={entry.position}
                games={games}
              />
            </div>
          );
        }
        return (
          <div
            className={cn(bracketRowBase, 'flex items-center gap-1.5', rowSurfaceClasses(index, followed))}
            key={entry.name}
          >
            <ResultStripe result={result} />
            <span className='min-w-0 flex-1 truncate' title={entry.name}>
              {badges}
              {entry.name}
            </span>
            {rowsEditable ? (
              <UnitScoreFields
                state={state}
                roundIndex={roundIndex}
                room={room}
                position={entry.position}
                games={1}
              />
            ) : showResults ? (
              <span className='ml-auto flex items-center text-xs font-bold text-muted'>
                {entry.score}
                <DestinationTag destination={destination} labels={labels} />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
