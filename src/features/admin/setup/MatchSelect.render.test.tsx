// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchSelect } from './MatchSelect';

afterEach(cleanup);

const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('MatchSelect', () => {
  it('lists the summed game counts, then Best of 3, 5 and 7 where a Best of N is offered', () => {
    render(<MatchSelect bestOf='' bestOfOffered games='1' id='semis' onChange={() => {}} />);
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

  it('leaves the Best of N out where it is not offered, unless one is already set', () => {
    const { rerender } = render(
      <MatchSelect bestOf='' bestOfOffered={false} games='1' id='semis' onChange={() => {}} />,
    );
    expect(optionLabels()).toHaveLength(4);
    rerender(<MatchSelect bestOf='3' bestOfOffered={false} games='1' id='semis' onChange={() => {}} />);
    expect(optionLabels()).toContain('Best of 3');
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('bo3');
  });

  it('shows the games when no Best of N is set, and passes the chosen value on', () => {
    const onChange = vi.fn();
    render(<MatchSelect bestOf='' bestOfOffered games='3' id='finals' onChange={onChange} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('3');
    fireEvent.change(select, { target: { value: 'bo5' } });
    expect(onChange).toHaveBeenCalledWith('bo5');
  });
});
