import { RESOURCE_IDS, type Resource } from '../../shared/atlas.ts';
import { RESOURCE_RULES } from '../world/resources.ts';
import type { Knowledge } from './knowledge.ts';
import { TECH_INDEX, TECHS, validateTechs } from './techs.ts';

/**
 * Resource gating (VISION.md "Resource gating"): per polity every deposit is unknown (invisible), known but unusable,
 * or usable. A resource is revealed by a tech (or from the start), extracted by the tech `RESOURCE_RULES` names, and
 * some need a further tech before they are any use.
 */
export const DEPOSIT_STATES = ['unknown', 'known', 'usable'] as const;
export type DepositState = typeof DEPOSIT_STATES[number];

const revealedBy = new Map<Resource, string>(), usedBy = new Map<Resource, string[]>();
for (const definition of TECHS) {
  for (const resource of definition.effects.reveal ?? []) revealedBy.set(resource, definition.id);
  for (const resource of definition.effects.use ?? []) usedBy.set(resource, [...(usedBy.get(resource) ?? []), definition.id]);
}

/** A deposit's state for a polity with this knowledge. */
export function depositState(knowledge: Knowledge, resource: Resource): DepositState {
  const reveal = revealedBy.get(resource);
  if (reveal && !knowledge.known[TECH_INDEX.get(reveal)!]) return 'unknown';
  const extract = RESOURCE_RULES[resource].extractionTechnology;
  if (!knowledge.known[TECH_INDEX.get(extract) ?? -1]) return 'known';
  const users = usedBy.get(resource);
  // A metal or fuel matters once any tech that uses it is known; others (food, stone, salt, timber, gold) once extracted.
  if (users && !users.some(name => knowledge.known[TECH_INDEX.get(name)!])) return 'known';
  return 'usable';
}

/** The extraction tech of a deposit this polity knows but cannot work (raises that tech's research weight). */
export function blockedExtraction(knowledge: Knowledge, code: number) {
  const resource = RESOURCE_IDS[code - 1];
  if (!resource) return null;
  if (depositState(knowledge, resource) !== 'known') return null;
  const extract = TECH_INDEX.get(RESOURCE_RULES[resource].extractionTechnology);
  return extract !== undefined && !knowledge.known[extract] ? extract : null;
}

/**
 * Startup check of the tech data: the graph itself, every extraction tech `RESOURCE_RULES` names (VISION.md M2), and
 * that each tech's `extract` effects are exactly the resources `RESOURCE_RULES` gives it.
 */
export function validateTechData() {
  validateTechs(Object.values(RESOURCE_RULES).map(rule => rule.extractionTechnology));
  const problems: string[] = [];
  for (const definition of TECHS) for (const resource of definition.effects.extract ?? []) {
    if (RESOURCE_RULES[resource].extractionTechnology !== definition.id) problems.push(`${definition.id} extracts ${resource}, which RESOURCE_RULES gives to ${RESOURCE_RULES[resource].extractionTechnology}`);
  }
  for (const [resource, rule] of Object.entries(RESOURCE_RULES) as [Resource, (typeof RESOURCE_RULES)[Resource]][]) {
    if (!TECHS[TECH_INDEX.get(rule.extractionTechnology)!].effects.extract?.includes(resource)) problems.push(`${rule.extractionTechnology} does not list ${resource} among what it extracts`);
  }
  if (problems.length) throw new Error(`Invalid tech data: ${problems.join('; ')}.`);
}
