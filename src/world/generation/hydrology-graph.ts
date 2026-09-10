import type { WorldHydrology } from '../../../shared/world-hydrology.ts';
import type { Hydrology } from './hydrology.ts';

/** Retain exact channel edges, including weaker lake outflows, so the sparse
 * published graph never ends on an unexplained dry cell between water bodies.
 */
export function hydrologyGraph(source: Hydrology): WorldHydrology {
  const active = source.river.slice(), sinks = new Set<number>();
  for (const lake of source.lakes) if (lake.outlet !== null) {
    let cell = source.downstream[lake.outlet];
    while (cell >= 0 && !source.ocean[cell] && !source.lake[cell] && !active[cell]) {
      if (source.downstream[cell] < 0) { sinks.add(cell); break; }
      active[cell] = 1; cell = source.downstream[cell];
    }
  }
  const rivers: WorldHydrology['rivers'] = { cells: [], next: [], runoff: [] };
  for (let cell = 0; cell < active.length; cell++) if (active[cell]) {
    rivers.cells.push(cell); rivers.next.push(source.downstream[cell]); rivers.runoff.push(source.runoff[cell]);
  }
  return { drySinks: [...sinks].sort((a, b) => a - b), rivers, lakes: source.lakes.map(lake => ({ id: lake.id, cells: lake.cells, level: lake.level,
    outlet: lake.outlet === null ? null : { cell: lake.outlet, next: source.downstream[lake.outlet], runoff: source.runoff[lake.outlet] } })) };
}
