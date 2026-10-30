/**
 * The match format of every round: the one place that decides a round's `bestOf` / `numGames` from its stage, the
 * round overrides and the config. Every builder of rounds (generation, a rebuilt future, the Kings Valley tail)
 * runs its rounds through `applyMatchFormats`, so no builder knows its own stage's format.
 *
 * A round's format = its override (stored by `roundNoteNames`, written as a ROUNDS-line token: "BO3", "GAMES 2"),
 * else its stage's format, else one game. A graph round of a Custom bracket and the race Grand Final have no stage.
 */
import { stageMatchFields } from './match-format';
import { isPoolingRound } from './pooling';
import { roundNoteNames } from './round-notes';
import type { MaterializedGamemodeConfig, TournamentRound } from './types';
import { parseMatchFormatToken } from './waterfall-bracket';

export type RoundStage = 'pooling' | 'bracket' | 'losers' | 'semis' | 'finals';

/** The stage formats and round overrides of a config, each absent for its default. */
export type MatchFormatConfig = Partial<
  Pick<
    MaterializedGamemodeConfig,
    | 'poolingGames'
    | 'poolingBestOf'
    | 'bracketGames'
    | 'bracketBestOf'
    | 'losersGames'
    | 'losersBestOf'
    | 'semisGames'
    | 'semisBestOf'
    | 'finalsGames'
    | 'finalsBestOf'
    | 'matchOverrides'
  >
>;

/**
 * The overrides a Setup text holds, one "Round 2: BO3" line each: the round name, a colon, a ROUNDS-line token. A
 * line that spells no match format is left out, and a name written twice takes its last line.
 */
export function parseMatchOverrides(text: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.lastIndexOf(':');
    const name = line.slice(0, colon).trim();
    const token = line.slice(colon + 1).trim();
    if (colon > 0 && name && parseMatchFormatToken(token)) overrides[name] = token;
  }
  return overrides;
}

/** The Setup text of some overrides, in the order given. */
export function matchOverridesText(overrides: Record<string, string>): string {
  return Object.entries(overrides)
    .map(([name, token]) => `${name}: ${token}`)
    .join('\n');
}

/** The stage a round belongs to; null for a graph round of a Custom bracket and for the race Grand Final, which keep their own format. */
export function matchStage(round: TournamentRound): RoundStage | null {
  if (round.isWaterfall || round.bracket === 'grand-final') return null;
  if (round.isFinal) return 'finals';
  if (round.isSemis) return 'semis';
  if (isPoolingRound(round)) return 'pooling';
  return round.bracket === 'losers' ? 'losers' : 'bracket';
}

/** A stage's format: summed `games`, or a Best of N when `bestOf` is set. */
function stageFormat(stage: RoundStage, config: MatchFormatConfig): { games: number; bestOf?: number } {
  switch (stage) {
    case 'pooling':
      return { games: config.poolingGames ?? 1, bestOf: config.poolingBestOf };
    case 'bracket':
      return { games: config.bracketGames ?? 1, bestOf: config.bracketBestOf };
    case 'losers':
      return { games: config.losersGames ?? 1, bestOf: config.losersBestOf };
    case 'semis':
      return { games: config.semisGames ?? 1, bestOf: config.semisBestOf };
    case 'finals':
      return { games: config.finalsGames ?? 3, bestOf: config.finalsBestOf };
  }
}

/** The format of one round, or null when it has no stage. */
function roundFormat(
  round: TournamentRound,
  name: string,
  config: MatchFormatConfig,
): { games: number; bestOf?: number } | null {
  const stage = matchStage(round);
  if (!stage) return null;
  const override = config.matchOverrides?.[name];
  return (override === undefined ? null : parseMatchFormatToken(override)) ?? stageFormat(stage, config);
}

/**
 * The rounds with their match format set, from `from` on (the rounds before it are returned as they are). The Semis
 * and the Final always carry theirs; any other round carries one only when it is not the default single game, so a
 * freshly built round with nothing to say stays as the builder made it.
 */
export function applyMatchFormats(
  rounds: TournamentRound[],
  config: MatchFormatConfig,
  from = 0,
): TournamentRound[] {
  const names = roundNoteNames({ rounds });
  return rounds.map((round, index) => {
    if (index < from) return round;
    const format = roundFormat(round, names[index], config);
    if (!format) return round;
    const { bestOf, games } = format;
    const stage = matchStage(round);
    const { bestOf: _bestOf, numGames: _numGames, ...unformatted } = round;
    if (bestOf === undefined && games === 1 && stage !== 'semis' && stage !== 'finals') return unformatted;
    return { ...unformatted, ...stageMatchFields(games, bestOf, Math.max(1, ...round.rooms)) };
  });
}
