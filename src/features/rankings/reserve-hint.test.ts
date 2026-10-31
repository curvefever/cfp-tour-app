import { describe, expect, it } from 'vitest';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { addWalkUpIndividual, addWalkUpTeam, benchReasonOf } from '../../domain/tournament/mutations';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { PersistedSetup, TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { benchedMessage, reserveAddHint } from './reserve-hint';

const GROUPS_4V4 = {
  gameFormat: 'team-4v4',
  poolingPhase: 'group-stage',
  groupSize: '4',
  qualifiersPerGroup: '2',
  oddCountStrategy: 'bye',
  scheduleLogic: 'single-elimination',
} as const;

function built(count: number, teams: boolean, setup: Partial<PersistedSetup>): TournamentState {
  const state = buildState({ label: 'reserve-hint', count, teams, setup });
  if (!state) throw new Error('generation failed');
  return state;
}

const groupTeams = () => built(13, true, GROUPS_4V4);
const groupPlayers = () =>
  built(13, false, { gameFormat: 'individual-1v1', poolingPhase: 'group-stage', oddCountStrategy: 'bye' });
const fixedDraw = () =>
  built(37, false, { poolingPhase: 'qual-table', qualAdv: '16', drawPublication: 'fixed' });
const customBracket = () =>
  buildQualWaterfall(
    16,
    `
ROUNDS:
R1 = 2x8
R2 = 8
Final = 6 FINAL

ROUTES:
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R2: 1-6->Final, 7-8->eliminated
`,
    { poolingPhase: 'none' },
  );

describe('the line under the reserve bench', () => {
  it('says ＋ puts the reserve on the bench during a group stage, and what it can do there', () => {
    expect(reserveAddHint(groupTeams())).toBe(
      'Click ＋ to add a reserve. During the group stage it waits on the bench and can replace a team with ⇄ Swap.',
    );
    expect(reserveAddHint(groupPlayers())).toBe(
      'Click ＋ to add a reserve. During the group stage it waits on the bench and can replace a player with ⇄ Swap.',
    );
  });

  it('words a fixed draw and a custom bracket without pooling to match', () => {
    expect(reserveAddHint(fixedDraw())).toBe(
      'Click ＋ to add a reserve. In a fixed draw it waits on the bench and can replace a player with ⇄ Swap.',
    );
    expect(reserveAddHint(customBracket())).toBe(
      'Click ＋ to add a reserve. In a custom bracket it waits on the bench and can replace a player with ⇄ Swap.',
    );
  });

  it('is the usual line where ＋ joins the reserve to the draw', () => {
    const qual = built(37, false, { poolingPhase: 'qual-table', qualAdv: '16' });
    expect(reserveAddHint(qual)).toBe(
      'Click ＋ to add a reserve. They join from the next round (during the first bracket round of a tournament without pooling: the least-full room).',
    );
    expect(reserveAddHint({ ...qual, started: false })).toContain(
      'Before Confirm & Start the draw is redone',
    );
    expect(reserveAddHint({ ...groupTeams(), started: false })).toContain('Before Confirm & Start');
  });

  it('is the usual line once the swap window has closed', () => {
    let state = groupTeams();
    for (let guard = 0; state.reserveOpen && guard < 40; guard += 1) {
      const result = advanceTournamentRound(scoreCurrentRound(state, 4));
      if (result.status !== 'advanced') throw new Error('blocked');
      state = result.state;
    }
    expect(benchReasonOf(state)).toBeNull();
    expect(reserveAddHint(state)).toContain('They join from the next round');
  });
});

describe('benchReasonOf is the reason a walk-up is benched for', () => {
  const walkUp = (state: TournamentState) => addWalkUpIndividual(state, 'Late', {}, undefined);

  it.each([
    ['a group stage', groupPlayers, 'group-stage'],
    ['a fixed draw', fixedDraw, 'fixed-draw'],
    ['a custom bracket without pooling', customBracket, 'waterfall-bracket'],
  ] as const)('%s', (_name, make, reason) => {
    const state = make();
    expect(benchReasonOf(state)).toBe(reason);
    expect(walkUp(state)).toMatchObject({ status: 'benched', reason });
  });

  it('a team walk-up agrees', () => {
    const team: TournamentTeam = {
      teamId: 'late',
      teamName: 'Late Team',
      members: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
    };
    expect(addWalkUpTeam(groupTeams(), team)).toMatchObject({ status: 'benched', reason: 'group-stage' });
  });

  it('is nothing where a walk-up joins the draw', () => {
    expect(benchReasonOf(built(37, false, { poolingPhase: 'qual-table', qualAdv: '16' }))).toBeNull();
  });
});

describe('benchedMessage', () => {
  it('names where it cannot join, and who ⇄ Swap replaces', () => {
    expect(benchedMessage(groupTeams(), 'group-stage')).toBe(
      "Added to the reserves. It can't join the group stage now, but it can replace a team with ⇄ Swap until the first elimination.",
    );
    expect(benchedMessage(fixedDraw(), 'fixed-draw')).toContain("can't join a fixed draw now");
    expect(benchedMessage(customBracket(), 'waterfall-bracket')).toContain('replace a player');
  });
});
