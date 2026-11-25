import { describe, expect, it } from 'vitest';
import { zeroScoresInPlay } from '../absences';
import { answerAbsence } from '../absence-answers';
import { computeRankings } from '../rankings';
import { generateTournament } from '../generation';
import { isRoundDone } from '../round-columns';
import { isRoomScored, scoreKeysForPosition, scoredTeamSize } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { playDependency, playToBracketEntry, scoreRound, STRATEGIES } from './dependency-play-fixtures';
import { rosterFor, startedState, testRuntime } from './test-fixtures';

/** The built-in upper and lower bracket of 31 FFA players: its ranking rooms hold the units that play for places. */
function upperLower31(): TournamentState {
  const form = createDefaultSetup({
    gameFormat: 'ffa-individual',
    scheduleLogic: 'upper-lower',
    poolingPhase: 'qual-table',
    qualAdv: '32',
  });
  return startedState(
    generateTournament(
      createDefaultTournamentState({ confirmedCount: 31, players: rosterFor(form.gameFormat, 31) }),
      form,
      testRuntime(),
    ),
  );
}

const stillIn = (state: TournamentState) =>
  new Set((computeRankings(state)?.stillActive ?? []).map((unit) => unit.name));

const unitsOfRoom = (state: TournamentState, roundIndex: number, room: number) =>
  state.assignments[roundIndex].filter((entry) => entry.room === room).map((entry) => entry.name);

/** Plays the upper and lower bracket and hands every ranking round that is scored and not sent on to `check`. */
function atScoredRankingRounds(check: (state: TournamentState, roundIndex: number) => void): void {
  const entered = playToBracketEntry(upperLower31());
  playDependency(entered, STRATEGIES['all at once'], undefined, (state, index) => {
    const scored = scoreRound(state, index);
    if (scored.rounds[index].waterfallRanking && !isRoundDone(scored, index)) check(scored, index);
    return scored;
  });
}

describe('Rankings counts a unit of a scored ranking room out before the round is sent on', () => {
  it('takes every unit of a complete ranking room off the list of units still in', () => {
    let seen = 0;
    atScoredRankingRounds((state, roundIndex) => {
      const active = stillIn(state);
      const rooms = new Set(state.assignments[roundIndex].map((entry) => entry.room));
      for (const room of rooms) {
        if (room === null || !isRoomScored(state, roundIndex, room)) continue;
        for (const name of unitsOfRoom(state, roundIndex, room)) {
          expect(active.has(name), `${name} in room ${room} of round ${roundIndex}`).toBe(false);
          seen += 1;
        }
      }
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps the one unit that was present in a ranking room whose other units were absent, and counts the absentees out', () => {
    let checked = false;
    atScoredRankingRounds((state, roundIndex) => {
      if (checked) return;
      const room = 1;
      const names = unitsOfRoom(state, roundIndex, room);
      const scores = { ...state.scores };
      for (let position = 1; position < names.length; position += 1) {
        for (const key of scoreKeysForPosition({
          roundIndex,
          room,
          position,
          teamSize: scoredTeamSize(state),
        })) {
          scores[key] = 0;
        }
      }
      const zeroed = { ...state, scores };
      const keys = zeroScoresInPlay(zeroed)
        .flatMap((asked) => asked.questions)
        .filter((question) => question.roundIndex === roundIndex && question.room === room)
        .map((question) => question.key);
      const marked = answerAbsence(zeroed, keys, 'absent');
      const active = stillIn(marked);
      expect(keys.length).toBe(names.length - 1);
      expect(active.has(names[0])).toBe(true);
      for (const name of names.slice(1)) expect(active.has(name)).toBe(false);
      checked = true;
    });
    expect(checked).toBe(true);
  });
});
