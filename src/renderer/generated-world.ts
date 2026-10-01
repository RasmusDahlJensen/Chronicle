import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { isWorldWater, WORLD_BIOMES, type WorldBiome, type WorldFields, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';
import { BIOMES } from '../world/atlas.ts';
import { drawAtlasResourceIcon } from './biome-atlas.ts';
import { createWorldTerrainTexture } from './world-terrain-texture.ts';
import { buildRiverReaches, riverPathCommands, riverAppearance } from './river-paths.ts';

export const WORLD_BIOME_STYLE: Record<WorldBiome, { label: string; color: string }> = {
  ...BIOMES, boreal: { label: 'Boreal forest', color: '#567766' },
  steppe: { label: 'Dry steppe', color: '#b9ae83' }, seaIce: { label: 'Sea ice', color: '#c6dce0' },
  lake: { label: 'Lake', color: '#4d92a0' }, lakeIce: { label: 'Frozen lake', color: '#b5dadd' },
};
export type WorldLayer = 'biomes' | 'temperature' | 'moisture' | 'fertility';
export interface WorldCoordinate { x: number; y: number }
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
export function createGeneratedWorldRenderer(canvas: HTMLCanvasElement, world: WorldManifest, callbacks: Callbacks) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not open the world canvas. Use Retry canvas or reload in a browser with Canvas 2D support.');
  const ctx: CanvasRenderingContext2D = context;
  let layer: WorldLayer = 'biomes';
  let resources = true;
  let rivers = true;
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
    canvas.dataset.textureCount = String(textures.size); canvas.dataset.renderMs = (performance.now() - started).toFixed(2);
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
    destroy() {
      destroyed = true; observer.disconnect(); cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', pointerCancel); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keydown);
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
      textures.clear(); riverReaches.length = 0; tiles = []; overview = null; terrain = undefined; canvas.style.touchAction = '';
    },
  };
}
