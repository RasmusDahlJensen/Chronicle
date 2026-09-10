import type { WorldSettings } from './generated-world.ts';

/** Disposable worker jobs: authored studies or a versioned seeded geography preview. */
export type TerrainStudy = 'aster' | 'verdant' | ({ kind: 'world' } & WorldSettings);
