import type { StandingsKind } from '../../domain/tournament/standings-display';

export interface StandingsNames {
  /** The tab, the page heading label and the Bracket column title: "Qualification". */
  title: string;
  /** The same name inside a sentence: "#6 in qualification", "All → Swiss". */
  inline: string;
  /** The title of the explanation box on the page. */
  explainer: string;
}

const NAMES: Record<StandingsKind, StandingsNames> = {
  qualification: { title: 'Qualification', inline: 'qualification', explainer: 'How qualification works' },
  swiss: { title: 'Swiss', inline: 'Swiss', explainer: 'How the Swiss stage works' },
  groups: { title: 'Groups', inline: 'groups', explainer: 'How the group stage works' },
};

/** What the standings are called, after the pooling phase that keeps them. */
export function standingsNames(kind: StandingsKind): StandingsNames {
  return NAMES[kind];
}
