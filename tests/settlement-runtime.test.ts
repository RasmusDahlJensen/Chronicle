import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSimulationService } from '../server/simulation.ts';
import * as runtimeModule from '../server/workers/simulation-runtime.ts';
import { MAX_SIMULATION_BYTES, parseSimulationState } from '../shared/simulation.ts';
import { createSimulationRuntime } from '../server/workers/simulation-runtime.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import type { WorldStudyBundle } from '../shared/civilization.ts';
import type { SimulationState } from '../shared/simulation.ts';
const input = { instanceId: '11111111-1111-4111-8111-111111111111', observerId: '22222222-2222-4222-8222-222222222222',
 settings: { seed: 'Chronicle', size: 'standard' as const }, placementSeed: 'Tribes 1' };
let pending: Promise<WorldStudyBundle>;
const bundle = () => pending ??= generateWorld(input.settings).then(world => ({ ...encodeGeneratedWorld(world), civilization: JSON.stringify(createCivilizationSnapshot(world)) }));
const step = (state: SimulationState) => ({ instanceId: state.id, observerId: input.observerId, incarnation: state.incarnation, revision: state.revision, action: 'step' as const, days: 30 as const });

test('settlement geography persists once per world and restarted daily decisions match uninterrupted execution', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'chronicle-settlement-runtime-')); t.after(() => rm(directory, {recursive:true, force:true}));
 let runtime = createSimulationRuntime({directory}); t.after(() => runtime.close());
 const start = runtime.initialize(input, await bundle()).state;
 assert.equal(start.rulesVersion, 2);
 const before = runtime.command(step(start)).state;
 const uninterrupted = runtime.command(step(before)).state;
 runtime.close();
 const db = new DatabaseSync(join(directory, 'simulation.sqlite'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM environments').get()!.n, 1);
 db.prepare('UPDATE checkpoints SET current = ? WHERE id = ?').run(JSON.stringify(before), input.instanceId); db.close();
 runtime = createSimulationRuntime({directory});
 assert.deepEqual(runtime.command(step(runtime.open(input)!.state)).state, uninterrupted);
 runtime.initialize({...input, instanceId:'33333333-3333-4333-8333-333333333333'}, await bundle());
 const read = new DatabaseSync(join(directory,'simulation.sqlite'));
 assert.equal(read.prepare('SELECT count(*) AS n FROM environments').get()!.n,1); read.close();
});

test('missing or corrupted settlement geography fails closed without replacing the checkpoint', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'chronicle-settlement-corrupt-')); t.after(() => rm(directory,{recursive:true,force:true}));
 let runtime = createSimulationRuntime({directory});
 const state = runtime.initialize(input,await bundle()).state; runtime.close();
 const db = new DatabaseSync(join(directory,'simulation.sqlite'));
 const original = db.prepare('SELECT body, digest FROM environments').get()!;
 db.prepare('UPDATE environments SET body = ?').run('{}');
 runtime = createSimulationRuntime({directory});
 assert.throws(()=>runtime.open(input),/invalid|unsupported/); runtime.close();
 assert.deepEqual(JSON.parse(db.prepare('SELECT current FROM checkpoints').get()!.current as string), state);
 db.exec('DELETE FROM environments');
 runtime = createSimulationRuntime({directory});
 assert.throws(()=>runtime.open(input),/invalid|unsupported/); runtime.close();
 db.prepare('INSERT INTO environments(world_key,body,digest) VALUES(?,?,?)').run(state.worldKey,original.body!,original.digest!); db.close();
 runtime = createSimulationRuntime({directory});
 assert.deepEqual(runtime.open(input)!.state,state); runtime.close();
});

test('legacy migration preserves identity and elapsed time and atomically saves geography with the checkpoint', async t => {
 const directory = await mkdtemp(join(tmpdir(),'chronicle-settlement-migrate-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 let runtime = createSimulationRuntime({directory});
 const initial = runtime.initialize(input,await bundle()).state; runtime.close();
 const awaitedBundle = await bundle();
 const legacy = {...initial, protocolVersion:1, rulesVersion:1, elapsedDays:42, revision:7};
 delete (legacy as Record<string,unknown>).settlements;
 const db = new DatabaseSync(join(directory,'simulation.sqlite'));
 db.prepare('UPDATE checkpoints SET current = ?, previous = NULL').run(JSON.stringify(legacy)); db.exec('DELETE FROM environments');
 db.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 runtime = createSimulationRuntime({directory});
 assert.throws(()=>runtime.initialize(input,awaitedBundle),/save/i);
 assert.equal(db.prepare('SELECT count(*) AS n FROM environments').get()!.n,0);
 assert.deepEqual(JSON.parse(db.prepare('SELECT current FROM checkpoints').get()!.current as string),legacy);
 db.exec('DROP TRIGGER reject_migration');
 const migrated = runtime.initialize(input,awaitedBundle).state;
 assert.equal(migrated.rulesVersion,2); assert.equal(migrated.elapsedDays,42);
 assert.deepEqual(migrated.tribe,legacy.tribe);
 assert.equal(db.prepare('SELECT count(*) AS n FROM environments').get()!.n,1);
 assert.deepEqual(JSON.parse(db.prepare('SELECT previous FROM checkpoints').get()!.previous as string),legacy);
 db.close(); runtime.close();
});


test('worker service requests geography for legacy saves then resumes migrated decisions without a bundle', async t => {
 const directory = await mkdtemp(join(tmpdir(),'chronicle-settlement-worker-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 const runtime = createSimulationRuntime({directory});
 const initial = runtime.initialize(input,await bundle()).state; runtime.close();
 const legacy = {...initial, protocolVersion:1, rulesVersion:1, elapsedDays:42};
 delete (legacy as Record<string,unknown>).settlements;
 const db = new DatabaseSync(join(directory,'simulation.sqlite'));
 db.prepare('UPDATE checkpoints SET current = ?').run(JSON.stringify(legacy)); db.exec('DELETE FROM environments'); db.close();
 let service = createSimulationService({directory}); t.after(()=>service.close());
 assert.equal(await service.open(input),null, 'host must retrieve geography to explicitly migrate legacy save');
 const migrated = await service.initialize(input,await bundle());
 assert.equal(migrated.state.rulesVersion,2); assert.equal(migrated.state.elapsedDays,42);
 const advanced = await service.command(step(migrated.state)); await service.close();
 service = createSimulationService({directory});
 assert.deepEqual((await service.open(input))!.state,advanced.state);
 assert.equal((await service.command(step(advanced.state))).state.elapsedDays,102);
});

test('observed same-world instances reuse validated geography only while a resident retains it', async t => {
 const directory = await mkdtemp(join(tmpdir(),'chronicle-settlement-shared-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 const runtime = createSimulationRuntime({directory}); t.after(()=>runtime.close());
 const initial = runtime.initialize(input,await bundle()).state;
 const other = {...input,instanceId:'33333333-3333-4333-8333-333333333333'};
 const db = new DatabaseSync(join(directory,'simulation.sqlite')); t.after(()=>db.close());
 db.prepare('INSERT INTO checkpoints(id,current) VALUES(?,?)').run(other.instanceId,JSON.stringify({...initial,id:other.instanceId}));
 // A validated resident is the immutable in-memory world. This poison proves a second instance does not decode another copy.
 db.exec("UPDATE environments SET body = '{}'");
 const second = runtime.open(other)!;
 assert.equal(second.state.id,other.instanceId);
 assert.equal(runtime.command({...step(second.state),instanceId:other.instanceId}).state.elapsedDays,30);
 runtime.release({instanceId:input.instanceId,observerId:input.observerId});
 runtime.release({instanceId:other.instanceId,observerId:input.observerId});
 assert.throws(()=>runtime.open(other),/invalid|unsupported/,'after every resident is released, reopening must validate disk again');
});

test('ocean secondary settlements, claims and working cells reject while preserving saved data', async t => {
 const directory = await mkdtemp(join(tmpdir(),'chronicle-settlement-ocean-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 let runtime = createSimulationRuntime({directory});
 const state = runtime.initialize(input,await bundle()).state; runtime.close();
 const db = new DatabaseSync(join(directory,'simulation.sqlite')); t.after(()=>db.close());
 const env = JSON.parse(db.prepare('SELECT body FROM environments').get()!.body as string);
 const ocean = env.elevation.findIndex((e:number)=>e<0);
 assert.ok(ocean>=0);
 for (const kind of ['center','territory','working'] as const) {
  const forged = structuredClone(state), sim = forged.settlements!, main = sim.centers[0];
  if(kind==='center') {
   const secondary = {...structuredClone(main),id:'settlement-2',cellId:ocean,territory:[ocean],workingCells:[],population:80,food:2400};
   main.population=170; main.food=5100; sim.centers.push(secondary); sim.nextSettlementId=3;
  } else if(kind==='territory') { main.territory.push(ocean); main.territoryLastWorked.push(state.elapsedDays); }
  else main.workingCells.push(ocean);
  parseSimulationState(forged); // The forged location is structurally valid; geography must reject it.
  db.prepare('UPDATE checkpoints SET current = ?').run(JSON.stringify(forged));
  runtime=createSimulationRuntime({directory});
  assert.throws(()=>runtime.open(input),/invalid|unsupported/,kind); runtime.close();
  assert.deepEqual(JSON.parse(db.prepare('SELECT current FROM checkpoints').get()!.current as string),forged);
 }
});


test('checkpoint bound leaves room for a complete simulation view including maximally escaped errors', () => {
 const maximumCheckpoint = (runtimeModule as unknown as Record<string,number>).MAX_SIMULATION_CHECKPOINT_BYTES;
 assert.ok(Number.isInteger(maximumCheckpoint));
 const envelope = JSON.stringify({state:null,active:false,error:'\u0000'.repeat(256)});
 assert.ok(maximumCheckpoint + Buffer.byteLength(envelope) <= MAX_SIMULATION_BYTES);
});

import { advanceTribeDays } from '../src/simulation/tribe.ts';
import { createSettlementEnvironment } from '../src/simulation/settlements.ts';
import { parseWorldManifest, parseWorldTile } from '../shared/generated-world.ts';

test('country AI crosses the real worker and SQLite boundary and resumes exact plans and RNG after restart', async t => {
 const directory=await mkdtemp(join(tmpdir(),'chronicle-country-ai-worker-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const opening={...input,clockMode:'monthly' as const,originCellId:46821,placementSeed:'AI restart'};
 const world=await bundle(),manifest=parseWorldManifest(JSON.parse(world.manifest));
 const environment=createSettlementEnvironment(manifest,world.tiles.map((tile,i)=>parseWorldTile(JSON.parse(tile),manifest,i%(manifest.width/128),Math.floor(i/(manifest.width/128)))));
 let service=createSimulationService({directory});t.after(()=>service.close());
 let state=(await service.initialize(opening,world)).state;
 assert.ok(state.ai);assert.equal(state.rulesVersion,3);
 for(let month=0;month<4;month++) state=(await service.command(step(state))).state;
 assert.ok(state.ai!.history.length);
 const expected={...advanceTribeDays(state,30,environment),revision:state.revision+1};
 await service.close();service=createSimulationService({directory});
 assert.deepEqual((await service.open(opening))!.state,state);
 assert.deepEqual((await service.command(step(state))).state,expected);
});

test('failed country AI commit rolls back RNG, decisions and food, and retry advances exactly once', async t => {
 const directory=await mkdtemp(join(tmpdir(),'chronicle-country-ai-rollback-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const opening={...input,clockMode:'monthly' as const,originCellId:46821,placementSeed:'AI rollback'};
 const runtime=createSimulationRuntime({directory});t.after(()=>runtime.close());
 const initial=runtime.initialize(opening,await bundle()).state;
 const db=new DatabaseSync(join(directory,'simulation.sqlite'));t.after(()=>db.close());
 const environment=JSON.parse(db.prepare('SELECT body FROM environments').get()!.body as string);
 const expected={...advanceTribeDays(initial,30,environment),revision:initial.revision+1};
 db.exec("CREATE TRIGGER reject_ai BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 assert.throws(()=>runtime.command(step(initial)),/save/i);
 assert.deepEqual(runtime.observe({instanceId:opening.instanceId,observerId:opening.observerId}).state,initial);
 assert.deepEqual(JSON.parse(db.prepare('SELECT current FROM checkpoints').get()!.current as string),initial);
 db.exec('DROP TRIGGER reject_ai');
 assert.deepEqual(runtime.command(step(initial)).state,expected);
});
