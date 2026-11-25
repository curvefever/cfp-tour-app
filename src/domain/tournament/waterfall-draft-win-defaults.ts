import { QUAL_LABEL } from './waterfall-graph-text';
import { waterfallDraftColumns, type WaterfallDraft } from './waterfall-draft';
import { winsSourceKey } from './waterfall-draft-wins';

/**
 * What a band into a WINS round needs when the organiser types nothing, for the editor's "default: n" hint: the same
 * rule the validator applies (`resolveWinTargets`), read off the draft. The unit from the earlier column needs 1, the
 * one from the later column 2; the Qual and Groups line is column 0.
 */

/** The sources of the bands that route units into `destination`, in the order the text writes them: the Qual line first, then the rounds. */
function winsSources(draft: WaterfallDraft, destination: string): string[] {
  const fromQual = draft.qualRoutes?.includes(destination) ? [winsSourceKey(QUAL_LABEL, 0)] : [];
  const fromRounds = draft.rounds.flatMap((round) =>
    (draft.routes[round.label] ?? []).flatMap((room, roomIndex) =>
      room.includes(destination) ? [winsSourceKey(round.label, roomIndex)] : [],
    ),
  );
  return [...fromQual, ...fromRounds];
}

function sourceColumn(columns: Record<string, number>, key: string): number | undefined {
  return key === QUAL_LABEL ? 0 : columns[key.slice(0, key.lastIndexOf('.'))];
}

/**
 * The default wins of the band from `sourceKey` into the WINS round `destination`: 1 or 2 by column, or null when
 * the draft can't say (the columns can't be worked out, the round has not two bands yet, or both come from one column).
 */
export function defaultWinsOf(draft: WaterfallDraft, destination: string, sourceKey: string): number | null {
  const sources = winsSources(draft, destination);
  const columns = waterfallDraftColumns(draft);
  if (!columns || sources.length !== 2 || !sources.includes(sourceKey)) return null;
  const own = sourceColumn(columns, sourceKey);
  const other = sourceColumn(columns, sources.find((key) => key !== sourceKey) as string);
  if (own === undefined || other === undefined || own === other) return null;
  return own < other ? 1 : 2;
}
