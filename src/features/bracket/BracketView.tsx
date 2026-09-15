import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeLuckyLoserStandings,
  detectTieBreaks,
  getAllTies,
  hasPendingTies,
  isTieResolved,
} from '../../domain/tournament/advancement';
import {
  bracketFollowStatus,
  bracketRoundDefaultCollapsed,
  bracketRoundLabels,
  projectedSlotLabelText,
  projectFutureRoundSlots,
  roomLetter,
  type BracketFollowStatus,
  type ProjectedSlotLabel,
} from '../../domain/tournament/bracket';
import { finalsProgressState } from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import { resolveTournamentTie, setFinalScore, setRoundScore } from '../../domain/tournament/mutations';
import { buildTeamMap, resolveUnitQuery, unitDisplay } from '../../domain/tournament/roster';
import {
  getDefenderIndex,
  getUnitScore,
  orderRoomByScore,
  tieResolutionList,
} from '../../domain/tournament/scoring';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { readBracketFollow, saveBracketFollow } from '../../lib/persistence/storage';
import { Alert, Badge, Button, ButtonRow, Input, ScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

const compactScoreClass = 'w-13 shrink-0 rounded-sm px-1.5 py-0.5 text-xs';
const bracketRowBase = 'rounded-sm border-l-[3px] border-l-transparent px-2 py-1 text-xs';

function FollowBanner({
  state,
  followKey,
  follow,
  clear,
}: {
  state: TournamentState;
  followKey: string | null;
  follow: BracketFollowStatus | null;
  clear(): void;
}) {
  if (!followKey) return null;
  const label = unitDisplay(state, followKey).label;
  const out = !follow || follow.eliminated;
  const roundName = follow
    ? (bracketRoundLabels(state)[follow.lastRi]?.label ?? `Round ${follow.lastRi + 1}`)
    : '';
  const where = !follow
    ? 'not in this bracket'
    : follow.eliminated
      ? `out in ${roundName}`
      : follow.isBye
        ? `${roundName} · BYE, advances automatically`
        : `${roundName} · Room ${roomLetter(follow.room)}`;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-surface-hover bg-primary-soft py-1 pr-1.5 pl-3 text-xs',
        out && 'bg-danger/10',
      )}
    >
      <strong className={out ? 'text-muted' : 'text-primary'}>Following {label}</strong> — {where}
      <Button
        aria-label='Stop following'
        className='size-6 min-h-0 rounded-full p-0'
        onClick={clear}
        size='sm'
        title='Stop following'
        variant='ghost'
      >
        ✕
      </Button>
    </div>
  );
}

function TeamMembers({
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
          const defender =
            state.gamemodeConfig.teamScoringRule === 'designated-player' &&
            getDefenderIndex(state, name, roundIndex) === rawIndex;
          return `${member}${defender ? ' 🛡' : ''}`;
        })
        .join(', ')}
    </span>
  );
}

function BracketScoreInput({
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
    <ScoreInput
      className={className}
      min='0'
      value={state.scores[scoreKey] ?? ''}
      data-key={scoreKey}
      onChange={(event) =>
        app.updateState((current) => setRoundScore(current, scoreKey, event.target.value, roundIndex, room))
      }
    />
  );
}

function TeamScoreFields({ children }: { children: ReactNode }) {
  return (
    <div className='mt-1 flex flex-wrap gap-1.5 [&>label]:flex [&>label]:items-center [&>label]:gap-1 [&>label]:text-[0.68rem] [&>label]:text-muted'>
      {children}
    </div>
  );
}

function resultClasses(
  result: 'advance' | 'eliminate' | 'lucky' | 'pending' | 'promote' | 'stay' | 'demote' | '',
  followed: boolean,
) {
  return cn(
    result === 'advance' && 'border-l-success text-success',
    result === 'eliminate' && 'border-l-surface-hover text-muted line-through opacity-50',
    result === 'lucky' && 'border-l-accent text-accent',
    result === 'pending' && 'border-l-danger text-danger no-underline opacity-85',
    result === 'promote' && 'border-l-success text-success',
    result === 'demote' && 'border-l-warning text-warning',
    followed && 'bg-primary-soft shadow-[inset_0_0_0_1px_rgb(0_229_255_/_27%)]',
  );
}

function FinalColumn({
  state,
  roundIndex,
  editable,
  followed,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followed: string | null;
}) {
  const app = useTournamentApp();
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  const progress = finalsProgressState(state, roundIndex, round);
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const teamMap = buildTeamMap(state);
  const games = round.numGames ?? 1;
  const [tab, setTab] = useState(progress.nextGame ?? 1);
  const activeTab = Math.min(tab, games);
  const names = progress.complete
    ? progress.order.filter((name): name is string => Boolean(name))
    : assignments.map((entry) => entry.name);
  return (
    <>
      {progress.race ? (
        <div className='mb-2 text-xs leading-relaxed text-muted'>
          <span className='text-primary'>{unitDisplay(state, progress.race.wbName).label}</span>{' '}
          <b>{progress.race.wbWins}</b>/{progress.race.wbTarget} <span className='opacity-50'>·</span>{' '}
          <span className='text-warning'>{unitDisplay(state, progress.race.lbName).label}</span>{' '}
          <b>{progress.race.lbWins}</b>/{progress.race.lbTarget}{' '}
          {progress.race.decided ? (
            <span className='font-semibold text-success'>
              🏆 {unitDisplay(state, progress.race.winnerName as string).label} wins
            </span>
          ) : null}
        </div>
      ) : null}
      {editable && games > 1 ? (
        <div className='mb-1.5 flex flex-wrap gap-1'>
          {Array.from({ length: games }, (_, index) => (
            <Button
              key={index}
              size='sm'
              className={cn(
                'px-1.5 py-0.5 text-[0.68rem]',
                activeTab === index + 1 && tab !== 0 && 'border-primary bg-primary-soft text-primary',
              )}
              onClick={() => setTab(index + 1)}
            >
              G{index + 1}
            </Button>
          ))}
          <Button
            size='sm'
            className={cn(
              'px-1.5 py-0.5 text-[0.68rem]',
              tab === 0 && 'border-primary bg-primary-soft text-primary',
            )}
            onClick={() => setTab(0)}
          >
            📊 Total
          </Button>
        </div>
      ) : null}
      {editable && tab !== 0 ? (
        <div className='mb-1 text-[0.68rem] font-semibold tracking-[0.05em] text-primary uppercase'>
          Game {activeTab} — enter scores
        </div>
      ) : null}
      {names.map((name, index) => {
        const unit = progress.units.find((entry) => entry.name === name);
        if (!unit) return null;
        const winner = progress.complete && index === 0;
        const team = teamMap[name];
        return (
          <div
            className={cn(
              bracketRowBase,
              progress.complete && 'border-l-success text-success',
              followed === name && 'bg-primary-soft shadow-[inset_0_0_0_1px_rgb(0_229_255_/_27%)]',
            )}
            key={name}
          >
            <div className='flex items-center gap-1.5'>
              <span className='min-w-0 flex-1'>
                {winner ? '🏆 ' : ''}
                {unitDisplay(state, name).label}
              </span>
              <span
                className={cn('text-xs font-bold text-muted', winner && 'text-primary')}
                title={progress.isGrandFinal ? 'Games won' : 'Cumulative Final score'}
              >
                {progress.isGrandFinal ? unit.wins : unit.total}
              </span>
            </div>
            {teamSize ? <TeamMembers state={state} name={name} roundIndex={roundIndex} /> : null}
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {unit.perGame.map((score, game) => (
                <span className={score === null ? 'opacity-50' : ''} key={game}>
                  G{game + 1} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                </span>
              ))}
            </div>
            {editable && tab !== 0 ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
                {teamSize ? (
                  <TeamScoreFields>
                    {Array.from({ length: teamSize }, (_, memberIndex) => {
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
                      const key = `game${activeTab}-${name}-m${memberIndex}`;
                      return (
                        <label key={key}>
                          <span>{member.name}</span>
                          <ScoreInput
                            className={compactScoreClass}
                            min='0'
                            value={state.finalScores[key] ?? ''}
                            onChange={(event) =>
                              app.updateState((current) => setFinalScore(current, key, event.target.value))
                            }
                          />
                        </label>
                      );
                    })}
                  </TeamScoreFields>
                ) : (
                  (() => {
                    const key = `game${activeTab}-${name}`;
                    return (
                      <ScoreInput
                        className={compactScoreClass}
                        min='0'
                        value={state.finalScores[key] ?? ''}
                        onChange={(event) =>
                          app.updateState((current) => setFinalScore(current, key, event.target.value))
                        }
                      />
                    );
                  })()
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function LuckyLoserDisclaimer({ round }: { round: TournamentRound }) {
  const direct = round.advPerRoom ?? 0;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>★ Lucky loser{round.luckyCount === 1 ? '' : 's'}: </span>
      Top {direct} advance{direct === 1 ? 's' : ''} directly from each room. {round.luckyCount} extra spot
      {round.luckyCount === 1 ? '' : 's'} go{round.luckyCount === 1 ? 'es' : ''} to whoever's next-best
      finisher scores highest as a share of their own room's total — compared across every room.
    </div>
  );
}

function LuckyLoserStandingsPanel({ state, roundIndex }: { state: TournamentState; roundIndex: number }) {
  const standings = computeLuckyLoserStandings(state, roundIndex);
  if (!standings?.length) return null;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem]'>
      <div className='mb-1 font-semibold tracking-[0.05em] text-accent uppercase'>Lucky loser race</div>
      {standings.map((entry) => (
        <div
          className={cn(
            'flex items-center justify-between gap-2 py-px',
            entry.leading ? 'font-semibold text-accent' : 'text-muted',
          )}
          key={entry.name}
        >
          <span className='min-w-0 flex-1 truncate'>
            {entry.leading ? '★ ' : ''}Room {roomLetter(entry.room)} · {unitDisplay(state, entry.name).label}
          </span>
          <span>{(entry.pct * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function KingsValleyDisclaimer({ round }: { round: TournamentRound }) {
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>⛰ Kings Valley: </span>
      Top finishers promote to the room above, bottom finishers demote to the room below (the bottom room's
      demoted are eliminated instead), the rest stay.
      <div className='mt-1 grid gap-0.5'>
        {round.rooms.map((size, roomIndex) => {
          const isBottom = roomIndex === round.rooms.length - 1;
          const promote = round.kvPromoteCounts?.[roomIndex] ?? 0;
          const cut = isBottom ? (round.kvEliminateCount ?? 0) : (round.kvDemoteCounts?.[roomIndex] ?? 0);
          const stay = size - promote - cut;
          const cutText = isBottom
            ? `bottom ${cut} are eliminated`
            : `bottom ${cut} demote to Room ${roomLetter(roomIndex + 2)}`;
          return (
            <div key={roomIndex}>
              Room {roomLetter(roomIndex + 1)} ({size}): top {promote} promote, {cutText}, {stay} stay.
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TieBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const ties = getAllTies(state, state.curRound);
  return Object.entries(ties)
    .filter(([key, tie]) => !isTieResolved(key, tie, state))
    .map(([key, tie]) => {
      const resolved = tieResolutionList(state, key);
      const remaining = tie.players.filter((player) => !resolved.includes(player.name));
      const heading =
        'groupLabel' in tie && tie.groupLabel
          ? `⚠ Tie-break required — Group ${tie.groupLabel} qualification cutoff (${tie.fp.toFixed(5)} FP)`
          : 'score' in tie
            ? `⚠ Tie-break required — Room ${roomLetter(tie.rm)} (score ${tie.score})`
            : `⚠ Tie-break required — Qualification cutoff (${tie.fp.toFixed(5)} FP)`;
      return (
        <div
          className='mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-danger bg-danger-soft px-4.5 py-3.5'
          key={key}
        >
          <div>
            <div className='font-semibold text-danger'>{heading}</div>
            <div className='mt-1 text-xs text-muted'>
              {resolved.length
                ? `Ranked so far: ${resolved.map((name) => unitDisplay(state, name).label).join(' > ')} — `
                : ''}
              tied: {tie.players.map((player) => unitDisplay(state, player.name).label).join(', ')} — pick who
              ranks next
            </div>
          </div>
          <ButtonRow className='mt-0'>
            {remaining.map((player) => (
              <Button
                size='sm'
                variant='warning'
                key={player.name}
                onClick={() => app.updateState((current) => resolveTournamentTie(current, key, player.name))}
              >
                {unitDisplay(state, player.name).label} ranks next
              </Button>
            ))}
          </ButtonRow>
        </div>
      );
    });
}

function PlaceholderRound({
  round,
  state,
  projected,
}: {
  round: TournamentRound;
  state: TournamentState;
  projected: ProjectedSlotLabel[][] | null;
}) {
  if (!round.rooms.length) return <div className='text-muted'>Not yet seeded</div>;
  if (round.isGroupStage) {
    return (
      <>
        {(round.matches ?? []).map((match, roomIndex) => (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Group {match.group} · Room {roomLetter(roomIndex + 1)} ({round.rooms[roomIndex]})
            </RoomLabel>
            {match.pair.map((name) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={name}
              >
                {unitDisplay(state, name).label}
              </div>
            ))}
          </div>
        ))}
        {(round.groupByes ?? []).map((name) => (
          <div
            className='mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning'
            key={name}
          >
            <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
            {unitDisplay(state, name).label}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {round.rooms.map((slots, roomIndex) => {
        const roomLabels = projected?.[roomIndex] ?? null;
        return (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomLetter(roomIndex + 1)} ({slots})
            </RoomLabel>
            {Array.from({ length: slots }, (_, slot) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={slot}
              >
                {roomLabels?.[slot] ? projectedSlotLabelText(roomLabels[slot]) : '—'}
              </div>
            ))}
          </div>
        );
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.isKingsValley ? <KingsValleyDisclaimer round={round} /> : null}
      {round.pairingTBD ? (
        <div className='mt-1.5 text-[0.68rem] text-warning'>Pairings determined live</div>
      ) : null}
    </>
  );
}

function RoomLabel({ children }: { children: ReactNode }) {
  return (
    <div className='mb-1 pl-0.5 text-[0.68rem] font-bold tracking-[0.05em] text-muted uppercase'>
      {children}
    </div>
  );
}

function RoundBody({
  state,
  roundIndex,
  editable,
  followKey,
  projected,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followKey: string | null;
  projected: ProjectedSlotLabel[][] | null;
}) {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (!assignments.length) return <PlaceholderRound round={round} state={state} projected={projected} />;
  if (round.isFinal)
    return (
      <FinalColumn
        state={state}
        roundIndex={roundIndex}
        editable={editable && roundIndex === state.curRound}
        followed={followKey}
      />
    );
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const teamMap = buildTeamMap(state);
  const rowsEditable = editable && roundIndex === state.curRound;
  const games = round.numGames ?? 1;
  const luckyNames = state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
  const roomTies = detectTieBreaks(roundIndex, round, state);
  const resolvedTieNames = new Set(
    Object.entries(roomTies)
      .filter(([key]) => tieResolutionListSafe(state, key).length > 0)
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  const pendingTieNames = new Set(
    Object.entries(getAllTies(state, roundIndex))
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  return (
    <>
      {round.rooms.map((_, roomIndex) => {
        const room = roomIndex + 1;
        const units = assignments.filter((entry) => entry.room === room);
        const direct = round.isNoElim ? units.length : (round.advPerRoom ?? 0);
        const isBottomRoom = round.isKingsValley && roomIndex === round.rooms.length - 1;
        const promoteCount = round.kvPromoteCounts?.[roomIndex] ?? 0;
        const cutCount = isBottomRoom
          ? (round.kvEliminateCount ?? 0)
          : (round.kvDemoteCounts?.[roomIndex] ?? 0);
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
          <div className='mb-2' key={room}>
            <RoomLabel>
              {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {roomLetter(room)} (
              {units.length})
            </RoomLabel>
            {display.map((entry, index) => {
              const advances = round.isNoElim || index < direct;
              const lucky = luckyNames.includes(entry.name);
              const pending = showResults && pendingTieNames.has(entry.name);
              const result = pending
                ? 'pending'
                : !showResults
                  ? ''
                  : round.isKingsValley
                    ? index < promoteCount
                      ? 'promote'
                      : index >= display.length - cutCount
                        ? isBottomRoom
                          ? 'eliminate'
                          : 'demote'
                        : 'stay'
                    : lucky
                      ? 'lucky'
                      : advances
                        ? 'advance'
                        : 'eliminate';
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
                  {showResults && lucky ? '★ ' : ''}
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
                  <div className={cn(bracketRowBase, resultClasses(result, followed))} key={entry.name}>
                    <div className='flex items-center gap-1.5'>
                      <span className='min-w-0 flex-1'>
                        {badges}
                        <span>{unitDisplay(state, entry.name).label}</span>
                        <TeamMembers state={state} name={entry.name} roundIndex={roundIndex} />
                      </span>
                      {showResults ? (
                        <span className='ml-auto text-xs font-bold text-muted'>{entry.score}</span>
                      ) : null}
                    </div>
                    {rowsEditable ? (
                      <TeamScoreFields>
                        {Array.from({ length: teamSize }, (_, memberIndex) => {
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
                                <span>{member.name}</span>
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
                              <span>{member.name}</span>
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
                  </div>
                );
              }
              const key = `r${roundIndex}-rm${room}-p${entry.position}`;
              if (rowsEditable && games > 1) {
                return (
                  <div className={cn(bracketRowBase, resultClasses(result, followed))} key={entry.name}>
                    <div className='flex items-center gap-1.5'>
                      <span className='min-w-0 flex-1'>
                        {badges}
                        {entry.name}
                      </span>
                    </div>
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
                        Total {getUnitScore(state, roundIndex, room, entry.position, 0)}
                      </span>
                    </TeamScoreFields>
                  </div>
                );
              }
              return (
                <div
                  className={cn(bracketRowBase, 'flex items-center gap-1.5', resultClasses(result, followed))}
                  key={entry.name}
                >
                  <span>
                    {badges}
                    {entry.name}
                  </span>
                  {rowsEditable ? (
                    <BracketScoreInput state={state} scoreKey={key} roundIndex={roundIndex} room={room} />
                  ) : showResults ? (
                    <span className='ml-auto text-xs font-bold text-muted'>{entry.score}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.luckyCount > 0 && !round.isNoElim && roundIndex === state.curRound ? (
        <LuckyLoserStandingsPanel state={state} roundIndex={roundIndex} />
      ) : null}
      {round.isKingsValley ? <KingsValleyDisclaimer round={round} /> : null}
      {(state.byes[roundIndex] ?? []).map((name) => (
        <div
          className={cn(
            'mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning',
            followKey === name && 'border-solid shadow-[0_0_0_1px_rgb(0_229_255_/_27%)]',
          )}
          key={name}
        >
          <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
          {unitDisplay(state, name).label}
        </div>
      ))}
    </>
  );
}

function tieResolutionListSafe(state: TournamentState, key: string): string[] {
  const value = state.tieResolutions[key];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function RoundColumn({
  accent,
  children,
  collapsed = false,
  current = false,
  followed = false,
  label,
  onToggle,
  roundIndex,
}: {
  accent?: string;
  children: ReactNode;
  collapsed?: boolean;
  current?: boolean;
  followed?: boolean;
  label: ReactNode;
  onToggle?: () => void;
  roundIndex: number;
}) {
  const accentClass =
    accent === 'wb'
      ? 'border-t-2 border-t-success'
      : accent === 'lb'
        ? 'border-t-2 border-t-warning'
        : accent === 'gf'
          ? 'border-t-2 border-t-accent'
          : '';
  const headerClass = cn(
    'flex w-full items-center gap-1 border-b border-surface-hover bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-muted uppercase',
    onToggle && 'cursor-pointer',
    (current || followed) && 'text-primary',
    accentClass,
    collapsed && 'h-45 border-b-0 py-2 pr-0 pl-0.5 whitespace-nowrap [writing-mode:vertical-rl]',
  );
  return (
    <div
      className={cn(
        'w-52.5 min-w-52.5 shrink-0 overflow-hidden rounded-lg border border-surface-hover bg-surface',
        collapsed && 'w-8.5 min-w-8.5',
        current && 'border-primary shadow-[0_0_0_1px_var(--app-primary-soft)]',
      )}
      data-ri={roundIndex}
    >
      {onToggle ? (
        <button className={headerClass} onClick={onToggle}>
          <span
            className={cn(
              'shrink-0 rotate-90 text-[0.68rem]',
              collapsed && 'rotate-180 [writing-mode:horizontal-tb]',
            )}
          >
            ▸
          </span>
          {label}
        </button>
      ) : (
        <div className={headerClass}>{label}</div>
      )}
      {!collapsed ? <div className='p-2.5'>{children}</div> : null}
    </div>
  );
}

export function BracketView() {
  const app = useTournamentApp();
  const [collapse, setCollapse] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState('');
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!app.hydrated) return;
    const stored = readBracketFollow(window.localStorage);
    setFollowKey(stored);
    if (stored) setQuery(unitDisplay(app.state, stored).label);
  }, [app.hydrated]);
  useEffect(() => setCollapse({}), [app.state.tournamentId]);
  const follow = useMemo(() => bracketFollowStatus(app.state, followKey), [app.state, followKey]);
  const labels = bracketRoundLabels(app.state);
  const projectedSlots = useMemo(() => projectFutureRoundSlots(app.state), [app.state]);
  if (!app.state.rounds.length)
    return <Alert>Start a tournament in Admin to see the bracket overview.</Alert>;
  const editable = app.unlocked && !app.isViewer && app.state.started;
  const pendingTies = hasPendingTies(app.state, app.state.curRound);
  const currentRound = app.state.rounds[app.state.curRound];
  const isLastRound =
    app.state.curRound >= app.state.rounds.length - 1 || currentRound?.bracket === 'grand-final';
  function advance() {
    // Last-resort backstop: every known failure mode returns a 'blocked'
    // result instead of throwing, but this guards against any
    // future/unanticipated throw deep in the advancement logic crashing the
    // whole Bracket view mid-tournament.
    let result;
    try {
      result = advanceTournamentRound(app.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    if (result.status === 'advanced') {
      setMessage('');
      app.updateState(result.state);
    } else if (result.status === 'blocked') setMessage(result.message);
  }
  function chooseFollow(value: string) {
    setQuery(value);
    const resolved = resolveUnitQuery(app.state, value);
    setFollowKey(resolved);
    saveBracketFollow(window.localStorage, resolved);
    if (resolved)
      queueMicrotask(() => {
        const status = bracketFollowStatus(app.state, resolved);
        const column = status
          ? scroll.current?.querySelector<HTMLElement>(`[data-ri="${status.lastRi}"]`)
          : null;
        if (column && scroll.current)
          scroll.current.scrollTo({
            left: Math.max(0, column.offsetLeft - (scroll.current.clientWidth - column.offsetWidth) / 2),
            behavior: 'smooth',
          });
      });
  }
  return (
    <div id='br-content'>
      <div className='mb-2.5 flex flex-wrap items-center gap-2.5'>
        <Input
          className='max-w-65'
          id='br-follow-input'
          placeholder='Follow a player or team…'
          type='text'
          value={query}
          onChange={(event) => chooseFollow(event.target.value)}
        />
        <FollowBanner
          state={app.state}
          followKey={followKey}
          follow={follow}
          clear={() => {
            setQuery('');
            setFollowKey(null);
            saveBracketFollow(window.localStorage, null);
          }}
        />
      </div>
      <div className='mb-2.5 flex flex-wrap items-center gap-2.5'>
        <Badge tone='success'>Advanced</Badge>
        <Badge tone='accent'>Lucky loser</Badge>
        <Badge tone='danger'>Eliminated</Badge>
      </div>
      {editable ? <TieBanners state={app.state} /> : null}
      {message ? <Alert tone='danger'>{message}</Alert> : null}
      <div className='flex max-w-full gap-3.5 overflow-x-auto pb-3' id='br-rounds' ref={scroll}>
        {app.state.rounds.map((round, roundIndex) => {
          const collapsed =
            collapse[roundIndex] ?? bracketRoundDefaultCollapsed(roundIndex, app.state.curRound);
          return (
            <RoundColumn
              accent={labels[roundIndex]?.accent}
              collapsed={collapsed}
              current={roundIndex === app.state.curRound}
              followed={Boolean(follow?.rounds[roundIndex])}
              key={roundIndex}
              label={labels[roundIndex]?.label}
              onToggle={() => setCollapse((current) => ({ ...current, [roundIndex]: !collapsed }))}
              roundIndex={roundIndex}
            >
              <RoundBody
                state={app.state}
                roundIndex={roundIndex}
                editable={editable}
                followKey={followKey}
                projected={projectedSlots[roundIndex] ?? null}
              />
            </RoundColumn>
          );
        })}
      </div>
      {editable ? (
        <ButtonRow className='sticky bottom-2.5 z-20 rounded-lg border border-surface-hover bg-background/90 p-2.5 backdrop-blur-md'>
          {!isLastRound ? (
            <Button
              variant='success'
              disabled={pendingTies}
              title={pendingTies ? 'Resolve the tie-break above first' : undefined}
              onClick={advance}
            >
              Next Round →
            </Button>
          ) : null}
          {app.state.curRound > 0 ? (
            <Button
              onClick={() => app.updateState((current) => ({ ...current, curRound: current.curRound - 1 }))}
            >
              ← Previous
            </Button>
          ) : null}
        </ButtonRow>
      ) : null}
    </div>
  );
}

export function ArchivedBracket({ state }: { state: TournamentState }) {
  const labels = bracketRoundLabels(state);
  const projectedSlots = projectFutureRoundSlots(state);
  return (
    <div className='flex max-w-full gap-3.5 overflow-x-auto pb-3'>
      {state.rounds.map((_, roundIndex) => (
        <RoundColumn
          accent={labels[roundIndex]?.accent}
          key={roundIndex}
          label={labels[roundIndex]?.label}
          roundIndex={roundIndex}
        >
          <RoundBody
            state={state}
            roundIndex={roundIndex}
            editable={false}
            followKey={null}
            projected={projectedSlots[roundIndex] ?? null}
          />
        </RoundColumn>
      ))}
    </div>
  );
}
