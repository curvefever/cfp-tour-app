// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseWaterfallDraft,
  resizeWaterfallRound,
  type WaterfallDraft,
} from '../../../domain/tournament/waterfall-draft';
import { WaterfallBestField } from './WaterfallBestField';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: null, updateState: () => {} }),
}));

afterEach(cleanup);

const graphText = (rounds: string[], routes: string[]) =>
  `ROUNDS:\n${rounds.join('\n')}\n\nROUTES:\n${routes.join('\n')}`;
const ROUNDS = ['R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'];
const ROOMS = ['A', 'B', 'C'].map((room) => `R4.${room}: 1-5->R5, 6-8->eliminated`);
const AFTER = ['R5.A: 1-4->Final, 5-8->eliminated', 'R5.B: 1-4->Final, 5-8->eliminated'];
const PLAIN = graphText(ROUNDS, [...ROOMS, ...AFTER]);
const WITH_BEST = graphText(ROUNDS, [...ROOMS, 'R4.BEST: 1 OF 6->R5', ...AFTER]);

function draftOf(text: string): WaterfallDraft {
  const parsed = parseWaterfallDraft(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const roundOf = (draft: WaterfallDraft, label: string) =>
  draft.rounds.find((round) => round.label === label) as WaterfallDraft['rounds'][number];

function field(text: string, label: string, onSetBest?: (best: unknown) => void) {
  const draft = draftOf(text);
  return render(<WaterfallBestField draft={draft} onSetBest={onSetBest} round={roundOf(draft, label)} />);
}

const select = (name: string) => screen.getByLabelText<HTMLSelectElement>(name);
const optionsOf = (name: string) => Array.from(select(name).options).map((option) => option.text);

describe('the Best of a place field', () => {
  it('is not offered on the Final, on a ranking match or on a round of one room', () => {
    field(PLAIN, 'Final', () => {});
    expect(screen.queryByText('Best of a place')).toBeNull();
    cleanup();
    field(PLAIN.replace('R5 = 2x8', 'R5 = 2x8 RANKING'), 'R5', () => {});
    expect(screen.queryByText('Best of a place')).toBeNull();
    cleanup();
    const oneRoom = resizeWaterfallRound(draftOf(PLAIN), 'R4', 1, 8);
    render(<WaterfallBestField draft={oneRoom} onSetBest={() => {}} round={roundOf(oneRoom, 'R4')} />);
    expect(screen.queryByText('Best of a place')).toBeNull();
  });

  it('offers None and every place of the room for a 3x8 round, and nothing else until one is picked', () => {
    field(PLAIN, 'R4', () => {});
    expect(optionsOf('Best of a place: place')).toEqual([
      'None',
      '1st',
      '2nd',
      '3rd',
      '4th',
      '5th',
      '6th',
      '7th',
      '8th',
    ]);
    expect(screen.queryByLabelText('Best of a place: how many')).toBeNull();
    expect(screen.queryByLabelText('Best of a place: goes to')).toBeNull();
  });

  it('picking a place writes the best 1 of it to the first later round', () => {
    const onSetBest = vi.fn();
    field(PLAIN, 'R4', onSetBest);
    fireEvent.change(screen.getByLabelText('Best of a place: place'), { target: { value: '6' } });
    expect(onSetBest).toHaveBeenCalledWith({ place: 6, count: 1, destination: 'R5' });
  });

  it('shows the line it has, with how many from 1 to the rooms less one and the later rounds', () => {
    field(WITH_BEST, 'R4', () => {});
    expect(select('Best of a place: place').value).toBe('6');
    expect(optionsOf('Best of a place: how many')).toEqual(['1', '2']);
    expect(select('Best of a place: how many').value).toBe('1');
    expect(optionsOf('Best of a place: goes to')).toEqual(['R5', 'Final']);
    expect(select('Best of a place: goes to').value).toBe('R5');
  });

  it('changing the count or the destination writes the line with it', () => {
    const onSetBest = vi.fn();
    field(WITH_BEST, 'R4', onSetBest);
    fireEvent.change(screen.getByLabelText('Best of a place: how many'), { target: { value: '2' } });
    expect(onSetBest).toHaveBeenLastCalledWith({ place: 6, count: 2, destination: 'R5' });
    fireEvent.change(screen.getByLabelText('Best of a place: goes to'), { target: { value: 'Final' } });
    expect(onSetBest).toHaveBeenLastCalledWith({ place: 6, count: 1, destination: 'Final' });
  });

  it('None takes the line away', () => {
    const onSetBest = vi.fn();
    field(WITH_BEST, 'R4', onSetBest);
    fireEvent.change(screen.getByLabelText('Best of a place: place'), { target: { value: '' } });
    expect(onSetBest).toHaveBeenCalledWith(null);
  });

  it('is shown disabled when the editor is read-only and the round has a line, and absent without one', () => {
    field(WITH_BEST, 'R4');
    expect(select('Best of a place: place').disabled).toBe(true);
    cleanup();
    field(PLAIN, 'R4');
    expect(screen.queryByText('Best of a place')).toBeNull();
  });
});

describe('the Best of a place field in the graph editor', () => {
  function editor(text: string, onChange = vi.fn(), readOnly = false) {
    render(
      <WaterfallGraphEditor
        entrantCount={null}
        firstRoundNumber={4}
        onChange={onChange}
        readOnly={readOnly}
        roomSize={{ min: 1, max: 20, ideal: 8 }}
        text={text}
      />,
    );
    return onChange;
  }

  it('writes the BEST line into the graph text when a place is picked', () => {
    const onChange = editor(PLAIN);
    fireEvent.change(screen.getByLabelText('Best of a place: place'), { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toContain('R4.BEST: 1 OF 6->R5');
  });

  it('marks the place in every room and says what it does', () => {
    editor(WITH_BEST);
    const stars = screen.getAllByTitle('Best 1 of the 6ths → R5; the others follow this slot');
    expect(stars).toHaveLength(3);
    expect(stars[0].textContent).toContain('★');
  });

  it('says in the flow beside the editor that the best of a place goes on top of the ranks', () => {
    editor(WITH_BEST);
    expect(screen.getByText('ranks 1–5 of each room + best 1 of the 6ths', { exact: false })).toBeTruthy();
  });

  it('marks nothing without a line', () => {
    editor(PLAIN);
    expect(screen.queryAllByText('★')).toHaveLength(0);
  });
});
