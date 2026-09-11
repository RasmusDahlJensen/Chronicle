import { WORLD_AREA_KM2 } from '../../shared/generated-world.ts';
import { addCountryClaim, releaseCountryClaim, type CountryTerritory } from '../../shared/country-growth.ts';
import {
  initialCountryDevelopment,
  investmentTerms,
  type CountryProject,
  type CountryDevelopment,
} from '../../shared/country-development.ts';
import type { SimulationState } from '../../shared/simulation.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import {
  economy,
  frontier,
  routes,
  foodRate,
  countryClaimCost,
  validateCountryGeography,
  applyCountryEconomy,
  record,
} from './country-growth.ts';
import { chooseCountryIntent, completeCountryIntent, type CountryCandidate } from './country-ai.ts';

type Opportunity = {
  kind: CountryProject['kind'];
  targetCellId: number | null;
  routeDistance: number;
  level: number;
  cost: number;
  workers: number;
  duration: number;
  score: number;
  reason: string;
};
function claimTerms(env: SettlementEnvironment, id: number, distance: number) {
  return {
    cost: Math.ceil(countryClaimCost(env, id, distance) * 0.35),
    workers: 6,
    duration: Math.ceil(5 + Math.sqrt(WORLD_AREA_KM2 / (env.width * env.height)) / 12 + distance / 150),
  };
}
function event(
  d: CountryDevelopment,
  day: number,
  p: CountryProject,
  action: CountryDevelopment['history'][number]['event'],
  message: string,
) {
  d.history.push({
    day,
    projectId: p.id,
    kind: p.kind,
    event: action,
    cost: action === 'completed' ? p.cost : 0,
    message,
  });
  if (d.history.length > 64) d.history.shift();
}
function budget(state: SimulationState) {
  const d = state.development!,
    c = state.settlements!.centers[0],
    m = state.country!.metrics;
  const reservedFood = d.projects.reduce((n, p) => n + p.cost, 0),
    reservedWorkers = d.projects.reduce((n, p) => n + p.workers, 0);
  d.budget = {
    reservedFood,
    reservedWorkers,
    availableFood: Math.max(0, c.food - reservedFood - c.population * 7),
    availableWorkers: Math.max(0, m.workforce - m.supportWorkers - reservedWorkers),
    projectSlots: c.population > 0 ? Math.min(8, 2 + Math.floor(d.logisticsLevel / 2)) : 0,
  };
}
export function initializeCountryDevelopment(state: SimulationState, env: SettlementEnvironment): void {
  state.development = initialCountryDevelopment();
  state.country!.metrics = economy(env, state.country!.territory, state.tribe.population, 0, state.development).metrics;
  budget(state);
}
export function validateDevelopmentGeography(state: SimulationState, env: SettlementEnvironment): void {
  if (!state.development) return;
  validateCountryGeography(state, env);
  const sites = frontier(env, state.country!.territory, routes(env, state.country!.territory), []);
  for (const p of state.development.projects)
    if (p.kind === 'claim') {
      const site = sites.find((s) => s.id === p.targetCellId),
        terms = claimTerms(env, p.targetCellId!, p.routeDistance);
      if (
        !site ||
        Math.ceil(site.d) > p.routeDistance ||
        p.cost !== terms.cost ||
        p.workers !== terms.workers ||
        p.duration !== terms.duration
      )
        throw new Error('Invalid development claim geography or price; saved data has been preserved.');
    }
}
function cancel(state: SimulationState, p: CountryProject, reason: string) {
  const d = state.development!;
  d.projects = d.projects.filter((next) => next.id !== p.id);
  d.cancelledProjects++;
  d.cancelledWorkerDays += p.progress * p.workers;
  event(d, state.elapsedDays, p, 'cancelled', reason);
}
/** Conservative shared reservation check: combined future claims and remaining work, no duplicate capital supplies. */
function affordable(
  state: SimulationState,
  env: SettlementEnvironment,
  projects: readonly (CountryProject | Opportunity)[],
  reserveDays: number,
): boolean {
  const c = state.settlements!.centers[0],
    d = state.development!,
    region = state.country!.territory;
  const workers = projects.reduce((n, p) => n + p.workers, 0),
    supplies = projects.reduce((n, p) => n + p.cost, 0);
  const expanded = {
    ...region,
    cells: [...region.cells, ...projects.filter((p) => p.kind === 'claim').map((p) => p.targetCellId!)],
  };
  const during = economy(env, region, c.population, workers, d),
    after = economy(env, expanded, c.population, 0, d);
  const remaining = Math.max(0, ...projects.map((p) => p.duration - ('progress' in p ? p.progress : 0)));
  const deficit = Math.max(0, c.population + during.metrics.upkeepDue - during.collected) * remaining;
  const hasClaims = projects.some((p) => p.kind === 'claim');
  return (
    during.metrics.claimWorkers === workers &&
    workers < c.population &&
    c.food >= supplies + c.population * reserveDays + deficit &&
    (!hasClaims || after.collected >= c.population + after.metrics.upkeepDue)
  );
}
function opportunities(
  state: SimulationState,
  env: SettlementEnvironment,
  others: readonly CountryTerritory[],
): Opportunity[] {
  const d = state.development!,
    c = state.settlements!.centers[0],
    region = state.country!.territory;
  const base = economy(env, region, c.population, 0, d),
    out: Opportunity[] = [];
  for (const kind of ['food', 'logistics'] as const) {
    const level = (kind === 'food' ? d.foodLevel : d.logisticsLevel) + 1;
    if (level > 100 || d.projects.some((p) => p.kind === kind)) continue;
    const changed = { ...d, [kind === 'food' ? 'foodLevel' : 'logisticsLevel']: level };
    const improved = economy(env, region, c.population, 0, changed),
      terms = investmentTerms(kind, level);
    const gain = improved.collected - improved.metrics.upkeepDue - (base.collected - base.metrics.upkeepDue);
    if (gain <= 0 && kind === 'food') continue;
    const score =
      kind === 'food'
        ? 35 + Math.min(50, ((gain * 180) / terms.cost) * 15)
        : 40 +
          Math.min(40, (base.metrics.supportRequired / Math.max(1, base.metrics.workforce)) * 180) +
          Math.min(10, ((gain * 90) / terms.cost) * 5);
    out.push({
      kind,
      targetCellId: null,
      routeDistance: 0,
      level,
      ...terms,
      score: Math.min(100, Math.round(score)),
      reason:
        kind === 'food'
          ? 'Invest provisions and work to gather more food from the same usable land.'
          : 'Invest in logistics to reduce the continuing support burden and improve reach.',
    });
  }
  const active = new Set(d.projects.filter((p) => p.kind === 'claim').map((p) => p.targetCellId));
  const ranked = frontier(env, region, base.paths, others)
    .filter((s) => !active.has(s.id))
    .sort(
      (a, b) =>
        foodRate(env, b.id, b.d) * 10 +
          b.neighbors * 8 -
          b.d / 40 -
          (foodRate(env, a.id, a.d) * 10 + a.neighbors * 8 - a.d / 40) || a.id - b.id,
    )
    .slice(0, 12);
  for (const site of ranked) {
    const distance = Math.ceil(site.d),
      terms = claimTerms(env, site.id, distance);
    if (terms.duration > 360) continue;
    out.push({
      kind: 'claim',
      targetCellId: site.id,
      routeDistance: distance,
      level: 0,
      ...terms,
      score: Math.round(
        Math.max(
          0,
          Math.min(
            100,
            50 +
              state.ai!.profile.expansion * 0.2 +
              foodRate(env, site.id, site.d) * 3 +
              site.neighbors * 3 -
              site.d / 200,
          ),
        ),
      ),
      reason: 'Extend connected claims where land opportunity and support costs justify a funded expedition.',
    });
  }
  return out;
}
function prune(state: SimulationState, env: SettlementEnvironment, others: readonly CountryTerritory[]) {
  const d = state.development!,
    region = state.country!.territory,
    valid = new Set(frontier(env, region, routes(env, region), others).map((s) => s.id));
  for (const p of [...d.projects])
    if (p.kind === 'claim' && !valid.has(p.targetCellId!))
      cancel(state, p, 'Claim access changed; reserved supplies and workers were released.');
  while (d.projects.length && !affordable(state, env, d.projects, 7)) {
    const reversed = [...d.projects].reverse();
    const remove =
      reversed.find((p) =>
        affordable(
          state,
          env,
          d.projects.filter((other) => other.id !== p.id),
          7,
        ),
      ) ??
      reversed.find((p) => p.kind === 'claim') ??
      reversed[0];
    cancel(state, remove, 'Shared supplies or workforce no longer cover this project and the safety reserve.');
  }
}
/** Bounded utility-ranked greedy allocation, rechecking the complete portfolio after every choice. */
export function advanceCountryDevelopment(
  state: SimulationState,
  env: SettlementEnvironment,
  others: readonly CountryTerritory[] = [],
): void {
  validateDevelopmentGeography(state, env);
  const d = state.development!,
    g = state.country!,
    c = state.settlements!.centers[0],
    region = g.territory;
  if (others.some((o) => o.cells.some((id) => region.cells.includes(id))))
    throw new Error('Country ownership overlaps another country.');
  if (!c.population) {
    c.collected = 0;
    c.consumed = 0;
    c.shortfall = 0;
    c.workingCells = [];
    c.territoryLastWorked = [state.elapsedDays];
    g.metrics = economy(env, region, 0, 0, d).metrics;
    budget(state);
    return;
  }
  prune(state, env, others);
  const base = economy(env, region, c.population, 0, d),
    crisis = base.collected < c.population + base.metrics.upkeepDue || c.food < c.population * 7;
  const slots = Math.min(8, 2 + Math.floor(d.logisticsLevel / 2));
  const options = d.projects.length < slots ? opportunities(state, env, others) : [];
  const goal = (o: Opportunity) =>
    o.kind === 'claim' ? 'expand' : o.kind === 'food' ? 'improveFood' : 'improveLogistics';
  const candidates: CountryCandidate[] = [
    {
      goal: 'consolidate',
      targetCellId: null,
      score: crisis ? 75 : 35,
      eligible: true,
      reason: crisis
        ? 'Protect subsistence and rebuild supplies before committing more work.'
        : 'Maintain current projects and reserve supplies for worthwhile opportunities.',
      reservedFood: 0,
      reservedPeople: 0,
    },
  ];
  // Keep transport alternatives bounded; actual frontier selection is independent of display storage.
  const evaluated = options.map((o) => ({
    ...o,
    eligible: d.projects.length < slots && affordable(state, env, [...d.projects, o], state.ai!.profile.reserveDays),
  }));
  for (const o of evaluated.slice(0, 9))
    candidates.push({
      goal: goal(o),
      targetCellId: o.targetCellId ?? c.cellId,
      score: o.score,
      eligible: o.eligible,
      reason: o.eligible ? o.reason : 'The shared food, labor or continuing support budget cannot fund this proposal.',
      reservedFood: 0,
      reservedPeople: 0,
    });
  const previous = state.ai!.decisions[0];
  if (
    previous?.goal === 'consolidate' &&
    !previous.alternatives.some((a) => a.goal !== 'consolidate' && a.eligible) &&
    candidates.some((a) => a.goal !== 'consolidate' && a.eligible)
  )
    completeCountryIntent(state.ai!, c.id, state.elapsedDays, 'Newly affordable work warrants a fresh assessment.');
  const decision = chooseCountryIntent(state.ai!, c.id, state.elapsedDays, candidates, crisis, [
    'consolidate',
    'expand',
    'improveFood',
    'improveLogistics',
  ]);
  if (decision.goal !== 'consolidate') {
    const ordered = evaluated
      .filter((o) => o.eligible)
      .sort(
        (a, b) =>
          Number(goal(b) === decision.goal && (b.targetCellId ?? c.cellId) === decision.targetCellId) -
            Number(goal(a) === decision.goal && (a.targetCellId ?? c.cellId) === decision.targetCellId) ||
          b.score - a.score ||
          (a.targetCellId ?? -1) - (b.targetCellId ?? -1),
      );
    for (const o of ordered) {
      if (d.projects.length >= slots) break;
      if (o.score < 45 || !affordable(state, env, [...d.projects, o], state.ai!.profile.reserveDays)) continue;
      const { score: _score, reason, eligible: _eligible, ...terms } = o;
      const p: CountryProject = { ...terms, id: d.nextProjectId++, startedDay: state.elapsedDays, progress: 0 };
      d.projects.push(p);
      event(d, state.elapsedDays, p, 'started', reason);
    }
  }
  const workforce = d.projects.reduce((n, p) => n + p.workers, 0);
  d.workerDays += workforce;
  const daily = economy(env, region, c.population, workforce, d);
  const collapsed = applyCountryEconomy(state, daily, decision.reason);
  for (const p of d.projects) p.progress++;
  if (collapsed) {
    for (const p of [...d.projects]) cancel(state, p, 'Country collapsed; unfinished work ended.');
    budget(state);
    return;
  }
  // Daily expenditure can change affordability; all previously assigned labor remains recorded.
  prune(state, env, others);
  for (const p of [...d.projects]) {
    if (p.progress < p.duration) continue;
    if (p.kind === 'claim') {
      if (!addCountryClaim(region, p.targetCellId!, env.width, env.height, others)) {
        cancel(state, p, 'Claim no longer available.');
        continue;
      }
      g.claimsAdded++;
      state.settlements!.establishmentSpent += p.cost;
      record(g, state.elapsedDays, 'claimed', p.targetCellId, 'A funded frontier expedition completed its claim.');
    } else {
      if (p.kind === 'food') d.foodLevel++;
      else d.logisticsLevel++;
      d.investmentSpent += p.cost;
    }
    c.food -= p.cost;
    d.completedProjects++;
    d.completedWorkerDays += p.progress * p.workers;
    completeCountryIntent(
      state.ai!,
      c.id,
      state.elapsedDays,
      'Completed work frees capacity for the next opportunity.',
    );
    d.projects = d.projects.filter((next) => next.id !== p.id);
    event(
      d,
      state.elapsedDays,
      p,
      'completed',
      p.kind === 'claim'
        ? 'Paid for a completed claim; ongoing support starts next day.'
        : 'Paid for a completed productive investment.',
    );
  }
  const now = economy(env, region, c.population, 0, d);
  g.unsupportedDays = now.collected < c.population + now.metrics.upkeepDue ? g.unsupportedDays + 1 : 0;
  if (g.unsupportedDays >= 30 && region.cells.length > 1 && !d.projects.length) {
    const oldNet = now.collected - now.metrics.upkeepDue;
    const removable = [...now.paths]
      .filter(([id]) => id !== region.capitalCellId)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 8)
      .flatMap(([id]) => {
        const reduced = { ...region, cells: [...region.cells] };
        if (!releaseCountryClaim(reduced, id, env.width, env.height)) return [];
        const after = economy(env, reduced, c.population, 0, d);
        return [{ id, gain: after.collected - after.metrics.upkeepDue - oldNet }];
      })
      .filter((x) => x.gain > 0 || c.shortfall > 0)
      .sort((a, b) => b.gain - a.gain || a.id - b.id);
    if (removable[0] && releaseCountryClaim(region, removable[0].id, env.width, env.height)) {
      g.claimsReleased++;
      g.unsupportedDays = 0;
      c.workingCells = c.workingCells.filter((id) => region.cells.includes(id));
      c.decision = 'Released unsupported outer land to improve food support.';
      record(g, state.elapsedDays, 'released', removable[0].id, c.decision);
    }
  }
  // Strategic proposals carry no second reservation pool; active projects remain independently committed.
  if (
    state.ai!.decisions[0]?.targetCellId !== null &&
    state.ai!.decisions[0]?.goal === 'expand' &&
    region.cells.includes(state.ai!.decisions[0].targetCellId!)
  )
    completeCountryIntent(state.ai!, c.id, state.elapsedDays, 'The selected claim has completed.');
  budget(state);
}
