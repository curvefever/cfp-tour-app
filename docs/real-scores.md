# Real scores

What room scores in real Curve Fever Pro tournaments look like, per game mode. Read when a rule or a tool depends on scores: tie-breaks, lucky losers, relative scores, seeding or scoring simulations. Seven events, not every mode: treat the figures as orders of magnitude.

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

The spreadsheets are the organiser's local files (not tracked). FFA Random Powers was looked at and left out: its results are close to random by design.

## Score scale grows with the room

A game runs to a target that grows with the number of opponents, so raw scores can't be compared across room sizes; relative scores can. Medians by effective room size:

| Mode | Size | Winner | Room total |
|---|---|---|---|
| Classic FFA | 8 / 7 / 6 | 430 / 379 / 313 | 2360 / 1696 / 1281 |
| FFA Colosseum | 8 / 7 / 6 | 375 / 323 / 280 | 1985 / 1526 / 1209 |
| Classic Teams | 4 / 3 | 726 / 501 | 2339 / 1393 |
| Save Your Buddy | 4 / 3 | 368 / 280 | 1166 / 607 |
| 1v1 | 2 | 156 | 261 |

The winner scores about 61–63 points per opponent in Classic FFA and 54–56 in Colosseum. The runner-up is close behind: the winner's score is a median 1.17–1.20 times the second's in FFA and team modes.

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
| Classic Teams | 4 | 1.35 1.08 0.90 0.64 |
| | 3 | 1.25 0.98 0.82 |
| Save Your Buddy | 4 | 1.24 1.04 0.91 0.80 |
| | 3 | 1.35 0.98 0.73 |

- In FFA the profile follows the share beaten whatever the room size: about 1.4–1.5 for the winner, about 1.0 in the middle, and a sharp drop for the last place (0.43–0.67).
- Spread inside a room (standard deviation of relative scores, median over rooms): FFA 0.28–0.32, 2v2v2v2 0.19–0.23, 1v1 0.20.
- Lucky-loser candidates across sizes: a 3rd of 4 has a higher relative score than a last of 3 in 91% of the pairs (2v2v2v2, 36 × 10 rooms); a 7th of 8 beats a last of 7 in 85% (Classic FFA and Colosseum, 23 × 20 rooms).

## How predictable a mode is

Correlation of a unit's result between consecutive qualification rounds (absentees removed; bracket rounds left out, since their fields are filtered by results):

| Mode | Relative score | Share beaten | Pairs |
|---|---|---|---|
| Classic FFA | 0.62 | 0.56 | 140 |
| FFA Colosseum | 0.56 | 0.59 | 80 |
| FFA (`1792087808730`, all rounds before the Final) | 0.62 | 0.55 | 36 |
| Classic Teams | 0.23 | 0.29 | 30 |
| Save Your Buddy | 0.45 | 0.33 | 48 |
| **Pooled FFA** (Classic, Colosseum) | 0.60 | 0.57 | 220 |
| **Pooled 2v2v2v2** | 0.37 | 0.32 | 78 |

FFA results are clearly more predictable than team results. The relative score is about as consistent as the place, a little more in the pools, so margins carry little information beyond the place; the team samples are small. Draws based on results lower these figures (strong units meet strong units), so compare them only with figures computed under a similar draw.

## Absentees

Registered units that don't show up are common. In Classic FFA the 5 absentees stayed in the draw for all 5 qualification rounds (24 entries, scored 0 to 0.5), so effective rooms ranged from 5 to 8 although every room was drawn as 8. In the app an absentee is whatever score the organiser types: a typed score counts as a last place, raises the present units' places, and counts in the room size of the relative score (in `1792087808730`, 6 present players in a room of 8 had every relative score raised by 8/6). Smaller-room seats are counted from the draw, so they don't see absentees. Marking a unit absent is in `docs/roadmap.md`.

## Community scoring conventions in the spreadsheets

- FFA (Classic and Colosseum): points table 10, 8, 6, 5, 4, 3, 2, 1, an absentee earns 0, so a room with one absentee awards 10 down to 2 (last place dropped, like the app's Standard points). Tie-break: score ÷ the room's highest score (Classic FFA), total raw score (Colosseum). The app's Standard points award 8 down to 1 instead (`docs/open-items.md`).
- Classic Teams: 6, 4, 2, 0; a room of 3 awards 6, 4, 2. Same order as the app's Standard points.
- Save Your Buddy: 4, 3, 2, 1.
- 1v1 (Swiss): a win earns 4 and a loss 0, but a close game earns 2.5 and 1.5: the margin counts.
