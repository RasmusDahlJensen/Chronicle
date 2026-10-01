export interface HydrologyInput {
  width: number; height: number; areaKm2: number;
  elevation: Int16Array; moisture: Uint16Array;
}
export interface Hydrology {
  ocean: Uint8Array; lake: Uint32Array; waterLevel: Int16Array;
  downstream: Int32Array; runoff: Uint32Array; river: Uint8Array;
  lakes: { id: number; cells: number[]; level: number; outlet: number | null }[];
}

const MAX_CELLS = 1024 * 512;
const MAX_PASSES = 48;
const MAX_NEW_DEPTH = 20;
const MAX_NEW_LAKE_AREA = 100000;
const RIVER_RUNOFF = 5000;
type Lake = Hydrology['lakes'][number];
type Neighbors = (cell: number) => number[];
interface Drainage { waterLevel: Int16Array; downstream: Int32Array; order: Uint32Array; rank: Uint32Array }

/** Annual drainage preview. Runoff is moisture-weighted catchment area in km²,
 * not a measured discharge. Bedrock and the established sea-level outline stay
 * immutable; inland water has its own surface and connectivity.
 */
export function generateHydrology(input: HydrologyInput): Hydrology {
  const { width, height, elevation, moisture, areaKm2 } = input, count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || count > MAX_CELLS
    || !(elevation instanceof Int16Array) || !(moisture instanceof Uint16Array)
    || elevation.length !== count || moisture.length !== count || moisture.some(value => value > 1000)
    || elevation.some(value => value < -10000 || value > 8800)
    || !Number.isFinite(areaKm2) || areaKm2 <= 0 || areaKm2 >= 2 ** 32) throw new Error('Invalid hydrology input.');
  const adjacent: Neighbors = cell => {
    const x = cell % width, row = cell - x;
    return [row + (x + 1) % width, row + (x + width - 1) % width,
      cell >= width ? cell - width : -1, cell < count - width ? cell + width : -1];
  };
  const ocean = connectedOcean(elevation, width, adjacent);
  const cellArea = areaKm2 / count;
  const sources = Uint32Array.from(moisture, (value, cell) => elevation[cell] < 0 ? 0
    : Math.round(cellArea * (Math.max(0, value - 250) / 750) ** 2));
  const sinks = new Map<number, number>();
  // Retention can oscillate: a pit beside a spill path at the same level (or two equal minima) is
  // raised as a dry river terminal, loses its catchment to the spill path, is lowered again as an
  // unsupplied pond, and the next pass repeats it. A repeated sink state can never converge, so its
  // oscillating cells keep the highest level they reached as fixed ponds, which may be small closed
  // lakes without supply. Worlds that never repeat a state are unaffected (G1).
  const seen = new Map<string, number>(), states: Map<number, number>[] = [], fixed = new Set<number>();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const drainage = flood(elevation, sinks, adjacent);
    const bodies = waterBodies(elevation, ocean, drainage.waterLevel, adjacent);
    // Resolve lake confluences before measuring their supply. Combining their
    // tributaries can sustain a downstream pond that separate flood roots could
    // not, especially in a dry basin below wet uplands.
    connectLakes(bodies.lakes, bodies.lake, drainage, adjacent);
    const order = topologicalOrder(drainage.downstream, drainage.waterLevel);
    const runoff = accumulate(drainage.downstream, order, sources);
    const supply = new Float64Array(bodies.lakes.length + 1);
    for (let cell = 0; cell < count; cell++) {
      const body = bodies.lake[cell];
      if (body) supply[body] += sources[cell];
      const next = drainage.downstream[cell];
      if (next >= 0 && bodies.lake[next] && bodies.lake[next] !== body) supply[bodies.lake[next]] += runoff[cell];
    }
    let changed = false;
    for (let cell = 0; cell < count; cell++) {
      if (drainage.downstream[cell] < 0 && elevation[cell] >= 0 && !bodies.lake[cell] && runoff[cell] >= RIVER_RUNOFF) {
        sinks.set(cell, elevation[cell] + 1); changed = true;
      }
    }
    for (const body of bodies.lakes) {
      // Existing enclosed seas retain their accepted level and footprint. Their
      // closed status does not imply freshwater or a simulated salt balance.
      if (body.cells.some(cell => elevation[cell] < 0)) continue;
      let minimum = body.cells[0], moistureSum = 0;
      for (const cell of body.cells) { if (elevation[cell] < elevation[minimum]) minimum = cell; moistureSum += moisture[cell]; }
      const depth = body.level - elevation[minimum], area = body.cells.length * cellArea;
      const meanMoisture = moistureSum / body.cells.length / 1000;
      // A normalized retention cost distinguishes permanent water from dry pits.
      // It uses catchment supply, including wet uplands above a dry basin floor.
      const retention = area * (0.08 + 0.12 * (1 - meanMoisture));
      const supplied = supply[body.id] >= retention;
      const resolvedTerminal = depth <= 1 && supply[body.id] >= RIVER_RUNOFF && area <= MAX_NEW_LAKE_AREA;
      const pinned = fixed.size > 0 && body.cells.some(cell => fixed.has(cell));
      if (depth <= MAX_NEW_DEPTH && area <= MAX_NEW_LAKE_AREA && (supplied || resolvedTerminal || pinned)) continue;
      const pondDepth = supplied ? 5 : supply[body.id] >= RIVER_RUNOFF ? 1 : 0;
      const level = elevation[minimum] + Math.min(pondDepth, depth);
      const previous = sinks.get(minimum);
      if (previous === undefined || level < previous) { sinks.set(minimum, level); changed = true; }
      else throw new Error('Hydrology cannot resolve a basin within its lake depth and area bounds.');
    }
    if (changed) {
      let key = '';
      for (const [cell, level] of sinks) key += `${cell}:${level},`;
      const repeated = seen.get(key);
      if (repeated === undefined) { seen.set(key, states.length); states.push(new Map(sinks)); continue; }
      const lowest = new Map<number, number>(), highest = new Map<number, number>();
      for (const state of states.slice(repeated)) for (const [cell, level] of state) {
        lowest.set(cell, Math.min(lowest.get(cell) ?? level, level)); highest.set(cell, Math.max(highest.get(cell) ?? level, level));
      }
      for (const [cell, level] of highest) if (level !== lowest.get(cell)) { sinks.set(cell, level); fixed.add(cell); }
      // Passes now also depend on the fixed ponds, so earlier states no longer predict later ones.
      seen.clear(); states.length = 0;
      continue;
    }
    // A converged pond held above a lower neighbour outside it (other than its outlet) would leak, which
    // the water contract rejects. Release its sinks so it drains through that neighbour, then route again (G1).
    // Worlds whose converged ponds never leak are unaffected.
    const leaking: number[] = [];
    for (const body of bodies.lakes) {
      if (body.cells.some(cell => elevation[cell] < 0)) continue;
      const exit = body.outlet === null ? -1 : drainage.downstream[body.outlet];
      if (body.cells.some(cell => adjacent(cell).some(next => next >= 0 && bodies.lake[next] !== body.id && next !== exit && elevation[next] < body.level))) {
        for (const cell of body.cells) if (sinks.has(cell)) leaking.push(cell);
      }
    }
    if (leaking.length) {
      for (const cell of leaking) { sinks.delete(cell); fixed.delete(cell); }
      seen.clear(); states.length = 0;
      continue;
    }
    const river = new Uint8Array(count);
    const terminal = new Int32Array(count);
    for (const cell of order) terminal[cell] = drainage.downstream[cell] < 0 ? cell : terminal[drainage.downstream[cell]];
    for (let cell = 0; cell < count; cell++) {
      if (!ocean[cell] && !bodies.lake[cell] && runoff[cell] >= RIVER_RUNOFF) {
        const end = terminal[cell];
        if (!ocean[end] && !bodies.lake[end]) throw new Error('Hydrology river reaches an unresolved dry basin.');
        river[cell] = 1;
      }
    }
    return { ocean, ...bodies, waterLevel: drainage.waterLevel, downstream: drainage.downstream, runoff, river };
  }
  throw new Error(`Hydrology did not converge within ${MAX_PASSES} drainage passes.`);
}

function connectedOcean(elevation: Int16Array, width: number, adjacent: Neighbors) {
  const ocean = new Uint8Array(elevation.length), queue = new Uint32Array(elevation.length);
  let head = 0, tail = 0;
  for (let x = 0; x < width; x++) for (const cell of [x, elevation.length - width + x]) {
    if (elevation[cell] < 0 && !ocean[cell]) { ocean[cell] = 1; queue[tail++] = cell; }
  }
  while (head < tail) for (const next of adjacent(queue[head++])) {
    if (next >= 0 && elevation[next] < 0 && !ocean[next]) { ocean[next] = 1; queue[tail++] = next; }
  }
  return ocean;
}

/** Priority-Flood with a stable heap and FIFO depression queue. Each discovered
 * cell records an already draining parent; ranks break flat-terrain ties without
 * adding artificial elevation gradients. Barnes, Lehman & Mulla (2014):
 * https://arxiv.org/abs/1511.04463
 */
function flood(elevation: Int16Array, sinks: Map<number, number>, adjacent: Neighbors): Drainage {
  const count = elevation.length, waterLevel = elevation.slice(), downstream = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count), order = new Uint32Array(count), rank = new Uint32Array(count);
  const heap = new Uint32Array(count), sequence = new Uint32Array(count), pit = new Uint32Array(count);
  let heapSize = 0, serial = 0, ordered = 0, pitHead = 0, pitTail = 0;
  const less = (a: number, b: number) => waterLevel[a] < waterLevel[b] || (waterLevel[a] === waterLevel[b] && sequence[a] < sequence[b]);
  function push(cell: number) {
    sequence[cell] = serial++; let at = heapSize++;
    while (at > 0) { const parent = (at - 1) >> 1; if (!less(cell, heap[parent])) break; heap[at] = heap[parent]; at = parent; }
    heap[at] = cell;
  }
  function pop() {
    const result = heap[0], last = heap[--heapSize];
    if (heapSize) {
      let at = 0;
      while (at * 2 + 1 < heapSize) {
        let child = at * 2 + 1;
        if (child + 1 < heapSize && less(heap[child + 1], heap[child])) child++;
        if (!less(heap[child], last)) break;
        heap[at] = heap[child]; at = child;
      }
      heap[at] = last;
    }
    return result;
  }
  for (let cell = 0; cell < count; cell++) if (elevation[cell] < 0) {
    visited[cell] = 1; waterLevel[cell] = 0; rank[cell] = ordered; order[ordered++] = cell;
  }
  for (const [cell, level] of sinks) { visited[cell] = 1; waterLevel[cell] = level; push(cell); }
  for (let cell = 0; cell < count; cell++) if (elevation[cell] < 0) for (const next of adjacent(cell)) {
    if (next < 0 || visited[next]) continue;
    visited[next] = 1; downstream[next] = cell; waterLevel[next] = Math.max(0, elevation[next]); push(next);
  }
  if (!ordered && !heapSize) throw new Error('Hydrology requires an existing water outlet.');
  while (heapSize || pitHead < pitTail) {
    const cell = pitHead < pitTail ? pit[pitHead++] : pop();
    rank[cell] = ordered; order[ordered++] = cell;
    for (const next of adjacent(cell)) {
      if (next < 0 || visited[next]) continue;
      visited[next] = 1; downstream[next] = cell; waterLevel[next] = Math.max(elevation[next], waterLevel[cell]);
      if (elevation[next] <= waterLevel[cell]) pit[pitTail++] = next; else push(next);
    }
  }
  if (ordered !== count) throw new Error('Hydrology drainage did not visit every cell.');
  for (let cell = 0; cell < count; cell++) if (downstream[cell] >= 0) {
    let drop = 0;
    for (const next of adjacent(cell)) {
      if (next >= 0 && rank[next] < rank[cell] && waterLevel[cell] - waterLevel[next] > drop) {
        drop = waterLevel[cell] - waterLevel[next]; downstream[cell] = next;
      }
    }
  }
  return { waterLevel, downstream, order, rank };
}

function waterBodies(elevation: Int16Array, ocean: Uint8Array, surface: Int16Array, adjacent: Neighbors) {
  const lake = new Uint32Array(elevation.length), lakes: Lake[] = [];
  for (let first = 0; first < elevation.length; first++) {
    if (ocean[first] || lake[first] || (elevation[first] >= 0 && surface[first] <= elevation[first])) continue;
    const id = lakes.length + 1, cells = [first]; lake[first] = id;
    for (let at = 0; at < cells.length; at++) for (const next of adjacent(cells[at])) {
      if (next < 0 || ocean[next] || lake[next] || surface[next] !== surface[first]
        || (elevation[next] >= 0 && surface[next] <= elevation[next])) continue;
      lake[next] = id; cells.push(next);
    }
    lakes.push({ id, cells, level: surface[first], outlet: null });
  }
  return { lake, lakes };
}

function connectLakes(lakes: Lake[], labels: Uint32Array, drainage: Drainage, adjacent: Neighbors) {
  const visited = new Uint8Array(labels.length);
  for (const body of lakes) {
    let root = body.cells[0];
    for (const cell of body.cells) if (drainage.rank[cell] < drainage.rank[root]) root = cell;
    const next = drainage.downstream[root];
    body.outlet = next < 0 ? null : root;
    if (next >= 0 && labels[next] === body.id) throw new Error('Hydrology lake has no canonical outlet.');
    const queue = [root]; visited[root] = 1;
    for (let at = 0; at < queue.length; at++) for (const cell of adjacent(queue[at])) {
      if (cell < 0 || visited[cell] || labels[cell] !== body.id) continue;
      visited[cell] = 1; drainage.downstream[cell] = queue[at]; queue.push(cell);
    }
  }
}

function topologicalOrder(downstream: Int32Array, surface: Int16Array) {
  const incoming = new Uint32Array(downstream.length), queue = new Uint32Array(downstream.length);
  let head = 0, tail = 0;
  for (let cell = 0; cell < downstream.length; cell++) {
    const next = downstream[cell];
    if (next >= 0) {
      if (next >= downstream.length || surface[next] > surface[cell]) throw new Error('Hydrology contains an uphill water edge.');
      incoming[next]++;
    }
  }
  for (let cell = 0; cell < downstream.length; cell++) if (!incoming[cell]) queue[tail++] = cell;
  while (head < tail) { const next = downstream[queue[head++]]; if (next >= 0 && --incoming[next] === 0) queue[tail++] = next; }
  if (tail !== downstream.length) throw new Error('Hydrology drainage contains a cycle.');
  return queue.reverse();
}

function accumulate(downstream: Int32Array, order: Uint32Array, sources: Uint32Array) {
  const result = sources.slice();
  for (let at = order.length - 1; at >= 0; at--) {
    const cell = order[at], next = downstream[cell];
    if (next < 0) continue;
    const total = result[next] + result[cell];
    if (total > 0xffffffff) throw new Error('Hydrology runoff exceeds its numeric range.');
    result[next] = total;
  }
  return result;
}
