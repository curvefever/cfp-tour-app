import { Select } from '../../../components/ui';
import { SETUP_BEST_OF, gamesLabel, matchSelectValue } from './format-fields';

/**
 * The Semis or Finals format: a number of summed games, or a Best of N. One select writes both settings
 * (`matchFromSelectValue`). A Best of N already set stays listed even where it would not be offered, so the
 * select shows what generation will refuse.
 */
export function MatchSelect({
  id,
  games,
  bestOf,
  bestOfOffered,
  disabled,
  onChange,
}: {
  id: string;
  games: string;
  bestOf: string;
  bestOfOffered: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const showBestOf = bestOfOffered || bestOf.trim() !== '';
  return (
    <Select
      disabled={disabled}
      id={id}
      value={matchSelectValue(games, bestOf)}
      onChange={(e) => onChange(e.target.value)}
    >
      {[1, 2, 3, 4].map((n) => (
        <option key={n} value={n}>
          {gamesLabel(n)}
        </option>
      ))}
      {showBestOf
        ? SETUP_BEST_OF.map((n) => (
            <option key={`bo${n}`} value={`bo${n}`}>
              Best of {n}
            </option>
          ))
        : null}
    </Select>
  );
}
