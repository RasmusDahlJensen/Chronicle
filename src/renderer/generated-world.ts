import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { isWorldWater, WORLD_BIOMES, type WorldBiome, type WorldFields, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';
import { BIOMES } from '../world/atlas.ts';
import { drawAtlasResourceIcon } from './biome-atlas.ts';
import { createWorldTerrainTexture } from './world-terrain-texture.ts';
import { buildRiverReaches, riverPathCommands, riverAppearance } from './river-paths.ts';
import { regionBorderRuns } from './region-borders.ts';
import { placeLabels, type PlaceLabel } from './labels.ts';

export const WORLD_BIOME_STYLE: Record<WorldBiome, { label: string; color: string }> = {
  ...BIOMES, boreal: { label: 'Boreal forest', color: '#567766' },
  steppe: { label: 'Dry steppe', color: '#b9ae83' }, seaIce: { label: 'Sea ice', color: '#c6dce0' },
  lake: { label: 'Lake', color: '#4d92a0' }, lakeIce: { label: 'Frozen lake', color: '#b5dadd' },
};
export type WorldLayer = 'biomes' | 'temperature' | 'moisture' | 'fertility';
export interface WorldCoordinate { x: number; y: number }
/** A polity marker: bands are circles, settled civilizations squares, coloured by era. */
export interface BandMarker { x: number; y: number; population: number; color: string; settled?: boolean }
/** A settlement mark at its cell, by tier (0 village, 1 town, 2 city, 3 metropolis); capitals are stars. `name` is
 *  empty for places the map does not label. */
export interface SettlementMark { x: number; y: number; capital: boolean; tier: number; name: string; features?: number }
/** A road between two places in world cell coordinates (the main settlements, or centres, of the regions it joins), by
 *  tier (1 road, 2 paved road, 3 railway, 4 highway), and whether a bridge carries it over a river. */
export interface RoadMark { x1: number; y1: number; x2: number; y2: number; tier: number; bridge: boolean }
/** Road lines by tier: colour, width in pixels and dash. */
export const ROAD_STYLE: readonly { color: string; width: number; dash: number[] }[] = [
  { color: '#8a6a43', width: 1.1, dash: [3, 2] }, { color: '#5e4630', width: 1.7, dash: [] },
  { color: '#2d2a28', width: 2, dash: [5, 2] }, { color: '#9b3b2e', width: 2.4, dash: [] },
];
interface WorldView { zoom: number; detail: boolean; tiles: WorldCoordinate[] }
interface Callbacks {
  onSelect: (cell: WorldCoordinate | null) => void;
  onView: (view: WorldView) => void;
  onError: (cause: unknown) => void;
}
type Rgb = readonly [number, number, number];
const temperatureStops: readonly (readonly [number, Rgb])[] = [
  [-40, [70, 69, 121]], [-20, [95, 143, 186]], [0, [197, 220, 220]],
  [10, [228, 229, 171]], [20, [229, 173, 91]], [30, [197, 90, 53]], [40, [131, 49, 48]],
];
const moistureStops: readonly (readonly [number, Rgb])[] = [[0, [191, 151, 96]], [0.3, [219, 207, 160]], [0.5, [161, 195, 164]], [0.75, [70, 146, 141]], [1, [29, 78, 105]]];
const fertilityStops: readonly (readonly [number, Rgb])[] = [[0, [151, 105, 76]], [50, [223, 212, 155]], [100, [47, 103, 65]]];
const fertilityWater: Rgb = [143, 177, 184];
export const TEMPERATURE_GRADIENT = 'linear-gradient(90deg, #464579 0%, #5f8fba 25%, #c5dcdc 50%, #e4e5ab 62.5%, #e5ad5b 75%, #c55a35 87.5%, #833130 100%)';
export const MOISTURE_GRADIENT = 'linear-gradient(90deg, #bf9760, #dbcfa0 30%, #a1c3a4 50%, #46928d 75%, #1d4e69)';
export const FERTILITY_GRADIENT = 'linear-gradient(90deg, #97694c, #dfd49b 50%, #2f6741)';
export const FERTILITY_WATER_COLOR = '#8fb1b8';

function blend(stops: readonly (readonly [number, Rgb])[], value: number): Rgb {
  if (value <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index++) {
    const [to, color] = stops[index];
    if (value > to) continue;
    const [from, previous] = stops[index - 1];
    const fraction = (value - from) / (to - from);
    return previous.map((channel, at) => Math.round(channel + (color[at] - channel) * fraction)) as unknown as Rgb;
  }
  return stops[stops.length - 1][1];
}
const biomeColors = WORLD_BIOMES.map(biome => {
  const color = WORLD_BIOME_STYLE[biome].color;
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)] as Rgb;
});
const wrap = (value: number, width: number) => ((value % width) + width) % width;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Rendering and pointer/keyboard navigation only. Geography is supplied by the host. */
/**
 * `overlay` (optional) is a transparent canvas stacked on the map for simulation marks (region borders, band markers):
 * they change with every observer frame, so they are redrawn there without repainting the terrain.
 */
export function createGeneratedWorldRenderer(canvas: HTMLCanvasElement, world: WorldManifest, callbacks: Callbacks, overlay?: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not open the world canvas. Use Retry canvas or reload in a browser with Canvas 2D support.');
  const ctx: CanvasRenderingContext2D = context;
  let layer: WorldLayer = 'biomes';
  let resources = true;
  let rivers = true;
  let regionCells: Uint16Array | null = null, regionBorders: Path2D | null = null, regionBorderCount = 0, showRegions = false;
  let markers: BandMarker[] = [], villages: SettlementMark[] = [], villageStyle = { fill: '#ffffff', stroke: '#000000' }, roads: RoadMark[] = [];
  // Territories: one pixel per world cell, coloured by the people living in its region (drawn scaled on the overlay).
  let territoryFill: Uint32Array | null = null, territoryImage: HTMLCanvasElement | null = null, territoryCount = 0;
  // Cultivated land: one pixel per world cell (1 where cultivated), drawn as wheat-coloured furrows over the territories.
  let fieldCells: Uint8Array | null = null, fieldImage: HTMLCanvasElement | null = null, fieldCount = 0;
  let zoom = 1, centerX = world.width / 2, centerY = world.height / 2;
  let selection: WorldCoordinate | null = null;
  let focus: WorldCoordinate = { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
  let tiles: WorldTile[] = [];
  let overview: HTMLCanvasElement | null = null;
  let terrain: ReturnType<typeof createWorldTerrainTexture> | undefined;
  const textures = new Map<string, HTMLCanvasElement>();
  const riverReaches = buildRiverReaches(world.hydrology, world.width).map(reach => {
    const path = new Path2D();
    for (const command of riverPathCommands(reach.points)) {
      if (command.kind === 'move') path.moveTo(command.x, command.y);
      else if (command.kind === 'line') path.lineTo(command.x, command.y);
      else if (command.kind === 'curve') path.quadraticCurveTo(command.cx, command.cy, command.x, command.y);
    }
    return { path, runoff: reach.runoff, minX: reach.minX, maxX: reach.maxX, minY: reach.minY, maxY: reach.maxY };
  });
  let destroyed = false;
  let frame = 0;
  let gesture: { id: number; startX: number; startY: number; x: number; y: number; dragged: boolean } | null = null;
  canvas.style.touchAction = 'none';

  function texture(fields: WorldFields, width: number, height: number) {
    const surface = document.createElement('canvas');
    surface.width = width; surface.height = height;
    const paint = surface.getContext('2d');
    if (!paint) throw new Error('World canvas detail could not be drawn. Use Retry canvas.');
    const pixels = paint.createImageData(width, height);
    for (let at = 0; at < width * height; at++) {
      const colour = layer === 'temperature' ? blend(temperatureStops, fields.temperature[at] / 10)
        : layer === 'fertility' ? isWorldWater(WORLD_BIOMES[fields.biome[at]]) ? fertilityWater : blend(fertilityStops, fields.fertility[at])
        : blend(moistureStops, fields.moisture[at] / 1000);
      pixels.data.set([...colour, 255], at * 4);
    }
    paint.putImageData(pixels, 0, 0);
    return surface;
  }
  function metrics() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const scale = Math.min(width / world.width, height / world.height) * zoom;
    const halfHeight = height / scale / 2;
    centerX = wrap(centerX, world.width);
    centerY = halfHeight >= world.height / 2 ? world.height / 2 : clamp(centerY, halfHeight, world.height - halfHeight);
    return { width, height, ratio, scale, detail: scale >= Math.max(2, width / 384, height / 256) };
  }
  function visibleTiles(): WorldCoordinate[] {
    const m = metrics();
    if (!m.detail) return [];
    const found = new Map<string, WorldCoordinate>();
    const left = Math.floor((centerX - m.width / m.scale / 2) / 128);
    const right = Math.floor((centerX + m.width / m.scale / 2) / 128);
    const top = Math.max(0, Math.floor((centerY - m.height / m.scale / 2) / 128));
    const bottom = Math.min(world.height / 128 - 1, Math.floor((centerY + m.height / m.scale / 2) / 128));
    for (let y = top; y <= bottom; y++) for (let column = left; column <= right; column++) {
      const x = wrap(column, world.width / 128);
      found.set(`${x},${y}`, { x, y });
    }
    return [...found.values()];
  }
  function drawRivers(left: number, top: number, scale: number, width: number, height: number) {
    if (!rivers || layer !== 'biomes') return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#478b9b';
    for (const reach of riverReaches) {
      const style = riverAppearance(reach.runoff, zoom, scale);
      if (!style.opacity || top + reach.maxY * scale < -4 || top + reach.minY * scale > height + 4) continue;
      const worldPixels = world.width * scale;
      const firstCopy = Math.ceil((-4 - left - reach.maxX * scale) / worldPixels);
      const lastCopy = Math.floor((width + 4 - left - reach.minX * scale) / worldPixels);
      for (let copy = firstCopy; copy <= lastCopy; copy++) {
        ctx.save(); ctx.translate(left + copy * worldPixels, top); ctx.scale(scale, scale);
        ctx.globalAlpha = style.opacity; ctx.lineWidth = style.width / scale;
        ctx.stroke(reach.path); ctx.restore();
      }
    }
    ctx.restore();
  }
  function draw() {
    if (destroyed) return;
    const started = performance.now();
    const m = metrics();
    const pixelWidth = Math.round(m.width * m.ratio), pixelHeight = Math.round(m.height * m.ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    ctx.setTransform(m.ratio, 0, 0, m.ratio, 0, 0);
    ctx.fillStyle = '#d9e0d9'; ctx.fillRect(0, 0, m.width, m.height);
    const left = m.width / 2 - centerX * m.scale, top = m.height / 2 - centerY * m.scale;
    const background = layer === 'biomes'
      ? (terrain ??= createWorldTerrainTexture(world, biomeColors)).plate
      : (overview ??= texture(world.overview.fields, world.overview.width, world.overview.height));
    const startCopy = Math.floor((-left) / (world.width * m.scale));
    const endCopy = Math.floor((m.width - left) / (world.width * m.scale));
    ctx.imageSmoothingEnabled = false;
    for (let copy = startCopy; copy <= endCopy; copy++) {
      const origin = left + copy * world.width * m.scale;
      ctx.drawImage(background, origin, top, world.width * m.scale, world.height * m.scale);
      if (m.detail && layer !== 'biomes') for (const tile of tiles) {
        const x = origin + tile.x * 128 * m.scale, y = top + tile.y * 128 * m.scale;
        const edge = 128 * m.scale;
        if (x + edge < 0 || x > m.width || y + edge < 0 || y > m.height) continue;
        const key = `${tile.x},${tile.y}`;
        let surface = textures.get(key);
        if (!surface) { surface = texture(tile.fields, 128, 128); textures.set(key, surface); }
        ctx.drawImage(surface, x, y, edge, edge);
      }
      if (layer === 'biomes') terrain!.patterns(ctx, origin, top, m.scale, m.width, m.height);
    }
    // Draw after all world copies so the next background cannot erase a seam edge.
    drawRivers(left, top, m.scale, m.width, m.height);

    for (let copy = startCopy; copy <= endCopy; copy++) {
      const origin = left + copy * world.width * m.scale;
      if (m.detail && resources && m.scale >= 5) for (const tile of tiles) {
        const x = origin + tile.x * 128 * m.scale, y = top + tile.y * 128 * m.scale;
        const edge = 128 * m.scale;
        if (x + edge < 0 || x > m.width || y + edge < 0 || y > m.height) continue;
        for (let at = 0; at < tile.fields.resource.length; at++) {
          const resource = RESOURCE_IDS[tile.fields.resource[at] - 1];
          if (!resource) continue;
          const pointX = x + (at % 128 + 0.5) * m.scale, pointY = y + (Math.floor(at / 128) + 0.5) * m.scale;
          if (pointX < -12 || pointX > m.width + 12 || pointY < -12 || pointY > m.height + 12) continue;
          ctx.beginPath(); ctx.arc(pointX, pointY, 8, 0, Math.PI * 2); ctx.fillStyle = '#f4f3e5dc'; ctx.fill();
          drawAtlasResourceIcon(ctx, resource, pointX, pointY, 6);
        }
      }
    }

    if (zoom <= 3) {
      ctx.save(); ctx.strokeStyle = '#f4f2d936'; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
      for (const latitude of [-60, -30, 0, 30, 60]) {
        const y = top + (1 - Math.sin(latitude * Math.PI / 180)) / 2 * world.height * m.scale;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.width, y); ctx.stroke();
        ctx.font = '10px system-ui'; ctx.fillStyle = '#f4f2e0ba'; ctx.fillText(latitude === 0 ? 'EQUATOR' : `${Math.abs(latitude)}° ${latitude > 0 ? 'N' : 'S'}`, 12, y - 6);
      }
      ctx.restore();
    }
    if (selection) {
      const offsetX = wrap(selection.x + 0.5 - centerX + world.width / 2, world.width) - world.width / 2;
      const x = m.width / 2 + offsetX * m.scale, y = top + (selection.y + 0.5) * m.scale;
      const edge = Math.max(8, m.scale);
      ctx.strokeStyle = '#172c26'; ctx.lineWidth = 3; ctx.strokeRect(x - edge / 2, y - edge / 2, edge, edge);
      ctx.strokeStyle = '#fff7d5'; ctx.lineWidth = 1.5; ctx.strokeRect(x - edge / 2, y - edge / 2, edge, edge);
    }
    canvas.dataset.rendered = 'true'; canvas.dataset.worldKey = world.worldKey; canvas.dataset.layer = layer;
    canvas.dataset.zoom = String(zoom); canvas.dataset.centerX = String(centerX); canvas.dataset.centerY = String(centerY);
    canvas.dataset.scale = String(m.scale); canvas.dataset.detail = String(m.detail);
    canvas.dataset.loadedTileCount = String(tiles.length);
    drawOverlay(m, left, top, startCopy, endCopy);
    canvas.dataset.textureCount = String(textures.size); canvas.dataset.renderMs = (performance.now() - started).toFixed(2);
  }
  /** Simulation marks on the overlay canvas (or on the map when there is none), in the map's current camera. */
  function drawOverlay(m = metrics(), left = m.width / 2 - centerX * m.scale, top = m.height / 2 - centerY * m.scale,
    startCopy = Math.floor((-left) / (world.width * m.scale)), endCopy = Math.floor((m.width - left) / (world.width * m.scale))) {
    if (destroyed) return;
    let target = ctx;
    if (overlay) {
      const pixelWidth = Math.round(m.width * m.ratio), pixelHeight = Math.round(m.height * m.ratio);
      if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) { overlay.width = pixelWidth; overlay.height = pixelHeight; }
      const paint = overlay.getContext('2d');
      if (!paint) return;
      target = paint;
      target.setTransform(1, 0, 0, 1, 0, 0); target.clearRect(0, 0, overlay.width, overlay.height);
      target.setTransform(m.ratio, 0, 0, m.ratio, 0, 0);
    }
    if (territoryFill && regionCells) {
      territoryImage ??= paintTerritories(territoryFill, regionCells);
      if (territoryImage) {
        // Strong at world scale, where a region is a few pixels; fainter zoomed in, so the terrain shows through.
        target.save(); target.imageSmoothingEnabled = false; target.globalAlpha = clamp(1.1 - m.scale * 0.05, 0.45, 1);
        for (let copy = startCopy; copy <= endCopy; copy++) target.drawImage(territoryImage, left + copy * world.width * m.scale, top, world.width * m.scale, world.height * m.scale);
        target.restore();
      }
    }
    if (fieldCells && fieldCount) {
      fieldImage ??= paintFields(fieldCells);
      if (fieldImage) {
        // Faint at world scale, so the peoples' colours show through; plainer as the map zooms in.
        target.save(); target.imageSmoothingEnabled = false; target.globalAlpha = clamp(0.2 + m.scale * 0.06, 0.3, 0.7);
        for (let copy = startCopy; copy <= endCopy; copy++) target.drawImage(fieldImage, left + copy * world.width * m.scale, top, world.width * m.scale, world.height * m.scale);
        target.restore();
      }
    }
    canvas.dataset.fieldCells = String(fieldCells ? fieldCount : 0);
    if (showRegions && regionBorders) {
      target.save(); target.strokeStyle = '#5b3a29'; target.globalAlpha = 0.55; target.lineCap = 'square';
      for (let copy = startCopy; copy <= endCopy; copy++) {
        target.save(); target.translate(left + copy * world.width * m.scale, top); target.scale(m.scale, m.scale);
        target.lineWidth = Math.min(1.4, 0.35 + m.scale * 0.12) / m.scale; target.stroke(regionBorders); target.restore();
      }
      target.restore();
    }
    // Roads between the places they join, under the markers: dashed tracks, solid paved roads; bridges as small light
    // squares at the crossing from detail zoom. Each road takes the shorter way round the wrapped world.
    let bridgeMarks = 0;
    if (roads.length) {
      target.save(); target.lineCap = 'round'; target.globalAlpha = 0.9;
      const thin = m.scale < 2 ? 0.7 : 1, crossings: { x: number; y: number }[] = [];
      for (let tier = 1; tier <= ROAD_STYLE.length; tier++) {
        const style = ROAD_STYLE[tier - 1];
        target.beginPath(); target.strokeStyle = style.color; target.lineWidth = style.width * thin; target.setLineDash(style.dash);
        let drawn = false;
        // One copy more on each side: a road drawn from its first end may cross the world's seam into view.
        for (let copy = startCopy - 1; copy <= endCopy + 1; copy++) for (const road of roads) {
          if (road.tier !== tier) continue;
          const dx = wrap(road.x2 - road.x1 + world.width / 2, world.width) - world.width / 2;
          const x1 = left + (copy * world.width + road.x1 + 0.5) * m.scale, y1 = top + (road.y1 + 0.5) * m.scale;
          const x2 = x1 + dx * m.scale, y2 = top + (road.y2 + 0.5) * m.scale;
          if (Math.max(x1, x2) < -4 || Math.min(x1, x2) > m.width + 4 || Math.max(y1, y2) < -4 || Math.min(y1, y2) > m.height + 4) continue;
          target.moveTo(x1, y1); target.lineTo(x2, y2); drawn = true;
          if (road.bridge && m.scale >= 3) crossings.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
        }
        if (drawn) target.stroke();
      }
      target.setLineDash([]); target.fillStyle = '#f2ead8'; target.strokeStyle = '#3d3024'; target.lineWidth = 1;
      const size = Math.max(3, Math.min(6, m.scale * 0.5));
      for (const crossing of crossings) { target.fillRect(crossing.x - size / 2, crossing.y - size / 2, size, size); target.strokeRect(crossing.x - size / 2, crossing.y - size / 2, size, size); bridgeMarks++; }
      target.restore();
    }
    canvas.dataset.roadMarks = String(roads.length);
    canvas.dataset.bridgeMarks = String(bridgeMarks);
    // Polity markers at their region's centre. Populations run from a few dozen foragers to a million farmers, so size
    // follows the logarithm of population, and no marker grows wider than about half a region. Over territories they
    // appear once a region is large enough on screen to hold one.
    if (markers.length && (!territoryFill || m.scale >= 2)) {
      target.save(); target.lineWidth = m.scale < 3 ? 0.6 : 1.2; target.strokeStyle = '#2b1d12';
      // Small at world scale (a region is a few pixels wide), larger when zoomed in.
      const grow = Math.sqrt(m.scale), largest = Math.max(1.4, 2.6 * m.scale);
      // Every visible copy of the wrapped world, like the region borders.
      // Zoomed in, a civilization's settlements show where it lives: its region squares would only crowd them.
      const settledShown = villages.length > 0 && m.scale >= 4;
      for (let copy = startCopy; copy <= endCopy; copy++) for (const marker of markers) {
        if (marker.settled && settledShown) continue;
        const x = left + (copy * world.width + marker.x + 0.5) * m.scale, y = top + (marker.y + 0.5) * m.scale;
        const radius = Math.max(1.4, Math.min(largest, (0.8 + 0.5 * Math.log10(1 + marker.population / 100)) * grow));
        if (x < -radius || x > m.width + radius || y < -radius || y > m.height + radius) continue;
        target.beginPath();
        if (marker.settled) target.rect(x - radius * 0.9, y - radius * 0.9, radius * 1.8, radius * 1.8); else target.arc(x, y, radius, 0, Math.PI * 2);
        target.fillStyle = marker.color; target.globalAlpha = 0.85; target.fill(); target.globalAlpha = 1; target.stroke();
      }
      target.restore();
    }
    // Settlements on their own cells, by tier: villages (small diamonds) once a region is a few pixels across, towns
    // (larger diamonds) a little sooner, cities and metropolises (rings) at every zoom; capitals as stars, larger with
    // their tier, so the political map shows where each civilization is governed from. Names follow as the map zooms:
    // metropolises and cities first, then towns and capitals.
    let capitalMarks = 0, labels = 0, features = 0;
    if (villages.length) {
      target.save(); target.fillStyle = villageStyle.fill; target.strokeStyle = villageStyle.stroke; target.lineWidth = 1;
      const base = Math.max(2.5, Math.min(7, m.scale * 0.6)), star = Math.max(3.5, Math.min(8, m.scale * 0.9));
      const shownFrom = [1.5, 1, 0, 0], labelFrom = [Number.POSITIVE_INFINITY, 4, 2, 1.2], growth = [0.7, 1, 1.35, 1.7];
      const named: PlaceLabel[] = [];
      for (let copy = startCopy; copy <= endCopy; copy++) for (const village of villages) {
        if (!village.capital && m.scale < shownFrom[village.tier]) continue;
        const x = left + (copy * world.width + village.x + 0.5) * m.scale, y = top + (village.y + 0.5) * m.scale;
        const half = (village.capital ? star * (0.85 + 0.15 * village.tier) : base * growth[village.tier]) / 2;
        if (x < -half || x > m.width + half || y < -half || y > m.height + half) continue;
        target.beginPath();
        if (village.capital) {
          for (let point = 0; point < 10; point++) {
            const angle = -Math.PI / 2 + point * Math.PI / 5, radius = point % 2 ? half * 0.45 : half * 1.2;
            if (point) target.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle)); else target.moveTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
          }
          capitalMarks++;
        } else if (village.tier >= 2) {
          target.arc(x, y, half, 0, Math.PI * 2);
          if (village.tier === 3) { target.moveTo(x + half * 0.5, y); target.arc(x, y, half * 0.5, 0, Math.PI * 2); }
        } else { target.moveTo(x, y - half * 1.3); target.lineTo(x + half, y); target.lineTo(x, y + half * 1.3); target.lineTo(x - half, y); }
        target.closePath(); target.fill(); target.stroke();
        // At detail zoom, what stands there: a harbor (a blue disc below right), a mine (a dark triangle below left), a
        // quarry (a grey square below), a wonder (a gold disc above).
        if (village.features && m.scale >= 4) {
          const glyph = Math.max(2, half * 0.55);
          if (village.features & 1) { target.save(); target.beginPath(); target.arc(x + half * 1.1, y + half * 1.1, glyph, 0, Math.PI * 2); target.fillStyle = '#2f6f9f'; target.fill(); target.stroke(); target.restore(); features++; }
          if (village.features & 2) { target.save(); target.beginPath(); target.moveTo(x - half * 1.1, y + half * 1.1 - glyph); target.lineTo(x - half * 1.1 + glyph, y + half * 1.1 + glyph * 0.8); target.lineTo(x - half * 1.1 - glyph, y + half * 1.1 + glyph * 0.8); target.closePath(); target.fillStyle = '#3b2f2a'; target.fill(); target.stroke(); target.restore(); features++; }
          if (village.features & 8) { target.save(); target.beginPath(); target.arc(x, y - half * 1.6, glyph * 0.9, 0, Math.PI * 2); target.fillStyle = '#d4a017'; target.fill(); target.stroke(); target.restore(); features++; }
          if (village.features & 4) { target.save(); target.fillStyle = '#9a958c'; target.fillRect(x - glyph, y + half * 1.5, glyph * 2, glyph * 2); target.strokeRect(x - glyph, y + half * 1.5, glyph * 2, glyph * 2); target.restore(); features++; }
        }
        if (village.name && m.scale >= Math.min(labelFrom[village.tier], village.capital ? 2 : Number.POSITIVE_INFINITY)) named.push({ x: x + half + 3, y, name: village.name, tier: village.tier, capital: village.capital });
      }
      // Capitals first, then larger places; a name that would overlap one already placed is left out, so the map stays
      // readable where towns crowd (zooming in brings the rest).
      target.textBaseline = 'middle'; target.lineJoin = 'round';
      const font = (label: PlaceLabel) => `${label.tier >= 2 ? 600 : 500} ${label.tier >= 2 ? 12 : 11}px system-ui, sans-serif`;
      for (const label of placeLabels(named, label => { target.font = font(label); return target.measureText(label.name).width; })) {
        target.font = font(label);
        target.lineWidth = 3; target.strokeStyle = 'rgba(244, 239, 224, 0.92)'; target.strokeText(label.name, label.x, label.y);
        target.fillStyle = '#2b1d12'; target.fillText(label.name, label.x, label.y);
        labels++;
      }
      target.restore();
    }
    canvas.dataset.capitalMarks = String(capitalMarks);
    canvas.dataset.settlementLabels = String(labels);
    canvas.dataset.settlementFeatures = String(features);
    // Keep the selected cell's outline above the marks.
    if (overlay && selection && (markers.length || villages.length || showRegions)) {
      const offsetX = wrap(selection.x + 0.5 - centerX + world.width / 2, world.width) - world.width / 2;
      const x = m.width / 2 + offsetX * m.scale, y = top + (selection.y + 0.5) * m.scale, edge = Math.max(8, m.scale);
      target.strokeStyle = '#172c26'; target.lineWidth = 3; target.strokeRect(x - edge / 2, y - edge / 2, edge, edge);
      target.strokeStyle = '#fff7d5'; target.lineWidth = 1.5; target.strokeRect(x - edge / 2, y - edge / 2, edge, edge);
    }
    canvas.dataset.regionBorders = String(showRegions ? regionBorderCount : 0);
    canvas.dataset.bandMarkers = String(markers.length);
    canvas.dataset.territoryRegions = String(territoryFill && regionCells ? territoryCount : 0);
    canvas.dataset.settlementMarks = String(villages.length);
  }
  /**
   * The territory image: each land cell takes its region's packed RGBA colour (0 = nobody lives there). Cells on the
   * edge of a colour (beside another colour or empty land; water does not count) are drawn darker and nearly opaque,
   * so each people's land reads as an outlined patch over the terrain.
   */
  function paintTerritories(fill: Uint32Array, cells: Uint16Array) {
    const { width, height } = world;
    if (cells.length !== width * height) return null;
    const image = document.createElement('canvas');
    image.width = width; image.height = height;
    const paint = image.getContext('2d');
    if (!paint) return null;
    const pixels = paint.createImageData(width, height), packed = new Uint32Array(pixels.data.buffer);
    // A neighbouring cell's colour; water (and the map's edge) takes the asking cell's colour, so coasts and lakes
    // draw no outline.
    const colorAt = (x: number, y: number, own: number) => {
      if (y < 0 || y >= height) return own;
      const region = cells[y * width + (x + width) % width];
      return region ? (fill[region - 1] ?? 0) & 0xffffff : own;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const region = cells[y * width + x], value = region ? fill[region - 1] ?? 0 : 0;
      if (!value) continue;
      const color = value & 0xffffff;
      const edge = colorAt(x - 1, y, color) !== color || colorAt(x + 1, y, color) !== color || colorAt(x, y - 1, color) !== color || colorAt(x, y + 1, color) !== color;
      if (!edge) { packed[y * width + x] = value; continue; }
      const darker = (shift: number) => Math.round(((color >>> shift) & 0xff) * 0.62);
      packed[y * width + x] = (darker(0) | darker(8) << 8 | darker(16) << 16 | 235 << 24) >>> 0;
    }
    paint.putImageData(pixels, 0, 0);
    return image;
  }
  /** The cultivated-land image: wheat-coloured cells, every other diagonal darker so fields read as furrows. */
  function paintFields(cells: Uint8Array) {
    const { width, height } = world;
    if (cells.length !== width * height) return null;
    const image = document.createElement('canvas');
    image.width = width; image.height = height;
    const paint = image.getContext('2d');
    if (!paint) return null;
    const pixels = paint.createImageData(width, height), packed = new Uint32Array(pixels.data.buffer);
    const light = (0xd8 | 0xc0 << 8 | 0x6a << 16 | 0xd0 << 24) >>> 0, dark = (0xb8 | 0x98 << 8 | 0x48 << 16 | 0xd8 << 24) >>> 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (cells[y * width + x]) packed[y * width + x] = (x + y) % 2 ? dark : light;
    paint.putImageData(pixels, 0, 0);
    return image;
  }
  function safe(action: () => void) { try { action(); } catch (cause) { callbacks.onError(cause); } }
  function changed() {
    safe(() => { draw(); callbacks.onView({ zoom, detail: metrics().detail, tiles: visibleTiles() }); });
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; changed(); }); }
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    const before = metrics();
    const next = clamp(zoom * factor, 1, 64);
    if (anchor) {
      const after = before.scale * next / zoom;
      centerX += (anchor.x - before.width / 2) * (1 / before.scale - 1 / after);
      centerY += (anchor.y - before.height / 2) * (1 / before.scale - 1 / after);
    }
    zoom = next; changed();
  }
  function select(cell: WorldCoordinate | null) {
    selection = cell; if (cell) focus = cell;
    callbacks.onSelect(cell); safe(draw);
  }
  function atPoint(x: number, y: number): WorldCoordinate | null {
    const m = metrics();
    const row = Math.floor(centerY + (y - m.height / 2) / m.scale);
    if (row < 0 || row >= world.height) return null;
    return { x: Math.floor(wrap(centerX + (x - m.width / 2) / m.scale, world.width)), y: row };
  }
  function resourceAtPoint(x: number, y: number): WorldCoordinate | null {
    const m = metrics();
    if (!resources || !m.detail || m.scale < 5) return null;
    let nearest: WorldCoordinate | null = null, distance = 8;
    for (const tile of tiles) for (let at = 0; at < tile.fields.resource.length; at++) {
      if (!tile.fields.resource[at]) continue;
      const column = tile.x * 128 + at % 128, row = tile.y * 128 + Math.floor(at / 128);
      const dx = wrap(column + 0.5 - centerX + world.width / 2, world.width) - world.width / 2;
      const pointX = m.width / 2 + dx * m.scale, pointY = m.height / 2 + (row + 0.5 - centerY) * m.scale;
      const separation = Math.hypot(pointX - x, pointY - y);
      if (separation <= distance) { distance = separation; nearest = { x: column, y: row }; }
    }
    return nearest;
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || gesture) return;
    canvas.focus(); canvas.setPointerCapture(event.pointerId);
    gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragged: false };
  }
  function pointerMove(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.dragged ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5;
    if (gesture.dragged) {
      const m = metrics(); centerX -= (event.clientX - gesture.x) / m.scale; centerY -= (event.clientY - gesture.y) / m.scale; schedule();
    }
    gesture.x = event.clientX; gesture.y = event.clientY;
  }
  function pointerUp(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.dragged) {
      const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      select(resourceAtPoint(x, y) ?? atPoint(x, y));
    }
    gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function pointerCancel() { gesture = null; }
  function wheel(event: WheelEvent) {
    event.preventDefault(); const box = canvas.getBoundingClientRect();
    zoomBy(Math.exp(-clamp(event.deltaY, -200, 200) * 0.003), { x: event.clientX - box.left, y: event.clientY - box.top });
  }
  function fit() { zoom = 1; centerX = world.width / 2; centerY = world.height / 2; changed(); }
  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const directions: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      if (event.shiftKey) { const m = metrics(); centerX += direction[0] * 90 / m.scale; centerY += direction[1] * 90 / m.scale; changed(); }
      else {
        focus = { x: wrap(focus.x + direction[0], world.width), y: clamp(focus.y + direction[1], 0, world.height - 1) };
        const m = metrics();
        const dx = wrap(focus.x - centerX + world.width / 2, world.width) - world.width / 2;
        if (Math.abs(dx) > m.width / m.scale / 2 - 3 || Math.abs(focus.y - centerY) > m.height / m.scale / 2 - 3) { centerX = focus.x + 0.5; centerY = focus.y + 0.5; changed(); }
        select(focus);
      }
    } else if (['Enter', 'Escape', 'Home', '+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') select(focus);
      else if (event.key === 'Escape') select(null);
      else if (event.key === 'Home') fit();
      else zoomBy(event.key === '-' ? 1 / 1.6 : 1.6);
    }
  }
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('lostpointercapture', pointerCancel); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', keydown);
  const observer = new ResizeObserver(schedule); observer.observe(canvas);
  changed();
  return {
    zoomBy, fit,
    setLayer(next: WorldLayer, showResources: boolean, showRivers = true) {
      if (layer !== next) { layer = next; overview = null; textures.clear(); }
      resources = showResources; rivers = showRivers; safe(draw);
    },
    setTiles(next: WorldTile[]) {
      tiles = next.slice(-16);
      const retained = new Set(tiles.map(tile => `${tile.x},${tile.y}`));
      for (const key of textures.keys()) if (!retained.has(key)) textures.delete(key);
      safe(draw);
    },
    clearSelection() { select(null); },
    /** Centre the view on a cell and select it (for example a civilization's capital picked from a list). */
    focusCell(cell: WorldCoordinate) { centerX = cell.x + 0.5; centerY = cell.y + 0.5; changed(); select(cell); },
    /** Band markers in world cell coordinates; replaces the previous set. */
    setBands(next: BandMarker[]) { markers = next; safe(() => overlay ? drawOverlay() : draw()); },
    /**
     * Territories: packed little-endian RGBA per region (`r | g << 8 | b << 16 | a << 24`, 0 for nobody), drawn under the
     * borders and markers once the region map is set; null hides them.
     */
    setTerritories(fill: Uint32Array | null) {
      territoryFill = fill; territoryImage = null; territoryCount = fill ? fill.reduce((count, value) => count + (value ? 1 : 0), 0) : 0;
      safe(() => overlay ? drawOverlay() : draw());
    },
    /** Cultivated land: 1 per world cell where it is cultivated (row-major), or null to hide it. */
    setFields(cells: Uint8Array | null) {
      fieldCells = cells; fieldImage = null; fieldCount = cells ? cells.reduce((count, value) => count + value, 0) : 0;
      safe(() => overlay ? drawOverlay() : draw());
    },
    /** Roads in world cell coordinates; replaces the previous set. */
    setRoads(next: RoadMark[]) { roads = next; safe(() => overlay ? drawOverlay() : draw()); },
    /** Settlement marks in world cell coordinates, in the observer's palette; replaces the previous set. */
    setSettlements(next: SettlementMark[], style: { fill: string; stroke: string }) { villages = next; villageStyle = style; safe(() => overlay ? drawOverlay() : draw()); },
    /** Region index from the simulation (region id + 1, 0 for water); null clears it. */
    setRegions(cells: Uint16Array | null, visible: boolean) {
      if (cells !== regionCells) {
        regionCells = cells; regionBorders = null; regionBorderCount = 0; territoryImage = null;
        if (cells && cells.length === world.width * world.height) {
          const path = new Path2D(), runs = regionBorderRuns(cells, world.width, world.height);
          for (const run of runs) { path.moveTo(run.x1, run.y1); path.lineTo(run.x2, run.y2); }
          regionBorders = path; regionBorderCount = runs.length;
        }
      }
      showRegions = visible; safe(() => overlay ? drawOverlay() : draw());
    },
    destroy() {
      destroyed = true; observer.disconnect(); cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', pointerCancel); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keydown);
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
      textures.clear(); riverReaches.length = 0; tiles = []; overview = null; terrain = undefined; regionBorders = null; regionCells = null; markers = []; villages = []; territoryFill = null; territoryImage = null; canvas.style.touchAction = '';
      if (overlay) overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    },
  };
}
