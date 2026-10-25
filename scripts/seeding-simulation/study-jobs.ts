import type { EResult } from './run-e';
import type { QResult } from './run-q';
import type { Level, Margins } from './score-model';
import type { Kind } from './simulate';

/** The jobs of the room-size fairness study: a shape, a scenario, a predictability level and a margin level. */

export type Shape = 'E' | 'Q';

export interface Job {
  shape: Shape;
  kind: Kind;
  count: number;
  /** An equal-room scenario: no smaller rooms exist, only the top-k kept is read. */
  control: boolean;
  level: Level;
  margins: Margins;
}

const E_COUNTS: Record<Kind, { main: number[]; controls: number[] }> = {
  '2v2v2v2': { main: [17, 31, 37, 53], controls: [16, 24] },
  ffa: { main: [37, 43], controls: [32, 40] },
};
const Q_COUNTS: Record<Kind, { main: number[]; controls: number[] }> = {
  '2v2v2v2': { main: [25, 31, 37, 53], controls: [24, 32] },
  ffa: { main: [37, 43], controls: [32, 40] },
};
const LEVELS: Level[] = ['ffa-like', 'team-like'];
const MARGINS: Margins[] = ['little', 'nothing'];

export function jobKey(job: Job): string {
  return `${job.shape}-${job.kind}-${job.count}-${job.level}-${job.margins}`;
}

export function allJobs(): Job[] {
  const jobs: Job[] = [];
  for (const shape of ['E', 'Q'] as Shape[]) {
    const counts = shape === 'E' ? E_COUNTS : Q_COUNTS;
    for (const kind of Object.keys(counts) as Kind[]) {
      const entries = [
        ...counts[kind].main.map((count) => ({ count, control: false })),
        ...counts[kind].controls.map((count) => ({ count, control: true })),
      ];
      for (const { count, control } of entries) {
        for (const level of LEVELS) {
          for (const margins of MARGINS) jobs.push({ shape, kind, count, control, level, margins });
        }
      }
    }
  }
  return jobs;
}

export interface JobResult {
  job: Job;
  result: EResult | QResult;
}
