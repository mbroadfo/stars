// The Infection Lab (S6): a Project Hail Mary-style astrophage percolation
// sim over real Tier 1 star positions. A uniform 3D grid (cell size fixed
// at 8 ly, the canonical astrophage hop range) answers "which stars lie
// within R ly of X" without a rebuild when the hop-range slider moves —
// only the number of cells scanned per query changes.
import { STRIDE } from "./catalog.js";

const CELL_LY = 8;
const cellKey = (ix, iy, iz) => `${ix},${iy},${iz}`;

export function buildNeighborGrid(cat) {
  const grid = new Map();
  const { data, count } = cat;
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    const ix = Math.floor(data[o] / CELL_LY);
    const iy = Math.floor(data[o + 1] / CELL_LY);
    const iz = Math.floor(data[o + 2] / CELL_LY);
    const k = cellKey(ix, iy, iz);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(i);
  }
  return grid;
}

// Candidates within rangeLy of (x,y,z), exact-sphere filtered (the cell
// scan is a cube, so corner cells can contain false positives). `excludeIdx`
// skips a candidate matching that catalog index (the source star itself);
// harmless to pass a value that never appears in the grid (e.g. the Sun's
// sentinel index), since no bucket entry will ever equal it.
function queryNeighborsAt(grid, cat, x, y, z, rangeLy, excludeIdx) {
  const { data } = cat;
  const ix = Math.floor(x / CELL_LY), iy = Math.floor(y / CELL_LY), iz = Math.floor(z / CELL_LY);
  const r = Math.max(1, Math.ceil(rangeLy / CELL_LY));
  const rangeSq = rangeLy * rangeLy;
  const out = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const bucket = grid.get(cellKey(ix + dx, iy + dy, iz + dz));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === excludeIdx) continue;
          const jo = j * STRIDE;
          const ddx = data[jo] - x, ddy = data[jo + 1] - y, ddz = data[jo + 2] - z;
          if (ddx * ddx + ddy * ddy + ddz * ddz <= rangeSq) out.push(j);
        }
      }
    }
  }
  return out;
}

// Candidates within rangeLy of star `idx`.
export function queryNeighbors(grid, cat, idx, rangeLy) {
  const o = idx * STRIDE;
  return queryNeighborsAt(grid, cat, cat.data[o], cat.data[o + 1], cat.data[o + 2], rangeLy, idx);
}

// Percolated-or-died is a first-pass heuristic, not a validated threshold:
// >1% of the Tier 1 catalog infected reads as "took off," below that as a
// local fizzle. Worth revisiting once real runs are in hand.
const PERCOLATION_FRACTION = 0.01;

// Independent-cascade BFS. Each newly-infected star gets one chance to
// expose each not-yet-infected neighbor within range; a failed roll doesn't
// permanently immunize that neighbor — a *different* already-infected
// neighbor can still reach it later on its own turn, which falls out of
// "skip only if already infected" with no extra bookkeeping.
// `patientZeroPos` is required even for an ordinary star (just its own
// x,y,z) — keeps this module ignorant of what a negative `patientZero`
// value might mean (the Sun sentinel is an App.jsx concept); the BFS just
// needs *a* position to seed the first query from.
export function runOutbreak({ cat, grid, patientZero, patientZeroPos, hopRangeLy, transmitChance, incubationYears }) {
  const parent = new Map(); // idx -> parent idx (for the cascade-tree edges)
  const generation = new Map();
  const order = []; // BFS level order: non-decreasing in generation
  generation.set(patientZero, 0);
  order.push(patientZero);
  const queue = [patientZero];
  let head = 0;
  let maxGeneration = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const gen = generation.get(i);
    const neighbors = i === patientZero
      ? queryNeighborsAt(grid, cat, patientZeroPos.x, patientZeroPos.y, patientZeroPos.z, hopRangeLy, patientZero)
      : queryNeighbors(grid, cat, i, hopRangeLy);
    for (const j of neighbors) {
      if (generation.has(j)) continue;
      if (Math.random() >= transmitChance) continue;
      generation.set(j, gen + 1);
      parent.set(j, i);
      order.push(j);
      queue.push(j);
      if (gen + 1 > maxGeneration) maxGeneration = gen + 1;
    }
  }
  // Since incubationYears is a fixed control (not itself randomized) and a
  // star's generation is its shortest infection-hop-count, epoch =
  // generation * incubationYears exactly — cumulativeByGeneration[g] is
  // then an O(1) lookup for "how many are infected by this epoch."
  const cumulativeByGeneration = new Array(maxGeneration + 1).fill(0);
  for (const idx of order) cumulativeByGeneration[generation.get(idx)]++;
  for (let g = 1; g <= maxGeneration; g++) cumulativeByGeneration[g] += cumulativeByGeneration[g - 1];

  const totalInfected = order.length;
  return {
    order, parent, generation,
    cumulativeByGeneration,
    totalInfected,
    maxGeneration,
    maxEpoch: maxGeneration * incubationYears,
    incubationYears,
    percolated: totalInfected / cat.count > PERCOLATION_FRACTION,
  };
}

// Count infected as of a given epoch — O(1) via the cumulative table.
export function infectedCountAtEpoch(run, epoch) {
  if (!run) return 0;
  const gen = Math.min(run.maxGeneration, Math.max(0, Math.floor(epoch / run.incubationYears)));
  return run.cumulativeByGeneration[gen];
}
