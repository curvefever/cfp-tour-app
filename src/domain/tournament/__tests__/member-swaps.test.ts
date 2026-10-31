import { describe, expect, it } from 'vitest';
import { isMemberMarkedAbsent, markOneScoreTeamMemberAbsent } from '../absences';
import { ONE_SCORE_PER_TEAM } from '../formats';
import {
  addReserveIndividual,
  fillTeamSlot,
  memberSwapRefusal,
  removeReserveIndividual,
  slotFillRefusal,
  swapTeamMember,
} from '../member-swaps';
import { setTeamDefender, swapWindowOpen } from '../mutations';
import { getDefenderIndex } from '../scoring';
import { describeStandings } from '../standings-display';
import { advanceTournamentRound } from '../transitions';
import type { TeamMember, TournamentState, TournamentTeam } from '../types';
import { buildState, scoreCurrentRound } from './play-through';
import { oneRoomState, teamOf } from './test-fixtures';

const teamsOf = (state: TournamentState) => state.players as TournamentTeam[];
const memberNames = (state: TournamentState, teamId: string) =>
  teamsOf(state)
    .find((team) => team.teamId === teamId)
    ?.members.map((member) => member?.name ?? null);
const reserveNames = (state: TournamentState) => state.reserveIndividuals.map((member) => member.name);

/** Two teams of two, not started: the smallest roster a swap needs. */
function pair(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    ...oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [teamOf('Red', ['Ann', 'Bob']), teamOf('Blue', ['Cy', 'Di'])],
    }),
    ...overrides,
  };
}

/** The 13-team 4v4 group stage of the organiser's first test (groups of 4–5), round 1 in play. */
function groups13(): TournamentState {
  const state = buildState({
    label: 'group-swaps',
    count: 13,
    teams: true,
    setup: {
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '4',
      qualifiersPerGroup: '2',
      oddCountStrategy: 'bye',
      scheduleLogic: 'single-elimination',
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

function advanceScored(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 4));
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return result.state;
}

/** A unit seated in a room of the round in play. */
const seatedTeam = (state: TournamentState) =>
  (state.assignments[state.curRound] ?? []).find((entry) => entry.room !== null)?.name ?? '';

describe('swapTeamMember', () => {
  it('puts an individual reserve in the slot, and the member who goes out becomes a reserve', () => {
    const state = pair({ reserveIndividuals: [{ name: 'Eve' }, { name: 'Fay' }] });
    const swapped = swapTeamMember(state, 'Red', 1, { name: 'Fay' }, 1);
    expect(memberNames(swapped, 'Red')).toEqual(['Ann', 'Fay']);
    expect(reserveNames(swapped)).toEqual(['Eve', 'Bob']);
  });

  it('puts a new name in the slot', () => {
    const swapped = swapTeamMember(pair(), 'Blue', 0, { name: '  Gus ' });
    expect(memberNames(swapped, 'Blue')).toEqual(['Gus', 'Di']);
    expect(reserveNames(swapped)).toEqual(['Cy']);
  });

  it('keeps the userId of the newcomer and of the member who goes out', () => {
    const state = pair({
      players: [teamOf('Red', ['Ann', 'Bob']), teamOf('Blue', ['Cy', 'Di'])].map((team) => ({
        ...team,
        members: team.members.map((member) =>
          member?.name === 'Ann' ? { ...member, userId: 'u-ann' } : member,
        ),
      })),
    });
    const swapped = swapTeamMember(state, 'Red', 0, { name: 'Gus', userId: 'u-gus' });
    expect(teamsOf(swapped)[0].members[0]).toEqual({ name: 'Gus', userId: 'u-gus' });
    expect(swapped.reserveIndividuals).toEqual([{ name: 'Ann', userId: 'u-ann' }]);
  });

  it('lets the member who went out come back', () => {
    const out = swapTeamMember(pair(), 'Red', 0, { name: 'Gus' });
    const back = swapTeamMember(out, 'Red', 0, { name: 'Ann' }, 0);
    expect(memberNames(back, 'Red')).toEqual(['Ann', 'Bob']);
    expect(reserveNames(back)).toEqual(['Gus']);
  });

  it('refuses a name already in the roster, in either case, whoever holds it', () => {
    const state = pair({
      reserveIndividuals: [{ name: 'Eve' }],
      reserves: [teamOf('Green', ['Hal', 'Ida'])],
    });
    for (const name of ['Cy', 'cy', 'CY', 'Red', 'Hal', 'EVE', 'Green']) {
      expect(swapTeamMember(state, 'Red', 0, { name })).toBe(state);
    }
    expect(memberSwapRefusal(state, 'Red', 0, { name: 'cy' })).toBe(
      '"cy" is already registered — pick a different name.',
    );
  });

  it('refuses to swap a member for themselves, in either case', () => {
    const state = pair();
    expect(swapTeamMember(state, 'Red', 0, { name: 'ann' })).toBe(state);
    expect(swapTeamMember(state, 'Red', 0, { name: 'Ann' })).toBe(state);
  });

  it('refuses an empty name, a name Firebase cannot store, an empty slot, an unknown team and a stale reserve', () => {
    const state = pair({ reserveIndividuals: [{ name: 'Eve' }] });
    expect(swapTeamMember(state, 'Red', 0, { name: '   ' })).toBe(state);
    expect(swapTeamMember(state, 'Red', 0, { name: 'Gu.s' })).toBe(state);
    expect(swapTeamMember(state, 'Nobody', 0, { name: 'Gus' })).toBe(state);
    expect(swapTeamMember(state, 'Red', 1, { name: 'Eve' }, 3)).toBe(state);
    expect(swapTeamMember(state, 'Red', 1, { name: 'Gus' }, 0)).toBe(state);
    const vacant = fillTeamSlot(pair(), 'Red', 0, { name: 'Ann' });
    const withVacancy = {
      ...vacant,
      players: [{ ...teamsOf(vacant)[0], members: [null, { name: 'Bob' }] }, teamsOf(vacant)[1]],
    } as TournamentState;
    expect(swapTeamMember(withVacancy, 'Red', 0, { name: 'Gus' })).toBe(withVacancy);
  });

  it('is refused for an individual format', () => {
    const state = oneRoomState();
    expect(swapTeamMember(state, 'Ann', 0, { name: 'Gus' })).toBe(state);
  });

  it('changes nothing else: scores, confirmations, the draw and the schedule stay', () => {
    const state = pair({
      scores: { 'r0-rm1-p0-m1': 77 },
      confirmations: { Bob: true },
    });
    const swapped = swapTeamMember(state, 'Red', 1, { name: 'Gus' });
    expect(swapped.scores).toBe(state.scores);
    expect(swapped.confirmations).toBe(state.confirmations);
    expect(swapped.assignments).toBe(state.assignments);
    expect(swapped.rounds).toBe(state.rounds);
  });
});

describe('swapTeamMember in play (13 teams, 4v4 group stage)', () => {
  it('works in a group-stage round in play, and the past round score and the standings are unchanged', () => {
    const played = advanceScored(groups13());
    const before = JSON.stringify(describeStandings(played));
    const teamId = seatedTeam(played);
    const swapped = swapTeamMember(played, teamId, 2, { name: 'Walk Up' });
    expect(swapped).not.toBe(played);
    expect(memberNames(swapped, teamId)?.[2]).toBe('Walk Up');
    expect(swapped.scores).toBe(played.scores);
    expect(JSON.stringify(describeStandings(swapped))).toBe(before);
    expect(reserveNames(swapped)).toHaveLength(1);
  });

  it('works in a bracket round once eliminations have closed the reserve window', () => {
    let state = groups13();
    while (state.rounds[state.curRound].isGroupStage) state = advanceScored(state);
    state = advanceScored(state);
    expect(state.rounds[state.curRound].isGroupStage).toBeFalsy();
    expect(swapWindowOpen(state)).toBe(false);
    const before = JSON.stringify(describeStandings(state));
    const teamId = seatedTeam(state);
    const swapped = swapTeamMember(state, teamId, 0, { name: 'Late Walk Up' });
    expect(memberNames(swapped, teamId)?.[0]).toBe('Late Walk Up');
    expect(swapped.scores).toBe(state.scores);
    expect(JSON.stringify(describeStandings(swapped))).toBe(before);
    const back = swapTeamMember(swapped, teamId, 0, { name: reserveNames(swapped)[0] }, 0);
    expect(memberNames(back, teamId)).toEqual(memberNames(state, teamId));
  });
});

describe('swapTeamMember and the hand absent marks of One score per team', () => {
  const oneScore = () =>
    oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
    });

  it('clears the mark on the slot in the round in play and keeps a mark on another slot', () => {
    let state = markOneScoreTeamMemberAbsent(oneScore(), 0, 1, 0, 1);
    state = markOneScoreTeamMemberAbsent(state, 0, 1, 0, 0);
    state = markOneScoreTeamMemberAbsent(state, 0, 1, 1, 1);
    const swapped = swapTeamMember(state, 'Red', 1, { name: 'Gus' });
    expect(isMemberMarkedAbsent(swapped, 'r0-rm1-p0-m1')).toBe(false);
    expect(isMemberMarkedAbsent(swapped, 'r0-rm1-p0-m0')).toBe(true);
    expect(isMemberMarkedAbsent(swapped, 'r0-rm1-p1-m1')).toBe(true);
  });

  it('clears the mark of a team seated second in its room and keeps the other team mark on that slot', () => {
    let state = markOneScoreTeamMemberAbsent(oneScore(), 0, 1, 1, 1);
    state = markOneScoreTeamMemberAbsent(state, 0, 1, 0, 1);
    const swapped = swapTeamMember(state, 'Blue', 1, { name: 'Gus' });
    expect(isMemberMarkedAbsent(swapped, 'r0-rm1-p1-m1')).toBe(false);
    expect(isMemberMarkedAbsent(swapped, 'r0-rm1-p0-m1')).toBe(true);
  });

  it('leaves the answers to scored 0s alone', () => {
    const state = {
      ...markOneScoreTeamMemberAbsent(oneScore(), 0, 1, 0, 1),
      scores: { 'r0-rm1-p0': 0 },
      absences: { 'r0-rm1-p0': 'absent', 'r0-rm1-p0-m1': 'absent' },
    } as TournamentState;
    const swapped = swapTeamMember(state, 'Red', 1, { name: 'Gus' });
    expect(swapped.absences).toEqual({ 'r0-rm1-p0': 'absent' });
  });
});

describe('swapTeamMember and the defender (Save your Buddy)', () => {
  it('stays on the slot: the newcomer takes over the role', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'designated-player',
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
    });
    const state = setTeamDefender(base, 'Red', 1);
    const swapped = swapTeamMember(state, 'Red', 1, { name: 'Gus' });
    expect(swapped.defenderChanges).toBe(state.defenderChanges);
    expect(getDefenderIndex(swapped, 'Red', 0)).toBe(1);
    expect(memberNames(swapped, 'Red')?.[1]).toBe('Gus');
  });
});

describe('individual reserves', () => {
  it('can be added before the start', () => {
    const state = pair({ started: false });
    const added = addReserveIndividual(state, { name: ' Eve ' });
    expect(reserveNames(added)).toEqual(['Eve']);
  });

  it('can be added during a group stage, and in a fixed-draw tournament, whatever the reserve window says', () => {
    const groups = { ...groups13(), reserveOpen: false };
    expect(reserveNames(addReserveIndividual(groups, { name: 'Eve' }))).toEqual(['Eve']);
    const fixed = pair({
      gamemodeConfig: { ...pair().gamemodeConfig, drawPublication: 'fixed' },
      reserveOpen: false,
    });
    expect(reserveNames(addReserveIndividual(fixed, { name: 'Eve' }))).toEqual(['Eve']);
  });

  it('is refused for an empty name, an unstorable one, a duplicate in either case, and an individual format', () => {
    const state = pair({ reserveIndividuals: [{ name: 'Eve' }] });
    const refused: TeamMember[] = [
      { name: ' ' },
      { name: 'E.ve' },
      { name: 'eve' },
      { name: 'ann' },
      { name: 'Blue' },
    ];
    for (const member of refused) expect(addReserveIndividual(state, member)).toBe(state);
    const individuals = oneRoomState();
    expect(addReserveIndividual(individuals, { name: 'Gus' })).toBe(individuals);
  });

  it('can be removed by index', () => {
    const state = pair({ reserveIndividuals: [{ name: 'Eve' }, { name: 'Fay' }] });
    expect(reserveNames(removeReserveIndividual(state, 0))).toEqual(['Fay']);
    expect(removeReserveIndividual(state, 5)).toBe(state);
  });
});

describe('fillTeamSlot', () => {
  it('fills a vacant slot with the reserve window closed', () => {
    const state = pair({ reserveOpen: false, reserveIndividuals: [{ name: 'Eve' }] });
    const vacant = {
      ...state,
      players: [{ ...teamsOf(state)[0], members: [{ name: 'Ann' }, null] }, teamsOf(state)[1]],
    } as TournamentState;
    const filled = fillTeamSlot(vacant, 'Red', 1, { name: 'Eve' }, 0);
    expect(memberNames(filled, 'Red')).toEqual(['Ann', 'Eve']);
    expect(reserveNames(filled)).toEqual([]);
  });

  it('refuses a name already in use, in either case, with the same message as a swap', () => {
    const state = pair({
      reserveIndividuals: [{ name: 'Eve' }],
      reserves: [teamOf('Green', ['Hal', 'Ida'])],
    });
    const vacant = {
      ...state,
      players: [{ ...teamsOf(state)[0], members: [{ name: 'Ann' }, null] }, teamsOf(state)[1]],
    } as TournamentState;
    for (const name of ['Cy', 'cy', 'ANN', 'Blue', 'Hal', 'EVE']) {
      expect(fillTeamSlot(vacant, 'Red', 1, { name })).toBe(vacant);
    }
    expect(slotFillRefusal(vacant, 'Red', 1, { name: 'cy' })).toBe(
      memberSwapRefusal(state, 'Red', 0, { name: 'cy' }),
    );
  });

  it('accepts a reserve picked from the list (it does not collide with itself) and refuses a stale pick', () => {
    const state = pair({ reserveIndividuals: [{ name: 'Eve' }, { name: 'Fay' }] });
    const vacant = {
      ...state,
      players: [{ ...teamsOf(state)[0], members: [{ name: 'Ann' }, null] }, teamsOf(state)[1]],
    } as TournamentState;
    expect(slotFillRefusal(vacant, 'Red', 1, { name: 'Fay' }, 1)).toBeNull();
    expect(slotFillRefusal(vacant, 'Red', 1, { name: 'Fay' }, 0)).not.toBeNull();
    expect(fillTeamSlot(vacant, 'Red', 1, { name: 'Fay' }, 0)).toBe(vacant);
    expect(reserveNames(fillTeamSlot(vacant, 'Red', 1, { name: 'Fay' }, 1))).toEqual(['Eve']);
  });

  it('refuses a filled slot and an unknown team', () => {
    const state = pair();
    expect(fillTeamSlot(state, 'Red', 0, { name: 'Gus' })).toBe(state);
    expect(fillTeamSlot(state, 'Nobody', 0, { name: 'Gus' })).toBe(state);
  });
});
