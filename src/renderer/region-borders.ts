/**
 * Region border geometry from the simulation's cell index (region id + 1, 0 for water). Borders are cell edges
 * between two different land regions, merged into straight runs; coastlines are already drawn by the terrain.
 */
export interface BorderRun { x1: number; y1: number; x2: number; y2: number }

export function regionBorderRuns(cells: Uint16Array, width: number, height: number): BorderRun[] {
  const runs: BorderRun[] = [];
  // Vertical edges: between column x and x + 1 (wrapping), merged down each column.
  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const a = y < height ? cells[y * width + x] : 0, b = y < height ? cells[y * width + (x + 1) % width] : 0;
      const edge = a !== 0 && b !== 0 && a !== b;
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { runs.push({ x1: x + 1, y1: start, x2: x + 1, y2: y }); start = -1; }
    }
  }
  // Horizontal edges: between row y and y + 1, merged along each row.
  for (let y = 0; y < height - 1; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const a = x < width ? cells[y * width + x] : 0, b = x < width ? cells[(y + 1) * width + x] : 0;
      const edge = a !== 0 && b !== 0 && a !== b;
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { runs.push({ x1: start, y1: y + 1, x2: x, y2: y + 1 }); start = -1; }
    }
  }
  return runs;
}
