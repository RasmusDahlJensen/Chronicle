/** Borrowed WASM views and C ABI generated from chronicle_platec_wasm.cpp. */
export interface PlatecModule {
  readonly HEAPF32: Float32Array;
  _chronicle_platec_create(
    seed: number, width: number, height: number, seaFraction: number,
    erosionPeriod: number, foldingRatio: number, overlapAbsolute: number,
    overlapRelative: number, cycles: number, plates: number,
  ): number;
  _chronicle_platec_destroy(handle: number): void;
  _chronicle_platec_heightmap(handle: number): number;
  _chronicle_platec_finished(handle: number): number;
  _chronicle_platec_step(handle: number): void;
}

export default function createPlatec(): Promise<PlatecModule>;
