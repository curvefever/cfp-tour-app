import { roomMatch } from './match-format';
import { getUnitScoreForGame } from './scoring';
import type { GameFormatKey, MatchResultCode, TournamentState } from './types';

/**
 * Match-result scoring: a head-to-head match of a group stage gives points by how it was won. Per game, a win by more
 * than the tie margin is a Win, a win by the margin or less a Tie Win, the same for a loss, and equal scores a Tie.
 * A Best of 3 is read as one match: 2-0 is a Win / Loss, 2-1 a Tie Win / Tie Loss.
 */

/** The four points of a match result, in the order Win, Tie win, Tie loss, Loss. */
export type MatchResultPoints = [number, number, number, number];

export interface MatchResultSettings {
  points: MatchResultPoints;
  /** The gap in points, at most, between a Tie Win (or Tie Loss) and a Win (or Loss). */
  tieMargin: number;
}

/** The default `points` of a Setup form. */
export const DEFAULT_MATCH_RESULT_POINTS = '3, 2, 1, 0';

/** The tie margin of a game format, for the formats whose target score the organiser has given us. Other formats start with an empty field. */
const DEFAULT_TIE_MARGINS: Partial<Record<GameFormatKey, number>> = {
  'team-4v4': 100,
};

export function defaultTieMargin(gameFormat: GameFormatKey): number | undefined {
  return DEFAULT_TIE_MARGINS[gameFormat];
}

/** The settings of a tournament scored by match results, or null for any other tournament. */
export function matchResultSettings(
  state: Pick<TournamentState, 'gamemodeConfig'>,
): MatchResultSettings | null {
  const { scoring, matchResultPoints, tieMargin } = state.gamemodeConfig;
  if (scoring !== 'match-results' || matchResultPoints === undefined || tieMargin === undefined) return null;
  return { points: matchResultPoints, tieMargin };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** "3, 2, 1, 0": four numbers of 0 or more, Win first, that never increase from one result to the next. */
export function parseMatchResultPoints(text: string): Parsed<MatchResultPoints> {
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length !== 4) {
    return {
      ok: false,
      message: `Match result points need four values (Win, Tie win, Tie loss, Loss), like "${DEFAULT_MATCH_RESULT_POINTS}" — got "${text}".`,
    };
  }
  const values = parts.map((part) => (part === '' ? Number.NaN : Number(part)));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ok: false, message: `Match result points must be numbers of 0 or more — got "${text}".` };
  }
  if (values.some((value, index) => index > 0 && value > values[index - 1])) {
    return {
      ok: false,
      message: `Match result points must not increase from Win to Loss (Win ≥ Tie win ≥ Tie loss ≥ Loss) — got ${values.join(', ')}.`,
    };
  }
  return { ok: true, value: values as MatchResultPoints };
}

/** The tie margin: the typed whole number of points, else the format's default; a format without one needs it typed. */
export function resolveTieMargin(
  text: string,
  gameFormat: GameFormatKey,
  formatLabel: string,
): Parsed<number> {
  const typed = text.trim();
  if (typed === '') {
    const fallback = defaultTieMargin(gameFormat);
    if (fallback !== undefined) return { ok: true, value: fallback };
    return {
      ok: false,
      message: `Match results need a tie margin for ${formatLabel} — enter the most points a win can have by and still be a tie win (for example 100).`,
    };
  }
  if (!/^\d+$/.test(typed)) {
    return { ok: false, message: `Tie margin must be a whole number of points, 0 or more — got "${text}".` };
  }
  return { ok: true, value: Number(typed) };
}

/** The result of one game for the unit whose score minus its opponent's is `gap`. */
export function resultOfGap(gap: number, tieMargin: number): MatchResultCode {
  if (gap === 0) return 'T';
  if (gap > 0) return gap > tieMargin ? 'W' : 'TW';
  return -gap > tieMargin ? 'L' : 'TL';
}

const MIRROR: Record<MatchResultCode, MatchResultCode> = { W: 'L', TW: 'TL', TL: 'TW', L: 'W', T: 'T' };

/** What a result is worth. A Tie is the average of Tie Win and Tie Loss. */
export function pointsOfResult(code: MatchResultCode, points: MatchResultPoints): number {
  const [win, tieWin, tieLoss, loss] = points;
  const byCode: Record<MatchResultCode, number> = {
    W: win,
    TW: tieWin,
    TL: tieLoss,
    L: loss,
    T: (tieWin + tieLoss) / 2,
  };
  return byCode[code];
}

export interface UnitMatchResult {
  /** The unit's results, one per game (a Best of 3: one for the match). */
  results: MatchResultCode[];
  /** Their points, summed. */
  points: number;
}

/** The results of one unit and of its opponent, from the first unit's result codes. */
function bothSides(codes: MatchResultCode[], points: MatchResultPoints): [UnitMatchResult, UnitMatchResult] {
  const side = (results: MatchResultCode[]): UnitMatchResult => ({
    results,
    points: results.reduce((total, code) => total + pointsOfResult(code, points), 0),
  });
  return [side(codes), side(codes.map((code) => MIRROR[code]))];
}

/** The match of a Best-of room: the unit with more game wins wins it; by two or more it is a Win, by one a Tie Win. */
function bestOfCode(state: TournamentState, roundIndex: number, room: number): MatchResultCode | null {
  const match = roomMatch(state, roundIndex, room);
  if (!match?.complete || match.units.length !== 2) return null;
  const difference = match.units[0].wins - match.units[1].wins;
  if (difference === 0) return 'T';
  const code = Math.abs(difference) >= 2 ? 'W' : 'TW';
  return difference > 0 ? code : MIRROR[code];
}

/** The results of a room's games, in order, or null while one of them lacks a score. */
function gameCodes(
  state: TournamentState,
  roundIndex: number,
  room: number,
  tieMargin: number,
): MatchResultCode[] | null {
  const numGames = state.rounds[roundIndex]?.numGames ?? 1;
  const games = numGames > 1 ? numGames : 1;
  const codes: MatchResultCode[] = [];
  for (let game = 1; game <= games; game += 1) {
    const gameKey = games > 1 ? game : null;
    const first = getUnitScoreForGame(state, roundIndex, room, 0, gameKey, null);
    const second = getUnitScoreForGame(state, roundIndex, room, 1, gameKey, null);
    if (first === null || second === null) return null;
    codes.push(resultOfGap(first - second, tieMargin));
  }
  return codes;
}

/**
 * The match results of a head-to-head room (its two units in seat order), or null while the room is not fully
 * scored. A summed round has one result per game and its points are their sum; a Best of 3 has one for the match.
 */
export function matchResultsOfRoom(
  state: TournamentState,
  roundIndex: number,
  room: number,
  settings: MatchResultSettings,
): [UnitMatchResult, UnitMatchResult] | null {
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  if (seated.length !== 2) return null;
  const bestOf = state.rounds[roundIndex]?.bestOf !== undefined;
  const codes = bestOf
    ? [bestOfCode(state, roundIndex, room)].filter((code): code is MatchResultCode => code !== null)
    : gameCodes(state, roundIndex, room, settings.tieMargin);
  if (codes === null || codes.length === 0) return null;
  return bothSides(codes, settings.points);
}

/** The tie margin field after the game format changes: the new format's default while the field is empty or still holds the old format's default, else what was typed. */
export function tieMarginAfterFormatChange(typed: string, from: GameFormatKey, to: GameFormatKey): string {
  const previous = defaultTieMargin(from);
  const holdsPreviousDefault = previous !== undefined && typed.trim() === String(previous);
  if (typed.trim() !== '' && !holdsPreviousDefault) return typed;
  const next = defaultTieMargin(to);
  return next === undefined ? '' : String(next);
}

/** Match results exist only in a group stage: any other pooling phase falls back to Standard points. */
export function scoringForPooling<T extends string>(scoring: T, poolingPhase: string): T | 'fairpoints' {
  return scoring === 'match-results' && poolingPhase !== 'group-stage' ? 'fairpoints' : scoring;
}
