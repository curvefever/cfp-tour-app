# Platform: auth, sync, persistence, deployment

Read when a task touches login, permissions, Firebase, persistence, or deployment.

## Admin access
Per-user login against real Curve Fever Pro accounts.
- **Login**: `CfpLoginModal` collects email and password; `AuthProvider.login()` calls the CFP API's `/auth/login` (`src/lib/api.ts`).
- **Authorization**: `auth.shared.ts` allowlists roles `TOUR_ADMIN_ROLE_IDS = [ADMIN, MOD, LEAD_MOD, DEVELOPER, TOUR_HOST, LEAD_TOUR_HOST]`; `canAdminTour(roles)` checks them.
- **Session**: access token in a cookie and `localStorage` (30-day max age). Each SSR request re-validates it against the CFP API (`getInitialAuth`, `server/auth.server-fns.ts`, 60 s in-memory cache).
- **Server-side enforcement**: every privileged write calls `requireTourAdminPermission()` (`tour-permissions.server.ts`), which re-derives the role from the session cookie on the server each time.
- **Reads are public**: `database.rules.json` allows `.read` on `tournaments/$id` (and on the archive, below) to anyone. A shareable link is the access boundary for viewers, so a guessed or leaked tournament id can be read without login.
- There's no dev-mode bypass: the local dev server needs a real login too.
- Legacy admin flags (`curveFFA_admin_unlocked`, `curveFFA_admin_proof_hash`) are deleted on hydrate, and `writeTournament()` strips any legacy `adminProof` field.

## Sync and persistence
- **Writes**: the browser calls `writeTournament()` (`tournament-write.server-fns.ts`), which validates the id, calls `requireTourAdminPermission()`, then writes with the Firebase **Admin** SDK. `database.rules.json` denies all direct client writes.
- **Reads**: direct client-side Firebase reads (`firebase-client.ts`, `onValue` for a live subscription, `fetchTournamentOnce` for a one-shot read of another tournament's stored state), no login needed.
- **Shared archive** (`src/features/archive/`): one archive per environment at `environments/{test|prod}/archive` (`getArchiveRootPath`), readable by anyone, written only by Tour Admins. `index/{tournamentId}` holds a small `SharedArchiveSummary` (title, date, player count, rounds played, `hasSettings`) that the Archive tab subscribes to; `entries/{tournamentId}` holds `{ tournamentId, title, dateSaved, snapshot, annotations }` (snapshot and annotations through `marshalForFirebase`), fetched once when an entry is opened. One entry per tournament id: a re-save overwrites title, date and snapshot and keeps the annotations. Writes go through `saveArchiveEntry`, `deleteArchiveEntry` and `setArchiveAnnotations` (`archive-write.server-fns.ts`), each calling `requireTourAdminPermission()`; the server builds the summary and stamps `dateSaved`. `database.rules.json` allows `.read` on `archive/index` and `archive/entries/$id` and denies client writes. Rules are not deployed by CI: the organiser deploys them (Firebase console, Realtime Database → Rules, or `firebase deploy --only database`). A completed Final is archived automatically by an admin's browser (`TournamentProvider`); "Save to Archive" in Admin does it on demand.
- **`SyncCoordinator`** (`live-sync.ts`): writer/viewer modes, debounced push (400 ms), dirty-key tracking so a remote update can't overwrite a field being typed. `marshalForFirebase`/`unmarshalFromFirebase` protect data Firebase would otherwise lose: nulls in arrays, empty arrays and objects (`{__ffaEmptyArray: true}`, `{__ffaEmptyObject: true}`), and sparse arrays returned as objects.
- **Fallback**: if Firebase is unreachable, `getFirebaseSyncTransport()` returns `null`, the UI shows "Live sync unavailable", and the app keeps working from `localStorage` (key `curveFFA_state_v1`).
- The Firebase client config in `firebase-client.ts` is hardcoded and not a secret. Test, production and local dev all use the same Firebase project.
- **Local dev caution**: opening a real tournament id on the local dev server while its browser holds an admin session makes the app try to write it back; it only fails because no Firebase Admin credentials are configured locally.
- `TournamentState.settings` (optional): the Setup form as typed when a tournament was generated, snapshotted by `generateTournament` (`tournament-settings.ts`) — roster fields excluded, absent on tournaments generated before this field existed. Lets a later tournament copy a past one's settings (`CopySettingsPanel.tsx`) without pinning the materialized `gamemodeConfig`/`cfg` numbers to the old headcount.

## Deployment
Hosted on Curve Fever Pro's own infrastructure. `.github/workflows/release-tour.yml` builds a Docker image on every push to `main` or `test` (GHCR tags `latest`/`test-latest`) and deploys it over SSH via Tailscale. The server bundle runs `node .output/server/index.mjs` and needs `FIREBASE_SERVICE_ACCOUNT_JSON` (or Application Default Credentials) plus the CFP API.
- **Production** (`main`): https://tournaments.curvefever.pro/
- **Test** (`test`): https://tournaments-test.curvefever.pro/

Push and login rules: `AGENTS.md`, "Branches and deploys" and "Live checks and login".

**Unconfirmed** (not blocking): how `FIREBASE_SERVICE_ACCOUNT_JSON`/ADC reaches the deploy target, and whether `VITE_API_ENDPOINT` must be set there. Ask the CFP developer who set up the pipeline if a Firebase-write or login problem appears only when deployed.

## Tests
Which checks to run, when and by whom: `AGENTS.md`, "Checks and tests".
- **Vitest** (`pnpm test`): the tournament domain layer (`src/domain/tournament/`) has the deepest coverage, one `*.test.ts` per source file in `src/domain/tournament/__tests__/` plus a shared `test-fixtures.ts`. Elsewhere, unit tests are co-located `*.test.ts` files covering pure or near-pure logic: `src/lib/persistence/`, `src/features/sync/live-sync.ts`, `src/features/auth/auth.shared.ts`, `src/features/sync/tournament-write.shared.ts`, `src/components/ui/`. Domain files import each other widely, so `vitest related` on a domain file usually runs most of the suite.
- **Not covered**: React components, hooks and server functions (`*.server.ts`, `*.server-fns.ts`). `@testing-library/react`/`jsdom` are installed but not configured.
- **Playwright smoke** (`e2e/smoke.spec.ts`, `pnpm run test:e2e`): the signed-out viewer shell, and that the admin login wall exists. Admin actions are tested by hand, with the organiser signed in. It runs against a local `pnpm dev`, or against a deployed site when `PLAYWRIGHT_BASE_URL` is set (then no local server starts). `vite.config.ts`'s `test.exclude` keeps Vitest away from `e2e/**`.
