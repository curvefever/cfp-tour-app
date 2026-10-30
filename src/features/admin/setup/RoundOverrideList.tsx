import { matchOverrideRows, withMatchOverride } from '../../../domain/tournament/round-match-formats';
import { EditingTag } from '../../presence/EditingTag';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { overrideTokenOf, stageFormatLabel } from './format-fields';
import { OrphanOverrideRow, RoundOverrideRow } from './RoundOverrideRow';
import { useMatchSettingsChange } from './useMatchSettingsChange';

const HELP =
  "A round can play a format of its own instead of its stage's. Choosing the stage format clears it.";

/** The drawn schedule's rounds, each with a match format select of its own; nothing before a schedule is drawn or once it has started. */
export function RoundOverrideList() {
  const { state, setup } = useTournamentApp();
  const changeMatch = useMatchSettingsChange();
  if (!state.rounds.length || state.started) return null;
  const rows = matchOverrideRows(state, setup.matchOverrides);
  if (rows.length === 0) return null;

  const setOverride = (name: string, token: string) =>
    changeMatch({ matchOverrides: withMatchOverride(setup.matchOverrides, name, token) });
  return (
    <div className='mt-1 flex flex-col gap-2.5'>
      <div>
        <div className='text-sm font-bold'>
          Round formats
          <EditingTag field='matchOverrides' />
        </div>
        <p className='mt-1 text-[13px] text-muted'>{HELP}</p>
      </div>
      <div className='grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5'>
        {rows.map((row, index) =>
          row.stage === undefined ? (
            <OrphanOverrideRow key={row.name} row={row} onRemove={() => setOverride(row.name, '')} />
          ) : (
            <RoundOverrideRow
              index={index}
              key={row.name}
              row={row}
              stageFormat={stageFormatLabel(row.stage, setup)}
              onChange={(value) => setOverride(row.name, overrideTokenOf(value))}
            />
          ),
        )}
      </div>
    </div>
  );
}
