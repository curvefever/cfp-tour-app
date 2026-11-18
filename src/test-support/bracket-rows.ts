import { fireEvent } from '@testing-library/react';

/** Reads the Bracket page as text, for the tests that pin how every room of a tournament is drawn. */

/** Opens every folded column of the Bracket, so every room of every round is on the page. */
export function unfoldEverything(container: HTMLElement): void {
  for (let pass = 0; pass < 100; pass += 1) {
    const folded = container.querySelector<HTMLElement>('button[aria-label^="Show "]');
    if (!folded) return;
    fireEvent.click(folded);
  }
  throw new Error('the Bracket still has folded columns after 100 unfolds');
}

const TONES: Array<[string, string]> = [
  ['bg-cfp-green', 'green'],
  ['bg-cfp-yellow', 'yellow'],
  ['bg-cfp-orange', 'orange'],
  ['bg-cfp-purple', 'purple'],
  ['bg-cfp-red', 'red'],
  ['bg-cfp-text-dim', 'neutral'],
  ['border-dashed', 'dashed'],
];

/** The colour of a row's result stripe, or `-` for a row with none. */
function toneOf(row: HTMLElement): string {
  for (const stripe of row.querySelectorAll('span[aria-hidden="true"]')) {
    const found = TONES.find(([className]) => stripe.classList.contains(className));
    if (found) return found[1];
  }
  return '-';
}

/** One row of a room card: its place, result stripe and unit, then everything else it says (scores, marks, members). */
function rowLine(row: HTMLElement): string {
  const place = row.querySelector('span.font-bold')?.textContent ?? '';
  const name = row.querySelector('span.font-semibold')?.textContent ?? '';
  const rest = (row.textContent ?? '').replace(place, '').replace(name, '');
  return `${place} | ${toneOf(row)} | ${name} | ${rest}`;
}

/** Every card with rows on the page (a room, or a bye), in page order: its title (none for a bye), then one line per row. */
export function roomRowsOnPage(container: HTMLElement): string[] {
  const cards = new Map<Element, HTMLElement[]>();
  for (const row of container.querySelectorAll<HTMLElement>('div.min-h-8')) {
    const card = row.closest('div.rounded-xs');
    if (!card) throw new Error('a row outside any card');
    cards.set(card, [...(cards.get(card) ?? []), row]);
  }
  return [...cards].map(([card, rows]) =>
    [card.querySelector('h3')?.textContent ?? '(no title)', ...rows.map(rowLine)].join('\n'),
  );
}
