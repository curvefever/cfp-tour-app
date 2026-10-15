import { useEffect, useState } from 'react';
import { rosterKeys, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { ColumnTitleBar } from '../bracket/ColumnTitleBar';
import { formatScheduledAt } from '../tournaments/tournament-info';
import { ColumnRows, type ColumnRow } from './ColumnRows';
import { registeredLine } from './players-line';

/** The start time as this visitor reads it ("Sat 18 Oct, 20:00"); empty until the page is in the browser, where the time zone is known. */
function useStartText(scheduledAt: number | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (scheduledAt === null) return;
    setText(formatScheduledAt(scheduledAt, Date.now(), { relative: false }));
  }, [scheduledAt]);
  return scheduledAt === null ? null : text;
}

function numbered(state: TournamentState, names: string[]): ColumnRow[] {
  return names.map((name, index) => {
    const info = unitDisplay(state, name);
    return { key: name, number: String(index + 1), label: info.label, members: info.members ?? null };
  });
}

/** The roster before the tournament starts, in the order it was registered, and the reserves under it. */
export function PlayersList({ state }: { state: TournamentState }) {
  const startsAt = useStartText(state.info?.scheduledAt ?? null);
  const reserves = rosterKeys(state.reserves);
  return (
    <div className='flex flex-col gap-5.5'>
      <p className='text-base text-cfp-text-soft'>{registeredLine(state, startsAt)}</p>
      <ColumnRows label='Registered players' rows={numbered(state, rosterKeys(state.players))} />
      {reserves.length ? (
        <section className='flex flex-col gap-3'>
          <ColumnTitleBar title='Reserves' />
          <ColumnRows ground='card' label='Reserves' rows={numbered(state, reserves)} />
        </section>
      ) : null}
    </div>
  );
}
