// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { bestPlaceTieKey } from '../../domain/tournament/best-place';
import { resolveTournamentTie } from '../../domain/tournament/mutations';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import {
  A,
  B,
  C,
  EXAMPLE,
  ZEROS,
  scoreRooms,
  seatOf,
} from '../../domain/tournament/__tests__/best-place-fixtures';
import { atEntry, indexOf, pressed } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { withDependencyPlay } from '../../domain/tournament/__tests__/qual-waterfall';
import { BestPlaceRacePanel, showsBestPlaceRace } from './RoundNotes';

afterEach(cleanup);

/** The best-of-a-place race under a round's rooms (`plans/2026-11-13-best-of-a-place.md`, stage 6). */

const entry = withDependencyPlay(atEntry(37, EXAMPLE));
const r4 = indexOf(entry, 'R4');
const scored = (rooms: number[][]) => scoreRooms(entry, r4, rooms);
const labelOf = (state: TournamentState, room: number) => unitDisplay(state, seatOf(state, room, 5)).label;
const panel = (state: TournamentState) => render(<BestPlaceRacePanel roundIndex={r4} state={state} />);
const textOf = (state: TournamentState) => panel(state).container.textContent ?? '';

describe('the best-of-a-place race', () => {
  it('names the place, the spots and the round they go to', () => {
    expect(textOf(scored([A, B, C]))).toContain('★ BEST 6TH · 1 SPOT → R5');
  });

  it('says spots in the plural', () => {
    const state = scored([A, B, C]);
    const two = {
      ...state,
      rounds: state.rounds.map((round, index) =>
        index === r4 && round.waterfallBest
          ? { ...round, waterfallBest: { ...round.waterfallBest, count: 2 } }
          : round,
      ),
    };
    expect(textOf(two)).toContain('★ BEST 6TH · 2 SPOTS → R5');
  });

  it('lists the candidates best first with their rank, room and share of their room', () => {
    const state = scored([A, B, C]);
    const text = textOf(state);
    // C 36 of an average of 45.5, B 35 of 46.25, A 30 of 45.
    const order = [3, 2, 1].map((room) => text.indexOf(`${labelOf(state, room)}Room ${'ABC'[room - 1]}`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((first, second) => first - second)).toEqual(order);
    expect(text).toMatch(/1.*Room C79%.*2.*Room B76%.*3.*Room A67%/u);
  });

  it('shows a dash for a room with no points, ranked after the others', () => {
    const state = scored([A, B, ZEROS]);
    const text = textOf(state);
    expect(text).toMatch(/Room B76%.*Room A67%.*Room C—/u);
    expect(text).not.toContain('100%');
  });

  it('says which rooms are still being played, and shows a dash for a room not scored yet', () => {
    const state = scored([A, B]);
    const text = textOf(state);
    expect(text).toContain('Room C still playing.');
    expect(text).toMatch(/Room C—/u);
  });

  it('lists the organiser’s pick first when two shares are level', () => {
    const tied = scored([A, B, B]);
    const picked = resolveTournamentTie(tied, bestPlaceTieKey(r4), seatOf(tied, 3, 5));
    const text = textOf(picked);
    expect(text.indexOf(`${labelOf(picked, 3)}Room C`)).toBeLessThan(
      text.indexOf(`${labelOf(picked, 2)}Room B`),
    );
    // Level shares read alike, so each carries the dotted underline and its precise title.
    const rows = panel(picked).container.querySelectorAll('[title]');
    expect([...rows].filter((row) => row.className.includes('underline'))).toHaveLength(2);
  });
});

describe('when the race is shown', () => {
  it('shows while the round is in play', () => {
    expect(showsBestPlaceRace(scored([A, B, C]), r4)).toBe(true);
  });

  it('is hidden on a round with no best of a place', () => {
    const state = scored([A, B, C]);
    const plain = {
      ...state,
      rounds: state.rounds.map((round, index) => {
        if (index !== r4) return round;
        const { waterfallBest: _best, ...rest } = round;
        return rest;
      }),
    };
    expect(showsBestPlaceRace(plain, r4)).toBe(false);
  });

  it('is hidden on a round that is not in play, and once the round is sent on', () => {
    const state = scored([A, B, C]);
    expect(showsBestPlaceRace(state, indexOf(state, 'R5'))).toBe(false);
    expect(showsBestPlaceRace(pressed(state), r4)).toBe(false);
  });
});
