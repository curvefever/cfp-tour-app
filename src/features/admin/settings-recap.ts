import {
  ODD_COUNT_STRATEGY_LABELS,
  POOLING_PHASE_LABELS,
  SCHEDULE_LOGIC_LABELS,
  TEAM_SCORING_RULE_LABELS,
  deriveRoomSize,
  getGameFormat,
  resolveOddCountStrategy,
} from '../../domain/tournament/formats';
import { SCORING_SYSTEM_OPTION_LABELS } from '../../domain/tournament/scoring';
import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import { readTournamentSettings } from '../../domain/tournament/tournament-settings';
import type { TournamentSettings, TournamentState } from '../../domain/tournament/types';
import { waterfallGraphQualAdvance } from '../../domain/tournament/waterfall-draft';
import {
  DRAW_PUBLICATION_LABELS,
  ROUND_ROBIN_LABELS,
  gamesLabel,
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
  label: string;
  value: (settings: TournamentSettings) => string;
}

const orDefault = (value: string, fallback: string) => value.trim() || fallback;
const gamesOf = (value: string) => gamesLabel(Number.parseInt(value, 10) || 1);

/**
 * One entry per Setup setting, in the order the recap lists them. Typed over every setting, so a new Setup
 * field that is left out of this table does not compile.
 */
const RECAP: Record<FormatField, RecapEntry> = {
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
    label: 'Waterfall graph',
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
      return advancing > 0 ? `${advancing}, set by the waterfall graph` : '—';
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
    value: (settings) =>
      SCORING_SYSTEM_OPTION_LABELS[settings.poolingPhase === 'none' ? 'fairpoints' : settings.scoring],
  },
  positionalPointsTable: {
    group: 'SCORING',
    label: 'Points table',
    value: (settings) => orDefault(settings.positionalPointsTable, '—'),
  },
  semisGames: { group: 'BRACKET', label: 'Semis format', value: (settings) => gamesOf(settings.semisGames) },
  finalsGames: {
    group: 'BRACKET',
    label: 'Finals format',
    value: (settings) => gamesOf(settings.finalsGames),
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
};

const TITLES: RecapTitle[] = ['FORMAT', 'POOLING', 'SCORING', 'BRACKET'];

/**
 * The Setup form of a tournament: as typed when it was generated, or, for one generated before that was
 * kept, rebuilt from what its state records.
 */
export function settingsOf(state: TournamentState): TournamentSettings {
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
  const fields = (Object.keys(RECAP) as FormatField[]).filter((field) => shown.has(field));
  const groups: RecapGroup[] = TITLES.map((title) => ({
    title,
    items: fields
      .filter((field) => RECAP[field].group === title)
      .map((field) => ({ label: RECAP[field].label, value: RECAP[field].value(settings) })),
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
