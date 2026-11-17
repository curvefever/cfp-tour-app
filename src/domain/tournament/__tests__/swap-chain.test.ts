import { describe, expect, it } from 'vitest';
import { swapChain } from '../swap-chain';

const record = new Map([
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
  ['X', 'Y'],
]);
const successorOf = (name: string) => record.get(name);

describe('swapChain', () => {
  it('starts with the name itself and follows the replacements', () => {
    expect([...swapChain(successorOf, 'X', 5)]).toEqual(['X', 'Y']);
  });

  it('is just the name when nothing replaced it', () => {
    expect([...swapChain(successorOf, 'Z', 5)]).toEqual(['Z']);
  });

  it('stops after `maxMoves` replacements, so a looping record ends', () => {
    expect([...swapChain(successorOf, 'A', 4)]).toEqual(['A', 'B', 'C', 'A', 'B']);
    expect([...swapChain(successorOf, 'A', 0)]).toEqual(['A']);
  });
});
