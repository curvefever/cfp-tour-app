import { readFileSync } from 'node:fs';
import { illustrate } from './illustrate';
import type { Cell, MetricKey } from './metrics';
import type { Policy } from './policies';
import type { JobResult } from './run';
import { CUT, type Kind, type Mode } from './simulate';

const HEADER = `

---

# Part 2 — rooms built around the cuts, and what each bracket puts at stake

Numbers only: no recommendation, and no seeding change is built from them (the organiser wants more reflection and talks with the community first).

## Why

Part 1 cut the standings into rooms from the top (#1–4, #5–8, …). That puts room boundaries exactly on the cut lines (8|9, 16|17), so the draw pushes #8 (the expected loser of a strong room) and #9 (the expected winner of a weaker one) to swap whatever their strength. Rooms should straddle the cuts, and the units a cut concerns are all those who can still cross it on points, not only the closest by rank. What a rank is worth also depends on the bracket that follows, so the results are read under three stake profiles.

## The model

- **Policy 6, rooms built around the cuts** draws the **last** counted round only; every earlier round is the engine's current draw, smaller-room spread included. In the last round the spread is set aside ("spread kept until the last round, set aside in it"), because there getting each unit close to where it is expected to end matters more than the 3-team seat spread.
- **Policy 7 = 6 + spread** keeps the smaller-room spread in the last round too, for comparison: the units with the fewest smaller-room seats are fixed to the smaller rooms and each group is then drawn the same way on its own.
- **Rooms are consecutive runs of the standings** (the standings before the last round: points, then the usual tie-break). The policy chooses where the runs start and end, and the order of the room sizes.
- **Swing** S = standardPoints(1, largest room) − standardPoints(largest room, largest room) (3 in 2v2v2v2, 7 in FFA): the most a unit can move on points in one round.
- **Cut lines.** A cut c (between #c and #c+1) sits at the points line L_c = the mean of their points. **A room edge** between standings positions k and k+1 sits at the mean of their points L_k.
- **Edge cost** = Σ over the profile's cuts c of w_c × max(0, S − |L_k − L_c|) / S: an edge on a cut line costs the cut's full weight, an edge a swing or more from every cut costs nothing. An edge that splits units on equal points adds 0.1.
- **Partition.** Every order of the round's room sizes is tried (multiset permutations: 35 for [4,4,4,4,3,3,3], 364 for 53 teams, 35 for FFA [8,8,8,8,7,7,7]); each order cuts the standings into consecutive rooms; the order with the lowest total edge cost is kept.
- **Rematches.** Then the two units either side of each edge are swapped while edge cost + 0.05 × repeat pairings goes down (the edge line after a swap is the mean of the lowest points in the upper room and the highest in the lower one).
- **Stake profiles** give each final rank a value v(rank); a cut's weight is w_c = v(c) − v(c+1).
  - **P1, one hard cut**: v = 1 for the top cut (16 / 24), 0 below.
  - **P2, two bands like tournament 1792339397443**: v = 0.44 for ranks 1–8 (FFA 1–12), 0.06 for 9–16 (FFA 13–24), 0 below; weights 0.38 at 8|9 and 0.06 at 16|17. This profile values only reaching the Final, so qualifying at 16|17 weighs little.
  - **P3, graded like a Kings Valley ladder**: the qualified units start on a ladder of rooms of the format's size; v falls in equal steps per ladder room: ranks 1–4 → 1, 5–8 → 0.75, 9–12 → 0.5, 13–16 → 0.25, 0 below (FFA: 1–8 → 1, 9–16 → 0.67, 17–24 → 0.33, 0 below); cuts at every ladder-room boundary and the top cut, equal weights.

## New metrics (means over the runs; every policy is measured under all three profiles)

- **Mis. P1 / P2 / P3** — stake-weighted misplacement: Σ over units of |v(true rank) − v(final rank)| / 2, the value handed to the wrong units (lower is better).
- **Decided 8|9, 16|17** (FFA 12|13, 24|25) — among the units within one swing S of the cut's points line before the last round, the pairs that end on opposite sides of the cut; the share where the truly stronger unit is above (pooled over the runs).
- **Opp. 8|9, 16|17** — for the units ranked #c and #c+1 before the last round, the mean true strength of their last-round opponents, #c's minus #c+1's (0 = the same opposition; positive = #c faced stronger opponents, the problem part 1's chunking had).
- The earlier ones stay: **Tied for 1st**, **Repeats**, **Seat spread**.

Setups: A (4 rounds, round 1 not counted) and C (4 rounds, all counted); B is left out. Same formats, unit counts (2v2v2v2 at 25/31/37/43/53, FFA at 37/43/53), noise levels, seed rule and 3000 runs per cell as in part 1; the same seeds for every policy. Each row is the mean over the unit counts of the per-count value (the "Decided" shares are pooled over the runs of each count first).

`;

const POLICY_LABEL: Partial<Record<Policy, string>> = {
  current: '1 current',
  'last-by-standings': '3 last round by standings',
  'cuts-P1': '6/P1 around the cuts, spread set aside in the last round',
  'cuts-P2': '6/P2 around the cuts, spread set aside in the last round',
  'cuts-P3': '6/P3 around the cuts, spread set aside in the last round',
  'cuts-spread-P1': '7/P1 = 6 + spread',
  'cuts-spread-P2': '7/P2 = 6 + spread',
  'cuts-spread-P3': '7/P3 = 6 + spread',
  'random-rooms': 'random rooms (baseline)',
};

const POLICY_ORDER = Object.keys(POLICY_LABEL) as Policy[];

const KIND_LABEL: Record<Kind, string> = { '2v2v2v2': '2v2v2v2 Survival Teams', ffa: 'FFA individual' };
const MODE_LABEL: Partial<Record<Mode, string>> = {
  A: '4 qualification rounds, round 1 not counted',
  C: '4 qualification rounds, all counted',
};
const CUT_LABELS: Record<Kind, [string, string]> = {
  '2v2v2v2': ['8|9', '16|17'],
  ffa: ['12|13', '24|25'],
};

function fmt(value: number, digits = 2): string {
  return Number.isNaN(value) ? 'n/a' : value.toFixed(digits);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function share(cell: Cell, key: 'half' | 'full'): number {
  const { correct, pairs } = cell.decided[key];
  return pairs === 0 ? Number.NaN : correct / pairs;
}

function row(policy: Policy, jobs: JobResult[]): string {
  const cells = jobs.map((job) => job.cells[policy]);
  const mean = (key: MetricKey) => average(cells.map((cell) => cell.sums[key] / cell.runs));
  const decided = (key: 'half' | 'full') => average(cells.map((cell) => share(cell, key)));
  return `| ${POLICY_LABEL[policy]} | ${fmt(mean('misP1'))} | ${fmt(mean('misP2'))} | ${fmt(mean('misP3'))} | ${fmt(decided('half'), 3)} | ${fmt(decided('full'), 3)} | ${fmt(mean('oppHalf'), 3)} | ${fmt(mean('oppFull'), 3)} | ${fmt(mean('tiedForFirst'))} | ${fmt(mean('repeatPairings'), 1)} | ${fmt(mean('seatSpread'), 1)} |`;
}

function table(kind: Kind, mode: Mode, noise: number, jobs: JobResult[]): string {
  const selected = jobs.filter(
    (job) => job.config.kind === kind && job.config.mode === mode && job.noise === noise,
  );
  if (selected.length === 0) return '';
  const [half, full] = CUT_LABELS[kind];
  const runs = Math.min(...selected.map((job) => job.runs));
  const counts = selected.map((job) => job.config.count).sort((a, b) => a - b);
  return [
    `### ${KIND_LABEL[kind]}, noise ${noise}, ${MODE_LABEL[mode]}`,
    '',
    `Averaged over ${counts.join(', ')} units; ${runs} runs per cell; top cut ${CUT[kind]}.`,
    '',
    `| Policy | Mis. P1 | Mis. P2 | Mis. P3 | Decided ${half} | Decided ${full} | Opp. ${half} | Opp. ${full} | Tied for 1st | Repeats | Seat spread |`,
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...POLICY_ORDER.map((policy) => row(policy, selected)),
    '',
  ].join('\n');
}

export function writePart2Report(jobs: JobResult[], illustrationPath: string | undefined): string {
  const sections = [HEADER];
  for (const noise of [0.7, 1.2]) {
    for (const kind of ['2v2v2v2', 'ffa'] as const) {
      for (const mode of ['A', 'C'] as const) sections.push(table(kind, mode, noise, jobs));
    }
  }
  if (illustrationPath) sections.push(illustrate(JSON.parse(readFileSync(illustrationPath, 'utf8'))));
  return sections.filter(Boolean).join('\n');
}
