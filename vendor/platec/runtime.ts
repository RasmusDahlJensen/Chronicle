import type { PlatecModule } from './platec.mjs';

export const TECTONIC_WIDTH = 512;
export const TECTONIC_HEIGHT = 256;
const CELLS = TECTONIC_WIDTH * TECTONIC_HEIGHT;
const MAX_STEPS = 2500;
const MAX_HEAP_BYTES = 128 * 1024 * 1024;

/** One module owns one job, including failed jobs; no WASM state survives here. */
export async function runPlatec(seed: number, factory: () => Promise<PlatecModule>): Promise<Float32Array> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Tectonic seed must be a uint32 integer');
  }
  const module = await factory();
  let handle = 0;
  try {
    handle = module._chronicle_platec_create(seed, TECTONIC_WIDTH, TECTONIC_HEIGHT, 0.65, 60, 0.02, 1000000, 0.33, 2, 10);
    if (!Number.isInteger(handle) || handle <= 0 || handle >= MAX_HEAP_BYTES) {
      handle = 0;
      throw new Error('Could not create tectonic simulation');
    }
    let steps = 0;
    while (!module._chronicle_platec_finished(handle)) {
      if (steps >= MAX_STEPS) throw new Error('Tectonic generation exceeded its step limit');
      module._chronicle_platec_step(handle);
      steps++;
    }

    const pointer = module._chronicle_platec_heightmap(handle);
    // Growth replaces Emscripten's views; obtain the current heap after all C calls.
    const heap = module.HEAPF32;
    const start = pointer / Float32Array.BYTES_PER_ELEMENT;
    if (!(heap instanceof Float32Array) || heap.buffer.byteLength > MAX_HEAP_BYTES ||
      !Number.isInteger(start) || start <= 0 || start + CELLS > heap.length) {
      throw new Error('Invalid tectonic heightmap memory');
    }
    const heights = heap.slice(start, start + CELLS);
    for (const value of heights) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid tectonic heightmap value');
    }
    return heights;
  } finally {
    if (handle !== 0) module._chronicle_platec_destroy(handle);
  }
}
