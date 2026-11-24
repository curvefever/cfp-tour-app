import type { TournamentState } from '../../domain/tournament/types';
import { schedulePictureModel } from './schedule-picture-model';
import type { PictureCard, SchedulePictureModel } from './schedule-picture-types';

/** What the schedule picture's tests share: the model of a state, a card by name, and the text of a card's blocks. */

export const HEADER = { title: 'Test tournament', formatLine: 'FFA · Qualification table · Layered bracket' };

export function modelOf(state: TournamentState): SchedulePictureModel {
  const model = schedulePictureModel(state, HEADER);
  if (!model) throw new Error('no schedule picture');
  return model;
}

export function cardNamed(model: SchedulePictureModel, name: string): PictureCard {
  const card = model.cards.find((candidate) => candidate.name === name);
  if (!card) throw new Error(`no card named ${name}: ${model.cards.map((entry) => entry.name).join(', ')}`);
  return card;
}

/** The cards of a model by name, with their row: `{ 'Final': 0 }`. */
export function rowsOf(model: SchedulePictureModel): Record<string, number> {
  return Object.fromEntries(model.cards.map((card) => [card.name, card.row]));
}

/** Every line of a card's blocks, in order. */
export function blockLines(card: PictureCard): string[] {
  return card.groups.flatMap((group) => group.blocks.flatMap((block) => block.lines));
}

/** The bracket of the 20 November mockup (prod tournament 1794604973922, numbers changed), as Custom bracket graph text. */
export const MOCKUP_GRAPH = `ROUNDS:
Round 5 Upper = 2x8
Round 5 Middle = 7+6
Round 5 Lower = 8
Semi A = 8
Round 6 Middle = 2x7
Round 6 Lower = 8
Round 7 Upper = 2x6
Round 7 Lower = 8
Round 8 = 7
Semi B = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->Round 5 Upper, 17-29->Round 5 Middle, 30-37->Round 5 Lower
Round 5 Upper.A: 1-4->Semi A, 5-8->Round 6 Middle
Round 5 Upper.B: 1-4->Semi A, 5-8->Round 6 Middle
Round 5 Middle.A: 1-3->Round 6 Middle, 4-7->Round 6 Lower
Round 5 Middle.B: 1-3->Round 6 Middle, 4-6->Round 6 Lower
Round 5 Lower: 1->Round 6 Lower, 2-8->eliminated
Semi A: 1-4->Final, 5-8->Round 7 Upper
Round 6 Middle.A: 1-4->Round 7 Upper, 5-7->Round 7 Lower
Round 6 Middle.B: 1-4->Round 7 Upper, 5-7->Round 7 Lower
Round 6 Lower: 1-2->Round 7 Lower, 3-8->eliminated
Round 7 Upper.A: 1-3->Semi B, 4-6->Round 8
Round 7 Upper.B: 1-3->Semi B, 4-6->Round 8
Round 7 Upper.BEST: 1 OF 4->Semi B
Round 7 Lower: 1-2->Round 8, 3-8->eliminated
Round 8: 1->Semi B, 2-7->eliminated
Semi B: 1-4->Final, 5-8->eliminated
`;
