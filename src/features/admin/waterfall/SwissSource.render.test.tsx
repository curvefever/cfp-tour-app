// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoredAlike } from '../../../domain/tournament/__tests__/qual-waterfall';
import {
  SWISS_LINELESS_GRAPH,
  atEntry,
  swiss,
  toSwissExit,
} from '../../../domain/tournament/__tests__/swiss-source-fixtures';
import type { TournamentState } from '../../../domain/tournament/types';
import { TieBanners } from '../../bracket/TieBanners';
import { RunningWaterfallPanel } from './RunningWaterfallPanel';

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: null, updateState: () => {} }),
}));

afterEach(cleanup);

const tiedAlike = (state: TournamentState) =>
  toSwissExit(state, (current, index) => scoredAlike({ ...current, curRound: index }));

describe('the running Admin graph of a Swiss with a Qual line', () => {
  it('names the source "Swiss standings" and shows the routed ranks, in edit mode too', () => {
    render(<RunningWaterfallPanel state={swiss(11)} />);
    expect(screen.getAllByText('Swiss standings').length).toBeGreaterThan(0);
    expect(screen.queryByText('Qualification table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    expect(screen.getAllByText('Swiss standings').length).toBeGreaterThan(0);
    expect(screen.queryByText('Qualification table')).toBeNull();
    expect(screen.getByLabelText(/Swiss standings, rank 4, to U/)).toBeTruthy();
    expect(screen.getByLabelText(/Swiss standings, rank 5, to L/)).toBeTruthy();
  });

  it('shows the same once the bracket is entered', () => {
    render(<RunningWaterfallPanel state={atEntry(swiss(11))} />);
    expect(screen.getAllByText('Swiss standings').length).toBeGreaterThan(0);
  });

  it('shows no such block for a Swiss with no Qual line', () => {
    render(<RunningWaterfallPanel state={swiss(11, { qualAdv: '8' }, SWISS_LINELESS_GRAPH)} />);
    expect(screen.queryByText('Swiss standings')).toBeNull();
    expect(screen.queryByText('Qualification table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    expect(screen.queryByText('Swiss standings')).toBeNull();
    expect(screen.queryByText('Qualification table')).toBeNull();
  });
});

describe('the tie banners after a Swiss', () => {
  it('read "Swiss tie" when the graph has a Qual line', () => {
    render(<TieBanners state={tiedAlike(swiss(11))} />);
    expect(screen.getByText(/Swiss tie between U and L/)).toBeTruthy();
    expect(screen.getByText(/Swiss tie between L and elimination/)).toBeTruthy();
    expect(screen.queryByText(/Qualification tie/)).toBeNull();
  });

  it('keep "Qualification tie" when the Swiss has no Qual line', () => {
    render(<TieBanners state={tiedAlike(swiss(11, { qualAdv: '8' }, SWISS_LINELESS_GRAPH))} />);
    expect(screen.getByText(/Qualification tie/)).toBeTruthy();
    expect(screen.queryByText(/Swiss tie/)).toBeNull();
  });
});
