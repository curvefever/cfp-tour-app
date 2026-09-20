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
6. **Pre-published, fixed multi-round draws** — a different live-operations model from our current adaptive reseeding.
7. **Skip-ahead / early qualification (Option 1: additive)** — genuinely new domain-layer routing, with Kings Valley needing its own separate mechanism on top.
8. **Multi-tier semifinal "waterfall" / repechage bracket** — a new bracket-phase shape, none of our current ones fit.
9. **Mid-tournament manual overrides** (extension of item 4, not yet requested by the organiser) — making item 4's pre-start-only overrides editable during a live tournament.

Items 1–2 and 3–4 are each independent pairs — nothing here blocks anything else in the same tier; all four are done. Items 5–9 were reordered 2026-09-20 (previously: skip-ahead, positional points, pre-published draws, waterfall bracket, with mid-tournament overrides not listed at all) purely on architecture/dependency grounds — see "Cross-cutting note: the round-graph invariant" below for the full reasoning. In short: positional-points scoring (5) and pre-published draws (6) never touch round-routing at all, so they're fully independent of everything else and of each other — safe to build in either order, and worth scoping together with the organiser since both were flagged 2026-09-20 from the same real organiser spreadsheet (`Sheets tournaments/[OFFICIAL] FFA Tournament _ Sep. 20.xlsx`, "Matches 40p" tab). Skip-ahead (7), the waterfall bracket (8), and mid-tournament overrides (9) all stress the same round-graph invariant to progressively greater degrees, so building them in that order lets each one reuse a primitive the previous one already proved out, instead of three separate, possibly-incompatible attempts at the same underlying design problem.

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

## 6. Pre-published, fixed multi-round draws (vs. adaptive reseeding)

**What**: some organisers want the *entire* qualification-phase room schedule (all N rounds) published before a single game is played, rather than each round's rooms being computed only once the previous round's actual results are in. Surfaced 2026-09-20 from the same spreadsheet review: rounds 1–4's room-draw cells were pre-set fixed values, not formulas referencing live standings anywhere — strong evidence the whole 4-round schedule was worked out and published in advance.

**Why it's architecturally different, not just a generation-time parameter**: our qual-table/Swiss reseeding (`tieredSeed`, diversity/rematch-avoidance weighted by live standings) is built on the premise that a round's rooms don't exist until the round before it has actually been scored — that's the entire mechanism the "manual overrides" work (item 4, done) still relies on. Publishing every round's draw upfront is a different live-operations model: players need to know their round-3 room before round 1 is even played, which the current architecture can't produce, since it's inherently sequential.

**What's still unclear**: whether organisers actually want pure fixed rotation (computed once, e.g. via `distributeRooms`, with no adaptiveness at all) or something that *looks* fixed but was itself generated by simulating the adaptive algorithm against an assumed/average outcome — the real spreadsheet's exact draw-generation method wasn't visible from the tab alone (no formula pointed back to how the fixed numbers were originally produced). Needs a real scoping conversation, not just inference from one example.

**Risk**: medium — a real behavioral fork (fixed-upfront vs. adaptive) probably needs to become an organiser-facing choice at generation time, not a wholesale replacement of the existing adaptive path (which has its own real value — better rematch avoidance than a naive fixed draw).

**Dependencies**: none — changes *when* a draw is computed, never the round-routing invariant itself. Fully independent of items 5 and 7–9. See the cross-cutting note for why.

---

## 7. Skip-ahead / early qualification

**What**: let a player/team qualify directly into a later round (Semis/Final, potentially others in future) several rounds early — e.g. a "First In" mode where winning a match sends you straight to Semis, skipping the intervening rounds. Also relevant to Kings Valley, where a room-ladder position could plausibly lock in a Finals spot early.

**Scope decision (organiser, 2026-09-17) — Option 1, additive**: when a player skips ahead, everyone else's schedule is *unaffected* — the room they left still sends its normal quota forward through the normal rounds, and the fast-tracked player is simply an extra body already parked in the destination round. This is explicitly chosen over the alternative (the skip shrinking/reshaping the pipeline for everyone else, which would force recomputing every downstream round's size depending on how many skips have happened by that point) — Option 1 avoids that cascading-recomputation problem entirely for a first version, with the organiser's own expectation that further nuance will surface through implementation and testing rather than being fully specified upfront.

**Why Option 1 is comparatively tractable**: it's mechanically close to the existing DNF/withdrawal handling (`patchFutureGroupStageRounds`, bye-conversion, `mutations.ts`) — a player already leaves the normal pipeline mid-flight there without breaking downstream room shapes; a skip-ahead is nearly the mirror image (leaving *with* a placement already locked in, instead of leaving with none). The routing primitive itself — `winnersTo`/`losersTo` as plain round-index integers, resolved by `predecessorsOf` (`bracket.ts:144-157`) with no adjacency assumption — already supports a round's output feeding a non-adjacent later round; `sharedFinalDoubleEliminationBracketPhase` (`double-elimination.ts:244-308`) already produces exactly this shape in production for WB-losers-to-LB routing (`continue` at line 264 skips creating an LB round when a survivor target is already met, so `losersDestinationByWinnersRound` can point several rounds ahead).

**What's still missing**: partial-population routing (some winners of a room skip, others don't) has no existing support — every predecessor edge today assumes a room's *entire* population routes to one destination. This needs a new per-slot or per-player routing concept. Kings Valley has no hook for early-exit at all — `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional, complete promote/stay/demote/eliminate cycle every round with no early-exit branch; this will need genuinely new logic layered on top, not reuse of the `winnersTo` machinery Kings Valley doesn't use.

**Risk**: medium-high, and explicitly the item most likely to reveal new sub-decisions during implementation — treat the first working version as a vehicle for surfacing those, not a final design.

**Dependencies**: none blocking it — it's the *first* consumer of the round-graph invariant relaxation, not a follower. Sequenced ahead of item 8 specifically because it will produce (as its own "what's still missing" above describes) the partial-population-routing primitive item 8 also needs; building it here first, in Option 1's simpler additive scope, de-risks item 8 rather than the reverse. See the cross-cutting note below.

---

## 8. Multi-tier semifinal "waterfall" / repechage bracket

**What**: a semifinal stage where the cut round's own *middle*-tier finishers — not just the bottom — get routed into a genuine second-chance ladder that reconverges with the direct qualifiers at a later semifinal stage, rather than a simple top-N cut straight to Semis→Final. Surfaced 2026-09-20 from the same spreadsheet: a room dubbed "Semi A" plays its own games, and its own 5th–8th place finishers *don't* get eliminated — they drop down into a second room, "Semi B," joined by survivors of a separate two-round consolation ladder (fed by the *next* tier down from the original qualification cut). Semi A's and Semi B's own top 4 each then form the 8 Finalists.

**Why none of our current bracket phases fit**: it's not single-elimination (there's a real second chance). It's not our double-elimination shape either — double-elimination is a clean, generalizable mirrored winners/losers split with a fixed qualifier count into the Final; this is closer to a bespoke, room-specific routing table (room 5A's 5th–8th go one place, room 5C's 1st–4th go another, meeting in a specific consolation room) hand-tuned for a 40-player, 5-room field. Kings Valley's persistent-ladder promote/stay/demote/eliminate cycle doesn't fit either — there's no room-ladder concept here, just a handful of one-shot cut rounds with asymmetric cross-room routing.

**Sequencing note**: build only after item 7 (skip-ahead) has shipped. Item 7's own "what's still missing" already identifies the specific primitive this item also needs — partial-population routing (some finishers of a room going one place, others going elsewhere) — so the two items would likely share a design, not need two incompatible ones. Do a short review of whatever primitive item 7 actually produces, and confirm/generalize it for this item's bespoke routing-table needs, before designing this item's own routing from scratch.

**Risk**: high, and the hardest of the three round-graph-invariant items on this page to generalize — every one of our existing bracket phases (`single-elimination.ts`, `double-elimination.ts`, `kings-valley.ts`) computes its shape from a small set of parameters (room size, qualifier counts, round count) for *any* field size; this shape's exact routing (which specific finishing-position ranges from which specific rooms feed which specific consolation room) doesn't obviously generalize the same way, and might only be tractable as an organiser-configured routing table rather than an auto-derived formula. Needs real design work, not just implementation, before this is buildable — likely the most involved item on this whole page, including item 7.

**Dependencies**: item 7 (see "Sequencing note" above). See the cross-cutting note below.

---

## 9. Mid-tournament manual overrides (extension of item 4)

**What**: making item 4's overrides — pre-start-only total round-count, elimination round-target curve, and elimination seeding-weight overrides — editable *during* a live tournament, not just before it starts. Raised as a natural extension while scoping item 4 itself, deliberately deferred rather than built then (see "Manual overrides, pre-start only" in `HANDOFF_LOG.md`).

**Why it's harder than item 4 itself**: item 4's overrides are only ever read once, at generation time, before any round exists — there's no existing schedule to reconcile against. Applying the same kind of override mid-tournament means changing a round's declared shape (target count, seeding) *after* some later rounds may already have been generated and displayed (e.g. as future-round Bracket projections) — stressing the round-graph invariant described below in both of its forms: a round's declared count no longer automatically equalling what its predecessor(s) actually produced, *and* (if the override reroutes only part of a room) a room's population needing to split across more than one destination.

**Not yet requested**: the organiser has not asked for this — it's recorded here only because it was explicitly flagged as "deferred, not forgotten" during item 4's own build, and it belongs in this specific spot in the ordering because of the dependency it shares with items 7–8, not because it's been prioritized. Pick it up only if raised again, and only after items 7 and 8 have each independently exercised one half of the underlying primitive — building it first, with neither half proven, would mean designing the hardest case with the least experience.

**Risk**: high — needs both sub-invariants relaxed at once, and (unlike items 7/8) has no organiser-articulated concrete use case yet to design against.

**Dependencies**: items 7 and 8 (see "Not yet requested" above and the cross-cutting note below).

---

## Cross-cutting note: the round-graph invariant

Three projects on this page — skip-ahead (7), the waterfall bracket (8), and mid-tournament manual overrides (9) — all stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce, and that a room's entire population routes to exactly one destination. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination."

Item 7's own "what's still missing" already identifies the specific primitive item 8 also needs — partial-population routing (some finishers of a room going one place, others going elsewhere) — the two items would likely share a design, not need two incompatible ones. Item 9 needs that same primitive *plus* the harder of the two sub-invariants (a round's declared shape diverging from what generation originally produced), so it's sequenced last, after both halves have been exercised independently.

**Recommended sequencing, purely for this reason**: build item 7 first — the organiser's own preference is to let its design clarify through implementation (see "Open questions" below), so there's no value in a separate upfront design pass ahead of it. Treat whatever partial-population-routing primitive it produces as the candidate general primitive. Before starting item 8, do a short review to confirm that primitive generalizes to the waterfall bracket's bespoke routing table, rather than reworking it from scratch. Only pick up item 9 afterward, and only if the organiser actually asks for it, since by then both sub-invariants will have real, tested code to build from instead of a from-scratch design.

Not relevant to items 1–6, since all of those were deliberately scoped to avoid touching this invariant (items 1–2 don't touch round wiring at all; item 3 doesn't change round *shape*, only what's scored where; item 4 is pre-start-only; item 5 is a scoring-formula change, not routing; item 6 changes *when* a draw is computed, not the routing invariant itself).

---

## Open questions still to settle before implementation begins

- ~~**Anonymous accounts (#3)**~~ — resolved and built (2026-09-18): gated on the Final actually finishing, confirmed by the organiser. See "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`.
- ~~**Manual overrides (#4)**~~ — resolved and built (2026-09-19): field list settled via `AskUserQuestion` against the organiser's three stated needs (per-round advancement count, per-round seeding method, total round count). See "Manual overrides, pre-start only" in `HANDOFF_LOG.md`.
- ~~**Positional-points scoring (#5)**~~ — resolved and built (2026-09-20): configurable table, qualification-standings only, summed not averaged, all settled via `AskUserQuestion`. See "Positional-points scoring" in `HANDOFF_LOG.md`.
- **Pre-published fixed draws (#6)**: whether organisers want pure fixed rotation or something that only *looks* fixed — and how it should coexist with the existing adaptive reseeding as an organiser-facing choice, not a replacement.
- **Skip-ahead (#7)**: per the organiser's own call, expected to clarify through implementation rather than being fully specified here.
- **Waterfall semifinal bracket (#8)**: needs real design work (see the cross-cutting note) before it's even scoped as buildable.
- **Mid-tournament manual overrides (#9)**: not yet requested by the organiser at all — the open question is simply whether/when it's ever raised, not how to build it once it is (see the cross-cutting note for the recommended prerequisite sequencing).

---

## Other open items found in `HANDOFF.md`, not yet part of the build order above

Surfaced while reading `HANDOFF.md` for this reordering pass (2026-09-20) — genuine unstarted projects or explicitly-parked design questions, included here per the organiser's request, but with **no dependency relationship** to items 1–9 above, so their position in this list doesn't imply any priority ordering. Move any of these into the numbered build order above once actually scoped/prioritized with the organiser.

- **`last-man-standing` game format** — inherited unimplemented from the legacy app; unlike every other item on this page, its rules/scope were never even defined for the reworked pooling-phase/bracket model, so picking it up starts with settling what the format actually means here, not writing code. See `HANDOFF.md`'s "What is NOT yet built" and "Deliberately parked design questions" #3.
- **Automated test coverage, Stage 2 & 3** — domain-layer and pure-logic coverage (475 tests) is thorough, but server functions (`*.server.ts`/`*.server-fns.ts`) and React components/hooks have none; `@testing-library/react`/`jsdom` are installed but unconfigured. Stage 3 (and any e2e test of an authenticated admin action) is also blocked on an unresolved question: this app's admin login has no dev-mode bypass, so testing a real admin action needs either real CFP test credentials or a local Firebase emulator — neither decided. See `HANDOFF.md`'s "What is NOT yet built" (test-coverage bullet) and "Deliberately parked design questions" #7.
- **`cn()` doesn't deduplicate conflicting Tailwind utility classes** — worked around locally once (`BracketView.tsx`'s `compactScoreClass`, via the `!` important suffix), but the underlying gap (a plain string-join, not a Tailwind-merge) is cross-cutting across all 9 of `cn()`'s call sites; a real fix (e.g. adopting `tailwind-merge`) was explicitly ruled out of scope for that same-session bug fix. Worth a dedicated pass given how much of items 5–9's own UI work (Setup fields, Bracket routing displays) will keep touching `cn()`. See `HANDOFF.md`'s "What is NOT yet built" for the full account.
- **A "presentation mode" for Bracket** — hiding score-entry inputs and the follow/search bar so Bracket could serve as a bigger, simpler shared-screen live view. Never requested, never built; the cheaper/safer alternative to maintaining a second correctness-sensitive room-status renderer. See `HANDOFF.md`'s "Deliberately parked design questions" #1.
- **Bracket round-column collapse doesn't visually shrink the column** — a small, isolated, already-diagnosed CSS bug (`RoundColumn`'s width classes are appended rather than made mutually exclusive), unrelated to anything above; flagged here only so it isn't lost, not because it needs sequencing against the rest of this page. See `HANDOFF.md`'s "What is NOT yet built" for the exact fix needed.
