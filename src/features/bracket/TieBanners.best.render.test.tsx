// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A, B, EXAMPLE, scoreRooms, seatOf } from '../../domain/tournament/__tests__/best-place-fixtures';
import { atEntry, indexOf } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { withDependencyPlay } from '../../domain/tournament/__tests__/qual-waterfall';
import { unitDisplay } from '../../domain/tournament/roster';
import { TieBanners } from './TieBanners';

vi.mock('../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: null, updateState: () => {} }),
}));

afterEach(cleanup);

describe('the tie banner of a best place', () => {
  const entry = withDependencyPlay(atEntry(37, EXAMPLE));
  // Rooms B and C tie at the 6th place; room A is behind.
  const state = scoreRooms(entry, indexOf(entry, 'R4'), [A, B, B]);
  const nameOf = (room: number) => unitDisplay(state, seatOf(state, room, 5)).label;

  it('names the round, the place and the spots, and the tied units with their rooms', () => {
    render(<TieBanners state={state} />);
    expect(screen.getByText('⚠ Tie-break required — R4 · best 6th (1 spot in R5)')).toBeTruthy();
    expect(
      screen.getByText(`tied: ${nameOf(2)} (Room B), ${nameOf(3)} (Room C) — pick who goes through`, {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it('offers one button per tied unit, "goes through", and no way to share points', () => {
    render(<TieBanners state={state} />);
    expect(screen.getByRole('button', { name: `${nameOf(2)} (Room B) goes through` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${nameOf(3)} (Room C) goes through` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share points' })).toBeNull();
  });
});
