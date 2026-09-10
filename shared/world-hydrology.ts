import { Type, type Static } from 'typebox';

const cell = () => Type.Integer({ minimum: 0, maximum: 524287 });
const runoff = () => Type.Integer({ minimum: 1, maximum: 510000000 });
export const WorldHydrologySchema = Type.Object({
  drySinks: Type.Array(cell(), { maxItems: 524288 }),
  rivers: Type.Object({
    cells: Type.Array(cell(), { maxItems: 524288 }), next: Type.Array(cell(), { maxItems: 524288 }),
    runoff: Type.Array(runoff(), { maxItems: 524288 }),
  }, { additionalProperties: false }),
  lakes: Type.Array(Type.Object({
    id: Type.Integer({ minimum: 1, maximum: 524288 }),
    cells: Type.Array(cell(), { minItems: 1, maxItems: 524288 }),
    level: Type.Integer({ minimum: 0, maximum: 8800 }),
    outlet: Type.Union([Type.Null(), Type.Object({ cell: cell(), next: cell(), runoff: runoff() }, { additionalProperties: false })]),
  }, { additionalProperties: false }), { maxItems: 524288 }),
}, { additionalProperties: false });
export type WorldHydrology = Static<typeof WorldHydrologySchema>;
export interface WaterFacts {
  kind: 'dry' | 'ocean' | 'river' | 'lake'; freshwater: 'none' | 'river' | 'lake' | 'lakeshore'; runoff: number;
  lake: { id: number; areaKm2: number; level: number; depth: number; closed: boolean } | null;
}
export interface HydrologyIndex {
  lakeByCell: Uint32Array; riverByCell: Int32Array;
}
interface Surface { elevation: Int16Array; biome: Uint8Array }
interface Shape { width: number; height: number; areaKm2: number }
const invalid = () => new Error('The generated world hydrology was invalid. Try loading it again.');

export function neighboringCells(id: number, width: number, height: number): number[] {
  const x = id % width, y = Math.floor(id / width), cells: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || y + dy < 0 || y + dy >= height) continue;
    cells.push((y + dy) * width + (x + dx + width) % width);
  }
  return cells;
}

/** Validate the sparse network against the authoritative terrain, including
 * lake ownership, real adjacent downstream edges, cycles and conserved inflow.
 */
export function validateWorldHydrology(data: WorldHydrology, shape: Shape, surface: Surface,
  isLake: (code: number) => boolean, isMarine: (code: number) => boolean): HydrologyIndex {
  const { width, height } = shape, count = width * height, rivers = data.rivers;
  if (rivers.cells.length !== rivers.next.length || rivers.cells.length !== rivers.runoff.length
    || rivers.cells.length > count || data.lakes.length > count) throw invalid();
  const lakeByCell = new Uint32Array(count), riverByCell = new Int32Array(count).fill(-1);
  const inRange = (id: number) => Number.isInteger(id) && id >= 0 && id < count;
  const adjacent = (a: number, b: number) => {
    if (!inRange(a) || !inRange(b) || a === b) return false;
    const dx = Math.abs(a % width - b % width), dy = Math.abs(Math.floor(a / width) - Math.floor(b / width));
    return Math.min(dx, width - dx) <= 1 && dy <= 1;
  };
  for (const [index, lake] of data.lakes.entries()) {
    if (lake.id !== index + 1) throw invalid();
    for (const id of lake.cells) {
      if (!inRange(id) || lakeByCell[id] || !isLake(surface.biome[id]) || lake.level <= surface.elevation[id]) throw invalid();
      const bed = surface.elevation[id];
      if (bed < 0 ? lake.level !== 0 : lake.level - bed > 20) throw invalid();
      lakeByCell[id] = lake.id;
    }
  }
  const visited = new Uint8Array(count), queue = new Uint32Array(count);
  for (const lake of data.lakes) {
    let head = 0, tail = 0; queue[tail++] = lake.cells[0]; visited[lake.cells[0]] = 1;
    while (head < tail) for (const next of neighboringCells(queue[head++], width, height)) {
      if (!visited[next] && lakeByCell[next] === lake.id) { visited[next] = 1; queue[tail++] = next; }
    }
    if (tail !== lake.cells.length) throw invalid();
    for (const id of lake.cells) {
      const x = id % width, row = id - x;
      for (const next of [row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width]) {
        if (next >= 0 && next < count && lakeByCell[next] !== lake.id && next !== lake.outlet?.next
          && surface.elevation[next] < lake.level) throw invalid();
      }
    }
  }
  for (let id = 0; id < count; id++) if (isLake(surface.biome[id]) !== Boolean(lakeByCell[id])) throw invalid();
  for (const [index, id] of rivers.cells.entries()) {
    if (!inRange(id) || riverByCell[id] !== -1 || lakeByCell[id] || isMarine(surface.biome[id])) throw invalid();
    riverByCell[id] = index;
  }
  const drySinks = new Set(data.drySinks), sinkFlow = new Float64Array(count);
  if (drySinks.size !== data.drySinks.length) throw invalid();
  for (const id of drySinks) if (!inRange(id) || lakeByCell[id] || riverByCell[id] >= 0 || isMarine(surface.biome[id])) throw invalid();
  const nodes = rivers.cells.length + data.lakes.length;
  const nextNode = new Int32Array(nodes).fill(-1), incoming = new Float64Array(nodes), outgoing = new Float64Array(nodes);
  const level = (id: number) => lakeByCell[id] ? data.lakes[lakeByCell[id] - 1].level : isMarine(surface.biome[id]) ? 0 : surface.elevation[id];
  const node = (id: number) => lakeByCell[id] ? rivers.cells.length + lakeByCell[id] - 1 : riverByCell[id];
  let terminalFlow = 0;
  function edge(index: number, from: number, to: number, flow: number) {
    if (!adjacent(from, to) || level(from) < level(to)) throw invalid();
    const target = node(to);
    if (target < 0 && !isMarine(surface.biome[to]) && !drySinks.has(to)) throw invalid();
    if (target === index) throw invalid();
    nextNode[index] = target; outgoing[index] = flow;
    if (target >= 0) incoming[target] += flow;
    else { terminalFlow += flow; if (drySinks.has(to)) sinkFlow[to] += flow; }
  }
  for (let index = 0; index < rivers.cells.length; index++) edge(index, rivers.cells[index], rivers.next[index], rivers.runoff[index]);
  for (const lake of data.lakes) if (lake.outlet) {
    const { cell: from, next, runoff: flow } = lake.outlet;
    if (!inRange(from) || lakeByCell[from] !== lake.id || lakeByCell[next] === lake.id) throw invalid();
    edge(rivers.cells.length + lake.id - 1, from, next, flow);
  }
  for (let id = 0; id < nodes; id++) {
    const closed = id >= rivers.cells.length && data.lakes[id - rivers.cells.length].outlet === null;
    if (!closed && incoming[id] > outgoing[id]) throw invalid();
    if (closed) terminalFlow += incoming[id];
  }
  // Weak outflows may infiltrate/evaporate in explicitly mapped dry basins.
  // A significant accumulated river must end in standing water or the ocean.
  for (const id of drySinks) if (sinkFlow[id] <= 0 || sinkFlow[id] >= 5000) throw invalid();
  if (terminalFlow > shape.areaKm2 + count / 2) throw invalid();
  const state = new Uint8Array(nodes);
  for (let id = 0; id < nodes; id++) {
    let current = id;
    while (current >= 0 && !state[current]) { state[current] = 1; current = nextNode[current]; }
    if (current >= 0 && state[current] === 1) throw invalid();
    current = id;
    while (current >= 0 && state[current] === 1) { state[current] = 2; current = nextNode[current]; }
  }
  // Marine cells must actually connect to an open polar boundary. Diagonal
  // corner contact does not turn an enclosed inland body into ocean.
  visited.fill(0); let head = 0, tail = 0;
  for (let x = 0; x < width; x++) for (const id of [x, (height - 1) * width + x]) {
    if (!visited[id] && isMarine(surface.biome[id])) { visited[id] = 1; queue[tail++] = id; }
  }
  while (head < tail) {
    const id = queue[head++], x = id % width, row = id - x;
    for (const next of [row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width]) {
      if (next < 0 || next >= count || visited[next] || !isMarine(surface.biome[next])) continue;
      visited[next] = 1; queue[tail++] = next;
    }
  }
  for (let id = 0; id < count; id++) if (isMarine(surface.biome[id]) && !visited[id]) throw invalid();
  return { lakeByCell, riverByCell };
}

export function inspectWorldWater(data: WorldHydrology, index: HydrologyIndex, shape: Shape,
  surface: Surface, id: number, isMarine: (code: number) => boolean): WaterFacts {
  const lakeId = index.lakeByCell[id], river = index.riverByCell[id];
  if (lakeId) {
    const lake = data.lakes[lakeId - 1], closed = lake.outlet === null;
    return { kind: 'lake', freshwater: closed ? 'none' : 'lake', runoff: lake.outlet?.runoff ?? 0,
      lake: { id: lakeId, areaKm2: lake.cells.length * shape.areaKm2 / (shape.width * shape.height),
        level: lake.level, depth: lake.level - surface.elevation[id], closed } };
  }
  if (isMarine(surface.biome[id])) return { kind: 'ocean', freshwater: 'none', runoff: 0, lake: null };
  if (river >= 0) return { kind: 'river', freshwater: 'river', runoff: data.rivers.runoff[river], lake: null };
  const shore = neighboringCells(id, shape.width, shape.height).some(next => {
    const neighbor = index.lakeByCell[next]; return neighbor && data.lakes[neighbor - 1].outlet !== null;
  });
  return { kind: 'dry', freshwater: shore ? 'lakeshore' : 'none', runoff: 0, lake: null };
}
