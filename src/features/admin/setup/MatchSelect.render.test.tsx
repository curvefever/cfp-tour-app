// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchSelect } from './MatchSelect';

afterEach(cleanup);

const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('MatchSelect', () => {
  it('lists the summed game counts, then Best of 3, 5 and 7', () => {
    render(<MatchSelect bestOf='' games='1' id='semis' onChange={() => {}} />);
    expect(optionLabels()).toEqual([
      'Single game',
      '2 games (sum)',
      '3 games (sum)',
      '4 games (sum)',
      'Best of 3',
      'Best of 5',
      'Best of 7',
    ]);
  });

  it('shows the Best of N when one is set', () => {
    render(<MatchSelect bestOf='3' games='1' id='semis' onChange={() => {}} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('bo3');
  });

  it('shows the games when no Best of N is set, and passes the chosen value on', () => {
    const onChange = vi.fn();
    render(<MatchSelect bestOf='' games='3' id='finals' onChange={onChange} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('3');
    fireEvent.change(select, { target: { value: 'bo5' } });
    expect(onChange).toHaveBeenCalledWith('bo5');
  });
});
