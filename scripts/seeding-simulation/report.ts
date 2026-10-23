import { METRICS, type Carry, type MetricKey } from './metrics';
import { POLICIES, type Policy } from './policies';
import { CUT, type Kind, type Mode } from './simulate';
import type { JobResult } from './run';

const POLICY_LABEL: Record<Policy, string> = {
  current: '1 current',
  'neutral-first': '2 neutral first counted round',
  'last-by-standings': '3 last round by standings',
  'neutral-first+last-by-standings': '4 = 2 + 3',
  'standings-every-round': '5 standings every round (reference)',
  'random-rooms': 'random rooms (baseline for the carry-over)',
};

const KIND_LABEL: Record<Kind, string> = { '2v2v2v2': '2v2v2v2 Survival Teams', ffa: 'FFA individual' };

const MODE_LABEL: Record<Mode, string> = {
  A: '4 qualification rounds, round 1 not counted',
  B: '3 qualification rounds, all counted',
};

const HEADER = `# Seeding simulation results

Numbers only: this report makes no recommendation. The planner and the organiser decide what, if anything, to build.

## Model

- Each unit has a hidden strength ~ N(0, 1). In a room a unit performs at strength + noise × N(0, 1); a room's scores are distinct integers in performance order (no ties to resolve). Noise 0.7 and 1.2.
- The real engine draws every round (\`advanceTournamentRound\`, the smaller-room spread of stage 1 included); the tool only swaps in its own draw for the rounds a policy names. Round 1 is the engine's random draw.
- Qualification table, Survival Teams (2v2v2v2) or FFA individual, Standard points. Cut = top 16 (2v2v2v2) / top 24 (FFA); the band boundary is half the cut (8 / 12).
- For a given run number every policy starts from the same strengths and the same round 1 draw; the noise each unit draws then differs once the draws differ, so small differences between rows are chance. The run count is in each table.

## Reproducing

- Run number i of a configuration at a noise level uses the seed FNV-1a(\`<kind>-<units>-<mode>|<noise>|<i>\`) (\`runSeed\`, random.ts), the same for every policy; i = 0 .. runs − 1. Strengths, round 1 and the noise all come from one mulberry32 stream per run, so the same command gives the same numbers.
- Command: \`pnpm exec tsx scripts/seeding-simulation/run.ts --runs <runs> --out <dir> [--shard k/n]\`, then \`--report <dir> <report.md>\`.

## Policies

1. **current**: the engine as built after stage 1.
2. **neutral first counted round**: the first counted round is drawn with every tier equal and rematch avoidance only (a random order, then the fixed draw's way of filling rooms, smaller-room spread included). Later rounds as current. With 3 all-counted rounds the first counted round is round 1, which is already random, so this row equals policy 1.
3. **last round by standings**: the last round is the current standings cut into the round's room sizes, best room first. Earlier rounds as current.
4. **2 + 3 together.**
5. **standings every round**: every counted round after the first is drawn by cutting the standings into rooms (Swiss-like, reference only). The first counted round is the engine's.
- Policies 3 to 5 are prototypes that cut the standings into rooms with no rematch avoidance and no smaller-room split, so their repeat and seat-spread figures show the prototype, not what a full build would give.
- **random rooms** (baseline only): every round after round 1 is a random draw. It supplies the carry-over baseline.

## Metrics (means over the runs)

- **Top-cut hit**: of the true top-cut units (by hidden strength), how many are in the final table's top cut.
- **Top-half hit**: of the true top half-cut units, how many are in the final table's top half-cut.
- **Rank corr.**: Pearson correlation between a unit's final table position and its true strength rank (1 = the table orders everyone exactly by strength).
- **Carry-over** (4-round setup only): for units of middle true strength (middle third), the average final points after finishing 1st in round 1 minus after finishing last, minus the same gap under random rooms.
- **Tied for 1st**: units on the top points total (1 = no tie).
- **Strength~opp.**: correlation, across units, between own strength and the average strength of the opponents met in counted rounds (negative = strong units meet weaker opponents).
- **Repeats**: pairings beyond the first meeting in a tournament, all qualification rounds.
- **Seat spread**: max − min of smaller-room seats over the counted rounds.
`;

function mean(sum: number, runs: number): number {
  return runs === 0 ? Number.NaN : sum / runs;
}

function gap(carry: Carry): number {
  if (carry.firstCount === 0 || carry.lastCount === 0) return Number.NaN;
  return carry.firstSum / carry.firstCount - carry.lastSum / carry.lastCount;
}

function fmt(value: number, digits = 2): string {
  return Number.isNaN(value) ? 'n/a' : value.toFixed(digits);
}

function row(job: JobResult, policy: Policy): string {
  const cell = job.cells[policy];
  const value = (key: MetricKey) => mean(cell.sums[key], cell.runs);
  const carry = job.config.mode === 'A' ? fmt(gap(cell.carry) - gap(job.cells['random-rooms'].carry)) : 'n/a';
  return `| ${job.config.count} | ${POLICY_LABEL[policy]} | ${fmt(value('topCutHit'))} | ${fmt(value('topHalfHit'))} | ${fmt(value('rankCorrelation'), 3)} | ${carry} | ${fmt(value('tiedForFirst'))} | ${fmt(value('strengthVsOpponents'), 3)} | ${fmt(value('repeatPairings'), 1)} | ${fmt(value('seatSpread'), 1)} |`;
}

function table(kind: Kind, mode: Mode, noise: number, jobs: JobResult[]): string {
  const cut = CUT[kind];
  const selected = jobs
    .filter((job) => job.config.kind === kind && job.config.mode === mode && job.noise === noise)
    .sort((a, b) => a.config.count - b.config.count);
  if (selected.length === 0) return '';
  const runs = Math.min(...selected.map((job) => job.runs));
  const lines = selected.flatMap((job) => POLICIES.map((policy) => row(job, policy)));
  return [
    `### ${KIND_LABEL[kind]}, noise ${noise}, ${MODE_LABEL[mode]} (${runs} runs per row)`,
    '',
    `| Units | Policy | Top-${cut} hit | Top-${cut / 2} hit | Rank corr. | Carry-over | Tied for 1st | Strength~opp. | Repeats | Seat spread |`,
    '|---|---|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
  ].join('\n');
}

export function writeReport(jobs: JobResult[]): string {
  const sections: string[] = [HEADER];
  for (const kind of ['2v2v2v2', 'ffa'] as const) {
    for (const noise of [...new Set(jobs.map((job) => job.noise))].sort()) {
      for (const mode of ['A', 'B'] as const) sections.push(table(kind, mode, noise, jobs));
    }
  }
  return sections.filter(Boolean).join('\n');
}
