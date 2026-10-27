import { describe, expect, it } from 'vitest';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import {
  buildQualWaterfall,
  playToQualificationExit,
} from '../../domain/tournament/__tests__/qual-waterfall';
import { bracketFollowStatus, bracketRoundLabels } from '../../domain/tournament/bracket';
import { describeStandings } from '../../domain/tournament/standings-display';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import {
  followBannerText,
  rememberedFollow,
  standingsFollowDetail,
  standingsFollowText,
} from './follow-text';
import { roomTitle } from './room-title';

function start(count: number, setup: Partial<PersistedSetup> = {}, teams = false): TournamentState {
  const state = buildState({
    label: `${count}`,
    count,
    teams,
    setup: {
      gameFormat: teams ? 'team-2v2v2v2' : 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
      ...setup,
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

function advanced(state: TournamentState, teamSize = 0): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, teamSize));
  if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
  return result.state;
}

/** The first round with lucky-loser slots, reached but not scored. */
function atFirstBracketRound(count: number): TournamentState {
  let state = start(count);
  while (state.rounds[state.curRound].luckyCount === 0) state = advanced(state);
  return state;
}

const textFor = (state: TournamentState, key: string) =>
  followBannerText(state, bracketFollowStatus(state, key), describeStandings(state), key);

const seated = (state: TournamentState, roundIndex: number, room: number) =>
  (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room).map((entry) => entry.name);

describe('followBannerText: pooling rounds', () => {
  it('names the room and the standing while the standings can change (37 players, Round 3)', () => {
    let state = start(37);
    state = advanced(advanced(state));
    const name = seated(state, 2, 2)[0];
    const standings = describeStandings(state);
    const text = textFor(state, name);
    expect(text.detail).toMatch(/^Round 3 · Room B · #\d+ in qualification$/);
    expect(text.detail).toContain(
      `#${standings?.tables[0].entries.find((entry) => entry.name === name)?.rank}`,
    );
  });

  it('names the group in a group stage ("#2 in Group B")', () => {
    const state = start(13, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      groupSize: '4',
      qualifiersPerGroup: '2',
      oddCountStrategy: 'bye',
    });
    const scored = scoreCurrentRound(state, 0);
    const name = seated(scored, 0, 1)[0];
    expect(textFor(scored, name).detail).toMatch(/^Round 1 · Group \w · Room \w · #\d+ in group$/);
  });

  it('says a unit sitting a round out has a bye', () => {
    const state = start(33, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'qual-table',
      oddCountStrategy: 'bye',
    });
    const byeName = state.byes[0]?.[0] ?? '';
    expect(byeName).not.toBe('');
    expect(textFor(state, byeName).detail).toBe('Round 1 · Bye');
  });
});

describe.each([31, 37, 43, 53])('followBannerText in the first bracket round with %i players', (count) => {
  const state = atFirstBracketRound(count);
  const label = bracketRoundLabels(state)[state.curRound].label;
  const name = seated(state, state.curRound, 1)[0];

  it('names only the room while it is being scored', () => {
    expect(textFor(state, name).detail).toBe(`${label} · Room A`);
  });

  it('adds the place and where it leads once the room is complete', () => {
    const scored = scoreCurrentRound(state, 0);
    const detail = textFor(scored, name).detail;
    expect(detail).toMatch(
      new RegExp(`^${label} · Room A · (1st|2nd|3rd|\\dth) (→ .+|out|· lucky loser\\?)$`),
    );
    expect(detail).toContain('1st →');
  });

  it('keeps the round and place and names the own next room of the unit once the next round is drawn', () => {
    const next = advanced(state);
    // "← Previous": the next round is drawn but the current round is the one just played.
    const back: TournamentState = { ...next, curRound: state.curRound };
    const nextRound = state.curRound + 1;
    const winners = (state.assignments[state.curRound] ?? [])
      .filter((entry) => entry.room === 1)
      .map((entry) => entry.name)
      .filter((candidate) => (next.assignments[nextRound] ?? []).some((entry) => entry.name === candidate));
    expect(winners.length).toBeGreaterThan(0);
    // Every unit that went on says exactly the room the next round drew it into.
    for (const unit of winners) {
      const room = (next.assignments[nextRound] ?? []).find((entry) => entry.name === unit)?.room ?? 0;
      const expected = roomTitle(next.rounds[nextRound], room - 1);
      expect(textFor(back, unit).detail).toMatch(
        new RegExp(`^${label} · Room A · \\d+(st|nd|rd|th) → ${expected}$`),
      );
    }
    // And the rooms really differ, so the check cannot pass by accident.
    const titles = new Set(winners.map((unit) => textFor(back, unit).detail.split('→ ')[1]));
    expect(titles.size).toBeGreaterThan(1);
  });

  it('says "Out in ..." with the place for a unit that did not go on', () => {
    const next = advanced(state);
    const room = (state.assignments[state.curRound] ?? []).filter((entry) => entry.room === 1);
    const out = room
      .map((entry) => entry.name)
      .find((candidate) => bracketFollowStatus(next, candidate)?.eliminated);
    expect(out).toBeDefined();
    expect(textFor(next, out ?? '').detail).toMatch(
      new RegExp(`^Out in ${label} · Room A · \\d+(st|nd|rd|th)$`),
    );
  });
});

describe('followBannerText: other cases', () => {
  it('says a unit that is not in the bracket is not in it', () => {
    const state = start(37);
    expect(followBannerText(state, null, describeStandings(state), 'Nobody').detail).toBe(
      'Not in this bracket',
    );
  });

  it('shows a team by its name (13 teams in 2v2v2v2)', () => {
    const state = atFirstBracketRoundTeams();
    const name = seated(state, state.curRound, 1)[0];
    const text = textFor(state, name);
    expect(text.name).toBe(text.name.trim());
    expect(text.detail).toMatch(/Room A$/);
  });
});

describe('rememberedFollow', () => {
  it('drops a team id this tournament does not have, keeps one it has (13 teams)', () => {
    const state = start(13, { qualAdv: '12' }, true);
    expect(rememberedFollow(state, 'team_1792345651683_2')).toBeNull();
    expect(rememberedFollow(state, 't3')).toBe('t3');
  });

  it('keeps a remembered name in an individual format, on the roster or not (37 players)', () => {
    const state = start(37);
    expect(rememberedFollow(state, 'Nobody')).toBe('Nobody');
    expect(rememberedFollow(state, null)).toBeNull();
  });
});

function atFirstBracketRoundTeams(): TournamentState {
  let state = start(13, { qualAdv: '12' }, true);
  for (let guard = 0; guard < 10 && state.rounds[state.curRound].isQual; guard += 1)
    state = advanced(state, 3);
  return state;
}

describe.each([31, 37, 43, 53])('standingsFollowText with %i players and a cut of 24', (count) => {
  const state = start(count);
  const labels = bracketRoundLabels(state);
  const lastQual = state.rounds.map((round) => round.isQual).lastIndexOf(true);
  let played = state;
  while (played.curRound < lastQual) played = advanced(played);
  const display = describeStandings(scoreCurrentRound(played, 0));

  it('says where each rank goes', () => {
    if (!display) throw new Error('no standings');
    const names = display.tables[0].entries.map((entry) => entry.name);
    const destination = labels[display.lastStandingsRoundIndex + 1].label;
    expect(standingsFollowText(display, names[13], labels)).toBe(`#14 · → ${destination}`);
    expect(standingsFollowText(display, names[29], labels)).toMatch(/^#\d+ · (→ .+|out)$/);
    expect(standingsFollowText(display, names[count - 1], labels)).toBe(`#${count} · out`);
  });

  it('is null for a name that is not in the table', () => {
    if (!display) throw new Error('no standings');
    expect(standingsFollowText(display, 'Nobody', labels)).toBeNull();
  });

  it('detail: the same text for a ranked unit, a note for a unit that is in no table', () => {
    if (!display) throw new Error('no standings');
    const names = display.tables[0].entries.map((entry) => entry.name);
    expect(standingsFollowDetail(display, names[count - 1], labels)).toBe(`#${count} · out`);
    expect(standingsFollowDetail(display, 'Nobody', labels)).toBe('Not in these standings');
  });
});

describe('standingsFollowText: a Qual source', () => {
  it('names the destination round of each run', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const display = describeStandings(exit);
    if (!display) throw new Error('no standings');
    const names = display.tables[0].entries.map((entry) => entry.name);
    const labels = bracketRoundLabels(exit);
    expect(standingsFollowText(display, names[0], labels)).toBe('#1 · → R1');
    expect(standingsFollowText(display, names[16], labels)).toBe('#17 · → R1C');
    expect(standingsFollowText(display, names[30], labels)).toBe('#31 · out');
  });
});

describe('standingsFollowDetail: before any round is scored', () => {
  it('is empty for a listed unit without a rank, not the "not in" note', () => {
    const state = start(37);
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    const name = display.tables[0].entries[0].name;
    expect(standingsFollowDetail(display, name, bracketRoundLabels(state))).toBe('');
  });
});
