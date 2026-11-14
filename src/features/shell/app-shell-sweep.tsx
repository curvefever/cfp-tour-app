import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActiveTab } from '../../domain/tournament/types';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { renderApp, tabsFor, type AppRole } from './test-app';

/**
 * The render sweep of `AppShell`: every tab of every fixture tournament, as a viewer and as an admin. It is cut
 * into parts, one test file each (`AppShell.sweep-1.render.test.tsx`, ...), because the vitest worker can answer
 * its runner only between files: one file that renders for more than a minute leaves it unanswered and the run ends
 * with "Timeout calling onTaskUpdate". Each file sets up its own mocks (`vi.mock` is per file) and calls
 * `describeSweep(part, parts)`.
 */

export const FALLBACK = "This page couldn't be shown.";

const ROLES: AppRole[] = ['viewer', 'admin'];

interface Row {
  name: string;
  fixture: FixtureTournament;
  role: AppRole;
  tab: ActiveTab;
}

function teamsOf(fixture: FixtureTournament) {
  return fixture.state.players.filter((player) => typeof player === 'object');
}

/** Every tab of every fixture and role, in a fixed order: part `part` (1-based) of `parts` takes every `parts`-th row. */
function rowsOfPart(part: number, parts: number): Row[] {
  return fixtureTournaments()
    .flatMap((fixture) =>
      ROLES.flatMap((role) =>
        tabsFor(fixture, role).map(({ key, label }) => ({
          name: `${fixture.id} · ${role} · ${label}`,
          fixture,
          role,
          tab: key,
        })),
      ),
    )
    .filter((_row, index) => index % parts === part - 1);
}

export function describeSweep(part: number, parts: number): void {
  describe(`AppShell, every tab of every fixture (part ${part} of ${parts})`, () => {
    let consoleError: MockInstance<typeof console.error>;

    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      cleanup();
      consoleError.mockRestore();
    });

    it.each(rowsOfPart(part, parts))('$name', ({ fixture, role, tab }) => {
      const view = renderApp(fixture, { role, tab });

      expect(consoleError).not.toHaveBeenCalled();
      expect(view.queryByText(FALLBACK)).toBeNull();
      if (tab !== 'tournaments') {
        expect(view.queryAllByRole('heading', { name: fixture.state.title }).length).toBeGreaterThan(0);
      }
      if (tab === 'rankings') {
        for (const team of teamsOf(fixture)) {
          expect(view.queryAllByText(team.teamId, { exact: true })).toHaveLength(0);
          expect(view.queryAllByText(team.teamName, { exact: true }).length).toBeGreaterThan(0);
        }
      }
    });
  });
}
