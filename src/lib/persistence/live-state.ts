import { getGameFormat } from '../../domain/tournament/formats';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { IdSource } from '../../domain/tournament/runtime';
import type {
  ActiveTab,
  PersistedSetup,
  PersistedTournamentEnvelope,
  TournamentState,
} from '../../domain/tournament/types';

const ACTIVE_TABS: readonly ActiveTab[] = [
  'tournaments',
  'info',
  'admin',
  'bracket',
  'standings',
  'rankings',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTeamCollection(value: unknown, teamSize: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!isRecord(entry)) return entry;
    const members = Array.isArray(entry.members) ? [...entry.members] : [];
    while (members.length < teamSize) members.push(null);
    return { ...entry, members };
  });
}

/**
 * Fills what a stored state lacks from the defaults and pads the team collections to the team size.
 * Unknown root fields remain attached and will survive a subsequent JSON save.
 */
export function normalizeLiveTournamentState(
  value: unknown,
  ids: Pick<IdSource, 'tournamentId'>,
): TournamentState {
  const raw = isRecord(value) ? value : {};
  const merged = {
    ...createDefaultTournamentState(),
    ...raw,
  } as unknown as TournamentState & Record<string, unknown>;
  const format = getGameFormat(merged.gameFormat);
  if (format?.teamSize) {
    merged.players = normalizeTeamCollection(merged.players, format.teamSize) as TournamentState['players'];
    merged.reserves = normalizeTeamCollection(
      merged.reserves,
      format.teamSize,
    ) as TournamentState['reserves'];
  }
  if (Array.isArray(merged.rounds) && merged.rounds.length && !merged.tournamentId) {
    merged.tournamentId = ids.tournamentId();
  }
  return merged;
}

export function normalizePersistedSetup(value: unknown): PersistedSetup {
  const raw = isRecord(value) ? value : {};
  const setup = createDefaultSetup();
  for (const key of Object.keys(setup) as (keyof PersistedSetup)[]) {
    // Each known control is restored independently; a missing one keeps its default.
    if (raw[key] !== undefined) (setup as unknown as Record<string, unknown>)[key] = raw[key];
  }
  return setup;
}

export function normalizeActiveTab(value: unknown): ActiveTab {
  return typeof value === 'string' && (ACTIVE_TABS as readonly string[]).includes(value)
    ? (value as ActiveTab)
    : 'bracket';
}

export function parseLiveEnvelope(
  rawJson: string,
  ids: Pick<IdSource, 'tournamentId'>,
): PersistedTournamentEnvelope {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isRecord(parsed)) {
    throw new TypeError('Saved tournament envelope must be an object.');
  }
  return {
    T: normalizeLiveTournamentState(parsed.T, ids),
    setup: normalizePersistedSetup(parsed.setup),
    activeTab: normalizeActiveTab(parsed.activeTab),
  };
}

export function serializeLiveEnvelope(envelope: PersistedTournamentEnvelope): string {
  return JSON.stringify(envelope);
}
