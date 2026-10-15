/** Joins words that must stay on one line. */
export const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** Between two team members: the dot stays with the member before it, so a wrapped line breaks after the dot. */
export const MEMBER_SEPARATOR = `${NO_BREAK_SPACE}· `;

/**
 * A team's members on one line that wraps only between members: no-break spaces keep each member's name (and the
 * score after it) in one piece, which breaks inside only when it is wider than the whole line.
 */
export function joinMembers(members: string[]): string {
  return members.map((member) => member.replaceAll(' ', NO_BREAK_SPACE)).join(MEMBER_SEPARATOR);
}
