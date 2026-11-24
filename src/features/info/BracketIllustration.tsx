const WIDTH = 120;
const HEIGHT = 92;
const LEAVES = 8;
const SLOT_WIDTH = 18;
const SLOT_HEIGHT = 7;
const FINAL_WIDTH = SLOT_WIDTH * 1.4;
const COLUMNS = Math.log2(LEAVES);
const COLUMN_WIDTH = (WIDTH - FINAL_WIDTH) / COLUMNS;

interface Tree {
  slots: Array<{ x: number; y: number }>;
  elbows: string[];
  final: { x: number; y: number };
}

/**
 * A one-sided tree read left to right: 8 slots, then 4, then 2, each pair joined by an elbow, ending at the Final.
 * The same for every tournament; the numbers are fixed, nothing in it is read from a schedule.
 */
function bracketTree(): Tree {
  const slots: Tree['slots'] = [];
  const elbows: string[] = [];
  let ys = Array.from({ length: LEAVES }, (_, leaf) => (HEIGHT * (leaf + 0.5)) / LEAVES);
  let x = 0;
  while (ys.length > 1) {
    const edge = x + SLOT_WIDTH;
    const middle = edge + (COLUMN_WIDTH - SLOT_WIDTH) / 2;
    const next: number[] = [];
    for (let at = 0; at < ys.length; at += 2) {
      const [upper, lower] = [ys[at], ys[at + 1]];
      const joined = (upper + lower) / 2;
      elbows.push(
        `M${edge} ${upper}H${middle}V${lower}H${edge}M${middle} ${joined}H${edge + COLUMN_WIDTH - SLOT_WIDTH}`,
      );
      next.push(joined);
    }
    ys.forEach((y) => slots.push({ x, y }));
    ys = next;
    x += COLUMN_WIDTH;
  }
  return { slots, elbows, final: { x, y: ys[0] } };
}

const TREE = bracketTree();

/** A generic bracket drawing for the Format card, in the game look's colours: blue slots and lines, a green Final. */
export function BracketIllustration({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
    >
      {TREE.slots.map(({ x, y }) => (
        <rect
          fill='var(--color-cfp-brand)'
          fillOpacity={0.45}
          height={SLOT_HEIGHT}
          key={`${x}-${y}`}
          rx={1.5}
          width={SLOT_WIDTH}
          x={x}
          y={y - SLOT_HEIGHT / 2}
        />
      ))}
      <path
        d={TREE.elbows.join('')}
        fill='none'
        stroke='var(--color-cfp-brand)'
        strokeOpacity={0.8}
        strokeWidth={1.5}
      />
      <rect
        fill='var(--color-cfp-green)'
        height={SLOT_HEIGHT * 1.6}
        rx={2}
        width={FINAL_WIDTH}
        x={TREE.final.x}
        y={TREE.final.y - SLOT_HEIGHT * 0.8}
      />
    </svg>
  );
}
