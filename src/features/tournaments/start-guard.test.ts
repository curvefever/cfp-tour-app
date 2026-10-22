import { describe, expect, it } from 'vitest';
import {
  EXACT_COUNT_GRAPH,
  generated,
  rosterFor,
  TEAM_QUAL_GRAPH,
  testRuntime,
  type Setup,
} from '../../domain/tournament/__tests__/test-fixtures';
import { removeUnitBeforeStart } from '../../domain/tournament/pre-start-edits';
import { regenerateForRoster, STALE_DRAW_MESSAGE } from '../../domain/tournament/pre-start-roster';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { marshalForFirebase } from '../sync/firebase-marshal';
import { simulateFirebaseStorage } from '../sync/firebase-storage-simulation';
import { buildTournamentPatch } from '../sync/tournament-patch';
import { startDrawRefusal } from './start-guard';

const TOURNAMENT_ID = '1792339397443';
const START_PATCH = { curRound: 0 };

const TEAMS_INTO_WATERFALL: Setup = {
  gameFormat: 'team-2v2v2v2',
  scheduleLogic: 'waterfall-bracket',
  waterfallGraph: TEAM_QUAL_GRAPH,
};

/** The tournament as Firebase holds it. */
const stored = (state: TournamentState) => simulateFirebaseStorage(marshalForFirebase(state));

/** The same roster size, every team a new id: what a roster reload does. */
const withNewTeamIds = (state: TournamentState, count = state.players.length): TournamentState => ({
  ...state,
  players: (rosterFor('team-2v2v2v2', count) as TournamentTeam[]).map((team) => ({
    ...team,
    teamId: `new_${team.teamId}`,
  })),
});

describe('startDrawRefusal', () => {
  it('refuses the incident shape: generated for 23 teams, the roster replaced by 24 new teams', () => {
    const stale = withNewTeamIds(generated(23, TEAMS_INTO_WATERFALL), 24);
    expect(startDrawRefusal(stored(stale), START_PATCH, TOURNAMENT_ID)).toBe(STALE_DRAW_MESSAGE);
  });

  it('is not hidden by a patch that only sets curRound', () => {
    const stale = withNewTeamIds(generated(20, TEAMS_INTO_WATERFALL));
    expect(startDrawRefusal(stored(stale), { curRound: 0 }, TOURNAMENT_ID)).toBe(STALE_DRAW_MESSAGE);
  });

  it("refuses a matching stored state whose start patch carries an old tab's unsent roster change", () => {
    const matching = generated(20, TEAMS_INTO_WATERFALL);
    const patch = buildTournamentPatch(matching, { ...withNewTeamIds(matching), curRound: 0 });
    expect(patch).not.toBeNull();
    expect(startDrawRefusal(stored(matching), patch!, TOURNAMENT_ID)).toBe(STALE_DRAW_MESSAGE);
  });

  it('accepts a stale stored state when the patch carries the redrawn schedule', () => {
    const stale = withNewTeamIds(generated(20, TEAMS_INTO_WATERFALL));
    const redrawn = regenerateForRoster(stale, testRuntime());
    if (redrawn.status !== 'generated') throw new Error('the redraw was refused');
    const patch = buildTournamentPatch(stale, { ...redrawn.state, curRound: 0 });
    expect(patch).not.toBeNull();
    expect(startDrawRefusal(stored(stale), patch!, TOURNAMENT_ID)).toBeNull();
  });

  it.each([31, 37, 43, 53])('accepts a matching FFA draw at %i individuals', (count) => {
    const state = generated(count, {
      poolingPhase: 'qual-table',
      qualAdv: '16',
      scheduleLogic: 'single-elimination',
    });
    expect(startDrawRefusal(stored(state), START_PATCH, TOURNAMENT_ID)).toBeNull();
  });

  it('accepts a matching draw at 23 teams of 2v2v2v2', () => {
    const state = generated(23, TEAMS_INTO_WATERFALL);
    expect(startDrawRefusal(stored(state), START_PATCH, TOURNAMENT_ID)).toBeNull();
  });

  it('accepts the short room left by a pre-start removal whose redraw was refused (16 -> 15)', () => {
    const exactCount = generated(16, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: EXACT_COUNT_GRAPH,
    });
    const { state, redrawRefusal } = removeUnitBeforeStart(exactCount, 'P3', testRuntime());
    expect(redrawRefusal).toBeDefined();
    expect(startDrawRefusal(stored(state), START_PATCH, TOURNAMENT_ID)).toBeNull();
  });

  it('accepts a tournament with nothing generated yet', () => {
    const roster = { ...generated(20, TEAMS_INTO_WATERFALL), rounds: [], assignments: [], byes: [] };
    expect(startDrawRefusal(stored(roster), START_PATCH, TOURNAMENT_ID)).toBeNull();
  });
});
