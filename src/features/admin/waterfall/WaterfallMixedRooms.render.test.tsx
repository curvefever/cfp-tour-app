// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: null, updateState: () => {} }),
}));

afterEach(cleanup);

/** Rooms of different sizes in one round (`8+8+7`): what the Custom bracket editor shows and edits. */

const graphText = (rounds: string[], routes: string[]) =>
  `ROUNDS:\n${rounds.join('\n')}\n\nROUTES:\n${routes.join('\n')}`;

/** R4 has a room of 8 and a room of 7; R5 has 8 seats and takes the top 4 of each. */
const TWO_ROOMS = graphText(
  ['R4 = 8+7', 'R5 = 8', 'Final = 8 FINAL'],
  ['R4.A: 1-4->R5, 5-8->eliminated', 'R4.B: 1-4->R5, 5-7->eliminated', 'R5: 1-4->Final, 5-8->eliminated'],
);
const THREE_ROOMS = TWO_ROOMS.replace('R4 = 8+7', 'R4 = 8+8+7').replace(
  'R4.B: 1-4->R5, 5-7->eliminated',
  'R4.B: 1-4->R5, 5-8->eliminated\nR4.C: 1-4->R5, 5-7->eliminated',
);
const EQUAL_ROOMS = TWO_ROOMS.replace('R4 = 8+7', 'R4 = 2x8').replace('5-7->eliminated', '5-8->eliminated');

function editor(text: string, onChange = vi.fn()) {
  render(
    <WaterfallGraphEditor
      entrantCount={null}
      firstRoundNumber={4}
      onChange={onChange}
      roomSize={{ min: 1, max: 20, ideal: 8 }}
      text={text}
    />,
  );
  return onChange;
}

const sizeField = () => screen.getByLabelText<HTMLInputElement>('Players per room');
const roomsField = () => screen.getByLabelText<HTMLInputElement>('Rooms');
const lastText = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0] as string;

function type(field: HTMLInputElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe('the round list', () => {
  it('reads "8 + 7" for a round of unequal rooms, and "2 × 8" for equal ones', () => {
    editor(TWO_ROOMS);
    const list = screen.getByRole('button', { name: /^R4/ });
    expect(within(list).getByText('8 + 7')).toBeTruthy();
    cleanup();
    editor(EQUAL_ROOMS);
    expect(within(screen.getByRole('button', { name: /^R4/ })).getByText('2 × 8')).toBeTruthy();
  });
});

describe('the size field of a round', () => {
  it('shows the one size of equal rooms, and one size per room for unequal ones', () => {
    editor(EQUAL_ROOMS);
    expect(sizeField().value).toBe('8');
    cleanup();
    editor(THREE_ROOMS);
    expect(roomsField().value).toBe('3');
    expect(sizeField().value).toBe('8, 8, 7');
  });

  it('writes a list as the rooms of the round, and one number as equal rooms', () => {
    const onChange = editor(TWO_ROOMS);
    type(sizeField(), '8, 6');
    expect(lastText(onChange)).toContain('R4 = 8+6\n');
    type(sizeField(), '7');
    expect(lastText(onChange)).toContain('R4 = 2x7\n');
  });

  it('takes the list with spaces or plus signs, and keeps the routes of the places that remain', () => {
    const onChange = editor(THREE_ROOMS);
    type(sizeField(), '8 + 7 + 7');
    expect(lastText(onChange)).toContain('R4 = 8+7+7\n');
    expect(lastText(onChange)).toContain('R4.B: 1-4->R5');
  });

  it('lets a list that was edited alone set the number of rooms, and the Rooms field follows', () => {
    const onChange = editor(THREE_ROOMS);
    type(sizeField(), '8, 8, 7, 7');
    expect(lastText(onChange)).toContain('R4 = 8+8+7+7\n');
  });

  it('cuts the list from the end, or extends it with its last room, when Rooms was edited alone', () => {
    const onChange = editor(THREE_ROOMS);
    type(roomsField(), '4');
    expect(lastText(onChange)).toContain('R4 = 8+8+7+7\n');
    cleanup();
    const second = editor(THREE_ROOMS);
    type(roomsField(), '2');
    expect(lastText(second)).toContain('R4 = 2x8\n');
  });

  it('takes both fields when they were edited together and agree', () => {
    const onChange = editor(THREE_ROOMS);
    fireEvent.change(roomsField(), { target: { value: '4' } });
    type(sizeField(), '8, 6, 6, 6');
    expect(lastText(onChange)).toContain('R4 = 8+6+6+6\n');
  });

  it('refuses both fields edited together that disagree, says why, and puts the rooms back', () => {
    const onChange = editor(THREE_ROOMS);
    fireEvent.change(roomsField(), { target: { value: '4' } });
    type(sizeField(), '8, 8, 6');
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Give one size for each of the 4 rooms, or a single size for all of them.'),
    ).toBeTruthy();
    expect(roomsField().value).toBe('3');
    expect(sizeField().value).toBe('8, 8, 7');
  });

  it('refuses a size that is not a whole number', () => {
    const onChange = editor(TWO_ROOMS);
    type(sizeField(), '8, x');
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Players per room is one whole number, or one number per room, like 8, 8, 7.'),
    ).toBeTruthy();
  });

  it('does not touch the rooms when the field is left as it was', () => {
    const onChange = editor(THREE_ROOMS);
    fireEvent.blur(sizeField());
    fireEvent.blur(roomsField());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives a new count of rooms the typed single size', () => {
    const onChange = editor(EQUAL_ROOMS);
    type(roomsField(), '3');
    expect(lastText(onChange)).toContain('R4 = 3x8\n');
  });
});

describe('the room cards of a round of unequal rooms', () => {
  it("show each room's own places", () => {
    editor(TWO_ROOMS);
    expect(screen.getByLabelText('Room A, rank 8, eliminated')).toBeTruthy();
    expect(screen.getByLabelText('Room B, rank 7, eliminated')).toBeTruthy();
    expect(screen.queryByLabelText(/^Room B, rank 8/)).toBeNull();
  });

  it('route a place "in every room" for the rooms that have it', () => {
    const onChange = editor(TWO_ROOMS);
    fireEvent.click(screen.getByLabelText('Room A, rank 8, eliminated'));
    expect(screen.getByText('1 slot selected')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Room A, rank 7, eliminated'));
    expect(screen.getByText('3 slots selected')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Send selected ranks to'), { target: { value: 'R5' } });
    const text = lastText(onChange);
    expect(text).toContain('R4.A: 1-4,7-8->R5');
    expect(text).toContain('R4.B: 1-4,7->R5');
  });

  it('select all picks every place of every room, and no more', () => {
    editor(THREE_ROOMS);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('23 slots selected')).toBeTruthy();
  });

  it('a shift-click range reaches only the places each room has', () => {
    editor(TWO_ROOMS);
    fireEvent.click(screen.getByLabelText('Room A, rank 6, eliminated'));
    fireEvent.click(screen.getByLabelText('Room A, rank 8, eliminated'), { shiftKey: true });
    // Rooms A and B: places 6-7 in both, place 8 in room A only.
    expect(screen.getByText('5 slots selected')).toBeTruthy();
  });
});

describe('the Best of a place field over unequal rooms', () => {
  it('offers only the places two rooms have', () => {
    editor(TWO_ROOMS);
    const place = screen.getByLabelText<HTMLSelectElement>('Best of a place: place');
    const options = Array.from(place.options).map((option) => option.text);
    expect(options).toContain('7th');
    expect(options).not.toContain('8th');
  });
});
