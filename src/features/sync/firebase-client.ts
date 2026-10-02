import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { get, getDatabase, onValue, ref, type Database, type Unsubscribe } from 'firebase/database';
import {
  parseArchiveEntry,
  parseArchiveIndex,
  type SharedArchiveEntry,
  type SharedArchiveSummary,
} from '../archive/shared-archive';
import { unmarshalFromFirebase, type SyncTransport } from './live-sync';
import { writeTournament } from './tournament-write.server-fns';
import { getArchiveRootPath, getTournamentRootPath } from './firebase-paths';

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

function currentHostname(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.hostname;
}

/** Live, parsed, newest-first subscription to the shared archive index; `null` when Firebase is unavailable. */
export function subscribeArchiveIndex(
  onChange: (entries: SharedArchiveSummary[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return onValue(
    ref(db, `${getArchiveRootPath(currentHostname())}/index`),
    (snapshot) => onChange(parseArchiveIndex(snapshot.val())),
    onError,
  );
}

/** A one-shot public read of one shared archive entry; `null` when Firebase is unavailable or the entry is missing. */
export async function fetchArchiveEntryOnce(tournamentId: string): Promise<SharedArchiveEntry | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const snapshot = await get(ref(db, `${getArchiveRootPath(currentHostname())}/entries/${tournamentId}`));
  return parseArchiveEntry(snapshot.val());
}

export function getFirebaseSyncTransport(): SyncTransport | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return {
    write: async (tournamentId, payload) => {
      await writeTournament({ data: { tournamentId, payload } });
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
