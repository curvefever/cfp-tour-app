// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: null, updateState: () => {} }),
}));

afterEach(cleanup);

/** The 8-team double elimination whose Final is uneven wins: Semi A (column 3) and Semi B (column 4) feed it. */
const GRAPH = `ROUNDS:
R1 = 4x2
U2 = 2x2
L2 = 2x2
Semi A = 2
L3 = 2x2
Semi B = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->U2, 2->L2
R1.B: 1->U2, 2->L2
R1.C: 1->U2, 2->L2
R1.D: 1->U2, 2->L2
U2.A: 1->Semi A, 2->L3
U2.B: 1->Semi A, 2->L3
L2.A: 1->L3
L2.B: 1->L3
Semi A: 1->Final
L3.A: 1->Semi B
L3.B: 1->Semi B
Semi B: 1->Final`;

function editor(text: string, onChange = vi.fn(), readOnly = false, entrantCount = 8) {
  render(
    <WaterfallGraphEditor
      entrantCount={entrantCount}
      firstRoundNumber={1}
      onChange={onChange}
      readOnly={readOnly}
      roomSize={{ min: 1, max: 20, ideal: 2 }}
      text={text}
    />,
  );
  return onChange;
}

const open = (label: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
const matchSelect = () => screen.getByLabelText<HTMLSelectElement>('Match');
const matchOptions = () => Array.from(matchSelect().options).map((option) => option.text);
const winsBox = (from: string) =>
  screen.getByLabelText<HTMLInputElement>(`Wins needed in Final, from ${from}`);

describe('the Match select of a round', () => {
  it('offers Uneven wins on a round of one room of two, and not on a round of several rooms', () => {
    editor(GRAPH);
    open('Semi A');
    expect(matchOptions()).toContain('Uneven wins');
    cleanup();
    editor(GRAPH);
    open('U2');
    expect(matchOptions()).not.toContain('Uneven wins');
  });

  it('shows the Final as Uneven wins, and writes WINS on the ROUNDS line when it is picked', () => {
    editor(GRAPH);
    open('Final');
    expect(matchSelect().value).toBe('wins');
    cleanup();
    const onChange = editor(GRAPH.replace('Final = 2 FINAL WINS', 'Final = 2 FINAL'));
    open('Final');
    fireEvent.change(matchSelect(), { target: { value: 'wins' } });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('Final = 2 FINAL WINS\n');
  });
});

describe('the Wins needed box of a band into a WINS round', () => {
  it('is empty with the default by column as its hint, on the band of each finalist', () => {
    editor(GRAPH);
    open('Semi A');
    expect(winsBox('Semi A').value).toBe('');
    expect(winsBox('Semi A').placeholder).toBe('default: 1');
    cleanup();
    editor(GRAPH);
    open('Semi B');
    expect(winsBox('Semi B').placeholder).toBe('default: 2');
  });

  it('is not shown on a band into a round that does not play WINS', () => {
    editor(GRAPH);
    open('U2');
    expect(screen.queryByLabelText(/Wins needed/)).toBeNull();
  });

  it('writes WINS n on the band when a number is typed, and takes it away when it is cleared', () => {
    const onChange = editor(GRAPH);
    open('Semi A');
    fireEvent.change(winsBox('Semi A'), { target: { value: '3' } });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('Semi A: 1->Final WINS 3');
    cleanup();
    const typed = editor(GRAPH.replace('Semi A: 1->Final', 'Semi A: 1->Final WINS 3'));
    open('Semi A');
    expect(winsBox('Semi A').value).toBe('3');
    fireEvent.change(winsBox('Semi A'), { target: { value: '' } });
    expect(typed.mock.calls.at(-1)?.[0]).toContain('Semi A: 1->Final\n');
    expect(typed.mock.calls.at(-1)?.[0]).not.toContain('WINS 3');
  });

  it('reads only in a read-only editor, saying what the unit needs', () => {
    editor(GRAPH, vi.fn(), true);
    open('Semi A');
    expect(screen.queryByLabelText(/Wins needed/)).toBeNull();
    expect(screen.getByText('Wins needed in Final: 1')).toBeTruthy();
  });

  it('shows the same-column refusal in the editor error line', () => {
    const sameColumn = `ROUNDS:
R1 = 2x2
Semi A = 2
Semi B = 2
Final = 2 FINAL WINS

ROUTES:
R1.A: 1->Semi A, 2->Semi B
R1.B: 1->Semi A, 2->Semi B
Semi A: 1->Final
Semi B: 1->Final`;
    editor(sameColumn, vi.fn(), false, 4);
    expect(
      screen.getByText('Final: both finalists qualify in the same column, so type the wins each one needs.', {
        exact: false,
      }),
    ).toBeTruthy();
  });
});
