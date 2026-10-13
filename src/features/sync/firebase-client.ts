import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { get, getDatabase, onValue, ref, type Database, type Unsubscribe } from 'firebase/database';
import { parsePresence, type PresenceMap } from '../presence/presence.shared';
import { parseTournamentIndex } from '../tournaments/tournament-index';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import { unmarshalFromFirebase, type SyncTransport } from './live-sync';
import type { SetupTransport } from './setup-sync';
import { writeSetupPatch, writeTournamentPatch } from './tournament-write.server-fns';
import {
  getIndexRootPath,
  getMediaRootPath,
  getPresenceRootPath,
  getSetupRootPath,
  getTournamentRootPath,
} from './firebase-paths';

declare global {
  interface Window {
    /** Test hook: the tournament list, as the database would hold it, instead of reading the database. */
    __CURVE_TOUR_INDEX__?: Record<string, unknown>;
  }
}

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAzbwk2ZJj2jmtKRFjzDJyPk4ePmF3Q04M',
  authDomain: 'curve-tour-app.firebaseapp.com',
  databaseURL: 'https://curve-tour-app-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'curve-tour-app',
  storageBucket: 'curve-tour-app.firebasestorage.app',
  messagingSenderId: '840551568118',
  appId: '1:840551568118:web:40e3c22de01e2587e8d2d7',
} as const;

let database: Database | null | undefined;

function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
}

export function getFirebaseDatabase(): Database | null {
  if (database !== undefined) return database;
  try {
    database = getDatabase(firebaseApp());
  } catch (error) {
    console.warn('Live sync unavailable — Firebase failed to initialize', error);
    database = null;
  }
  return database;
}

/** A one-shot public read (no subscription, no login) of a tournament's raw state -- `null` when Firebase is unavailable or nothing is stored under that id. */
export async function fetchTournamentOnce(tournamentId: string): Promise<unknown> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const rootPath = getTournamentRootPath(
    typeof window === 'undefined' ? undefined : window.location.hostname,
  );
  const snapshot = await get(ref(db, `${rootPath}/${tournamentId}`));
  const value = snapshot.val();
  return value === null ? null : unmarshalFromFirebase(value);
}

/** A one-shot public read of a tournament's Setup form; `null` when Firebase is unavailable or none is stored under that id. */
export async function fetchSetupOnce(tournamentId: string): Promise<unknown> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const snapshot = await get(ref(db, `${getSetupRootPath(currentHostname())}/${tournamentId}`));
  const value = snapshot.val();
  return value === null ? null : unmarshalFromFirebase(value);
}

/** A one-shot public read of one screenshot (a data URL); `null` when Firebase is unavailable or the image is gone. */
export async function fetchScreenshotOnce(tournamentId: string, imageId: string): Promise<string | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const snapshot = await get(ref(db, `${getMediaRootPath(currentHostname())}/${tournamentId}/${imageId}`));
  const value: unknown = snapshot.val();
  return typeof value === 'string' ? value : null;
}

/** Live subscription to the tournament list of this site (every tournament's summary); `null` when Firebase is unavailable. */
export function subscribeTournamentIndex(
  onChange: (summaries: TournamentSummary[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe | null {
  // End-to-end tests supply the list instead of reading the database.
  if (typeof window !== 'undefined' && window.__CURVE_TOUR_INDEX__) {
    onChange(parseTournamentIndex(window.__CURVE_TOUR_INDEX__));
    return () => {};
  }
  const db = getFirebaseDatabase();
  if (!db) return null;
  return onValue(
    ref(db, getIndexRootPath(currentHostname())),
    (snapshot) => onChange(parseTournamentIndex(unmarshalFromFirebase(snapshot.val()))),
    onError,
  );
}

/** Live subscription to who is in which Setup field of a tournament; `null` when Firebase is unavailable. */
export function subscribePresence(
  tournamentId: string,
  onChange: (presence: PresenceMap) => void,
): Unsubscribe | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return onValue(
    ref(db, `${getPresenceRootPath(currentHostname())}/${tournamentId}`),
    (snapshot) => onChange(parsePresence(snapshot.val())),
    () => onChange({}),
  );
}

/** Live subscription to how far this browser's clock is behind the database's (milliseconds, added to `Date.now()`). */
export function subscribeServerClockOffset(onChange: (offsetMs: number) => void): Unsubscribe | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    const offset: unknown = snapshot.val();
    onChange(typeof offset === 'number' ? offset : 0);
  });
}

function currentHostname(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.hostname;
}

export function getFirebaseSyncTransport(): SyncTransport | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return {
    update: async (tournamentId, patch, summary) => {
      await writeTournamentPatch({ data: { tournamentId, patch, ...(summary ? { summary } : {}) } });
    },
    subscribe(tournamentId, onPayload, onError) {
      const rootPath = getTournamentRootPath(
        typeof window === 'undefined' ? undefined : window.location.hostname,
      );
      return onValue(
        ref(db, `${rootPath}/${tournamentId}`),
        (snapshot) => onPayload(snapshot.val()),
        onError,
      );
    },
  };
}

export function getFirebaseSetupTransport(): SetupTransport | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return {
    update: async (tournamentId, patch, summary) => {
      await writeSetupPatch({ data: { tournamentId, patch, ...(summary ? { summary } : {}) } });
    },
    subscribe(tournamentId, onPayload, onError) {
      return onValue(
        ref(db, `${getSetupRootPath(currentHostname())}/${tournamentId}`),
        (snapshot) => onPayload(snapshot.val()),
        onError,
      );
    },
  };
}
