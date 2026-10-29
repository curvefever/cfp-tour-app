import { useState } from 'react';
import {
  answerAbsence,
  markSurvivalMemberAbsent,
  unmarkSurvivalMemberAbsent,
} from '../../domain/tournament/absences';
import { swapWindowOpen } from '../../domain/tournament/mutations';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { Badge, Button, Select } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import {
  type AbsentMatchRow,
  absentMatchRows,
  streakText,
  survivalMarkChoices,
  survivalMarkRows,
} from './absent-panel';
import { removePlayer, removeTeamUnit, swapPlayer, swapTeamUnit } from './RankingsRoster';
import { ToolIconButton, ToolPanel, ToolRow } from './ToolPanel';

type App = ReturnType<typeof useTournamentApp>;

/** The swap and remove buttons of an absent unit still on the roster; the swap is closed once eliminations start. */
function UnitTools({ app, row, state }: { app: App; row: AbsentMatchRow; state: TournamentState }) {
  const team = (state.players as Array<string | TournamentTeam>).find(
    (entry): entry is TournamentTeam => typeof entry !== 'string' && entry.teamId === row.unit,
  );
  const onRoster = team !== undefined || (state.players as Array<string | TournamentTeam>).includes(row.unit);
  if (!onRoster) return null;
  const teamSize = team?.members.length ?? 0;
  const swapsOpen = swapWindowOpen(state);
  return (
    <>
      <ToolIconButton
        disabled={!swapsOpen}
        glyph='⇄'
        label={`Swap ${row.label}`}
        onClick={() =>
          team ? swapTeamUnit(state, team, teamSize, app) : swapPlayer(state, row.unit, app.updateState)
        }
        title={swapsOpen ? 'Swap' : 'Swaps closed — eliminations have started'}
      />
      <ToolIconButton
        danger
        glyph='✕'
        label={`Remove ${row.label}`}
        onClick={() => (team ? removeTeamUnit(state, team, app) : removePlayer(state, row.unit, app))}
        title='Remove'
      />
    </>
  );
}

function MatchRow({ app, row, state }: { app: App; row: AbsentMatchRow; state: TournamentState }) {
  const streak = row.latest ? streakText(row.streak) : '';
  return (
    <ToolRow
      controls={
        <>
          {row.canMarkPlayed ? (
            <ToolIconButton
              glyph='↺'
              label={`Mark ${row.label} as played`}
              onClick={() => app.updateState((current) => answerAbsence(current, row.keys, 'played'))}
              title='Mark as played'
            />
          ) : null}
          {row.latest ? <UnitTools app={app} row={row} state={state} /> : null}
        </>
      }
    >
      {row.label}
      <span className='font-normal text-muted'>
        {' '}
        · {row.where}
        {streak ? ` · ${streak}` : ''}
      </span>
    </ToolRow>
  );
}

/** "＋ Mark a member absent": pick a team of the column in play, then one of its members (Survival Teams only; display only). */
function MarkMemberPicker({ app, state }: { app: App; state: TournamentState }) {
  const [open, setOpen] = useState(false);
  const [seat, setSeat] = useState('');
  const [member, setMember] = useState('');
  const choices = survivalMarkChoices(state);
  if (!choices.length) return null;
  const chosen = choices.find((choice) => `${choice.roundIndex}:${choice.room}:${choice.position}` === seat);
  const mark = () => {
    if (!chosen || member === '') return;
    app.updateState((current) =>
      markSurvivalMemberAbsent(current, chosen.roundIndex, chosen.room, chosen.position, Number(member)),
    );
    setMember('');
  };
  return (
    <ToolRow
      controls={
        <Button onClick={() => setOpen((shown) => !shown)} size='sm'>
          {open ? 'Close' : '＋ Mark a member absent'}
        </Button>
      }
    >
      {open ? (
        <span className='flex flex-wrap items-center gap-2 font-normal'>
          <Select
            aria-label='Team of the member to mark absent'
            className='py-1 text-sm'
            onChange={(event) => {
              setSeat(event.target.value);
              setMember('');
            }}
            value={seat}
          >
            <option value=''>Team…</option>
            {choices.map((choice) => (
              <option
                key={`${choice.roundIndex}:${choice.room}:${choice.position}`}
                value={`${choice.roundIndex}:${choice.room}:${choice.position}`}
              >
                {choice.teamLabel}
              </option>
            ))}
          </Select>
          <Select
            aria-label='Member to mark absent'
            className='py-1 text-sm'
            disabled={!chosen}
            onChange={(event) => setMember(event.target.value)}
            value={member}
          >
            <option value=''>Member…</option>
            {chosen?.members
              .filter((entry) => !entry.marked)
              .map((entry) => (
                <option key={entry.memberIndex} value={entry.memberIndex}>
                  {entry.name}
                </option>
              ))}
          </Select>
          <Button disabled={!chosen || member === ''} onClick={mark} size='sm' variant='warning'>
            Mark absent
          </Button>
        </span>
      ) : (
        'Survival Teams: a member can be marked absent by hand (shown only)'
      )}
    </ToolRow>
  );
}

/**
 * Admins only, in the organiser tools: the units absent in a match (with ↺ Mark as played while the round is in
 * play, and the unit's swap and remove), the units absent from the start (removed before ever playing), and in
 * Survival Teams the members marked absent by hand.
 */
export function AbsentPanel({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const matches = absentMatchRows(state);
  const marks = survivalMarkRows(state);
  const fromStart = state.withdrawnUnits.filter((unit) => !unit.playedAnyMatch);
  const picker = state.started ? survivalMarkChoices(state).length > 0 : false;
  if (!matches.length && !marks.length && !fromStart.length && !picker) return null;
  return (
    <ToolPanel title='Absent'>
      {matches.map((row) => (
        <MatchRow app={app} key={row.id} row={row} state={state} />
      ))}
      {marks.map((row) => (
        <ToolRow
          controls={
            <ToolIconButton
              glyph='↺'
              label={`Take back the absent mark of ${row.label}`}
              onClick={() =>
                app.updateState((current) =>
                  unmarkSurvivalMemberAbsent(
                    current,
                    row.roundIndex,
                    row.room,
                    row.position,
                    row.memberIndex,
                  ),
                )
              }
              title='Take back'
            />
          }
          key={`mark-${row.id}`}
        >
          {row.label}
          <span className='font-normal text-muted'> · {row.where} · marked absent by hand</span>
        </ToolRow>
      ))}
      {fromStart.map((unit) => (
        <ToolRow controls={<Badge>Absent</Badge>} key={`absent-${unit.name}`}>
          {unit.label}
        </ToolRow>
      ))}
      {picker ? <MarkMemberPicker app={app} state={state} /> : null}
    </ToolPanel>
  );
}
