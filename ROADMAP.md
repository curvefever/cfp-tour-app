# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file is neither current-state (`HANDOFF.md`) nor build history (`HANDOFF_LOG.md`) — it's a forward-looking assessment of projects raised but not yet started, written up so the reasoning behind their scope and ordering survives past the conversation that produced it. Entries here move to `HANDOFF_LOG.md` (with a pointer added to `HANDOFF.md`'s "Immediate next priorities") once actually built, and get struck through/removed from here at that point.

Nothing in this file is scheduled or authorized to start — it's assessment only, recorded 2026-09-17 at the organiser's request. **Reordered 2026-09-20** (also at the organiser's request): items 5–9 below were re-sequenced purely on architecture/dependency grounds — see "Cross-cutting note: the round-graph invariant" for the reasoning — and a few relevant-but-not-yet-listed items from `HANDOFF.md` were folded in (a new item 9, plus an "Other open items" appendix at the end). No item's actual scope changed in this pass, only its position and, for item 9, its promotion from a footnote to a numbered entry.

---

## Recommended build order

1. ~~**Double-elimination bracket layout (WB above LB)**~~ — done (2026-09-17), see "Bracket view: stack WB above LB" in `HANDOFF_LOG.md`. One reservation carried over from the build itself, not yet resolved: independent WB/LB row scrolling was chosen over lockstep scrolling but flagged for a live human check — worth a quick pass in the real app before treating it as settled.
2. ~~**Non-counting qualification rounds ("first N rounds don't count")**~~ — done (2026-09-18), see "Non-counting qualification rounds" in `HANDOFF_LOG.md`. One edge case flagged there, not fixed: the qual-table/Swiss reserve-admission guard still counts *all* rounds played (including non-counting ones) toward its "at most one qualifying round completed" cutoff, so a reserve joining right after a run of non-counting rounds could end up with fewer than two *counted* rounds — worth revisiting only if it bites in practice.
3. ~~**Anonymous accounts, v1 scope**~~ — done (2026-09-18), see "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`. Built narrower than originally scoped here: Final only (not Semis), individual formats only (not team), and excluding grand-final/race rounds — see the entry for why.
4. ~~**Manual overrides, pre-start only**~~ — done (2026-09-19), see "Manual overrides, pre-start only" in `HANDOFF_LOG.md`. Built narrower than the mechanism-only sketch below: seeding-weight override scoped to formats using `tieredSeed`/`tieredBracketSeed` (excludes Swiss/Group Stage/Kings Valley), and for double-elimination-shared-final specifically, further scoped to a WB round's own WB-to-WB continuation only (never its LB-bound drop) — see the entry for why.
5. ~~**Positional-points scoring formula**~~ — done (2026-09-20), see "Positional-points scoring" in `HANDOFF_LOG.md`. Built exactly as scoped below: organiser-configurable table, qualification-standings only (not Semis/Final), summed not averaged.
6. ~~**Pre-published, fixed multi-round draws**~~ — done (2026-09-20), see "Pre-published, fixed multi-round draws" in `HANDOFF_LOG.md`. Built as scoped below: a new per-tournament toggle (adaptive reseeding stays the default), simple fixed rotation from roster order only, no live-result dependency. A real gap found during the build was explicitly deferred, not fixed: a removed/swapped player mid-tournament can leave a stale name in an already-published future round — see the "Other open items" appendix below.
7. ~~**Skip-ahead / early qualification (Option 1: additive)**~~ — done (2026-09-21), **merged with item 8 into one project**, see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`. Kings Valley's own early-exit question was explicitly left out of scope and is still unstarted — see the "Other open items" appendix below.
8. ~~**Multi-tier semifinal "waterfall" / repechage bracket**~~ — done (2026-09-21), merged with item 7 (see above). Built as an organiser-authored, generation-time-only rank-band routing table (a `ROUNDS:`/`ROUTES:` text mini-language), not an auto-derived formula — auto-derivation/format-selection remains a possible later project, see the appendix below.
9. **Mid-tournament manual overrides** (extension of item 4, not yet requested by the organiser) — making item 4's pre-start-only overrides editable during a live tournament.

Items 1–2 and 3–4 are each independent pairs — nothing here blocks anything else in the same tier; all four are done. Items 5–9 were reordered 2026-09-20 (previously: skip-ahead, positional points, pre-published draws, waterfall bracket, with mid-tournament overrides not listed at all) purely on architecture/dependency grounds — see "Cross-cutting note: the round-graph invariant" below for the full reasoning. In short: positional-points scoring (5) and pre-published draws (6) never touch round-routing at all, so they're fully independent of everything else and of each other — both done, and both were flagged 2026-09-20 from the same real organiser spreadsheet (`Sheets tournaments/[OFFICIAL] FFA Tournament _ Sep. 20.xlsx`, "Matches 40p" tab). Skip-ahead (7), the waterfall bracket (8), and mid-tournament overrides (9) were sequenced as three progressively harder stresses of the same round-graph invariant; 7 and 8 turned out to be a single project (partial-population routing *is* the waterfall primitive) and shipped together 2026-09-21, leaving only item 9 — which stays gated on the organiser actually requesting it.

---

## 1. Double-elimination bracket layout (WB above LB) — done, see `HANDOFF_LOG.md`

Built 2026-09-17 — see "Bracket view: stack WB above LB" in `HANDOFF_LOG.md` for the full account (design forks settled with the organiser, implementation, testing, live verification). Kept here only as a pointer, per this file's own convention of moving finished entries out.

---

## 2. Non-counting qualification rounds ("first N rounds don't count") — done, see `HANDOFF_LOG.md`

Built 2026-09-18 — see "Non-counting qualification rounds" in `HANDOFF_LOG.md` for the full account (what already existed, what was built, testing, live verification). Kept here only as a pointer, per this file's own convention of moving finished entries out.

---

## 3. Anonymous accounts, v1 scope — done, see `HANDOFF_LOG.md`

Built 2026-09-18 — see "Anonymous Finals matches, v1" in `HANDOFF_LOG.md` for the full account (design forks settled with the organiser, two implementation-time corrections to the approved plan, testing, live verification). Kept here only as a pointer, per this file's own convention of moving finished entries out.

The hardening pass described below as "explicitly deferred" in the original assessment remains genuinely deferred, not built: making the anonymous-to-real mapping inaccessible to admins even via direct Firebase access still needs a real access-control primitive and a genuinely private storage path, neither of which exist. `database.rules.json` still makes the whole tournament blob (including `finalScores`) publicly readable — v1 shipped as UI-level staged visibility only, exactly as scoped here.

---

## 4. Manual overrides, pre-start only — done, see `HANDOFF_LOG.md`

Built 2026-09-19 — see "Manual overrides, pre-start only" in `HANDOFF_LOG.md` for the full account (scope decisions settled via `AskUserQuestion`, a real mid-build architectural discovery about double-elimination's reseeding that narrowed the seeding-weight override's scope, testing, live verification). Kept here only as a pointer, per this file's own convention of moving finished entries out.

**Explicitly deferred, not forgotten**: making these overrides available and editable *during* a live tournament, not just pre-start. A real, larger project on its own — now item 9 below; see the cross-cutting note for why it's sequenced last among the round-graph-invariant items.

---

## 5. Positional-points scoring formula (alternative to Fair Points) — done, see `HANDOFF_LOG.md`

Built 2026-09-20 — see "Positional-points scoring" in `HANDOFF_LOG.md` for the full account (3 `AskUserQuestion` design forks settled with the organiser, a real ascending-vs-descending correctness risk found and fixed during research before any code was written, 4 checked-in build stages, testing, and why it wasn't live-verified in-browser). Kept here only as a pointer, per this file's own convention of moving finished entries out.

---

## 6. Pre-published, fixed multi-round draws (vs. adaptive reseeding) — done, see `HANDOFF_LOG.md`

Built 2026-09-20 — see "Pre-published, fixed multi-round draws" in `HANDOFF_LOG.md` for the full account (a two-pass research/design effort — an Explore agent then a dedicated Plan agent — 5 `AskUserQuestion` design forks total, the new `fixed-draws.ts` algorithm and its hand-traced verification, 4 checked-in build stages, testing). Kept here only as a pointer, per this file's own convention of moving finished entries out.

**Explicitly deferred, not forgotten**: a removed/swapped player during a fixed-draw tournament can leave a stale name in an already-published future round — the same class of bug Group Stage had before `patchFutureGroupStageRounds` was built. Discussed directly with the organiser and confirmed as an accepted v1 limitation rather than building a second regeneration mechanism in the same pass — see the "Other open items" appendix below and `HANDOFF.md`'s "known gaps".

---

## 7–8. Skip-ahead / early qualification + multi-tier "waterfall" bracket (merged) — done, see `HANDOFF_LOG.md`

Built 2026-09-21 as **one** project, not two — see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md` for the full account (the reverted first attempt at item 7 alone, the reframing that showed skip-ahead's missing primitive *is* the waterfall bracket's, the 3 scope decisions settled with the organiser, 6 checked-in build stages, testing, and live verification). Kept here only as a pointer, per this file's own convention of moving finished entries out.

**Explicitly deferred, not forgotten**: (a) *auto-deriving* such a bracket from field size, or having the app decide whether this format is the best fit for a given field — v1 is fully organiser-authored, noted by the organiser as a possible later project, not precluded by the design; (b) Kings Valley early-exit/skip-ahead — never touched, no shared primitive with the `winnersTo`/`pendingBracketSeeds` machinery; (c) live/reactive skip-ahead (a mid-tournament flag) — deliberately not built, see item 9; (d) the Rankings "transient eliminated" display characteristic and the no-elasticity-for-mid-tournament-withdrawal limitation, both recorded in the build entry.

---

## 9. Mid-tournament manual overrides (extension of item 4)

**What**: making item 4's overrides — pre-start-only total round-count, elimination round-target curve, and elimination seeding-weight overrides — editable *during* a live tournament, not just before it starts. Raised as a natural extension while scoping item 4 itself, deliberately deferred rather than built then (see "Manual overrides, pre-start only" in `HANDOFF_LOG.md`).

**Why it's harder than item 4 itself**: item 4's overrides are only ever read once, at generation time, before any round exists — there's no existing schedule to reconcile against. Applying the same kind of override mid-tournament means changing a round's declared shape (target count, seeding) *after* some later rounds may already have been generated and displayed (e.g. as future-round Bracket projections) — stressing the round-graph invariant described below in both of its forms: a round's declared count no longer automatically equalling what its predecessor(s) actually produced, *and* (if the override reroutes only part of a room) a room's population needing to split across more than one destination.

**Not yet requested**: the organiser has not asked for this — it's recorded here only because it was explicitly flagged as "deferred, not forgotten" during item 4's own build, and it belongs in this specific spot in the ordering because of the dependency it shares with items 7–8, not because it's been prioritized. Pick it up only if raised again. (Updated 2026-09-24: the prerequisite is now met — items 7 and 8 shipped as one waterfall/rank-band project, proving out the partial-population-routing half of the primitive at *generation time*. What remains unproven is the *other* half — a round's declared shape changing after generation — which the waterfall build deliberately avoided by having no live mechanism at all.)

**Risk**: high — needs the second sub-invariant relaxed (a round's shape diverging from what generation produced) on top of the routing primitive that now exists, and (unlike items 7/8) has no organiser-articulated concrete use case yet to design against.

**Dependencies**: items 7–8 — now done (see "Not yet requested" above and the cross-cutting note below).

---

## Cross-cutting note: the round-graph invariant

Three projects on this page — skip-ahead (7), the waterfall bracket (8), and mid-tournament manual overrides (9) — all stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce, and that a room's entire population routes to exactly one destination. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination."

Item 7's own "what's still missing" already identifies the specific primitive item 8 also needs — partial-population routing (some finishers of a room going one place, others going elsewhere) — the two items would likely share a design, not need two incompatible ones. Item 9 needs that same primitive *plus* the harder of the two sub-invariants (a round's declared shape diverging from what generation originally produced), so it's sequenced last, after both halves have been exercised independently.

**Status (2026-09-24)**: items 7 and 8 shipped together as one generation-time, organiser-authored rank-band routing project (see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`) — the partial-population-routing primitive described above now exists, in the form of `TournamentRound.waterfallRoutes` plus `pendingBracketSeeds` accumulation. Only item 9's harder sub-invariant remains untouched. The sequencing paragraph below is kept as the original reasoning.

**Recommended sequencing, purely for this reason** (original reasoning, now historical): build item 7 first — the organiser's own preference is to let its design clarify through implementation (see "Open questions" below), so there's no value in a separate upfront design pass ahead of it. Treat whatever partial-population-routing primitive it produces as the candidate general primitive. Before starting item 8, do a short review to confirm that primitive generalizes to the waterfall bracket's bespoke routing table, rather than reworking it from scratch. Only pick up item 9 afterward, and only if the organiser actually asks for it, since by then both sub-invariants will have real, tested code to build from instead of a from-scratch design.

Not relevant to items 1–6, since all of those were deliberately scoped to avoid touching this invariant (items 1–2 don't touch round wiring at all; item 3 doesn't change round *shape*, only what's scored where; item 4 is pre-start-only; item 5 is a scoring-formula change, not routing; item 6 changes *when* a draw is computed, not the routing invariant itself).

---

## Open questions still to settle before implementation begins

- ~~**Anonymous accounts (#3)**~~ — resolved and built (2026-09-18): gated on the Final actually finishing, confirmed by the organiser. See "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`.
- ~~**Manual overrides (#4)**~~ — resolved and built (2026-09-19): field list settled via `AskUserQuestion` against the organiser's three stated needs (per-round advancement count, per-round seeding method, total round count). See "Manual overrides, pre-start only" in `HANDOFF_LOG.md`.
- ~~**Positional-points scoring (#5)**~~ — resolved and built (2026-09-20): configurable table, qualification-standings only, summed not averaged, all settled via `AskUserQuestion`. See "Positional-points scoring" in `HANDOFF_LOG.md`.
- ~~**Pre-published fixed draws (#6)**~~ — resolved and built (2026-09-20): pure fixed rotation (never a frozen simulation), as a new organiser-facing toggle alongside adaptive reseeding, all settled via `AskUserQuestion`. See "Pre-published, fixed multi-round draws" in `HANDOFF_LOG.md`.
- ~~**Skip-ahead (#7)** and **Waterfall semifinal bracket (#8)**~~ — resolved and built together (2026-09-21) as one organiser-authored, generation-time-only rank-band routing project; scope settled with the organiser after a reverted first attempt. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
- **Mid-tournament manual overrides (#9)**: not yet requested by the organiser at all — the open question is simply whether/when it's ever raised, not how to build it once it is (see the cross-cutting note for the recommended prerequisite sequencing).

---

## Other open items found in `HANDOFF.md`, not yet part of the build order above

Surfaced while reading `HANDOFF.md` for this reordering pass (2026-09-20) — genuine unstarted projects or explicitly-parked design questions, included here per the organiser's request, but with **no dependency relationship** to items 1–9 above, so their position in this list doesn't imply any priority ordering. Move any of these into the numbered build order above once actually scoped/prioritized with the organiser.

- **`last-man-standing` game format** — inherited unimplemented from the legacy app; unlike every other item on this page, its rules/scope were never even defined for the reworked pooling-phase/bracket model, so picking it up starts with settling what the format actually means here, not writing code. See `HANDOFF.md`'s "What is NOT yet built" and "Deliberately parked design questions" #3.
- **Automated test coverage, Stage 2 & 3** — domain-layer and pure-logic coverage (554 tests as of 2026-09-21) is thorough, but server functions (`*.server.ts`/`*.server-fns.ts`) and React components/hooks have none; `@testing-library/react`/`jsdom` are installed but unconfigured. Stage 3 (and any e2e test of an authenticated admin action) is also blocked on an unresolved question: this app's admin login has no dev-mode bypass, so testing a real admin action needs either real CFP test credentials or a local Firebase emulator — neither decided. See `HANDOFF.md`'s "What is NOT yet built" (test-coverage bullet) and "Deliberately parked design questions" #7.
- **`cn()` doesn't deduplicate conflicting Tailwind utility classes** — worked around locally once (`BracketView.tsx`'s `compactScoreClass`, via the `!` important suffix), but the underlying gap (a plain string-join, not a Tailwind-merge) is cross-cutting across all 9 of `cn()`'s call sites; a real fix (e.g. adopting `tailwind-merge`) was explicitly ruled out of scope for that same-session bug fix. Worth a dedicated pass given how much of items 5–9's own UI work (Setup fields, Bracket routing displays) will keep touching `cn()`. See `HANDOFF.md`'s "What is NOT yet built" for the full account.
- **A "presentation mode" for Bracket** — hiding score-entry inputs and the follow/search bar so Bracket could serve as a bigger, simpler shared-screen live view. Never requested, never built; the cheaper/safer alternative to maintaining a second correctness-sensitive room-status renderer. See `HANDOFF.md`'s "Deliberately parked design questions" #1.
- **Fixed-draw tournaments don't patch `fixedRoomAssignments` on removal/swap** — found and explicitly deferred during item 6's build (2026-09-20): the same class of "ghost name lingers in a pre-generated future round" bug Group Stage had before `patchFutureGroupStageRounds` was built, now also possible for a fixed-draw qual-table/Swiss tournament, with no equivalent patch mechanism yet. Reserves are already blocked outright for fixed-draw tournaments (a related, separately-resolved gap from the same build), but removal/swap themselves are neither blocked nor patched. See "Pre-published, fixed multi-round draws" in `HANDOFF_LOG.md` and `HANDOFF.md`'s "known gaps".
- **Kings Valley early-exit / skip-ahead** — the part of the original item 7 that the waterfall/rank-band project (2026-09-21) explicitly did *not* cover: `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional promote/stay/demote/eliminate cycle every round with no early-exit branch, and share no primitive with the `winnersTo`/`pendingBracketSeeds` machinery the waterfall bracket reuses. Never requested by the organiser; would be its own separate project.
- **Auto-derived waterfall brackets / letting the app pick the best format** — v1 of the waterfall/rank-band bracket is fully organiser-authored (a `ROUNDS:`/`ROUTES:` text mini-language, generation-time only). The organiser noted (2026-09-21) that a later project could have the app derive such a structure from the field size itself, or judge whether a waterfall-style format is the best fit for a given field at all. Not designed, not precluded — the mini-language's parsed graph is the natural target representation for any future generator. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
- **Rankings shows a still-alive unit as "eliminated" for one round in a waterfall bracket** — a known, live-verified, deliberately-unfixed display characteristic (its destination round isn't finalized yet, so `computeRankings` reads it as empty; self-corrects one round later, identical in timing to double-elimination's own deferred-LB-target case). Revisit only if the organiser finds it confusing in a real event. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
- **Seeding presentation for the community, and two sketched-only seeding ideas** — a community-facing explainer page for the diversity/balance room-seeding system was built 2026-09-21 (see "Seeding system explainer" in `HANDOFF_LOG.md`); two follow-on ideas surfaced there were discussed but never scoped or requested — a *hard rematch cooldown* (forbid a rematch outright until every other pairing is exhausted, instead of today's soft recency weighting) and a *form-aware balance term* (weigh a player's trend across several rounds, not just this round's finishing tier). A third idea, region/connection grouping, was raised and explicitly ruled out by the organiser ("this will not happen") — don't revive it. Also open, not requested: whether the automatic diversity→balance taper should be retuned, given the finding that it behaves almost identically to pure diversity in common bracket shapes (see the same log entry).
- **Waterfall graph authoring: what is left after the click-to-route editor** — the organiser found the `ROUNDS:`/`ROUTES:` text box too inconvenient (2026-09-24) and chose option 3 of four mockups (private Artifact, https://claude.ai/artifact/T48B8QyG5CD4M62N5Cox9u); the click-to-route table shipped 2026-09-25, see "Waterfall bracket: click-to-route graph editor" in `HANDOFF_LOG.md`. Still open, none requested yet: **reusable saved templates** (the organiser wants to create templates that later tournaments can reuse; the persisted text is already a portable format, so a template is a named text string plus somewhere to store it); the **starter-template wizard** (option 2: pick a shape and a player count, get a graph that adds up; the organiser found the flow a bit messy but wanted to see it, the mockup exists); the **drag-and-drop canvas** (option 4: most intuitive, by far the largest build, explicitly not discarded, to be revisited after seeing what the easier options do); **showing every validation problem at once** (the editor shows the validator's first error only; collecting all of them means changing `validateAndOrderWaterfallGraph`); **rooms of different sizes inside one round** (the text format only allows `N x size`, so an awkward player count needs uniform rooms or a grammar change). **Also pending: a manual test by the organiser** of the waterfall bracket on `tournaments-test.curvefever.pro`: the editor, a real Generate from it, the new empty-graph message, and scoring a multi-game Final, none of which could be exercised in-browser without writing to real tournament data.
