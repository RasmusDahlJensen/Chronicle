import { WORLD_BIOMES, decodeWorldSurface, type WorldBiome, type WorldManifest } from '../../shared/generated-world.ts';
import { drawCanopy, drawCrag, drawDune, drawGrass, drawPine, drawReeds, drawStone, drawWave } from './biome-atlas.ts';

type Rgb = readonly [number, number, number];
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const wrap = (value: number, width: number) => ((value % width) + width) % width;

/** Fixed ink variation, anchored to world coordinates; this never changes geography. */
function grain(x: number, y: number, salt = 0) {
  let value = Math.imul(x + 173, 374761393) ^ Math.imul(y + 419, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function motif(context: CanvasRenderingContext2D, biome: WorldBiome) {
  switch (biome) {
    case 'ocean': drawWave(context, 0, 0, 'rgba(125,193,205,.38)'); break;
    case 'coast': drawWave(context, 0, 0, 'rgba(212,239,223,.58)'); break;
    case 'grassland': drawGrass(context, 0, 0, 'rgba(43,79,40,.43)'); break;
    case 'savanna': drawGrass(context, 0, 0, 'rgba(91,78,36,.40)'); break;
    case 'steppe': drawGrass(context, 0, 0, 'rgba(107,94,62,.38)'); break;
    case 'forest': drawPine(context, 0, 0, 'rgba(15,49,32,.60)'); break;
    case 'boreal': drawPine(context, 0, 0, 'rgba(32,61,49,.62)'); break;
    case 'rainforest': drawCanopy(context, 0, 0, 'rgba(9,49,35,.63)'); break;
    case 'desert': drawDune(context, 0, 0, 'rgba(120,78,39,.43)'); break;
    case 'wetland': drawReeds(context, 0, 0, 'rgba(27,78,65,.53)'); break;
    case 'tundra': drawStone(context, 0, 0, 'rgba(72,91,76,.40)'); break;
    case 'mountain': drawCrag(context, 0, 0, 'rgba(53,55,54,.57)', false); break;
    case 'snow': drawCrag(context, 0, 0, 'rgba(91,113,127,.48)', true); break;
    case 'seaIce': drawStone(context, 0, 0, 'rgba(100,136,145,.35)'); break;
  }
}

/** One exact biome/elevation plate, with viewport-only decorative ink at several scales. */
export function createWorldTerrainTexture(world: WorldManifest, colours: readonly Rgb[]) {
  const fields = decodeWorldSurface(world.surface);
  const plate = document.createElement('canvas');
  plate.width = world.width; plate.height = world.height;
  const context = plate.getContext('2d', { alpha: false });
  if (!context) throw new Error('The world terrain canvas could not be prepared. Use Retry canvas.');
  const image = context.createImageData(world.width, world.height);
  const index = (x: number, y: number) => clamp(y, 0, world.height - 1) * world.width + wrap(x, world.width);
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const at = y * world.width + x, elevation = fields.elevation[at], biome = fields.biome[at];
    const colour = colours[biome];
    const west = fields.elevation[index(x - 1, y)], east = fields.elevation[index(x + 1, y)];
    const north = fields.elevation[index(x, y - 1)], south = fields.elevation[index(x, y + 1)];
    const relief = elevation < 0 ? clamp(elevation / 30000, -.17, 0)
      : clamp((Math.max(0, west) - Math.max(0, east)) / 2400 + (Math.max(0, north) - Math.max(0, south)) / 3300, -.24, .23);
    const ink = (grain(x, y) - .5) * (elevation < 0 ? .016 : .035);
    const shoreline = elevation >= 0 && Math.min(west, east, north, south) < 0 ? -.07 : 0;
    for (let channel = 0; channel < 3; channel++) image.data[at * 4 + channel] = clamp(Math.round(colour[channel] * (1 + relief + ink + shoreline)), 0, 255);
    image.data[at * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  function patterns(context: CanvasRenderingContext2D, originX: number, originY: number, scale: number, width: number, height: number) {
    // Density levels are fixed world grids. Extra detail fades in with zoom,
    // independently of HTTP arrivals and tile boundaries.
    const levels = [
      { step: 16, opacity: 1, size: Math.min(1.45 * scale, 2.2) },
      { step: 4, opacity: clamp((scale - 1.3) / 1.7, 0, 1), size: Math.min(.7 * scale, 1.6) },
      { step: 1, opacity: clamp((scale - 6) / 4, 0, 1), size: Math.min(.23 * scale, 2.1) },
    ];
    context.save();
    context.beginPath(); context.rect(originX, originY, world.width * scale, world.height * scale); context.clip();
    context.lineCap = 'round'; context.lineJoin = 'round';
    for (const level of levels) {
      if (level.opacity <= 0) continue;
      const firstX = Math.max(0, Math.floor((-originX / scale - 4) / level.step));
      const lastX = Math.min(world.width / level.step - 1, Math.ceil(((width - originX) / scale + 4) / level.step));
      const firstY = Math.max(0, Math.floor((-originY / scale - 4) / level.step));
      const lastY = Math.min(world.height / level.step - 1, Math.ceil(((height - originY) / scale + 4) / level.step));
      for (let row = firstY; row <= lastY; row++) for (let column = firstX; column <= lastX; column++) {
        const baseX = column * level.step, baseY = row * level.step;
        const x = baseX + (.25 + grain(baseX, baseY, 713) * .5) * level.step;
        const y = baseY + (.25 + grain(baseX, baseY, 971) * .5) * level.step;
        const biomeCode = fields.biome[index(Math.floor(x), Math.floor(y))], biome = WORLD_BIOMES[biomeCode];
        const density = biome === 'forest' || biome === 'boreal' || biome === 'rainforest' ? .86 : biome === 'ocean' ? .53 : .61;
        if (grain(baseX, baseY, level.step + 167) > density) continue;
        // Keep the motif in its own terrain; no trees spilling into water at coasts.
        const reach = level.size * 2.2 / scale;
        if ([[-reach, -reach], [-reach, reach], [reach, -reach], [reach, reach]].some(([dx, dy]) => fields.biome[index(Math.floor(x + dx), Math.floor(y + dy))] !== biomeCode)) continue;
        context.save();
        context.globalAlpha = level.opacity;
        context.translate(originX + x * scale, originY + y * scale); context.scale(level.size, level.size);
        motif(context, biome);
        context.restore();
      }
    }
    context.restore();
  }
  return { plate, patterns };
}
