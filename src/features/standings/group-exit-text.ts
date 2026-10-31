import type { GroupExitClass, GroupExitShape } from '../../domain/tournament/group-exit';
import { ordinal } from '../../lib/ordinal';

/**
 * The wording of a group stage's exit, from its shape (`group-exit.ts`): the Setup help line, the Groups
 * explanation, the schedule preview. Every figure comes from the shape, so the words and the selection can't differ.
 */

/** "groups of 5, 4, 4", or "4 groups of 4" when the groups are all one size. */
export function groupSizesText(groupSizes: readonly number[]): string {
  const sizes = [...groupSizes].sort((first, second) => second - first);
  if (sizes.length > 1 && sizes.every((size) => size === sizes[0]))
    return `${sizes.length} groups of ${sizes[0]}`;
  return sizes.length === 1 ? `a group of ${sizes[0]}` : `groups of ${sizes.join(', ')}`;
}

function sizeClassText(cls: GroupExitClass): string {
  return cls.groups.length === 1 ? `the group of ${cls.sizes[0]}` : `each group of ${cls.sizes[0]}`;
}

/** Units that go through whatever the points: "the top 2 of each group", or per size "the top 3 of the group of 5 and the top 2 of each group of 4". */
export function directPlacesText(shape: GroupExitShape): string {
  const same = shape.classes.every((cls) => cls.direct === shape.classes[0].direct);
  if (same) return `the top ${shape.classes[0].direct} of each group`;
  return shape.classes.map((cls) => `the top ${cls.direct} of ${sizeClassText(cls)}`).join(' and ');
}

/** Spots left for the chance places once every group's direct places are taken. */
export function chanceSpots(shape: GroupExitShape): number {
  if (shape.mode === 'per-group') return 0;
  const direct = shape.classes.reduce((sum, cls) => sum + cls.direct * cls.groups.length, 0);
  return Math.max(0, shape.amount - direct);
}

const PLACE_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

const spotsText = (spots: number) => `${spots} spot${spots === 1 ? '' : 's'}`;

/** "the best 2 third places", "the best third place": the even split's leftover spots. */
function evenSplitChance(shape: GroupExitShape, spots: number): string {
  const number = shape.classes[0].direct + 1;
  const place = `${PLACE_WORDS[number] ?? ordinal(number)} place${spots === 1 ? '' : 's'}`;
  return spots === 1 ? `the best ${place}` : `the best ${spots} ${place}`;
}

/** The exit as a clause that goes after "the units": "the top 2 of each group go through, then the best 2 third places". */
export function groupExitClause(shape: GroupExitShape, verb: string): string {
  const spots = chanceSpots(shape);
  const direct = `${directPlacesText(shape)} ${verb}`;
  if (shape.mode === 'per-group' || spots === 0) return direct;
  if (shape.mode === 'even-split') return `${direct}, then ${evenSplitChance(shape, spots)}`;
  return `${direct}, then ${spotsText(spots)} for the best next in line`;
}

/** Setup's help line: what the current roster would do. */
export function groupExitHelp(
  shape: GroupExitShape,
  groupSizes: readonly number[],
  unitCount: number,
  unitPlural: string,
): string {
  return `${unitCount} ${unitPlural} in ${groupSizesText(groupSizes)}: ${groupExitClause(shape, 'go through')}.`;
}

/** The Groups explanation's cut sentence: "The top 2 of each group go through, and the best 2 third places." */
export function groupExitCutSentence(shape: GroupExitShape, verb: string): string {
  const spots = chanceSpots(shape);
  const direct = directPlacesText(shape);
  if (shape.mode === 'even-split' && spots > 0) {
    return `${capitalise(direct)} ${verb}, and ${evenSplitChance(shape, spots)}.`;
  }
  if (shape.mode === 'fair-cut') {
    const tail = spots > 0 ? `, then the best next in line` : '';
    return `${shape.amount} ${verb}: ${direct}${tail}.`;
  }
  return `${capitalise(direct)} ${verb}.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
