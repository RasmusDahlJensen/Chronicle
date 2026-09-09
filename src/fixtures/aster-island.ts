import type { TerrainCell, TerrainWorld } from '../world/terrain.ts';

/** An authored local landscape, sampled into cells. There is no user seed or world generator. */
export function createAsterIsland(): TerrainWorld {
  const width = 192;
  const height = 144;
  const cells: TerrainCell[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const nx = (u - 0.5) / 0.32;
      const ny = (v - 0.51) / 0.35;
      const angle = Math.atan2(ny, nx);
      // Fixed coastal lobes, headlands and small inlets, enclosing a single island.
      const shore = 1 + 0.16 * Math.cos(3 * angle + 0.5)
        + 0.09 * Math.sin(5 * angle - 0.8) + 0.035 * Math.sin(11 * angle)
        + 0.018 * Math.cos(23 * angle + 0.7) + 0.008 * Math.sin(47 * angle);
      const inland = shore - Math.hypot(nx, ny);
      let elevation: number;

      if (inland <= 0) {
        elevation = Math.max(-2400, inland * 1350);
      } else {
        const ridge = peak(u, v, 0.39, 0.33, 0.046, 0.065) * 660
          + peak(u, v, 0.46, 0.40, 0.040, 0.070) * 870
          + peak(u, v, 0.52, 0.48, 0.045, 0.055) * 720
          + peak(u, v, 0.57, 0.57, 0.042, 0.066) * 630
          + peak(u, v, 0.63, 0.65, 0.060, 0.050) * 420;
        const folds = 0.30 + noise(u * 19, v * 19) * 0.64
          + noise(u * 43 + 8, v * 43 + 5) * 0.32
          + noise(u * 89 + 3, v * 89 + 12) * 0.14;
        elevation = 12 + Math.min(inland, 0.25) * 210
          + ridge * folds * Math.min(1, inland / 0.12)
          + Math.sin(u * 39) * Math.cos(v * 45) * Math.min(inland, 0.1) * 50;
      }

      elevation = Math.round(elevation * 100) / 100;
      cells.push({
        id: y * width + x,
        terrain: elevation < 0 ? 'water' : elevation >= 220 ? 'hills' : 'plains',
        elevation,
        provinceId: elevation < 0 ? null : 'aster',
      });
    }
  }

  return {
    fixtureId: 'aster-island', fixtureVersion: 1, name: 'Aster Island',
    width, height, cellAreaKm2: 1, cells,
    provinces: [{ id: 'aster', name: 'Aster', sovereignId: null }],
  };
}

function peak(x: number, y: number, cx: number, cy: number, sx: number, sy: number) {
  return Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
}

/** Fixed coherent surface detail; independent of clocks and random global state. */
function noise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const a = value(ix, iy) * (1 - tx) + value(ix + 1, iy) * tx;
  const b = value(ix, iy + 1) * (1 - tx) + value(ix + 1, iy + 1) * tx;
  return a * (1 - ty) + b * ty;
}

function value(x: number, y: number) {
  let n = Math.imul(x + 101, 374761393) ^ Math.imul(y + 37, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
