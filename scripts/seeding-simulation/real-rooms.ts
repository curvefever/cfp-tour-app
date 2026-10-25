import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Kind } from './cuts';

/** The anonymised extract of real room scores (`docs/real-scores.md`, "Sources"). */
export interface RealEntry {
  unit: string;
  score: number;
  absent: boolean;
}

export interface RealRoom {
  round: number;
  room: number;
  qualification: boolean;
  entries: RealEntry[];
}

export interface RealSource {
  key: string;
  mode: string;
  kind: Kind;
  rooms: RealRoom[];
}

/** A room as the statistics read it: only the units present, best score first. */
export interface RoomObservation {
  round: number;
  qualification: boolean;
  /** Present units, best score first. */
  units: string[];
  scores: number[];
}

/** Calibration pools: each kind's sources. Teams survival is in the file for reference only. */
export const POOLS: Record<Kind, string[]> = {
  ffa: ['ffa-classic', 'ffa-colosseum', 'ffa-test-1792087808730'],
  '2v2v2v2': ['2v2v2v2-classic', '2v2v2v2-syb'],
};

export function loadSources(): RealSource[] {
  const path = fileURLToPath(new URL('./real-rooms.json', import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as { sources: RealSource[] }).sources;
}

/** The rooms of a source without their absentees; a room left with fewer than two units is dropped. */
export function observations(source: RealSource): RoomObservation[] {
  return source.rooms.flatMap((room) => {
    const present = room.entries.filter((entry) => !entry.absent).sort((a, b) => b.score - a.score);
    if (present.length < 2) return [];
    return [
      {
        round: room.round,
        qualification: room.qualification,
        units: present.map((entry) => entry.unit),
        scores: present.map((entry) => entry.score),
      },
    ];
  });
}

export function poolObservations(sources: RealSource[], keys: string[]): RoomObservation[] {
  return sources.filter((source) => keys.includes(source.key)).flatMap(observations);
}
