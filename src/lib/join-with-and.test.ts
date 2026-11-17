import { expect, it } from 'vitest';
import { joinWithAnd } from './join-with-and';

it('joins with commas and a last "and", with no comma before it', () => {
  expect(joinWithAnd([])).toBe('');
  expect(joinWithAnd(['4'])).toBe('4');
  expect(joinWithAnd(['5', '4'])).toBe('5 and 4');
  expect(joinWithAnd(['5', '4', '3'])).toBe('5, 4 and 3');
});
