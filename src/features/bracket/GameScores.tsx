import { cn } from '../../components/ui';
import { type GameColumn, gameColumnLabel } from '../../domain/tournament/game-columns';
import { stickyEndClass, stickyLeadClass } from './game-columns';

const cellClassName = 'w-9.5 shrink-0 text-right whitespace-nowrap';

/** A room row's game scores: `—` for a game not typed yet. */
function scoreText(score: number | null): string {
  return score === null ? '—' : String(score);
}

/** The header of a room that shows its game scores: one column per game (the games not played in one), then the result, then the points. */
export function GamesHeader({
  columns,
  label,
  points,
}: {
  columns: GameColumn[];
  label: 'WINS' | 'TOTAL' | 'SCORE';
  points: boolean;
}) {
  return (
    <div className='flex h-6 items-center gap-2 bg-surface px-3 text-[11px] font-extrabold tracking-[0.08em] text-cfp-text-dim'>
      <span className={cn('flex self-stretch', stickyLeadClass)} />
      {columns.map((column) => (
        <span className={cellClassName} key={gameColumnLabel(column)}>
          {gameColumnLabel(column)}
        </span>
      ))}
      <span className={cn('flex items-center justify-end gap-2', stickyEndClass)}>
        <span className={cn('text-right', points ? 'w-11.5' : 'w-12')}>{label}</span>
        {points ? <span className='w-9 text-right'>PTS</span> : null}
      </span>
    </div>
  );
}

/** The cell of the games not played: a dash once the match is decided (they never will be), empty while it is still being played. */
export function GameCells({
  columns,
  scores,
}: {
  columns: GameColumn[];
  /** The unit's score in each game, null for one not typed yet; null itself for an absentee, whose cells stay blank so the columns keep their place. */
  scores: Array<number | null> | null;
}) {
  return columns.map((column) => (
    <span className={cn(cellClassName, 'text-sm text-muted')} key={gameColumnLabel(column)}>
      {scores === null
        ? null
        : column.kind === 'game'
          ? scoreText(scores[column.game - 1] ?? null)
          : column.decided
            ? '–'
            : null}
    </span>
  ));
}
