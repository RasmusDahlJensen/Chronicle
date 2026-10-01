import { isWorldLake, isWorldWater, parseWorldManifest, parseWorldTile, WORLD_BIOMES, WORLD_TILE_SIZE, type WorldManifest } from '../../shared/generated-world.ts';

/**
 * The simulation's read-only view of a validated generated world (VISION.md rule 3). It is built only from the
 * manifest and tiles exactly as served, never from the generator.
 */
export interface SimulationGeography {
  manifest: WorldManifest;
  width: number; height: number; cells: number; cellAreaKm2: number; radiusKm: number;
  elevation: Int16Array; temperature: Int16Array; moisture: Uint16Array; biome: Uint8Array; resource: Uint8Array; fertility: Uint8Array;
  /** 1 for land (not ocean, sea ice or lake). */
  land: Uint8Array;
  /** 1 for marine water: ocean, shallow sea and sea ice. */
  marine: Uint8Array;
  /** Lake id (1-based) per cell, 0 elsewhere; `openLake[id]` is 1 when that lake has an outlet. */
  lake: Uint32Array; openLake: Uint8Array;
  /** River runoff index per river cell, 0 elsewhere. */
  riverRunoff: Uint32Array;
  /** Latitude (radians) at each row centre, and ground lengths in km of one cell step east–west per row and between rows. */
  latitude: Float64Array; eastWestKm: Float64Array; northSouthKm: Float64Array;
}

export function decodeGeography(manifestText: string, tileTexts: readonly string[]): SimulationGeography {
  const manifest = parseWorldManifest(JSON.parse(manifestText));
  const { width, height } = manifest, cells = width * height, columns = width / WORLD_TILE_SIZE;
  if (tileTexts.length !== columns * (height / WORLD_TILE_SIZE)) throw new Error('The simulation needs every geography tile.');
  const elevation = new Int16Array(cells), temperature = new Int16Array(cells), moisture = new Uint16Array(cells);
  const biome = new Uint8Array(cells), resource = new Uint8Array(cells), fertility = new Uint8Array(cells);
  for (const [index, text] of tileTexts.entries()) {
    const tx = index % columns, ty = Math.floor(index / columns);
    const tile = parseWorldTile(JSON.parse(text), manifest, tx, ty);
    for (let at = 0; at < WORLD_TILE_SIZE * WORLD_TILE_SIZE; at++) {
      const id = (ty * WORLD_TILE_SIZE + Math.floor(at / WORLD_TILE_SIZE)) * width + tx * WORLD_TILE_SIZE + at % WORLD_TILE_SIZE;
      elevation[id] = tile.fields.elevation[at]; temperature[id] = tile.fields.temperature[at]; moisture[id] = tile.fields.moisture[at];
      biome[id] = tile.fields.biome[at]; resource[id] = tile.fields.resource[at]; fertility[id] = tile.fields.fertility[at];
    }
  }
  const land = new Uint8Array(cells), marine = new Uint8Array(cells);
  for (let id = 0; id < cells; id++) {
    const type = WORLD_BIOMES[biome[id]];
    if (!isWorldWater(type)) land[id] = 1;
    else if (!isWorldLake(type)) marine[id] = 1;
  }
  const lake = new Uint32Array(cells), openLake = new Uint8Array(manifest.hydrology.lakes.length + 1);
  for (const body of manifest.hydrology.lakes) {
    if (body.outlet) openLake[body.id] = 1;
    for (const id of body.cells) lake[id] = body.id;
  }
  const riverRunoff = new Uint32Array(cells);
  const rivers = manifest.hydrology.rivers;
  for (let at = 0; at < rivers.cells.length; at++) riverRunoff[rivers.cells[at]] = rivers.runoff[at];
  // Equal-area cylindrical rows: latitude asin(1 − 2v), uniform cell area, shrinking east–west steps toward the poles.
  const radiusKm = Math.sqrt(manifest.areaKm2 / (4 * Math.PI));
  const latitude = new Float64Array(height), eastWestKm = new Float64Array(height), northSouthKm = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    latitude[y] = Math.asin(1 - 2 * (y + 0.5) / height);
    eastWestKm[y] = radiusKm * Math.cos(latitude[y]) * 2 * Math.PI / width;
  }
  for (let y = 0; y < height - 1; y++) northSouthKm[y] = radiusKm * (latitude[y] - latitude[y + 1]);
  return {
    manifest, width, height, cells, cellAreaKm2: manifest.areaKm2 / cells, radiusKm,
    elevation, temperature, moisture, biome, resource, fertility, land, marine, lake, openLake, riverRunoff,
    latitude, eastWestKm, northSouthKm,
  };
}

/** Four-neighbour cells with longitude wrapping and bounded poles (−1 beyond a pole). */
export function cellNeighbors(geography: Pick<SimulationGeography, 'width' | 'cells'>, id: number, into: Int32Array) {
  const { width, cells } = geography, x = id % width, row = id - x;
  into[0] = row + (x + 1) % width; into[1] = row + (x + width - 1) % width;
  into[2] = id >= width ? id - width : -1; into[3] = id < cells - width ? id + width : -1;
  return into;
}

/** Ground length in km of the step between two four-neighbour cells. */
export function stepKm(geography: SimulationGeography, from: number, to: number) {
  const y = Math.floor(from / geography.width), toY = Math.floor(to / geography.width);
  if (y === toY) return geography.eastWestKm[y];
  return geography.northSouthKm[Math.min(y, toY)];
}

/** Great-circle distance in km between two cell centres. */
export function greatCircleKm(geography: SimulationGeography, a: number, b: number) {
  const { width, latitude, radiusKm } = geography;
  const phi1 = latitude[Math.floor(a / width)], phi2 = latitude[Math.floor(b / width)];
  const lambda = ((b % width) - (a % width)) * 2 * Math.PI / width;
  const h = Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(lambda / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}
