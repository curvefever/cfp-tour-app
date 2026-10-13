// One-off cleanup of the tournaments made before the Tournaments hub: everything created on or before
// 2026-10-13 under `environments/{env}/tournaments` and `environments/{env}/archive`, plus the legacy root
// `tournaments` (listed in every run, deleted only by `--env prod --apply`: it predates the environments).
//
//   node scripts/cleanup-2026-10-13.mjs --env test            dry run: lists what would be deleted
//   node scripts/cleanup-2026-10-13.mjs --env prod --apply    deletes it (one environment per run)
//
// Credentials: the FIREBASE_SERVICE_ACCOUNT_JSON environment variable (the service account's JSON), as for the
// app's server. Nothing is deleted without --apply. Dates are UTC; "on or before 2026-10-13" means the id (a
// millisecond timestamp) is earlier than 2026-10-14 00:00 UTC.
import { pathToFileURL } from 'node:url';

export const DATABASE_URL = 'https://curve-tour-app-default-rtdb.europe-west1.firebasedatabase.app';
export const CUTOFF_MS = Date.UTC(2026, 9, 14);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The time an id stands for: tournament ids are millisecond timestamps (13 digits); anything else is unknown. */
export function idTimestamp(id) {
  return /^\d{13}$/.test(id) ? Number(id) : null;
}

/** The time of a stored date: a number of milliseconds, or an ISO text; `null` when there is none. */
export function storedTimestamp(value) {
  if (typeof value === 'number' && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * What to do with one id. `idMs` decides; `storedMs` (the lifecycle's `createdAt`, or an archive entry's
 * `dateSaved`) is a second opinion. The two on different sides of the cutoff, or more than a day apart, are
 * reported; on different sides the id is kept.
 *   delete    - dated by its id, before the cutoff, and not contradicted
 *   keep      - dated by its id, at or after the cutoff
 *   unknown   - no timestamp id: never deleted
 *   conflict  - the id and the stored date are on different sides of the cutoff: kept, for a person to look at
 */
export function classify(id, storedMs) {
  const idMs = idTimestamp(id);
  if (idMs === null) return { verdict: 'unknown', idMs, storedMs, note: '' };
  const idOld = idMs < CUTOFF_MS;
  if (storedMs !== null && storedMs < CUTOFF_MS !== idOld) {
    return {
      verdict: 'conflict',
      idMs,
      storedMs,
      note: 'id and stored date are on different sides of the cutoff',
    };
  }
  const apart = storedMs !== null && Math.abs(storedMs - idMs) > DAY_MS;
  return {
    verdict: idOld ? 'delete' : 'keep',
    idMs,
    storedMs,
    note: apart ? 'id and stored date are more than a day apart' : '',
  };
}

/** Every database path to clear for one deleted id of a root. */
export function pathsToDelete(root, env, id) {
  const base = `environments/${env}`;
  if (root === 'tournaments') {
    return ['tournaments', 'index', 'setups', 'presence', 'media'].map((node) => `${base}/${node}/${id}`);
  }
  if (root === 'archive') return [`${base}/archive/index/${id}`, `${base}/archive/entries/${id}`];
  return [`tournaments/${id}`];
}

export function parseArgs(argv) {
  const args = { env: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--env') args.env = argv[(i += 1)] ?? null;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.env !== 'test' && args.env !== 'prod') throw new Error('Pass --env test or --env prod.');
  return args;
}

function sizeKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function byteSize(value) {
  return value === null || value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
}

async function connect() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set: nothing was read.');
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const credential = cert(JSON.parse(json));
  const app = initializeApp({ credential, databaseURL: DATABASE_URL });
  const db = getDatabase(app);
  // The Admin SDK cannot list the children of a node without reading them, so the ids come from a shallow REST read.
  async function childIds(path) {
    const { access_token: token } = await credential.getAccessToken();
    const response = await fetch(`${DATABASE_URL}/${path}.json?shallow=true&access_token=${token}`);
    if (!response.ok) throw new Error(`Listing ${path} failed: HTTP ${response.status}`);
    const body = await response.json();
    return body && typeof body === 'object' ? Object.keys(body).sort() : [];
  }
  const read = async (path) => (await db.ref(path).get()).val();
  // The open database connection keeps the process alive, so the run closes it when it ends.
  return { childIds, read, update: (updates) => db.ref().update(updates), close: () => app.delete() };
}

/** One root: its ids, each with a verdict, a title, a date and a size. */
export async function inspectRoot(database, root, env) {
  const listPath = {
    tournaments: `environments/${env}/tournaments`,
    archive: `environments/${env}/archive/entries`,
    legacy: 'tournaments',
  }[root];
  const ids = await database.childIds(listPath);
  const rows = [];
  for (const id of ids) {
    const entry = await database.read(`${listPath}/${id}`);
    const record = entry && typeof entry === 'object' ? entry : {};
    const stored = root === 'archive' ? record.dateSaved : record.lifecycle?.createdAt;
    let size = byteSize(entry);
    if (root === 'tournaments') {
      for (const node of ['setups', 'media'])
        size += byteSize(await database.read(`environments/${env}/${node}/${id}`));
    }
    rows.push({
      id,
      title: typeof record.title === 'string' ? record.title : '(no title)',
      size,
      ...classify(id, storedTimestamp(stored)),
    });
  }
  return rows;
}

function dateText(ms) {
  return ms === null ? 'no date' : new Date(ms).toISOString().slice(0, 10);
}

function report(root, listPath, rows, willDelete) {
  const group = (verdict) => rows.filter((row) => row.verdict === verdict);
  const toDelete = group('delete');
  console.log(
    `\n== ${listPath}: ${rows.length} entries, ${toDelete.length} ${willDelete ? 'to delete' : 'would be deleted'}, ${sizeKb(toDelete.reduce((sum, row) => sum + row.size, 0))}`,
  );
  for (const row of toDelete) {
    console.log(
      `  ${row.id}  ${dateText(row.idMs)}  ${sizeKb(row.size).padStart(10)}  ${row.title}${row.note ? `   [${row.note}]` : ''}`,
    );
  }
  for (const [verdict, label] of [
    ['keep', 'kept (made after the cutoff)'],
    ['conflict', 'kept (the id and the stored date disagree)'],
    ['unknown', 'date unknown (not a timestamp id), not deleted'],
  ]) {
    const rowsOf = group(verdict);
    if (!rowsOf.length) continue;
    console.log(`  -- ${label}: ${rowsOf.length}`);
    for (const row of rowsOf) {
      console.log(
        `     ${row.id}  id ${dateText(row.idMs)}, stored ${dateText(row.storedMs)}  ${sizeKb(row.size).padStart(10)}  ${row.title}`,
      );
    }
  }
  return toDelete;
}

async function run({ env, apply }) {
  console.log(
    `Cleanup before ${new Date(CUTOFF_MS).toISOString()} on the ${env} environment of ${DATABASE_URL}`,
  );
  console.log(apply ? 'MODE: --apply, deleting' : 'MODE: dry run, nothing is deleted');
  const database = await connect();
  try {
    await clean(database, { env, apply });
  } finally {
    await database.close();
  }
}

async function clean(database, { env, apply }) {
  const roots = [
    ['tournaments', `environments/${env}/tournaments`],
    ['archive', `environments/${env}/archive`],
    ['legacy', 'tournaments (legacy root)'],
  ];
  const updates = {};
  for (const [root, listPath] of roots) {
    const rows = await inspectRoot(database, root, env);
    // The legacy root is deleted only by the production run.
    const deletes = root !== 'legacy' || env === 'prod';
    const toDelete = report(root, listPath, rows, deletes);
    if (root === 'legacy' && !deletes)
      console.log('  (listed only: the legacy root is deleted by the --env prod run)');
    if (!deletes) continue;
    for (const row of toDelete) for (const path of pathsToDelete(root, env, row.id)) updates[path] = null;
  }
  const count = Object.keys(updates).length;
  console.log(`\n${count} database paths ${apply ? 'cleared' : 'would be cleared'}.`);
  if (!apply || !count) return;
  const paths = Object.keys(updates);
  for (let i = 0; i < paths.length; i += 100) {
    await database.update(Object.fromEntries(paths.slice(i, i + 100).map((path) => [path, null])));
  }
  console.log('Done.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
