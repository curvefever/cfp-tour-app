import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { unitLabelPluralLower } from '../../domain/tournament/formats';
import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { ColumnTitleBar } from '../bracket/ColumnTitleBar';
import { ColumnRows } from './ColumnRows';
import { Podium } from './Podium';
import { joinMembers } from '../tournament/components/member-line';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { rowSurfaceClasses, type RowResult } from '../tournament/components/result-row';
import { naturalByLabel } from './ranking-order';
import { stillInResults } from './ranking-results';
import { finalStanding } from './ranking-podium';
import { eliminatedWhere, stillInWhere, WITHDRAWN_WHERE } from './ranking-where';

type Rankings = NonNullable<ReturnType<typeof computeRankings>>;

/** One line of a list: its place (only where there is one), the stripe, the name with its members, and where it stands. */
interface ListRow {
  key: string;
  rank: string;
  result: RowResult;
  label: string;
  members: string[] | null;
  where: string;
}

function RankingRow({ index, row }: { index: number; row: ListRow }) {
  return (
    <li className={cn('flex min-h-10.5 items-center gap-2.5 px-3 py-1', rowSurfaceClasses(index, false))}>
      <span className='w-7.5 shrink-0 text-right text-[15px] font-extrabold text-muted'>{row.rank}</span>
      {/* The stripe's margin leaves 22 px beside one 24 px line, or beside a name and member line (24 + 20 px). */}
      <span className='flex w-1 shrink-0 self-stretch'>
        <ResultStripe className={row.members?.length ? 'my-2.75' : 'my-px'} result={row.result} stretch />
      </span>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='wrap-break-word text-base font-bold'>{row.label}</span>
        {row.members?.length ? (
          <span className='wrap-break-word text-[13px] leading-5 text-muted'>{joinMembers(row.members)}</span>
        ) : null}
      </span>
      <span className='shrink-0 text-sm text-muted'>{row.where}</span>
    </li>
  );
}

function RowList({ empty, rows }: { empty: string; rows: ListRow[] }) {
  return (
    <div className='rounded-xs bg-cfp-game-card outline-2 outline-cfp-game-frame'>
      {rows.length ? (
        <ul>
          {rows.map((row, index) => (
            <RankingRow index={index} key={row.key} row={row} />
          ))}
        </ul>
      ) : (
        <p className='px-3 py-3 text-sm text-muted'>{empty}</p>
      )}
    </div>
  );
}

function CountTag({ children }: { children: React.ReactNode }) {
  return (
    <span className='rounded-xs bg-foreground/10 px-1.75 py-0.75 text-[11px] leading-none font-extrabold tracking-[0.05em] text-cfp-text-soft uppercase'>
      {children}
    </span>
  );
}

function ListSection({
  count,
  empty,
  rows,
  title,
}: {
  count: string;
  empty: string;
  rows: ListRow[];
  title: string;
}) {
  return (
    <section className='flex min-w-0 flex-1 basis-140 flex-col gap-3.5'>
      <ColumnTitleBar badge={<CountTag>{count}</CountTag>} title={title} />
      <RowList empty={empty} rows={rows} />
    </section>
  );
}

function withdrawnRows(data: Rankings): ListRow[] {
  return data.dnfList.map((unit) => ({
    key: `dnf-${unit.name}`,
    rank: '—',
    result: '' as const,
    label: unit.label,
    members: unit.members,
    where: WITHDRAWN_WHERE,
  }));
}

function eliminatedRows(state: TournamentState, data: Rankings): ListRow[] {
  const labels = bracketRoundLabels(state);
  return data.eliminatedList.map((unit) => ({
    key: unit.name,
    rank: String(unit.rank),
    result: 'eliminate' as const,
    label: unit.label,
    members: unit.members,
    where: eliminatedWhere(state, unit, labels),
  }));
}

function stillInRows(state: TournamentState, data: Rankings): ListRow[] {
  const labels = bracketRoundLabels(state);
  const results = stillInResults(state, data.lastRi, data.stillActive);
  return naturalByLabel(data.stillActive).map((unit) => ({
    key: unit.name,
    rank: '',
    result: results.get(unit.name) ?? '',
    label: unit.label,
    members: unit.members,
    where: stillInWhere(state, data.lastRi, unit, labels),
  }));
}

/** After the Final: the podium, then everyone from the fourth entry down in three columns (no stripes, no tags). */
function FinishedRankings({ data, state }: { data: Rankings; state: TournamentState }) {
  const { podium, rest } = finalStanding(state, data);
  return (
    <div className='flex flex-col gap-5.5'>
      <Podium cards={podium} />
      {rest.length ? (
        <ColumnRows
          label='Standings from fourth place'
          rows={rest.map((row) => ({
            key: row.key,
            number: row.rank,
            label: row.label,
            members: row.members,
            note: row.where,
          }))}
        />
      ) : null}
    </div>
  );
}

/**
 * The lists of Rankings: while the tournament runs, "Still in" and "Eliminated" side by side (the withdrawn at the
 * end of the second, with no stripe); after the Final, one list of everybody from first place down.
 */
export function RankingsLists({ data, state }: { data: Rankings; state: TournamentState }) {
  const unit = unitLabelPluralLower(state.gameFormat).toUpperCase();
  if (data.finalComplete) return <FinishedRankings data={data} state={state} />;
  const out = [...eliminatedRows(state, data), ...withdrawnRows(data)];
  const still = stillInRows(state, data);
  return (
    <div className='flex flex-wrap items-start gap-5.5'>
      <ListSection
        count={`${still.length} ${unit}`}
        empty={`Nobody is still in.`}
        rows={still}
        title='Still in'
      />
      <ListSection
        count={`${out.length} ${unit}`}
        empty={`Nobody is out yet.`}
        rows={out}
        title='Eliminated'
      />
    </div>
  );
}
