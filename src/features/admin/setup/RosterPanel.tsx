import { useState } from 'react';
import { getGameFormat, unitLabelPluralLower } from '../../../domain/tournament/formats';
import { resetRoster } from '../../../domain/tournament/mutations';
import {
  findDuplicateDisplayNames,
  parseIndividualLines,
  parseMemberLine,
  parseTeamLines,
} from '../../../domain/tournament/roster';
import { Button, ButtonRow, FieldDisplay, PanelTitle, Panel, Textarea } from '../../../components/ui';
import { EditingTag } from '../../presence/EditingTag';
import { PresenceField } from '../../presence/PresenceField';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { useSetupChange } from './useSetupChange';

/** The roster, reserves and individual reserves as typed, and the buttons that load or clear them. */
export function RosterPanel({ onLoaded }: { onLoaded: () => void }) {
  const { state, setup, runtime, updateState } = useTournamentApp();
  const change = useSetupChange();
  const [status, setStatus] = useState('');
  const format = getGameFormat(setup.gameFormat);
  const teamSize = format?.teamSize;

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
      const reserveIndividuals = parseIndividualLines(setup.reserveIndividuals).map(parseMemberLine);
      updateState({
        ...state,
        players,
        reserves,
        reserveIndividuals,
        confirmedCount: players.length,
      });
      setStatus(
        `${players.length} confirmed, ${reserves.length} reserves, ${reserveIndividuals.length} individual reserves`,
      );
    } else {
      const players = parseIndividualLines(setup.roster.trim());
      const reserves = parseIndividualLines(setup.reserves.trim());
      const duplicates = findDuplicateDisplayNames([...players, ...reserves]);
      if (duplicates.length) {
        window.alert(
          `These name(s) are used more than once across the roster and reserves — every player needs a unique name:\n\n${duplicates.join('\n')}`,
        );
        return;
      }
      updateState({
        ...state,
        players,
        reserves,
        reserveIndividuals: [],
        confirmedCount: players.length,
      });
      setStatus(`${players.length} confirmed, ${reserves.length} reserves`);
    }
    onLoaded();
  }

  return (
    <Panel>
      <PresenceField htmlFor='cfg-n-display' label={`Registered ${unitLabelPluralLower(setup.gameFormat)}`}>
        <FieldDisplay id='cfg-n-display'>
          {state.confirmedCount ?? '—'}
          {state.reserves.length ? ` (+ ${state.reserves.length} reserves)` : ''}
        </FieldDisplay>
      </PresenceField>
      <PanelTitle hint={<>— confirmed {teamSize ? 'teams' : 'players'}, one per line</>}>
        Roster
        <EditingTag field='roster' />
      </PanelTitle>
      <Textarea
        id='cfg-roster'
        value={setup.roster}
        onChange={(e) => change('roster', e.target.value)}
        placeholder={
          teamSize
            ? `Team Rocket, ${Array.from({ length: teamSize }, (_, i) => `Player${i + 1}`).join(', ')}`
            : 'Harald\nLagtop\nArisu\n...'
        }
      />
      <PanelTitle className='mt-4' hint='— one per line'>
        Reserves
        <EditingTag field='reserves' />
      </PanelTitle>
      <Textarea
        id='cfg-reserves'
        className='min-h-15'
        value={setup.reserves}
        onChange={(e) => change('reserves', e.target.value)}
      />
      {teamSize ? (
        <>
          <PanelTitle className='mt-4' hint='— substitutes for one member'>
            Individual reserves
            <EditingTag field='reserveIndividuals' />
          </PanelTitle>
          <Textarea
            id='cfg-reserve-individuals'
            className='min-h-15'
            value={setup.reserveIndividuals}
            onChange={(e) => change('reserveIndividuals', e.target.value)}
          />
        </>
      ) : null}
      <ButtonRow>
        <Button onClick={loadRoster}>Load roster & reserves</Button>
        <Button
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
    </Panel>
  );
}
