import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';

/** The member line broken only between names: each name stays whole, the separator ends the line before. */
function WrappingMembers({ members, separator }: { members: string[]; separator: string }) {
  return members.map((member, index) => {
    const last = index === members.length - 1;
    return (
      <span key={`${member}-${index}`}>
        <span className='whitespace-nowrap'>
          {member}
          {last ? '' : separator.trimEnd()}
        </span>
        {last ? '' : ' '}
      </span>
    );
  });
}

export function TournamentUnit({
  name,
  separator = ' · ',
  state,
  wrapMembers = false,
}: {
  name: string;
  separator?: string;
  state: TournamentState;
  /** Let the member line wrap between names (a table cell of limited width). */
  wrapMembers?: boolean;
}) {
  const info = unitDisplay(state, name);
  return (
    <span>
      <strong>{info.label}</strong>
      {info.members?.length ? (
        <small className='mt-0.5 block font-normal text-muted'>
          {wrapMembers ? (
            <WrappingMembers members={info.members} separator={separator} />
          ) : (
            info.members.join(separator)
          )}
        </small>
      ) : null}
    </span>
  );
}
