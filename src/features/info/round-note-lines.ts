import { parseRulesInline, type RulesInline } from './rules-text';

/** The lines of a round settings note, blank ones dropped, each with the rules text's inline formatting. */
export function roundNoteLines(text: string): RulesInline[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseRulesInline);
}
