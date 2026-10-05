import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  computeLuckyLoserStandings,
  computeStandingsCutoffAdvancing,
  isUncontestedRoom,
  detectTieBreaks,
  getAllTies,
  hasPendingTies,
  isTieResolved,
} from '../../domain/tournament/advancement';
import {
  bracketBoxes,
  bracketFollowStatus,
  bracketRoundDefaultCollapsed,
  bracketRoundLabels,
  projectedSlotLabelText,
  projectFutureRoundSlots,
  roomLetter,
  roundGameCount,
  type BracketBox,
  type BracketFollowStatus,
  type ProjectedSlotLabel,
  type RoundGameCount,
} from '../../domain/tournament/bracket';
import {
  anonymousFinalsProgressState,
  finalsProgressState,
  isPlainFinalFullyScored,
} from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import {
  connectAnonymousFinalist,
  flagFinalGameAnonymous,
  resolveTournamentTie,
  setFinalScore,
  setRoundScore,
  unflagFinalGameAnonymous,
} from '../../domain/tournament/mutations';
import {
  exitBandAtRank,
  roundExitRule,
  type RoomExitBand,
  type RoundExitRule,
} from '../../domain/tournament/room-exits';
import { buildTeamMap, resolveUnitQuery, unitDisplay } from '../../domain/tournament/roster';
import {
  formatStandingValue,
  getDefenderIndex,
  getUnitScore,
  orderRoomByScore,
  scoredTeamSize,
  tieResolutionList,
} from '../../domain/tournament/scoring';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { readBracketFollow, saveBracketFollow } from '../../lib/persistence/storage';
import {
  Alert,
  Badge,
  Button,
  ButtonRow,
  CommitScoreInput,
  Input,
  ScoreInput,
  cn,
} from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { bracketRowBase, resultClasses, type RowResult } from '../tournament/components/result-row';

const compactScoreClass = 'w-13 shrink-0 rounded-sm px-1.5 py-0.5 text-xs';

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
      : follow.isBye || follow.room === null
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

function memberLabel(
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
          return memberLabel(state, name, roundIndex, rawIndex, member);
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

function TeamScoreFields({ children }: { children: ReactNode }) {
  return (
    <div className='mt-1 flex flex-wrap gap-1.5 [&>label]:flex [&>label]:items-center [&>label]:gap-1 [&>label]:text-[0.68rem] [&>label]:text-muted'>
      {children}
    </div>
  );
}

/** The score inputs of one unit that takes a single score per game: one input, or G1..Gn plus a total. */
function UnitScoreFields({
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

/** The Final's score input for one unit that takes a single score per game. */
function FinalUnitScoreInput({ state, scoreKey }: { state: TournamentState; scoreKey: string }) {
  const app = useTournamentApp();
  return (
    <CommitScoreInput
      className={compactScoreClass}
      min='0'
      step={1}
      value={String(state.finalScores[scoreKey] ?? '')}
      onCommit={(value) => app.updateState((current) => setFinalScore(current, scoreKey, value))}
    />
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

/** Shown on a unit the organiser placed, moved or reinstated through a line-up correction. */
function ManualMarker() {
  return (
    <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' title='Set by organiser' tone='accent'>
      ✋
    </Badge>
  );
}

function FinalColumn({
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
  const memberInputs = scoredTeamSize(state);
  const teamMap = buildTeamMap(state);
  const games = round.numGames ?? 1;
  const activeTab = Math.min(tab, games);
  const canFlagAnonymous =
    !teamSize &&
    round.bracket !== 'grand-final' &&
    activeTab > 0 &&
    !(round.anonymousGames ?? []).includes(activeTab) &&
    assignments.every(
      (assignment) =>
        progress.units.find((unit) => unit.name === assignment.name)?.perGame[activeTab - 1] == null,
    );
  const isActiveGameAnonymous = (round.anonymousGames ?? []).includes(activeTab);
  const inputsPerTeam = editable && tab !== 0 && !isActiveGameAnonymous ? memberInputs : undefined;
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
                (round.anonymousGames ?? []).includes(index + 1) && 'border-warning text-warning',
              )}
              onClick={() => onTabChange(index + 1)}
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
            onClick={() => onTabChange(0)}
          >
            📊 Total
          </Button>
        </div>
      ) : null}
      {editable && tab !== 0 ? (
        <div className='mb-1 flex flex-wrap items-center gap-1.5'>
          <span className='text-[0.68rem] font-semibold tracking-[0.05em] text-primary uppercase'>
            Game {activeTab} — enter scores
          </span>
          {canFlagAnonymous || isActiveGameAnonymous ? (
            <Button
              size='sm'
              className={cn(
                'px-1.5 py-0.5 text-[0.65rem]',
                isActiveGameAnonymous && 'border-warning text-warning',
              )}
              onClick={() =>
                app.updateState((current) =>
                  isActiveGameAnonymous
                    ? unflagFinalGameAnonymous(current, activeTab)
                    : flagFinalGameAnonymous(current, activeTab),
                )
              }
            >
              {isActiveGameAnonymous ? '🎭 Anonymous — click to undo' : '🎭 Make anonymous'}
            </Button>
          ) : null}
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
                {assignments.find((entry) => entry.name === name)?.manual ? <ManualMarker /> : null}
              </span>
              <span
                className={cn('text-xs font-bold text-muted', winner && 'text-primary')}
                title={progress.isGrandFinal ? 'Games won' : 'Cumulative Final score'}
              >
                {progress.isGrandFinal ? unit.wins : unit.total}
              </span>
            </div>
            {teamSize && !inputsPerTeam ? (
              <TeamMembers state={state} name={name} roundIndex={roundIndex} />
            ) : null}
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {unit.perGame.map((score, game) => (
                <span className={score === null ? 'opacity-50' : ''} key={game}>
                  G{game + 1} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                </span>
              ))}
            </div>
            {editable && tab !== 0 && isActiveGameAnonymous ? (
              <div className='mt-1 text-[0.68rem] text-warning'>Scored anonymously — see side panel →</div>
            ) : null}
            {editable && tab !== 0 && !isActiveGameAnonymous ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
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
                      const key = `game${activeTab}-${name}-m${memberIndex}`;
                      return (
                        <label key={key}>
                          <span>{memberLabel(state, name, roundIndex, memberIndex, member.name)}</span>
                          <CommitScoreInput
                            className={compactScoreClass}
                            min='0'
                            step={1}
                            value={String(state.finalScores[key] ?? '')}
                            onCommit={(value) =>
                              app.updateState((current) => setFinalScore(current, key, value))
                            }
                          />
                        </label>
                      );
                    })}
                  </TeamScoreFields>
                ) : (
                  <FinalUnitScoreInput state={state} scoreKey={`game${activeTab}-${name}`} />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * A sibling box to the Final's own RoundColumn, one per Final round that has
 * ever had a game flagged anonymous -- shows each placeholder alias's score
 * strip (and, if editable, its live score-entry field for the currently
 * selected game), plus a "Connect & Reveal" action once every game is
 * actually filled (real or placeholder). realKey/the real name stays hidden
 * (anonymousFinalsProgressState's own gate, not just a display choice here)
 * until that specific alias has been connected.
 */
function AnonymousFinalCard({
  state,
  roundIndex,
  round,
  editable,
  activeTab,
}: {
  state: TournamentState;
  roundIndex: number;
  round: TournamentRound;
  editable: boolean;
  activeTab: number;
}) {
  const app = useTournamentApp();
  const progress = anonymousFinalsProgressState(state, round);
  if (progress.length === 0) return null;
  const readyToConnect = isPlainFinalFullyScored(state, roundIndex, round);
  const anonymousGames = round.anonymousGames ?? [];
  return (
    <div
      className={cn(
        roundColumnWidthClass(false),
        'overflow-hidden rounded-lg border border-warning/40 bg-surface',
      )}
    >
      <div className='flex w-full items-center gap-1 border-b border-surface-hover bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-warning uppercase'>
        🎭 Anonymous matches
      </div>
      <div className='p-2.5'>
        {progress.map((entry) => (
          <div className={bracketRowBase} key={entry.alias}>
            <div className='flex items-center gap-1.5'>
              <span className='min-w-0 flex-1 truncate'>
                {entry.connected && entry.realKey
                  ? `${entry.alias} → ${unitDisplay(state, entry.realKey).label}`
                  : entry.alias}
              </span>
            </div>
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {anonymousGames.map((game) => {
                const score = entry.perGame[game] ?? null;
                return (
                  <span className={score === null ? 'opacity-50' : ''} key={game}>
                    G{game} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                  </span>
                );
              })}
            </div>
            {editable && !entry.connected && anonymousGames.includes(activeTab) ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{activeTab}</span>
                <CommitScoreInput
                  className={compactScoreClass}
                  min='0'
                  step={1}
                  value={String(state.finalScores[`game${activeTab}-${entry.alias}`] ?? '')}
                  onCommit={(value) =>
                    app.updateState((current) =>
                      setFinalScore(current, `game${activeTab}-${entry.alias}`, value),
                    )
                  }
                />
              </div>
            ) : null}
            {editable && !entry.connected && readyToConnect ? (
              <Button
                size='sm'
                className='mt-1 border-warning px-1.5 py-0.5 text-[0.65rem] text-warning'
                onClick={() => app.updateState((current) => connectAnonymousFinalist(current, entry.alias))}
              >
                🔓 Connect & reveal
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
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

function KingsValleyDisclaimer() {
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>⛰ Kings Valley: </span>
      Top finishers promote to the room above, bottom finishers demote to the room below, the rest stay. The
      lowest room with a real match eliminates its bottom finishers instead, and anyone alone in a room keeps
      their place — see each room's own chips above for the exact counts.
    </div>
  );
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function destinationLabel(roundIndex: number, labels: ReturnType<typeof bracketRoundLabels>): string {
  return labels[roundIndex]?.label ?? `Round ${roundIndex + 1}`;
}

function rankRangeText(fromRank: number, toRank: number): string {
  return fromRank === toRank ? `${fromRank}` : `${fromRank}–${toRank}`;
}

function exitBandTone(kind: RoomExitBand['kind']): 'success' | 'danger' | 'accent' | 'warning' | 'neutral' {
  switch (kind) {
    case 'advance':
    case 'promote':
      return 'success';
    case 'drop':
    case 'demote':
      return 'warning';
    case 'lucky-chance':
      return 'accent';
    case 'eliminate':
      return 'danger';
    case 'stay':
      return 'neutral';
  }
}

function roomExitChipText(band: RoomExitBand, labels: ReturnType<typeof bracketRoundLabels>): string {
  switch (band.kind) {
    case 'advance':
    case 'drop':
      return `${rankRangeText(band.fromRank, band.toRank)} → ${destinationLabel(band.destination, labels)}`;
    case 'eliminate':
      return `${rankRangeText(band.fromRank, band.toRank)} out`;
    case 'lucky-chance':
      return `${band.rank} ★ lucky loser?`;
    case 'promote':
      return `${rankRangeText(band.fromRank, band.toRank)} ↑ Room ${roomLetter(band.targetRoom)}`;
    case 'stay':
      return `${rankRangeText(band.fromRank, band.toRank)} stay`;
    case 'demote':
      return `${rankRangeText(band.fromRank, band.toRank)} ↓ Room ${roomLetter(band.targetRoom)}`;
  }
}

/**
 * The round a scored row's own destination tag should name -- waterfall and
 * double-elimination rounds only (see the call site), null everywhere else
 * (an eliminated row, or a Kings Valley promote/stay/demote row, which never
 * gets a tag at all). A lucky-chance rank that actually won the spot reports
 * the room's own `advance` destination (the same place a direct advancer
 * from this room goes); one that didn't reports wherever `otherwise` sends
 * it -- a drop's real destination, or null when eliminated outright.
 */
function exitBandDestination(
  band: RoomExitBand | null,
  isLucky: boolean,
  advanceDestination: number | undefined,
): number | null {
  if (!band) return null;
  if (band.kind === 'advance' || band.kind === 'drop') return band.destination;
  if (band.kind === 'lucky-chance') {
    if (isLucky) return advanceDestination ?? null;
    return band.otherwise === 'eliminate' ? null : band.otherwise.drop;
  }
  return null;
}

/** The small colour-coded chips under a room's own label describing exactly how it exits -- the same rule the row colours and destination tags (Stage 3) read from, so all three always agree. Renders in every state (future/current/past) since roundExitRule itself is score-independent. */
function RoomExitChips({
  bands,
  labels,
}: {
  bands: RoomExitBand[];
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (!bands.length) return null;
  return (
    <div className='mb-1 flex flex-wrap gap-1'>
      {bands.map((band, index) => (
        <Badge
          className='rounded-md px-1.5 py-px text-[0.62rem] leading-snug normal-case tracking-normal whitespace-normal'
          key={index}
          title={
            band.kind === 'lucky-chance'
              ? `The best ${ordinal(band.rank)} place across all rooms, by share of its room's total, also advances (${band.spots} spot${band.spots === 1 ? '' : 's'})`
              : undefined
          }
          tone={exitBandTone(band.kind)}
        >
          {roomExitChipText(band, labels)}
        </Badge>
      ))}
    </div>
  );
}

/** The one round-level exit line for a round whose exit isn't per-room (a no-elim warm-up, a qual/Swiss/group-stage round, or the standings cut-off into the bracket) -- null for 'per-room' (room chips cover it) and 'none' (Final/grand-final, nothing to say). */
function RoundExitSummary({
  rule,
  labels,
}: {
  rule: RoundExitRule;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (rule.kind === 'per-room' || rule.kind === 'none') return null;
  const text =
    rule.kind === 'all-advance'
      ? 'Everyone advances'
      : rule.kind === 'standings'
        ? rule.counted
          ? 'Counts toward standings'
          : 'Seeding only, not counted'
        : `Top ${rule.advancing} ${rule.perGroup ? 'per group' : 'in standings'} → ${destinationLabel(rule.destination, labels)}`;
  return (
    <Badge
      className='mb-2 px-2 py-0.5 text-[0.65rem] leading-snug normal-case tracking-normal whitespace-normal'
      tone={rule.kind === 'standings' && !rule.counted ? 'neutral' : 'primary'}
    >
      {text}
    </Badge>
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
      const scoring = state.gamemodeConfig.scoring ?? 'fairpoints';
      const scoringUnit = scoring === 'positional-points' ? 'pts' : 'FP';
      const heading =
        'groupLabel' in tie && tie.groupLabel
          ? `⚠ Tie-break required — Group ${tie.groupLabel} qualification cutoff (${formatStandingValue(tie.fp, scoring)} ${scoringUnit})`
          : 'score' in tie
            ? `⚠ Tie-break required — Room ${roomLetter(tie.rm)} (score ${tie.score})`
            : `⚠ Tie-break required — Qualification cutoff (${formatStandingValue(tie.fp, scoring)} ${scoringUnit})`;
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
  roundIndex,
  state,
  projected,
  labels,
}: {
  round: TournamentRound;
  roundIndex: number;
  state: TournamentState;
  projected: ProjectedSlotLabel[][] | null;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (!round.rooms.length) return <div className='text-muted'>Not yet seeded</div>;
  const rule = roundExitRule(state, roundIndex);
  const summary = <RoundExitSummary rule={rule} labels={labels} />;
  if (round.fixedRoomAssignments) {
    // A pre-published draw -- the real room assignment is already fully
    // decided at generation time (see fixed-draws.ts / docs/seeding.md), so
    // show it directly instead of a projected/TBD placeholder, matching the
    // whole point of publishing a draw upfront.
    const byRoom = new Map<number, string[]>();
    const byes: string[] = [];
    for (const entry of round.fixedRoomAssignments) {
      if (entry.room === null) {
        byes.push(entry.name);
      } else {
        byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
      }
    }
    return (
      <>
        {summary}
        {round.rooms.map((slots, roomIndex) => (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomLetter(roomIndex + 1)} ({slots})
            </RoomLabel>
            {(byRoom.get(roomIndex + 1) ?? []).map((name) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={name}
              >
                {unitDisplay(state, name).label}
              </div>
            ))}
          </div>
        ))}
        {byes.map((name) => (
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
  if (round.isGroupStage) {
    return (
      <>
        {summary}
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
      {summary}
      {round.rooms.map((slots, roomIndex) => {
        const roomLabels = projected?.[roomIndex] ?? null;
        const bands = rule.kind === 'per-room' ? rule.rooms[roomIndex] : [];
        return (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomLetter(roomIndex + 1)} ({slots})
            </RoomLabel>
            <RoomExitChips bands={bands} labels={labels} />
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
      {round.isKingsValley ? <KingsValleyDisclaimer /> : null}
      {round.pairingTBD ? (
        <div className='mt-1.5 text-[0.68rem] text-warning'>Pairings determined live</div>
      ) : null}
    </>
  );
}

/** A scored row's own small muted "→ SemiB" / "→ LB Round 4" -- see exitBandDestination for which rows get one. */
function DestinationTag({
  destination,
  labels,
}: {
  destination: number | null;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  if (destination === null) return null;
  return (
    <span className='ml-1 text-[0.62rem] whitespace-nowrap text-muted'>
      → {destinationLabel(destination, labels)}
    </span>
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
  labels,
  finalTab,
  onFinalTabChange,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followKey: string | null;
  projected: ProjectedSlotLabel[][] | null;
  labels: ReturnType<typeof bracketRoundLabels>;
  finalTab?: number;
  onFinalTabChange?: (tab: number) => void;
}) {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (!assignments.length) {
    // A round already reached with nobody in it (a removal left it no units).
    if (roundIndex <= state.curRound) return <div className='text-muted'>Nobody reached this round.</div>;
    return (
      <PlaceholderRound
        round={round}
        roundIndex={roundIndex}
        state={state}
        projected={projected}
        labels={labels}
      />
    );
  }
  if (round.isFinal)
    return (
      <FinalColumn
        state={state}
        roundIndex={roundIndex}
        editable={editable && roundIndex === state.curRound}
        followed={followKey}
        tab={finalTab ?? 1}
        onTabChange={onFinalTabChange ?? (() => {})}
      />
    );
  const exitRule = roundExitRule(state, roundIndex);
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const memberInputs = scoredTeamSize(state);
  const teamMap = buildTeamMap(state);
  const rowsEditable = editable && roundIndex === state.curRound;
  const inputsPerTeam = rowsEditable ? memberInputs : undefined;
  const games = round.numGames ?? 1;
  const luckyNames = state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
  let cutoffAdvancing: Set<string> | null = null;
  if (!round.bracket && !round.isKingsValley) {
    try {
      cutoffAdvancing = computeStandingsCutoffAdvancing(state, roundIndex);
    } catch (error) {
      console.error(`Standings-cutoff computation failed for round ${round.roundNum}`, error);
    }
  }
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
      <RoundExitSummary rule={exitRule} labels={labels} />
      {round.rooms.map((_, roomIndex) => {
        const room = roomIndex + 1;
        const units = assignments.filter((entry) => entry.room === room);
        const bands = exitRule.kind === 'per-room' ? exitRule.rooms[roomIndex] : [];
        if (isByeLikeRound(round) && isUncontestedRoom(state, roundIndex, room)) {
          // Only Kings Valley has a band for a lone room ("1 stay");
          // roundExitRule gives every other bye-like round none here.
          return (
            <div className='mb-2' key={room}>
              <RoomLabel>
                {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {roomLetter(room)}{' '}
                (1)
              </RoomLabel>
              <RoomExitChips bands={bands} labels={labels} />
              <div className={cn(bracketRowBase, resultClasses('', followKey === units[0].name))}>
                <span className='block truncate' title={unitDisplay(state, units[0].name).label}>
                  {unitDisplay(state, units[0].name).label}
                </span>
                <span className='block text-xs text-muted'>
                  No opponent — treated as a bye, no score needed
                </span>
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
          <div className='mb-2' key={room}>
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
              const perRoomResult: RowResult = !band
                ? 'eliminate'
                : band.kind === 'lucky-chance'
                  ? lucky
                    ? 'lucky'
                    : band.otherwise === 'eliminate'
                      ? 'eliminate'
                      : 'drop'
                  : band.kind;
              const result: RowResult = pending
                ? 'pending'
                : !showResults
                  ? ''
                  : cutoffAdvancing
                    ? cutoffAdvancing.has(entry.name)
                      ? 'advance'
                      : 'eliminate'
                    : round.isNoElim
                      ? 'advance'
                      : perRoomResult;
              const destination =
                showDestinationTags && showResults
                  ? exitBandDestination(band, lucky, advanceDestination)
                  : null;
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
                  <div className={cn(bracketRowBase, resultClasses(result, followed))} key={entry.name}>
                    <div className='flex items-center gap-1.5'>
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
                                <span>
                                  {memberLabel(state, entry.name, roundIndex, memberIndex, member.name)}
                                </span>
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
                              <span>
                                {memberLabel(state, entry.name, roundIndex, memberIndex, member.name)}
                              </span>
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
                  <div className={cn(bracketRowBase, resultClasses(result, followed))} key={entry.name}>
                    <div className='flex items-center gap-1.5'>
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
                  className={cn(bracketRowBase, 'flex items-center gap-1.5', resultClasses(result, followed))}
                  key={entry.name}
                >
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
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.luckyCount > 0 && !round.isNoElim && roundIndex === state.curRound ? (
        <LuckyLoserStandingsPanel state={state} roundIndex={roundIndex} />
      ) : null}
      {round.isKingsValley ? <KingsValleyDisclaimer /> : null}
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

/** The width-affecting classes for a round column at a given collapsed state. */
function roundColumnWidthClass(collapsed: boolean) {
  return cn(collapsed ? 'w-8.5 min-w-8.5' : 'w-52.5 min-w-52.5', 'shrink-0');
}

function RoundColumn({
  accent,
  children,
  collapsed = false,
  current = false,
  followed = false,
  gameCount,
  label,
  onToggle,
  roundIndex,
}: {
  accent?: string;
  children: ReactNode;
  collapsed?: boolean;
  current?: boolean;
  followed?: boolean;
  gameCount?: RoundGameCount | null;
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
  const labelWithGameCount = (
    <>
      {label}
      {gameCount ? (
        <span className='ml-auto font-normal tracking-normal text-muted normal-case'>
          {gameCount.upTo ? 'up to ' : ''}
          {gameCount.games} games
        </span>
      ) : null}
    </>
  );
  return (
    <div
      className={cn(
        roundColumnWidthClass(collapsed),
        'overflow-hidden rounded-lg border border-surface-hover bg-surface',
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
          {labelWithGameCount}
        </button>
      ) : (
        <div className={headerClass}>{labelWithGameCount}</div>
      )}
      {!collapsed ? <div className='p-2.5'>{children}</div> : null}
    </div>
  );
}

/**
 * A `wave` box's content: the winners-bracket (WB) round's own rooms,
 * followed -- only when this wave actually has losers-bracket (LB) rounds
 * trailing it, which isn't guaranteed (the FFA/team shared-final
 * double-elimination variant can defer a WB round's drops into a *later*
 * round's LB absorption, leaving `losersRoundIndices` empty) -- by a thin
 * divider and every LB round's own rooms stacked beneath it. When two LB
 * rounds land in the same wave (the head-to-head/race variant's middle
 * rounds), each gets its own small round-identifying sub-label first,
 * since `roomLetter()` restarts at "Room A" independently per round and
 * two stacked "Room A" blocks would otherwise be ambiguous about which
 * round they belong to. Each LB round's own wrapper carries `data-ri` so
 * `chooseFollow` can still scroll/highlight it individually, not just the
 * wave's WB anchor.
 */
function WaveBoxBody({
  state,
  box,
  editable,
  followKey,
  projectedSlots,
  labels,
}: {
  state: TournamentState;
  box: Extract<BracketBox, { kind: 'wave' }>;
  editable: boolean;
  followKey: string | null;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  labels: ReturnType<typeof bracketRoundLabels>;
}) {
  const hasLosers = box.losersRoundIndices.length > 0;
  return (
    <>
      {hasLosers ? (
        <div className='mb-1.5 text-[0.68rem] font-bold tracking-[0.05em] text-success uppercase'>
          Winners bracket
        </div>
      ) : null}
      <RoundBody
        state={state}
        roundIndex={box.winnersRoundIndex}
        editable={editable}
        followKey={followKey}
        projected={projectedSlots[box.winnersRoundIndex] ?? null}
        labels={labels}
      />
      {hasLosers ? (
        <>
          <div className='my-2.5 h-px bg-warning' />
          <div className='mb-1.5 text-[0.68rem] font-bold tracking-[0.05em] text-warning uppercase'>
            Losers bracket
          </div>
          {box.losersRoundIndices.map((roundIndex, index) => (
            <div className={index > 0 ? 'mt-2.5' : undefined} data-ri={roundIndex} key={roundIndex}>
              {box.losersRoundIndices.length > 1 ? (
                <div className='mb-1 text-[0.65rem] font-semibold text-muted'>
                  Round {state.rounds[roundIndex]?.roundNum}
                </div>
              ) : null}
              <RoundBody
                state={state}
                roundIndex={roundIndex}
                editable={editable}
                followKey={followKey}
                projected={projectedSlots[roundIndex] ?? null}
                labels={labels}
              />
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

/**
 * Renders a tournament's rounds as one flowing row of boxes, one per
 * `bracketBoxes()` entry. A double-elimination winners-bracket (WB) round
 * and every losers-bracket (LB) round immediately following it share one
 * box (`WaveBoxBody` above) -- LB is a section *inside* WB's own box, not
 * a separate row or column, per the organiser's explicit request after
 * reviewing the previous two-row layout live. Every other round (pre-
 * bracket rounds, the terminal Final) is its own ordinary box, labeled via
 * `bracketRoundLabels()` exactly as before. Degenerates to the exact
 * original single-row rendering for every non-double-elimination format
 * (single-elimination, Kings Valley, pooling-only), by construction --
 * `bracketBoxes()` never produces a `wave` box when no round is tagged
 * `bracket === 'winners'`. Shared between `BracketView` (editable, has
 * collapse/follow state) and `ArchivedBracket` (read-only, has neither)
 * via optional props.
 */
function BracketRounds({
  state,
  labels,
  projectedSlots,
  editable,
  followKey,
  collapse,
  onToggleCollapse,
  followedRounds,
}: {
  state: TournamentState;
  labels: ReturnType<typeof bracketRoundLabels>;
  projectedSlots: ReturnType<typeof projectFutureRoundSlots>;
  editable: boolean;
  followKey: string | null;
  collapse?: Record<number, boolean>;
  onToggleCollapse?: (roundIndex: number, collapsed: boolean) => void;
  followedRounds?: BracketFollowStatus['rounds'];
}) {
  const boxes = bracketBoxes(state);
  const finalRoundIndex = useMemo(() => state.rounds.findIndex((round) => round.isFinal), [state.rounds]);
  const finalRound = finalRoundIndex >= 0 ? state.rounds[finalRoundIndex] : null;
  const finalProgress = finalRound ? finalsProgressState(state, finalRoundIndex, finalRound) : null;
  const [finalTabOverride, setFinalTabOverride] = useState<number | null>(null);
  const finalTab = finalTabOverride ?? finalProgress?.nextGame ?? 1;
  function renderSingle(roundIndex: number) {
    const collapsed = collapse?.[roundIndex] ?? bracketRoundDefaultCollapsed(roundIndex, state.curRound);
    const column = (
      <RoundColumn
        accent={labels[roundIndex]?.accent}
        collapsed={collapsed}
        current={roundIndex === state.curRound}
        followed={Boolean(followedRounds?.[roundIndex])}
        gameCount={roundGameCount(state, roundIndex)}
        key={roundIndex}
        label={labels[roundIndex]?.label}
        onToggle={onToggleCollapse ? () => onToggleCollapse(roundIndex, collapsed) : undefined}
        roundIndex={roundIndex}
      >
        <RoundBody
          state={state}
          roundIndex={roundIndex}
          editable={editable}
          followKey={followKey}
          projected={projectedSlots[roundIndex] ?? null}
          labels={labels}
          finalTab={roundIndex === finalRoundIndex ? finalTab : undefined}
          onFinalTabChange={roundIndex === finalRoundIndex ? setFinalTabOverride : undefined}
        />
      </RoundColumn>
    );
    if (roundIndex !== finalRoundIndex || !finalRound || state.anonymousFinalists.length === 0) return column;
    return (
      <Fragment key={roundIndex}>
        {column}
        <AnonymousFinalCard
          state={state}
          roundIndex={roundIndex}
          round={finalRound}
          editable={editable && roundIndex === state.curRound}
          activeTab={finalTab}
        />
      </Fragment>
    );
  }
  function renderWave(box: Extract<BracketBox, { kind: 'wave' }>) {
    const constituents = [box.winnersRoundIndex, ...box.losersRoundIndices];
    const lastIndex = Math.max(...constituents);
    const collapsed =
      collapse?.[box.winnersRoundIndex] ?? bracketRoundDefaultCollapsed(lastIndex, state.curRound);
    return (
      <RoundColumn
        accent={labels[box.winnersRoundIndex]?.accent}
        collapsed={collapsed}
        current={constituents.includes(state.curRound)}
        followed={constituents.some((roundIndex) => Boolean(followedRounds?.[roundIndex]))}
        gameCount={roundGameCount(state, box.winnersRoundIndex)}
        key={box.winnersRoundIndex}
        label={`Round ${state.rounds[box.winnersRoundIndex]?.roundNum}`}
        onToggle={onToggleCollapse ? () => onToggleCollapse(box.winnersRoundIndex, collapsed) : undefined}
        roundIndex={box.winnersRoundIndex}
      >
        <WaveBoxBody
          state={state}
          box={box}
          editable={editable}
          followKey={followKey}
          projectedSlots={projectedSlots}
          labels={labels}
        />
      </RoundColumn>
    );
  }
  return (
    <div className='flex max-w-full gap-3.5 overflow-x-auto pb-3' id='br-rounds'>
      {boxes.map((box) => (box.kind === 'single' ? renderSingle(box.roundIndex) : renderWave(box)))}
    </div>
  );
}

export function BracketView() {
  const app = useTournamentApp();
  const [collapse, setCollapse] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState('');
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
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
          ? document.querySelector<HTMLElement>(`#br-rounds [data-ri="${status.lastRi}"]`)
          : null;
        column?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
      <BracketRounds
        state={app.state}
        labels={labels}
        projectedSlots={projectedSlots}
        editable={editable}
        followKey={followKey}
        collapse={collapse}
        onToggleCollapse={(roundIndex, collapsed) =>
          setCollapse((current) => ({ ...current, [roundIndex]: !collapsed }))
        }
        followedRounds={follow?.rounds}
      />
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
    <BracketRounds
      state={state}
      labels={labels}
      projectedSlots={projectedSlots}
      editable={false}
      followKey={null}
    />
  );
}
