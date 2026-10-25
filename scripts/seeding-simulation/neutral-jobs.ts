import type { Level, Margins } from './score-model';
import type { Job } from './study-jobs';
import type { Kind } from './simulate';

/** The jobs of the neutral elimination cut study (`plans/2026-10-25-neutral-elimination-cut.md`): shape E only. */

const COUNTS: Record<Kind, { main: number[]; controls: number[] }> = {
  '2v2v2v2': { main: [17, 25, 31, 37, 43, 53], controls: [16, 24] },
  ffa: { main: [37, 43, 53], controls: [32, 40] },
};
const LEVELS: Level[] = ['ffa-like', 'team-like'];
const MARGINS: Margins[] = ['little', 'nothing'];

export function neutralJobs(): Job[] {
  const jobs: Job[] = [];
  for (const kind of Object.keys(COUNTS) as Kind[]) {
    const entries = [
      ...COUNTS[kind].main.map((count) => ({ count, control: false })),
      ...COUNTS[kind].controls.map((count) => ({ count, control: true })),
    ];
    for (const { count, control } of entries) {
      for (const level of LEVELS) {
        for (const margins of MARGINS) jobs.push({ shape: 'E', kind, count, control, level, margins });
      }
    }
  }
  return jobs;
}
