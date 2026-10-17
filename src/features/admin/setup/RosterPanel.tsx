import { useState } from 'react';
import { getGameFormat } from '../../../domain/tournament/formats';
import { resetRoster, withLoadedRoster } from '../../../domain/tournament/mutations';
import {
  findDuplicateDisplayNames,
  parseIndividualLines,
  parseMemberLine,
  parseTeamLines,
  rosterFitsFormat,
  rosterNames,
} from '../../../domain/tournament/roster';
import type { TournamentState } from '../../../domain/tournament/types';
import { Button, ButtonRow, SectionPanel, Textarea } from '../../../components/ui';
import { PresenceField } from '../../presence/PresenceField';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { refuseUnstorableNames } from '../../tournament/unstorable-names';
import { plural } from './plural';
import { rosterLoadStatus } from './roster-status';
import { useSetupChange } from './useSetupChange';

/** The header count of the roster: "37 players · 2 reserves", or a nudge while none is loaded. */
function rosterCount(state: TournamentState, unit: string): string {
  if (state.confirmedCount === null) return 'No roster loaded yet';
  const reserves = state.reserves.length;
  return `${state.confirmedCount} ${unit}${reserves ? ` · ${plural(reserves, 'reserve')}` : ''}`;
}

/** The roster, reserves and individual reserves as typed, and the buttons that load or clear them. */
export function RosterPanel({ onLoaded }: { onLoaded: () => void }) {
  const { state, setup, runtime, updateState } = useTournamentApp();
  const change = useSetupChange();
  const [status, setStatus] = useState('');
  const format = getGameFormat(setup.gameFormat);
  const teamSize = format?.teamSize;
  const unit = teamSize ? 'teams' : 'players';
  const staleFormat = state.confirmedCount !== null && !rosterFitsFormat(state, setup.gameFormat);

  function loadRoster() {
    if (!format) return;
    if (teamSize) {
      const players = parseTeamLines({
        value: setup.roster.trim(),
        idPrefix: 'team',
        teamSize,
        ids: runtime.ids,
      });
      const reserves = parseTeamLines({
        value: setup.reserves.trim(),
        idPrefix: 'reserveteam',
        teamSize,
        ids: runtime.ids,
      });
      const reserveIndividuals = parseIndividualLines(setup.reserveIndividuals).map(parseMemberLine);
      const typedNames = [
        ...rosterNames([...players, ...reserves]),
        ...reserveIndividuals.map((member) => member.name),
      ];
      if (refuseUnstorableNames(typedNames)) return;
      const empty = [...players, ...reserves].filter((team) => team.members.every((member) => !member));
      if (empty.length) {
        const message = `These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line:\n\n${empty.map((team) => team.teamName).join('\n')}`;
        window.alert(message);
        return;
      }
      const duplicateTeams = findDuplicateDisplayNames([...players, ...reserves]);
      if (duplicateTeams.length) {
        window.alert(
          `These team name(s) are used more than once across the roster and reserves — every team needs a unique name:\n\n${duplicateTeams.join('\n')}`,
        );
        return;
      }
      updateState(withLoadedRoster(state, setup.gameFormat, { players, reserves, reserveIndividuals }));
      setStatus(rosterLoadStatus(players.length, reserves.length, reserveIndividuals.length));
    } else {
      const players = parseIndividualLines(setup.roster.trim());
      const reserves = parseIndividualLines(setup.reserves.trim());
      if (refuseUnstorableNames([...players, ...reserves])) return;
      const duplicates = findDuplicateDisplayNames([...players, ...reserves]);
      if (duplicates.length) {
        window.alert(
          `These name(s) are used more than once across the roster and reserves — every player needs a unique name:\n\n${duplicates.join('\n')}`,
        );
        return;
      }
      updateState(withLoadedRoster(state, setup.gameFormat, { players, reserves, reserveIndividuals: [] }));
      setStatus(rosterLoadStatus(players.length, reserves.length));
    }
    onLoaded();
  }

  return (
    <SectionPanel
      hint={
        staleFormat ? (
          <span className='text-warning'>Game format changed — load the roster again</span>
        ) : (
          rosterCount(state, unit)
        )
      }
      title='ROSTER'
    >
      <PresenceField className='mb-0' htmlFor='cfg-roster' label={`Roster — confirmed ${unit}, one per line`}>
        <Textarea
          id='cfg-roster'
          className='min-h-40'
          value={setup.roster}
          onChange={(e) => change('roster', e.target.value)}
          placeholder={
            teamSize
              ? `Team Rocket, ${Array.from({ length: teamSize }, (_, i) => `Player${i + 1}`).join(', ')}`
              : 'Harald\nLagtop\nArisu\n...'
          }
        />
      </PresenceField>
      <PresenceField className='mb-0' htmlFor='cfg-reserves' label='Reserves — one per line'>
        <Textarea
          id='cfg-reserves'
          className='min-h-15'
          value={setup.reserves}
          onChange={(e) => change('reserves', e.target.value)}
        />
      </PresenceField>
      {teamSize ? (
        <PresenceField
          className='mb-0'
          htmlFor='cfg-reserve-individuals'
          label='Individual reserves — substitutes for one member'
        >
          <Textarea
            id='cfg-reserve-individuals'
            className='min-h-15'
            value={setup.reserveIndividuals}
            onChange={(e) => change('reserveIndividuals', e.target.value)}
          />
        </PresenceField>
      ) : null}
      <ButtonRow>
        <Button onClick={loadRoster}>Load roster & reserves</Button>
        <Button
          variant='danger'
          disabled={!state.players.length && !state.reserves.length}
          onClick={() => {
            if (
              window.confirm(
                'Clear the registered roster? This removes all players/teams and reserves, and any generated schedule preview. Tournament settings (format, schedule logic, etc.) are kept.',
              )
            )
              updateState(resetRoster(state));
          }}
        >
          ↺ Clear roster
        </Button>
        <span className='self-center text-xs text-muted'>{status}</span>
      </ButtonRow>
    </SectionPanel>
  );
}
