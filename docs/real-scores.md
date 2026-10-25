# Real scores

What room scores in real Curve Fever Pro tournaments look like, per game mode. Read when a rule or a tool depends on scores: tie-breaks, lucky losers, relative scores, seeding or scoring simulations. Twelve events, not every mode (team modes with rooms of 3 are the thinnest: 10 rooms): treat the figures as orders of magnitude.

"Relative score" is the app's measure: score ÷ room average (1.00 = average, `relativeRoomShare`). "Share beaten" is (room size − place) ÷ (room size − 1). An **effective** room size counts only the units present (absentees below).

## Sources

| Mode | Format | Source | Rooms | Notes |
|---|---|---|---|---|
| Classic FFA | ffa | organiser spreadsheet, Sep. 20 | 25 (5 qualification rounds × 5) | drawn as rooms of 8; 24 absentee entries |
| FFA Colosseum | ffa | organiser spreadsheet, 4/2025 | 31 (4 qualification rounds × 5, then bracket) | class kits with chosen powers; drawn as rooms of 8; 11 absentee entries |
| FFA | ffa | app tournament `1792087808730` (test site) | 8 | qualification rounds had 2 absentees per room, entered as 1 and 2 |
| Classic Teams | 2v2v2v2 | organiser spreadsheet, Jun. 13 | 12 (3 qualification rounds × 4) | team score = both members; an "-empty-" team in some rooms |
| Save Your Buddy | 2v2v2v2 | organiser spreadsheet, Feb. 18 | 34 (4 qualification rounds × 4, then bracket) | score = the defender's |
| Teams survival | 2v2v2v2 | app tournament `1792339397443` (production) | 36 | the exception below |
| 1v1 | individual-1v1 | organiser spreadsheet, May 17 | 72 | rooms of 2 only |
| FFA Anniversary | ffa | organiser spreadsheet, 10/2025 | 27 (4 qualification rounds × 4, then bracket) | a set of powers per round; drawn as rooms of 8; 14 absentee entries |
| FFA Grand Resurrection | ffa | organiser spreadsheet, May 2023 | 99 (10 rounds, 16 rooms down to 2) | 128 players; rooms drawn by results after the first two rounds; two late rounds mix rooms of 8 and 6; 23 absentee entries |
| FFA Shopping | ffa | organiser spreadsheet, 11/2025 | 18 (4 qualification rounds × 3, then bracket) | powers bought with coins earned by place; 23 players drawn in 3 rooms of 8 (empty seats); 6 absentee entries |
| FFA Winner Picks | ffa | organiser spreadsheet, 8/2025 | 17 (4 qualification rounds × 3, then bracket) | each room's previous winner picks the powers; 1 absentee entry |
| 3v3 Teams | 3v3 | organiser spreadsheet, 5/2025 | 40 (4 qualification rounds × 6, then a ladder and bracket) | head-to-head, 12 teams; team score = the three members |

The spreadsheets are the organiser's local files (not tracked). An anonymised extract of the rooms of the first seven (names replaced by ids, absentees flagged) is tracked in `scripts/seeding-simulation/real-rooms.json`; the simulation reads it. The last five were checked against the simulation afterwards and fell inside its range (below), so they are described here but not in the extract. FFA Random Powers was looked at and left out: its results are close to random by design.

## Score scale grows with the room

A game runs to a target that grows with the number of opponents, so raw scores can't be compared across room sizes; relative scores can. Medians by effective room size:

| Mode | Size | Winner | Room total |
|---|---|---|---|
| Classic FFA | 8 / 7 / 6 | 430 / 379 / 313 | 2360 / 1696 / 1281 |
| FFA Colosseum | 8 / 7 / 6 | 375 / 323 / 280 | 1985 / 1526 / 1209 |
| Classic Teams | 4 / 3 | 726 / 501 | 2339 / 1393 |
| Save Your Buddy | 4 / 3 | 368 / 280 | 1166 / 607 |
| 1v1 | 2 | 156 | 261 |
| Four other FFA events (pooled) | 8 / 7 / 6 | 381 / 322 / 272 | 2006 / 1548 / 1200 |
| 3v3 Teams | 2 | 683 | 1156 |

The winner scores about 61–63 points per opponent in Classic FFA and 51–59 in Colosseum and the four other FFA events. The runner-up is close behind: the winner's score is a median 1.17–1.20 times the second's in FFA and team modes.

**Teams survival is the exception**: points come only from other teams dying, and targets are tiny (winners 18–21 in rooms of 4, 12–13 in rooms of 3; every room total a multiple of n(n−1)/2). Don't generalise from it.

## Relative score by place

Medians, best place first:

| Mode | Size | Relative score by place |
|---|---|---|
| Classic FFA | 8 | 1.53 1.36 1.15 1.04 0.97 0.79 0.74 0.43 |
| | 7 | 1.50 1.24 1.13 1.02 0.88 0.73 0.51 |
| | 6 | 1.50 1.19 1.05 0.96 0.86 0.51 |
| FFA Colosseum | 8 | 1.44 1.26 1.13 1.05 0.98 0.88 0.72 0.53 |
| | 7 | 1.46 1.17 1.10 1.00 0.92 0.76 0.52 |
| | 6 | 1.39 1.14 1.03 0.88 0.86 0.67 |
| Four other FFA events | 8 | 1.49 1.28 1.15 1.06 0.95 0.81 0.68 0.52 |
| | 7 | 1.46 1.27 1.11 1.02 0.90 0.76 0.51 |
| | 6 | 1.39 1.18 1.05 0.94 0.85 0.63 |
| Classic Teams | 4 | 1.35 1.08 0.90 0.64 |
| | 3 | 1.25 0.98 0.82 |
| Save Your Buddy | 4 | 1.24 1.04 0.91 0.80 |
| | 3 | 1.35 0.98 0.73 |

- In FFA the profile follows the share beaten whatever the room size: about 1.4–1.5 for the winner, about 1.0 in the middle, and a sharp drop for the last place (0.43–0.67).
- Spread inside a room (standard deviation of relative scores, median over rooms): FFA 0.27–0.32, 2v2v2v2 0.19–0.23, 1v1 0.20, 3v3 0.16.
- Lucky-loser candidates across sizes: a 3rd of 4 has a higher relative score than a last of 3 in 91% of the pairs (2v2v2v2, 36 × 10 rooms); a 7th of 8 beats a last of 7 in 85% (qualification rounds of the six FFA events, 58 × 47 rooms). Over every round it drops to 80%, because rounds drawn by results compare rooms of different strength.

## How predictable a mode is

Correlation of a unit's result between consecutive qualification rounds (absentees removed; bracket rounds left out, since their fields are filtered by results):

| Mode | Relative score | Share beaten | Pairs |
|---|---|---|---|
| Classic FFA | 0.62 | 0.56 | 140 |
| FFA Colosseum | 0.56 | 0.59 | 80 |
| FFA (`1792087808730`, all rounds before the Final) | 0.62 | 0.55 | 36 |
| Classic Teams | 0.23 | 0.29 | 30 |
| Save Your Buddy | 0.45 | 0.33 | 48 |
| FFA Anniversary | 0.49 | 0.40 | 85 |
| FFA Grand Resurrection (first two rounds only) | 0.62 | 0.51 | 121 |
| FFA Shopping | 0.62 | 0.46 | 63 |
| FFA Winner Picks | 0.44 | 0.40 | 71 |
| 3v3 Teams (head-to-head) | 0.25 | 0.22 | 36 |
| **Pooled FFA** (Classic, Colosseum) | 0.60 | 0.57 | 220 |
| **Pooled four other FFA events** | 0.56 | 0.45 | 340 |
| **Pooled six FFA events** | 0.58 | 0.50 | 560 |
| **Pooled 2v2v2v2** | 0.37 | 0.32 | 78 |

FFA results are clearly more predictable than team results, though less in the four other FFA events (powers change every round) than in Classic FFA and Colosseum. In Classic FFA and Colosseum the relative score is about as consistent as the place; in the four other FFA events it is clearly more consistent (0.56 against 0.45), so margins do carry some information beyond the place. The team samples are small.

The room-size fairness simulation (`run-study.ts`) used two predictability levels, about 0.57 and 0.32 by share beaten: every event above falls between them or close to one of them. Its margin models carry less information than the four other FFA events show, so its results for rules based on relative scores are on the cautious side. Draws based on results lower these figures (strong units meet strong units), so compare them only with figures computed under a similar draw.

## Absentees

Registered units that don't show up are common. In Classic FFA the 5 absentees stayed in the draw for all 5 qualification rounds (24 entries, scored 0 to 0.5), so effective rooms ranged from 5 to 8 although every room was drawn as 8. The four other FFA events show the same: 44 absentee entries over 161 rooms, effective rooms of 5 to 8. In the app an absentee is whatever score the organiser types: a typed score counts as a last place, raises the present units' places, and counts in the room size of the relative score (in `1792087808730`, 6 present players in a room of 8 had every relative score raised by 8/6). Smaller-room seats are counted from the draw, so they don't see absentees. Marking a unit absent is in `docs/roadmap.md`.

## Community scoring conventions in the spreadsheets

- FFA (Classic, Colosseum, Anniversary, Winner Picks): points table 10, 8, 6, 5, 4, 3, 2, 1 (Winner Picks splits a tie: two 3rd places earn 5.5 each), an absentee earns 0, so a room with one absentee awards 10 down to 2 (last place dropped, like the app's Standard points). Tie-break: score ÷ the room's highest score (Classic FFA), total raw score (Colosseum). The app's Standard points award 8 down to 1 instead (`docs/open-items.md`).
- Classic Teams: 6, 4, 2, 0; a room of 3 awards 6, 4, 2. Same order as the app's Standard points.
- Save Your Buddy: 4, 3, 2, 1.
- 1v1 (Swiss): a win earns 4 and a loss 0, but a close game earns 2.5 and 1.5: the margin counts.
- 3v3 Teams: a win earns 6 and a loss 0, but a very close game (the loser within about 5%) earns 4 and 2.
- FFA Grand Resurrection: tie-break by the most points scored in the round, then a coin toss.
