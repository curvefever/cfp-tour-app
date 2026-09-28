# Repository guidance

## Core intent

- Respect the existing architecture and coding standards.
- Prefer readable, explicit solutions over clever shortcuts.
- Prioritize maintainability, clarity, short methods and classes, and clean code.
- Keep it simple (KISS) and avoid unnecessary duplication (DRY).

Dev server: `pnpm dev`. File-structure conventions: `.agents/skills/` (read when adding or moving files).

## Project docs

Each has one job; don't blend them.

- **`HANDOFF.md`**: short current-state index (what the app is, core value, code map, rules summary, which doc covers what). Read it fresh at the start of every real work session; don't trust this conversation's memory, or an earlier write-up, about what's done.
- **`docs/*.md`**: current-state reference, one file per area. Read the ones your task touches, and `docs/open-items.md` when planning, diagnosing or closing out.
- **`HANDOFF_LOG.md`**: dated, append-only build history and the reasoning behind decisions. `grep` it (entry title, function, date); never read it whole.
- **`ROADMAP.md`**: projects raised but not started. An entry moves to the log once built.

`HANDOFF.md` and `docs/` describe the app as it is now: dates, "was replaced", "fixed on" belong in the log. These files are hand-formatted: never run `prettier --write` on `HANDOFF.md`, `HANDOFF_LOG.md` or `docs/*.md`.

## Working economically

Everything read into a session is carried, and paid for, on every later step.

- Don't re-read a file you've already read unless it changed. Read only the part of a large file you need (offset/limit, `grep -n`, `sed -n 'a,bp'`).
- Cap long command output (`head`, `tail`, `grep`). Test runs always go through `2>&1 | grep -aE "Test Files|Tests |FAIL"`.
- In the browser, read pages as text (`get_page_text`, `read_page`, `find`). Screenshot only when the layout is the point, or as final proof of a visual change, at reduced scale.
- Prefer one targeted command over several exploratory ones.

## Plan before coding

Every new feature or significant change starts with a plan (Plan Mode) that the organiser approves before any code is written. Only small, low-risk changes (a one-line fix, a doc edit, a trivial tweak) go in directly. If in doubt, plan.

## Roles

The organiser often splits a feature between a **planner/reviewer** session and an **implementer** session, and says which role a session has. If you're given a role, read its file before anything else: `.agents/roles/planner.md` or `.agents/roles/implementer.md`. With no role stated, the session is **solo**: it plans, builds and checks its own work, and the rest of this file applies unchanged.

## Design forks and scoping

- A genuine fork with real consequences (a pairing convention, how something distributes, what a feature means): ask via `AskUserQuestion` with a few concrete options. Lower-stakes calls: decide, record them in the log entry, leave them open to correction. For anything spatial (bracket shape, room layout, UI mockup), show a visual (Artifact / visualize tool) instead of prose.
- Isolate foundational or cross-cutting changes (a refactor, a shared bug fix) in their own pass, separate from feature work.
- When the same bug pattern recurs in different contexts, fix the root cause instead of patching each instance.
- On a multi-part task, check in after each independent part before starting the next.
- Test with awkward, non-round counts first (31, 37, 43, 53). Room distribution, advancement numbers and lucky losers must come out right at any count with no thought from the organiser (see "Core value" in `HANDOFF.md`).

## Checks and tests

Never run a full build, `pnpm lint` or `pnpm format:check`: check only what changed, and ignore errors in code you didn't touch. `<files>` below means the files changed in the stage (or, for the final review, in the whole plan). Doc-only changes need no checks.

| Check           | Command                                                          | Who, when                                                                                                                                      |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, format    | `pnpm exec eslint <files>`, `pnpm exec prettier --check <files>` | Implementer/solo: every stage. Reviewer: once, final review                                                                                    |
| Types           | `pnpm typecheck 2>&1 \| grep -E "<changed paths>"`               | Same as lint                                                                                                                                   |
| Related tests   | `pnpm exec vitest related --run <changed source and test files>` | Implementer/solo: every stage, before committing. Reviewer: every stage, with its mutation checks                                              |
| Mutation checks | break the change on purpose, rerun the covering test file        | Reviewer: every stage. Solo: skip                                                                                                              |
| Full suite      | `pnpm test`                                                      | Reviewer: once, final review. Solo: once, before reporting done. Implementer: never                                                            |
| Smoke e2e       | `pnpm run test:e2e`                                              | Only when the plan lists it (routing, tab shell, auth wall). Reviewer: final review. Solo: before reporting done                               |
| Live check      | built-in browser, see below                                      | Only when the plan lists it (a solo session decides). Implementer/solo: at that stage. Reviewer: repeats only a point the code leaves in doubt |
| Code review     | `/code-review` low effort, or one review subagent                | Solo, non-trivial builds only: once, at the end. Never in a split session                                                                      |

What the tests cover, and what they don't: `docs/platform.md`, "Tests".

## Live checks and login

Live checks run in the built-in browser against the environment the work needs: the local dev server, test (`https://tournaments-test.curvefever.pro/`) or production (`https://tournaments.curvefever.pro/`). Admin actions need a signed-in CFP account with a Tour Host (or higher) role; there's no dev-mode bypass. Ask for a login only when you reach a live check: first open the Admin tab ("Signed in as <name>" means you have access; the "Sign in with CFP" dialog means you don't), and only then ask the organiser to sign in. Never type credentials. Never load a roster or generate on production without explicit permission.

## Branches and deploys

Pushing deploys automatically (`docs/platform.md`, "Deployment"): `test` goes to the test site, `main` to production. Day-to-day work goes to `test`. Never push to `main` without the organiser's explicit go-ahead for that specific push. Keep pushes fast-forward (rebase onto the branch tip first) and never force-push.

## Closing out a build

- Append a dated `HANDOFF_LOG.md` entry: context and reasoning, independently testable parts, testing performed (including the awkward-count cases), and an explicit "Out of scope" section. Parked items are written down, never just dropped.
- Update the `docs/` file(s) whose current-state description changed, in present tense, and `HANDOFF.md` only if its summary, code map or doc table changes.
- Update `docs/open-items.md` if the build closes or changes a known gap, limitation or open question.
