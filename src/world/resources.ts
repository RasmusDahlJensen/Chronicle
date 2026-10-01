import type { Resource } from '../../shared/atlas.ts';

interface ResourceRule {
  kind: 'renewable' | 'mineral';
  extractionTechnology: string;
}

/** Site kind and extraction technology per resource. docs/VISION.md requires each technology name to exist unchanged in the simulation's tech data; knowledge, labor and production are simulation rules (src/simulation/), not geography. */
export const RESOURCE_RULES: Readonly<Record<Resource, Readonly<ResourceRule>>> = {
  fish: { kind: 'renewable', extractionTechnology: 'Fishing' },
  grain: { kind: 'renewable', extractionTechnology: 'Agriculture' },
  timber: { kind: 'renewable', extractionTechnology: 'Forestry' },
  game: { kind: 'renewable', extractionTechnology: 'Hunting' },
  stone: { kind: 'mineral', extractionTechnology: 'Masonry' },
  iron: { kind: 'mineral', extractionTechnology: 'Mining' },
  copper: { kind: 'mineral', extractionTechnology: 'Mining' },
  gold: { kind: 'mineral', extractionTechnology: 'Mining' },
  salt: { kind: 'mineral', extractionTechnology: 'Salt harvesting' },
  coal: { kind: 'mineral', extractionTechnology: 'Deep mining' },
  uranium: { kind: 'mineral', extractionTechnology: 'Advanced mining' },
};
