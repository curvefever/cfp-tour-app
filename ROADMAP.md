# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file is neither current-state (`HANDOFF.md`) nor build history (`HANDOFF_LOG.md`) — it's a forward-looking assessment of projects raised but not yet started, written up so the reasoning behind their scope and ordering survives past the conversation that produced it. Entries here move to `HANDOFF_LOG.md` (with a pointer added to `HANDOFF.md`'s "Immediate next priorities") once actually built, and get struck through/removed from here at that point.

Nothing in this file is scheduled or authorized to start — it's assessment only, recorded 2026-09-17 at the organiser's request.

---

## Recommended build order

1. ~~**Double-elimination bracket layout (WB above LB)**~~ — done (2026-09-17), see "Bracket view: stack WB above LB" in `HANDOFF_LOG.md`. One reservation carried over from the build itself, not yet resolved: independent WB/LB row scrolling was chosen over lockstep scrolling but flagged for a live human check — worth a quick pass in the real app before treating it as settled.
2. ~~**Non-counting qualification rounds ("first N rounds don't count")**~~ — done (2026-09-18), see "Non-counting qualification rounds" in `HANDOFF_LOG.md`. One edge case flagged there, not fixed: the qual-table/Swiss reserve-admission guard still counts *all* rounds played (including non-counting ones) toward its "at most one qualifying round completed" cutoff, so a reserve joining right after a run of non-counting rounds could end up with fewer than two *counted* rounds — worth revisiting only if it bites in practice.
3. ~~**Anonymous accounts, v1 scope**~~ — done (2026-09-18), see "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`. Built narrower than originally scoped here: Final only (not Semis), individual formats only (not team), and excluding grand-final/race rounds — see the entry for why.
4. **Manual overrides, pre-start only** — no dependency on #3; the two are independent and could equally run in the other order.
5. **Skip-ahead / early qualification (Option 1: additive)** — last; genuinely new domain-layer routing, with Kings Valley needing its own separate mechanism on top.

Items 1–2 and 3–4 are each independent pairs — nothing here blocks anything else in the same tier. Item 5 is the outlier: it's the only one of the five expected to need real design iteration during implementation itself (per the organiser's own call — see its section below).

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

## 4. Manual overrides, pre-start only

**What**: an "advanced"/"manual overrides" section in Setup exposing more of what the app currently auto-computes — e.g. how many advance from a specific round, how a round reseeds the next one, total round count — for tournaments too custom to schedule algorithmically end to end.

**What already exists**: Setup already has several overrides of exactly this kind — `semisOverride`, `finalOverride`, LB-qualifier count, grand-final win targets (`SetupView.tsx`, threaded through `generation.ts`) — but every one of them is pre-start-only, read once when generating the schedule, before `started: true` locks the tournament irreversibly. This project is scoped to extending that same pattern with more fields, not building a new mechanism.

**Why pre-start-only is materially simpler than mid-tournament** (organiser's chosen scope, 2026-09-17): pre-start overrides are just additional input parameters into the one-time generation math that already exists — no different, architecturally, from how `semisOverride` works today. They don't touch the invariant that a live, already-in-progress tournament's future rounds must stay consistent with rounds already played (the issue that makes a *mid-tournament* version of this project genuinely harder — see "Cross-cutting note" below). A per-round advancement-count override, a per-round seeding-method choice, and a total-round-count override can each be added as Setup fields read by `generation.ts`/`schedule-generation.ts`, the same way today's overrides are.

**Risk**: low-medium. Mechanically straightforward extension of an existing, proven pattern; main risk is Setup UI complexity/discoverability (an "advanced" section needs to stay out of the way of the common case) and validating override combinations don't produce an impossible schedule (the same kind of upfront validation `generation.ts` already does for today's overrides).

**Explicitly deferred, not forgotten**: making these overrides available and editable *during* a live tournament, not just pre-start. A real, larger project on its own — see the cross-cutting note below for why.

---

## 5. Skip-ahead / early qualification

**What**: let a player/team qualify directly into a later round (Semis/Final, potentially others in future) several rounds early — e.g. a "First In" mode where winning a match sends you straight to Semis, skipping the intervening rounds. Also relevant to Kings Valley, where a room-ladder position could plausibly lock in a Finals spot early.

**Scope decision (organiser, 2026-09-17) — Option 1, additive**: when a player skips ahead, everyone else's schedule is *unaffected* — the room they left still sends its normal quota forward through the normal rounds, and the fast-tracked player is simply an extra body already parked in the destination round. This is explicitly chosen over the alternative (the skip shrinking/reshaping the pipeline for everyone else, which would force recomputing every downstream round's size depending on how many skips have happened by that point) — Option 1 avoids that cascading-recomputation problem entirely for a first version, with the organiser's own expectation that further nuance will surface through implementation and testing rather than being fully specified upfront.

**Why Option 1 is comparatively tractable**: it's mechanically close to the existing DNF/withdrawal handling (`patchFutureGroupStageRounds`, bye-conversion, `mutations.ts`) — a player already leaves the normal pipeline mid-flight there without breaking downstream room shapes; a skip-ahead is nearly the mirror image (leaving *with* a placement already locked in, instead of leaving with none). The routing primitive itself — `winnersTo`/`losersTo` as plain round-index integers, resolved by `predecessorsOf` (`bracket.ts:144-157`) with no adjacency assumption — already supports a round's output feeding a non-adjacent later round; `sharedFinalDoubleEliminationBracketPhase` (`double-elimination.ts:244-308`) already produces exactly this shape in production for WB-losers-to-LB routing (`continue` at line 264 skips creating an LB round when a survivor target is already met, so `losersDestinationByWinnersRound` can point several rounds ahead).

**What's still missing**: partial-population routing (some winners of a room skip, others don't) has no existing support — every predecessor edge today assumes a room's *entire* population routes to one destination. This needs a new per-slot or per-player routing concept. Kings Valley has no hook for early-exit at all — `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional, complete promote/stay/demote/eliminate cycle every round with no early-exit branch; this will need genuinely new logic layered on top, not reuse of the `winnersTo` machinery Kings Valley doesn't use.

**Risk**: medium-high, and explicitly the item most likely to reveal new sub-decisions during implementation — treat the first working version as a vehicle for surfacing those, not a final design.

---

## Cross-cutting note: the round-graph invariant

Two of the deferred follow-on projects noted above — mid-tournament manual overrides, and any future extension of skip-ahead beyond Option 1 — would both stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination." If/when either of those two deferred projects is picked up, a short dedicated design pass on how the round model should represent an overridable/divergent shape — before writing either feature — would avoid solving the same underlying problem twice, incompatibly. Not relevant to any of the five items actually ordered above, since all five were deliberately scoped to avoid touching this invariant (items 1–2 don't touch round wiring at all; item 3 doesn't change round *shape*, only what's scored where; item 4 is pre-start-only; item 5's Option 1 is explicitly additive).

---

## Open questions still to settle before implementation begins

- ~~**Anonymous accounts (#3)**~~ — resolved and built (2026-09-18): gated on the Final actually finishing, confirmed by the organiser. See "Anonymous Finals matches, v1" in `HANDOFF_LOG.md`.
- **Manual overrides (#4)**: exact field list for the "advanced" Setup section — this roadmap doesn't enumerate every override field, just confirms the mechanism. Worth a short scoping pass against real problem tournaments the organiser has in mind.
- **Skip-ahead (#5)**: per the organiser's own call, expected to clarify through implementation rather than being fully specified here.
