import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTribeDays } from '../src/simulation/tribe.ts';
import { parseSimulationState } from '../shared/simulation.ts';

export const legacy = { protocolVersion: 1, rulesVersion: 1, id: '11111111-1111-4111-8111-111111111111', incarnation: 1, revision: 0,
 worldKey: 'climate-5:standard:Chronicle', settings: { seed: 'Chronicle', size: 'standard' }, placementSeed: 'Tribes 1',
 tribe: { id: 'civilization-1', name: 'Aven', color: '#a34f32', originCellId: 513, population: 250 }, elapsedDays: 0, rngState: 1, running: false, speed: 1 };
test('the settlement slice has an explicit new version while preserving legacy checkpoints', () => {
 const old = parseSimulationState(legacy);
 assert.equal(advanceTribeDays(old, 1).elapsedDays, 1);
 assert.throws(() => parseSimulationState({ ...legacy, protocolVersion: 2, rulesVersion: 2 }), /preserved/);
 assert.equal('settlements' in old, false);
 // The new version must expose an initial camp contract, covered by subsequent scenarios.
 assert.equal((awaitedVersion()), 2);
});
import { SIMULATION_RULES_VERSION } from '../shared/simulation.ts';
function awaitedVersion() { return SIMULATION_RULES_VERSION; }
import { migrateTribeState } from '../src/simulation/settlements.ts';
import { WORLD_BIOMES } from '../shared/generated-world.ts';
import type { SettlementEnvironment } from '../shared/settlements.ts';
function environment(): SettlementEnvironment {
 const size = 512 * 256;
 return { worldKey: legacy.worldKey, width: 512, height: 256, cellKm: 60,
 biome: Array(size).fill(WORLD_BIOMES.indexOf('grassland')), fertility: Array(size).fill(65), resource: Array(size).fill(0), elevation: Array(size).fill(100) };
}
function advance(state: ReturnType<typeof parseSimulationState>, env: SettlementEnvironment, days: number) {
 for (let n = 0; n < days; n++) state = advanceTribeDays(state, 1, env);
 return state;
}
test('food accounting, territorial use and additional centers conserve people and supplies deterministically', () => {
 const env = environment(), initial = migrateTribeState(parseSimulationState(legacy), env), before = JSON.stringify(initial);
 let batch = initial;
 for (let n = 0; n < 24; n++) batch = advanceTribeDays(batch, 30, env);
 const result = advance(initial, env, 720);
 assert.deepEqual(result, batch); assert.equal(JSON.stringify(initial), before);
 const sim = result.settlements!;
 assert.ok(sim.centers.length > 1, 'a prosperous supported main center should establish another center');
 assert.equal(sim.centers.reduce((n, c) => n + c.population, 0), 250);
 assert.equal(sim.centers.reduce((n, c) => n + c.food, 0), 7500 + sim.totalCollected - sim.totalConsumed - sim.establishmentSpent);
 assert.ok(sim.centers.reduce((n,c) => n + c.territory.length, 0) > 1);
 assert.ok(sim.establishmentSpent > 0); assert.ok(sim.history.length <= 32);
 assert.equal(sim.centers[0].id, initial.settlements!.mainSettlementId);
});
test('unknown minerals do not attract a tribe and water barriers cannot become territory', () => {
 const env = environment(), other = environment(); other.resource.fill(11);
 const state = migrateTribeState(parseSimulationState(legacy), env);
 assert.deepEqual(advance(state, env, 90), advance(state, other, 90));
 env.biome.fill(WORLD_BIOMES.indexOf('ocean')); env.elevation.fill(-100);
 env.biome[513] = WORLD_BIOMES.indexOf('grassland'); env.elevation[513] = 100;
 const isolated = advance(state, env, 90).settlements!;
 assert.deepEqual(isolated.centers[0].territory, [513]); assert.equal(isolated.centers.length, 1);
});
test('a persistent better nearby food location relocates a mobile camp with costs and abandons old claims', () => {
 const env = environment(); env.fertility.fill(5); env.fertility[65538] = 100; env.resource[65538] = 2;
 const initial = migrateTribeState(parseSimulationState({ ...legacy, tribe: { ...legacy.tribe, originCellId: 65537 } }), env);
 const early = advance(initial, env, 1); assert.equal(early.tribe.originCellId, 65537);
 const moved = advance(initial, env, 60);
 assert.equal(moved.tribe.originCellId, 65538); assert.ok(moved.settlements!.establishmentSpent > 0);
 assert.ok(moved.settlements!.history.some(e => e.kind === 'relocated'));
});
test('missing geography and duplicate territory fail closed without mutating a checkpoint', () => {
 const state = migrateTribeState(parseSimulationState(legacy), environment());
 assert.throws(() => advanceTribeDays(state, 1), /geography/i);
 const invalid = structuredClone(state); invalid.settlements!.centers[0].territory.push(513);
 assert.throws(() => parseSimulationState(invalid), /preserved/);
});
test('a modest viable food economy can support another community without requiring an exceptional resource', () => {
 const env = environment(); env.fertility.fill(50);
 const initial = migrateTribeState(parseSimulationState(legacy),env);
 const result = advance(initial,env,1440);
 assert.ok(result.settlements!.centers.length > 1, 'sustained surplus and viable ordinary food ground should enable founding');
});
test('unused territorial presence expires while the inhabited center remains', () => {
 const env = environment(), state = migrateTribeState(parseSimulationState(legacy),env);
 const c = state.settlements!.centers[0]; c.territory.push(514); c.territoryLastWorked.push(0); env.fertility[514] = 0;
 const result = advance(state,env,40);
 assert.ok(!result.settlements!.centers[0].territory.includes(514));
 assert.ok(result.settlements!.centers[0].territory.includes(result.tribe.originCellId));
});
import { settlementDistanceKm } from '../src/simulation/settlements.ts';
test('travel follows equal-area spherical rows and wrapping, not square pixel distances', () => {
 const env = environment();
 const equator = 128*512, polar = 512;
 assert.ok(settlementDistanceKm(env,polar,polar+1) < settlementDistanceKm(env,equator,equator+1)/4);
 assert.equal(settlementDistanceKm(env,equator,equator+511),settlementDistanceKm(env,equator,equator+1));
 assert.ok(settlementDistanceKm(env,polar,polar+512) > settlementDistanceKm(env,equator,equator+512));
});
test('new communities require preparation and earn their own sustained settlement status', () => {
 const env = environment(), initial = migrateTribeState(parseSimulationState(legacy),env);
 let state = initial, sawPreparation = false, preparedDays = 0;
 for (let day=0;day<720 && state.settlements!.centers.length===1;day++) {
  state = advanceTribeDays(state,1,env);
  if(state.settlements!.centers[0].foundingDays>0) { sawPreparation=true; preparedDays++; }
 }
 assert.ok(sawPreparation); assert.ok(preparedDays>=39);
 assert.equal(state.settlements!.centers.length,2);
 const child = state.settlements!.centers[1]; assert.equal(child.kind,'camp'); assert.equal(child.foundedDay,state.elapsedDays);
 state=advanceTribeDays(state,1,env); assert.equal(state.settlements!.centers[1].kind,'camp');
});
test('checkpoint rejects false food demand, out-of-world prospects and unpaired territorial timestamps', () => {
 const state = migrateTribeState(parseSimulationState(legacy),environment());
 for(const change of [(s:typeof state)=>s.settlements!.totalShortfall++, (s:typeof state)=>s.settlements!.centers[0].prospectCellId=131072,
 (s:typeof state)=>s.settlements!.centers[0].territoryLastWorked=[]]) {
  const copy=structuredClone(state); change(copy); assert.throws(()=>parseSimulationState(copy),/preserved/);
 }
});
test('known food sites increase gathered food while terrain travel effort reduces accessible output', () => {
 const plain = environment(), food = environment(), rugged = environment();
 food.resource.fill(2);
 for(let id=0;id<rugged.elevation.length;id++) rugged.elevation[id] = id % 2 ? 100 : 1100;
 const state = migrateTribeState(parseSimulationState(legacy),plain);
 const ordinary = advanceTribeDays(state,1,plain).settlements!.totalCollected;
 assert.ok(advanceTribeDays(state,1,food).settlements!.totalCollected > ordinary);
 assert.ok(advanceTribeDays(state,1,rugged).settlements!.totalCollected < ordinary);
});
test('relocation forecasts cannot count food land maintained by another community', () => {
 const env = environment(); env.fertility.fill(5); env.fertility[65538]=100; env.fertility[65539]=6;
 const state=migrateTribeState(parseSimulationState({...legacy,tribe:{...legacy.tribe,originCellId:65537}}),env);
 const main=state.settlements!.centers[0]; main.kind='settlement'; main.population=170; main.food=4500;
 main.territory.push(65538);main.territoryLastWorked.push(0);
 const child={...structuredClone(main),id:'settlement-2',name:'Aven 2',kind:'camp' as const,cellId:65540,population:80,food:3000,territory:[65540],territoryLastWorked:[0]};
 state.settlements!.centers.push(child);state.settlements!.nextSettlementId=3;
 assert.equal(advance(state,env,30).settlements!.centers[1].cellId,65540);
});
