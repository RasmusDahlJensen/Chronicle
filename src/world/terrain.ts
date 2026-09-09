export type Terrain = 'water' | 'plains' | 'hills';

export interface TerrainCell {
  id: number;
  terrain: Terrain;
  /** Metres above sea level; negative values are sea depth. */
  elevation: number;
  provinceId: string | null;
}

export interface TerrainWorld {
  fixtureId: string;
  fixtureVersion: number;
  name: string;
  width: number;
  height: number;
  cellAreaKm2: number;
  cells: TerrainCell[];
  provinces: { id: string; name: string; sovereignId: string | null }[];
}

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
