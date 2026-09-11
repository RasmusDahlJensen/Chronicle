export interface TerritoryEdge { x1: number; y1: number; x2: number; y2: number }

/** Outer and hole boundaries of actual cells. Longitude wraps; the poles do not. */
export function territoryEdges(cells: readonly number[], width: number, height: number): TerritoryEdge[] {
  const owned = new Set(cells), edges: TerritoryEdge[] = [];
  for (const id of [...owned].sort((a, b) => a - b)) {
    const x = id % width, y = Math.floor(id / width);
    if (y === 0 || !owned.has(id - width)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y });
    if (!owned.has(y * width + (x + 1) % width)) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
    if (y === height - 1 || !owned.has(id + width)) edges.push({ x1: x + 1, y1: y + 1, x2: x, y2: y + 1 });
    if (!owned.has(y * width + (x + width - 1) % width)) edges.push({ x1: x, y1: y + 1, x2: x, y2: y });
  }
  return edges;
}
