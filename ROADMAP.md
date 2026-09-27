# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file contains future projects and architectural questions not yet scoped or built. Entries here move to `HANDOFF_LOG.md` (and updates to `HANDOFF.md`'s "Open items" section if relevant) once actually built, then are removed from this file. Smaller, shorter-horizon gaps and decisions are in `HANDOFF.md`'s "Open items" section instead.

---

## 9. Mid-tournament manual overrides (extension of item 4)

**What**: making item 4's overrides — pre-start-only total round-count, elimination round-target curve, and elimination seeding-weight overrides — editable *during* a live tournament, not just before it starts (see "Manual overrides, pre-start only" in `HANDOFF_LOG.md` for what item 4 itself covered). Raised as a natural extension while scoping item 4 itself, deliberately deferred rather than built then.

**Why it's harder than item 4 itself**: item 4's overrides are only ever read once, at generation time, before any round exists — there's no existing schedule to reconcile against. Applying the same kind of override mid-tournament means changing a round's declared shape (target count, seeding) *after* some later rounds may already have been generated and displayed (e.g. as future-round Bracket projections) — stressing the round-graph invariant described below in both of its forms: a round's declared count no longer automatically equalling what its predecessor(s) actually produced, *and* (if the override reroutes only part of a room) a room's population needing to split across more than one destination.

**Not yet requested**: the organiser has not asked for this — it's recorded here only because it was explicitly flagged as "deferred, not forgotten" during item 4's own build, and it belongs in this specific spot in the ordering because of the dependency it shares with items 7–8 (see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md` for context on both items), not because it's been prioritized. Pick it up only if raised again. (Updated 2026-09-24: the prerequisite is now met — items 7 and 8 shipped as one waterfall/rank-band project, proving out the partial-population-routing half of the primitive at *generation time*. What remains unproven is the *other* half — a round's declared shape changing after generation — which the waterfall build deliberately avoided by having no live mechanism at all.)

**Risk**: high — needs the second sub-invariant relaxed (a round's shape diverging from what generation produced) on top of the routing primitive that now exists, and (unlike items 7/8) has no organiser-articulated concrete use case yet to design against.

**Dependencies**: items 7–8 — now done (see "Not yet requested" above and the cross-cutting note below).

---

## Cross-cutting note: the round-graph invariant

Three projects on this page — skip-ahead (7) and the waterfall bracket (8) (both completed, see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md` for context), and mid-tournament manual overrides (9) — all stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce, and that a room's entire population routes to exactly one destination. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination."

Item 7's own "what's still missing" already identifies the specific primitive item 8 also needs — partial-population routing (some finishers of a room going one place, others going elsewhere) — the two items would likely share a design, not need two incompatible ones. Item 9 needs that same primitive *plus* the harder of the two sub-invariants (a round's declared shape diverging from what generation originally produced), so it's sequenced last, after both halves have been exercised independently.

**Status (2026-09-24)**: items 7 and 8 shipped together as one generation-time, organiser-authored rank-band routing project (see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`) — the partial-population-routing primitive described above now exists, in the form of `TournamentRound.waterfallRoutes` plus `pendingBracketSeeds` accumulation. Only item 9's harder sub-invariant remains untouched. The sequencing paragraph below is kept as the original reasoning.

**Recommended sequencing, purely for this reason** (original reasoning, now historical, included only for context): build item 7 first — the organiser's own preference was to let its design clarify through implementation, so there's no value in a separate upfront design pass ahead of it. Treat whatever partial-population-routing primitive it produces as the candidate general primitive. Before starting item 8, do a short review to confirm that primitive generalizes to the waterfall bracket's bespoke routing table, rather than reworking it from scratch. Only pick up item 9 afterward, and only if the organiser actually asks for it, since by then both sub-invariants will have real, tested code to build from instead of a from-scratch design.

(Historical note for context: items 1–6, all now completed, were deliberately scoped to avoid touching this invariant. See `HANDOFF_LOG.md` for the full context on each.)

---

## Architectural questions without yet-requested implementation

- **Kings Valley early-exit / skip-ahead** — the part of the original item 7 that the waterfall/rank-band project (2026-09-21) explicitly did *not* cover: `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional promote/stay/demote/eliminate cycle every round with no early-exit branch, and share no primitive with the `winnersTo`/`pendingBracketSeeds` machinery the waterfall bracket reuses. Never requested by the organiser; would be its own separate project if it surfaces.

- **Auto-derived waterfall bracket schemas / letting the app choose the best format** — v1 of the waterfall/rank-band bracket is fully organiser-authored (a `ROUNDS:`/`ROUTES:` text mini-language, generation-time only). The organiser noted (2026-09-21) that a later project could have the app derive such a structure from the field size itself, or judge whether a waterfall-style format is the best fit for a given field at all. Not designed, not precluded — the mini-language's parsed graph is the natural target representation for any future generator. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
