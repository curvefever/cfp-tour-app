/**
 * The recurring text styles of the redesign (brief section 2). Desktop sizes; phone sizes come with the phone chunks.
 * Plain class strings, like `controlClassName` in Form.tsx, so a component can append its own classes with `cn()`.
 */

/** The tournament name at the top of a page. */
export const pageTitleClassName = 'text-[28px] leading-tight font-bold';

/** The view name under the page title ("BRACKET", "ADMIN", "SETUP"). */
export const viewLabelClassName = 'text-lg leading-[1.1] font-extrabold tracking-[0.06em] text-muted uppercase';

/** A column or table title in the game look ("ROUND 4", "STANDINGS"). */
export const columnTitleClassName = 'text-[19px] leading-tight font-extrabold tracking-[0.02em] uppercase';

/** A room's header in the game look ("ROOM A", "SEMI B"). */
export const roomHeaderClassName = 'text-base font-extrabold tracking-[0.04em] uppercase';

/** A small section label inside a middle-look panel ("TOURNAMENT", "ROSTER"). */
export const panelLabelClassName = 'text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase';
