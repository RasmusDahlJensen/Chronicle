/** Stable integer hashing and periodic value noise; no ambient RNG or browser state. */
export function seedNumber(seed: string) {
  let hash = 2166136261;
  for (let at = 0; at < seed.length; at++) hash = Math.imul(hash ^ seed.charCodeAt(at), 16777619);
  return hash >>> 0;
}
export function hashNoise(x: number, y: number, seed: number) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 37, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
export function wrap(value: number, period: number) { return ((value % period) + period) % period; }
export function smoothNoise(u: number, v: number, frequency: number, seed: number) {
  const x = wrap(u, 1) * frequency; const y = v * frequency;
  const ix = Math.floor(x); const iy = Math.floor(y);
  const fx = x - ix; const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx); const ty = fy * fy * (3 - 2 * fy);
  const a = hashNoise(ix, iy, seed); const b = hashNoise((ix + 1) % frequency, iy, seed);
  const c = hashNoise(ix, iy + 1, seed); const d = hashNoise((ix + 1) % frequency, iy + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
export function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
