import type { WorldSettings } from './generated-world.ts';

/** Disposable worker jobs: a cheap readiness probe or a versioned seeded geography. */
export type TerrainStudy = { kind: 'probe' } | ({ kind: 'world' } & WorldSettings);
