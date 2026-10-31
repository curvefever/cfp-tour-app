import { Select } from '../../../components/ui';
import { SETUP_BEST_OF, gamesLabel, matchSelectValue } from './format-fields';

/**
 * The Semis or Finals format: a number of summed games, or a Best of N. One select writes both settings
 * (`matchFromSelectValue`). With `inheritLabel`, a first option with that text stands for no format of its own
 * (the empty value), as a round override's select needs.
 */
export function MatchSelect({
  id,
  games,
  bestOf,
  disabled,
  inheritLabel,
  maxBestOf,
  onChange,
}: {
  id: string;
  games: string;
  bestOf: string;
  disabled?: boolean;
  inheritLabel?: string;
  /** The largest Best of N on offer: a larger one is listed but cannot be picked. */
  maxBestOf?: number;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      disabled={disabled}
      id={id}
      value={matchSelectValue(games, bestOf)}
      onChange={(e) => onChange(e.target.value)}
    >
      {inheritLabel === undefined ? null : <option value=''>{inheritLabel}</option>}
      {[1, 2, 3, 4].map((n) => (
        <option key={n} value={n}>
          {gamesLabel(n)}
        </option>
      ))}
      {SETUP_BEST_OF.map((n) => (
        <option key={`bo${n}`} value={`bo${n}`} disabled={maxBestOf !== undefined && n > maxBestOf}>
          Best of {n}
          {maxBestOf !== undefined && n > maxBestOf ? ' — not with match results' : ''}
        </option>
      ))}
    </Select>
  );
}
