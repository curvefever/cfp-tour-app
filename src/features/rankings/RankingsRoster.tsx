import { useState } from 'react';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { getGameFormat } from '../../domain/tournament/formats';
import {
  addReserveUnit,
  addWalkUpIndividual,
  fillTeamSlot,
  removeReserveUnit,
  removeRosterUnit,
  renameIndividual,
  renameTeamMember,
  setTeamDefender,
  swapIndividual,
  swapTeam,
  swapWindowOpen,
  updateTeam,
  type ReserveAddOptions,
  type ReserveAddResult,
} from '../../domain/tournament/mutations';
import { removeUnitBeforeStart } from '../../domain/tournament/pre-start-edits';
import {
  isDisplayNameTaken,
  parseTeamLines,
  rosterKeys,
  teamNames,
  unitDisplay,
  unstorableNamesMessage,
} from '../../domain/tournament/roster';
import { getDefenderIndex } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { TournamentUnit } from '../../components/tournament/TournamentUnit';
import { destinationLabel } from '../bracket/exit-text';
import { Button, Input, Select } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { refuseUnstorableNames } from '../tournament/unstorable-names';
import { ConfirmToggle, TeamConfirmationLabel } from './ConfirmToggle';
import { confirmationCountText, confirmationView, type ConfirmationView } from './confirmation-view';
import { naturalByLabel } from './ranking-order';
import { ToolIconButton, ToolPanel, ToolRow } from './ToolPanel';
import { nextColumnStart, roundInPlayOf } from '../../domain/tournament/round-columns';

/** The confirm a reserve add can ask for, with the option that answers it; null when the add needs none. */
function reserveConfirmation(
  state: TournamentState,
  label: string,
  result: ReserveAddResult,
): { text: string; options: ReserveAddOptions } | null {
  if (result.status === 'confirm-over-cap') {
    return {
      text: `All rooms are full. Adding this reserve will create an over-cap room. Proceed?`,
      options: { allowOverCap: true },
    };
  }
  if (result.status !== 'confirm-late-join') return null;
  const joinsFrom = destinationLabel(nextColumnStart(state), bracketRoundLabels(state));
  return {
    text: `"${label}" joins from ${joinsFrom} and misses ${result.missedRounds} qualifying rounds, which count as 0 points. Add anyway?`,
    options: { allowLateJoin: true },
  };
}

function handleReserveResult(
  state: TournamentState,
  label: string,
  result: ReserveAddResult,
  retry: (options: ReserveAddOptions) => ReserveAddResult,
  apply: (state: TournamentState) => void,
) {
  if (result.status === 'added') return apply(result.state);
  const confirmation = reserveConfirmation(state, label, result);
  if (confirmation) {
    if (window.confirm(confirmation.text)) {
      const retried = retry(confirmation.options);
      if (retried.status === 'added') apply(retried.state);
    }
    return;
  }
  if (result.status !== 'blocked') return;
  if (result.reason === 'generation') {
    window.alert(result.message);
    return;
  }
  const messages = {
    closed: 'Reserve window has closed — eliminations have begun.',
    'group-stage':
      "Reserves can't be added during Group Stage — group membership and the round-robin schedule are fixed once the tournament starts. To replace a no-show with a reserve, use ⇄ Swap in Manage Players until the first elimination.",
    'fixed-draw':
      "Reserves can't be added to a fixed-draw tournament — the whole schedule was already published at generation time, with no mechanism to fold a new entrant into an already-decided future round.",
    'waterfall-bracket':
      "Players can't be added to a waterfall bracket without a pooling phase — its routing is built for the exact entrant count. To replace a no-show, use ⇄ Swap until the first elimination.",
    'strict-room':
      'Can\'t add — with "None" as the odd-count strategy every pooling round must pair everyone, and one more would leave a unit out.',
    'room-cap': "Can't add this reserve — it would push a future round over the game's hard room cap.",
    'duplicate-name': 'A player with that name is already registered — pick a different name.',
    'unstorable-name': unstorableNamesMessage([label]),
  };
  window.alert(messages[result.reason]);
}

const SWAPS_CLOSED_TITLE = 'Swaps closed — eliminations have started';

/** Applies a swap, or says so when the outgoing unit is neither seated in the current round nor waiting for a later one. */
function applySwap(
  state: TournamentState,
  apply: (updater: (current: TournamentState) => TournamentState) => void,
  swap: (current: TournamentState) => TournamentState,
  unitLabel: string,
) {
  if (swap(state) === state) {
    window.alert(`Can't swap "${unitLabel}" — it isn't in the current round or waiting for a later one.`);
    return;
  }
  apply(swap);
}

/** What the Reserves panel says once eliminations have started: the window is closed; the waiting list stays visible. */
function ClosedReserves({ state }: { state: TournamentState }) {
  const format = getGameFormat(state.gameFormat);
  const waiting = rosterKeys(state.reserves).map((key) => unitDisplay(state, key).label);
  return (
    <>
      <div className='text-sm text-danger'>Reserve window closed — eliminations have started.</div>
      {format?.teamSize ? null : (
        <Input
          aria-label='Name of a new or walk-up player'
          disabled
          placeholder='Name of a new/walk-up player'
          type='text'
        />
      )}
      {waiting.length ? (
        <div className='text-sm text-cfp-text-soft'>Waiting: {waiting.join(', ')}</div>
      ) : null}
    </>
  );
}

type UpdateState = (updater: (current: TournamentState) => TournamentState) => void;

function renamePlayer(state: TournamentState, name: string, apply: UpdateState) {
  const value = window.prompt(`Rename "${name}" to:`, name);
  if (value === null || !value.trim() || value.trim() === name) return;
  if (refuseUnstorableNames([value])) return;
  if (isDisplayNameTaken(state, value, [name])) {
    window.alert(`"${value.trim()}" is already registered — pick a different name.`);
    return;
  }
  apply((current) => renameIndividual(current, name, value));
}

function swapPlayer(state: TournamentState, name: string, apply: UpdateState) {
  const value = window.prompt(`Swap out "${name}". Enter the replacement's name:`);
  if (value === null || !value.trim()) return;
  if (refuseUnstorableNames([value])) return;
  // Only the active roster is a real conflict here -- a name matching an existing reserve is legitimately
  // consumed by swapIndividual() (it promotes that reserve), matching the "+" reserve-add button's own
  // effect, so that case is not blocked.
  if ((state.players as string[]).includes(value.trim())) {
    window.alert(`"${value.trim()}" is already registered — pick a different name.`);
    return;
  }
  applySwap(state, apply, (current) => swapIndividual(current, name, value), name);
}

type RosterApp = Pick<ReturnType<typeof useTournamentApp>, 'runtime' | 'updateState'>;

/**
 * Removes a unit from the roster. Before Confirm & Start the roster count follows and, with a schedule
 * drawn, the draw is redone for the smaller roster; when it can't be, the unit is removed all the same and
 * the organiser is told why.
 */
function removeUnit(state: TournamentState, key: string, label: string, app: RosterApp) {
  if (state.started) {
    app.updateState((current) => removeRosterUnit(current, key));
    return;
  }
  const { state: next, redrawRefusal } = removeUnitBeforeStart(state, key, app.runtime);
  app.updateState(next);
  if (redrawRefusal) {
    window.alert(
      `Removed "${label}". The draw couldn't be redone: ${redrawRefusal} Round 1 keeps a short room.`,
    );
  }
}

function removePlayer(state: TournamentState, name: string, app: RosterApp) {
  if (window.confirm(`Remove "${name}" from the tournament? This cannot be undone.`))
    removeUnit(state, name, name, app);
}

const RESERVE_CHIP =
  'flex items-center gap-2 rounded-full border border-surface-hover bg-surface-low px-3 py-1 text-xs';

/** A reserve chip's name: an individual with their toggle, or a team behind its dot with each member and their toggle. */
function ReserveChipName({
  confirmations,
  name,
  state,
}: {
  confirmations: ConfirmationView;
  name: string;
  state: TournamentState;
}) {
  const team = (state.reserves as Array<string | TournamentTeam>).find(
    (entry): entry is TournamentTeam => typeof entry !== 'string' && entry.teamId === name,
  );
  if (!team)
    return (
      <>
        <TournamentUnit state={state} name={name} />
        <ConfirmToggle source={confirmations.source(name)} name={name} size='chip' />
      </>
    );
  return (
    <>
      <TeamConfirmationLabel confirmation={confirmations.team(team)}>
        <strong>{team.teamName}</strong>
      </TeamConfirmationLabel>
      {team.members.map((member) =>
        member ? (
          <span className='flex items-center gap-1' key={member.name}>
            {member.name}
            <ConfirmToggle source={confirmations.source(member.name)} name={member.name} size='chip' />
          </span>
        ) : null,
      )}
    </>
  );
}

/** The individual reserves of a team format: name and toggle only. */
function ReserveIndividualChips({
  confirmations,
  state,
}: {
  confirmations: ConfirmationView;
  state: TournamentState;
}) {
  if (!state.reserveIndividuals.length) return null;
  return (
    <div aria-label='Individual reserves' className='flex flex-wrap gap-2' role='group'>
      <span className='self-center text-xs text-muted'>Individual reserves</span>
      {state.reserveIndividuals.map((member) => (
        <div className={RESERVE_CHIP} key={member.name}>
          {member.name}
          <ConfirmToggle source={confirmations.source(member.name)} name={member.name} size='chip' />
        </div>
      ))}
    </div>
  );
}

export function ReservePanel({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [walkup, setWalkup] = useState('');
  const format = getGameFormat(state.gameFormat);
  if (!state.reserves.length && !state.reserveOpen && format?.teamSize) return null;
  const keys = state.reserves.map((entry) => (typeof entry === 'string' ? entry : entry.teamId));
  const confirmations = confirmationView(state);
  const add = (key: string) =>
    handleReserveResult(
      state,
      unitDisplay(state, key).label,
      addReserveUnit(state, key, {}, app.runtime),
      (options) => addReserveUnit(state, key, options, app.runtime),
      app.updateState,
    );
  const addWalkUp = () => {
    handleReserveResult(
      state,
      walkup.trim(),
      addWalkUpIndividual(state, walkup, {}, app.runtime),
      (options) => addWalkUpIndividual(state, walkup, options, app.runtime),
      app.updateState,
    );
    setWalkup('');
  };
  return (
    <ToolPanel title='Reserves'>
      <div className='flex flex-col gap-2.5 px-4.5 py-3.5'>
        {!state.reserveOpen ? (
          <ClosedReserves state={state} />
        ) : (
          <>
            {!format?.teamSize ? (
              <div className='flex items-center gap-2'>
                <Input
                  className='min-w-0 flex-1'
                  type='text'
                  placeholder='Name of a new/walk-up player'
                  value={walkup}
                  onChange={(event) => setWalkup(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addWalkUp();
                  }}
                />
                <Button
                  className='shrink-0 whitespace-nowrap'
                  size='sm'
                  variant='warning'
                  onClick={addWalkUp}
                >
                  ＋ Add new player
                </Button>
              </div>
            ) : null}
            <div className='my-2.5 flex flex-wrap gap-2'>
              {keys.map((key) => (
                <div className={RESERVE_CHIP} key={key}>
                  <ReserveChipName confirmations={confirmations} name={key} state={state} />
                  <Button
                    aria-label={`Add ${key}`}
                    className='size-6 min-h-0 p-0 text-warning'
                    onClick={() => add(key)}
                    size='sm'
                    variant='ghost'
                  >
                    ＋
                  </Button>
                  <Button
                    aria-label={`Remove ${key}`}
                    className='size-6 min-h-0 p-0 text-warning'
                    onClick={() => app.updateState((current) => removeReserveUnit(current, key))}
                    size='sm'
                    variant='ghost'
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            {format?.teamSize ? <ReserveIndividualChips confirmations={confirmations} state={state} /> : null}
            <div className='mt-1 text-xs text-muted'>
              {keys.length
                ? `Click ＋ to add a reserve. ${state.started ? 'They join from the next round' : 'Before Confirm & Start the draw is redone with them in; after, they join from the next round'} (during the first bracket round of a tournament without pooling: the least-full room).`
                : `No ${format?.teamSize ? 'reserve teams' : 'reserves'} on the bench.`}
            </div>
          </>
        )}
      </div>
    </ToolPanel>
  );
}

export function ManageRoster({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const format = getGameFormat(state.gameFormat);
  if (!state.players.length) return null;
  const swapsOpen = swapWindowOpen(state);
  const swapTitle = (open: string) => (swapsOpen ? open : SWAPS_CLOSED_TITLE);
  const confirmations = confirmationView(state);
  const count = confirmationCountText(confirmations.summary);
  if (!format?.teamSize) {
    const names = naturalByLabel((state.players as string[]).map((name) => ({ label: name }))).map(
      (unit) => unit.label,
    );
    return (
      <ToolPanel
        className='flex-[2_1_520px]'
        count={count}
        note={swapsOpen ? null : SWAPS_CLOSED_TITLE}
        title='Manage players'
      >
        <div className='[columns:2_260px] gap-x-0'>
          {names.map((name) => (
            <ToolRow
              className='break-inside-avoid'
              controls={
                <>
                  <ConfirmToggle source={confirmations.source(name)} name={name} />
                  <ToolIconButton
                    glyph='✎'
                    label={`Rename ${name}`}
                    onClick={() => renamePlayer(state, name, app.updateState)}
                    title='Rename'
                  />
                  <ToolIconButton
                    disabled={!swapsOpen}
                    glyph='⇄'
                    label={`Swap ${name}`}
                    onClick={() => swapPlayer(state, name, app.updateState)}
                    title={swapTitle('Swap')}
                  />
                  <ToolIconButton
                    danger
                    glyph='✕'
                    label={`Remove ${name}`}
                    onClick={() => removePlayer(state, name, app)}
                    title='Remove'
                  />
                </>
              }
              key={name}
            >
              {name}
            </ToolRow>
          ))}
        </div>
      </ToolPanel>
    );
  }
  const teams = state.players as TournamentTeam[];
  const sortedTeams = naturalByLabel(teams.map((team) => ({ label: team.teamName, team }))).map(
    (unit) => unit.team,
  );
  return (
    <ToolPanel
      className='flex-[2_1_520px]'
      count={count}
      note={swapsOpen ? null : SWAPS_CLOSED_TITLE}
      title='Manage teams'
    >
      <div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 p-3'>
        {sortedTeams.map((team) => {
          const defender = getDefenderIndex(state, team.teamId, roundInPlayOf(state, team.teamId));
          return (
            <div
              className='flex min-w-0 flex-col items-stretch gap-2 rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
              key={team.teamId}
            >
              <div className='flex items-center justify-between gap-2'>
                <TeamConfirmationLabel confirmation={confirmations.team(team)}>
                  <strong>{team.teamName}</strong>
                </TeamConfirmationLabel>
                <span className='flex gap-1'>
                  <Button
                    aria-label={`Rename team ${team.teamName}`}
                    className='w-8.5 px-0'
                    size='sm'
                    title='Rename team'
                    onClick={() => {
                      const value = window.prompt(`Rename team "${team.teamName}" to:`, team.teamName);
                      if (!value?.trim()) return;
                      if (refuseUnstorableNames([value])) return;
                      if (isDisplayNameTaken(state, value, [team.teamId])) {
                        window.alert(
                          `A team called "${value.trim()}" is already registered — pick a different name.`,
                        );
                        return;
                      }
                      app.updateState((current) =>
                        updateTeam(current, team.teamId, (entry) => ({
                          ...entry,
                          teamName: value.trim(),
                        })),
                      );
                    }}
                  >
                    ✎
                  </Button>
                  <Button
                    aria-label={`Swap team ${team.teamName}`}
                    className='w-8.5 px-0'
                    size='sm'
                    disabled={!swapsOpen}
                    title={swapTitle('Swap team')}
                    onClick={() => {
                      const reserves = state.reserves as TournamentTeam[];
                      let replacement: TournamentTeam | undefined;
                      if (reserves.length) {
                        const menu = `Swap out "${team.teamName}".\n\n  0 — type a brand-new walk-up team\n${reserves.map((entry, index) => `  ${index + 1} — ${entry.teamName}`).join('\n')}\n\nEnter a number:`;
                        const choice = window.prompt(menu);
                        if (choice === null || !choice.trim()) return;
                        const selected = Number.parseInt(choice, 10);
                        if (
                          String(selected) !== choice.trim() ||
                          selected < 0 ||
                          selected > reserves.length
                        ) {
                          window.alert(`"${choice}" isn't one of the listed numbers.`);
                          return;
                        }
                        if (selected > 0) replacement = reserves[selected - 1];
                      }
                      if (!replacement) {
                        const placeholders = Array.from(
                          { length: format.teamSize ?? 0 },
                          (_, index) => `Player${index + 1}`,
                        ).join(', ');
                        const line = window.prompt(
                          `Enter the replacement team, same format as the roster:\n\nTeamName, ${placeholders}`,
                          `Team name, ${placeholders}`,
                        );
                        if (!line?.trim()) return;
                        replacement = parseTeamLines({
                          value: line,
                          idPrefix: 'team',
                          teamSize: format.teamSize ?? 0,
                          ids: app.runtime.ids,
                        })[0];
                        if (!replacement || replacement.members.every((member) => !member)) {
                          window.alert(
                            `"${replacement?.teamName ?? 'Team'}" has no players listed — add at least one member.`,
                          );
                          return;
                        }
                      }
                      if (refuseUnstorableNames(teamNames(replacement))) return;
                      if (
                        isDisplayNameTaken(state, replacement.teamName, [team.teamId, replacement.teamId])
                      ) {
                        window.alert(
                          `A team called "${replacement.teamName}" is already registered — pick a different name.`,
                        );
                        return;
                      }
                      applySwap(
                        state,
                        app.updateState,
                        (current) => swapTeam(current, team.teamId, replacement),
                        team.teamName,
                      );
                    }}
                  >
                    ⇄
                  </Button>
                  <Button
                    aria-label={`Remove team ${team.teamName}`}
                    className='w-8.5 px-0'
                    size='sm'
                    title='Remove team'
                    variant='danger'
                    onClick={() => {
                      if (
                        state.started &&
                        state.gamemodeConfig.oddCountStrategy === 'none' &&
                        (state.assignments[state.curRound] ?? []).some((entry) => entry.name === team.teamId)
                      ) {
                        const ideal = state.gamemodeConfig.roomSize?.ideal ?? 1;
                        const remaining = (state.assignments[state.curRound] ?? []).length - 1;
                        if (remaining % ideal !== 0) {
                          window.alert(
                            `Can't remove "${team.teamName}" — the strict odd-count strategy requires rooms of ${ideal} teams.`,
                          );
                          return;
                        }
                      }
                      if (
                        window.confirm(
                          `Remove team "${team.teamName}" from the tournament? This cannot be undone.`,
                        )
                      )
                        removeUnit(state, team.teamId, team.teamName, app);
                    }}
                  >
                    ✕
                  </Button>
                </span>
              </div>
              {Array.from({ length: format.teamSize ?? 0 }, (_, memberIndex) => {
                const member = team.members[memberIndex];
                if (!member)
                  return (
                    <div
                      className='flex items-center justify-between gap-2 border-t border-surface-hover pt-1.5 text-xs'
                      key={memberIndex}
                    >
                      <span className='text-muted'>Vacant slot</span>
                      {state.reserveOpen ? (
                        <span className='flex gap-1'>
                          {state.reserveIndividuals.length ? (
                            <Select
                              className='py-1 text-xs'
                              aria-label={`Reserve for ${team.teamName} slot ${memberIndex + 1}`}
                              defaultValue=''
                              onChange={(event) => {
                                const reserveIndex = Number.parseInt(event.target.value, 10);
                                const reserve = state.reserveIndividuals[reserveIndex];
                                if (reserve)
                                  app.updateState((current) =>
                                    fillTeamSlot(current, team.teamId, memberIndex, reserve, reserveIndex),
                                  );
                              }}
                            >
                              <option value=''>— pick a reserve —</option>
                              {state.reserveIndividuals.map((reserve, index) => (
                                <option key={`${reserve.name}-${index}`} value={index}>
                                  {reserve.name}
                                </option>
                              ))}
                            </Select>
                          ) : null}
                          <Button
                            size='sm'
                            variant='warning'
                            onClick={() => {
                              const value = window.prompt(
                                'Name of the new/walk-up player filling this slot:',
                              );
                              if (value?.trim() && !refuseUnstorableNames([value]))
                                app.updateState((current) =>
                                  fillTeamSlot(current, team.teamId, memberIndex, { name: value.trim() }),
                                );
                            }}
                          >
                            ＋ New
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  );
                return (
                  <div
                    className='flex items-center justify-between gap-2 border-t border-surface-hover pt-1.5 text-xs'
                    key={memberIndex}
                  >
                    <span>
                      {member.name}
                      {state.gamemodeConfig.teamScoringRule === 'designated-player' &&
                      defender === memberIndex
                        ? ' 🛡 Defender'
                        : ''}
                    </span>
                    <span className='flex gap-1'>
                      <ConfirmToggle source={confirmations.source(member.name)} name={member.name} />
                      {state.gamemodeConfig.teamScoringRule === 'designated-player' &&
                      defender !== memberIndex ? (
                        <Button
                          aria-label={`Make ${member.name} defender`}
                          className='w-8.5 px-0'
                          size='sm'
                          title='Make defender'
                          onClick={() =>
                            app.updateState((current) => setTeamDefender(current, team.teamId, memberIndex))
                          }
                        >
                          🛡
                        </Button>
                      ) : null}
                      <Button
                        aria-label={`Rename ${member.name}`}
                        className='w-8.5 px-0'
                        size='sm'
                        title='Rename member'
                        onClick={() => {
                          const value = window.prompt(`Rename "${member.name}" to:`, member.name);
                          if (value?.trim() && !refuseUnstorableNames([value]))
                            app.updateState((current) =>
                              renameTeamMember(current, team.teamId, memberIndex, value),
                            );
                        }}
                      >
                        ✎
                      </Button>
                      <Button
                        aria-label={`Remove ${member.name}`}
                        className='w-8.5 px-0'
                        size='sm'
                        title='Remove member'
                        variant='danger'
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove "${member.name}" from team "${team.teamName}"? This cannot be undone.`,
                            )
                          )
                            app.updateState((current) =>
                              updateTeam(current, team.teamId, (entry) => ({
                                ...entry,
                                members: entry.members.map((item, index) =>
                                  index === memberIndex ? null : item,
                                ),
                              })),
                            );
                        }}
                      >
                        ✕
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </ToolPanel>
  );
}
