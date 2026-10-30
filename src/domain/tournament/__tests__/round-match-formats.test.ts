import { describe, expect, it } from 'vitest';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { bestOfGameCount } from '../match-format';
import { removeRosterUnit } from '../mutations';
import { refitPoolingRound } from '../pooling';
import {
  applyMatchFormats,
  matchFormatConfig,
  matchOverrideRows,
  matchOverridesText,
  matchStage,
  parseMatchOverrides,
  withFormMatchFormats,
  withMatchOverride,
  type RoundStage,
} from '../round-match-formats';
import type { RoomSize, TournamentRound, TournamentState } from '../types';
import { advanceTournamentRound } from '../transitions';
import { createDefaultSetup } from '../state-defaults';
import { generate } from './fair-cut-fixtures';
import { scoreCurrentRound } from './play-through';
import { QUAL_GRAPH, buildQualWaterfall } from './qual-waterfall';

const stageOf = (state: TournamentState) => state.rounds.map(matchStage);
const roundsOf = (state: TournamentState, stage: RoundStage) =>
  state.rounds.filter((round) => matchStage(round) === stage);
const formatOf = ({ bestOf, numGames }: TournamentRound) => ({ bestOf, numGames });

describe('the stage of a round', () => {
  it('names pooling, bracket, Semis and Final in single elimination with Swiss, and no stage for nothing else', () => {
    const state = generate('1v1-37', 37, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'swiss',
      swissRoundsOverride: '3',
    });
    const stages = stageOf(state);
    expect(stages.slice(0, 3)).toEqual(['pooling', 'pooling', 'pooling']);
    expect(stages.at(-1)).toBe('finals');
    expect(stages.at(-2)).toBe('semis');
    expect(stages.slice(3, -2).every((stage) => stage === 'bracket')).toBe(true);
  });

  it('names the winners and losers rounds of a double elimination, and leaves the race Grand Final out', () => {
    const race = generate('1v1-31', 31, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
    });
    expect(stageOf(race)).toContain('losers');
    expect(stageOf(race).at(-1)).toBeNull();
    expect(race.rounds.at(-1)).toMatchObject({ bracket: 'grand-final' });
  });
});

describe('every stage of 1v1 single elimination at 37 and 53 played as Best of 3, the Final as Best of 5', () => {
  for (const count of [37, 53]) {
    it(`at ${count}: Swiss, the elimination rounds and the Semis are Best of 3 over 3 games, the Final Best of 5 over 5`, () => {
      const state = generate('1v1', count, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'swiss',
        swissRoundsOverride: '3',
        qualAdv: '16',
        poolingBestOf: '3',
        bracketBestOf: '3',
        semisBestOf: '3',
        finalsBestOf: '5',
      });
      expect(roundsOf(state, 'pooling')).toHaveLength(3);
      for (const stage of ['pooling', 'bracket', 'semis'] as const) {
        expect(roundsOf(state, stage).length).toBeGreaterThan(0);
        for (const round of roundsOf(state, stage))
          expect(formatOf(round)).toEqual({ bestOf: 3, numGames: 3 });
      }
      expect(formatOf(roundsOf(state, 'finals')[0])).toEqual({ bestOf: 5, numGames: 5 });
      expect(state.gamemodeConfig).toMatchObject({
        poolingBestOf: 3,
        bracketBestOf: 3,
        semisBestOf: 3,
        finalsBestOf: 5,
      });
      expect(state.settings).toMatchObject({ poolingBestOf: '3', bracketBestOf: '3', matchOverrides: '' });
    });
  }
});

describe('a pooling round as Best of 3 sizes its games from its largest room', () => {
  it('FFA at 37, qualification table: rooms of 8 play 9 games; a refitted round of 7s plays 8', () => {
    const state = generate('ffa-37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
      poolingBestOf: '3',
    });
    const pooling = roundsOf(state, 'pooling');
    expect(pooling.length).toBeGreaterThan(1);
    for (const round of pooling) {
      expect(Math.max(...round.rooms)).toBe(8);
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: 9 });
    }
    const roomSize = state.gamemodeConfig.roomSize as RoomSize;
    const sevens = refitPoolingRound(pooling[0], 35, roomSize, state.gamemodeConfig.oddCountStrategy);
    expect(sevens.rooms).toEqual([7, 7, 7, 7, 7]);
    expect(formatOf(sevens)).toEqual({ bestOf: 3, numGames: 8 });
  });

  it('a summed pooling round keeps its game count when it is refitted', () => {
    const state = generate('ffa-37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
      poolingGames: '2',
    });
    const round = roundsOf(state, 'pooling')[0];
    expect(formatOf(round)).toEqual({ bestOf: undefined, numGames: 2 });
    const refitted = refitPoolingRound(round, 35, state.gamemodeConfig.roomSize as RoomSize, undefined);
    expect(refitted.numGames).toBe(2);
  });
});

describe('double elimination', () => {
  it('race, 1v1 at 31: winners rounds Best of 3, losers rounds one game, the Grand Final unchanged', () => {
    const base = {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
    } as const;
    const state = generate('race', 31, { ...base, bracketBestOf: '3' });
    const plain = generate('race', 31, base);
    const winners = state.rounds.filter((round) => round.bracket === 'winners');
    expect(winners.length).toBeGreaterThan(0);
    for (const round of winners) expect(formatOf(round)).toEqual({ bestOf: 3, numGames: 3 });
    for (const round of state.rounds.filter((entry) => entry.bracket === 'losers')) {
      expect(formatOf(round)).toEqual({ bestOf: undefined, numGames: undefined });
    }
    const grandFinal = (rounds: TournamentRound[]) =>
      rounds.filter((round) => round.bracket === 'grand-final');
    expect(grandFinal(state.rounds)).toEqual(grandFinal(plain.rounds));
    expect(grandFinal(state.rounds)[0]).toMatchObject({ numGames: 1 });
    expect(state.gamemodeConfig).not.toHaveProperty('losersBestOf');
  });

  it('shared Final, FFA at 43: winners 2 games, losers Best of 3, the Final Best of 3', () => {
    const state = generate('shared', 43, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
      bracketGames: '2',
      losersBestOf: '3',
      finalsBestOf: '3',
    });
    const winners = state.rounds.filter((round) => round.bracket === 'winners');
    const losers = state.rounds.filter((round) => round.bracket === 'losers');
    expect(winners.length).toBeGreaterThan(0);
    expect(losers.length).toBeGreaterThan(0);
    for (const round of winners) expect(formatOf(round)).toEqual({ bestOf: undefined, numGames: 2 });
    for (const round of losers) {
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...round.rooms)) });
    }
    const final = roundsOf(state, 'finals')[0];
    expect(formatOf(final)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...final.rooms)) });
  });
});

describe('Kings Valley, 2v2v2 at 19', () => {
  const setup = {
    gameFormat: 'team-2v2v2',
    teamScoringRule: ONE_SCORE_PER_TEAM,
    scheduleLogic: 'kings-valley',
    poolingPhase: 'none',
    bracketBestOf: '3',
  } as const;

  it('plays the ladder rounds as Best of 3 over the games of their largest room', () => {
    const state = generate('kv', 19, setup);
    const ladder = state.rounds.filter((round) => round.isKingsValley);
    expect(ladder.length).toBeGreaterThan(1);
    for (const round of ladder) {
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...round.rooms)) });
    }
  });

  it('keeps Best of 3 on the re-planned tail after a withdrawal, with the games of the new rooms', () => {
    let state = generate('kv', 19, setup);
    const victim = state.assignments[state.curRound].find((entry) => entry.room !== null)?.name as string;
    state = removeRosterUnit(state, victim);
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(advanced)}`);
    const tail = advanced.state.rounds.slice(advanced.state.curRound);
    const ladder = tail.filter((round) => round.isKingsValley);
    expect(ladder.length).toBeGreaterThan(0);
    for (const round of ladder) {
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...round.rooms)) });
    }
    expect(tail.at(-1)?.isFinal).toBe(true);
  });
});

describe('a group stage', () => {
  const setup = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'group-stage',
  } as const;

  it('1v1 at 37: every group round is pooling, Best of 3 over 3 games, and its matches are unchanged', () => {
    const plain = generate('groups', 37, setup);
    const state = generate('groups', 37, { ...setup, poolingBestOf: '3' });
    const groupRounds = state.rounds.filter((round) => round.isGroupStage);
    expect(groupRounds.length).toBeGreaterThan(1);
    for (const round of groupRounds) {
      expect(matchStage(round)).toBe('pooling');
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: 3 });
    }
    const matches = (rounds: TournamentRound[]) =>
      rounds.filter((round) => round.isGroupStage).map((round) => round.matches);
    expect(matches(state.rounds)).toEqual(matches(plain.rounds));
    expect(state.groups).toEqual(plain.groups);
  });
});

describe('a Custom bracket with a Qual phase', () => {
  it('plays the pooling rounds as Best of 3 and leaves the graph rounds as they are', () => {
    const plain = buildQualWaterfall(37, QUAL_GRAPH);
    const state = buildQualWaterfall(37, QUAL_GRAPH, { poolingBestOf: '3' });
    const pooling = roundsOf(state, 'pooling');
    expect(pooling.length).toBeGreaterThan(0);
    for (const round of pooling) {
      expect(formatOf(round)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...round.rooms)) });
    }
    const graph = (rounds: TournamentRound[]) => rounds.filter((round) => round.isWaterfall);
    expect(graph(state.rounds).length).toBeGreaterThan(0);
    expect(graph(state.rounds)).toEqual(graph(plain.rounds));
    expect(
      stageOf(state)
        .filter((stage) => stage !== 'pooling')
        .every((stage) => stage === null),
    ).toBe(true);
  });

  it('ignores a bracket or losers format, which the graph rounds do not have', () => {
    const plain = buildQualWaterfall(37, QUAL_GRAPH);
    const state = buildQualWaterfall(37, QUAL_GRAPH, { bracketBestOf: '3', losersGames: '2' });
    expect(state.rounds).toEqual(plain.rounds);
    expect(state.gamemodeConfig).not.toHaveProperty('bracketBestOf');
    expect(state.gamemodeConfig).not.toHaveProperty('losersGames');
  });
});

describe('round overrides', () => {
  const base = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'none',
    bracketBestOf: '3',
  } as const;

  it('"Round 3" = GAMES 1 wins over Elimination rounds Best of 3', () => {
    const state = generate('1v1-37', 37, { ...base, matchOverrides: 'Round 3: GAMES 1' });
    const round = (num: number) => state.rounds.find((entry) => entry.roundNum === num) as TournamentRound;
    expect(formatOf(round(3))).toEqual({ bestOf: undefined, numGames: undefined });
    expect(formatOf(round(4))).toEqual({ bestOf: 3, numGames: 3 });
    expect(state.gamemodeConfig.matchOverrides).toEqual({ 'Round 3': 'GAMES 1' });
  });

  it('can raise a round over its stage: a warm-up to 2 games, the Semis to Best of 5', () => {
    const state = generate('1v1-37', 37, { ...base, matchOverrides: 'Round 1: GAMES 2\nSemis: BO5' });
    expect(formatOf(state.rounds[0])).toEqual({ bestOf: undefined, numGames: 2 });
    expect(formatOf(state.rounds[1])).toEqual({ bestOf: undefined, numGames: undefined });
    expect(formatOf(roundsOf(state, 'semis')[0])).toEqual({ bestOf: 5, numGames: 5 });
  });

  it('ignores an override whose name no round has, and a text that is no match format', () => {
    const plain = generate('1v1-37', 37, base);
    const state = generate('1v1-37', 37, {
      ...base,
      matchOverrides: 'Round 99: BO5\nRound 3: BO4\nnonsense',
    });
    expect(state.rounds).toEqual(plain.rounds);
    // The orphan stays in the config for the Setup list to show; the text that is no format is dropped.
    expect(state.gamemodeConfig.matchOverrides).toEqual({ 'Round 99': 'BO5' });
  });

  it('applies to the rounds after `from` only', () => {
    const state = generate('1v1-37', 37, base);
    const reformatted = applyMatchFormats(state.rounds, { bracketBestOf: undefined, bracketGames: 2 }, 4);
    expect(reformatted.slice(0, 4)).toEqual(state.rounds.slice(0, 4));
    expect(formatOf(reformatted[4])).toEqual({ bestOf: undefined, numGames: 2 });
  });

  it('reads and writes the Setup text one line per round', () => {
    expect(parseMatchOverrides('Round 2: BO3\r\nSemis: GAMES 2\nbad: BO4\n: BO3\nRound 2: GAMES 1')).toEqual({
      'Round 2': 'GAMES 1',
      Semis: 'GAMES 2',
    });
    expect(matchOverridesText({ 'Round 2': 'BO3', 'WB Round 1 (2)': 'GAMES 2' })).toBe(
      'Round 2: BO3\nWB Round 1 (2): GAMES 2',
    );
  });
});

describe('an existing setup', () => {
  it('generates the rounds it always did: no Best of N anywhere, a game count only on the Semis and the Final', () => {
    const state = generate('ffa-37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
    });
    for (const round of state.rounds) {
      expect(round).not.toHaveProperty('bestOf');
      if (round.isSemis) expect(round.numGames).toBe(1);
      else if (round.isFinal) expect(round.numGames).toBe(3);
      else expect(round).not.toHaveProperty('numGames');
    }
    for (const key of ['poolingGames', 'bracketGames', 'losersGames', 'matchOverrides', 'poolingBestOf']) {
      expect(state.gamemodeConfig).not.toHaveProperty(key);
    }
  });
});

describe('the match formats of the Setup form', () => {
  it('keeps what the stages ask for, and ignores a select the schedule does not show', () => {
    const form = createDefaultSetup({
      poolingBestOf: '3',
      bracketGames: '2',
      losersBestOf: '5',
      semisBestOf: '3',
      finalsBestOf: '7',
      matchOverrides: 'Round 2: BO3\nbad: BO4',
    });
    expect(matchFormatConfig(form, 'single-elimination')).toEqual({
      finalsGames: 3,
      semisGames: 1,
      finalsBestOf: 7,
      semisBestOf: 3,
      poolingBestOf: 3,
      bracketGames: 2,
      matchOverrides: { 'Round 2': 'BO3' },
    });
    expect(matchFormatConfig(form, 'double-elimination')).toMatchObject({ losersBestOf: 5 });
    expect(matchFormatConfig(form, 'double-elimination')).not.toHaveProperty('finalsBestOf');
    expect(matchFormatConfig(form, 'double-elimination')).not.toHaveProperty('semisBestOf');
    const custom = matchFormatConfig(form, 'waterfall-bracket');
    expect(custom).not.toHaveProperty('bracketGames');
    expect(custom).not.toHaveProperty('losersBestOf');
    expect(custom).toMatchObject({ poolingBestOf: 3 });
  });
});

describe('a drawn schedule played in the formats of the form now', () => {
  const setup = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'swiss',
    swissRoundsOverride: '3',
    qualAdv: '16',
  } as const;

  /** Generated and not started: the state Setup holds while the organiser edits the formats. */
  const drawnSchedule = () => ({ ...generate('1v1-37', 37, setup), started: false });

  it('1v1 at 37: takes a stage format, an override and a Semis format, and the snapshot follows', () => {
    const drawn = drawnSchedule();
    const form = createDefaultSetup({
      ...setup,
      poolingBestOf: '3',
      semisBestOf: '3',
      matchOverrides: 'Round 2: GAMES 2',
    });
    const next = withFormMatchFormats(drawn, form);
    expect(next.rounds.slice(0, 3).map(formatOf)).toEqual([
      { bestOf: 3, numGames: 3 },
      { bestOf: undefined, numGames: 2 },
      { bestOf: 3, numGames: 3 },
    ]);
    expect(formatOf(roundsOf(next, 'semis')[0])).toEqual({ bestOf: 3, numGames: 3 });
    expect(next.gamemodeConfig).toMatchObject({
      poolingBestOf: 3,
      semisBestOf: 3,
      matchOverrides: { 'Round 2': 'GAMES 2' },
    });
    expect(next.settings).toMatchObject({ poolingBestOf: '3', matchOverrides: 'Round 2: GAMES 2' });
    expect(next.rounds.map((round) => round.rooms)).toEqual(drawn.rounds.map((round) => round.rooms));
  });

  it('puts the schedule back as it was when the form goes back to its defaults', () => {
    const drawn = drawnSchedule();
    const changed = withFormMatchFormats(drawn, createDefaultSetup({ ...setup, poolingBestOf: '3' }));
    const back = withFormMatchFormats(changed, createDefaultSetup(setup));
    expect(back.rounds).toEqual(drawn.rounds);
    expect(back.gamemodeConfig).toEqual(drawn.gamemodeConfig);
  });

  it('leaves a started tournament and an undrawn one alone', () => {
    const drawn = drawnSchedule();
    const form = createDefaultSetup({ ...setup, poolingBestOf: '3' });
    const started = { ...drawn, started: true };
    expect(withFormMatchFormats(started, form)).toBe(started);
    const undrawn = { ...drawn, rounds: [] };
    expect(withFormMatchFormats(undrawn, form)).toBe(undrawn);
  });
});

describe('the rows of the override list', () => {
  it('lists the rounds that have a stage under their shown names, then the overrides no round has', () => {
    const state = generate('race', 31, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
    });
    const rows = matchOverrideRows(state, 'Round 2: BO3\nNowhere: GAMES 2');
    const real = rows.filter((row) => !row.orphan);
    expect(real).toHaveLength(state.rounds.filter((round) => matchStage(round)).length);
    expect(real.map((row) => row.stage)).toContain('losers');
    expect(real.find((row) => row.name === 'Round 2')?.token).toBe('BO3');
    expect(real.every((row) => row.name !== 'Grand Final')).toBe(true);
    expect(rows.at(-1)).toEqual({ name: 'Nowhere', token: 'GAMES 2', orphan: true });
  });

  it('leaves the graph rounds of a Custom bracket out', () => {
    const state = buildQualWaterfall(37, QUAL_GRAPH);
    const rows = matchOverrideRows(state, '');
    expect(rows.length).toBe(roundsOf(state, 'pooling').length);
  });

  it("sets, replaces and removes one round's line", () => {
    const text = 'Round 2: BO3\nSemis: GAMES 2';
    expect(withMatchOverride(text, 'Round 4', 'GAMES 3')).toBe(
      'Round 2: BO3\nSemis: GAMES 2\nRound 4: GAMES 3',
    );
    expect(withMatchOverride(text, 'Semis', 'BO5')).toBe('Round 2: BO3\nSemis: BO5');
    expect(withMatchOverride(text, 'Round 2', '')).toBe('Semis: GAMES 2');
    expect(withMatchOverride('Round 2: BO3', 'Round 2', '')).toBe('');
  });
});
