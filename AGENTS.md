# Repository guidance

## Core intent

- Respect the existing architecture and coding standards.
- Prefer readable, explicit solutions over clever shortcuts.
- Prioritize maintainability, clarity, short methods and classes, and clean code.
- Keep it simple (KISS).
- Avoid unnecessary duplication (DRY).

## Development services

```sh
pnpm dev
```

## Skills

Repository-specific agent skills are stored under `.agents/skills/`.

## Testing

Automated coverage outside the domain layer is partial and staged — see `HANDOFF.md`'s "Immediate next priorities" for what's covered and what's still open. The pure-function tournament domain layer under `src/domain/tournament/` has the deepest Vitest coverage (`pnpm test`), grouped in `src/domain/tournament/__tests__/` as one `*.test.ts` per source file it covers, plus a shared `test-fixtures.ts` helper. Outside the domain layer, unit tests are co-located `*.test.ts` files next to their source (not a `__tests__` folder — see that same section for why), covering pure/near-pure logic in `src/lib/persistence/` and `src/features/sync/live-sync.ts`, plus `src/features/auth/auth.shared.ts` and `src/features/sync/tournament-write.shared.ts`. There's also a first Playwright e2e smoke test (`playwright.config.ts`, `e2e/smoke.spec.ts`, `pnpm run test:e2e`) covering the anonymous-viewer shell and confirming the admin login wall exists, not any authenticated action (Vitest's own `vite.config.ts` `test.exclude` keeps it from also trying to run `e2e/**` as a unit test file — the two runners' default globs otherwise collide on `*.spec.ts`). Runs against a local `pnpm dev` by default; set `PLAYWRIGHT_BASE_URL` to point it at a real deployed environment instead (verified clean against `tournaments-test.curvefever.pro`) — no local server is started in that case. React components, hooks, and server functions (`*.server.ts`/`*.server-fns.ts`) still have no direct coverage — `@testing-library/react`/`jsdom` are installed but not yet configured.

## Validating changes

After you make any changes don't do a full compile/lint/build check.
Instead only check the parts of the codebase that you have changed.
You can just check typescript errors and lint and formatting errors for specific files.
Ignore any errors that are not related to the changed code.

Useful focused checks:

```sh
pnpm exec eslint path/to/file.ts
pnpm exec prettier --check path/to/file.ts
```

## Working process

Two local docs, two jobs — don't blend them (both are tracked in the repo, versioned alongside the code):

- **`HANDOFF.md`** — current state only: rules, mechanics, what's built, what's not, known issues, immediate priorities. Deliberately small — read it in full at the start of any real work session.
- **`HANDOFF_LOG.md`** — the dated build history. Append-only, one entry per build. Meant to be searched (`grep` a function name, feature, or date), not read start to end.

Implementation plans handed from a planning session to an implementing agent live in `plans/` (`YYYY-MM-DD-slug.md`, gitignored, local only). Each one starts with instructions for the implementer. `HANDOFF_LOG.md` stays the permanent record of what was built, so never cite a `plans/` path in a tracked doc: it won't exist for anyone else. Carry whatever reasoning matters into the log entry itself.

### Before starting work

Read `HANDOFF.md` fresh, every session — don't rely on this conversation's own memory of "what's already done," and don't trust a prior write-up's account without checking. If a specific past decision's reasoning matters, `grep` `HANDOFF_LOG.md` for the section title (the "Immediate next priorities" list in `HANDOFF.md` names every entry) rather than reading the whole log.

Then open the built-in browser at the login page of the environment relevant to the work (`https://tournaments-test.curvefever.pro/` for test, `https://tournaments.curvefever.pro/` for production; the local dev server for local work) and ask the organiser to log in there. The organiser can provide a login to either environment on demand, and it is needed for live testing. Never type credentials yourself, and don't load a roster or generate on production without explicit permission.

### Design forks

When there's a genuine fork with real consequences (a pairing convention, how something should distribute, what a feature actually means) — surface it as a small set of concrete options via `AskUserQuestion` rather than silently picking one. Lower-stakes judgment calls get made directly, stated clearly in the HANDOFF_LOG entry, and left open to correction — not turned into a question every time. For anything spatial (bracket shape, room layout, a UI mockup), prefer an actual visual (Artifact / the visualize tool) over describing it in prose.

### Scoping work

- Isolate foundational/cross-cutting changes (a refactor, a shared bug fix) into their own pass, separate from feature work, even when combining would be faster.
- When the same bug pattern shows up more than once in different contexts, that recurrence is itself the signal to fix the root cause, not patch each instance again.
- On a multi-part task, check in after each independent part before starting the next — don't push a whole approved plan through in one uninterrupted pass.
- Test with awkward, non-round player/team counts first, not just clean ones — see "One important principle" in `HANDOFF.md`.

### Before calling a build done

Verify independently — actually exercise the change (dev server + browser console, not just re-reading the diff) before trusting it works. Per "Validating changes" above, skip full compile/lint/build checks — run the focused `eslint`/`prettier` checks on changed files instead. For anything non-trivial, prefer a fresh check with no memory of writing the code (a subagent, or the `/code-review` skill) over reviewing your own work in the same breath.

### Closing out a build

Every build gets a dated `HANDOFF_LOG.md` entry: context/reasoning, independently-testable parts, testing performed (including the awkward-number cases), and an explicit "out of scope" section for anything real that was deliberately not done. Add a matching one-line pointer to `HANDOFF.md`'s "Immediate next priorities" list, and update "What is NOT yet built" / "Known issues" there if the build closes or changes either. Parked items get written down explicitly, never just dropped.
