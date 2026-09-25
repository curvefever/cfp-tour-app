/**
 * Exact minimum-cost assignment of `n` rows (members) to `n` columns (rooms),
 * returning the *lexicographically smallest* optimal assignment: row 0 takes
 * the earliest column any optimal assignment gives it, then row 1 the earliest
 * that still leaves an optimal assignment, and so on. That matches what a
 * brute-force search over column permutations in order, keeping the first one
 * with the lowest cost, returns -- ties are common in room seeding.
 *
 * Method: the Hungarian algorithm (O(n^3)) yields optimal dual potentials
 * u/v. Every optimal assignment uses only "tight" cells (reduced cost
 * cost[i][j] - u[i] - v[j] == 0) and every perfect matching in the tight
 * cells is optimal, so the tie-break reduces to finding the lexicographically
 * smallest perfect matching in the tight graph: fix rows one at a time, and
 * for each try the earliest tight column that a single augmenting path can
 * still complete (O(n^4) overall, trivial for the room counts here).
 *
 * Costs are floats, so "tight" is compared with a small relative tolerance.
 */
const TIGHT_TOLERANCE = 1e-9;

interface HungarianResult {
  rowToColumn: number[];
  rowPotential: number[];
  columnPotential: number[];
}

function hungarian(cost: number[][]): HungarianResult {
  const n = cost.length;
  // 1-indexed potentials and matching, with a dummy row/column 0.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const matchOfColumn = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let row = 1; row <= n; row += 1) {
    matchOfColumn[0] = row;
    let column0 = 0;
    const minValue = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = matchOfColumn[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= n; column += 1) {
        if (used[column]) continue;
        const reduced = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (reduced < minValue[column]) {
          minValue[column] = reduced;
          way[column] = column0;
        }
        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= n; column += 1) {
        if (used[column]) {
          u[matchOfColumn[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (matchOfColumn[column0] !== 0);
    do {
      const column1 = way[column0];
      matchOfColumn[column0] = matchOfColumn[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const rowToColumn = new Array<number>(n).fill(-1);
  for (let column = 1; column <= n; column += 1) rowToColumn[matchOfColumn[column] - 1] = column - 1;
  return { rowToColumn, rowPotential: u.slice(1), columnPotential: v.slice(1) };
}

export function lexicographicMinAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const scale = Math.max(1, ...cost.flat().map((value) => Math.abs(value)));
  const tolerance = TIGHT_TOLERANCE * scale;
  const { rowToColumn: optimal, rowPotential, columnPotential } = hungarian(cost);
  const tight = cost.map((row, i) =>
    row.map((value, j) => value - rowPotential[i] - columnPotential[j] <= tolerance),
  );

  const rowToColumn = [...optimal];
  const columnToRow = new Array<number>(n).fill(-1);
  rowToColumn.forEach((column, row) => {
    columnToRow[column] = row;
  });
  const fixedColumn = new Array<boolean>(n).fill(false);

  // Finds an augmenting path (over tight cells, skipping fixed columns and the
  // column just claimed) that gives `row` a column, moving matched rows along.
  const augment = (row: number, blocked: number, visited: boolean[]): boolean => {
    for (let column = 0; column < n; column += 1) {
      if (!tight[row][column] || fixedColumn[column] || column === blocked || visited[column]) continue;
      visited[column] = true;
      if (columnToRow[column] === -1 || augment(columnToRow[column], blocked, visited)) {
        columnToRow[column] = row;
        rowToColumn[row] = column;
        return true;
      }
    }
    return false;
  };

  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      if (!tight[row][column] || fixedColumn[column]) continue;
      if (rowToColumn[row] === column) {
        fixedColumn[column] = true;
        break;
      }
      // Try to give `row` this column: its current owner needs a new one.
      const savedRowToColumn = [...rowToColumn];
      const savedColumnToRow = [...columnToRow];
      const owner = columnToRow[column];
      columnToRow[savedRowToColumn[row]] = -1;
      rowToColumn[row] = column;
      columnToRow[column] = row;
      rowToColumn[owner] = -1;
      if (augment(owner, column, new Array<boolean>(n).fill(false))) {
        fixedColumn[column] = true;
        break;
      }
      savedRowToColumn.forEach((value, index) => {
        rowToColumn[index] = value;
      });
      savedColumnToRow.forEach((value, index) => {
        columnToRow[index] = value;
      });
    }
  }
  return rowToColumn;
}
