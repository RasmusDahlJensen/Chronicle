import type { Resource } from '../../shared/atlas.ts';

interface ResourceRule {
  kind: 'renewable' | 'mineral';
  extractionTechnology: string;
}

/** Site requirements for the atlas. Knowledge, labor and production are later world systems. */
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
