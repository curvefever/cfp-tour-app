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

The tournament domain layer (`src/domain/tournament/`) has the deepest Vitest coverage (`pnpm test`): one `*.test.ts` per source file in `src/domain/tournament/__tests__/`, plus a shared `test-fixtures.ts`. Outside the domain layer, unit tests are co-located `*.test.ts` files next to their source, covering pure or near-pure logic (`src/lib/persistence/`, `src/features/sync/live-sync.ts`, `src/features/auth/auth.shared.ts`, `src/features/sync/tournament-write.shared.ts`). React components, hooks and server functions (`*.server.ts`/`*.server-fns.ts`) have no direct tests: `@testing-library/react`/`jsdom` are installed but not configured.

A Playwright smoke test (`e2e/smoke.spec.ts`, `pnpm run test:e2e`) covers the signed-out viewer shell and checks that the admin login wall exists; admin actions are tested by hand (the organiser signs in for live checks). It runs against a local `pnpm dev`, or against a deployed site when `PLAYWRIGHT_BASE_URL` is set (then no local server starts). `vite.config.ts`'s `test.exclude` keeps Vitest from picking up `e2e/**`.

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

The same goes for tests: run the test files that cover what you changed, and run the full `pnpm test` once, just before reporting the build done.

```sh
pnpm exec vitest run path/to/file.test.ts
```

Don't run `prettier --write` on `HANDOFF.md`, `HANDOFF_LOG.md` or `docs/*.md`: they're hand-formatted, and it rewrites the whole file.

## Working process

The project docs, all tracked in the repo — each has one job, don't blend them:

- **`HANDOFF.md`** — a short index of current state: what the app is, the core value, a code map, a rules summary, and which doc to read for what. Read it at the start of any real work session.
- **`docs/*.md`** — current-state reference, one file per area (`rules`, `seeding`, `views`, `platform`, `open-items`). Read the ones your task touches (the table in `HANDOFF.md` says which).
- **`HANDOFF_LOG.md`** — the dated build history and the reasoning behind decisions. Append-only, one entry per build. Search it (`grep` an entry title, function or date); don't read it whole.
- **`ROADMAP.md`** — assessments of projects raised but not started yet: scope, feasibility, ordering, open questions. An entry moves to `HANDOFF_LOG.md` once it's built.

`HANDOFF.md` and `docs/` describe the app as it is now. Dates, "as of", "was replaced", "fixed on" and similar history belong in the log, not there.

### Plan before coding

Every new feature or significant addition or change starts with a plan (Plan Mode), which the organiser reviews and approves before any code is written. Only small, low-risk changes (a one-line fix, a doc edit, a trivial tweak) can be made directly. If in doubt whether something counts as small, treat it as not small and plan first.

### Planner and implementer sessions

The organiser often splits a feature between two separate agent sessions and says which role a session has. If no role is stated, the session does both jobs and the rest of this file applies unchanged.

- **Planner/reviewer**: discusses the feature with the organiser, settles design forks, and writes the plan. Once the implementer reports back, it reviews the work against the plan, this file and the relevant docs. It doesn't write feature code.
- **Implementer**: executes an approved plan. It doesn't re-plan, and doesn't reopen decisions the plan records as settled.

The organiser relays plans, reports, questions and review comments between the sessions, or asks one session to message the other directly.

Plans live in `plans/` (`YYYY-MM-DD-slug.md`, gitignored, local only) and start with instructions for the implementer. An approved plan file satisfies "Plan before coding", so the implementer doesn't enter Plan Mode again. `HANDOFF_LOG.md` stays the permanent record of what was built, so never cite a `plans/` path in a tracked doc: it won't exist for anyone else. Carry whatever reasoning matters into the log entry itself.

**As the planner/reviewer:**

- Write plans the implementer can execute cold: file paths, invariants, awkward-count test cases, stopping points, and an out-of-scope list.
- Don't ask the implementer to review its own work (`/code-review`, review subagents). The review is yours.
- Review economically without lowering the bar (see "Reviewing a stage" below).
- Report review findings concretely: file, line, and a failing scenario, such as a mutation that survives the tests.
- If your review changes anything, add the corrections to the implementer's `HANDOFF_LOG.md` entry, and to `HANDOFF.md` or `docs/` if needed.

**As the implementer:**

- Stop at each stopping point in the plan. Commit your work on `test`, then report (see "The implementer's report" below). Wait for the go-ahead before continuing.
- Push to `test` only when a live check needs the deployed build, and once the work is finished and reviewed (see "Branches and deploys"). Otherwise keep commits local: the reviewer reads them on the same machine, and every push redeploys the test site, which may be in use for another agent's live check.
- Don't review your own work with `/code-review` or review subagents; the planner/reviewer is the independent check. If a plan asks for a self-review anyway, skip it and say so in your report.
- If you reach a design question the plan doesn't answer, don't decide it and don't ask the organiser for the answer. Put it in your report and wait: the organiser takes it to the planner and comes back with the decision.
- Write the close-out docs as your last step (see "Closing out a build"). The reviewer adds corrections after its review if needed.

#### The implementer's report

A map for the reviewer, not a substitute for reading the code:

- The commit hash(es).
- Per changed production file: which functions changed, and why, in one line each.
- Tests added, moved or removed, by name, with what each proves.
- Checks run and their results (focused checks, test counts, mutation checks tried).
- Anything unexpected or different from the plan, and any open design question.

#### Reviewing a stage

The review stays independent: the report says where to look, the code says whether it's right.

- Read every changed production hunk. Use `git show <commit> -- <file>` or `git diff -W` (whole changed functions) rather than printing whole files, and open more of a file only where a change depends on code outside the hunk (callers, shared helpers, invariants the plan names).
- For tests, check the names and assertions of the cases the plan requires; read a test body in full only when its assertion could pass without the behaviour being present.
- Run the tests yourself and keep the output to counts and failures (e.g. `| grep -E "Tests |FAIL"`).
- Keep mutation checks: break the change on purpose and confirm a test fails. They're cheap and they catch what reading misses.
- Check the report's claims you rely on; don't restate the diff back.

### Before starting work

Read `HANDOFF.md` fresh, every session — don't rely on this conversation's own memory of "what's already done," and don't trust a prior write-up's account without checking. Then read the `docs/` files your task touches, and `docs/open-items.md` when planning, diagnosing or closing out. If a past decision's reasoning matters, `grep` `HANDOFF_LOG.md` for it rather than reading the whole log.

### Working economically

Everything read into a session is carried, and paid for, on every later step. Keep it proportionate:

- Don't re-read a file you've already read in this session unless it changed.
- Read only the part of a large file you need (an offset/limit, `grep -n`, `sed -n 'a,bp'`), and cap long command output (`head`, `tail`, `grep`).
- In the browser, read pages as text (`get_page_text`, `read_page`, `find`). Take a screenshot only when the layout itself is the point, or as the final proof of a visual change, at reduced scale where it's enough.
- Prefer one targeted command over several exploratory ones.

### Design forks

When there's a genuine fork with real consequences (a pairing convention, how something should distribute, what a feature actually means) — surface it as a small set of concrete options via `AskUserQuestion` rather than silently picking one. Lower-stakes judgment calls get made directly, stated clearly in the HANDOFF_LOG entry, and left open to correction — not turned into a question every time. For anything spatial (bracket shape, room layout, a UI mockup), prefer an actual visual (Artifact / the visualize tool) over describing it in prose.

An implementer in a split session doesn't ask: it puts the question in its report (see "Planner and implementer sessions").

### Scoping work

- Isolate foundational/cross-cutting changes (a refactor, a shared bug fix) into their own pass, separate from feature work, even when combining would be faster.
- When the same bug pattern shows up more than once in different contexts, that recurrence is itself the signal to fix the root cause, not patch each instance again.
- On a multi-part task, check in after each independent part before starting the next — don't push a whole approved plan through in one uninterrupted pass.
- Test with awkward, non-round player/team counts first (31, 37, 43, 53), not just clean ones. Room distribution, advancement numbers and lucky losers must come out right at any count, with no thought from the organiser (see "Core value" in `HANDOFF.md`).

### Live checks and login

Live checks run in the built-in browser against the environment the work needs: the local dev server for local work, `https://tournaments-test.curvefever.pro/` for test, `https://tournaments.curvefever.pro/` for production. Admin actions need a signed-in CFP account with a Tour Host (or higher) role. There's no dev-mode bypass: the local dev server needs a real login too.

Ask for a login only when you reach a live check, not at the start of a session. Check first whether the browser is already signed in there, since the organiser sometimes logs in ahead of time: open the Admin tab. "Signed in as <name>" means you have admin access; the "Sign in with CFP" dialog means you don't. Only then open the login and ask the organiser to sign in. Never type credentials yourself, and don't load a roster or generate on production without explicit permission.

### Branches and deploys

Pushing deploys automatically (see "Deployment" in `docs/platform.md`): `test` goes to the test site, `main` to production. Day-to-day work goes to `test`, never straight to `main` (an implementer in a split session pushes only at the points listed in "Planner and implementer sessions"). Never push to `main` without the organiser's explicit go-ahead for that specific push. Keep pushes fast-forward: rebase local work onto the branch tip first, and never force-push.

### Before calling a build done

Verify independently — actually exercise the change (dev server + browser console, not just re-reading the diff) before trusting it works. Per "Validating changes" above, skip full compile/lint/build checks — run the focused `eslint`/`prettier` checks on changed files instead. For anything non-trivial, get a check from someone with no memory of writing the code. When a planner/reviewer session reviews the work, that review is the check: don't run your own. Otherwise, use one review subagent or the `/code-review` skill at low effort, unless the organiser asks for more.

### Closing out a build

Every build gets a dated `HANDOFF_LOG.md` entry: context/reasoning, independently-testable parts, testing performed (including the awkward-number cases), and an explicit "out of scope" section for anything real that was deliberately not done. Update the `docs/` file(s) whose current-state description the build changes, in present tense and without dates, and `HANDOFF.md` only if its summary, code map or doc table changes. Update `docs/open-items.md` if the build closes or changes any known gap, limitation or open question. Parked items get written down explicitly, never just dropped.
