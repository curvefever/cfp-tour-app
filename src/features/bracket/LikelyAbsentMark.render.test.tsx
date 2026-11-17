// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterRound1, teamsAfterRound1 } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import { answerAbsence } from '../../domain/tournament/absences';
import { markBack } from '../../domain/tournament/likely-absentees';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { renderApp } from '../../test-support/test-app';

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));
vi.mock('../auth/server/session-check.server-fns', () => ({ checkSession: () => Promise.resolve('valid') }));
vi.mock('../version/build-id.server-fns', async () => {
  const { TOUR_BUILD_ID } = await import('../version/build-id');
  return { getLiveBuild: () => Promise.resolve(TOUR_BUILD_ID) };
});

window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const fixtureOf = (state: TournamentState) => ({
  id: 'likely-absent-mark',
  state: { ...state, tournamentId: 'likely-absent-mark' },
  status: 'published' as const,
  tabs: ['Bracket'],
});

const MARK = 'ABS?';
const TITLE = /^Absent in .+ and not back yet$/;

// 37 players in rooms of 6-8, the first seat of room 1 answered absent in round 1, advanced to round 2.
function afterOneAbsent(version: 2 | 3 = 3) {
  const state = afterRound1([[1, 0]], version, 37);
  const absent = state.assignments[0].find((entry) => entry.room === 1)?.name ?? '';
  const seat = state.assignments[1].find((entry) => entry.name === absent);
  const position = state.assignments[1].filter((entry) => entry.room === seat?.room).indexOf(seat!);
  return { state, absent, key: `r1-rm${seat?.room}-p${position}` };
}

/** The room rows that show the mark. */
function marked(view: ReturnType<typeof renderApp>): HTMLElement[] {
  return view.queryAllByText(MARK);
}

describe('the "ABS?" mark on a Bracket row', () => {
  it.each(['viewer', 'admin'] as const)(
    'shows %s the mark on the absentee’s round 2 row, with its tooltip',
    (role) => {
      const { state, absent } = afterOneAbsent();
      const view = renderApp(fixtureOf(state), { role, tab: 'bracket' });

      const [mark, ...others] = marked(view);
      expect(others).toHaveLength(0);
      expect(mark.getAttribute('title')).toMatch(TITLE);
      expect(mark.getAttribute('aria-label')).toBe(mark.getAttribute('title'));
      // The mark sits in the absentee's own row, after the name.
      const row = mark.closest('div.min-h-8') as HTMLElement;
      expect(row.textContent).toContain(absent);
      // Not in the round that was missed: the mark is in a later column than the first.
      expect(mark.closest('[data-round-column]')).not.toBe(
        view.container.querySelector('[data-round-column]'),
      );
    },
  );

  it('is gone once the player is marked back', () => {
    const { state, absent } = afterOneAbsent();
    const view = renderApp(fixtureOf(markBack(state, absent)), { role: 'viewer', tab: 'bracket' });
    expect(marked(view)).toHaveLength(0);
  });

  it('is gone once the player scores, stays on an unanswered 0, and gives way to ABS when that 0 is answered absent', () => {
    const { state, key } = afterOneAbsent();
    const scored = { ...state, scores: { ...state.scores, [key]: 50 } };
    expect(marked(renderApp(fixtureOf(scored), { role: 'viewer', tab: 'bracket' }))).toHaveLength(0);
    cleanup();

    const zero = { ...state, scores: { ...state.scores, [key]: 0 } };
    expect(marked(renderApp(fixtureOf(zero), { role: 'viewer', tab: 'bracket' }))).toHaveLength(1);
    cleanup();

    const answered = answerAbsence(zero, [key], 'absent');
    const view = renderApp(fixtureOf(answered), { role: 'viewer', tab: 'bracket' });
    expect(marked(view)).toHaveLength(0);
    // The score place of the absent row reads "ABS" (round 1's absentee is in a folded round).
    expect(view.queryAllByText('ABS').length).toBeGreaterThan(0);
  });

  it('never shows in a tournament without absenceVersion 3', () => {
    const { state } = afterOneAbsent(2);
    expect(marked(renderApp(fixtureOf(state), { role: 'viewer', tab: 'bracket' }))).toHaveLength(0);
  });

  it('shows on the row of a team whose every member was absent, not on one with a member back, in 13 teams', () => {
    const state = teamsAfterRound1([
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    const view = renderApp(fixtureOf(state), { role: 'viewer', tab: 'bracket' });

    const [mark, ...others] = marked(view);
    expect(others).toHaveLength(0);
    const bothAbsent = state.assignments[0].filter((entry) => entry.room === 1)[0].name;
    const row = mark.closest('div.min-h-8') as HTMLElement;
    expect(row.textContent).toContain(unitDisplay(state, bothAbsent).label);
  });
});
