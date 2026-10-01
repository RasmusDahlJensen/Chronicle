import type { Biome, Resource } from '../../shared/atlas.ts';
export type { Biome, Resource } from '../../shared/atlas.ts';

/** Map labels and colors for the biome and resource codes. */
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
