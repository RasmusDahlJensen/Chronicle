import { Type, type Static } from 'typebox';

/**
 * Biome and resource codes shared by generation, contracts and rendering. Their order is the numeric encoding of
 * generated worlds (biome byte; resource code = index + 1), so never reorder or rename them.
 */
export const BIOME_IDS = ['ocean', 'coast', 'grassland', 'forest', 'rainforest', 'desert', 'savanna', 'wetland', 'tundra', 'mountain', 'snow'] as const;
export const RESOURCE_IDS = ['fish', 'grain', 'timber', 'game', 'stone', 'iron', 'copper', 'gold', 'salt', 'coal', 'uranium'] as const;
export const BiomeSchema = Type.Enum(BIOME_IDS);
export const ResourceSchema = Type.Enum(RESOURCE_IDS);
export type Biome = Static<typeof BiomeSchema>;
export type Resource = Static<typeof ResourceSchema>;
