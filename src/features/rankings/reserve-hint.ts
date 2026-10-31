import { getGameFormat } from '../../domain/tournament/formats';
import { benchReasonOf, type BenchReason } from '../../domain/tournament/mutations';
import type { TournamentState } from '../../domain/tournament/types';

/** Where a walk-up can't join, as the bench message says it. */
const BENCH_TARGET: Record<BenchReason, string> = {
  'group-stage': 'the group stage',
  'fixed-draw': 'a fixed draw',
  'waterfall-bracket': 'a custom bracket',
};

/** The reserves hint's subject, as a sentence opener: "During the group stage", "In a fixed draw". */
const BENCH_CONTEXT: Record<BenchReason, string> = {
  'group-stage': 'During the group stage',
  'fixed-draw': 'In a fixed draw',
  'waterfall-bracket': 'In a custom bracket',
};

const unitOf = (state: TournamentState) =>
  getGameFormat(state.gameFormat)?.teamSize ? 'a team' : 'a player';

/** What a walk-up kept on the bench is told: it can't join the draw, but ⇄ Swap can bring it in. */
export const benchedMessage = (state: TournamentState, reason: BenchReason): string =>
  `Added to the reserves. It can't join ${BENCH_TARGET[reason]} now, but it can replace ${unitOf(state)} with ⇄ Swap until the first elimination.`;

/** The line under the reserve bench when it holds someone: what ＋ does in this tournament. */
export function reserveAddHint(state: TournamentState): string {
  const reason = benchReasonOf(state);
  if (reason) {
    return `Click ＋ to add a reserve. ${BENCH_CONTEXT[reason]} it waits on the bench and can replace ${unitOf(state)} with ⇄ Swap.`;
  }
  const join = state.started
    ? 'They join from the next round'
    : 'Before Confirm & Start the draw is redone with them in; after, they join from the next round';
  return `Click ＋ to add a reserve. ${join} (during the first bracket round of a tournament without pooling: the least-full room).`;
}
