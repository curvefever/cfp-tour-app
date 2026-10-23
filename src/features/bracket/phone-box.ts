/** The width of a Bracket box on a phone: the page's, since one box is shown at a time (`RoundStrip`). */
export const phoneFullWidthClass = 'max-[700px]:w-full max-[700px]:min-w-0';

/** Hides a Bracket box on a phone unless it is the one shown; desktop shows every box. */
export function phoneHiddenClass(shown: boolean): string {
  return shown ? '' : 'max-[700px]:hidden';
}
