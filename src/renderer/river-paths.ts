import type { WorldHydrology } from '../../shared/world-hydrology.ts';

export interface RiverPoint { x: number; y: number }
export interface RiverReach {
  cells: number[]; points: RiverPoint[]; runoff: number;
  minX: number; maxX: number; minY: number; maxY: number;
}
export type RiverCommand = { kind: 'move' | 'line'; x: number; y: number }
  | { kind: 'curve'; cx: number; cy: number; x: number; y: number };

/** Presentation geometry from the validated graph. Every edge occurs once;
 * junctions, water boundaries and source cells keep their exact coordinates.
 */
export function buildRiverReaches(water: WorldHydrology, width: number): RiverReach[] {
  const edges = water.rivers.cells.map((cell, at) => ({ cell, next: water.rivers.next[at], runoff: water.rivers.runoff[at] }));
  const lakeCells = new Set<number>();
  for (const lake of water.lakes) {
    for (const cell of lake.cells) lakeCells.add(cell);
    if (lake.outlet) edges.push(lake.outlet);
  }
  const byCell = new Map(edges.map((edge, at) => [edge.cell, at]));
  const incoming = new Map<number, number>();
  for (const edge of edges) incoming.set(edge.next, (incoming.get(edge.next) ?? 0) + 1);
  const visited = new Uint8Array(edges.length), reaches: RiverReach[] = [];
  for (let start = 0; start < edges.length; start++) {
    const first = edges[start];
    if (incoming.get(first.cell) === 1 && !lakeCells.has(first.cell)) continue;
    const cells = [first.cell]; let at = start, runoff = 0;
    while (!visited[at]) {
      visited[at] = 1; const edge = edges[at];
      cells.push(edge.next); runoff = Math.max(runoff, edge.runoff);
      const next = byCell.get(edge.next);
      if (next === undefined || incoming.get(edge.next) !== 1 || lakeCells.has(edge.next)) break;
      at = next;
    }
    const points = [{ x: cells[0] % width + 0.5, y: Math.floor(cells[0] / width) + 0.5 }];
    for (let i = 1; i < cells.length; i++) {
      const dx = ((cells[i] % width - cells[i - 1] % width + width * 1.5) % width) - width / 2;
      points.push({ x: points[i - 1].x + dx, y: Math.floor(cells[i] / width) + 0.5 });
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    reaches.push({ cells, points, runoff, minX, maxX, minY, maxY });
  }
  if (visited.some(value => !value)) throw new Error('The river display graph contains an unresolved cycle.');
  return reaches;
}

/** Round each ordinary bend between shared edge midpoints, entirely inside its
 * routed cell. Do not displace a river into neighboring terrain or move a fork.
 */
export function riverPathCommands(points: readonly RiverPoint[]): RiverCommand[] {
  if (!points.length) return [];
  const result: RiverCommand[] = [{ kind: 'move', ...points[0] }];
  if (points.length > 2) {
    result.push({ kind: 'line', x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
    for (let i = 1; i < points.length - 1; i++) result.push({ kind: 'curve', cx: points[i].x, cy: points[i].y,
      x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 });
  }
  if (points.length > 1) result.push({ kind: 'line', ...points[points.length - 1] });
  return result;
}

export function riverAppearance(runoff: number, zoom: number, scale: number) {
  const detail = Math.min(1, Math.max(0, (zoom - 1) / 3));
  const threshold = 22000 * (1 - detail) ** 2;
  const reveal = Math.min(1, Math.max(0, (runoff - threshold) / Math.max(1, threshold * 0.6)));
  const strength = Math.min(1, Math.sqrt(runoff / 60000));
  return { opacity: reveal * (0.32 + strength * 0.58),
    width: Math.min(3.5, (0.15 + strength * 0.95) * Math.sqrt(scale) + (1 - detail) * strength * 0.5) };
}
