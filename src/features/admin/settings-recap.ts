import {
  ODD_COUNT_STRATEGY_LABELS,
  POOLING_PHASE_LABELS,
  SCHEDULE_LOGIC_LABELS,
  TEAM_SCORING_RULE_LABELS,
  deriveRoomSize,
  getGameFormat,
  resolveOddCountStrategy,
} from '../../domain/tournament/formats';
import { scoringSystemLabel } from '../../domain/tournament/scoring';
import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import { matchOverridesText, parseMatchOverrides } from '../../domain/tournament/round-match-formats';
import { roundNoteNames } from '../../domain/tournament/round-notes';
import { readTournamentSettings } from '../../domain/tournament/tournament-settings';
import type { TournamentSettings, TournamentState } from '../../domain/tournament/types';
import { parseMatchFormatToken } from '../../domain/tournament/waterfall-bracket';
import { waterfallGraphQualAdvance } from '../../domain/tournament/waterfall-draft';
import {
  DRAW_PUBLICATION_LABELS,
  ROUND_ROBIN_LABELS,
  matchLabelOf,
  visibleFormatFields,
  type FormatField,
} from './setup/format-fields';
import { plural } from './setup/plural';

export interface RecapItem {
  label: string;
  value: string;
}

export interface RecapGroup {
  title: string;
  items: RecapItem[];
}

type RecapTitle = 'FORMAT' | 'POOLING' | 'SCORING' | 'BRACKET';

interface RecapEntry {
  group: RecapTitle;
  label: string | ((settings: TournamentSettings) => string);
  value: (settings: TournamentSettings, pointsVersion: 2 | undefined, state: TournamentState) => string;
}

const orDefault = (value: string, fallback: string) => value.trim() || fallback;
const matchOf = (games: string, bestOf: string) =>
  matchLabelOf(Number.parseInt(games, 10) || 1, Number.parseInt(bestOf, 10) || undefined);

/** The Best of N settings are read through the format rows of their stage, not listed of their own. */
type RecapField = Exclude<
  FormatField,
  'semisBestOf' | 'finalsBestOf' | 'poolingBestOf' | 'bracketBestOf' | 'losersBestOf'
>;

/** What the first stage of the bracket is called by the schedule, in a Setup select and in the recap. */
function bracketStageLabel(settings: TournamentSettings): string {
  switch (settings.scheduleLogic) {
    case 'single-elimination':
      return 'Elimination rounds';
    case 'kings-valley':
      return 'Ladder rounds';
    default:
      return 'Winners rounds';
  }
}

/** "Round 3: Best of 3, Semis: 2 games": the overrides of the rounds the schedule has, in schedule order; '—' for none. */
function overridesText(settings: TournamentSettings, state: TournamentState): string {
  const overrides = parseMatchOverrides(settings.matchOverrides);
  const listed = roundNoteNames(state).flatMap((name) => {
    const match = parseMatchFormatToken(overrides[name] ?? '');
    return match
      ? [`${name}: ${match.bestOf === undefined ? plural(match.games, 'game') : `Best of ${match.bestOf}`}`]
      : [];
  });
  return listed.length > 0 ? listed.join(', ') : '—';
}

/**
 * One entry per Setup setting, in the order the recap lists them. Typed over every setting, so a new Setup
 * field that is left out of this table does not compile.
 */
const RECAP: Record<RecapField, RecapEntry> = {
  gameFormat: {
    group: 'FORMAT',
    label: 'Game format',
    value: (settings) => {
      const format = getGameFormat(settings.gameFormat);
      if (!format) return settings.gameFormat;
      const { min, max } = deriveRoomSize(format, resolveOddCountStrategy(format, settings.oddCountStrategy));
      return `${format.label} · rooms of ${min === max ? min : `${min}–${max}`}`;
    },
  },
  scheduleLogic: {
    group: 'FORMAT',
    label: 'Schedule logic',
    value: (settings) => SCHEDULE_LOGIC_LABELS[settings.scheduleLogic],
  },
  teamScoringRule: {
    group: 'FORMAT',
    label: 'Team scoring',
    value: (settings) => TEAM_SCORING_RULE_LABELS[settings.teamScoringRule || 'sum-members'],
  },
  oddCountStrategy: {
    group: 'FORMAT',
    label: 'Odd-count strategy',
    value: (settings) => {
      const format = getGameFormat(settings.gameFormat);
      const strategy = format && resolveOddCountStrategy(format, settings.oddCountStrategy);
      return strategy ? ODD_COUNT_STRATEGY_LABELS[strategy] : '—';
    },
  },
  drawPublication: {
    group: 'FORMAT',
    label: 'Draw publication',
    value: (settings) => DRAW_PUBLICATION_LABELS[settings.drawPublication],
  },
  waterfallGraph: {
    group: 'FORMAT',
    label: 'Custom bracket graph',
    value: () => 'Organiser-authored, shown below',
  },
  poolingPhase: {
    group: 'POOLING',
    label: 'Pooling phase',
    value: (settings) => POOLING_PHASE_LABELS[settings.poolingPhase],
  },
  qualAdv: {
    group: 'POOLING',
    label: 'Advance to bracket',
    value: (settings) => {
      if (settings.scheduleLogic !== 'waterfall-bracket' || settings.poolingPhase !== 'qual-table') {
        return orDefault(settings.qualAdv, '—');
      }
      const advancing = waterfallGraphQualAdvance(settings.waterfallGraph);
      return advancing > 0 ? `${advancing}, set by the custom bracket graph` : '—';
    },
  },
  nonCountingRounds: {
    group: 'POOLING',
    label: 'Non-counting rounds',
    value: (settings) =>
      Number.parseInt(settings.nonCountingRounds, 10) > 0 ? settings.nonCountingRounds : 'None',
  },
  groupSize: {
    group: 'POOLING',
    label: 'Group size',
    value: (settings) => orDefault(settings.groupSize, '—'),
  },
  roundRobinMode: {
    group: 'POOLING',
    label: 'Round-robin',
    value: (settings) => ROUND_ROBIN_LABELS[settings.roundRobinMode],
  },
  qualifiersPerGroup: {
    group: 'POOLING',
    label: 'Qualifiers per group',
    value: (settings) => orDefault(settings.qualifiersPerGroup, '—'),
  },
  qualRoundsOverride: {
    group: 'POOLING',
    label: 'Qualification rounds',
    value: (settings) => orDefault(settings.qualRoundsOverride, 'Derived'),
  },
  swissRoundsOverride: {
    group: 'POOLING',
    label: 'Swiss rounds',
    value: (settings) => orDefault(settings.swissRoundsOverride, 'Derived'),
  },
  scoring: {
    group: 'SCORING',
    label: 'Scoring system',
    value: (settings, pointsVersion) =>
      scoringSystemLabel(settings.poolingPhase === 'none' ? 'fairpoints' : settings.scoring, pointsVersion),
  },
  positionalPointsTable: {
    group: 'SCORING',
    label: 'Points table',
    value: (settings) => orDefault(settings.positionalPointsTable, '—'),
  },
  poolingGames: {
    group: 'POOLING',
    label: 'Pooling rounds',
    value: (settings) => matchOf(settings.poolingGames, settings.poolingBestOf),
  },
  bracketGames: {
    group: 'BRACKET',
    label: bracketStageLabel,
    value: (settings) => matchOf(settings.bracketGames, settings.bracketBestOf),
  },
  losersGames: {
    group: 'BRACKET',
    label: 'Losers rounds',
    value: (settings) => matchOf(settings.losersGames, settings.losersBestOf),
  },
  semisGames: {
    group: 'BRACKET',
    label: 'Semis format',
    value: (settings) => matchOf(settings.semisGames, settings.semisBestOf),
  },
  finalsGames: {
    group: 'BRACKET',
    label: 'Finals format',
    value: (settings) => matchOf(settings.finalsGames, settings.finalsBestOf),
  },
  grandFinalWbTarget: {
    group: 'BRACKET',
    label: 'Grand Final, winners bracket',
    value: (settings) => `${orDefault(settings.grandFinalWbTarget, '—')} wins needed`,
  },
  grandFinalLbTarget: {
    group: 'BRACKET',
    label: 'Grand Final, losers bracket',
    value: (settings) => `${orDefault(settings.grandFinalLbTarget, '—')} wins needed`,
  },
  semisOverride: {
    group: 'BRACKET',
    label: 'Semis size',
    value: (settings) => orDefault(settings.semisOverride, 'Derived'),
  },
  finalOverride: {
    group: 'BRACKET',
    label: 'Final size',
    value: (settings) => orDefault(settings.finalOverride, 'Derived'),
  },
  lbQualifiers: {
    group: 'BRACKET',
    label: 'LB qualifiers into the Final',
    value: (settings) => orDefault(settings.lbQualifiers, '—'),
  },
  eliminationRoundTargets: {
    group: 'BRACKET',
    label: 'Elimination round targets',
    value: (settings) => orDefault(settings.eliminationRoundTargets, 'Automatic'),
  },
  eliminationSeedingOverrides: {
    group: 'BRACKET',
    label: 'Elimination seeding',
    value: (settings) => orDefault(settings.eliminationSeedingOverrides, 'Automatic'),
  },
  matchOverrides: {
    group: 'BRACKET',
    label: 'Round overrides',
    value: (settings, _pointsVersion, state) => overridesText(settings, state),
  },
};

const TITLES: RecapTitle[] = ['FORMAT', 'POOLING', 'SCORING', 'BRACKET'];

/**
 * The Setup form of a tournament: as typed when it was generated, or, for one generated before that was
 * kept, rebuilt from what its state records.
 */
function settingsOf(state: TournamentState): TournamentSettings {
  const stored = readTournamentSettings(state.settings);
  if (stored) return stored;
  const { cfg, gamemodeConfig: config } = state;
  const text = (value: string | number | undefined, fallback: string) =>
    value === undefined ? fallback : String(value);
  const defaults = createDefaultSetup();
  return {
    ...defaults,
    lbQualifiers: '2',
    gameFormat: state.gameFormat,
    scheduleLogic: state.scheduleLogic,
    poolingPhase: cfg.poolingPhase ?? config.poolingPhase ?? 'none',
    qualAdv: text(cfg.qualAdv, defaults.qualAdv),
    nonCountingRounds: text(config.nonCountingRounds, defaults.nonCountingRounds),
    groupSize: text(config.groupSize ?? cfg.groupSize, defaults.groupSize),
    roundRobinMode: config.roundRobinMode ?? cfg.roundRobinMode ?? defaults.roundRobinMode,
    qualifiersPerGroup: text(
      config.qualifiersPerGroup ?? cfg.qualifiersPerGroup,
      defaults.qualifiersPerGroup,
    ),
    scoring: config.scoring ?? cfg.scoring ?? defaults.scoring,
    positionalPointsTable: config.positionalPointsTable?.join(',') ?? defaults.positionalPointsTable,
    drawPublication: cfg.drawPublication ?? defaults.drawPublication,
    finalsGames: text(config.finalsGames ?? cfg.finalsGames, defaults.finalsGames),
    semisGames: text(config.semisGames ?? cfg.semisGames, defaults.semisGames),
    finalsBestOf: text(config.finalsBestOf, defaults.finalsBestOf),
    semisBestOf: text(config.semisBestOf, defaults.semisBestOf),
    poolingGames: text(config.poolingGames, defaults.poolingGames),
    poolingBestOf: text(config.poolingBestOf, defaults.poolingBestOf),
    bracketGames: text(config.bracketGames, defaults.bracketGames),
    bracketBestOf: text(config.bracketBestOf, defaults.bracketBestOf),
    losersGames: text(config.losersGames, defaults.losersGames),
    losersBestOf: text(config.losersBestOf, defaults.losersBestOf),
    matchOverrides: matchOverridesText(config.matchOverrides ?? {}),
    grandFinalWbTarget: text(config.grandFinalWbTarget, defaults.grandFinalWbTarget),
    grandFinalLbTarget: text(config.grandFinalLbTarget, defaults.grandFinalLbTarget),
    oddCountStrategy: config.oddCountStrategy ?? '',
    teamScoringRule: config.teamScoringRule ?? '',
  };
}

function rosterItem(state: TournamentState): RecapItem {
  const unit = getGameFormat(state.gameFormat)?.teamSize ? 'team' : 'player';
  const count = state.confirmedCount ?? state.players.length;
  const reserves = state.reserves.length ? ` · ${plural(state.reserves.length, 'reserve')}` : '';
  return { label: 'Roster', value: `${plural(count, unit)}${reserves}` };
}

/**
 * The settings fixed since the start, grouped for the running Admin: only the ones that apply to this format
 * (the Setup form's own rule, `visibleFormatFields`), then the roster and the viewer link.
 */
export function settingsRecapGroups(state: TournamentState): RecapGroup[] {
  const settings = settingsOf(state);
  const shown = visibleFormatFields(settings);
  const fields = (Object.keys(RECAP) as RecapField[]).filter((field) => shown.has(field));
  const groups: RecapGroup[] = TITLES.map((title) => ({
    title,
    items: fields
      .filter((field) => RECAP[field].group === title)
      .map((field) => ({
        label: typeof RECAP[field].label === 'function' ? RECAP[field].label(settings) : RECAP[field].label,
        value: RECAP[field].value(settings, state.gamemodeConfig.pointsVersion, state),
      })),
  })).filter((group) => group.items.length > 0);
  groups.push({
    title: 'ROSTER AND SHARING',
    items: [
      rosterItem(state),
      { label: 'Viewer link', value: 'Copy it with “Copy viewer link”, at the top' },
    ],
  });
  return groups;
}
