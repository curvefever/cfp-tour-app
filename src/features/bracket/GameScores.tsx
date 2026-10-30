import { cn } from '../../components/ui';

const cellClassName = 'w-9.5 shrink-0 text-right';

/** A room row's game scores: `—` for a game not typed yet or not needed. */
function scoreText(score: number | null): string {
  return score === null ? '—' : String(score);
}

/** The header of a room that shows its game scores: one column per game (none in the line layout), then the result, then the points. */
export function GamesHeader({
  columns,
  label,
  points,
}: {
  columns: number;
  label: 'WINS' | 'TOTAL' | 'SCORE';
  points: boolean;
}) {
  return (
    <div className='flex h-6 items-center gap-2 px-3 text-[11px] font-extrabold tracking-[0.08em] text-cfp-text-dim'>
      <span className='w-4.5 shrink-0' />
      <span className='flex-1' />
      {Array.from({ length: columns }, (_, game) => (
        <span className={cellClassName} key={game}>
          G{game + 1}
        </span>
      ))}
      <span className={cn('shrink-0 text-right', points ? 'w-11.5' : 'w-12')}>{label}</span>
      {points ? <span className='w-9 shrink-0 text-right'>PTS</span> : null}
    </div>
  );
}

/** The game cells between a row's name and its result; an absentee (`scores` null) gets blank cells, so the columns keep their place. */
export function GameColumns({ games, scores }: { games: number; scores: Array<number | null> | null }) {
  return Array.from({ length: games }, (_, game) => (
    <span className={cn(cellClassName, 'text-sm text-muted')} key={game}>
      {scores ? scoreText(scores[game] ?? null) : null}
    </span>
  ));
}

/** The line under a name that holds every game's score when a room has too many games for columns: `200 · 120 · 210`. */
export function GameScoresLine({ scores }: { scores: Array<number | null> }) {
  return <span className='text-[13px] text-muted'>{scores.map(scoreText).join(' · ')}</span>;
}
