# Curve Fever Pro Tour Hub — Handoff

Current state only, kept short: read it at the start of any real work session. History and the reasoning behind decisions live in `HANDOFF_LOG.md`.

## What this is
A web app for setting up and running Curve Fever Pro tournaments: organisers load a roster, generate rounds, enter scores, resolve ties and manage players or teams live; a shareable link lets everyone else follow the scoreboard, bracket and rankings as they happen. It is a React/TypeScript rebuild of an earlier vanilla-JS app, kept read-only under `legacy/` (`legacy/js/*.js`). The rebuild ported the legacy rules faithfully, so legacy code is a valid reference for "what should this do". Log entries dated before 2026-09-10 describe the legacy app.

## Core value
Handle "uncomfortable" registration counts automatically. Whatever the headcount — 31, 37, 43, 53 — the app works out room distribution, advancement numbers and lucky losers without the organiser having to think about it. Testing for it: `AGENTS.md`, "Design forks and scoping".

## Where to read more
| Read | When the task touches |
|---|---|
| `docs/rules.md` | formats, pooling and bracket phases (incl. Kings Valley, waterfall), Semis/Final, scoring, roster changes |
| `docs/seeding.md` | how units are placed in rooms between rounds; Bracket's future-round projections |
| `docs/views.md` | any tab's UI; the design principles for viewer-facing work |
| `docs/platform.md` | login and permissions, Firebase sync, persistence, deployment, what the tests cover |
| `docs/open-items.md` | planning a feature, diagnosing a bug, closing out a build |
| `docs/roadmap.md` | larger future projects not started yet |
| `HANDOFF_LOG.md` | why something is the way it is — `grep` an entry title, function or date; don't read it whole |

## Code map
- **Stack**: React 19 + TypeScript, TanStack Start (SSR, file-based routing) + Vite, Tailwind CSS v4, Firebase Realtime Database, `pnpm`.
- **Domain** (`src/domain/tournament/`): the rules engine as pure functions over a typed `TournamentState`, with an injectable `TournamentRuntime` (clock, random, ids). One file per concern: `types.ts` (state shape), `formats.ts`, `generation.ts`/`schedule-generation.ts` (building a tournament), `pooling.ts`, `single-elimination.ts`, `double-elimination.ts`, `kings-valley.ts`, `waterfall-bracket.ts` (+ `waterfall-draft.ts`, `waterfall-live-edit.ts`, `waterfall-examples.ts`), `elimination-targets.ts` (parsing/validating the targets list), `live-advancement-edit.ts` (live advancement counts), `lineup-edit.ts` (live line-up corrections), `fixed-draws.ts`, `room-distribution.ts`, `transitions.ts` (advancing a round), `advancement.ts` (cuts, standings, tie-breaks), `scoring.ts`, `seeding.ts`, `finals.ts`, `rankings.ts`, `standings-display.ts` (what every standings display shows), `room-exits.ts` (how each room exits, for display), `bracket.ts` (Bracket view helpers), `roster.ts`, `mutations.ts` (roster changes), `tournament-settings.ts` (snapshotting/copying a tournament's Setup-form settings), `state-defaults.ts`, `runtime.ts`.
- **Features** (`src/features/`): one folder per tab or concern — `admin/` (Setup, running admin, `waterfall/` editor, `copy-settings/`, `live-corrections/` panel), `bracket/`, `rankings/`, `standings/` (the Standings tab), `archive/`, `auth/`, `sync/` (Firebase and the write server function), `shell/` (tab bar), `tournament/` (`TournamentProvider`, the app-wide state context).
- **Shared UI** (`src/components/ui/`): `Badge`, `Button`, `Feedback`, `Form`, `Stats`, `Surface`, `Table`, `Timeline`, and `cn()` for class names (merges conflicting Tailwind classes via `tailwind-merge`).
- **Persistence** (`src/lib/persistence/`): `localStorage` fallback (key `curveFFA_state_v1`) so the app works without Firebase; the Archive is shared and Firebase-backed (`src/features/archive/`); `archive.ts` only reads the old local-only archive for a download.
- **Conventions**: `.agents/skills/project-structure/` and `.agents/skills/unslop/` (thin routes, `*.server-fns.ts` naming).
- **Environments**: test https://tournaments-test.curvefever.pro/ (branch `test`), production https://tournaments.curvefever.pro/ (branch `main`); pushing deploys. Details in `docs/platform.md`.

## Rules summary
Details and edge cases: `docs/rules.md`.
- **Formats**: `ffa-individual` (rooms 6–8), `team-2v2v2v2` (3–4), `team-3v3v3` (2–3), and the head-to-head `team-3v3` and `individual-1v1` (rooms of 2, odd-count strategy default "Bye").
- **Pooling phases**: none (2 warm-up rounds), qualification table, Swiss and Group Stage (head-to-head only).
- **Bracket phases**: single elimination, double elimination (head-to-head race), shared-Final double elimination (multi-unit), Kings Valley (room ladder, not for head-to-head), waterfall (organiser-authored routing).
- **Scoring** (pooling standings): "Points" summed over the counted rounds, higher is better: Standard points (1st = the largest room size, minus one per place; a bye counts as a win, a missed round earns 0) or a Custom points table; the tie-break is the score relative to the room average. Semis/Final sum raw scores over 1–4 games. Team formats pick a team scoring rule: sum of members, Save your Buddy (defender only) or Survival Teams (one score per team).
- **Seeding**: rank tiers with rematch avoidance (`tieredSeed`); see `docs/seeding.md`.
