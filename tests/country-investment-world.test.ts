import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import { createSettlementEnvironment } from '../src/simulation/settlements.ts';
import { createTribeState, advanceTribeDays } from '../src/simulation/tribe.ts';
import { initialCountryGrowth } from '../src/simulation/country-growth.ts';
import { parseWorldManifest, parseWorldTile } from '../shared/generated-world.ts';

test('paid investment produces visibly faster five-year expansion on real large Chronicle geography',async()=>{
 const world=await generateWorld({seed:'Chronicle',size:'large'}),bundle=encodeGeneratedWorld(world),manifest=parseWorldManifest(JSON.parse(bundle.manifest));
 const tiles=bundle.tiles.map((body,n)=>parseWorldTile(JSON.parse(body),manifest,n%8,Math.floor(n/8))),environment=createSettlementEnvironment(manifest,tiles);
 let state=createTribeState('11111111-1111-4111-8111-111111111111','Growth review 1',manifest,createCivilizationSnapshot(world),tiles,{clockMode:'monthly',environment});
 let old=structuredClone(state);delete old.development;old.protocolVersion=5;old.rulesVersion=4;
 old.country=initialCountryGrowth(old.tribe.id,old.tribe.originCellId,environment);
 for(let month=0;month<60;month++){state=advanceTribeDays(state,30,environment);old=advanceTribeDays(old,30,environment);}
 assert.equal(state.settlements!.centers.length,1);assert.equal(state.country!.starvationDeaths,0);
 assert.ok(state.country!.territory.cells.length>=old.country!.territory.cells.length*4,'same real landscape must show materially faster supported expansion');
 assert.ok(state.development!.investmentSpent>0&&state.development!.foodLevel>0&&state.development!.logisticsLevel>0);
 assert.ok(state.tribe.population>250);
});
