import type { GameFormatKey } from '../../../domain/tournament/types';
import { Select } from '../../../components/ui';
import { PresenceField } from '../../presence/PresenceField';
import {
  FORMAT_KIND_LABELS,
  formatKind,
  keyAfterTeamSizeChange,
  keyAfterTeamsPerRoomChange,
  keyForKind,
  teamShape,
  teamSizeChoices,
  teamsPerRoomChoices,
  type FormatKind,
} from './game-format-choice';

/** The Game format kind (FFA, 1v1, Teams) and, for Teams, players per team and teams per room; all end in `onChange(key)`. */
export function GameFormatFields({
  gameFormat,
  onChange,
}: {
  gameFormat: GameFormatKey;
  onChange: (key: GameFormatKey) => void;
}) {
  const kind = formatKind(gameFormat);
  const { teamSize, teamsPerRoom } = teamShape(gameFormat);
  return (
    <>
      <PresenceField htmlFor='cfg-game-format' label='Game format'>
        <Select
          id='cfg-game-format'
          value={kind}
          onChange={(e) => {
            const next = e.target.value as FormatKind;
            if (next !== kind) onChange(keyForKind(next));
          }}
        >
          {(Object.keys(FORMAT_KIND_LABELS) as FormatKind[]).map((option) => (
            <option key={option} value={option}>
              {FORMAT_KIND_LABELS[option]}
            </option>
          ))}
        </Select>
      </PresenceField>
      {kind === 'teams' ? (
        <>
          <PresenceField htmlFor='cfg-team-size' label='Players per team'>
            <Select
              id='cfg-team-size'
              value={teamSize}
              onChange={(e) => onChange(keyAfterTeamSizeChange(gameFormat, Number(e.target.value)))}
            >
              {teamSizeChoices().map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </PresenceField>
          <PresenceField htmlFor='cfg-teams-per-room' label='Teams per room'>
            <Select
              id='cfg-teams-per-room'
              value={teamsPerRoom}
              onChange={(e) => onChange(keyAfterTeamsPerRoomChange(gameFormat, Number(e.target.value)))}
            >
              {teamsPerRoomChoices(teamSize).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </PresenceField>
        </>
      ) : null}
    </>
  );
}
