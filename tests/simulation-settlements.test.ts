import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { createLanguage } from '../src/simulation/names.ts';
import { createRng, type Rng } from '../src/simulation/rng.ts';
import { byWater, foundSettlement, growSettlements, house, housingOf, livingSettlements, regionHousing, ruinSettlements, tierFor } from '../src/simulation/settlements.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { SETTLEMENT_TUNING } from '../src/simulation/tunables.ts';

/**
 * Test fixture: one region of a 6 × 2 cell strip. Cells 0–2 lie by a river (cell 1 is on it), cells 3–5 are dry; the
 * region's candidate sites are ranked 4 (dry), 1, 0, 2, 5. Only what the settlement rules read is filled in.
 */
function fixture() {
  const cells = 12, width = 6;
  const riverRunoff = new Uint32Array(cells); riverRunoff[1] = 9_000;
  const geography = { width, cells, riverRunoff, resource: new Uint8Array(cells), marine: new Uint8Array(cells), lake: new Uint32Array(cells) };
  const regionOf = new Int32Array(cells).fill(0);
  const state = {
    tick: 0, geography, partition: { regions: [{ id: 0, centroid: 3, settlementSites: [4, 1, 0, 2, 5] }], regionOf },
    cultures: [{ language: createLanguage(createRng(1, 1)) }], settlements: [], regionSettlements: [[]], chronicle: new Chronicle(),
    groups: [{ id: 0, region: 0, specialists: 0, foodSecurity: 1 }], unrest: new Uint8Array(1), stability: new Float64Array(1).fill(1),
    metrics: { settlementsGrown: 0, ruinsResettled: 0, tierChanges: 0, projectsAbandoned: 0 }, wonders: [],
  } as unknown as SimulationState;
  const civ = { id: 0, name: 'Ora', culture: 0, capital: null, groups: [0], projects: [] } as unknown as Polity;
  state.polities = [civ];
  return { state, civ };
}
const always = { chance: () => true } as unknown as Rng;
const stream = { tick: 120, stream: () => createRng(2, 3) };

test('a region\'s first settlement takes its best site wherever it lies; further ones only by water; ruins are resettled first', () => {
  const { state, civ } = fixture();
  assert.equal(byWater(state, 4), false); assert.equal(byWater(state, 0), true, 'next to the river'); assert.equal(byWater(state, 1), true, 'on it');
  const first = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  assert.equal(first.cell, 4, 'the best site, though dry'); assert.ok(first.capital && civ.capital === first.id);
  assert.equal(first.housing, housingOf({ capital: true })); assert.equal(first.housing, SETTLEMENT_TUNING.baseHousing * SETTLEMENT_TUNING.capitalHousing);
  const second = foundSettlement(state, createRng(5, 6), civ, 0, false, 0)!, third = foundSettlement(state, createRng(5, 7), civ, 0, false, 0)!;
  const fourth = foundSettlement(state, createRng(5, 8), civ, 0, false, 0)!;
  assert.deepEqual([second.cell, third.cell, fourth.cell], [1, 0, 2], 'the next sites by water, in rank order');
  assert.equal(foundSettlement(state, createRng(5, 9), civ, 0, false, 0), null, 'site 5 is dry: no room for another');
  assert.deepEqual(livingSettlements(state, 0).map(settlement => settlement.id), [0, 1, 2, 3]);
  state.chronicle.flush(0);
  assert.ok(state.chronicle.events.every(event => event.type === 'settlementFounded' && event.settlement !== null));
  // The people leave: everything falls to ruin; a new people resettles the best ruins, under the old name or a new one.
  const [firstName, secondName] = [first.name, second.name];
  ruinSettlements(state, 0, 50);
  assert.ok(state.settlements.every(settlement => settlement.status === 'ruined' && !settlement.capital && settlement.urban === 0 && settlement.ruinedTick === 50));
  const kept = foundSettlement(state, always, civ, 0, true, 60)!;
  assert.equal(kept.id, 0, 'the ruins on the best site'); assert.equal(kept.name, firstName); assert.equal(kept.formerName, null);
  assert.equal(state.settlements.length, 4, 'no new settlement while ruins stand');
  const renamed = foundSettlement(state, { chance: () => false, next: () => 0.5, int: () => 0, weighted: () => 0 } as unknown as Rng, civ, 0, false, 60)!;
  assert.equal(renamed.id, 1); assert.equal(renamed.formerName, secondName); assert.notEqual(renamed.name, secondName);
  state.chronicle.flush(60);
  const resettled = state.chronicle.events.filter(event => event.type === 'ruinsResettled');
  assert.equal(resettled.length, 2); assert.equal(resettled[1].data.renamed, true); assert.equal(resettled[1].data.name, secondName);
  assert.equal(state.metrics.ruinsResettled, 2);
});

test('townspeople fill the capital first, then the others in founding order, at most all the housing; the rest stay rural', () => {
  const { state, civ } = fixture();
  foundSettlement(state, createRng(5, 5), civ, 0, false, 0); foundSettlement(state, createRng(5, 6), civ, 0, true, 0);
  const [town, capital] = livingSettlements(state, 0), housing = regionHousing(state, 0);
  assert.equal(housing, capital.housing + town.housing); assert.equal(capital.housing, 2 * town.housing, 'the seat of government houses twice as many');
  assert.equal(house(state, 0, 9_000), 9_000);
  assert.deepEqual([capital.urban, town.urban], [9_000, 0], 'the capital first, though founded second');
  assert.equal(house(state, 0, capital.housing + 300), capital.housing + 300);
  assert.deepEqual([capital.urban, town.urban], [capital.housing, 300], 'the newer settlement takes the growth');
  assert.equal(house(state, 0, housing + 5_000), housing, 'only as many as they can house');
  assert.deepEqual([capital.urban, town.urban], [capital.housing, town.housing]);
  // The moving average follows month by month; a mid-month rehousing leaves it be.
  const mean = town.urbanMean;
  house(state, 0, 0, false);
  assert.equal(town.urbanMean, mean); assert.equal(town.urban, 0);
});

test('tiers follow the urban population with a margin, and growth founds settlements with their causes', () => {
  const [, town, city, metropolis] = SETTLEMENT_TUNING.tiers;
  assert.equal(tierFor(town - 1, 0), 0); assert.equal(tierFor(town, 0), 1); assert.equal(tierFor(metropolis, 0), 3);
  assert.equal(tierFor(town * SETTLEMENT_TUNING.demote, 1), 1, 'a town keeps its rank through a lean year');
  assert.equal(tierFor(town * SETTLEMENT_TUNING.demote - 1, 1), 0);
  assert.equal(tierFor(city * SETTLEMENT_TUNING.demote - 1, 3), 1, 'a collapse falls several tiers at once');
  const { state, civ } = fixture();
  const capital = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  state.chronicle.flush(0);
  const before = state.chronicle.events.length;
  // A full region founds another settlement; a large enough capital becomes a town, recorded with its causes.
  state.groups[0].specialists = house(state, 0, capital.housing);
  capital.urbanMean = town + 1;
  growSettlements(state, stream, civ);
  state.chronicle.flush(120);
  const recent = state.chronicle.events.slice(before);
  const [rise] = recent.filter(event => event.type === 'settlementTierChanged');
  assert.equal(capital.tier, 1); assert.ok(rise && rise.settlement === capital.id && rise.data.rising === true && rise.causes.some(cause => cause.factor === 'townspeople'));
  const grown = recent.filter(event => event.type === 'settlementFounded');
  assert.equal(grown.length, 1); assert.ok(grown[0].causes.some(cause => cause.factor === 'townspeople'));
  assert.equal(livingSettlements(state, 0).length, 2); assert.equal(state.metrics.settlementsGrown, 1);
});
