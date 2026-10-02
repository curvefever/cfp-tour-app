# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file contains future projects and architectural questions not yet scoped or built. An entry moves to `HANDOFF_LOG.md` once built (with the current-state docs updated), then is removed from this file. Smaller, shorter-horizon gaps and decisions are in `docs/open-items.md` instead.

---

## Cross-cutting note: the round-graph invariant

Three projects on this page — skip-ahead (7) and the waterfall bracket (8) (both completed, see "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md` for context), and mid-tournament manual overrides (9) — all stress the same implicit invariant that today's domain layer relies on: that every round's declared room/slot count exactly equals what its predecessor round(s) produce, and that a room's entire population routes to exactly one destination. That invariant underlies generation-time room sizing (`generation.ts`/`schedule-generation.ts`) and the future-round display projection (`projectFutureRoundSlots`, `bracket.ts`). Nothing in the current model represents "this round's shape was manually overridden after generation" or "part of a room's population diverged to a different destination."

Item 7's own "what's still missing" already identifies the specific primitive item 8 also needs — partial-population routing (some finishers of a room going one place, others going elsewhere) — the two items would likely share a design, not need two incompatible ones. Item 9 needs that same primitive *plus* the harder of the two sub-invariants (a round's declared shape diverging from what generation originally produced), so it's sequenced last, after both halves have been exercised independently.

**Status (2026-10-02)**: all three projects are done. Items 7 and 8 shipped together as the generation-time waterfall/rank-band project (`TournamentRound.waterfallRoutes` plus `pendingBracketSeeds`); item 9 shipped as live advancement-count edits and line-up corrections, which reuse the existing reshaping paths and needed no relaxation of the invariant (see "Mid-tournament corrections" in `HANDOFF_LOG.md`). The text below is kept as the original reasoning.

**Recommended sequencing, purely for this reason** (original reasoning, now historical, included only for context): build item 7 first — the organiser's own preference was to let its design clarify through implementation, so there's no value in a separate upfront design pass ahead of it. Treat whatever partial-population-routing primitive it produces as the candidate general primitive. Before starting item 8, do a short review to confirm that primitive generalizes to the waterfall bracket's bespoke routing table, rather than reworking it from scratch. Only pick up item 9 afterward, and only if the organiser actually asks for it, since by then both sub-invariants will have real, tested code to build from instead of a from-scratch design.

(Historical note for context: items 1–6, all now completed, were deliberately scoped to avoid touching this invariant. See `HANDOFF_LOG.md` for the full context on each.)

---

## Architectural questions without yet-requested implementation

- **Kings Valley early-exit / skip-ahead** — the part of the original item 7 that the waterfall/rank-band project (2026-09-21) explicitly did *not* cover: `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional promote/stay/demote/eliminate cycle every round with no early-exit branch, and share no primitive with the `winnersTo`/`pendingBracketSeeds` machinery the waterfall bracket reuses. Raised by the organiser (2026-10-01) as worth planning: cumulative with the ladder, e.g. the top room's winner qualifies straight for the Final in the same round the bottom room loses two. Kept separate from the Kings Valley room-sizing fix of the same date; that fix's per-room move solver (`kings-valley.ts`) is where a "straight to the Final" outflow band would plug in, as a second out-of-ladder outflow beside elimination.

- **Auto-derived waterfall bracket schemas / letting the app choose the best format** — v1 of the waterfall/rank-band bracket is fully organiser-authored (a `ROUNDS:`/`ROUTES:` text mini-language, generation-time only). The organiser noted (2026-09-21) that a later project could have the app derive such a structure from the field size itself, or judge whether a waterfall-style format is the best fit for a given field at all. Not designed, not precluded — the mini-language's parsed graph is the natural target representation for any future generator. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
