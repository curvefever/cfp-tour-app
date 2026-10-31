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

  it('lists a Best of N above the limit but does not let it be picked', () => {
    render(<MatchSelect bestOf='' games='1' id='pooling' maxBestOf={3} onChange={() => {}} />);
    const options = screen.getAllByRole<HTMLOptionElement>('option');
    const disabled = options.filter((option) => option.disabled).map((option) => option.textContent);
    expect(disabled).toEqual(['Best of 5 — not with match results', 'Best of 7 — not with match results']);
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

  it('puts an inherit option first when given its label, and selects it for no format of its own', () => {
    render(
      <MatchSelect
        bestOf=''
        games=''
        id='round'
        inheritLabel='Stage format (Best of 3)'
        onChange={() => {}}
      />,
    );
    expect(optionLabels()[0]).toBe('Stage format (Best of 3)');
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('');
  });
});
