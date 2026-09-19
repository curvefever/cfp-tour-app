# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file is neither current-state (`HANDOFF.md`) nor build history (`HANDOFF_LOG.md`) — it's a forward-looking assessment of projects raised but not yet started, written up so the reasoning behind their scope and ordering survives past the conversation that produced it. Entries here move to `HANDOFF_LOG.md` (with a pointer added to `HANDOFF.md`'s "Immediate next priorities") once actually built, and get struck through/removed from here at that point.

Nothing in this file is scheduled or authorized to start — it's assessment only, recorded 2026-09-17 at the organiser's request.

---

## Recommended build order

1. ~~**Double-elimination bracket layout (WB above LB)**~~ — done (2026-09-17), see "Bracket view: stack WB above LB" in `HANDOFF_LOG.md`. One reservation carried over from the build itself, not yet resolved: independent WB/LB row scrolling was chosen over lockstep scrolling but flagged for a live human check — worth a quick pass in the real app before treating it as settled.
2. ~~**Non-counting qualification rounds ("first N rounds don't count")**~~ — done (2026-09-18), see "Non-counting qualification rounds" in `HANDOFF_LOG.md`. One edge case flagged there, not fixed: the qual-table/Swiss reserve-admission guard still counts *all* rounds played (including non-counting ones) toward its "at most one qualifying round completed" cutoff, so a reserve joining right after a run of non-counting rounds could end up with fewer than two *counted* rounds — worth revisiting only if it bites in practice.
3. ~~**Anonymous accounts, v1 scope**~~ — done (2026-09-18), see "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`. Built narrower than originally scoped here: Final only (not Semis), individual formats only (not team), and excluding grand-final/race rounds — see the entry for why.
4. ~~**Manual overrides, pre-start only**~~ — done (2026-09-19), see "Manual overrides, pre-start only" in `HANDOFF_LOG.md`. Built narrower than the mechanism-only sketch below: seeding-weight override scoped to formats using `tieredSeed`/`tieredBracketSeed` (excludes Swiss/Group Stage/Kings Valley), and for double-elimination-shared-final specifically, further scoped to a WB round's own WB-to-WB continuation only (never its LB-bound drop) — see the entry for why.
5. **Skip-ahead / early qualification (Option 1: additive)** — genuinely new domain-layer routing, with Kings Valley needing its own separate mechanism on top.
6. **Positional-points scoring formula** — an alternative to Fair Points, needed by some real tournaments.
7. **Pre-published, fixed multi-round draws** — a different live-operations model from our current adaptive reseeding.
8. **Multi-tier semifinal "waterfall" / repechage bracket** — a new bracket-phase shape, none of our current ones fit.

Items 1–2 and 3–4 are each independent pairs — nothing here blocks anything else in the same tier. Item 5 is the outlier among the first five: it's the only one of them expected to need real design iteration during implementation itself (per the organiser's own call — see its section below). Items 6–8 were flagged 2026-09-20, from a direct review of a real organiser spreadsheet (`Sheets tournaments/[OFFICIAL] FFA Tournament _ Sep. 20.xlsx`, "Matches 40p" tab) rather than a conversation about this app — they're assessment-only, not yet scoped via `AskUserQuestion` or placed in build order relative to each other or to item 5.

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

**Explicitly deferred, not forgotten**: making these overrides available and editable *during* a live tournament, not just pre-start. A real, larger project on its own — see the cross-cutting note below for why.

---

## 5. Skip-ahead / early qualification

**What**: let a player/team qualify directly into a later round (Semis/Final, potentially others in future) several rounds early — e.g. a "First In" mode where winning a match sends you straight to Semis, skipping the intervening rounds. Also relevant to Kings Valley, where a room-ladder position could plausibly lock in a Finals spot early.

**Scope decision (organiser, 2026-09-17) — Option 1, additive**: when a player skips ahead, everyone else's schedule is *unaffected* — the room they left still sends its normal quota forward through the normal rounds, and the fast-tracked player is simply an extra body already parked in the destination round. This is explicitly chosen over the alternative (the skip shrinking/reshaping the pipeline for everyone else, which would force recomputing every downstream round's size depending on how many skips have happened by that point) — Option 1 avoids that cascading-recomputation problem entirely for a first version, with the organiser's own expectation that further nuance will surface through implementation and testing rather than being fully specified upfront.

**Why Option 1 is comparatively tractable**: it's mechanically close to the existing DNF/withdrawal handling (`patchFutureGroupStageRounds`, bye-conversion, `mutations.ts`) — a player already leaves the normal pipeline mid-flight there without breaking downstream room shapes; a skip-ahead is nearly the mirror image (leaving *with* a placement already locked in, instead of leaving with none). The routing primitive itself — `winnersTo`/`losersTo` as plain round-index integers, resolved by `predecessorsOf` (`bracket.ts:144-157`) with no adjacency assumption — already supports a round's output feeding a non-adjacent later round; `sharedFinalDoubleEliminationBracketPhase` (`double-elimination.ts:244-308`) already produces exactly this shape in production for WB-losers-to-LB routing (`continue` at line 264 skips creating an LB round when a survivor target is already met, so `losersDestinationByWinnersRound` can point several rounds ahead).

**What's still missing**: partial-population routing (some winners of a room skip, others don't) has no existing support — every predecessor edge today assumes a room's *entire* population routes to one destination. This needs a new per-slot or per-player routing concept. Kings Valley has no hook for early-exit at all — `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional, complete promote/stay/demote/eliminate cycle every round with no early-exit branch; this will need genuinely new logic layered on top, not reuse of the `winnersTo` machinery Kings Valley doesn't use.

**Risk**: medium-high, and explicitly the item most likely to reveal new sub-decisions during implementation — treat the first working version as a vehicle for surfacing those, not a final design.

---

## 6. Positional-points scoring formula (alternative to Fair Points)

**What**: some real tournaments score rounds with a classic fixed rank-based points table per room — e.g. 1st=10, 2nd=8, 3rd=6, 4th=5, 5th=4, 6th=3, 7th=2, 8th=1 — summed across counted rounds into the cumulative standings, rather than our Fair Points formula (`fairPoints(rank, score) = rank - score / 100000`). Surfaced 2026-09-20 reviewing a real organiser spreadsheet's qualification phase (`[OFFICIAL] FFA Tournament _ Sep. 20.xlsx`, "Matches 40p" tab): 4 counted rounds, each awarding points purely by in-room finishing position, no score magnitude involved at all beyond determining that position.

**Why it's a real gap, not a config tweak**: `scoring: 'fairpoints'` is currently the only value `ScoringSystemKey` supports — `generation.ts` hardcodes it (`scoring: 'fairpoints'` in `GeneratedTournamentConfig`), and Setup's own "Scoring system" field is a disabled dropdown with one option. Positional points is a genuinely different ranking philosophy (ordinal position only) from Fair Points (position *and* score magnitude, via the score term) — not a variant reachable by tuning Fair Points' existing formula. Supporting it would mean a new `ScoringSystemKey` value and a parallel computation path wherever Fair Points is computed today (`materializeStandings`/`advancement.ts`, `finals.ts`'s Final/Semis scoring, `Ranking`-facing UI).

**Open questions, not yet settled**: is the points-by-rank table itself organiser-configurable (a room of 6 probably needs a different table than a room of 8), or a fixed built-in constant per room size? Does it apply per-round only, or also to the Semis/Final's own scoring (which currently always sums raw game scores)? Worth a scoping pass against more real examples before designing — this file's own real spreadsheet example is one data point, not necessarily the only shape organisers want.

**Risk**: low-medium mechanically (an alternate, simpler ranking rule, no new bracket-routing complexity), but touches every place Fair Points is read today, so the blast radius is wide even if each individual change is small.

---

## 7. Pre-published, fixed multi-round draws (vs. adaptive reseeding)

**What**: some organisers want the *entire* qualification-phase room schedule (all N rounds) published before a single game is played, rather than each round's rooms being computed only once the previous round's actual results are in. Surfaced 2026-09-20 from the same spreadsheet review: rounds 1–4's room-draw cells were pre-set fixed values, not formulas referencing live standings anywhere — strong evidence the whole 4-round schedule was worked out and published in advance.

**Why it's architecturally different, not just a generation-time parameter**: our qual-table/Swiss reseeding (`tieredSeed`, diversity/rematch-avoidance weighted by live standings) is built on the premise that a round's rooms don't exist until the round before it has actually been scored — that's the entire mechanism the "manual overrides" work (`ROADMAP.md` item 4, done) still relies on. Publishing every round's draw upfront is a different live-operations model: players need to know their round-3 room before round 1 is even played, which the current architecture can't produce, since it's inherently sequential.

**What's still unclear**: whether organisers actually want pure fixed rotation (computed once, e.g. via `distributeRooms`, with no adaptiveness at all) or something that *looks* fixed but was itself generated by simulating the adaptive algorithm against an assumed/average outcome — the real spreadsheet's exact draw-generation method wasn't visible from the tab alone (no formula pointed back to how the fixed numbers were originally produced). Needs a real scoping conversation, not just inference from one example.

**Risk**: medium — a real behavioral fork (fixed-upfront vs. adaptive) probably needs to become an organiser-facing choice at generation time, not a wholesale replacement of the existing adaptive path (which has its own real value — better rematch avoidance than a naive fixed draw).

---

## 8. Multi-tier semifinal "waterfall" / repechage bracket

**What**: a semifinal stage where the cut round's own *middle*-tier finishers — not just the bottom — get routed into a genuine second-chance ladder that reconverges with the direct qualifiers at a later semifinal stage, rather than a simple top-N cut straight to Semis→Final. Surfaced 2026-09-20 from the same spreadsheet: a room dubbed "Semi A" plays its own games, and its own 5th–8th place finishers *don't* get eliminated — they drop down into a second room, "Semi B," joined by survivors of a separate two-round consolation ladder (fed by the *next* tier down from the original qualification cut). Semi A's and Semi B's own top 4 each then form the 8 Finalists.

**Why none of our current bracket phases fit**: it's not single-elimination (there's a real second chance). It's not our double-elimination shape either — double-elimination is a clean, generalizable mirrored winners/losers split with a fixed qualifier count into the Final; this is closer to a bespoke, room-specific routing table (room 5A's 5th–8th go one place, room 5C's 1st–4th go another, meeting in a specific consolation room) hand-tuned for a 40-player, 5-room field. Kings Valley's persistent-ladder promote/stay/demote/eliminate cycle doesn't fit either — there's no room-ladder concept here, just a handful of one-shot cut rounds with asymmetric cross-room routing.

**Risk**: high, and the hardest of the three items on this page to generalize — every one of our existing bracket phases (`single-elimination.ts`, `double-elimination.ts`, `kings-valley.ts`) computes its shape from a small set of parameters (room size, qualifier counts, round count) for *any* field size; this shape's exact routing (which specific finishing-position ranges from which specific rooms feed which specific consolation room) doesn't obviously generalize the same way, and might only be tractable as an organiser-configured routing table rather than an auto-derived formula. Needs real design work, not just implementation, before this is buildable — likely the most involved item on this whole page, including item 5.

---

## Cross-cutting note: the round-graph invariant

Three of the deferred follow-on projects noted above — mid-tournament manual overrides, any future extension of skip-ahead beyond Option 1, and item 8's waterfall bracket — would all stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce, and that a room's entire population routes to exactly one destination. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination." Item 8 in particular needs exactly the "partial-population routing" primitive item 5's own "what's still missing" already identifies as absent (some finishers of a room going one place, others going elsewhere) — the two items would likely share a design, not need two incompatible ones. If/when any of these three is picked up, a short dedicated design pass on how the round model should represent an overridable/divergent shape — before writing any of them — would avoid solving the same underlying problem twice, incompatibly. Not relevant to items 1–4 or 6–7, since all of those were deliberately scoped to avoid touching this invariant (items 1–2 don't touch round wiring at all; item 3 doesn't change round *shape*, only what's scored where; item 4 is pre-start-only; item 6 is a scoring-formula change, not routing; item 7 changes *when* a draw is computed, not the routing invariant itself).

---

## Open questions still to settle before implementation begins

- ~~**Anonymous accounts (#3)**~~ — resolved and built (2026-09-18): gated on the Final actually finishing, confirmed by the organiser. See "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`.
- ~~**Manual overrides (#4)**~~ — resolved and built (2026-09-19): field list settled via `AskUserQuestion` against the organiser's three stated needs (per-round advancement count, per-round seeding method, total round count). See "Manual overrides, pre-start only" in `HANDOFF_LOG.md`.
- **Skip-ahead (#5)**: per the organiser's own call, expected to clarify through implementation rather than being fully specified here.
- **Positional-points scoring (#6)**: whether the points-by-rank table is organiser-configurable or fixed, and whether it extends to Semis/Final scoring — needs a scoping pass against more real examples.
- **Pre-published fixed draws (#7)**: whether organisers want pure fixed rotation or something that only *looks* fixed — and how it should coexist with the existing adaptive reseeding as an organiser-facing choice, not a replacement.
- **Waterfall semifinal bracket (#8)**: needs real design work (see the cross-cutting note) before it's even scoped as buildable — likely the least-settled item on this page.
