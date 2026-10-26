import type { SpareCutContender, SpareCutResult } from '../../domain/tournament/fair-cut';

/** A contender's standing among the rooms of its size so far; the first reads in full, the next ones follow on. */
function standingText(contender: SpareCutContender, label: (name: string) => string, first: boolean): string {
  const name = label(contender.unit.name);
  if (contender.percentile < 0) return `${name} ${first ? 'is ' : ''}in a room with no scores yet`;
  const standing = `in the bottom ${Math.round(contender.percentile * 100)}% of rooms of ${contender.size}`;
  return `${name} ${first ? 'is ' : ''}${standing}${first ? ' so far' : ''}`;
}

function joined(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * The line under the lucky-loser lists: who the spare cut is between and who goes out (or, from a double
 * elimination winners round, drops to the losers bracket). Null when no spare cut is left to settle.
 */
export function spareCutText(
  spareCuts: SpareCutResult[],
  label: (name: string) => string,
  dropsToLosers: boolean,
): string | null {
  if (spareCuts.length === 0) return null;
  const contenders: SpareCutContender[] = [];
  for (const cut of spareCuts) {
    for (const entry of cut.contenders) {
      if (!contenders.some((known) => known.unit.name === entry.unit.name)) contenders.push(entry);
    }
  }
  const out = spareCuts.map((cut) => label(cut.out.unit.name));
  const outcome = dropsToLosers
    ? `${joined(out)} ${out.length === 1 ? 'drops' : 'drop'} to the losers bracket.`
    : `${joined(out)} ${out.length === 1 ? 'goes' : 'go'} out.`;
  const prefix = spareCuts.length === 1 ? 'Spare cut' : 'Spare cuts';
  return `${prefix}: ${contenders.map((entry, index) => standingText(entry, label, index === 0)).join(', ')}. ${outcome}`;
}
