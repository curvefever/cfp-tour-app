import type { StripeTone } from '../tournament/components/result-row';

/** The colour of a stripe or a header in the picture: the Bracket's exit colours, never an undecided (dashed) one. */
export type PictureTone = Exclude<StripeTone, 'dashed'>;

/** One block of a card: its stripe (two stacked tones for a lucky or best-of-a-place block, top first) and its text lines. */
export interface PictureBlock {
  tones: PictureTone[];
  lines: string[];
}

/** The rooms of a round that exit alike. `label` is null while the round has one group only. */
export interface PictureRoomGroup {
  label: string | null;
  blocks: PictureBlock[];
}

export interface PictureCard {
  /** The round's name, or its merged name ("Round 6 · B, C"). */
  name: string;
  /** The colour of its header: the earliest column that sends players to it, the most favourable of its bands. */
  tone: PictureTone;
  /** "×2": how many rooms the card holds; null for one room. */
  tag: string | null;
  /** The room sizes and the match format ("8p each · 1 game"), or the match format alone while there are room labels. */
  sub: string;
  groups: PictureRoomGroup[];
  /** The bracket column it is played in, from 0 (the pooling block, when there is one, is drawn before it). */
  column: number;
  /** The row from the top, from 0. */
  row: number;
  /** The rounds of `state.rounds` the card shows. */
  rounds: number[];
}

/** The rounds before the bracket: their wording and the places that go through, as the last pooling round routes them. */
export interface PicturePooling {
  title: string;
  /** The plain lines under the title: rounds and games, rooms, which rounds count, the round notes. */
  lines: string[];
  /** The blocks under "After the last round". */
  afterLast: PictureBlock[];
}

export interface SchedulePictureModel {
  header: { title: string; formatLine: string; count: string };
  pooling: PicturePooling | null;
  cards: PictureCard[];
}

/** How the format counts what plays in a room: teams or players, and whether a room of two is a match. */
export interface PictureUnits {
  team: boolean;
  headToHead: boolean;
}
