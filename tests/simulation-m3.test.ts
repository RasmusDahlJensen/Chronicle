import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { emptyMap, hasMet, inheritContacts, KNOWN, knownRegions, lookAgain, observe, regionView, seeRegion, shareSurroundings, UNKNOWN } from '../src/simulation/perception.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';

/**
 * Test fixture: a strip of six regions on one landmass (0–1–2–3–4–5) and an island (6) 200 km off region 5, with
 * hand-placed polities. Only what the perception rules read is filled in.
 */
function strip() {
  const line = [0, 1, 2, 3, 4, 5];
  const regions = [...line.map(id => ({
    id, landmass: 0, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other <= 5).map(region => ({ region, travelKm: 100, riverTier: 0 })),
    sea: id === 5 ? [{ region: 6, km: 200 }] : [],
  })), { id: 6, landmass: 1, neighbors: [], sea: [{ region: 5, km: 200 }] }];
  const state = {
    tick: 0, partition: { regions }, occupant: new Int32Array(7).fill(-1), owner: new Int32Array(7).fill(-1), groupAt: new Int32Array(7).fill(-1),
    groups: [] as { id: number; region: number }[], polities: [] as Polity[], metrics: { firstContacts: 0 }, chronicle: new Chronicle(),
  } as unknown as SimulationState;
  const polity = (kind: 'band' | 'civ', name: string, region: number) => {
    const entry = {
      id: state.polities.length, kind, name, groups: [] as number[], map: emptyMap(7), met: new Map<number, number>(), knowledge: { sea: 0 }, deathTick: null,
    } as unknown as Polity;
    state.polities.push(entry);
    place(entry, region);
    return entry;
  };
  // A polity's (only) group arrives in a region, as moving and settling do.
  const place = (entry: Polity, region: number) => {
    let group = state.groups[entry.groups[0]] as unknown as PopulationGroupStub | undefined;
    if (!group) { group = { id: state.groups.length, region }; state.groups.push(group as never); entry.groups.push(group.id); }
    else { state.occupant[group.region] = -1; lookAgain(entry); }
    group.region = region; state.occupant[region] = entry.id; if (entry.kind === 'civ') state.owner[region] = entry.id;
    seeRegion(entry, region);
  };
  return { state, polity, place };
}
type PopulationGroupStub = { id: number; region: number };

test('a polity sees its regions and their neighbours; a civilization remembers what leaves its sight, a tribe forgets', () => {
  const { state, polity, place } = strip();
  const civ = polity('civ', 'Kesh', 1), tribe = polity('band', 'Vael', 4);
  observe(state, civ, 0); observe(state, tribe, 0);
  assert.deepEqual(civ.map.observed, [0, 1, 2]);
  assert.deepEqual(tribe.map.observed, [3, 4, 5]);
  assert.equal(regionView(state, civ, 4), null, 'beyond sight and never seen: unknown');
  assert.equal(state.metrics.firstContacts, 0, 'they have not seen each other');
  // The tribe moves next to the civilization: they meet, once and both ways, where the tribe saw the civilization's land.
  state.tick = 12;
  place(tribe, 2);
  observe(state, tribe, 12); observe(state, civ, 12);
  assert.ok(hasMet(civ, tribe.id) && hasMet(tribe, civ.id));
  assert.equal(state.metrics.firstContacts, 1);
  state.chronicle.flush(12);
  const contact = state.chronicle.events.find(event => event.type === 'firstContact')!;
  assert.deepEqual(contact.actors.map(actor => actor.id).sort(), [civ.id, tribe.id].sort());
  assert.equal(contact.data.sea, false);
  // The tribe forgets the land it left; the civilization moves away and remembers region 2 as it last saw it.
  assert.equal(tribe.map.status[5], UNKNOWN, 'a tribe keeps only what is in sight');
  state.tick = 24;
  place(civ, 0);
  observe(state, civ, 24);
  assert.deepEqual(civ.map.observed, [0, 1]);
  assert.equal(civ.map.status[2], KNOWN);
  assert.deepEqual(regionView(state, civ, 2), { region: 2, status: 'known', occupant: tribe.id, owner: -1, seen: 24 });
  // The tribe moves on: the civilization's memory is now stale, and it believes what it last saw.
  place(tribe, 3);
  observe(state, tribe, 24);
  assert.equal(state.occupant[2], -1);
  assert.equal(regionView(state, civ, 2)!.occupant, tribe.id, 'a stale snapshot is treated as current');
  assert.deepEqual(knownRegions(civ), [0, 1, 2]);
  assert.equal(regionView(state, civ, 1)!.status, 'observed');
});

test('neighbours tell a civilization what they see; a breakaway knows whom its parent knew; sea crossings widen sight', () => {
  const { state, polity } = strip();
  const civ = polity('civ', 'Kesh', 0), neighbour = polity('civ', 'Ora', 1), beyond = polity('band', 'Ilu', 2);
  observe(state, civ, 0); observe(state, neighbour, 0); observe(state, beyond, 0);
  assert.equal(civ.map.status[2], UNKNOWN, 'region 2 lies beyond its own sight');
  state.tick = 12;
  shareSurroundings(state, civ, 12);
  assert.equal(civ.map.status[2], KNOWN, 'learned from the neighbour, which sees region 2');
  assert.deepEqual(regionView(state, civ, 2), { region: 2, status: 'known', occupant: beyond.id, owner: -1, seen: 12 });
  assert.ok(hasMet(neighbour, beyond.id) && !hasMet(civ, beyond.id), 'hearing of a people is not meeting them');
  // A breakaway from the neighbour already knows the civilization, and the civilization knows it.
  const child = polity('band', 'Orani', 3);
  inheritContacts(state, child, neighbour, 12);
  assert.ok(hasMet(child, neighbour.id) && hasMet(child, civ.id) && hasMet(civ, child.id) && hasMet(neighbour, child.id));
  // Coastal sailing reaches the island 200 km off region 5: someone living there is met across the sea.
  const islanders = polity('band', 'Tiru', 6), sailors = polity('band', 'Mena', 5);
  observe(state, sailors, 12);
  assert.equal(hasMet(sailors, islanders.id), false, 'on foot the island is out of sight');
  (sailors.knowledge as { sea: number }).sea = 1;
  observe(state, sailors, 24);
  assert.ok(hasMet(sailors, islanders.id) && hasMet(islanders, sailors.id));
  state.chronicle.flush(24);
  const overSea = state.chronicle.events.find(event => event.type === 'firstContact' && event.data.sea === true);
  assert.ok(overSea && overSea.importance > 0.3, 'meeting across the sea is a notable first');
});
