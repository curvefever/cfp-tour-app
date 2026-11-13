# Text inventory: CFP Tournament Hub

A read-only review aid listing the wording a user can see in the app. It is not a current-state doc and is not kept in step with the code: line numbers are those of the commit it was written on. Source files were not changed. Written 2026-10-15 from `src/features/**`, `src/components/**` and `src/routes/__root.tsx`.

## How to edit

**Edit in place.** There is no strings file: each text sits in the component or helper listed in its row. The link in the last-but-one column opens that line.

**Columns.** *Text* is as written in the code, with `{placeholders}` where a value is inserted (`{x / y}` means one of the two depending on the situation; `∅` is an empty string). *Kind*: **fixed** is a plain string; **built** is a sentence assembled from the tournament's settings or results, so changing it means keeping the `${…}` pieces intact. *Who*: **viewer**, **admin**, or **both**. The last column notes text that CSS shows in capitals (`uppercase`): it is written in normal case in the code and edited in normal case.

**Capitals.** Besides the rows marked "CSS caps", every page label under the tournament name (BRACKET, INFO, ADMIN, SETUP, RANKINGS/PLAYERS, the standings tab name), room titles, column/round titles, badges, table headers and panel labels render in capitals. Check the row's note; if a label looks capitalised on screen without a note, look for `uppercase` in its `className` (or the helper in `src/components/ui/typography.ts`).

**Search tips (PowerShell or Bash, from the repo root).**

- Fragment, case-insensitive, tests excluded: `git grep -n -i "still playing" -- src ":!*.test.*"`. Search a short, distinctive fragment: generated sentences are split around `${…}`, so searching for the whole example sentence finds nothing.
- The same fragment in the tests, to see what will need updating: `git grep -n -i "still playing" -- ":(glob)**/*.test.*" ":(glob)**/*.spec.ts"`.
- Apostrophes: the code mixes `'` and `’` (and `&apos;` in JSX). Search a fragment without the apostrophe.
- JSX text is split across lines; search one line of it.

**Tests that assert exact wording.** A text change fails the matching test, which has to be updated to the new wording (the test is the only other place the sentence is written out):

| Wording | Test file(s) |
| --- | --- |
| Standings sentences, table cells | `src/features/standings/standings-text.test.ts` |
| Exit pop-up lines | `src/features/bracket/exit-lines.test.ts` |
| Follow banner | `src/features/bracket/follow-text.test.ts` |
| Colour key rows | `src/features/bracket/bracket-legend.test.ts` |
| Room titles, "still playing", folded rounds, team lines | `room-title.test.ts`, `still-playing.test.ts`, `folded-round.test.ts`, `team-member-line.test.ts` (same folder) |
| Rankings "where", podium, registered line | `src/features/rankings/ranking-where.test.ts`, `ranking-podium.test.ts`, `players-line.test.ts` |
| Format line, dates, relative time | `src/features/tournaments/tournament-info.test.ts` |
| Status explanation, publish hint, finish reminder | `src/features/tournaments/admin-actions.test.ts` |
| Section empty texts, status pills, cards | `tournaments-list.test.ts`, `tournament-index.test.ts`, `visit.test.ts` (same folder) |
| Settings recap rows | `src/features/admin/settings-recap.test.ts`, `src/features/admin/setup/format-fields.test.ts`, `roster-status.test.ts` |
| Scoring system names (Setup option, Admin recap) | `src/domain/tournament/__tests__/scoring.test.ts`, `src/features/admin/settings-recap.test.ts` |
| Progress lines | `src/features/admin/progress-summary.test.ts` |
| Copy-settings refusals | `src/features/admin/copy-settings/past-tournament-settings.test.ts` |
| Tab labels | `src/features/shell/tabs.test.ts` |
| Presence ("is editing") | `src/features/presence/presence.shared.test.ts` |
| Image and screenshot errors | `src/features/info/image-shrink.test.ts`, `src/features/tournaments/screenshots.shared.test.ts` |
| Fixed UI words (button names, headings, the "?" box, notes panel, hub texts) | the browser tests `e2e/smoke.spec.ts`, `e2e/screens/screens.spec.ts`, `e2e/screens/scratch-admin.spec.ts` (found by grepping them for the old text) |

A text that is not generated (a button, a heading) is mostly asserted only by the e2e specs; grep both folders for the old wording before and after the edit.

**Checks after editing** (from `AGENTS.md`; never run a full build, `pnpm lint` or `pnpm format:check`):

```bash
pnpm exec prettier --check <changed files>
pnpm exec eslint <changed files>
pnpm exec vitest related --run <changed source and test files> 2>&1 | grep -aE "Test Files|Tests |FAIL"
```

Prettier is never run on `HANDOFF.md`, `HANDOFF_LOG.md` or `docs/*.md`, or on this file.

**Wording outside `src/features`.** Some visible words are built in `src/domain/tournament/` and are not listed row by row: round names (`bracket.ts:36`: "Round 3", "Semis", "Final", "WB Round 2", "LB Round 2", "Grand Final", or the custom label an organiser typed), slot labels of undrawn rooms (`bracket.ts:167`, quoted in the Bracket examples), game format names (`formats.ts:15`: "FFA — Individual", "2v2v2v2", "3v3v3", "3v3", "1v1"; unit words Player/Players, Team/Teams) and account role names (CFP role enum). The downloadable rankings image (`rankings-image.ts`) draws its own text on a canvas; it is listed in section 5.

## Entries per screen

Rows in the tables below (generated-sentence example tables and the appendix not included).

| Screen | Entries | Files |
| --- | ---: | ---: |
| 1. Tournaments (hub page) | 29 | 4 |
| 2. Info tab | 37 | 5 |
| 3. Bracket tab | 178 | 32 |
| 4. Standings tab (named Qualification / Swiss / Groups) | 42 | 5 |
| 5. Rankings / Players tab | 110 | 9 |
| 6. Admin tab: tournament list | 16 | 2 |
| 7. Setup (a draft tournament in the Admin tab) | 205 | 19 |
| 8. Running Admin (a started tournament) | 178 | 16 |
| 9. Header and shell (all screens) | 48 | 14 |
| 10. Messages from the data layer that can reach a screen | 25 | 5 |
| 11. Shared UI (src/components/**) | 0 | 0 |
| **Total** | **868** | |

## 1. Tournaments (hub page)

The hub page every visitor lands on: three lists of tournament cards. Dates come from `scheduledParts` (see Info).

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Card format line | [tournament-info.ts:28](src/features/tournaments/tournament-info.ts:28) | 1v1 · Swiss · Single elimination · 37 players |
| Date line on a card | [tournament-info.ts:79](src/features/tournaments/tournament-info.ts:79) | Sat 18 Oct, 20:00 CEST · in 5 days |
| Count | [tournaments-list.ts:28](src/features/tournaments/tournaments-list.ts:28) | 1 player / 37 players / 12 teams |

### phase-display.ts — Status pills (Upcoming, Starting soon, Ongoing, Finished; Draft/Published in the Admin list)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Draft` | fixed | admin | [phase-display.ts:4](src/features/tournaments/phase-display.ts:4) | CSS caps (badge) |
| `Upcoming` | fixed | viewer | [phase-display.ts:5](src/features/tournaments/phase-display.ts:5) | CSS caps (badge) |
| `Starting soon` | fixed | viewer | [phase-display.ts:6](src/features/tournaments/phase-display.ts:6) | CSS caps (badge) |
| `Ongoing` | fixed | viewer | [phase-display.ts:7](src/features/tournaments/phase-display.ts:7) | CSS caps (badge) |
| `Finished` | fixed | viewer | [phase-display.ts:8](src/features/tournaments/phase-display.ts:8) | CSS caps (badge) |
| `Draft` | fixed | admin | [phase-display.ts:23](src/features/tournaments/phase-display.ts:23) | CSS caps (badge) |
| `Published` | fixed | admin | [phase-display.ts:24](src/features/tournaments/phase-display.ts:24) | CSS caps (badge) |
| `Starting soon` | fixed | viewer | [phase-display.ts:25](src/features/tournaments/phase-display.ts:25) | CSS caps (badge) |
| `Ongoing` | fixed | viewer | [phase-display.ts:26](src/features/tournaments/phase-display.ts:26) | CSS caps (badge) |
| `Finished` | fixed | viewer | [phase-display.ts:27](src/features/tournaments/phase-display.ts:27) | CSS caps (badge) |

### tournaments-list.ts — Empty-section texts and the "37 players" count on a card

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `No tournament currently ongoing` | fixed | viewer | [tournaments-list.ts:24](src/features/tournaments/tournaments-list.ts:24) |  |
| `New tournaments coming out soon!` | fixed | viewer | [tournaments-list.ts:25](src/features/tournaments/tournaments-list.ts:25) |  |
| `No tournament completed yet` | fixed | viewer | [tournaments-list.ts:26](src/features/tournaments/tournaments-list.ts:26) |  |
| `Players` | fixed | viewer | [tournaments-list.ts:32](src/features/tournaments/tournaments-list.ts:32) |  |
| `{count} {player(s) / team(s)}` | built | viewer | [tournaments-list.ts:33](src/features/tournaments/tournaments-list.ts:33) |  |

### TournamentsView.tsx — Tournaments page: card list

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `WINNER` | fixed | viewer | [TournamentsView.tsx:21](src/features/tournaments/TournamentsView.tsx:21) |  |
| `Date to be announced` | fixed | viewer | [TournamentsView.tsx:45](src/features/tournaments/TournamentsView.tsx:45) |  |
| `Unnamed Tournament` | fixed | viewer | [TournamentsView.tsx:68](src/features/tournaments/TournamentsView.tsx:68) |  |
| `Now` | fixed | viewer | [TournamentsView.tsx:69](src/features/tournaments/TournamentsView.tsx:69) | CSS caps (badge) |
| `Starting soon` | fixed | viewer | [TournamentsView.tsx:70](src/features/tournaments/TournamentsView.tsx:70) | CSS caps (badge) |
| `Test run` | fixed | viewer | [TournamentsView.tsx:71](src/features/tournaments/TournamentsView.tsx:71) | CSS caps (badge) |
| `Tournaments` | fixed | viewer | [TournamentsView.tsx:124](src/features/tournaments/TournamentsView.tsx:124) |  |
| `Ongoing` | fixed | viewer | [TournamentsView.tsx:128](src/features/tournaments/TournamentsView.tsx:128) | CSS caps (column title) |
| `Upcoming` | fixed | viewer | [TournamentsView.tsx:134](src/features/tournaments/TournamentsView.tsx:134) | CSS caps (column title) |
| `Finished` | fixed | viewer | [TournamentsView.tsx:140](src/features/tournaments/TournamentsView.tsx:140) | CSS caps (column title) |
| `Loading the tournaments…` | fixed | viewer | [TournamentsView.tsx:148](src/features/tournaments/TournamentsView.tsx:148) |  |
| `Log in as admin` | fixed | viewer | [TournamentsView.tsx:156](src/features/tournaments/TournamentsView.tsx:156) | shown to visitors who are not signed in |

### visit.ts — Notice when a tournament link cannot be opened

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `This tournament isn't available.` | fixed | viewer | [visit.ts:7](src/features/tournaments/visit.ts:7) |  |
| `It may be a draft, or it was removed. Here is what's on.` | fixed | viewer | [visit.ts:9](src/features/tournaments/visit.ts:9) |  |

## 2. Info tab

The Info tab: When / Format cards, lobby screenshots, the organiser's rules text, a link to the general rules.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Format card | [tournament-info.ts:28](src/features/tournaments/tournament-info.ts:28) | 1v1 · Swiss · Single elimination (parts: FFA / 2v2v2v2 / 3v3v3 / 3v3 / 1v1 · none / Qualification table / Swiss / Group stage · Single elimination / Double elimination / Kings Valley / Waterfall bracket) |
| When card | [tournament-info.ts:79](src/features/tournaments/tournament-info.ts:79) | Sat 18 Oct, 20:00 CEST (zone letters from `timeZoneLabel`, else GMT+5:30) |
| Relative time | [tournament-info.ts:61](src/features/tournaments/tournament-info.ts:61) | in 45 min · in 3 h · in 2 days · starting now · just started · started 3 h ago |

### image-shrink.ts — Errors when an uploaded screenshot cannot be shrunk (shown in Setup / Admin)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Could not read the image.` | fixed | admin | [image-shrink.ts:27](src/features/info/image-shrink.ts:27) |  |
| `This file is not an image the browser can read.` | fixed | admin | [image-shrink.ts:35](src/features/info/image-shrink.ts:35) |  |
| `The browser cannot shrink images.` | fixed | admin | [image-shrink.ts:40](src/features/info/image-shrink.ts:40) |  |
| `This image is too detailed to shrink small enough. Try a smaller screenshot.` | fixed | admin | [image-shrink.ts:50](src/features/info/image-shrink.ts:50) |  |

### InfoView.tsx — Info tab page

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Exit tournament view` | fixed | viewer | [InfoView.tsx:35](src/features/info/InfoView.tsx:35) |  |
| `When` | fixed | viewer | [InfoView.tsx:48](src/features/info/InfoView.tsx:48) | CSS caps (label/title) |
| `Date to be announced` | fixed | viewer | [InfoView.tsx:50](src/features/info/InfoView.tsx:50) |  |
| `Format` | fixed | viewer | [InfoView.tsx:60](src/features/info/InfoView.tsx:60) | CSS caps (label/title) |
| `Info` | fixed | viewer | [InfoView.tsx:84](src/features/info/InfoView.tsx:84) | CSS caps (label/title) |
| `When and what` | fixed | viewer | [InfoView.tsx:87](src/features/info/InfoView.tsx:87) |  |
| `Lobby` | fixed | viewer | [InfoView.tsx:93](src/features/info/InfoView.tsx:93) | CSS caps (label/title) |
| `Rules` | fixed | viewer | [InfoView.tsx:99](src/features/info/InfoView.tsx:99) | CSS caps (label/title) |
| `General tournament rules →` | fixed | viewer | [InfoView.tsx:111](src/features/info/InfoView.tsx:111) |  |

### ScreenshotGallery.tsx — Full-size lobby screenshot dialog

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Lobby screenshot` | fixed | viewer | [ScreenshotGallery.tsx:23](src/features/info/ScreenshotGallery.tsx:23) |  |
| `Lobby screenshot, full size` | fixed | viewer | [ScreenshotGallery.tsx:25](src/features/info/ScreenshotGallery.tsx:25) |  |
| `Close` | fixed | viewer | [ScreenshotGallery.tsx:30](src/features/info/ScreenshotGallery.tsx:30) |  |

### ScreenshotThumb.tsx — Lobby screenshot thumbnails

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Loading…` | fixed | viewer | [ScreenshotThumb.tsx:21](src/features/info/ScreenshotThumb.tsx:21) |  |
| `Not available` | fixed | viewer | [ScreenshotThumb.tsx:22](src/features/info/ScreenshotThumb.tsx:22) |  |
| `Lobby screenshot` | fixed | viewer | [ScreenshotThumb.tsx:29](src/features/info/ScreenshotThumb.tsx:29) |  |

### tournament-info.ts — Generated: format line ("1v1 · Swiss · Single elimination") and date/time line

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `FFA` | fixed | viewer | [tournament-info.ts:5](src/features/tournaments/tournament-info.ts:5) |  |
| `Qualification table` | fixed | viewer | [tournament-info.ts:14](src/features/tournaments/tournament-info.ts:14) |  |
| `Swiss` | fixed | viewer | [tournament-info.ts:15](src/features/tournaments/tournament-info.ts:15) |  |
| `Group stage` | fixed | viewer | [tournament-info.ts:16](src/features/tournaments/tournament-info.ts:16) |  |
| `Single elimination` | fixed | viewer | [tournament-info.ts:20](src/features/tournaments/tournament-info.ts:20) |  |
| `Double elimination` | fixed | viewer | [tournament-info.ts:21](src/features/tournaments/tournament-info.ts:21) |  |
| `Double elimination` | fixed | viewer | [tournament-info.ts:22](src/features/tournaments/tournament-info.ts:22) |  |
| `Kings Valley` | fixed | viewer | [tournament-info.ts:23](src/features/tournaments/tournament-info.ts:23) |  |
| `Waterfall bracket` | fixed | viewer | [tournament-info.ts:24](src/features/tournaments/tournament-info.ts:24) |  |
| `{minutes} min` | built | viewer | [tournament-info.ts:55](src/features/tournaments/tournament-info.ts:55) |  |
| `{hours} h` | built | viewer | [tournament-info.ts:57](src/features/tournaments/tournament-info.ts:57) |  |
| `{days} days` | built | viewer | [tournament-info.ts:58](src/features/tournaments/tournament-info.ts:58) |  |
| `starting now` | fixed | viewer | [tournament-info.ts:63](src/features/tournaments/tournament-info.ts:63) |  |
| `just started` | fixed | viewer | [tournament-info.ts:63](src/features/tournaments/tournament-info.ts:63) |  |
| `in {describeGap}` | built | viewer | [tournament-info.ts:64](src/features/tournaments/tournament-info.ts:64) |  |
| `started {describeGap} ago` | built | viewer | [tournament-info.ts:64](src/features/tournaments/tournament-info.ts:64) |  |
| `{weekday} {day} {month}, {hour}:{minute} {zone}` | built | viewer | [tournament-info.ts:96](src/features/tournaments/tournament-info.ts:96) |  |
| `{date} · {relative}` | built | viewer | [tournament-info.ts:107](src/features/tournaments/tournament-info.ts:107) |  |

## 3. Bracket tab

The Bracket tab. Most sentences here are generated from the tournament's own settings; see the example table below. Round names ("Round 3", "Semis", "R1C", "WB Round 2") come from `src/domain/tournament/bracket.ts` (see "Wording outside src/features").

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Room title | [room-title.ts:14](src/features/bracket/room-title.ts:14) | Final · Semi A · Group B · Room A · Room C |
| Exit pop-up, bracket room | [exit-lines.ts:69](src/features/bracket/exit-lines.ts:69) | 1 → Semis · 2–3 → R1C · 4 ★ lucky loser? (2 spots) · 5–8 out · with `cutVersion` and several room sizes: 4 ★ lucky loser? (2–3 spots, rooms of 4) · 3 ★ lucky loser? (0–1 spot, room of 3) · 1 → Room A (Kings Valley) · stay |
| Exit pop-up, pooling room | [exit-lines.ts:95](src/features/bracket/exit-lines.ts:95) | 1st +8 / 2nd +7 … 7th +2 points · All → qualification · All seeding only, not counted · All → Round 4 |
| Exit pop-up, standings | [exit-lines.ts:118](src/features/bracket/exit-lines.ts:118) | 1–16 → R1 · 17–24 → R1C · 25–37 out · 1–2 (each group) → Round 4 · 3+ out · All → Semis |
| Follow banner | [follow-text.ts:86](src/features/bracket/follow-text.ts:86) | Quarters · Room B · 4th → Semi B · Out in Quarters · Room B · 7th · Round 3 · Bye · Round 2 · Room B · #6 in qualification · Group B · Room A · #2 in group · Out in qualification · #25 · Not in this bracket |
| Follow banner on Standings tab | [follow-text.ts:128](src/features/bracket/follow-text.ts:128) | #14 · → Round 4 · #30 · out · Not in these standings |
| Colour key row | [bracket-legend.ts:64](src/features/bracket/bracket-legend.ts:64) | Through = Advances or qualifies · Through to R1B or R2 = A second group of places · Lucky loser = Qualified on a spare spot ★ · Out = Eliminated · Undecided = Not settled yet, or a tie-break pending · Losers bracket = Dropped, still playing · Promoted / Stays / Demoted = Kings Valley: moves up a room / same room / moves down a room (rows shown only where the tournament has such rounds) |
| Lucky loser race box (one room size, and tournaments without `cutVersion`) | [RoundNotes.tsx:27](src/features/bracket/RoundNotes.tsx:27) | ★ LUCKY LOSER RACE · 2 SPOTS, then "Room C still playing." / "Rooms B and C still playing." / "Rooms A, B and C still playing." |
| Lucky loser race box, fair cut with several room sizes | [RoundNotes.tsx:91](src/features/bracket/RoundNotes.tsx:91) | ★ ROOMS OF 4 · 2–3 SPOTS, a list of units, ★ ROOM OF 3 · 0–1 SPOT, then "Spare cut: Team Cedar is in the bottom 14% of rooms of 4 so far, Team Dune in the bottom 21% of rooms of 3. Team Cedar goes out." (… "drops to the losers bracket." in a double-elimination winners round) |
| Tie banners | [TieBanners.tsx:20](src/features/bracket/TieBanners.tsx:20) | ⚠ Tie-break required — Room B (score 123) · ⚖ Group A qualification tie at the cut-off (45 pts) · ⚖ Qualification tie between 24th and 25th (45 pts) · Ranked so far: A > B — tied: C, D — pick who ranks next |
| Slot labels of undrawn rooms | [bracket.ts:167](src/domain/tournament/bracket.ts:167) | Winner of Room 2B · Room 2B, Rank 3 · Qualification #7 · ★ Lucky loser (any room) · Qualifier from standings (seed TBD) |

### AnnotationsPanel.tsx — Notes panel (organiser notes shown to viewers)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Notes about this tournament` | fixed | viewer | [AnnotationsPanel.tsx:24](src/features/bracket/AnnotationsPanel.tsx:24) |  |
| `Notes about this tournament` | fixed | viewer | [AnnotationsPanel.tsx:30](src/features/bracket/AnnotationsPanel.tsx:30) |  |
| `Delete this note? This cannot be undone.` | fixed | admin | [AnnotationsPanel.tsx:76](src/features/bracket/AnnotationsPanel.tsx:76) |  |
| `Notes` | fixed | viewer | [AnnotationsPanel.tsx:85](src/features/bracket/AnnotationsPanel.tsx:85) | CSS caps (title) |
| `Notes` | fixed | viewer | [AnnotationsPanel.tsx:90](src/features/bracket/AnnotationsPanel.tsx:90) | CSS caps (title) |
| `Close` | fixed | viewer | [AnnotationsPanel.tsx:92](src/features/bracket/AnnotationsPanel.tsx:92) |  |
| `No notes yet.` | fixed | viewer | [AnnotationsPanel.tsx:100](src/features/bracket/AnnotationsPanel.tsx:100) |  |
| `Delete note` | fixed | admin | [AnnotationsPanel.tsx:114](src/features/bracket/AnnotationsPanel.tsx:114) |  |
| `Add a note` | fixed | admin | [AnnotationsPanel.tsx:127](src/features/bracket/AnnotationsPanel.tsx:127) |  |
| `Add note` | fixed | admin | [AnnotationsPanel.tsx:137](src/features/bracket/AnnotationsPanel.tsx:137) |  |

### AnonymousFinalCard.tsx — Anonymous-Final side card

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `🎭 Anonymous matches` | fixed | viewer | [AnonymousFinalCard.tsx:38](src/features/bracket/AnonymousFinalCard.tsx:38) |  |
| `{alias} → {unitDisplay}` | built | viewer | [AnonymousFinalCard.tsx:45](src/features/bracket/AnonymousFinalCard.tsx:45) |  |
| `G` | fixed | viewer | [AnonymousFinalCard.tsx:52](src/features/bracket/AnonymousFinalCard.tsx:52) |  |
| `G` | fixed | viewer | [AnonymousFinalCard.tsx:59](src/features/bracket/AnonymousFinalCard.tsx:59) |  |
| `🔓 Connect & reveal` | fixed | admin | [AnonymousFinalCard.tsx:80](src/features/bracket/AnonymousFinalCard.tsx:80) |  |

### bracket-legend.ts — Generated: the colour-key rows of the "?" box, only what this tournament has

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Round {n}` | built | viewer | [bracket-legend.ts:36](src/features/bracket/bracket-legend.ts:36) |  |
| `Through` | fixed | viewer | [bracket-legend.ts:71](src/features/bracket/bracket-legend.ts:71) |  |
| `Advances or qualifies` | fixed | viewer | [bracket-legend.ts:71](src/features/bracket/bracket-legend.ts:71) |  |
| `Lucky loser` | fixed | viewer | [bracket-legend.ts:73](src/features/bracket/bracket-legend.ts:73) |  |
| `Qualified on a spare spot` | fixed | viewer | [bracket-legend.ts:73](src/features/bracket/bracket-legend.ts:73) |  |
| `Through to {R1B or R2}` | built | viewer | [bracket-legend.ts:77](src/features/bracket/bracket-legend.ts:77) |  |
| `A second group of places` | fixed | viewer | [bracket-legend.ts:78](src/features/bracket/bracket-legend.ts:78) |  |
| `Through to {R1B or R2}` | built | viewer | [bracket-legend.ts:84](src/features/bracket/bracket-legend.ts:84) |  |
| `A third group of places` | fixed | viewer | [bracket-legend.ts:85](src/features/bracket/bracket-legend.ts:85) |  |
| `Out` | fixed | viewer | [bracket-legend.ts:88](src/features/bracket/bracket-legend.ts:88) |  |
| `Eliminated` | fixed | viewer | [bracket-legend.ts:88](src/features/bracket/bracket-legend.ts:88) |  |
| `Undecided` | fixed | viewer | [bracket-legend.ts:89](src/features/bracket/bracket-legend.ts:89) |  |
| `Not settled yet, or a tie-break pending` | fixed | viewer | [bracket-legend.ts:89](src/features/bracket/bracket-legend.ts:89) |  |
| `Losers bracket` | fixed | viewer | [bracket-legend.ts:91](src/features/bracket/bracket-legend.ts:91) |  |
| `Dropped, still playing` | fixed | viewer | [bracket-legend.ts:91](src/features/bracket/bracket-legend.ts:91) |  |
| `Promoted` | fixed | viewer | [bracket-legend.ts:95](src/features/bracket/bracket-legend.ts:95) |  |
| `Kings Valley: moves up a room` | fixed | viewer | [bracket-legend.ts:95](src/features/bracket/bracket-legend.ts:95) |  |
| `Stays` | fixed | viewer | [bracket-legend.ts:96](src/features/bracket/bracket-legend.ts:96) |  |
| `Kings Valley: same room` | fixed | viewer | [bracket-legend.ts:96](src/features/bracket/bracket-legend.ts:96) |  |
| `Demoted` | fixed | viewer | [bracket-legend.ts:97](src/features/bracket/bracket-legend.ts:97) |  |
| `Kings Valley: moves down a room` | fixed | viewer | [bracket-legend.ts:97](src/features/bracket/bracket-legend.ts:97) |  |

### BracketInfoBox.tsx — The "?" box (colour key + explanation)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `How to read the bracket` | fixed | viewer | [BracketInfoBox.tsx:11](src/features/bracket/BracketInfoBox.tsx:11) | CSS caps (title) |
| `How to read the bracket` | fixed | viewer | [BracketInfoBox.tsx:41](src/features/bracket/BracketInfoBox.tsx:41) | CSS caps (title) |
| `How to read the bracket` | fixed | viewer | [BracketInfoBox.tsx:46](src/features/bracket/BracketInfoBox.tsx:46) | CSS caps (title) |
| `Close` | fixed | viewer | [BracketInfoBox.tsx:48](src/features/bracket/BracketInfoBox.tsx:48) |  |
| `★ Lucky losers` | fixed | viewer | [BracketInfoBox.tsx:71](src/features/bracket/BracketInfoBox.tsx:71) | CSS caps (title) |
| `Each room size loses its fair share of the cut. Within a size, places count first, then score relative to the room's average. A spare cut falls on whichever next in line ranks lower against every room of their size so far.` | fixed | viewer | [bracket-legend.ts:24](src/features/bracket/bracket-legend.ts:24) | the "★ Lucky losers" paragraph of a tournament with `cutVersion` |
| `Spare spots are awarded to players by score relative to their room's average.` | fixed | viewer | [bracket-legend.ts:26](src/features/bracket/bracket-legend.ts:26) | the same paragraph for a tournament without `cutVersion` |
| `Some rounds keep spots for the best players who just missed out. Once every room of the round is scored, those players are compared by their score relative to their room's average, so a smaller room gives no head start. Until then they show as undecided, with a star.` | fixed | viewer | [BracketInfoBox.tsx:74](src/features/bracket/BracketInfoBox.tsx:74) |  |
| `The arrow icon on a room shows who goes where from that room.` | fixed | viewer | [BracketInfoBox.tsx:81](src/features/bracket/BracketInfoBox.tsx:81) |  |

### BracketRounds.tsx — Round columns of the Bracket

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Winners bracket` | fixed | viewer | [BracketRounds.tsx:99](src/features/bracket/BracketRounds.tsx:99) | CSS caps (label) |
| `Losers bracket` | fixed | viewer | [BracketRounds.tsx:111](src/features/bracket/BracketRounds.tsx:111) | CSS caps (label) |
| `Round` | fixed | viewer | [BracketRounds.tsx:115](src/features/bracket/BracketRounds.tsx:115) |  |
| `Round {roundNum}` | built | viewer | [BracketRounds.tsx:231](src/features/bracket/BracketRounds.tsx:231) |  |

### BracketView.tsx — Bracket page: heading, follow search, round buttons

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Bracket` | fixed | viewer | [BracketView.tsx:50](src/features/bracket/BracketView.tsx:50) | CSS caps (page label) |
| `No tournament has started yet.` | fixed | viewer | [BracketView.tsx:51](src/features/bracket/BracketView.tsx:51) |  |
| `Bracket` | fixed | viewer | [BracketView.tsx:86](src/features/bracket/BracketView.tsx:86) | CSS caps (page label) |
| `Follow a player` | fixed | viewer | [BracketView.tsx:89](src/features/bracket/BracketView.tsx:89) |  |
| `Follow a player or team…` | fixed | viewer | [BracketView.tsx:94](src/features/bracket/BracketView.tsx:94) |  |
| `is already drawn. Next Round re-draws it from this round's results.` | fixed | admin | [BracketView.tsx:132](src/features/bracket/BracketView.tsx:132) |  |
| `is already drawn and locked. Next Round returns to it unchanged; a correction here won't change its draw.` | fixed | admin | [BracketView.tsx:133](src/features/bracket/BracketView.tsx:133) |  |
| `Resolve the tie-break above first` | fixed | admin | [BracketView.tsx:142](src/features/bracket/BracketView.tsx:142) |  |
| `Next Round →` | fixed | admin | [BracketView.tsx:145](src/features/bracket/BracketView.tsx:145) |  |
| `← Previous` | fixed | admin | [BracketView.tsx:152](src/features/bracket/BracketView.tsx:152) |  |

### ByeCard.tsx

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `BYE` | fixed | viewer | [ByeCard.tsx:9](src/features/bracket/ByeCard.tsx:9) | CSS caps (badge) |

### ColumnTitleBar.tsx — Round/column title bar (fold buttons, NOW)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{UP TO }{n} GAMES` | built | viewer | [ColumnTitleBar.tsx:7](src/features/bracket/ColumnTitleBar.tsx:7) |  |
| `Fold {title}` | built | viewer | [ColumnTitleBar.tsx:14](src/features/bracket/ColumnTitleBar.tsx:14) |  |
| `NOW` | fixed | viewer | [ColumnTitleBar.tsx:64](src/features/bracket/ColumnTitleBar.tsx:64) |  |

### exit-lines.ts — Generated: lines of the room "exit" pop-up (arrow icon) and of the standings pop-up

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `→ {destinationLabel}` | built | viewer | [exit-lines.ts:35](src/features/bracket/exit-lines.ts:35) |  |
| `→ {destinationLabel}` | built | viewer | [exit-lines.ts:41](src/features/bracket/exit-lines.ts:41) |  |
| `{rank} ★` | built | viewer | [exit-lines.ts:46](src/features/bracket/exit-lines.ts:46) |  |
| `lucky loser? ({spots} spot{∅ / s})` | built | viewer | [exit-lines.ts:53](src/features/bracket/exit-lines.ts:53) | one room size, and tournaments without `cutVersion` |
| `lucky loser? ({min}–{max} spot{∅ / s}, room(s) of {size})` | built | viewer | [exit-lines.ts:30](src/features/bracket/exit-lines.ts:30) | fair cut with several room sizes; "{max} spot(s)" alone when min = max; "room of" for one room, "rooms of" for several |
| `out` | fixed | viewer | [exit-lines.ts:50](src/features/bracket/exit-lines.ts:50) | lower case on screen |
| `→ Room {roomLetter}` | built | viewer | [exit-lines.ts:55](src/features/bracket/exit-lines.ts:55) |  |
| `stay` | fixed | viewer | [exit-lines.ts:58](src/features/bracket/exit-lines.ts:58) | lower case on screen |
| `→ Room {roomLetter}` | built | viewer | [exit-lines.ts:63](src/features/bracket/exit-lines.ts:63) |  |
| `{1st} +{points}` | built | viewer | [exit-lines.ts:77](src/features/bracket/exit-lines.ts:77) |  |
| `{2nd +7.5} … {7th +1} points` | built | viewer | [exit-lines.ts:81](src/features/bracket/exit-lines.ts:81) | the points of that room's own size: a room of 7 in FFA shows 2nd +7.5 … 7th +1 (scaled points); a tournament made before scaled points shows the same list in every room |
| `All` | fixed | viewer | [exit-lines.ts:103](src/features/bracket/exit-lines.ts:103) |  |
| `→ {standingsInline}` | built | viewer | [exit-lines.ts:103](src/features/bracket/exit-lines.ts:103) |  |
| `All` | fixed | viewer | [exit-lines.ts:104](src/features/bracket/exit-lines.ts:104) |  |
| `seeding only, not counted` | fixed | viewer | [exit-lines.ts:104](src/features/bracket/exit-lines.ts:104) |  |
| `All` | fixed | viewer | [exit-lines.ts:108](src/features/bracket/exit-lines.ts:108) |  |
| `→ {destinationLabel}` | built | viewer | [exit-lines.ts:108](src/features/bracket/exit-lines.ts:108) |  |
| `→ {destination}` | built | viewer | [exit-lines.ts:132](src/features/bracket/exit-lines.ts:132) |  |
| `out` | fixed | viewer | [exit-lines.ts:132](src/features/bracket/exit-lines.ts:132) |  |
| `All` | fixed | viewer | [exit-lines.ts:138](src/features/bracket/exit-lines.ts:138) |  |
| `→ {destination}` | built | viewer | [exit-lines.ts:138](src/features/bracket/exit-lines.ts:138) |  |
| `{rankRange} (each group)` | built | viewer | [exit-lines.ts:142](src/features/bracket/exit-lines.ts:142) |  |
| `→ {destination}` | built | viewer | [exit-lines.ts:142](src/features/bracket/exit-lines.ts:142) |  |
| `{cut}+` | built | viewer | [exit-lines.ts:143](src/features/bracket/exit-lines.ts:143) |  |
| `out` | fixed | viewer | [exit-lines.ts:143](src/features/bracket/exit-lines.ts:143) |  |
| `→ {destination}` | built | viewer | [exit-lines.ts:147](src/features/bracket/exit-lines.ts:147) |  |
| `out` | fixed | viewer | [exit-lines.ts:148](src/features/bracket/exit-lines.ts:148) |  |

### exit-text.ts — Generated: round name as a destination

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Round {n}` | built | viewer | [exit-text.ts:5](src/features/bracket/exit-text.ts:5) |  |

### ExitIcon.tsx

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Close` | fixed | viewer | [ExitIcon.tsx:106](src/features/bracket/ExitIcon.tsx:106) |  |

### FinalColumn.tsx — Final column (scores per game)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `wins` | fixed | viewer | [FinalColumn.tsx:29](src/features/bracket/FinalColumn.tsx:29) |  |
| `G` | fixed | viewer | [FinalColumn.tsx:65](src/features/bracket/FinalColumn.tsx:65) |  |
| `📊 Total` | fixed | viewer | [FinalColumn.tsx:69](src/features/bracket/FinalColumn.tsx:69) |  |
| `Game` | fixed | viewer | [FinalColumn.tsx:129](src/features/bracket/FinalColumn.tsx:129) | CSS caps (label) |
| `— enter scores` | fixed | admin | [FinalColumn.tsx:129](src/features/bracket/FinalColumn.tsx:129) | CSS caps (label) |
| `🎭 Anonymous — click to undo` | fixed | admin | [FinalColumn.tsx:143](src/features/bracket/FinalColumn.tsx:143) |  |
| `🎭 Make anonymous` | fixed | admin | [FinalColumn.tsx:143](src/features/bracket/FinalColumn.tsx:143) |  |

### FinalRow.tsx — Final room rows

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `G` | fixed | viewer | [FinalRow.tsx:44](src/features/bracket/FinalRow.tsx:44) |  |
| `G` | fixed | viewer | [FinalRow.tsx:82](src/features/bracket/FinalRow.tsx:82) |  |
| `WINS` | fixed | viewer | [FinalRow.tsx:85](src/features/bracket/FinalRow.tsx:85) |  |
| `TOTAL` | fixed | viewer | [FinalRow.tsx:85](src/features/bracket/FinalRow.tsx:85) |  |
| `Games won` | fixed | viewer | [FinalRow.tsx:135](src/features/bracket/FinalRow.tsx:135) |  |
| `Cumulative Final score` | fixed | viewer | [FinalRow.tsx:135](src/features/bracket/FinalRow.tsx:135) |  |
| `Scored anonymously — see side panel →` | fixed | both | [FinalRow.tsx:141](src/features/bracket/FinalRow.tsx:141) |  |

### FinishReminder.tsx — Green reminder bar to finish the tournament

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Only admins see this` | fixed | admin | [FinishReminder.tsx:23](src/features/bracket/FinishReminder.tsx:23) |  |
| `Working…` | fixed | admin | [FinishReminder.tsx:25](src/features/bracket/FinishReminder.tsx:25) |  |
| `Finish tournament` | fixed | admin | [FinishReminder.tsx:25](src/features/bracket/FinishReminder.tsx:25) |  |

### folded-round.ts — Generated: summary lines of a folded (collapsed) round

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Bye` | fixed | viewer | [folded-round.ts:57](src/features/bracket/folded-round.ts:57) |  |
| `Bye` | fixed | viewer | [folded-round.ts:61](src/features/bracket/folded-round.ts:61) |  |
| `Room {letter}` | built | viewer | [folded-round.ts:63](src/features/bracket/folded-round.ts:63) |  |
| `{room} · {ordinal}` | built | viewer | [folded-round.ts:71](src/features/bracket/folded-round.ts:71) |  |

### FoldedBox.tsx — Collapsed round box

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `DONE` | fixed | viewer | [FoldedBox.tsx:33](src/features/bracket/FoldedBox.tsx:33) |  |
| `Show {title}` | built | viewer | [FoldedBox.tsx:50](src/features/bracket/FoldedBox.tsx:50) |  |

### follow-text.ts — Generated: the line under "Following {name}"

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Group {groupLabel}` | built | viewer | [follow-text.ts:33](src/features/bracket/follow-text.ts:33) |  |
| `{table} · #{rank}` | built | viewer | [follow-text.ts:34](src/features/bracket/follow-text.ts:34) |  |
| `group` | fixed | viewer | [follow-text.ts:48](src/features/bracket/follow-text.ts:48) |  |
| `Group {groupLabel}` | built | viewer | [follow-text.ts:49](src/features/bracket/follow-text.ts:49) |  |
| `· #{rank} in {where}` | built | viewer | [follow-text.ts:50](src/features/bracket/follow-text.ts:50) |  |
| `→ {destinationLabel}` | built | viewer | [follow-text.ts:67](src/features/bracket/follow-text.ts:67) |  |
| `→ {roomTitle}` | built | viewer | [follow-text.ts:70](src/features/bracket/follow-text.ts:70) |  |
| `stays` | fixed | viewer | [follow-text.ts:72](src/features/bracket/follow-text.ts:72) |  |
| `out` | fixed | viewer | [follow-text.ts:74](src/features/bracket/follow-text.ts:74) |  |
| `· lucky loser?` | fixed | viewer | [follow-text.ts:76](src/features/bracket/follow-text.ts:76) |  |
| `Not in this bracket` | fixed | viewer | [follow-text.ts:94](src/features/bracket/follow-text.ts:94) |  |
| `Out in {roundName}` | built | viewer | [follow-text.ts:106](src/features/bracket/follow-text.ts:106) |  |
| `{roundName} · Bye` | built | viewer | [follow-text.ts:106](src/features/bracket/follow-text.ts:106) |  |
| `{roundName} · {roomTitle}` | built | viewer | [follow-text.ts:108](src/features/bracket/follow-text.ts:108) |  |
| `Out in {outAtStandings}` | built | viewer | [follow-text.ts:111](src/features/bracket/follow-text.ts:111) |  |
| `{where}{standingsSuffix}` | built | viewer | [follow-text.ts:113](src/features/bracket/follow-text.ts:113) |  |
| `· {ordinal}` | built | viewer | [follow-text.ts:116](src/features/bracket/follow-text.ts:116) |  |
| `Out in {where}{placeText}` | built | viewer | [follow-text.ts:117](src/features/bracket/follow-text.ts:117) |  |
| `→ {roomTitle}` | built | viewer | [follow-text.ts:122](src/features/bracket/follow-text.ts:122) |  |
| `{where}{placeText}{next}` | built | viewer | [follow-text.ts:124](src/features/bracket/follow-text.ts:124) |  |
| `#{rank} · {standingsDestination}` | built | viewer | [follow-text.ts:134](src/features/bracket/follow-text.ts:134) |  |
| `Not in these standings` | fixed | viewer | [follow-text.ts:145](src/features/bracket/follow-text.ts:145) |  |
| `→ {destination}` | built | viewer | [follow-text.ts:156](src/features/bracket/follow-text.ts:156) |  |
| `out` | fixed | viewer | [follow-text.ts:158](src/features/bracket/follow-text.ts:158) |  |
| `→ {destinationLabel}` | built | viewer | [follow-text.ts:159](src/features/bracket/follow-text.ts:159) |  |

### FollowBanner.tsx — Following banner

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Following` | fixed | viewer | [FollowBanner.tsx:14](src/features/bracket/FollowBanner.tsx:14) | CSS caps (banner) |

### PhaseBadge.tsx — TEMPORARY / FINAL tag on a round

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `TEMPORARY` | fixed | viewer | [PhaseBadge.tsx:15](src/features/bracket/PhaseBadge.tsx:15) |  |
| `FINAL` | fixed | viewer | [PhaseBadge.tsx:15](src/features/bracket/PhaseBadge.tsx:15) |  |

### PlaceholderRound.tsx — Rounds not yet drawn

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Not yet seeded` | fixed | viewer | [PlaceholderRound.tsx:63](src/features/bracket/PlaceholderRound.tsx:63) |  |
| `Pairings determined live` | fixed | viewer | [PlaceholderRound.tsx:129](src/features/bracket/PlaceholderRound.tsx:129) |  |

### room-title.ts — Generated: room card titles (Room A, Semi B, Group A · Room B, Final)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Final` | fixed | viewer | [room-title.ts:16](src/features/bracket/room-title.ts:16) | CSS caps (room header) |
| `Semi {letter}` | built | viewer | [room-title.ts:17](src/features/bracket/room-title.ts:17) | CSS caps (room header) |
| `Group {groupLetter} · Room {letter}` | built | viewer | [room-title.ts:18](src/features/bracket/room-title.ts:18) | CSS caps (room header) |
| `Room {letter}` | built | viewer | [room-title.ts:19](src/features/bracket/room-title.ts:19) | CSS caps (room header) |

### RoomCard.tsx — Room card header and exit-icon label

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `SCORE` | fixed | viewer | [RoomCard.tsx:22](src/features/bracket/RoomCard.tsx:22) |  |
| `PTS` | fixed | viewer | [RoomCard.tsx:23](src/features/bracket/RoomCard.tsx:23) |  |
| `Where players go from {title}` | built | viewer | [RoomCard.tsx:64](src/features/bracket/RoomCard.tsx:64) |  |

### RoomRow.tsx — A player/team row of a room

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `⚖ TB` | fixed | viewer | [RoomRow.tsx:65](src/features/bracket/RoomRow.tsx:65) | CSS caps (badge) |
| `⚠ TB?` | fixed | viewer | [RoomRow.tsx:70](src/features/bracket/RoomRow.tsx:70) | CSS caps (badge) |
| `No opponent — treated as a bye, no score needed` | fixed | admin | [RoomRow.tsx:95](src/features/bracket/RoomRow.tsx:95) |  |
| `Total` | fixed | viewer | [RoomRow.tsx:174](src/features/bracket/RoomRow.tsx:174) |  |

### RoundBody.tsx

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Nobody reached this round.` | fixed | viewer | [RoundBody.tsx:44](src/features/bracket/RoundBody.tsx:44) |  |

### RoundNotes.tsx — Lucky loser race box under a round

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `★ LUCKY LOSER RACE ·` | fixed | viewer | [RoundNotes.tsx:27](src/features/bracket/RoundNotes.tsx:27) | one room size, and tournaments without `cutVersion` |
| `★ {ROOM / ROOMS} OF {size} · {min–max / max} {SPOT / SPOTS}` | built | viewer | [RoundNotes.tsx:91](src/features/bracket/RoundNotes.tsx:91) | fair cut with several room sizes, one list per size with spots |
| `spare cut?` | fixed | viewer | [RoundNotes.tsx:101](src/features/bracket/RoundNotes.tsx:101) | tag on the unit in line for a spare cut |
| `SPOT` | fixed | viewer | [RoundNotes.tsx:27](src/features/bracket/RoundNotes.tsx:27) |  |
| `SPOTS` | fixed | viewer | [RoundNotes.tsx:27](src/features/bracket/RoundNotes.tsx:27) |  |
| `Room` | fixed | viewer | [RoundNotes.tsx:33](src/features/bracket/RoundNotes.tsx:33) |  |

### RowMarks.tsx — Marks on a row set by the organiser

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Set by organiser` | fixed | viewer | [RowMarks.tsx:6](src/features/bracket/RowMarks.tsx:6) | CSS caps (badge) |

### ScoreFields.tsx — Score entry labels

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `G` | fixed | viewer | [ScoreFields.tsx:88](src/features/bracket/ScoreFields.tsx:88) |  |
| `Total` | fixed | viewer | [ScoreFields.tsx:100](src/features/bracket/ScoreFields.tsx:100) |  |

### StandingsColumn.tsx — Standings column inside the Bracket

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Where players go from {inline}` | built | viewer | [StandingsColumn.tsx:123](src/features/bracket/StandingsColumn.tsx:123) |  |
| `Standings start after Round` | fixed | viewer | [StandingsColumn.tsx:144](src/features/bracket/StandingsColumn.tsx:144) |  |
| `Full table →` | fixed | viewer | [StandingsColumn.tsx:152](src/features/bracket/StandingsColumn.tsx:152) |  |

### still-playing.ts — Generated: "Rooms B and C still playing."

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Room {letter} still playing.` | built | viewer | [still-playing.ts:22](src/features/bracket/still-playing.ts:22) |  |
| `Rooms {letters joined by ", "} and {last letter} still playing.` | built | viewer | [still-playing.ts:24](src/features/bracket/still-playing.ts:24) |  |

### team-member-line.ts — Generated: team member line in a room

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{memberName}{ 🛡 / ∅}` | built | viewer | [team-member-line.ts:16](src/features/bracket/team-member-line.ts:16) |  |
| `{label} {total}` | built | viewer | [team-member-line.ts:68](src/features/bracket/team-member-line.ts:68) |  |

### TieBanners.tsx — Tie-break banners

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{formatStandingValue} pts` | built | viewer | [TieBanners.tsx:20](src/features/bracket/TieBanners.tsx:20) |  |
| `⚠ Tie-break required — Room {roomLetter} (score {score})` | built | admin | [TieBanners.tsx:22](src/features/bracket/TieBanners.tsx:22) |  |
| `⚖ Group {groupLabel} qualification tie at the cut-off ({cutoffValue})` | built | viewer | [TieBanners.tsx:24](src/features/bracket/TieBanners.tsx:24) |  |
| `⚖ Qualification tie between {boundaryText} ({cutoffValue})` | built | viewer | [TieBanners.tsx:26](src/features/bracket/TieBanners.tsx:26) |  |
| `⚖ Qualification tie at the cut-off ({cutoffValue})` | built | viewer | [TieBanners.tsx:27](src/features/bracket/TieBanners.tsx:27) |  |
| `Ranked so far: {names joined by " > "} —` | built | viewer | [TieBanners.tsx:47](src/features/bracket/TieBanners.tsx:47) |  |
| `— pick who ranks next` | fixed | admin | [TieBanners.tsx:49](src/features/bracket/TieBanners.tsx:49) |  |
| `ranks next` | fixed | viewer | [TieBanners.tsx:61](src/features/bracket/TieBanners.tsx:61) |  |

### LuckyStar.tsx — Star next to a lucky-loser candidate (tooltip)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Lucky loser candidate` | fixed | viewer | [LuckyStar.tsx:3](src/features/tournament/components/LuckyStar.tsx:3) |  |
| `Lucky loser` | fixed | viewer | [LuckyStar.tsx:3](src/features/tournament/components/LuckyStar.tsx:3) |  |

## 4. Standings tab (named Qualification / Swiss / Groups)

The Standings tab. Its tab name, heading label and explanation title are chosen by pooling phase (`standings-names.ts`). Only shown when the format has a table.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Progress sentence | [standings-text.ts:8](src/features/standings/standings-text.ts:8) | Standings start after Round 2. · After 3 of 5 rounds. · These are the final standings. |
| Points sentence (standard, scaled points) | [standings-text.ts:47](src/features/standings/standings-text.ts:47) | Each counted round, your place in your room earns points: 1st = 10, 2nd = 8, 3rd = 6, 4th = 5, 5th = 4, 6th = 3, 7th = 2, 8th = 1. In a room of 7: 1st = 10, 2nd = 7.5, 3rd = 5.5, 4th = 4.5, 5th = 3.5, 6th = 2, 7th = 1 (places spread evenly between first and last). |
| Points sentence (standard, tournament made before scaled points) | [standings-text.ts:55](src/features/standings/standings-text.ts:55) | Each counted round, your place in your room earns points: 1st = 8, 2nd = 7, …, 8th = 1, whatever the size of your room. |
| Points sentence (custom table / 1v1) | [standings-text.ts:22](src/features/standings/standings-text.ts:22) | Each counted round, your place in your room earns points from the organiser's table: 1st = 10, 2nd = 8, … · Each counted round, a win earns 3 points and a loss 1. |
| Non-counting rounds | [standings-text.ts:36](src/features/standings/standings-text.ts:36) | A bye counts as a win; a missed round earns 0. Round 1 doesn't count. / Rounds 1–2 don't count. |
| Cut sentence | [standings-text.ts:44](src/features/standings/standings-text.ts:44) | Points are added up; most points ranks first. The top 16 go through. (final: qualified; groups: "The top 2 of each group go through."; none: "Everyone goes through." / "Everyone qualified.") |
| Tie-break | [standings-text.ts:62](src/features/standings/standings-text.ts:62) | On equal points, the tie-break is how you scored compared with your rooms' average (100% = an average score in your room). |
| Table cells | [standings-text.ts:75](src/features/standings/standings-text.ts:75) | Bye · 147% · — · 0 (a missed round) |

### standings-names.ts — The three names of the Standings tab (tab, heading, explanation title, inline)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Qualification` | fixed | viewer | [standings-names.ts:13](src/features/standings/standings-names.ts:13) | CSS caps (page label, column title) |
| `How qualification works` | fixed | viewer | [standings-names.ts:13](src/features/standings/standings-names.ts:13) | CSS caps (box title) |
| `qualification` | fixed | viewer | [standings-names.ts:13](src/features/standings/standings-names.ts:13) |  |
| `Swiss` | fixed | viewer | [standings-names.ts:14](src/features/standings/standings-names.ts:14) | CSS caps (page label, column title) |
| `Swiss` | fixed | viewer | [standings-names.ts:14](src/features/standings/standings-names.ts:14) | CSS caps (page label, column title) |
| `How the Swiss stage works` | fixed | viewer | [standings-names.ts:14](src/features/standings/standings-names.ts:14) | CSS caps (box title) |
| `Groups` | fixed | viewer | [standings-names.ts:15](src/features/standings/standings-names.ts:15) | CSS caps (page label, column title) |
| `How the group stage works` | fixed | viewer | [standings-names.ts:15](src/features/standings/standings-names.ts:15) | CSS caps (box title) |
| `groups` | fixed | viewer | [standings-names.ts:15](src/features/standings/standings-names.ts:15) |  |

### standings-text.ts — Generated: the explanation box and the table cells

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Standings start after Round {firstCountedRoundNum}.` | built | viewer | [standings-text.ts:9](src/features/standings/standings-text.ts:9) |  |
| `These are the final standings.` | fixed | viewer | [standings-text.ts:10](src/features/standings/standings-text.ts:10) |  |
| `After {roundsDone} of {roundsTotal} rounds.` | built | viewer | [standings-text.ts:11](src/features/standings/standings-text.ts:11) |  |
| `Each counted round, a win earns {win points} points and a loss {loss points}.` | built | viewer | [standings-text.ts:26](src/features/standings/standings-text.ts:26) |  |
| `{ordinal} = {value}` | built | viewer | [standings-text.ts:27](src/features/standings/standings-text.ts:27) |  |
| `Each counted round, your place in your room earns points from the organiser's table: {places}.` | built | viewer | [standings-text.ts:52](src/features/standings/standings-text.ts:52) | tournament without `pointsVersion` |
| `, whatever the size of your room` | fixed | viewer | [standings-text.ts:54](src/features/standings/standings-text.ts:54) | tournament without `pointsVersion`, rooms of different sizes |
| `Each counted round, your place in your room earns points: {places}{sizeNote}.` | built | viewer | [standings-text.ts:55](src/features/standings/standings-text.ts:55) | tournament without `pointsVersion` |
| `Each counted round, your place in your room earns points{ from the organiser's table / ∅}: {places}.` | built | viewer | [standings-text.ts:47](src/features/standings/standings-text.ts:47) | tournament with `pointsVersion` 2 (scaled points); places of the largest room |
| `In a room of {size}: {places} (places spread evenly between first and last).` | built | viewer | [standings-text.ts:33](src/features/standings/standings-text.ts:33) | `pointsVersion` 2: one sentence per smaller room size of the counted rounds, after the sentence above |
| `Round {n} doesn't count.` | built | viewer | [standings-text.ts:40](src/features/standings/standings-text.ts:40) |  |
| `Rounds {first}–{last} don't count.` | built | viewer | [standings-text.ts:41](src/features/standings/standings-text.ts:41) |  |
| `go through` | fixed | viewer | [standings-text.ts:46](src/features/standings/standings-text.ts:46) |  |
| `Everyone qualified.` | fixed | viewer | [standings-text.ts:47](src/features/standings/standings-text.ts:47) |  |
| `Everyone goes through.` | fixed | viewer | [standings-text.ts:47](src/features/standings/standings-text.ts:47) |  |
| `The top {cut} of each group {verb}.` | built | viewer | [standings-text.ts:48](src/features/standings/standings-text.ts:48) |  |
| `The top {cut} {verb}.` | built | viewer | [standings-text.ts:48](src/features/standings/standings-text.ts:48) |  |
| `A bye counts as a win; a missed round earns 0.` | fixed | viewer | [standings-text.ts:59](src/features/standings/standings-text.ts:59) |  |
| `Points are added up; most points ranks first. {cutSentence}` | built | viewer | [standings-text.ts:60](src/features/standings/standings-text.ts:60) |  |
| `On equal points, the tie-break is how you scored compared with your rooms' average (100% = an average score in your room).` | fixed | viewer | [standings-text.ts:61](src/features/standings/standings-text.ts:61) |  |
| `Bye` | fixed | viewer | [standings-text.ts:77](src/features/standings/standings-text.ts:77) |  |
| `{percent}%` | built | viewer | [standings-text.ts:87](src/features/standings/standings-text.ts:87) |  |

### StandingsTable.tsx — Standings table headers and tie marks

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Placed by a cut-off tie-break` | fixed | viewer | [StandingsTable.tsx:28](src/features/standings/StandingsTable.tsx:28) |  |
| `Tied at the cut-off: tie-break needed` | fixed | viewer | [StandingsTable.tsx:34](src/features/standings/StandingsTable.tsx:34) |  |
| `⚠ TB?` | fixed | viewer | [StandingsTable.tsx:35](src/features/standings/StandingsTable.tsx:35) | CSS caps (badge) |
| `Pos` | fixed | viewer | [StandingsTable.tsx:55](src/features/standings/StandingsTable.tsx:55) | CSS caps (table header) |
| `Round` | fixed | viewer | [StandingsTable.tsx:63](src/features/standings/StandingsTable.tsx:63) | CSS caps (table header) |
| `Points` | fixed | viewer | [StandingsTable.tsx:68](src/features/standings/StandingsTable.tsx:68) | CSS caps (table header) |
| `Tie-break` | fixed | viewer | [StandingsTable.tsx:71](src/features/standings/StandingsTable.tsx:71) | CSS caps (table header) |
| `Score` | fixed | viewer | [StandingsTable.tsx:76](src/features/standings/StandingsTable.tsx:76) | CSS caps (table header) |
| `Rank` | fixed | viewer | [StandingsTable.tsx:76](src/features/standings/StandingsTable.tsx:76) | CSS caps (table header) |
| `Pts` | fixed | viewer | [StandingsTable.tsx:76](src/features/standings/StandingsTable.tsx:76) | CSS caps (table header) |

### StandingsView.tsx — Standings page

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `No standings table for this tournament format — check Bracket for live results.` | fixed | viewer | [StandingsView.tsx:25](src/features/standings/StandingsView.tsx:25) |  |

### TournamentStandings.tsx — Standings table section

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Where players go from {label}` | built | viewer | [TournamentStandings.tsx:32](src/features/standings/TournamentStandings.tsx:32) |  |
| `Player` | fixed | viewer | [TournamentStandings.tsx:52](src/features/standings/TournamentStandings.tsx:52) | CSS caps (table header) |

## 5. Rankings / Players tab

Rankings after the start, Players before it. The organiser tools at the bottom (admin only) use browser `prompt()` / `confirm()` boxes; their text is listed too.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Registered line (before start) | [players-line.ts:11](src/features/rankings/players-line.ts:11) | 37 players registered so far · starts Sat 18 Oct, 20:00 CEST · 13 teams registered so far · 1 player registered so far |
| Where a unit is | [ranking-where.ts:28](src/features/rankings/ranking-where.ts:28) | Quarters · Room B · 2nd · Waiting for Semis · Round 3 · Bye · Final · 1st |
| Where an eliminated unit went out | [ranking-where.ts:46](src/features/rankings/ranking-where.ts:46) | Quarters · Room B · 7th · Qualification · #25 · Swiss · #25 · Group B · #3 · Withdrawn |
| Podium line | [ranking-podium.ts:46](src/features/rankings/ranking-podium.ts:46) | Final · 429 · Final · 429 over 3 games · Final · 4 games won |
| List counts | [RankingsLists.tsx:159](src/features/rankings/RankingsLists.tsx:159) | 12 PLAYERS (upper-cased) / 12 TEAMS |

### players-line.ts — Generated: "37 players registered so far · starts …"

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Player` | fixed | viewer | [players-line.ts:15](src/features/rankings/players-line.ts:15) |  |
| `Players` | fixed | viewer | [players-line.ts:15](src/features/rankings/players-line.ts:15) |  |
| `{count} {player(s) / team(s)} registered so far` | built | viewer | [players-line.ts:17](src/features/rankings/players-line.ts:17) |  |
| `{registered} · starts {startsAt}` | built | viewer | [players-line.ts:18](src/features/rankings/players-line.ts:18) |  |

### PlayersList.tsx — Players list before the start

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Registered players` | fixed | viewer | [PlayersList.tsx:27](src/features/rankings/PlayersList.tsx:27) |  |
| `Reserves` | fixed | viewer | [PlayersList.tsx:32](src/features/rankings/PlayersList.tsx:32) | CSS caps (column title) |
| `Reserves` | fixed | viewer | [PlayersList.tsx:33](src/features/rankings/PlayersList.tsx:33) | CSS caps (column title) |

### Podium.tsx — Podium

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Podium` | fixed | viewer | [Podium.tsx:48](src/features/rankings/Podium.tsx:48) |  |

### ranking-podium.ts — Generated: podium score lines

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{count} {word}{s}` | built | viewer | [ranking-podium.ts:43](src/features/rankings/ranking-podium.ts:43) |  |
| `{roundName} · {count} game(s) won` | built | viewer | [ranking-podium.ts:48](src/features/rankings/ranking-podium.ts:48) |  |
| `{roundName} · {total}` | built | viewer | [ranking-podium.ts:50](src/features/rankings/ranking-podium.ts:50) |  |
| `{roundName} · {total} over {games} games` | built | viewer | [ranking-podium.ts:50](src/features/rankings/ranking-podium.ts:50) |  |

### ranking-where.ts — Generated: "where" note of each unit in Rankings

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Withdrawn` | fixed | viewer | [ranking-where.ts:14](src/features/rankings/ranking-where.ts:14) |  |
| `{roundName} · {title}` | built | viewer | [ranking-where.ts:20](src/features/rankings/ranking-where.ts:20) |  |
| `Waiting for {destinationLabel}` | built | viewer | [ranking-where.ts:34](src/features/rankings/ranking-where.ts:34) |  |
| `{destinationLabel} · Bye` | built | viewer | [ranking-where.ts:35](src/features/rankings/ranking-where.ts:35) |  |
| `{where} · {ordinal}` | built | viewer | [ranking-where.ts:38](src/features/rankings/ranking-where.ts:38) |  |
| `Group {groupLabel}` | built | viewer | [ranking-where.ts:50](src/features/rankings/ranking-where.ts:50) |  |
| `Standings` | fixed | viewer | [ranking-where.ts:50](src/features/rankings/ranking-where.ts:50) |  |
| `{table} · #{rank}` | built | viewer | [ranking-where.ts:51](src/features/rankings/ranking-where.ts:51) |  |
| `{roundAndRoom} · {ordinal}` | built | viewer | [ranking-where.ts:53](src/features/rankings/ranking-where.ts:53) |  |
| `{destinationLabel} · {ordinal}` | built | viewer | [ranking-where.ts:58](src/features/rankings/ranking-where.ts:58) |  |

### rankings-image.ts — The downloadable rankings image (text drawn on a canvas, not HTML)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `CFP` | fixed | viewer | [rankings-image.ts:45](src/features/rankings/rankings-image.ts:45) |  |
| `CFP` | fixed | viewer | [rankings-image.ts:46](src/features/rankings/rankings-image.ts:46) |  |
| `TOURNAMENT HUB` | fixed | viewer | [rankings-image.ts:48](src/features/rankings/rankings-image.ts:48) |  |
| `FINAL RANKINGS` | fixed | viewer | [rankings-image.ts:94](src/features/rankings/rankings-image.ts:94) |  |
| `LIVE RANKINGS` | fixed | viewer | [rankings-image.ts:94](src/features/rankings/rankings-image.ts:94) |  |
| `Unnamed Tournament` | fixed | viewer | [rankings-image.ts:95](src/features/rankings/rankings-image.ts:95) |  |

### RankingsLists.tsx — Still in / Eliminated lists, podium list

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Standings from fourth place` | fixed | viewer | [RankingsLists.tsx:133](src/features/rankings/RankingsLists.tsx:133) |  |
| `{count} {PLAYERS / TEAMS}` | built | viewer | [RankingsLists.tsx:159](src/features/rankings/RankingsLists.tsx:159) |  |
| `Nobody is still in.` | fixed | viewer | [RankingsLists.tsx:160](src/features/rankings/RankingsLists.tsx:160) |  |
| `Still in` | fixed | viewer | [RankingsLists.tsx:162](src/features/rankings/RankingsLists.tsx:162) | CSS caps (column title) |
| `{count} {PLAYERS / TEAMS}` | built | viewer | [RankingsLists.tsx:165](src/features/rankings/RankingsLists.tsx:165) |  |
| `Nobody is out yet.` | fixed | viewer | [RankingsLists.tsx:166](src/features/rankings/RankingsLists.tsx:166) |  |
| `Eliminated` | fixed | viewer | [RankingsLists.tsx:168](src/features/rankings/RankingsLists.tsx:168) | CSS caps (column title) |

### RankingsRoster.tsx — Organiser tools on Rankings: reserves, swap, rename, remove (browser prompts and confirms included)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `All rooms are full. Adding this reserve will create an over-cap room. Proceed?` | fixed | admin | [RankingsRoster.tsx:33](src/features/rankings/RankingsRoster.tsx:33) |  |
| `Reserve window has closed — eliminations have begun.` | fixed | admin | [RankingsRoster.tsx:40](src/features/rankings/RankingsRoster.tsx:40) |  |
| `Reserves can't be added during Group Stage — group membership and the round-robin schedule are fixed once the tournament starts. To replace a no-show with a reserve, use ⇄ Swap in Manage Players until the first elimination.` | fixed | admin | [RankingsRoster.tsx:42](src/features/rankings/RankingsRoster.tsx:42) |  |
| `Reserves can't be added to a fixed-draw tournament — the whole schedule was already published at generation time, with no mechanism to fold a new entrant into an already-decided future round.` | fixed | admin | [RankingsRoster.tsx:44](src/features/rankings/RankingsRoster.tsx:44) |  |
| `Reserves can't be added to a waterfall bracket — its room-by-room routing table is built for the exact entrant count, so an extra unit has no place in it. To replace a no-show with a reserve, use ⇄ Swap in Manage Players until the first elimination.` | fixed | admin | [RankingsRoster.tsx:46](src/features/rankings/RankingsRoster.tsx:46) |  |
| `Can't add a reserve now — more than one qualifying round has already been played, so a new entrant could never earn a fair standing.` | fixed | admin | [RankingsRoster.tsx:48](src/features/rankings/RankingsRoster.tsx:48) |  |
| `Can't add this reserve — the selected strict odd-count strategy requires every room to remain even.` | fixed | admin | [RankingsRoster.tsx:50](src/features/rankings/RankingsRoster.tsx:50) |  |
| `Can't add this reserve — it would push a future round over the game's hard room cap.` | fixed | admin | [RankingsRoster.tsx:51](src/features/rankings/RankingsRoster.tsx:51) |  |
| `A player with that name is already registered — pick a different name.` | fixed | admin | [RankingsRoster.tsx:52](src/features/rankings/RankingsRoster.tsx:52) |  |
| `Swaps closed — eliminations have started` | fixed | admin | [RankingsRoster.tsx:57](src/features/rankings/RankingsRoster.tsx:57) |  |
| `Can't swap "{unitLabel}" — it isn't in the current round or waiting for a later one.` | built | admin | [RankingsRoster.tsx:67](src/features/rankings/RankingsRoster.tsx:67) |  |
| `Reserve window closed — eliminations have started.` | fixed | admin | [RankingsRoster.tsx:79](src/features/rankings/RankingsRoster.tsx:79) |  |
| `Name of a new or walk-up player` | fixed | admin | [RankingsRoster.tsx:82](src/features/rankings/RankingsRoster.tsx:82) |  |
| `Name of a new/walk-up player` | fixed | admin | [RankingsRoster.tsx:84](src/features/rankings/RankingsRoster.tsx:84) |  |
| `Waiting:` | fixed | admin | [RankingsRoster.tsx:89](src/features/rankings/RankingsRoster.tsx:89) |  |
| `Rename "{name}" to:` | built | admin | [RankingsRoster.tsx:98](src/features/rankings/RankingsRoster.tsx:98) |  |
| `"{value}" is already registered — pick a different name.` | built | admin | [RankingsRoster.tsx:101](src/features/rankings/RankingsRoster.tsx:101) |  |
| `Swap out "{name}". Enter the replacement's name:` | built | admin | [RankingsRoster.tsx:108](src/features/rankings/RankingsRoster.tsx:108) |  |
| `"{value}" is already registered — pick a different name.` | built | admin | [RankingsRoster.tsx:114](src/features/rankings/RankingsRoster.tsx:114) |  |
| `Remove "{name}" from the tournament? This cannot be undone.` | built | admin | [RankingsRoster.tsx:121](src/features/rankings/RankingsRoster.tsx:121) |  |
| `Reserves` | fixed | admin | [RankingsRoster.tsx:138](src/features/rankings/RankingsRoster.tsx:138) | CSS caps (panel title) |
| `Name of a new/walk-up player` | fixed | admin | [RankingsRoster.tsx:149](src/features/rankings/RankingsRoster.tsx:149) |  |
| `＋ Add new player` | fixed | admin | [RankingsRoster.tsx:175](src/features/rankings/RankingsRoster.tsx:175) |  |
| `Add {key}` | built | admin | [RankingsRoster.tsx:187](src/features/rankings/RankingsRoster.tsx:187) |  |
| `Remove {key}` | built | admin | [RankingsRoster.tsx:196](src/features/rankings/RankingsRoster.tsx:196) |  |
| `Click ＋ to add a reserve to the smallest available room.` | fixed | admin | [RankingsRoster.tsx:209](src/features/rankings/RankingsRoster.tsx:209) |  |
| `No {reserve teams / reserves} on the bench.` | built | admin | [RankingsRoster.tsx:210](src/features/rankings/RankingsRoster.tsx:210) |  |
| `Manage players` | fixed | admin | [RankingsRoster.tsx:233](src/features/rankings/RankingsRoster.tsx:233) | CSS caps (panel title) |
| `Rename {name}` | built | admin | [RankingsRoster.tsx:243](src/features/rankings/RankingsRoster.tsx:243) |  |
| `Rename` | fixed | admin | [RankingsRoster.tsx:245](src/features/rankings/RankingsRoster.tsx:245) |  |
| `Swap {name}` | built | admin | [RankingsRoster.tsx:250](src/features/rankings/RankingsRoster.tsx:250) |  |
| `Swap` | fixed | admin | [RankingsRoster.tsx:252](src/features/rankings/RankingsRoster.tsx:252) |  |
| `Remove {name}` | built | admin | [RankingsRoster.tsx:257](src/features/rankings/RankingsRoster.tsx:257) |  |
| `Remove` | fixed | admin | [RankingsRoster.tsx:259](src/features/rankings/RankingsRoster.tsx:259) |  |
| `Manage teams` | fixed | admin | [RankingsRoster.tsx:277](src/features/rankings/RankingsRoster.tsx:277) | CSS caps (panel title) |
| `Rename team {teamName}` | built | admin | [RankingsRoster.tsx:290](src/features/rankings/RankingsRoster.tsx:290) |  |
| `Rename team` | fixed | admin | [RankingsRoster.tsx:293](src/features/rankings/RankingsRoster.tsx:293) |  |
| `Rename team "{teamName}" to:` | built | admin | [RankingsRoster.tsx:295](src/features/rankings/RankingsRoster.tsx:295) |  |
| `A team called "{value}" is already registered — pick a different name.` | built | admin | [RankingsRoster.tsx:299](src/features/rankings/RankingsRoster.tsx:299) |  |
| `Swap team {teamName}` | built | admin | [RankingsRoster.tsx:314](src/features/rankings/RankingsRoster.tsx:314) |  |
| `Swap team` | fixed | admin | [RankingsRoster.tsx:318](src/features/rankings/RankingsRoster.tsx:318) |  |
| `Swap out "{teamName}". 0 — type a brand-new walk-up team {numbered list of reserve teams} Enter a number:` | built | admin | [RankingsRoster.tsx:323](src/features/rankings/RankingsRoster.tsx:323) | browser prompt() |
| `"{choice}" isn't one of the listed numbers.` | built | admin | [RankingsRoster.tsx:332](src/features/rankings/RankingsRoster.tsx:332) |  |
| `Player{n}` | built | admin | [RankingsRoster.tsx:340](src/features/rankings/RankingsRoster.tsx:340) |  |
| `Enter the replacement team, same format as the roster: TeamName, {placeholders}` | built | admin | [RankingsRoster.tsx:343](src/features/rankings/RankingsRoster.tsx:343) |  |
| `Team name, {placeholders}` | built | admin | [RankingsRoster.tsx:344](src/features/rankings/RankingsRoster.tsx:344) |  |
| `"{teamName}" has no players listed — add at least one member.` | built | admin | [RankingsRoster.tsx:355](src/features/rankings/RankingsRoster.tsx:355) |  |
| `A team called "{teamName}" is already registered — pick a different name.` | built | admin | [RankingsRoster.tsx:362](src/features/rankings/RankingsRoster.tsx:362) |  |
| `Remove team {teamName}` | built | admin | [RankingsRoster.tsx:377](src/features/rankings/RankingsRoster.tsx:377) |  |
| `Remove team` | fixed | admin | [RankingsRoster.tsx:380](src/features/rankings/RankingsRoster.tsx:380) |  |
| `Can't remove "{teamName}" — the strict odd-count strategy requires rooms of {ideal} teams.` | built | admin | [RankingsRoster.tsx:391](src/features/rankings/RankingsRoster.tsx:391) |  |
| `Remove team "{teamName}" from the tournament? This cannot be undone.` | built | admin | [RankingsRoster.tsx:398](src/features/rankings/RankingsRoster.tsx:398) |  |
| `Vacant slot` | fixed | admin | [RankingsRoster.tsx:416](src/features/rankings/RankingsRoster.tsx:416) |  |
| `Reserve for {teamName} slot {n}` | built | admin | [RankingsRoster.tsx:422](src/features/rankings/RankingsRoster.tsx:422) |  |
| `— pick a reserve —` | fixed | admin | [RankingsRoster.tsx:433](src/features/rankings/RankingsRoster.tsx:433) |  |
| `Name of the new/walk-up player filling this slot:` | fixed | admin | [RankingsRoster.tsx:446](src/features/rankings/RankingsRoster.tsx:446) |  |
| `＋ New` | fixed | admin | [RankingsRoster.tsx:454](src/features/rankings/RankingsRoster.tsx:454) |  |
| `🛡 Defender` | fixed | admin | [RankingsRoster.tsx:469](src/features/rankings/RankingsRoster.tsx:469) |  |
| `Make {name} defender` | built | admin | [RankingsRoster.tsx:476](src/features/rankings/RankingsRoster.tsx:476) |  |
| `Make defender` | fixed | admin | [RankingsRoster.tsx:479](src/features/rankings/RankingsRoster.tsx:479) |  |
| `Rename {name}` | built | admin | [RankingsRoster.tsx:488](src/features/rankings/RankingsRoster.tsx:488) |  |
| `Rename member` | fixed | admin | [RankingsRoster.tsx:491](src/features/rankings/RankingsRoster.tsx:491) |  |
| `Rename "{name}" to:` | built | admin | [RankingsRoster.tsx:493](src/features/rankings/RankingsRoster.tsx:493) |  |
| `Remove {name}` | built | admin | [RankingsRoster.tsx:508](src/features/rankings/RankingsRoster.tsx:508) |  |
| `Remove member` | fixed | admin | [RankingsRoster.tsx:511](src/features/rankings/RankingsRoster.tsx:511) |  |
| `Remove "{name}" from team "{teamName}"? This cannot be undone.` | built | admin | [RankingsRoster.tsx:516](src/features/rankings/RankingsRoster.tsx:516) |  |

### RankingsView.tsx — Rankings / Players page, organiser tools header

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `No-shows` | fixed | admin | [RankingsView.tsx:18](src/features/rankings/RankingsView.tsx:18) | CSS caps (title) |
| `No-show` | fixed | admin | [RankingsView.tsx:20](src/features/rankings/RankingsView.tsx:20) | CSS caps (badge) |
| `Organiser tools` | fixed | admin | [RankingsView.tsx:34](src/features/rankings/RankingsView.tsx:34) | CSS caps (title) |
| `Only admins see this part` | fixed | admin | [RankingsView.tsx:36](src/features/rankings/RankingsView.tsx:36) |  |
| `No` | fixed | viewer | [RankingsView.tsx:65](src/features/rankings/RankingsView.tsx:65) |  |
| `registered yet — check back once the organiser loads a roster.` | fixed | viewer | [RankingsView.tsx:65](src/features/rankings/RankingsView.tsx:65) |  |
| `Download image` | fixed | viewer | [RankingsView.tsx:92](src/features/rankings/RankingsView.tsx:92) |  |
| `Rankings` | fixed | viewer | [RankingsView.tsx:105](src/features/rankings/RankingsView.tsx:105) | CSS caps (page label) |
| `Players` | fixed | viewer | [RankingsView.tsx:105](src/features/rankings/RankingsView.tsx:105) | CSS caps (page label) |

## 6. Admin tab: tournament list

What an admin sees in the Admin tab before opening a tournament.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Group titles | [tournament-index.ts:86](src/features/tournaments/tournament-index.ts:86) | ONGOING · PUBLISHED · DRAFTS (upper-cased in code) |

### AdminTournamentList.tsx — Admin tab before a tournament is opened

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Unnamed Tournament` | fixed | admin | [AdminTournamentList.tsx:26](src/features/admin/AdminTournamentList.tsx:26) |  |
| `Test run` | fixed | admin | [AdminTournamentList.tsx:27](src/features/admin/AdminTournamentList.tsx:27) | CSS caps (badge) |
| `No date yet` | fixed | admin | [AdminTournamentList.tsx:31](src/features/admin/AdminTournamentList.tsx:31) |  |
| `Test run` | fixed | admin | [AdminTournamentList.tsx:80](src/features/admin/AdminTournamentList.tsx:80) | CSS caps (badge) |
| `Creating…` | fixed | admin | [AdminTournamentList.tsx:84](src/features/admin/AdminTournamentList.tsx:84) |  |
| `New tournament` | fixed | admin | [AdminTournamentList.tsx:84](src/features/admin/AdminTournamentList.tsx:84) |  |
| `Admin` | fixed | admin | [AdminTournamentList.tsx:89](src/features/admin/AdminTournamentList.tsx:89) |  |
| `Loading the tournaments…` | fixed | admin | [AdminTournamentList.tsx:92](src/features/admin/AdminTournamentList.tsx:92) |  |
| `The tournament list is unavailable right now.` | fixed | admin | [AdminTournamentList.tsx:94](src/features/admin/AdminTournamentList.tsx:94) |  |
| `No tournament in preparation yet.` | fixed | admin | [AdminTournamentList.tsx:97](src/features/admin/AdminTournamentList.tsx:97) |  |
| `Finished tournaments are on the` | fixed | admin | [AdminTournamentList.tsx:113](src/features/admin/AdminTournamentList.tsx:113) |  |
| `Tournaments` | fixed | admin | [AdminTournamentList.tsx:118](src/features/admin/AdminTournamentList.tsx:118) |  |
| `page.` | fixed | admin | [AdminTournamentList.tsx:120](src/features/admin/AdminTournamentList.tsx:120) |  |

### tournament-index.ts — Group titles of the Admin list (upper-cased in code)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Ongoing` | fixed | both | [tournament-index.ts:86](src/features/tournaments/tournament-index.ts:86) | CSS caps (upper-cased in code) |
| `Published` | fixed | both | [tournament-index.ts:88](src/features/tournaments/tournament-index.ts:88) | CSS caps (upper-cased in code) |
| `Drafts` | fixed | both | [tournament-index.ts:91](src/features/tournaments/tournament-index.ts:91) | CSS caps (upper-cased in code) |

## 7. Setup (a draft tournament in the Admin tab)

Setup of a draft: TOURNAMENT, FORMAT, ROSTER, SCHEDULE PREVIEW panels, the waterfall graph editor, copy-settings, info-for-visitors. Panel titles are written in capitals in the code.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Roster header | [RosterPanel.tsx:95](src/features/admin/setup/RosterPanel.tsx:95) | Roster — confirmed players, one per line / Roster — confirmed teams, one per line |
| Roster count hint | [RosterPanel.tsx:22](src/features/admin/setup/RosterPanel.tsx:22) | 37 players · 2 reserves · 12 teams · 1 individual reserve · No roster loaded yet |
| Preview rows | [schedule-preview-rows.ts:20](src/features/admin/setup/schedule-preview-rows.ts:20) | up to 3 games · 2 games · 8 · 8 · 8 players · incl. 2 lucky losers · 16 advance |
| Waterfall editor counts | [waterfall-format.ts:59](src/features/admin/waterfall/waterfall-format.ts:59) | ranks 1–2 of each room · ranks differ by room · 24 / 24 (entering / needed) · 3 slots selected · to R2 · 1–2 → Round 2 |
| Presence | [presence.shared.ts:84](src/features/presence/presence.shared.ts:84) | Ada is editing · Ada and Bo are editing · Ada, Bo and Cy are editing |
| Copy result | [CopySettingsPanel.tsx:75](src/features/admin/copy-settings/CopySettingsPanel.tsx:75) | 3 screenshots copied. · 1 screenshot copied. · Copied settings from "{tournament}". |

### CopySettingsPanel.tsx — Setup: Copy settings panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Could not reach the tournament server — check your connection and try again.` | fixed | admin | [CopySettingsPanel.tsx:22](src/features/admin/copy-settings/CopySettingsPanel.tsx:22) |  |
| `Loading the tournaments…` | fixed | admin | [CopySettingsPanel.tsx:25](src/features/admin/copy-settings/CopySettingsPanel.tsx:25) |  |
| `No tournament has been published yet.` | fixed | admin | [CopySettingsPanel.tsx:26](src/features/admin/copy-settings/CopySettingsPanel.tsx:26) |  |
| `The tournament list is unavailable right now.` | fixed | admin | [CopySettingsPanel.tsx:27](src/features/admin/copy-settings/CopySettingsPanel.tsx:27) |  |
| `Select a tournament…` | fixed | admin | [CopySettingsPanel.tsx:42](src/features/admin/copy-settings/CopySettingsPanel.tsx:42) |  |
| `Unnamed Tournament` | fixed | admin | [CopySettingsPanel.tsx:45](src/features/admin/copy-settings/CopySettingsPanel.tsx:45) |  |
| `— {date and time}` | built | admin | [CopySettingsPanel.tsx:46](src/features/admin/copy-settings/CopySettingsPanel.tsx:46) |  |
| `Copy settings` | fixed | admin | [CopySettingsPanel.tsx:52](src/features/admin/copy-settings/CopySettingsPanel.tsx:52) |  |
| `{copied} screenshot{∅ / s} copied.` | built | admin | [CopySettingsPanel.tsx:75](src/features/admin/copy-settings/CopySettingsPanel.tsx:75) |  |
| `The screenshots could not be copied: {error}` | built | admin | [CopySettingsPanel.tsx:77](src/features/admin/copy-settings/CopySettingsPanel.tsx:77) |  |
| `{message}{screenshots sentence}` | built | admin | [CopySettingsPanel.tsx:99](src/features/admin/copy-settings/CopySettingsPanel.tsx:99) |  |
| `Copy settings from another tournament` | fixed | admin | [CopySettingsPanel.tsx:120](src/features/admin/copy-settings/CopySettingsPanel.tsx:120) |  |
| `Choose…` | fixed | admin | [CopySettingsPanel.tsx:123](src/features/admin/copy-settings/CopySettingsPanel.tsx:123) |  |
| `From a published tournament` | fixed | admin | [CopySettingsPanel.tsx:127](src/features/admin/copy-settings/CopySettingsPanel.tsx:127) |  |
| `Tournament link or id` | fixed | admin | [CopySettingsPanel.tsx:130](src/features/admin/copy-settings/CopySettingsPanel.tsx:130) |  |
| `Tournament link or id` | fixed | admin | [CopySettingsPanel.tsx:134](src/features/admin/copy-settings/CopySettingsPanel.tsx:134) |  |
| `Copy settings` | fixed | admin | [CopySettingsPanel.tsx:140](src/features/admin/copy-settings/CopySettingsPanel.tsx:140) |  |

### past-tournament-settings.ts — Copy settings: refusals

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `No tournament with that id on this site. Test and production tournaments are separate.` | fixed | admin | [past-tournament-settings.ts:6](src/features/admin/copy-settings/past-tournament-settings.ts:6) |  |
| `That tournament was created before settings were saved with tournaments, so its settings can't be copied.` | fixed | admin | [past-tournament-settings.ts:8](src/features/admin/copy-settings/past-tournament-settings.ts:8) |  |
| `Paste a tournament link or id.` | fixed | admin | [past-tournament-settings.ts:9](src/features/admin/copy-settings/past-tournament-settings.ts:9) |  |
| `Unnamed Tournament` | fixed | admin | [past-tournament-settings.ts:49](src/features/admin/copy-settings/past-tournament-settings.ts:49) |  |

### InfoContentPanel.tsx — Setup: INFO FOR VISITORS panel (rules, screenshots)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `A blank line starts a paragraph, "- " a list, **bold** for bold, [text](https://address) for a link. Saved when you leave the box.` | fixed | admin | [InfoContentPanel.tsx:12](src/features/admin/InfoContentPanel.tsx:12) |  |
| `Something went wrong. Try again.` | fixed | admin | [InfoContentPanel.tsx:15](src/features/admin/InfoContentPanel.tsx:15) |  |
| `Rules for this tournament` | fixed | admin | [InfoContentPanel.tsx:36](src/features/admin/InfoContentPanel.tsx:36) |  |
| `Specific rules, shown on the Info tab…` | fixed | admin | [InfoContentPanel.tsx:42](src/features/admin/InfoContentPanel.tsx:42) |  |
| `Delete this screenshot?` | fixed | admin | [InfoContentPanel.tsx:79](src/features/admin/InfoContentPanel.tsx:79) |  |
| `Lobby screenshots` | fixed | admin | [InfoContentPanel.tsx:94](src/features/admin/InfoContentPanel.tsx:94) |  |
| `of` | fixed | admin | [InfoContentPanel.tsx:96](src/features/admin/InfoContentPanel.tsx:96) |  |
| `Delete screenshot` | fixed | admin | [InfoContentPanel.tsx:108](src/features/admin/InfoContentPanel.tsx:108) |  |
| `+ Upload` | fixed | admin | [InfoContentPanel.tsx:123](src/features/admin/InfoContentPanel.tsx:123) |  |
| `The limit is reached: delete one to add another.` | fixed | admin | [InfoContentPanel.tsx:140](src/features/admin/InfoContentPanel.tsx:140) |  |
| `Working…` | fixed | admin | [InfoContentPanel.tsx:142](src/features/admin/InfoContentPanel.tsx:142) |  |
| `INFO FOR VISITORS` | fixed | admin | [InfoContentPanel.tsx:151](src/features/admin/InfoContentPanel.tsx:151) |  |

### ScheduledTimeField.tsx — Setup: date/time field

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Scheduled date and time` | fixed | admin | [ScheduledTimeField.tsx:19](src/features/admin/ScheduledTimeField.tsx:19) |  |
| `(your time,` | fixed | admin | [ScheduledTimeField.tsx:19](src/features/admin/ScheduledTimeField.tsx:19) |  |

### format-fields.ts — Setup: option labels

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Adaptive — reseeded live from real results each round` | fixed | admin | [format-fields.ts:12](src/features/admin/setup/format-fields.ts:12) |  |
| `Fixed — full schedule published upfront, no live reseeding` | fixed | admin | [format-fields.ts:13](src/features/admin/setup/format-fields.ts:13) |  |
| `Single — every pair meets once` | fixed | admin | [format-fields.ts:17](src/features/admin/setup/format-fields.ts:17) |  |
| `Double — every pair meets twice` | fixed | admin | [format-fields.ts:18](src/features/admin/setup/format-fields.ts:18) |  |
| `Single game` | fixed | admin | [format-fields.ts:23](src/features/admin/setup/format-fields.ts:23) |  |
| `{games} games (sum)` | built | admin | [format-fields.ts:23](src/features/admin/setup/format-fields.ts:23) |  |

### FormatPanel.tsx — Setup: FORMAT panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Double elimination` | fixed | admin | [FormatPanel.tsx:63](src/features/admin/setup/FormatPanel.tsx:63) |  |
| `Double elimination — FFA/Team` | fixed | admin | [FormatPanel.tsx:64](src/features/admin/setup/FormatPanel.tsx:64) |  |
| `None — standard elimination from R1` | fixed | admin | [FormatPanel.tsx:73](src/features/admin/setup/FormatPanel.tsx:73) |  |
| `Qualification Table — R1/R2/R3 feed cumulative table` | fixed | admin | [FormatPanel.tsx:74](src/features/admin/setup/FormatPanel.tsx:74) |  |
| `Swiss — fold-paired rounds feed cumulative standings` | fixed | admin | [FormatPanel.tsx:77](src/features/admin/setup/FormatPanel.tsx:77) |  |
| `Group Stage — round-robin groups, top finishers advance` | fixed | admin | [FormatPanel.tsx:78](src/features/admin/setup/FormatPanel.tsx:78) |  |
| `FORMAT` | fixed | admin | [FormatPanel.tsx:127](src/features/admin/setup/FormatPanel.tsx:127) |  |
| `Game format` | fixed | admin | [FormatPanel.tsx:129](src/features/admin/setup/FormatPanel.tsx:129) |  |
| `Schedule logic` | fixed | admin | [FormatPanel.tsx:142](src/features/admin/setup/FormatPanel.tsx:142) |  |
| `Single elimination` | fixed | admin | [FormatPanel.tsx:148](src/features/admin/setup/FormatPanel.tsx:148) |  |
| `Kings Valley` | fixed | admin | [FormatPanel.tsx:154](src/features/admin/setup/FormatPanel.tsx:154) |  |
| `Waterfall bracket (organiser-authored)` | fixed | admin | [FormatPanel.tsx:155](src/features/admin/setup/FormatPanel.tsx:155) |  |
| `Team scoring` | fixed | admin | [FormatPanel.tsx:159](src/features/admin/setup/FormatPanel.tsx:159) |  |
| `Pooling phase` | fixed | admin | [FormatPanel.tsx:173](src/features/admin/setup/FormatPanel.tsx:173) |  |
| `Draw publication` | fixed | admin | [FormatPanel.tsx:187](src/features/admin/setup/FormatPanel.tsx:187) |  |
| `Every round's room assignment is fixed at generation time from roster order, with rematch avoidance where mathematically possible — never adjusted based on live scores. Reserves can't be added once a tournament starts in this mode.` | fixed | admin | [FormatPanel.tsx:198](src/features/admin/setup/FormatPanel.tsx:198) |  |
| `Group size` | fixed | admin | [FormatPanel.tsx:207](src/features/admin/setup/FormatPanel.tsx:207) |  |
| `Round-robin` | fixed | admin | [FormatPanel.tsx:217](src/features/admin/setup/FormatPanel.tsx:217) |  |
| `Qualifiers per group` | fixed | admin | [FormatPanel.tsx:227](src/features/admin/setup/FormatPanel.tsx:227) |  |
| `Advance to bracket` | fixed | admin | [FormatPanel.tsx:241](src/features/admin/setup/FormatPanel.tsx:241) |  |
| `{derivedAdvance}, set by the waterfall graph` | built | admin | [FormatPanel.tsx:244](src/features/admin/setup/FormatPanel.tsx:244) |  |
| `not set yet — route ranks of the qualification table in the waterfall graph below` | fixed | admin | [FormatPanel.tsx:245](src/features/admin/setup/FormatPanel.tsx:245) |  |
| `Advance to bracket` | fixed | admin | [FormatPanel.tsx:249](src/features/admin/setup/FormatPanel.tsx:249) |  |
| `Non-counting rounds (optional)` | fixed | admin | [FormatPanel.tsx:259](src/features/admin/setup/FormatPanel.tsx:259) |  |
| `Odd-count strategy` | fixed | admin | [FormatPanel.tsx:272](src/features/admin/setup/FormatPanel.tsx:272) |  |
| `Scoring system` | fixed | admin | [FormatPanel.tsx:288](src/features/admin/setup/FormatPanel.tsx:288) |  |
| `Standard points (FFA: 10, 8, 6, 5, 4, 3, 2, 1; other formats: 1st = largest room size, −1 per place; smaller rooms scaled)` | fixed | admin | [scoring.ts:232](src/domain/tournament/scoring.ts:232) | option of the scoring field (also the Admin recap value); wording to be reviewed by the organiser |
| `Custom points table` | fixed | admin | [scoring.ts:233](src/domain/tournament/scoring.ts:233) | option of the scoring field (also the Admin recap value) |
| `Custom points table` | fixed | admin | [FormatPanel.tsx:303](src/features/admin/setup/FormatPanel.tsx:303) |  |
| `— one entry per rank, highest rank first, e.g. "10,8,6,5,4,3,2,1"` | fixed | admin | [FormatPanel.tsx:305](src/features/admin/setup/FormatPanel.tsx:305) |  |
| `e.g. 10,8,6,5,4,3,2,1` | fixed | admin | [FormatPanel.tsx:313](src/features/admin/setup/FormatPanel.tsx:313) |  |
| `Points must not increase from rank to rank, and the table needs at least one entry per unit in the largest room this format can produce — points are summed across every counted round. A smaller room reads the table scaled to its size: 1st and last place keep the table's first and last points, the places between are spread evenly, in half points.` | fixed | admin | [FormatPanel.tsx:307](src/features/admin/setup/FormatPanel.tsx:307) |  |
| `Scoring system` | fixed | admin | [FormatPanel.tsx:325](src/features/admin/setup/FormatPanel.tsx:325) |  |
| `Finals format` | fixed | admin | [FormatPanel.tsx:332](src/features/admin/setup/FormatPanel.tsx:332) |  |
| `Grand Final — wins needed to take the title` | fixed | admin | [FormatPanel.tsx:350](src/features/admin/setup/FormatPanel.tsx:350) |  |
| `Winners bracket target` | fixed | admin | [FormatPanel.tsx:358](src/features/admin/setup/FormatPanel.tsx:358) |  |
| `Losers bracket target` | fixed | admin | [FormatPanel.tsx:366](src/features/admin/setup/FormatPanel.tsx:366) |  |
| `Semis size override (optional)` | fixed | admin | [FormatPanel.tsx:377](src/features/admin/setup/FormatPanel.tsx:377) |  |
| `derived` | fixed | admin | [FormatPanel.tsx:382](src/features/admin/setup/FormatPanel.tsx:382) |  |
| `Semis format` | fixed | admin | [FormatPanel.tsx:387](src/features/admin/setup/FormatPanel.tsx:387) |  |
| `LB qualifiers into the Final` | fixed | admin | [FormatPanel.tsx:403](src/features/admin/setup/FormatPanel.tsx:403) |  |
| `Final size override (optional)` | fixed | admin | [FormatPanel.tsx:414](src/features/admin/setup/FormatPanel.tsx:414) |  |
| `derived` | fixed | admin | [FormatPanel.tsx:419](src/features/admin/setup/FormatPanel.tsx:419) |  |
| `Advanced round overrides` | fixed | admin | [FormatPanel.tsx:431](src/features/admin/setup/FormatPanel.tsx:431) |  |
| `Qualification Table round count override` | fixed | admin | [FormatPanel.tsx:437](src/features/admin/setup/FormatPanel.tsx:437) |  |
| `derived` | fixed | admin | [FormatPanel.tsx:444](src/features/admin/setup/FormatPanel.tsx:444) |  |
| `Swiss round count override` | fixed | admin | [FormatPanel.tsx:451](src/features/admin/setup/FormatPanel.tsx:451) |  |
| `derived` | fixed | admin | [FormatPanel.tsx:457](src/features/admin/setup/FormatPanel.tsx:457) |  |
| `Elimination round targets` | fixed | admin | [FormatPanel.tsx:469](src/features/admin/setup/FormatPanel.tsx:469) |  |
| `— ordered survivor counts, can repeat if a round eliminates no one, e.g. "24,24,12,6"` | fixed | admin | [FormatPanel.tsx:471](src/features/admin/setup/FormatPanel.tsx:471) |  |
| `e.g. 24,24,12,6` | fixed | admin | [FormatPanel.tsx:479](src/features/admin/setup/FormatPanel.tsx:479) |  |
| `The list is the whole winners bracket and must end at the Final's winners-bracket share (Final size − LB qualifiers` | fixed | admin | [FormatPanel.tsx:485](src/features/admin/setup/FormatPanel.tsx:485) |  |
| `, currently {sharedFinalShare}` | built | admin | [FormatPanel.tsx:487](src/features/admin/setup/FormatPanel.tsx:487) |  |
| `Elimination seeding overrides` | fixed | admin | [FormatPanel.tsx:495](src/features/admin/setup/FormatPanel.tsx:495) |  |
| `— one per target above, comma-separated; leave an entry blank for automatic` | fixed | admin | [FormatPanel.tsx:497](src/features/admin/setup/FormatPanel.tsx:497) |  |
| `e.g. ,diversity,balance` | fixed | admin | [FormatPanel.tsx:507](src/features/admin/setup/FormatPanel.tsx:507) |  |
| `set round targets above first` | fixed | admin | [FormatPanel.tsx:508](src/features/admin/setup/FormatPanel.tsx:508) |  |
| `Options:` | fixed | admin | [FormatPanel.tsx:515](src/features/admin/setup/FormatPanel.tsx:515) |  |
| `diversity` | fixed | admin | [FormatPanel.tsx:515](src/features/admin/setup/FormatPanel.tsx:515) |  |
| `(spread players who've faced each other into different rooms),` | fixed | admin | [FormatPanel.tsx:515](src/features/admin/setup/FormatPanel.tsx:515) |  |
| `balance` | fixed | admin | [FormatPanel.tsx:516](src/features/admin/setup/FormatPanel.tsx:516) |  |
| `(balance apparent skill/seed across rooms),` | fixed | admin | [FormatPanel.tsx:516](src/features/admin/setup/FormatPanel.tsx:516) |  |
| `random` | fixed | admin | [FormatPanel.tsx:517](src/features/admin/setup/FormatPanel.tsx:517) |  |
| `(shuffle rooms, ignoring both history and skill). Blank keeps the automatic taper for that round.` | fixed | admin | [FormatPanel.tsx:517](src/features/admin/setup/FormatPanel.tsx:517) |  |
| `▶ Generate Schedule` | fixed | admin | [FormatPanel.tsx:533](src/features/admin/setup/FormatPanel.tsx:533) |  |

### plural.ts — Helper that builds "{count} {noun}(s)"

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{count} {noun / plural noun}` | built | admin | [plural.ts:3](src/features/admin/setup/plural.ts:3) |  |

### roster-status.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{confirmed} confirmed` | built | admin | [roster-status.ts:5](src/features/admin/setup/roster-status.ts:5) |  |
| `individual reserve` | fixed | admin | [roster-status.ts:6](src/features/admin/setup/roster-status.ts:6) |  |

### RosterPanel.tsx — Setup: ROSTER panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `No roster loaded yet` | fixed | admin | [RosterPanel.tsx:20](src/features/admin/setup/RosterPanel.tsx:20) |  |
| `{count} {players / teams}{ · n reserve(s)}` | built | admin | [RosterPanel.tsx:22](src/features/admin/setup/RosterPanel.tsx:22) |  |
| `These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line: {team names, one per line}` | built | admin | [RosterPanel.tsx:51](src/features/admin/setup/RosterPanel.tsx:51) |  |
| `These team name(s) are used more than once across the roster and reserves — every team needs a unique name: {names, one per line}` | built | admin | [RosterPanel.tsx:58](src/features/admin/setup/RosterPanel.tsx:58) |  |
| `These name(s) are used more than once across the roster and reserves — every player needs a unique name: {names, one per line}` | built | admin | [RosterPanel.tsx:77](src/features/admin/setup/RosterPanel.tsx:77) |  |
| `ROSTER` | fixed | admin | [RosterPanel.tsx:94](src/features/admin/setup/RosterPanel.tsx:94) |  |
| `Roster — confirmed {players / teams}, one per line` | built | admin | [RosterPanel.tsx:95](src/features/admin/setup/RosterPanel.tsx:95) |  |
| `Team Rocket, {Player1, Player2, …}` | built | admin | [RosterPanel.tsx:103](src/features/admin/setup/RosterPanel.tsx:103) |  |
| `Harald Lagtop Arisu ...` | fixed | admin | [RosterPanel.tsx:104](src/features/admin/setup/RosterPanel.tsx:104) |  |
| `Reserves — one per line` | fixed | admin | [RosterPanel.tsx:108](src/features/admin/setup/RosterPanel.tsx:108) |  |
| `Individual reserves — substitutes for one member` | fixed | admin | [RosterPanel.tsx:120](src/features/admin/setup/RosterPanel.tsx:120) |  |
| `Load roster & reserves` | fixed | admin | [RosterPanel.tsx:131](src/features/admin/setup/RosterPanel.tsx:131) |  |
| `Clear the registered roster? This removes all players/teams and reserves, and any generated schedule preview. Tournament settings (format, schedule logic, etc.) are kept.` | fixed | admin | [RosterPanel.tsx:138](src/features/admin/setup/RosterPanel.tsx:138) |  |
| `↺ Clear roster` | fixed | admin | [RosterPanel.tsx:144](src/features/admin/setup/RosterPanel.tsx:144) |  |

### schedule-preview-rows.ts — Generated: preview row texts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `{up to / ∅}{count} game(s)` | built | admin | [schedule-preview-rows.ts:20](src/features/admin/setup/schedule-preview-rows.ts:20) |  |
| `{room sizes joined by " · "} {players / teams}` | built | admin | [schedule-preview-rows.ts:26](src/features/admin/setup/schedule-preview-rows.ts:26) |  |
| `incl. {count} lucky loser(s)` | built | admin | [schedule-preview-rows.ts:55](src/features/admin/setup/schedule-preview-rows.ts:55) | one room size, and tournaments without `cutVersion` |
| `{advTotal} advance: {rooms of n / the room of n} {lose / loses} {min–max / n}, …` | built | admin | [schedule-preview-rows.ts:46](src/features/admin/setup/schedule-preview-rows.ts:46) | fair cut with several room sizes, e.g. "26 advance: rooms of 4 lose 4–5, the room of 3 loses 0–1" |
| `{advTotal} advance{lucky}` | built | admin | [schedule-preview-rows.ts:56](src/features/admin/setup/schedule-preview-rows.ts:56) |  |

### spare-cut-text.ts — The spare-cut line under the lucky-loser lists

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Spare cut` / `Spare cuts` | fixed | viewer | [spare-cut-text.ts:36](src/features/bracket/spare-cut-text.ts:36) |  |
| `{name} is in the bottom {n}% of rooms of {size} so far` | built | viewer | [spare-cut-text.ts:7](src/features/bracket/spare-cut-text.ts:7) | the first contender; the next ones read "{name} in the bottom {n}% of rooms of {size}" |
| `{name} is in a room with no scores yet` | built | viewer | [spare-cut-text.ts:6](src/features/bracket/spare-cut-text.ts:6) |  |
| `{names} goes out.` / `go out.` | built | viewer | [spare-cut-text.ts:35](src/features/bracket/spare-cut-text.ts:35) |  |
| `{names} drops to the losers bracket.` / `drop to …` | built | viewer | [spare-cut-text.ts:34](src/features/bracket/spare-cut-text.ts:34) | double-elimination winners round |

### SchedulePreviewPanel.tsx — Setup: SCHEDULE PREVIEW panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `SCHEDULE PREVIEW` | fixed | admin | [SchedulePreviewPanel.tsx:34](src/features/admin/setup/SchedulePreviewPanel.tsx:34) |  |
| `Room sizes, advancement and lucky losers are worked out for` | fixed | admin | [SchedulePreviewPanel.tsx:47](src/features/admin/setup/SchedulePreviewPanel.tsx:47) |  |
| `Starting…` | fixed | admin | [SchedulePreviewPanel.tsx:59](src/features/admin/setup/SchedulePreviewPanel.tsx:59) |  |
| `Confirm & Start` | fixed | admin | [SchedulePreviewPanel.tsx:59](src/features/admin/setup/SchedulePreviewPanel.tsx:59) |  |

### TournamentPanel.tsx — Setup: TOURNAMENT panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `TOURNAMENT` | fixed | admin | [TournamentPanel.tsx:18](src/features/admin/setup/TournamentPanel.tsx:18) |  |
| `Name` | fixed | admin | [TournamentPanel.tsx:19](src/features/admin/setup/TournamentPanel.tsx:19) |  |
| `Unnamed Tournament — click to name` | fixed | admin | [TournamentPanel.tsx:24](src/features/admin/setup/TournamentPanel.tsx:24) |  |

### WaterfallPanel.tsx — Setup: waterfall graph panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `route the ranks of every room that go on; the rest are out` | fixed | admin | [WaterfallPanel.tsx:18](src/features/admin/setup/WaterfallPanel.tsx:18) |  |
| `WATERFALL BRACKET GRAPH` | fixed | admin | [WaterfallPanel.tsx:19](src/features/admin/setup/WaterfallPanel.tsx:19) |  |
| `Every round, room count/size, and rank routing is set up here, and can still be corrected from the Admin tab while the tournament is running. There's no automatic reseeding beyond that, no automatic bye/lucky-loser handling, and reserves can't be added once a tournament starts on this schedule logic.` | fixed | admin | [WaterfallPanel.tsx:29](src/features/admin/setup/WaterfallPanel.tsx:29) |  |

### SetupView.tsx — Setup page notices

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Copied settings from "{sourceTitle}".` | built | admin | [SetupView.tsx:39](src/features/admin/SetupView.tsx:39) |  |
| `Generate the schedule again: the preview below still uses the previous settings.` | fixed | admin | [SetupView.tsx:41](src/features/admin/SetupView.tsx:41) |  |
| `The game format changed: load the roster again.` | fixed | admin | [SetupView.tsx:44](src/features/admin/SetupView.tsx:44) |  |

### waterfall-format.ts — Waterfall editor: generated labels

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Qualification table` | fixed | admin | [waterfall-format.ts:38](src/features/admin/waterfall/waterfall-format.ts:38) |  |
| `ranks {perRoom}{ of each room / ∅}` | built | admin | [waterfall-format.ts:59](src/features/admin/waterfall/waterfall-format.ts:59) |  |
| `ranks differ by room` | fixed | admin | [waterfall-format.ts:61](src/features/admin/waterfall/waterfall-format.ts:61) |  |
| `{entrantCount} / {needs}` | built | admin | [waterfall-format.ts:81](src/features/admin/waterfall/waterfall-format.ts:81) |  |
| `{receives} / {needs}` | built | admin | [waterfall-format.ts:84](src/features/admin/waterfall/waterfall-format.ts:84) |  |

### WaterfallGraphEditor.tsx — Waterfall graph editor (Setup)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Blank start` | fixed | admin | [WaterfallGraphEditor.tsx:69](src/features/admin/waterfall/WaterfallGraphEditor.tsx:69) |  |
| `Example:` | fixed | admin | [WaterfallGraphEditor.tsx:74](src/features/admin/waterfall/WaterfallGraphEditor.tsx:74) |  |
| `Players registered:` | fixed | admin | [WaterfallGraphEditor.tsx:92](src/features/admin/waterfall/WaterfallGraphEditor.tsx:92) |  |
| `not known yet` | fixed | admin | [WaterfallGraphEditor.tsx:92](src/features/admin/waterfall/WaterfallGraphEditor.tsx:92) |  |
| `· sent on:` | fixed | admin | [WaterfallGraphEditor.tsx:92](src/features/admin/waterfall/WaterfallGraphEditor.tsx:92) |  |
| `(load a roster to see how many are eliminated)` | fixed | admin | [WaterfallGraphEditor.tsx:94](src/features/admin/waterfall/WaterfallGraphEditor.tsx:94) |  |
| `· eliminated:` | fixed | admin | [WaterfallGraphEditor.tsx:98](src/features/admin/waterfall/WaterfallGraphEditor.tsx:98) |  |
| `Replace the current graph? Every routed rank will be lost.` | fixed | admin | [WaterfallGraphEditor.tsx:143](src/features/admin/waterfall/WaterfallGraphEditor.tsx:143) |  |
| `Make {label} the Final? Nothing routes out of the Final, so its routing is lost.` | built | admin | [WaterfallGraphEditor.tsx:187](src/features/admin/waterfall/WaterfallGraphEditor.tsx:187) |  |
| `Delete {label}? Its routing is lost, and ranks that pointed at it become out.` | built | admin | [WaterfallGraphEditor.tsx:200](src/features/admin/waterfall/WaterfallGraphEditor.tsx:200) |  |
| `Players entering the bracket:` | fixed | admin | [WaterfallGraphEditor.tsx:235](src/features/admin/waterfall/WaterfallGraphEditor.tsx:235) |  |
| `not known yet` | fixed | admin | [WaterfallGraphEditor.tsx:235](src/features/admin/waterfall/WaterfallGraphEditor.tsx:235) |  |
| `(load a roster and set "Advance to bracket")` | fixed | admin | [WaterfallGraphEditor.tsx:237](src/features/admin/waterfall/WaterfallGraphEditor.tsx:237) |  |
| `Start over from:` | fixed | admin | [WaterfallGraphEditor.tsx:244](src/features/admin/waterfall/WaterfallGraphEditor.tsx:244) |  |
| `Rounds` | fixed | admin | [WaterfallGraphEditor.tsx:252](src/features/admin/waterfall/WaterfallGraphEditor.tsx:252) | CSS caps (label) |
| `+ Add round` | fixed | admin | [WaterfallGraphEditor.tsx:265](src/features/admin/waterfall/WaterfallGraphEditor.tsx:265) |  |
| `The saved graph text can't be read as a table:` | fixed | admin | [WaterfallGraphEditor.tsx:333](src/features/admin/waterfall/WaterfallGraphEditor.tsx:333) |  |
| `Discard this text and start a new graph?` | fixed | admin | [WaterfallGraphEditor.tsx:341](src/features/admin/waterfall/WaterfallGraphEditor.tsx:341) |  |
| `Discard and start over` | fixed | admin | [WaterfallGraphEditor.tsx:345](src/features/admin/waterfall/WaterfallGraphEditor.tsx:345) |  |
| `No rounds yet. Start with an entry round and a Final and route the ranks that go on (the rest are out), or load an example to edit.` | fixed | admin | [WaterfallGraphEditor.tsx:357](src/features/admin/waterfall/WaterfallGraphEditor.tsx:357) |  |
| `Blank start` | fixed | admin | [WaterfallGraphEditor.tsx:372](src/features/admin/waterfall/WaterfallGraphEditor.tsx:372) |  |
| `This graph has a Qual line, but this tournament has no qualification table, so it can't be used.` | fixed | admin | [WaterfallGraphEditor.tsx:386](src/features/admin/waterfall/WaterfallGraphEditor.tsx:386) |  |
| `Remove the Qual line` | fixed | admin | [WaterfallGraphEditor.tsx:390](src/features/admin/waterfall/WaterfallGraphEditor.tsx:390) |  |

### WaterfallRoundEditor.tsx — Waterfall graph editor: one round

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Name` | fixed | admin | [WaterfallRoundEditor.tsx:76](src/features/admin/waterfall/WaterfallRoundEditor.tsx:76) | CSS caps (field label) |
| `Rooms` | fixed | admin | [WaterfallRoundEditor.tsx:87](src/features/admin/waterfall/WaterfallRoundEditor.tsx:87) | CSS caps (field label) |
| `Players per room` | fixed | admin | [WaterfallRoundEditor.tsx:98](src/features/admin/waterfall/WaterfallRoundEditor.tsx:98) | CSS caps (field label) |
| `This is the Final` | fixed | admin | [WaterfallRoundEditor.tsx:115](src/features/admin/waterfall/WaterfallRoundEditor.tsx:115) |  |
| `Delete round` | fixed | admin | [WaterfallRoundEditor.tsx:119](src/features/admin/waterfall/WaterfallRoundEditor.tsx:119) |  |
| `{n} slot(s) selected` | built | admin | [WaterfallRoundEditor.tsx:145](src/features/admin/waterfall/WaterfallRoundEditor.tsx:145) |  |
| `Click a rank to select it. Shift-click selects a range.` | fixed | admin | [WaterfallRoundEditor.tsx:146](src/features/admin/waterfall/WaterfallRoundEditor.tsx:146) |  |
| `Select all` | fixed | admin | [WaterfallRoundEditor.tsx:149](src/features/admin/waterfall/WaterfallRoundEditor.tsx:149) |  |
| `Clear selection` | fixed | admin | [WaterfallRoundEditor.tsx:152](src/features/admin/waterfall/WaterfallRoundEditor.tsx:152) |  |
| `Apply to every room` | fixed | admin | [WaterfallRoundEditor.tsx:163](src/features/admin/waterfall/WaterfallRoundEditor.tsx:163) |  |
| `Send selected ranks to` | fixed | admin | [WaterfallRoundEditor.tsx:168](src/features/admin/waterfall/WaterfallRoundEditor.tsx:168) |  |
| `Send selected to…` | fixed | admin | [WaterfallRoundEditor.tsx:173](src/features/admin/waterfall/WaterfallRoundEditor.tsx:173) |  |
| `Eliminated` | fixed | admin | [WaterfallRoundEditor.tsx:179](src/features/admin/waterfall/WaterfallRoundEditor.tsx:179) |  |
| `to {destination}` | built | admin | [WaterfallRoundEditor.tsx:187](src/features/admin/waterfall/WaterfallRoundEditor.tsx:187) |  |
| `{formatRanks} → {destinationName}` | built | admin | [WaterfallRoundEditor.tsx:210](src/features/admin/waterfall/WaterfallRoundEditor.tsx:210) |  |
| `nothing routed yet` | fixed | admin | [WaterfallRoundEditor.tsx:216](src/features/admin/waterfall/WaterfallRoundEditor.tsx:216) |  |
| `{name}, rank {rank}, {slotDescription}` | built | admin | [WaterfallRoundEditor.tsx:239](src/features/admin/waterfall/WaterfallRoundEditor.tsx:239) |  |
| `Where each final standing goes. Rank 1 is the top of the table; a rank left as "out" is eliminated when qualification ends.` | fixed | admin | [WaterfallRoundEditor.tsx:308](src/features/admin/waterfall/WaterfallRoundEditor.tsx:308) |  |
| `+ Add ranks` | fixed | admin | [WaterfallRoundEditor.tsx:332](src/features/admin/waterfall/WaterfallRoundEditor.tsx:332) |  |
| `{roomCount} rooms × {roomSize}` | built | admin | [WaterfallRoundEditor.tsx:344](src/features/admin/waterfall/WaterfallRoundEditor.tsx:344) |  |
| `{roomSize} players` | built | admin | [WaterfallRoundEditor.tsx:344](src/features/admin/waterfall/WaterfallRoundEditor.tsx:344) |  |
| `· Final` | fixed | admin | [WaterfallRoundEditor.tsx:345](src/features/admin/waterfall/WaterfallRoundEditor.tsx:345) |  |
| `Final` | fixed | admin | [WaterfallRoundEditor.tsx:383](src/features/admin/waterfall/WaterfallRoundEditor.tsx:383) |  |
| `Nothing routes out of the Final. It receives` | fixed | admin | [WaterfallRoundEditor.tsx:385](src/features/admin/waterfall/WaterfallRoundEditor.tsx:385) |  |
| `of the` | fixed | admin | [WaterfallRoundEditor.tsx:385](src/features/admin/waterfall/WaterfallRoundEditor.tsx:385) |  |
| `players it needs.` | fixed | admin | [WaterfallRoundEditor.tsx:386](src/features/admin/waterfall/WaterfallRoundEditor.tsx:386) |  |
| `A rank left as "out" is eliminated.` | fixed | admin | [WaterfallRoundEditor.tsx:400](src/features/admin/waterfall/WaterfallRoundEditor.tsx:400) |  |

### WaterfallRoundList.tsx — Waterfall graph editor: round list

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `sent on` | fixed | admin | [WaterfallRoundList.tsx:49](src/features/admin/waterfall/WaterfallRoundList.tsx:49) |  |
| `· Final` | fixed | admin | [WaterfallRoundList.tsx:78](src/features/admin/waterfall/WaterfallRoundList.tsx:78) |  |

### WaterfallSidePanel.tsx — Waterfall graph editor: checks panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Ready to generate.` | fixed | admin | [WaterfallSidePanel.tsx:38](src/features/admin/waterfall/WaterfallSidePanel.tsx:38) |  |
| `Load a roster to also check the routed ranks against your registered players.` | fixed | admin | [WaterfallSidePanel.tsx:42](src/features/admin/waterfall/WaterfallSidePanel.tsx:42) |  |
| `Load a roster (and set "Advance to bracket") to also check the starting round against your entering players.` | fixed | admin | [WaterfallSidePanel.tsx:43](src/features/admin/waterfall/WaterfallSidePanel.tsx:43) |  |
| `Next thing to fix` | fixed | admin | [WaterfallSidePanel.tsx:49](src/features/admin/waterfall/WaterfallSidePanel.tsx:49) |  |
| `Where everyone goes` | fixed | admin | [WaterfallSidePanel.tsx:55](src/features/admin/waterfall/WaterfallSidePanel.tsx:55) | CSS caps (label) |
| `Nothing routed yet.` | fixed | admin | [WaterfallSidePanel.tsx:57](src/features/admin/waterfall/WaterfallSidePanel.tsx:57) |  |
| `player` | fixed | admin | [WaterfallSidePanel.tsx:67](src/features/admin/waterfall/WaterfallSidePanel.tsx:67) |  |
| `View as text` | fixed | admin | [WaterfallSidePanel.tsx:75](src/features/admin/waterfall/WaterfallSidePanel.tsx:75) |  |
| `Copied` | fixed | admin | [WaterfallSidePanel.tsx:80](src/features/admin/waterfall/WaterfallSidePanel.tsx:80) |  |
| `Copy text` | fixed | admin | [WaterfallSidePanel.tsx:80](src/features/admin/waterfall/WaterfallSidePanel.tsx:80) |  |

## 8. Running Admin (a started tournament)

The Admin tab of a started tournament: status bar, progress, settings recap, line-up/advancement correction, waterfall edit, info for visitors.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Status line next to the pill | [admin-actions.ts:72](src/features/tournaments/admin-actions.ts:72) | Visible to admins only. (+ orange: To publish, give it a name and add a scheduled date and time.) · On the Tournaments page. "Starting soon" from 1 hour before the scheduled time. · Started Sat 20 Sep, 20:00. Finish it once the Final is complete and its scores are checked. · Final complete — check the last scores, then Finish tournament. · Read-only for everyone. Reopen it to change scores or settings. |
| Progress line | [progress-summary.ts:92](src/features/admin/progress-summary.ts:92) | Round 5 · 2 of 3 rooms scored · Round 5 · all 3 rooms scored · Final · 5 of 8 scores in · Final · complete · Grand Final · in progress |
| Recap rows | [settings-recap.ts:51](src/features/admin/settings-recap.ts:51) | Game format = 2v2v2v2 · rooms of 3–4 · Roster = 12 teams · 2 reserves · Advance to bracket = 16, set by the waterfall graph · Grand Final, winners bracket = 3 wins needed · Draw publication etc. (labels listed below) |
| Waterfall saved | [RunningWaterfallPanel.tsx:76](src/features/admin/waterfall/RunningWaterfallPanel.tsx:76) | Graph saved. · Graph saved, "Round 3" re-drawn. |

### CopyViewerLink.tsx — Copy viewer link button

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Copy this link:` | fixed | admin | [CopyViewerLink.tsx:18](src/features/admin/CopyViewerLink.tsx:18) |  |
| `Copied` | fixed | admin | [CopyViewerLink.tsx:24](src/features/admin/CopyViewerLink.tsx:24) |  |
| `Copy viewer link` | fixed | admin | [CopyViewerLink.tsx:24](src/features/admin/CopyViewerLink.tsx:24) |  |

### AdvancementSection.tsx — Live correction: advancement

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Save advancement` | fixed | admin | [AdvancementSection.tsx:25](src/features/admin/live-corrections/AdvancementSection.tsx:25) |  |
| `Advance to bracket ({minQualAdv}–{maxQualAdv})` | built | admin | [AdvancementSection.tsx:55](src/features/admin/live-corrections/AdvancementSection.tsx:55) |  |
| `Advancement targets (blank = automatic)` | fixed | admin | [AdvancementSection.tsx:59](src/features/admin/live-corrections/AdvancementSection.tsx:59) |  |
| `{label} — {players} enter, advance` | built | admin | [AdvancementSection.tsx:76](src/features/admin/live-corrections/AdvancementSection.tsx:76) |  |
| `Then Semis with` | fixed | admin | [AdvancementSection.tsx:89](src/features/admin/live-corrections/AdvancementSection.tsx:89) |  |
| `(minimum` | fixed | admin | [AdvancementSection.tsx:89](src/features/admin/live-corrections/AdvancementSection.tsx:89) |  |
| `Advancement targets` | fixed | admin | [AdvancementSection.tsx:107](src/features/admin/live-corrections/AdvancementSection.tsx:107) |  |

### CorrectCurrentRoundPanel.tsx — Live correction panel

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Line-up and advancement` | fixed | admin | [CorrectCurrentRoundPanel.tsx:28](src/features/admin/live-corrections/CorrectCurrentRoundPanel.tsx:28) |  |
| `CORRECT CURRENT ROUND · {roundName}` | built | admin | [CorrectCurrentRoundPanel.tsx:29](src/features/admin/live-corrections/CorrectCurrentRoundPanel.tsx:29) |  |
| `Changes apply immediately for everyone watching.` | fixed | admin | [CorrectCurrentRoundPanel.tsx:43](src/features/admin/live-corrections/CorrectCurrentRoundPanel.tsx:43) |  |

### LineupSection.tsx — Live correction: line-up

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Room` | fixed | admin | [LineupSection.tsx:17](src/features/admin/live-corrections/LineupSection.tsx:17) | CSS caps (label) |
| `Bye` | fixed | admin | [LineupSection.tsx:48](src/features/admin/live-corrections/LineupSection.tsx:48) |  |
| `Room for {label}` | built | admin | [LineupSection.tsx:51](src/features/admin/live-corrections/LineupSection.tsx:51) |  |
| `Eliminate` | fixed | admin | [LineupSection.tsx:61](src/features/admin/live-corrections/LineupSection.tsx:61) |  |
| `Reinstate (eliminated in the previous round):` | fixed | admin | [LineupSection.tsx:85](src/features/admin/live-corrections/LineupSection.tsx:85) |  |
| `Unit to reinstate` | fixed | admin | [LineupSection.tsx:87](src/features/admin/live-corrections/LineupSection.tsx:87) |  |
| `into` | fixed | admin | [LineupSection.tsx:98](src/features/admin/live-corrections/LineupSection.tsx:98) |  |
| `Room to reinstate into` | fixed | admin | [LineupSection.tsx:100](src/features/admin/live-corrections/LineupSection.tsx:100) |  |
| `Reinstate` | fixed | admin | [LineupSection.tsx:108](src/features/admin/live-corrections/LineupSection.tsx:108) |  |
| `Room` | fixed | admin | [LineupSection.tsx:146](src/features/admin/live-corrections/LineupSection.tsx:146) | CSS caps (label) |
| `Byes` | fixed | admin | [LineupSection.tsx:166](src/features/admin/live-corrections/LineupSection.tsx:166) | CSS caps (label) |
| `Eliminated:` | fixed | admin | [LineupSection.tsx:185](src/features/admin/live-corrections/LineupSection.tsx:185) |  |
| `Save line-up` | fixed | admin | [LineupSection.tsx:203](src/features/admin/live-corrections/LineupSection.tsx:203) |  |
| `Discard` | fixed | admin | [LineupSection.tsx:206](src/features/admin/live-corrections/LineupSection.tsx:206) |  |
| `Correct line-up — Round` | fixed | admin | [LineupSection.tsx:224](src/features/admin/live-corrections/LineupSection.tsx:224) |  |
| `(no scores yet)` | fixed | admin | [LineupSection.tsx:224](src/features/admin/live-corrections/LineupSection.tsx:224) |  |

### RoomsOverview.tsx — Live correction: rooms overview

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Scored` | fixed | admin | [RoomsOverview.tsx:7](src/features/admin/live-corrections/RoomsOverview.tsx:7) |  |
| `Being scored` | fixed | admin | [RoomsOverview.tsx:9](src/features/admin/live-corrections/RoomsOverview.tsx:9) |  |
| `Not started` | fixed | admin | [RoomsOverview.tsx:10](src/features/admin/live-corrections/RoomsOverview.tsx:10) |  |
| `ROOM` | fixed | admin | [RoomsOverview.tsx:22](src/features/admin/live-corrections/RoomsOverview.tsx:22) |  |
| `PLAYERS` | fixed | admin | [RoomsOverview.tsx:23](src/features/admin/live-corrections/RoomsOverview.tsx:23) |  |
| `SCORES` | fixed | admin | [RoomsOverview.tsx:24](src/features/admin/live-corrections/RoomsOverview.tsx:24) |  |
| `STATUS` | fixed | admin | [RoomsOverview.tsx:25](src/features/admin/live-corrections/RoomsOverview.tsx:25) |  |
| `Has scores · locked` | fixed | admin | [RoomsOverview.tsx:50](src/features/admin/live-corrections/RoomsOverview.tsx:50) |  |

### LoadedTournamentAdmin.tsx — Admin tab once a tournament is opened

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `← All tournaments` | fixed | admin | [LoadedTournamentAdmin.tsx:22](src/features/admin/LoadedTournamentAdmin.tsx:22) |  |
| `Admin` | fixed | admin | [LoadedTournamentAdmin.tsx:27](src/features/admin/LoadedTournamentAdmin.tsx:27) | CSS caps (page label) |
| `Setup` | fixed | admin | [LoadedTournamentAdmin.tsx:27](src/features/admin/LoadedTournamentAdmin.tsx:27) | CSS caps (page label) |
| `Loading the tournament…` | fixed | admin | [LoadedTournamentAdmin.tsx:30](src/features/admin/LoadedTournamentAdmin.tsx:30) |  |
| `This tournament does not exist (any more).` | fixed | admin | [LoadedTournamentAdmin.tsx:31](src/features/admin/LoadedTournamentAdmin.tsx:31) |  |
| `Live sync is unavailable, so the tournament cannot be loaded. Reload the page.` | fixed | admin | [LoadedTournamentAdmin.tsx:34](src/features/admin/LoadedTournamentAdmin.tsx:34) |  |

### progress-summary.ts — Generated: progress lines ("Round 5 · 2 of 3 rooms scored")

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Final` | fixed | admin | [progress-summary.ts:48](src/features/admin/progress-summary.ts:48) |  |
| `Room {roomLetter}` | built | admin | [progress-summary.ts:62](src/features/admin/progress-summary.ts:62) |  |
| `in progress` | fixed | admin | [progress-summary.ts:73](src/features/admin/progress-summary.ts:73) |  |
| `all scores in` | fixed | admin | [progress-summary.ts:77](src/features/admin/progress-summary.ts:77) |  |
| `{scored} of {players} scores in` | built | admin | [progress-summary.ts:77](src/features/admin/progress-summary.ts:77) |  |
| `all {count} room(s) scored` | built | admin | [progress-summary.ts:85](src/features/admin/progress-summary.ts:85) |  |
| `{n} of {total} rooms scored` | built | admin | [progress-summary.ts:86](src/features/admin/progress-summary.ts:86) |  |
| `{roundName} · complete` | built | admin | [progress-summary.ts:102](src/features/admin/progress-summary.ts:102) |  |
| `{roundName} · {progress text}` | built | admin | [progress-summary.ts:104](src/features/admin/progress-summary.ts:104) |  |

### ProgressSection.tsx — Running Admin: Tournament progress

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Done` | fixed | admin | [ProgressSection.tsx:15](src/features/admin/ProgressSection.tsx:15) |  |
| `Now` | fixed | admin | [ProgressSection.tsx:16](src/features/admin/ProgressSection.tsx:16) |  |
| `Upcoming` | fixed | admin | [ProgressSection.tsx:17](src/features/admin/ProgressSection.tsx:17) |  |
| `Tournament progress` | fixed | admin | [ProgressSection.tsx:44](src/features/admin/ProgressSection.tsx:44) |  |

### RunningAdmin.tsx — Running Admin page

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `The saved tournament has no current round.` | fixed | admin | [RunningAdmin.tsx:14](src/features/admin/RunningAdmin.tsx:14) |  |
| `Send this tournament back to draft? Its players and settings stay; every score and round played is cleared.` | fixed | admin | [RunningAdmin.tsx:36](src/features/admin/RunningAdmin.tsx:36) |  |
| `Resetting…` | fixed | admin | [RunningAdmin.tsx:43](src/features/admin/RunningAdmin.tsx:43) |  |
| `Back to draft` | fixed | admin | [RunningAdmin.tsx:43](src/features/admin/RunningAdmin.tsx:43) |  |
| `Keeps the roster and settings, clears the played rounds.` | fixed | admin | [RunningAdmin.tsx:45](src/features/admin/RunningAdmin.tsx:45) |  |

### RunningAdminStatus.tsx — Running Admin: Settings panel frame

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Fixed since the start · only the settings that apply to this format are listed` | fixed | admin | [RunningAdminStatus.tsx:10](src/features/admin/RunningAdminStatus.tsx:10) |  |
| `Settings` | fixed | admin | [RunningAdminStatus.tsx:13](src/features/admin/RunningAdminStatus.tsx:13) |  |

### RunningInfoPanel.tsx — Running Admin: Info for visitors

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Shown on the Info tab · editable while the tournament runs` | fixed | admin | [RunningInfoPanel.tsx:12](src/features/admin/RunningInfoPanel.tsx:12) |  |
| `Info for visitors` | fixed | admin | [RunningInfoPanel.tsx:15](src/features/admin/RunningInfoPanel.tsx:15) |  |
| `Name` | fixed | admin | [RunningInfoPanel.tsx:19](src/features/admin/RunningInfoPanel.tsx:19) |  |
| `Unnamed Tournament` | fixed | admin | [RunningInfoPanel.tsx:24](src/features/admin/RunningInfoPanel.tsx:24) |  |

### settings-recap.ts — Generated: settings recap rows of the running Admin

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `FORMAT` | fixed | admin | [settings-recap.ts:51](src/features/admin/settings-recap.ts:51) |  |
| `Game format` | fixed | admin | [settings-recap.ts:52](src/features/admin/settings-recap.ts:52) |  |
| `{format name} · rooms of {min}–{max} (or "rooms of {n}" when min = max)` | built | admin | [settings-recap.ts:57](src/features/admin/settings-recap.ts:57) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:61](src/features/admin/settings-recap.ts:61) |  |
| `Schedule logic` | fixed | admin | [settings-recap.ts:62](src/features/admin/settings-recap.ts:62) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:66](src/features/admin/settings-recap.ts:66) |  |
| `Team scoring` | fixed | admin | [settings-recap.ts:67](src/features/admin/settings-recap.ts:67) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:71](src/features/admin/settings-recap.ts:71) |  |
| `Odd-count strategy` | fixed | admin | [settings-recap.ts:72](src/features/admin/settings-recap.ts:72) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:80](src/features/admin/settings-recap.ts:80) |  |
| `Draw publication` | fixed | admin | [settings-recap.ts:81](src/features/admin/settings-recap.ts:81) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:85](src/features/admin/settings-recap.ts:85) |  |
| `Waterfall graph` | fixed | admin | [settings-recap.ts:86](src/features/admin/settings-recap.ts:86) |  |
| `Organiser-authored, shown below` | fixed | admin | [settings-recap.ts:87](src/features/admin/settings-recap.ts:87) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:90](src/features/admin/settings-recap.ts:90) |  |
| `Pooling phase` | fixed | admin | [settings-recap.ts:91](src/features/admin/settings-recap.ts:91) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:95](src/features/admin/settings-recap.ts:95) |  |
| `Advance to bracket` | fixed | admin | [settings-recap.ts:96](src/features/admin/settings-recap.ts:96) |  |
| `{advancing}, set by the waterfall graph` | built | admin | [settings-recap.ts:102](src/features/admin/settings-recap.ts:102) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:106](src/features/admin/settings-recap.ts:106) |  |
| `Non-counting rounds` | fixed | admin | [settings-recap.ts:107](src/features/admin/settings-recap.ts:107) |  |
| `None` | fixed | admin | [settings-recap.ts:109](src/features/admin/settings-recap.ts:109) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:112](src/features/admin/settings-recap.ts:112) |  |
| `Group size` | fixed | admin | [settings-recap.ts:113](src/features/admin/settings-recap.ts:113) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:117](src/features/admin/settings-recap.ts:117) |  |
| `Round-robin` | fixed | admin | [settings-recap.ts:118](src/features/admin/settings-recap.ts:118) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:122](src/features/admin/settings-recap.ts:122) |  |
| `Qualifiers per group` | fixed | admin | [settings-recap.ts:123](src/features/admin/settings-recap.ts:123) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:127](src/features/admin/settings-recap.ts:127) |  |
| `Qualification rounds` | fixed | admin | [settings-recap.ts:128](src/features/admin/settings-recap.ts:128) |  |
| `Derived` | fixed | admin | [settings-recap.ts:129](src/features/admin/settings-recap.ts:129) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:132](src/features/admin/settings-recap.ts:132) |  |
| `Swiss rounds` | fixed | admin | [settings-recap.ts:133](src/features/admin/settings-recap.ts:133) |  |
| `Derived` | fixed | admin | [settings-recap.ts:134](src/features/admin/settings-recap.ts:134) |  |
| `SCORING` | fixed | admin | [settings-recap.ts:137](src/features/admin/settings-recap.ts:137) |  |
| `Scoring system` | fixed | admin | [settings-recap.ts:138](src/features/admin/settings-recap.ts:138) |  |
| `Standard points (1st = largest room size, −1 per place)` | fixed | admin | [scoring.ts:237](src/domain/tournament/scoring.ts:237) | the recap value for a tournament without `pointsVersion` (made before scaled points); a newer one shows the Setup option name |
| `SCORING` | fixed | admin | [settings-recap.ts:143](src/features/admin/settings-recap.ts:143) |  |
| `Points table` | fixed | admin | [settings-recap.ts:144](src/features/admin/settings-recap.ts:144) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:147](src/features/admin/settings-recap.ts:147) |  |
| `Semis format` | fixed | admin | [settings-recap.ts:147](src/features/admin/settings-recap.ts:147) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:149](src/features/admin/settings-recap.ts:149) |  |
| `Finals format` | fixed | admin | [settings-recap.ts:150](src/features/admin/settings-recap.ts:150) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:154](src/features/admin/settings-recap.ts:154) |  |
| `Grand Final, winners bracket` | fixed | admin | [settings-recap.ts:155](src/features/admin/settings-recap.ts:155) |  |
| `{target} wins needed` | built | admin | [settings-recap.ts:156](src/features/admin/settings-recap.ts:156) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:159](src/features/admin/settings-recap.ts:159) |  |
| `Grand Final, losers bracket` | fixed | admin | [settings-recap.ts:160](src/features/admin/settings-recap.ts:160) |  |
| `{target} wins needed` | built | admin | [settings-recap.ts:161](src/features/admin/settings-recap.ts:161) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:164](src/features/admin/settings-recap.ts:164) |  |
| `Semis size` | fixed | admin | [settings-recap.ts:165](src/features/admin/settings-recap.ts:165) |  |
| `Derived` | fixed | admin | [settings-recap.ts:166](src/features/admin/settings-recap.ts:166) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:169](src/features/admin/settings-recap.ts:169) |  |
| `Final size` | fixed | admin | [settings-recap.ts:170](src/features/admin/settings-recap.ts:170) |  |
| `Derived` | fixed | admin | [settings-recap.ts:171](src/features/admin/settings-recap.ts:171) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:174](src/features/admin/settings-recap.ts:174) |  |
| `LB qualifiers into the Final` | fixed | admin | [settings-recap.ts:175](src/features/admin/settings-recap.ts:175) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:179](src/features/admin/settings-recap.ts:179) |  |
| `Elimination round targets` | fixed | admin | [settings-recap.ts:180](src/features/admin/settings-recap.ts:180) |  |
| `Automatic` | fixed | admin | [settings-recap.ts:181](src/features/admin/settings-recap.ts:181) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:184](src/features/admin/settings-recap.ts:184) |  |
| `Elimination seeding` | fixed | admin | [settings-recap.ts:185](src/features/admin/settings-recap.ts:185) |  |
| `Automatic` | fixed | admin | [settings-recap.ts:186](src/features/admin/settings-recap.ts:186) |  |
| `FORMAT` | fixed | admin | [settings-recap.ts:190](src/features/admin/settings-recap.ts:190) |  |
| `POOLING` | fixed | admin | [settings-recap.ts:190](src/features/admin/settings-recap.ts:190) |  |
| `SCORING` | fixed | admin | [settings-recap.ts:190](src/features/admin/settings-recap.ts:190) |  |
| `BRACKET` | fixed | admin | [settings-recap.ts:190](src/features/admin/settings-recap.ts:190) |  |
| `· {count} reserve(s)` | built | admin | [settings-recap.ts:232](src/features/admin/settings-recap.ts:232) |  |
| `{count} {player(s) / team(s)}{ · n reserve(s)}` | fixed | admin | [settings-recap.ts:233](src/features/admin/settings-recap.ts:233) |  |
| `{count} {player(s) / team(s)}{ · n reserve(s)}` | built | admin | [settings-recap.ts:233](src/features/admin/settings-recap.ts:233) |  |
| `ROSTER AND SHARING` | fixed | admin | [settings-recap.ts:251](src/features/admin/settings-recap.ts:251) |  |
| `Viewer link` | fixed | admin | [settings-recap.ts:254](src/features/admin/settings-recap.ts:254) |  |
| `Copy it with “Copy viewer link”, at the top` | fixed | admin | [settings-recap.ts:254](src/features/admin/settings-recap.ts:254) |  |

### SyncStatusLine.tsx — Live sync status line

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Live sync is unavailable (the sync service could not be reached). Viewers need to refresh manually.` | fixed | admin | [SyncStatusLine.tsx:13](src/features/admin/SyncStatusLine.tsx:13) |  |
| `Sync error: viewers may be seeing stale data (` | fixed | admin | [SyncStatusLine.tsx:18](src/features/admin/SyncStatusLine.tsx:18) |  |
| `Connecting to live sync…` | fixed | admin | [SyncStatusLine.tsx:21](src/features/admin/SyncStatusLine.tsx:21) |  |

### TournamentStatusPanel.tsx — Running Admin / Setup: status bar and delete confirm

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Publish` | fixed | admin | [TournamentStatusPanel.tsx:17](src/features/admin/TournamentStatusPanel.tsx:17) |  |
| `Unpublish` | fixed | admin | [TournamentStatusPanel.tsx:18](src/features/admin/TournamentStatusPanel.tsx:18) |  |
| `Finish tournament` | fixed | admin | [TournamentStatusPanel.tsx:19](src/features/admin/TournamentStatusPanel.tsx:19) |  |
| `Reopen` | fixed | admin | [TournamentStatusPanel.tsx:20](src/features/admin/TournamentStatusPanel.tsx:20) |  |
| `Delete tournament` | fixed | admin | [TournamentStatusPanel.tsx:21](src/features/admin/TournamentStatusPanel.tsx:21) |  |
| `Tournament status` | fixed | admin | [TournamentStatusPanel.tsx:59](src/features/admin/TournamentStatusPanel.tsx:59) |  |
| `Test run` | fixed | admin | [TournamentStatusPanel.tsx:67](src/features/admin/TournamentStatusPanel.tsx:67) | CSS caps (badge) |
| `Working…` | fixed | admin | [TournamentStatusPanel.tsx:86](src/features/admin/TournamentStatusPanel.tsx:86) |  |
| `Delete tournament` | fixed | admin | [TournamentStatusPanel.tsx:92](src/features/admin/TournamentStatusPanel.tsx:92) |  |
| `Delete “` | fixed | admin | [TournamentStatusPanel.tsx:94](src/features/admin/TournamentStatusPanel.tsx:94) |  |
| `Unnamed Tournament` | fixed | admin | [TournamentStatusPanel.tsx:94](src/features/admin/TournamentStatusPanel.tsx:94) |  |
| `” for good? Its scores, Setup and screenshots are removed and cannot be brought back.` | fixed | admin | [TournamentStatusPanel.tsx:94](src/features/admin/TournamentStatusPanel.tsx:94) |  |
| `Delete` | fixed | admin | [TournamentStatusPanel.tsx:99](src/features/admin/TournamentStatusPanel.tsx:99) |  |
| `Cancel` | fixed | admin | [TournamentStatusPanel.tsx:102](src/features/admin/TournamentStatusPanel.tsx:102) |  |

### RunningWaterfallPanel.tsx — Running Admin: waterfall graph edit

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `The tournament is running. Rounds that have started keep their rooms; you can still change where their players go next. Saving re-sorts players using the results already entered. If the current round's line-up changes, its rooms are re-drawn, which is only possible before any score is entered there.` | fixed | admin | [RunningWaterfallPanel.tsx:18](src/features/admin/waterfall/RunningWaterfallPanel.tsx:18) |  |
| `Graph saved, "{round name}" re-drawn.` | built | admin | [RunningWaterfallPanel.tsx:76](src/features/admin/waterfall/RunningWaterfallPanel.tsx:76) |  |
| `Graph saved, "{round name}" re-drawn.` | fixed | admin | [RunningWaterfallPanel.tsx:76](src/features/admin/waterfall/RunningWaterfallPanel.tsx:76) |  |
| `WATERFALL BRACKET GRAPH` | fixed | admin | [RunningWaterfallPanel.tsx:107](src/features/admin/waterfall/RunningWaterfallPanel.tsx:107) |  |
| `Edit graph` | fixed | admin | [RunningWaterfallPanel.tsx:124](src/features/admin/waterfall/RunningWaterfallPanel.tsx:124) |  |
| `WATERFALL BRACKET GRAPH` | fixed | admin | [RunningWaterfallPanel.tsx:131](src/features/admin/waterfall/RunningWaterfallPanel.tsx:131) |  |
| `This re-draws "` | fixed | admin | [RunningWaterfallPanel.tsx:156](src/features/admin/waterfall/RunningWaterfallPanel.tsx:156) |  |
| `"'s rooms. Players will be told their new rooms through the live Bracket. Continue?` | fixed | admin | [RunningWaterfallPanel.tsx:156](src/features/admin/waterfall/RunningWaterfallPanel.tsx:156) |  |
| `Continue` | fixed | admin | [RunningWaterfallPanel.tsx:161](src/features/admin/waterfall/RunningWaterfallPanel.tsx:161) |  |
| `Cancel` | fixed | admin | [RunningWaterfallPanel.tsx:163](src/features/admin/waterfall/RunningWaterfallPanel.tsx:163) |  |
| `Save` | fixed | admin | [RunningWaterfallPanel.tsx:169](src/features/admin/waterfall/RunningWaterfallPanel.tsx:169) |  |
| `Cancel` | fixed | admin | [RunningWaterfallPanel.tsx:171](src/features/admin/waterfall/RunningWaterfallPanel.tsx:171) |  |

### admin-actions.ts — Generated: status explanation, publish hint, finish reminder

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Final complete — check the last scores, then Finish tournament.` | fixed | admin | [admin-actions.ts:5](src/features/tournaments/admin-actions.ts:5) |  |
| `To publish, give it a name and add a scheduled date and time.` | fixed | admin | [admin-actions.ts:53](src/features/tournaments/admin-actions.ts:53) |  |
| `To publish, give it a name.` | fixed | admin | [admin-actions.ts:54](src/features/tournaments/admin-actions.ts:54) |  |
| `To publish, add a scheduled date and time.` | fixed | admin | [admin-actions.ts:55](src/features/tournaments/admin-actions.ts:55) |  |
| `Visible to admins only.` | fixed | admin | [admin-actions.ts:85](src/features/tournaments/admin-actions.ts:85) |  |
| `Read-only for everyone. Reopen it to change scores or settings.` | fixed | admin | [admin-actions.ts:88](src/features/tournaments/admin-actions.ts:88) |  |
| `Started {startedText}.` | built | admin | [admin-actions.ts:91](src/features/tournaments/admin-actions.ts:91) |  |
| `Started.` | fixed | admin | [admin-actions.ts:91](src/features/tournaments/admin-actions.ts:91) |  |
| `{Started … . / Started. }Finish it once the Final is complete and its scores are checked.` | built | admin | [admin-actions.ts:92](src/features/tournaments/admin-actions.ts:92) |  |
| `On the Tournaments page. "Starting soon" from 1 hour before the scheduled time.` | fixed | admin | [admin-actions.ts:94](src/features/tournaments/admin-actions.ts:94) |  |

## 9. Header and shell (all screens)

Header tabs, connection banners, sign-in dialog, account menu, page title and the not-found page.

**How the generated sentences read** (examples for orientation, not counted below):

| Sentence | Built in | Example output |
| --- | --- | --- |
| Account menu | [AccountMenu.tsx:40](src/features/shell/AccountMenu.tsx:40) | Signed in · Tour Host · Sign out (name) — role names are built from the CFP role enum (`formatAccountRole`: "TOUR_HOST" → "Tour Host") |
| Tab labels | [tabs.ts:6](src/features/shell/tabs.ts:6) | Tournaments · Info · Admin · Bracket · Standings tab = Qualification / Swiss / Groups · Rankings (Players before the start) |

### auth.shared.ts — Role name in the account menu

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Role {role}` | built | admin | [auth.shared.ts:115](src/features/auth/auth.shared.ts:115) |  |

### AuthProvider.tsx — Sign-in error messages

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Your CFP account does not have Tournament Hub admin access.` | fixed | admin | [AuthProvider.tsx:184](src/features/auth/AuthProvider.tsx:184) |  |
| `Your CFP account does not have Tournament Hub admin access.` | fixed | admin | [AuthProvider.tsx:213](src/features/auth/AuthProvider.tsx:213) |  |
| `CFP did not return a login token.` | fixed | admin | [AuthProvider.tsx:215](src/features/auth/AuthProvider.tsx:215) |  |
| `Unable to sign in.` | fixed | admin | [AuthProvider.tsx:230](src/features/auth/AuthProvider.tsx:230) |  |

### CfpLoginModal.tsx — Sign in with CFP dialog

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Sign in with CFP` | fixed | admin | [CfpLoginModal.tsx:36](src/features/auth/CfpLoginModal.tsx:36) |  |
| `Tournament Hub administration is available to CFP tour hosts, moderators, developers, and administrators.` | fixed | admin | [CfpLoginModal.tsx:39](src/features/auth/CfpLoginModal.tsx:39) |  |
| `Email` | fixed | admin | [CfpLoginModal.tsx:41](src/features/auth/CfpLoginModal.tsx:41) |  |
| `Password` | fixed | admin | [CfpLoginModal.tsx:55](src/features/auth/CfpLoginModal.tsx:55) |  |
| `Signing in…` | fixed | admin | [CfpLoginModal.tsx:71](src/features/auth/CfpLoginModal.tsx:71) |  |
| `Sign in` | fixed | admin | [CfpLoginModal.tsx:71](src/features/auth/CfpLoginModal.tsx:71) |  |
| `Cancel` | fixed | admin | [CfpLoginModal.tsx:73](src/features/auth/CfpLoginModal.tsx:73) |  |

### tour-permissions.server.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `You must sign in with CFP to manage a tournament.` | fixed | admin | [tour-permissions.server.ts:10](src/features/auth/server/tour-permissions.server.ts:10) |  |
| `Your CFP account does not have Tournament Hub admin access.` | fixed | admin | [tour-permissions.server.ts:18](src/features/auth/server/tour-permissions.server.ts:18) |  |

### presence.server-fns.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `This tournament does not exist.` | fixed | admin | [presence.server-fns.ts:23](src/features/presence/presence.server-fns.ts:23) |  |

### presence.shared.ts — Generated: "Ada is editing" next to a Setup field

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Someone` | fixed | admin | [presence.shared.ts:27](src/features/presence/presence.shared.ts:27) |  |
| `{name} is editing` | built | admin | [presence.shared.ts:84](src/features/presence/presence.shared.ts:84) |  |
| `{names joined by ", "} and {last name} are editing` | built | admin | [presence.shared.ts:85](src/features/presence/presence.shared.ts:85) |  |

### AccountMenu.tsx — Header: signed-in menu (admins)

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `· {role}` | fixed | admin | [AccountMenu.tsx:40](src/features/shell/AccountMenu.tsx:40) |  |
| `· {role}` | built | admin | [AccountMenu.tsx:40](src/features/shell/AccountMenu.tsx:40) |  |
| `Sign out (` | fixed | admin | [AccountMenu.tsx:56](src/features/shell/AccountMenu.tsx:56) | completed with {name} and ")" in the code |

### AppHeader.tsx — Header: tab bar

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `CFP Tournament Hub` | fixed | both | [AppHeader.tsx:79](src/features/shell/AppHeader.tsx:79) |  |
| `Tournament sections` | fixed | both | [AppHeader.tsx:82](src/features/shell/AppHeader.tsx:82) |  |
| `This tournament` | fixed | both | [AppHeader.tsx:88](src/features/shell/AppHeader.tsx:88) |  |

### AppShell.tsx — Shell: connection banner and waiting dialog

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `⚠ Live connection lost — what you're seeing may be out of date. Reload to try reconnecting.` | fixed | both | [AppShell.tsx:67](src/features/shell/AppShell.tsx:67) |  |
| `Dismiss` | fixed | both | [AppShell.tsx:87](src/features/shell/AppShell.tsx:87) |  |
| `Waiting for the tournament to start…` | fixed | viewer | [AppShell.tsx:124](src/features/shell/AppShell.tsx:124) |  |
| `Live sync unavailable` | fixed | viewer | [AppShell.tsx:126](src/features/shell/AppShell.tsx:126) |  |
| `Connecting…` | fixed | viewer | [AppShell.tsx:127](src/features/shell/AppShell.tsx:127) |  |
| `This link is valid, but the organiser hasn’t generated a schedule yet. This page updates automatically once they do.` | fixed | viewer | [AppShell.tsx:132](src/features/shell/AppShell.tsx:132) |  |
| `The live-sync library couldn’t load — check your connection and reload the page.` | fixed | viewer | [AppShell.tsx:134](src/features/shell/AppShell.tsx:134) |  |
| `Loading the live tournament.` | fixed | viewer | [AppShell.tsx:135](src/features/shell/AppShell.tsx:135) |  |

### tabs.ts — Tab labels

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Tournaments` | fixed | both | [tabs.ts:6](src/features/shell/tabs.ts:6) |  |
| `Info` | fixed | both | [tabs.ts:7](src/features/shell/tabs.ts:7) |  |
| `Admin` | fixed | both | [tabs.ts:8](src/features/shell/tabs.ts:8) |  |
| `Bracket` | fixed | both | [tabs.ts:9](src/features/shell/tabs.ts:9) |  |
| `Standings` | fixed | both | [tabs.ts:10](src/features/shell/tabs.ts:10) | Shown as Qualification / Swiss / Groups once the tournament has such a phase; hidden without one (standings-names.ts) |
| `Rankings` | fixed | both | [tabs.ts:11](src/features/shell/tabs.ts:11) |  |
| `Players` | fixed | both | [tabs.ts:59](src/features/shell/tabs.ts:59) | Name of the Rankings tab before the tournament starts |

### firebase-client.ts — Live-sync failure message

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Live sync unavailable — Firebase failed to initialize` | fixed | both | [firebase-client.ts:45](src/features/sync/firebase-client.ts:45) |  |

### TournamentProvider.tsx — Error text shown in admin alerts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Something went wrong. Try again.` | fixed | both | [TournamentProvider.tsx:110](src/features/tournament/TournamentProvider.tsx:110) |  |
| `There is no tournament to start.` | fixed | both | [TournamentProvider.tsx:390](src/features/tournament/TournamentProvider.tsx:390) |  |
| `There is no tournament to reset.` | fixed | both | [TournamentProvider.tsx:406](src/features/tournament/TournamentProvider.tsx:406) |  |
| `There is no tournament to change.` | fixed | both | [TournamentProvider.tsx:422](src/features/tournament/TournamentProvider.tsx:422) |  |

### useTournamentTitle.ts — Fallback name for a tournament without a title

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Unnamed Tournament` | fixed | both | [useTournamentTitle.ts:7](src/features/tournament/useTournamentTitle.ts:7) |  |

### __root.tsx — Browser tab title and "page not found"

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `Curve Fever Pro Tournament Hub` | fixed | both | [__root.tsx:14](src/routes/__root.tsx:14) |  |
| `Page not found` | fixed | both | [__root.tsx:62](src/routes/__root.tsx:62) |  |
| `The tournament hub currently exposes only the main application route.` | fixed | both | [__root.tsx:63](src/routes/__root.tsx:63) |  |

## 10. Messages from the data layer that can reach a screen

Messages written in server functions and data helpers; they reach the screen as the text of an admin Alert or a browser dialog (via `errorText`).

### screenshots.server-fns.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `A tournament holds at most {MAX_SCREENSHOTS} screenshots. Delete one first.` | built | admin | [screenshots.server-fns.ts:16](src/features/tournaments/screenshots.server-fns.ts:16) |  |
| `This tournament does not exist.` | fixed | admin | [screenshots.server-fns.ts:25](src/features/tournaments/screenshots.server-fns.ts:25) |  |
| `This tournament is finished. Reopen it to change its screenshots.` | fixed | admin | [screenshots.server-fns.ts:27](src/features/tournaments/screenshots.server-fns.ts:27) |  |

### screenshots.shared.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `The screenshot must be a WebP, PNG or JPEG image.` | fixed | admin | [screenshots.shared.ts:40](src/features/tournaments/screenshots.shared.ts:40) |  |
| `The screenshot is empty.` | fixed | admin | [screenshots.shared.ts:42](src/features/tournaments/screenshots.shared.ts:42) |  |
| `The screenshot is too large ({size} KB; the limit is {limit} KB).` | built | admin | [screenshots.shared.ts:45](src/features/tournaments/screenshots.shared.ts:45) |  |
| `A tournament cannot copy screenshots onto itself.` | fixed | admin | [screenshots.shared.ts:65](src/features/tournaments/screenshots.shared.ts:65) |  |

### tournament-lifecycle.server-fns.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `A tournament with this ID already exists.` | fixed | both | [tournament-lifecycle.server-fns.ts:40](src/features/tournaments/tournament-lifecycle.server-fns.ts:40) |  |
| `This tournament has already started.` | fixed | both | [tournament-lifecycle.server-fns.ts:113](src/features/tournaments/tournament-lifecycle.server-fns.ts:113) |  |

### tournament-lifecycle.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `This tournament is already published.` | fixed | admin | [tournament-lifecycle.ts:43](src/features/tournaments/tournament-lifecycle.ts:43) |  |
| `Give the tournament a title before publishing it.` | fixed | admin | [tournament-lifecycle.ts:44](src/features/tournaments/tournament-lifecycle.ts:44) |  |
| `Set a date and time before publishing the tournament.` | fixed | admin | [tournament-lifecycle.ts:45](src/features/tournaments/tournament-lifecycle.ts:45) |  |
| `Only a published tournament can be unpublished.` | fixed | admin | [tournament-lifecycle.ts:48](src/features/tournaments/tournament-lifecycle.ts:48) |  |
| `A tournament that has started cannot be unpublished.` | fixed | admin | [tournament-lifecycle.ts:49](src/features/tournaments/tournament-lifecycle.ts:49) |  |
| `Only a draft or a test run can be deleted.` | fixed | admin | [tournament-lifecycle.ts:53](src/features/tournaments/tournament-lifecycle.ts:53) |  |
| `This tournament is already finished.` | fixed | admin | [tournament-lifecycle.ts:55](src/features/tournaments/tournament-lifecycle.ts:55) |  |
| `A tournament that has not started cannot be finished.` | fixed | admin | [tournament-lifecycle.ts:56](src/features/tournaments/tournament-lifecycle.ts:56) |  |
| `Only a finished tournament can be reopened.` | fixed | admin | [tournament-lifecycle.ts:58](src/features/tournaments/tournament-lifecycle.ts:58) |  |
| `Reopen the tournament before sending it back to draft.` | fixed | admin | [tournament-lifecycle.ts:60](src/features/tournaments/tournament-lifecycle.ts:60) |  |
| `This tournament has not started.` | fixed | admin | [tournament-lifecycle.ts:61](src/features/tournaments/tournament-lifecycle.ts:61) |  |
| `This tournament has already started.` | fixed | admin | [tournament-lifecycle.ts:63](src/features/tournaments/tournament-lifecycle.ts:63) |  |
| `Give the tournament a title before starting it.` | fixed | admin | [tournament-lifecycle.ts:65](src/features/tournaments/tournament-lifecycle.ts:65) |  |

### tournament-updates.ts

| Text | Kind | Who | Where | Note |
| --- | --- | --- | --- | --- |
| `This tournament has no status: it was created before statuses existed.` | fixed | admin | [tournament-updates.ts:29](src/features/tournaments/tournament-updates.ts:29) |  |
| `Only a draft can be marked as a test run.` | fixed | admin | [tournament-updates.ts:207](src/features/tournaments/tournament-updates.ts:207) |  |
| `This tournament is finished. Reopen it to change it.` | fixed | admin | [tournament-updates.ts:244](src/features/tournaments/tournament-updates.ts:244) |  |

## 11. Shared UI (src/components/**)

No user-visible words are written in `src/components/**`: `Button`, `Badge`, `Alert`, `Modal`, `Table`, `Stats`, `Form`, `PageHeading`, `SectionPanel`, `Surface` and `TournamentUnit` only show text handed to them. What they do decide is capitals:

| Component | Effect | Where |
| --- | --- | --- |
| `PageHeading` | the tournament name is normal case; its `label` (the view name underneath) is in capitals | [typography.ts:7](src/components/ui/typography.ts:7) |
| `Badge` | every badge text is in capitals | [Badge.tsx:17](src/components/ui/Badge.tsx:17) |
| `TableHeadCell` | every table header is in capitals | [Table.tsx:8](src/components/ui/Table.tsx:8) |
| `Stats` | every stat label is in capitals | [Stats.tsx:9](src/components/ui/Stats.tsx:9) |
| `SectionPanel` | the title is a small capital label, or normal case when `large` (running Admin: "Settings", "Tournament progress") | [SectionPanel.tsx:46](src/components/ui/SectionPanel.tsx:46) |
| Column title, room header, panel label classes | capitals | [typography.ts:11](src/components/ui/typography.ts:11) |

## Appendix: texts found but left out of the tables

Developer-facing only (logs, validation errors a viewer cannot trigger, environment names). Edit freely; none appears on a screen.

| File | What |
| --- | --- |
| [firebase-admin.server.ts](src/features/sync/firebase-admin.server.ts) | Firebase timeout and credential errors (server log) |
| [tournament-write.shared.ts](src/features/sync/tournament-write.shared.ts) | "Invalid tournament patch / setup field …" validation errors |
| [tournament-lifecycle.shared.ts](src/features/tournaments/tournament-lifecycle.shared.ts) | "Invalid setup / tournament / test-run mark" validation errors |
| [tournament-summary.ts](src/features/tournaments/tournament-summary.ts) | "Invalid tournament summary" validation errors |
| [TournamentProvider.tsx](src/features/tournament/TournamentProvider.tsx) | "Could not save tournament state / the Setup form" (console warnings only); "useTournamentApp requires TournamentProvider." |
| [AuthProvider.tsx](src/features/auth/AuthProvider.tsx) | `useAuth must be used inside AuthProvider.`; cookie strings |

