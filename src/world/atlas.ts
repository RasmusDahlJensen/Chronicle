import { BIOME_IDS, RESOURCE_IDS, isWaterBiome, type Biome, type Resource, type AtlasWorld } from '../../shared/atlas.ts';
export { BIOME_IDS, RESOURCE_IDS, isWaterBiome } from '../../shared/atlas.ts';
export type { Biome, Resource, AtlasCell, AtlasProvince, AtlasCountry, AtlasAnnotation, AtlasWorld } from '../../shared/atlas.ts';

export const BIOMES: Record<Biome, { label: string; color: string }> = {
  ocean: { label: 'Deep ocean', color: '#174d69' }, coast: { label: 'Shallow sea', color: '#329aab' },
  grassland: { label: 'Grassland', color: '#9da954' }, forest: { label: 'Forest', color: '#346444' },
  rainforest: { label: 'Rainforest', color: '#1e5947' }, desert: { label: 'Sand & desert', color: '#dcb577' },
  savanna: { label: 'Savanna', color: '#b1a85c' }, wetland: { label: 'Wetland', color: '#608e80' },
  tundra: { label: 'Tundra', color: '#9ba995' }, mountain: { label: 'Mountains', color: '#8d8f89' },
  snow: { label: 'Snow & ice', color: '#e8eee9' },
};
export const RESOURCES: Record<Resource, { label: string; color: string; symbol: string }> = {
  fish: { label: 'Fish', color: '#69c9de', symbol: '≈' }, grain: { label: 'Grain', color: '#ecd17e', symbol: '♧' },
  timber: { label: 'Timber', color: '#94c580', symbol: '♠' }, game: { label: 'Game', color: '#e6ba8d', symbol: '♈' },
  stone: { label: 'Stone', color: '#c7cac4', symbol: '◆' }, iron: { label: 'Iron', color: '#ccd3d8', symbol: 'Fe' },
  copper: { label: 'Copper', color: '#e8a174', symbol: 'Cu' }, gold: { label: 'Gold', color: '#f1cb69', symbol: 'Au' },
  salt: { label: 'Salt', color: '#edeae0', symbol: '◇' }, coal: { label: 'Coal', color: '#a7abb1', symbol: '●' },
  uranium: { label: 'Uranium', color: '#bdd783', symbol: 'U' },
};

export interface ProvinceSummary {
  cellCount: number;
  areaKm2: number;
  resourceSites: number;
  resources: Record<Resource, number>;
}

function emptyResourceCounts(): Record<Resource, number> {
  return Object.fromEntries(RESOURCE_IDS.map(id => [id, 0])) as Record<Resource, number>;
}

export function summarizeAtlas(world: AtlasWorld) {
  const biomes = Object.fromEntries(BIOME_IDS.map(id => [id, 0])) as Record<Biome, number>;
  const resources = emptyResourceCounts();
  const provinces = new Map<string, ProvinceSummary>(world.provinces.map(province => [province.id, {
    cellCount: 0, areaKm2: 0, resourceSites: 0, resources: emptyResourceCounts(),
  }]));
  let waterKm2 = 0;
  let resourceSites = 0;
  for (const cell of world.cells) {
    biomes[cell.biome] += world.cellAreaKm2;
    if (cell.resource !== null) {
      resources[cell.resource]++;
      resourceSites++;
    }
    if (isWaterBiome(cell.biome)) waterKm2 += world.cellAreaKm2;
    if (cell.provinceId !== null) {
      const province = provinces.get(cell.provinceId)!;
      province.cellCount++;
      province.areaKm2 += world.cellAreaKm2;
      if (cell.resource !== null) {
        province.resources[cell.resource]++;
        province.resourceSites++;
      }
    }
  }
  const totalKm2 = world.cells.length * world.cellAreaKm2;
  return { totalKm2, waterKm2, landKm2: totalKm2 - waterKm2, biomes, resources, resourceSites, cellsWithoutResource: world.cells.length - resourceSites, provinces };
}
