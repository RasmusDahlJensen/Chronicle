import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { WORLD_GENERATOR_VERSION, type WorldSettings } from '../shared/generated-world.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Geography is read-only after slice G1 (docs/VISION.md rule 3). These generator 6 column digests come from the G1
 * sweep (docs/features/g1.md, `scripts/world-digests.ts`). `Timing` (Standard) and `g1-28` (Large) did not generate
 * before G1: their drainage retention cycled forever between two sink states.
 */
const DIGESTS: [WorldSettings, Record<string, string>][] = [
  [{ seed: 'Chronicle', size: 'large' }, {
    elevation: '51961d442fa403c916ecb25a2e7bbef4b555a16106c80e265b74a128c9dd5750',
    temperature: '759b5b66f3e10f685df66e0028e78fc2474e5c8b21e9fb190377dfcfcdd719b2',
    moisture: '9822be2af099d895ca2a25bcbcbbf6b578cf978d7f472e72e984e870e1d17fe1',
    biome: '1728536f84a2d7b02af0a5c62b2f196f994a956ef02e408d936031cb6eb27c7d',
    hydrology: '8857cf07a83b53f1b9a966eb20d49f07c75881f00a9942c2cf46b43897565f75',
    fertility: '63e6f511331523885ce3da3bc54e047e0353f800df0c857f840fce907b1e7690',
    resource: '7b3e5fc1d225ede4084bc8005ea1bcb2989dbd578d57f47808d1dfc8be158bf5',
  }],
  [{ seed: 'Timing', size: 'standard' }, {
    elevation: '58e904da99beee1b6177e0a557eb0bebbb9e7f348a3b0ab5c42fe66166ffedf5',
    temperature: '133a2e01c8bcb011a096fc18927330ab22b590b48a5a743f359c581fff4b79e0',
    moisture: '389f0219794c8e918735677378ce80a3825d899bfc00ba54624267241e203227',
    biome: '392eb93eb8dd2a3f66df34c7e045eea24bed403d96f147a0dd3cbe48e67fa472',
    hydrology: '52bde66eb75b338895cd91420aef72a7c1834f57f0356daf761f404967a34720',
    fertility: 'f3d698f1e7dbb599ac700062d755b43f784cda2c522424ff3679fb4e5f264683',
    resource: '026f6ccb37ff73705682a0982698ca274d7591107f4b0082eea9c58995358499',
  }],
];
const hash = (value: ArrayBufferView | string) => createHash('sha256')
  .update(typeof value === 'string' ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).digest('hex');

test('generator 6 geography matches its recorded digests, including a world that did not converge before G1', async () => {
  assert.equal(WORLD_GENERATOR_VERSION, 6, 'A generator change needs new digests and an approved geography change.');
  for (const [settings, expected] of DIGESTS) {
    const world = await generateWorld(settings);
    const { elevation, temperature, moisture, biome, fertility, resource } = world.fields;
    assert.deepEqual({
      elevation: hash(elevation), temperature: hash(temperature), moisture: hash(moisture), biome: hash(biome),
      hydrology: hash(JSON.stringify(world.hydrology)), fertility: hash(fertility), resource: hash(resource),
    }, expected, `${settings.seed} (${settings.size}) geography changed`);
  }
});

test('Large worlds that could not be published before G1 now pass every transport validator', async () => {
  // g1-28: drainage retention cycled forever. g1-29: drainage converged with a pond above a dry neighbour that drains
  // elsewhere, which the water contract rejects.
  for (const seed of ['g1-28', 'g1-29']) {
    const world = await generateWorld({ seed, size: 'large' });
    assert.ok(world.hydrology.rivers.cells.length > 0);
    // Encoding validates the manifest (including the river and lake graph) and every tile before publication.
    const bundle = encodeGeneratedWorld(world);
    assert.equal(bundle.tiles.length, 32);
  }
});
