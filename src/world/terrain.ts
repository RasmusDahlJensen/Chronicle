import type { TerrainWorld } from '../../shared/terrain.ts';
export type { Terrain, TerrainCell, TerrainWorld } from '../../shared/terrain.ts';

export function summarizeTerrain(world: TerrainWorld) {
  const areas = { totalKm2: 0, landKm2: 0, waterKm2: 0, plainsKm2: 0, hillsKm2: 0 };
  for (const cell of world.cells) {
    areas.totalKm2 += world.cellAreaKm2;
    if (cell.terrain === 'water') areas.waterKm2 += world.cellAreaKm2;
    else {
      areas.landKm2 += world.cellAreaKm2;
      if (cell.terrain === 'plains') areas.plainsKm2 += world.cellAreaKm2;
      else areas.hillsKm2 += world.cellAreaKm2;
    }
  }
  return areas;
}
