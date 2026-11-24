import { bracketRoundLabels, roundGameCount } from '../../domain/tournament/bracket';
import { roundExitGroups } from '../../domain/tournament/exit-groups';
import { POOLING_PHASE_WORDS } from '../../domain/tournament/formats';
import { groupExitIsTotal, groupExitShapeOf } from '../../domain/tournament/group-exit';
import type { RoundExitRule } from '../../domain/tournament/room-exits';
import { destinationGroupResult } from '../../domain/tournament/room-row-result';
import { roundSettingsByRound } from '../../domain/tournament/round-notes';
import type { TournamentState } from '../../domain/tournament/types';
import { groupExitLines } from '../tournament/components/exit-lines';
import { destinationLabel } from '../tournament/components/exit-text';
import { groupSizesText } from '../tournament/components/group-exit-text';
import { roundGamesText } from '../tournament/components/round-games-text';
import { toneOfResult } from './schedule-picture-bands';
import type { Route } from './schedule-picture-routes';
import { matchesText, placesText, sizesText } from './schedule-picture-text';
import type { PictureBlock, PicturePooling, PictureTone } from './schedule-picture-types';

type Labels = ReturnType<typeof bracketRoundLabels>;
type CutoffRule = Extract<RoundExitRule, { kind: 'standings-cutoff' }>;

/** The pooling block and the players it sends to the bracket, in the order of its destinations. */
export interface PoolingPicture {
  block: PicturePooling;
  routes: Route[];
}

/** What the places after the last pooling round read: the blocks and where they send players. */
interface Cut {
  blocks: PictureBlock[];
  routes: Route[];
}

/** Which rules make a round part of the pooling block. */
export function isPoolingRule(rule: RoundExitRule): boolean {
  return rule.kind === 'standings' || rule.kind === 'standings-cutoff' || rule.kind === 'all-advance';
}

const plain = (tone: PictureTone, text: string): PictureBlock => ({ tones: [tone], lines: [text] });

/** "Round 1", "Rounds 1–3", "Rounds 1, 3". */
function roundsText(numbers: readonly number[]): string {
  if (numbers.length === 1) return `Round ${numbers[0]}`;
  const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
  return `Rounds ${contiguous ? `${numbers[0]}–${numbers.at(-1)}` : numbers.join(', ')}`;
}

function gamesOf(state: TournamentState, index: number): string {
  const games = roundGameCount(state, index);
  return games ? roundGamesText(games) : '1 game';
}

/** A round note as one line: no **bold** marks, no line breaks. */
function noteLine(note: string): string {
  return note
    .replaceAll('**', '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function isCounted(state: TournamentState, index: number, rule: RoundExitRule): boolean {
  if (rule.kind === 'standings') return rule.counted;
  return rule.kind === 'standings-cutoff' && !state.rounds[index].excludeFromStandings;
}

/** "4 rooms · 8p and 7p", "Groups of 5, 4, 4 · 6 matches a round": how the first pooling round is laid out. */
function layoutLine(state: TournamentState, index: number, team: boolean): string {
  const round = state.rounds[index];
  const matches = round.matches?.length ? `${matchesText(round.matches.length)} a round` : null;
  if (round.isGroupStage && state.groups.length) {
    const text = groupSizesText(state.groups.map((group) => group.members.length));
    return [text.charAt(0).toUpperCase() + text.slice(1), matches].filter(Boolean).join(' · ');
  }
  if (matches) return matches;
  return `${round.rooms.length} ${round.rooms.length === 1 ? 'room' : 'rooms'} · ${sizesText(round.rooms, team)}`;
}

/** "Every round counts", "Round 1 not counted", "Not counted" (a warm-up). */
function countedLine(
  state: TournamentState,
  indices: number[],
  rules: RoundExitRule[],
  labels: Labels,
): string {
  if (rules.every((rule) => rule.kind === 'all-advance')) return 'Not counted';
  const skipped = indices.filter((index, at) => !isCounted(state, index, rules[at]));
  if (skipped.length === 0) return 'Every round counts';
  return `${roundsText(skipped.map((index) => labels[index].roundNumber))} not counted`;
}

/** The lines of the block under its title: the rounds and their games, the rooms, which rounds count, the round notes. */
function plainLines(
  state: TournamentState,
  declared: TournamentState,
  indices: number[],
  rules: RoundExitRule[],
  team: boolean,
): string[] {
  const labels = bracketRoundLabels(state);
  const games = indices.map((index) => gamesOf(declared, index));
  const sameGames = games.every((text) => text === games[0]);
  const rounds = roundsText(indices.map((index) => labels[index].roundNumber));
  const first = sameGames ? `${rounds} · ${games[0]}${indices.length > 1 ? ' each' : ''}` : rounds;
  const lines = [first, layoutLine(state, indices[0], team), countedLine(state, indices, rules, labels)];
  const settings = roundSettingsByRound(state);
  indices.forEach((index, at) => {
    const text = [sameGames ? '' : games[at], noteLine(settings[index]?.note ?? '')]
      .filter(Boolean)
      .join(' · ');
    if (text) lines.push(`Round ${labels[index].roundNumber}: ${text}`);
  });
  return lines;
}

/** The tone of a standings destination: the Bracket's exit colour of its group in the table's routes. */
function destinationTone(declared: TournamentState, lastIndex: number, destination: number): PictureTone {
  if (declared.rounds[destination]?.waterfallRanking) return 'neutral';
  const group = roundExitGroups(declared, lastIndex).get(destination) ?? 0;
  return toneOfResult(destinationGroupResult(group));
}

/** The runs of final standings of a Qual line, each with its destination. */
function bandedCut(declared: TournamentState, lastIndex: number, rule: CutoffRule, labels: Labels): Cut {
  const cut: Cut = { blocks: [], routes: [] };
  for (const band of rule.bands ?? []) {
    const places = placesText(band.from, band.to ?? 'last');
    if (band.destination === 'eliminated') {
      cut.blocks.push(plain('red', `${places} out`));
      continue;
    }
    const tone = destinationTone(declared, lastIndex, band.destination);
    cut.blocks.push(plain(tone, `${places} → ${destinationLabel(band.destination, labels)}`));
    cut.routes.push({ to: band.destination, tone, count: (band.to ?? band.from) - band.from + 1 });
  }
  return cut;
}

/** The cut of the last standings round with no Qual line: the first so many go to the next round. */
function simpleCut(state: TournamentState, rule: CutoffRule, labels: Labels): Cut {
  const destination = destinationLabel(rule.destination, labels);
  const total = state.players.length;
  const goes = (count: number): Route[] => [{ to: rule.destination, tone: 'green', count }];
  if (rule.perGroup && groupExitIsTotal(state.cfg)) {
    const lines = groupExitLines(groupExitShapeOf(state), destination, 'green');
    const tone = (line: { tone: string | null }): PictureTone =>
      line.tone === 'green' || line.tone === 'red' ? line.tone : 'neutral';
    return {
      blocks: lines.map((line) => plain(tone(line), `${line.places} ${line.where}`.trim())),
      routes: goes(rule.advancing),
    };
  }
  if (rule.perGroup) {
    const places = `${placesText(1, rule.advancing)} of each group`;
    return {
      blocks: [plain('green', `${places} → ${destination}`), plain('red', 'the others out')],
      routes: goes(rule.advancing * state.groups.length),
    };
  }
  if (rule.advancing <= 0 || rule.advancing >= total) {
    return { blocks: [plain('green', `Everyone → ${destination}`)], routes: goes(total) };
  }
  return {
    blocks: [
      plain('green', `${placesText(1, rule.advancing)} → ${destination}`),
      plain('red', `${placesText(rule.advancing + 1, 'last')} out`),
    ],
    routes: goes(rule.advancing),
  };
}

function cutAfter(
  state: TournamentState,
  declared: TournamentState,
  lastIndex: number,
  rule: RoundExitRule,
  labels: Labels,
): Cut {
  if (rule.kind === 'all-advance') {
    const to = lastIndex + 1;
    return {
      blocks: [plain('green', `Everyone → ${destinationLabel(to, labels)}`)],
      routes: [{ to, tone: 'green', count: state.players.length }],
    };
  }
  if (rule.kind !== 'standings-cutoff') return { blocks: [], routes: [] };
  return rule.bands ? bandedCut(declared, lastIndex, rule, labels) : simpleCut(state, rule, labels);
}

/**
 * The block of the rounds before the bracket, drawn before the first column: how they are played, which count, and
 * where the places of the last one go. `indices` are the pooling rounds of `state.rounds`, in order; null when there are none.
 */
export function poolingPicture(
  state: TournamentState,
  declared: TournamentState,
  indices: number[],
  rules: RoundExitRule[],
  team: boolean,
): PoolingPicture | null {
  if (indices.length === 0) return null;
  const last = indices.length - 1;
  const cut = cutAfter(state, declared, indices[last], rules[last], bracketRoundLabels(state));
  return {
    block: {
      title: POOLING_PHASE_WORDS[state.cfg.poolingPhase ?? 'none']?.list ?? 'Warm-up',
      lines: plainLines(state, declared, indices, rules, team),
      afterLast: cut.blocks,
    },
    routes: cut.routes,
  };
}
