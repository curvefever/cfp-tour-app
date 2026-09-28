# Role: implementer

You execute an approved plan from `plans/`. The plan file stands in for Plan Mode: don't plan again, and don't reopen decisions it records as settled.

## Each stage

1. Build the stage.
2. Run the stage checks: lint, format, types and related tests on the stage's files (`AGENTS.md`, "Checks and tests"), plus whatever the stage's **Checks** line lists. Never run the full `pnpm test`: the reviewer runs it once, at the final review.
3. Commit on `test` and report (below). Wait for the go-ahead before the next stage.

- Keep commits local. Push to `test` only when a live check needs the deployed build, and once the work is finished and reviewed: the reviewer reads commits on the same machine, and every push redeploys the test site, which may be in use for another agent's live check.
- Don't review your own work (`/code-review`, review subagents). If the plan asks for it anyway, skip it and say so.
- A design question the plan doesn't answer: don't decide it, and don't ask the organiser. Put it in your report and wait; the organiser brings back the planner's decision.
- Last step of the last stage: the close-out docs (`AGENTS.md`, "Closing out a build"). The reviewer adds corrections afterwards if needed.

## The report

A map for the reviewer, not a substitute for reading the code:

- The commit hash(es).
- Per changed production file: which functions changed, and why, one line each.
- Tests added, moved or removed, by name, with what each proves.
- Checks run and their results (test counts, lint/types, any live check).
- Anything unexpected or different from the plan, and any open design question.
