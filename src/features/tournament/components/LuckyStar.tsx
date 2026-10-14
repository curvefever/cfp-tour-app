/** The green star after a lucky loser's name; a candidate (not decided yet) reads as a candidate. */
export function LuckyStar({ candidate = false }: { candidate?: boolean }) {
  const label = candidate ? 'Lucky loser candidate' : 'Lucky loser';
  return (
    <span aria-label={label} className='ml-1 text-cfp-green' role='img' title={label}>
      ★
    </span>
  );
}
