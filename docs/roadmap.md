# Curve Fever Pro Tour Hub — Future Projects Roadmap

This file contains future projects and architectural questions not yet scoped or built. An entry moves to `HANDOFF_LOG.md` once built (with the current-state docs updated), then is removed from this file. Smaller, shorter-horizon gaps and decisions are in `docs/open-items.md` instead.

---

## Architectural questions without yet-requested implementation

- **Kings Valley early-exit / skip-ahead** — the part of the original item 7 that the waterfall/rank-band project (2026-09-21) explicitly did *not* cover: `kingsValleyBracketPhase`/`kingsValleyComputeAdvancement` run an unconditional promote/stay/demote/eliminate cycle every round with no early-exit branch, and share no primitive with the `winnersTo`/`pendingBracketSeeds` machinery the waterfall bracket reuses. Raised by the organiser (2026-10-01) as worth planning: cumulative with the ladder, e.g. the top room's winner qualifies straight for the Final in the same round the bottom room loses two. Kept separate from the Kings Valley room-sizing fix of the same date; that fix's per-room move solver (`kings-valley.ts`) is where a "straight to the Final" outflow band would plug in, as a second out-of-ladder outflow beside elimination.

- **Auto-derived waterfall bracket schemas / letting the app choose the best format** — v1 of the waterfall/rank-band bracket is fully organiser-authored (a `ROUNDS:`/`ROUTES:` text mini-language, generation-time only). The organiser noted (2026-09-21) that a later project could have the app derive such a structure from the field size itself, or judge whether a waterfall-style format is the best fit for a given field at all. Not designed, not precluded — the mini-language's parsed graph is the natural target representation for any future generator. See "Waterfall / rank-band bracket phase" in `HANDOFF_LOG.md`.
