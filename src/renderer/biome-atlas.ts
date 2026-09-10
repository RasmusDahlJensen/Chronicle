import {
  BIOMES,
  RESOURCES,
  type AtlasWorld,
  type Biome,
  type Resource,
} from '../world/atlas.ts';
import { parentAtlasSelection, pickAtlasCell, type AtlasSelection } from './atlas-selection.ts';

const PLATE_SCALE = 4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const CLICK_SLOP_PX = 5;

export interface AtlasLayers {
  resources: boolean;
  provinces: boolean;
  grid: boolean;
  resourceFilter: Resource | null;
}

export interface BiomeAtlasCallbacks {
  onSelect?: (selection: AtlasSelection) => void;
  onViewChange?: (zoom: number) => void;
}

export interface BiomeAtlasRenderer {
  setWorld(world: AtlasWorld): void;
  setLayers(layers: Partial<AtlasLayers>): void;
  setSelection(selection: AtlasSelection): void;
  zoomBy(factor: number): void;
  fit(): void;
  destroy(): void;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface PointerGesture {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
}

interface DrawMetrics {
  width: number;
  height: number;
  ratio: number;
  fitScale: number;
  pixelsPerCell: number;
}

type Rgb = readonly [number, number, number];

const DEFAULT_LAYERS: AtlasLayers = {
  resources: true,
  provinces: false,
  grid: false,
  resourceFilter: null,
};

const BIOME_ACCENTS: Record<Biome, { light: string; dark: string }> = {
  ocean: { light: '#286e8f', dark: '#092f4a' },
  coast: { light: '#55c4c1', dark: '#176f7a' },
  grassland: { light: '#a9bf63', dark: '#526f35' },
  forest: { light: '#4d8a4d', dark: '#21472e' },
  rainforest: { light: '#24825b', dark: '#0b4435' },
  desert: { light: '#e7c277', dark: '#a97336' },
  savanna: { light: '#c4ae58', dark: '#76672f' },
  wetland: { light: '#6fa584', dark: '#305f54' },
  tundra: { light: '#b8c2ad', dark: '#687b72' },
  mountain: { light: '#a69d8b', dark: '#4e5050' },
  snow: { light: '#f4f3e9', dark: '#aebdca' },
};

/**
 * Creates the interactive, read-only atlas view. The world remains independent
 * of Canvas and React; this module owns only pixels and canvas input listeners.
 */
export function createBiomeAtlasRenderer(
  canvas: HTMLCanvasElement,
  callbacks: BiomeAtlasCallbacks = {},
): BiomeAtlasRenderer {
  const drawingContext = canvas.getContext('2d', { alpha: false });
  if (!drawingContext) throw new Error('This browser could not open the atlas canvas.');
  const context: CanvasRenderingContext2D = drawingContext;

  let world: AtlasWorld | undefined;
  let plate: HTMLCanvasElement | undefined;
  let indexByCellId = new Map<number, number>();
  let selection: AtlasSelection = null;
  let focusCellId: number | null = null;
  let layers = { ...DEFAULT_LAYERS };
  let camera: Camera = { x: 0, y: 0, zoom: MIN_ZOOM };
  let gesture: PointerGesture | undefined;
  let destroyed = false;

  const previousTabIndex = canvas.getAttribute('tabindex');
  const previousTouchAction = canvas.style.touchAction;
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';

  function measure(): DrawMetrics | undefined {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !world) return undefined;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const fitScale = Math.min(width / world.width, height / world.height);
    return { width, height, ratio, fitScale, pixelsPerCell: fitScale * camera.zoom };
  }

  function clampCamera(metrics: DrawMetrics) {
    if (!world) return;
    const halfWidth = metrics.width / (2 * metrics.pixelsPerCell);
    const halfHeight = metrics.height / (2 * metrics.pixelsPerCell);
    camera.x = halfWidth >= world.width / 2
      ? world.width / 2
      : clamp(camera.x, halfWidth, world.width - halfWidth);
    camera.y = halfHeight >= world.height / 2
      ? world.height / 2
      : clamp(camera.y, halfHeight, world.height - halfHeight);
  }

  function redraw() {
    if (destroyed || !world || !plate) return;
    const started = performance.now();
    const metrics = measure();
    if (!metrics) return;
    clampCamera(metrics);

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#092f4a';
    context.fillRect(0, 0, metrics.width, metrics.height);
    context.imageSmoothingEnabled = metrics.pixelsPerCell < PLATE_SCALE * metrics.ratio;
    context.imageSmoothingQuality = 'high';
    context.setTransform(
      metrics.pixelsPerCell / PLATE_SCALE,
      0,
      0,
      metrics.pixelsPerCell / PLATE_SCALE,
      metrics.width / 2 - camera.x * metrics.pixelsPerCell,
      metrics.height / 2 - camera.y * metrics.pixelsPerCell,
    );
    context.drawImage(plate, 0, 0);
    context.restore();

    if (selection?.kind === 'province') drawSelection(context, world, selection, indexByCellId, camera, metrics);
    if (layers.provinces) drawProvinceBoundaries(context, world, camera, metrics, selection?.kind === 'province' ? selection.provinceId : null);
    if (layers.grid) drawGrid(context, world, camera, metrics);
    drawAnnotations(context, world, camera, metrics);
    const resourceMarkers = layers.resources
      ? drawResources(context, world, camera, metrics, layers.resourceFilter)
      : 0;
    // Keep the cell outline visible above resource glyphs at overview scales.
    if (selection?.kind === 'cell') drawSelection(context, world, selection, indexByCellId, camera, metrics);

    canvas.dataset.rendered = 'true';
    canvas.dataset.renderMs = (performance.now() - started).toFixed(1);
    canvas.dataset.resourceMarkers = String(resourceMarkers);
    canvas.dataset.zoom = camera.zoom.toFixed(2);
    canvas.dataset.selectionKind = selection?.kind ?? 'none';
    if (selection?.kind === 'cell') canvas.dataset.selectedCellId = String(selection.cellId);
    else delete canvas.dataset.selectedCellId;
    if (selection?.kind === 'province') canvas.dataset.selectedProvinceId = selection.provinceId;
    else delete canvas.dataset.selectedProvinceId;
  }

  function notifyViewChange() {
    callbacks.onViewChange?.(camera.zoom);
  }

  function setZoom(nextZoom: number, anchorX?: number, anchorY?: number) {
    if (!world) return;
    const before = measure();
    if (!before) return;
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - camera.zoom) < 0.0001) return;

    const sx = anchorX ?? before.width / 2;
    const sy = anchorY ?? before.height / 2;
    const worldX = camera.x + (sx - before.width / 2) / before.pixelsPerCell;
    const worldY = camera.y + (sy - before.height / 2) / before.pixelsPerCell;
    camera.zoom = next;
    const after = measure();
    if (!after) return;
    camera.x = worldX - (sx - after.width / 2) / after.pixelsPerCell;
    camera.y = worldY - (sy - after.height / 2) / after.pixelsPerCell;
    clampCamera(after);
    redraw();
    notifyViewChange();
  }

  function eventPoint(event: PointerEvent | WheelEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  function hitCell(screenX: number, screenY: number) {
    if (!world) return undefined;
    const metrics = measure();
    if (!metrics) return undefined;
    const x = Math.floor(camera.x + (screenX - metrics.width / 2) / metrics.pixelsPerCell);
    const y = Math.floor(camera.y + (screenY - metrics.height / 2) / metrics.pixelsPerCell);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
    return world.cells[y * world.width + x];
  }

  function hitResourceMarker(screenX: number, screenY: number) {
    if (!world || !layers.resources) return undefined;
    const metrics = measure();
    if (!metrics) return undefined;
    const radius = resourceMarkerRadius(metrics);
    const radiusSquared = radius * radius;
    const bounds = visibleBounds(world, camera, metrics, 2);
    let nearest: { index: number; distance: number } | undefined;
    forEachVisible(bounds, world.width, (index, x, y) => {
      const resource = world!.cells[index].resource;
      if (resource === null || (layers.resourceFilter !== null && resource !== layers.resourceFilter)) return;
      const point = worldToScreen(x + 0.5, y + 0.5, camera, metrics);
      const distance = (point.x - screenX) ** 2 + (point.y - screenY) ** 2;
      if (distance <= radiusSquared && (!nearest || distance < nearest.distance)) nearest = { index, distance };
    });
    return nearest ? world.cells[nearest.index] : undefined;
  }

  function chooseCell(cellId: number, drillDown = true) {
    if (!world) return;
    focusCellId = cellId;
    selection = drillDown ? pickAtlasCell(world, selection, cellId) : { kind: 'cell', cellId };
    callbacks.onSelect?.(selection);
    redraw();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !world || gesture) return;
    const point = eventPoint(event);
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: point.x,
      lastY: point.y,
      dragged: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  }

  function onPointerMove(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId || !world) return;
    const point = eventPoint(event);
    const dx = point.x - gesture.lastX;
    const dy = point.y - gesture.lastY;
    gesture.lastX = point.x;
    gesture.lastY = point.y;
    // Tap tolerance is in CSS pixels, independent of the backing canvas density.
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > CLICK_SLOP_PX) {
      gesture.dragged = true;
    }
    if (!gesture.dragged) return;
    const metrics = measure();
    if (!metrics) return;
    camera.x -= dx / metrics.pixelsPerCell;
    camera.y -= dy / metrics.pixelsPerCell;
    clampCamera(metrics);
    redraw();
    notifyViewChange();
  }

  function endPointer(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const point = eventPoint(event);
    const wasDragged = gesture.dragged;
    gesture = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!wasDragged) {
      const cell = hitResourceMarker(point.x, point.y) ?? hitCell(point.x, point.y);
      if (cell) chooseCell(cell.id);
    }
  }

  function cancelPointer(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function onLostPointerCapture(event: PointerEvent) {
    if (gesture?.id === event.pointerId) gesture = undefined;
  }

  function onWheel(event: WheelEvent) {
    if (!world) return;
    event.preventDefault();
    const point = eventPoint(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    setZoom(camera.zoom * factor, point.x, point.y);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!world) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      selection = parentAtlasSelection(world, selection);
      if (!selection) focusCellId = null;
      callbacks.onSelect?.(selection);
      redraw();
      return;
    }
    const zoomIn = event.key === '+' || event.key === '=';
    const zoomOut = event.key === '-' || event.key === '_';
    if (zoomIn || zoomOut) {
      event.preventDefault();
      setZoom(camera.zoom * (zoomIn ? 1.35 : 1 / 1.35));
      return;
    }
    if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      fitView();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const metrics = measure();
      if (!metrics) return;
      const cell = focusCellId === null ? hitCell(metrics.width / 2, metrics.height / 2) : world.cells[focusCellId];
      if (cell) chooseCell(cell.id);
      return;
    }

    const direction = keyDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    if (!event.shiftKey) {
      if (focusCellId === null) {
        const centerX = clamp(Math.floor(camera.x), 0, world.width - 1);
        const centerY = clamp(Math.floor(camera.y), 0, world.height - 1);
        focusCellId = world.cells[centerY * world.width + centerX].id;
      }
      if (moveSelection(direction.x, direction.y)) return;
    }
    const metrics = measure();
    if (!metrics) return;
    camera.x += direction.x * metrics.width * 0.12 / metrics.pixelsPerCell;
    camera.y += direction.y * metrics.height * 0.12 / metrics.pixelsPerCell;
    clampCamera(metrics);
    redraw();
    notifyViewChange();
  }

  function moveSelection(dx: number, dy: number) {
    if (!world || focusCellId === null) return false;
    const currentIndex = indexByCellId.get(focusCellId);
    if (currentIndex === undefined) return false;
    const x = currentIndex % world.width;
    const y = Math.floor(currentIndex / world.width);
    const nextX = clamp(x + dx, 0, world.width - 1);
    const nextY = clamp(y + dy, 0, world.height - 1);
    const next = world.cells[nextY * world.width + nextX];
    if (!next) return false;
    centerCellIfNeeded(nextX, nextY);
    chooseCell(next.id, false);
    return true;
  }

  function centerCellIfNeeded(cellX: number, cellY: number) {
    const metrics = measure();
    if (!metrics) return;
    const margin = 3;
    const halfWidth = metrics.width / (2 * metrics.pixelsPerCell) - margin;
    const halfHeight = metrics.height / (2 * metrics.pixelsPerCell) - margin;
    if (Math.abs(cellX + 0.5 - camera.x) > halfWidth) camera.x = cellX + 0.5;
    if (Math.abs(cellY + 0.5 - camera.y) > halfHeight) camera.y = cellY + 0.5;
    clampCamera(metrics);
  }

  function fitView() {
    if (!world) return;
    camera = { x: world.width / 2, y: world.height / 2, zoom: MIN_ZOOM };
    redraw();
    notifyViewChange();
  }

  const resizeObserver = new ResizeObserver(redraw);
  resizeObserver.observe(canvas);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('lostpointercapture', onLostPointerCapture);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);

  return {
    setWorld(nextWorld) {
      const started = performance.now();
      world = nextWorld;
      indexByCellId = new Map(nextWorld.cells.map((cell, index) => [cell.id, index]));
      plate = paintTerrainPlate(nextWorld);
      selection = null;
      focusCellId = null;
      camera = { x: nextWorld.width / 2, y: nextWorld.height / 2, zoom: MIN_ZOOM };
      redraw();
      canvas.dataset.renderMs = (performance.now() - started).toFixed(1);
      notifyViewChange();
    },
    setLayers(nextLayers) {
      layers = { ...layers, ...nextLayers };
      redraw();
    },
    setSelection(nextSelection) {
      selection = nextSelection;
      if (selection?.kind === 'cell') {
        if (indexByCellId.has(selection.cellId)) focusCellId = selection.cellId;
        else selection = null;
      } else if (selection?.kind === 'province') {
        const provinceId = selection.provinceId;
        if (focusCellId === null || world?.cells[focusCellId]?.provinceId !== provinceId) {
          focusCellId = world?.cells.find(cell => cell.provinceId === provinceId)?.id ?? null;
          if (focusCellId === null) selection = null;
        }
      }
      if (!selection) focusCellId = null;
      redraw();
    },
    zoomBy(factor) {
      if (Number.isFinite(factor) && factor > 0) setZoom(camera.zoom * factor);
    },
    fit: fitView,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.style.touchAction = previousTouchAction;
      if (previousTabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', previousTabIndex);
      gesture = undefined;
    },
  };
}

function paintTerrainPlate(world: AtlasWorld) {
  const plate = document.createElement('canvas');
  plate.width = world.width * PLATE_SCALE;
  plate.height = world.height * PLATE_SCALE;
  const context = plate.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not prepare the atlas terrain.');

  for (let index = 0; index < world.cells.length; index++) {
    const cell = world.cells[index];
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const east = world.cells[y * world.width + Math.min(world.width - 1, x + 1)]?.elevation ?? cell.elevation;
    const south = world.cells[Math.min(world.height - 1, y + 1) * world.width + x]?.elevation ?? cell.elevation;
    const slopeLight = clamp((cell.elevation - east) * 0.0025 + (cell.elevation - south) * 0.0018, -0.16, 0.16);
    const noise = (hash(index, cell.id) - 0.5) * 0.11;
    const accent = BIOME_ACCENTS[cell.biome];
    const catalogColor = BIOMES[cell.biome].color;
    const elevationTone = cell.biome === 'ocean'
      ? clamp((-cell.elevation - 20) / 2200, 0, 1)
      : clamp(cell.elevation / 2600, 0, 1);
    const base = blend(parseColor(catalogColor), parseColor(elevationTone > 0.55 ? accent.dark : accent.light), 0.54);
    const shadeTarget: Rgb = slopeLight + noise >= 0 ? [255, 244, 210] : [7, 24, 31];
    context.fillStyle = rgbString(blend(base, shadeTarget, Math.abs(slopeLight + noise)));
    context.fillRect(x * PLATE_SCALE, y * PLATE_SCALE, PLATE_SCALE, PLATE_SCALE);
  }

  drawBiomeTexture(context, world);
  drawCoastline(context, world);
  return plate;
}

function drawBiomeTexture(context: CanvasRenderingContext2D, world: AtlasWorld) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (let index = 0; index < world.cells.length; index++) {
    const cell = world.cells[index];
    const x = (index % world.width) * PLATE_SCALE;
    const y = Math.floor(index / world.width) * PLATE_SCALE;
    const density = hash(cell.id, index + 41);
    const px = x + 0.5 + hash(cell.id, 7) * 3;
    const py = y + 0.5 + hash(cell.id, 13) * 3;

    switch (cell.biome) {
      case 'ocean':
        if (density > 0.91) drawWave(context, px, py, 'rgba(107, 193, 210, 0.35)');
        break;
      case 'coast':
        if (density > 0.68) drawWave(context, px, py, 'rgba(202, 237, 218, 0.55)');
        break;
      case 'grassland':
        if (density > 0.82) drawGrass(context, px, py, 'rgba(47, 91, 47, 0.42)');
        break;
      case 'forest':
        if (density > 0.56) drawPine(context, px, py, '#173d2a');
        break;
      case 'rainforest':
        if (density > 0.46) drawCanopy(context, px, py, '#083f31');
        break;
      case 'desert':
        if (density > 0.61) drawDune(context, px, py, 'rgba(116, 72, 29, 0.56)');
        break;
      case 'savanna':
        if (density > 0.76) drawGrass(context, px, py, 'rgba(83, 75, 29, 0.5)');
        break;
      case 'wetland':
        if (density > 0.62) drawReeds(context, px, py, 'rgba(16, 78, 69, 0.55)');
        break;
      case 'tundra':
        if (density > 0.78) drawStone(context, px, py, 'rgba(62, 86, 81, 0.46)');
        break;
      case 'mountain':
        if (density > 0.42) drawCrag(context, px, py, '#3c4141', false);
        break;
      case 'snow':
        if (density > 0.5) drawCrag(context, px, py, '#71828d', true);
        break;
    }
  }
  context.restore();
}

function drawCoastline(context: CanvasRenderingContext2D, world: AtlasWorld) {
  context.save();
  context.beginPath();
  for (let index = 0; index < world.cells.length; index++) {
    const cell = world.cells[index];
    if (isWater(cell.biome)) continue;
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const left = x === 0 ? undefined : world.cells[index - 1];
    const right = x === world.width - 1 ? undefined : world.cells[index + 1];
    const top = y === 0 ? undefined : world.cells[index - world.width];
    const bottom = y === world.height - 1 ? undefined : world.cells[index + world.width];
    const x0 = x * PLATE_SCALE;
    const y0 = y * PLATE_SCALE;
    const x1 = x0 + PLATE_SCALE;
    const y1 = y0 + PLATE_SCALE;
    if (!left || isWater(left.biome)) { context.moveTo(x0, y0); context.lineTo(x0, y1); }
    if (!right || isWater(right.biome)) { context.moveTo(x1, y0); context.lineTo(x1, y1); }
    if (!top || isWater(top.biome)) { context.moveTo(x0, y0); context.lineTo(x1, y0); }
    if (!bottom || isWater(bottom.biome)) { context.moveTo(x0, y1); context.lineTo(x1, y1); }
  }
  context.strokeStyle = 'rgba(35, 48, 39, 0.78)';
  context.lineWidth = 0.85;
  context.stroke();
  context.restore();
}

function drawSelection(
  context: CanvasRenderingContext2D,
  world: AtlasWorld,
  selection: AtlasSelection,
  indexByCellId: ReadonlyMap<number, number>,
  camera: Camera,
  metrics: DrawMetrics,
) {
  if (selection === null) return;
  const bounds = visibleBounds(world, camera, metrics, 1);

  if (selection.kind === 'province') {
    context.save();
    context.fillStyle = 'rgba(241, 181, 73, 0.16)';
    forEachVisible(bounds, world.width, (index, x, y) => {
      if (world.cells[index].provinceId !== selection.provinceId) return;
      const point = worldToScreen(x, y, camera, metrics);
      context.fillRect(point.x, point.y, metrics.pixelsPerCell + 0.5, metrics.pixelsPerCell + 0.5);
    });
    context.restore();
    return;
  }

  const selectedIndex = indexByCellId.get(selection.cellId);
  if (selectedIndex === undefined) return;
  const x = selectedIndex % world.width;
  const y = Math.floor(selectedIndex / world.width);
  const point = worldToScreen(x, y, camera, metrics);
  context.save();
  context.strokeStyle = '#f7e7b4';
  context.lineWidth = Math.max(2 * metrics.ratio, metrics.pixelsPerCell * 0.09);
  context.shadowColor = 'rgba(51, 28, 15, 0.72)';
  context.shadowBlur = 3 * metrics.ratio;
  context.strokeRect(
    point.x + context.lineWidth / 2,
    point.y + context.lineWidth / 2,
    Math.max(1, metrics.pixelsPerCell - context.lineWidth),
    Math.max(1, metrics.pixelsPerCell - context.lineWidth),
  );
  context.restore();
}

function drawProvinceBoundaries(
  context: CanvasRenderingContext2D,
  world: AtlasWorld,
  camera: Camera,
  metrics: DrawMetrics,
  selectedProvince: string | null,
) {
  if (metrics.pixelsPerCell / metrics.ratio < 2) return;
  const bounds = visibleBounds(world, camera, metrics, 1);
  context.save();
  context.beginPath();
  forEachVisible(bounds, world.width, (index, x, y) => {
    const province = world.cells[index].provinceId;
    if (province === null) return;
    const point = worldToScreen(x, y, camera, metrics);
    const size = metrics.pixelsPerCell;
    if (x === 0 || world.cells[index - 1].provinceId !== province) {
      context.moveTo(point.x, point.y); context.lineTo(point.x, point.y + size);
    }
    if (y === 0 || world.cells[index - world.width].provinceId !== province) {
      context.moveTo(point.x, point.y); context.lineTo(point.x + size, point.y);
    }
    if (x === world.width - 1 || world.cells[index + 1].provinceId !== province) {
      context.moveTo(point.x + size, point.y); context.lineTo(point.x + size, point.y + size);
    }
    if (y === world.height - 1 || world.cells[index + world.width].provinceId !== province) {
      context.moveTo(point.x, point.y + size); context.lineTo(point.x + size, point.y + size);
    }
  });
  context.strokeStyle = 'rgba(70, 46, 34, 0.58)';
  context.lineWidth = Math.max(0.75 * metrics.ratio, Math.min(2 * metrics.ratio, metrics.pixelsPerCell * 0.11));
  context.stroke();

  if (selectedProvince !== null) {
    context.beginPath();
    forEachVisible(bounds, world.width, (index, x, y) => {
      if (world.cells[index].provinceId !== selectedProvince) return;
      const point = worldToScreen(x, y, camera, metrics);
      const size = metrics.pixelsPerCell;
      if (x === 0 || world.cells[index - 1].provinceId !== selectedProvince) {
        context.moveTo(point.x, point.y); context.lineTo(point.x, point.y + size);
      }
      if (y === 0 || world.cells[index - world.width].provinceId !== selectedProvince) {
        context.moveTo(point.x, point.y); context.lineTo(point.x + size, point.y);
      }
      if (x === world.width - 1 || world.cells[index + 1].provinceId !== selectedProvince) {
        context.moveTo(point.x + size, point.y); context.lineTo(point.x + size, point.y + size);
      }
      if (y === world.height - 1 || world.cells[index + world.width].provinceId !== selectedProvince) {
        context.moveTo(point.x, point.y + size); context.lineTo(point.x + size, point.y + size);
      }
    });
    context.strokeStyle = '#d88b3f';
    context.lineWidth = 2 * metrics.ratio;
    context.stroke();
  }
  context.restore();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  world: AtlasWorld,
  camera: Camera,
  metrics: DrawMetrics,
) {
  if (metrics.pixelsPerCell / metrics.ratio < 7) return;
  const bounds = visibleBounds(world, camera, metrics, 1);
  context.save();
  context.beginPath();
  for (let x = bounds.minX; x <= bounds.maxX + 1; x++) {
    const top = worldToScreen(x, bounds.minY, camera, metrics);
    const bottom = worldToScreen(x, bounds.maxY + 1, camera, metrics);
    context.moveTo(top.x, top.y); context.lineTo(bottom.x, bottom.y);
  }
  for (let y = bounds.minY; y <= bounds.maxY + 1; y++) {
    const left = worldToScreen(bounds.minX, y, camera, metrics);
    const right = worldToScreen(bounds.maxX + 1, y, camera, metrics);
    context.moveTo(left.x, left.y); context.lineTo(right.x, right.y);
  }
  context.strokeStyle = 'rgba(34, 44, 37, 0.2)';
  context.lineWidth = Math.max(0.5, 0.55 * metrics.ratio);
  context.stroke();
  context.restore();
}

function drawAnnotations(
  context: CanvasRenderingContext2D,
  world: AtlasWorld,
  camera: Camera,
  metrics: DrawMetrics,
) {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const annotation of world.annotations) {
    const point = worldToScreen(annotation.x + 0.5, annotation.y + 0.5, camera, metrics);
    if (point.x < -120 || point.y < -30 || point.x > metrics.width + 120 || point.y > metrics.height + 30) continue;
    const baseSize = annotation.kind === 'land' ? 17 : 15;
    const size = baseSize * metrics.ratio;
    context.font = `${annotation.kind === 'water' ? 'italic ' : ''}${size}px Georgia, serif`;
    context.lineWidth = 2.5 * metrics.ratio;
    context.strokeStyle = annotation.kind === 'water' ? 'rgba(7, 43, 65, 0.58)' : 'rgba(240, 220, 170, 0.75)';
    context.fillStyle = annotation.kind === 'water' ? 'rgba(221, 239, 225, 0.86)' : '#27382c';
    context.strokeText(annotation.text, point.x, point.y);
    context.fillText(annotation.text, point.x, point.y);
  }
  context.restore();
}

function drawResources(
  context: CanvasRenderingContext2D,
  world: AtlasWorld,
  camera: Camera,
  metrics: DrawMetrics,
  filter: Resource | null,
) {
  const bounds = visibleBounds(world, camera, metrics, 2);
  const candidates: number[] = [];
  forEachVisible(bounds, world.width, (index) => {
    const resource = world.cells[index].resource;
    if (resource !== null && (filter === null || resource === filter)) candidates.push(index);
  });

  const iconRadius = resourceMarkerRadius(metrics);
  for (const index of candidates) {
    const cell = world.cells[index];
    if (cell.resource === null) continue;
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const point = worldToScreen(x + 0.5, y + 0.5, camera, metrics);
    drawAtlasResourceIcon(context, cell.resource, point.x, point.y, iconRadius);
  }
  return candidates.length;
}

function resourceMarkerRadius(metrics: DrawMetrics) {
  const cellCssPixels = metrics.pixelsPerCell / metrics.ratio;
  const overviewRadius = clamp(2.7 + cellCssPixels * 0.55, 3.4, 5.2);
  return (cellCssPixels >= 9 ? clamp(cellCssPixels * 0.34, 4.2, 9) : overviewRadius) * metrics.ratio;
}

/** Draws the same authored natural-resource mark used by the atlas overlay. */
export function drawAtlasResourceIcon(
  context: CanvasRenderingContext2D,
  resource: Resource,
  x: number,
  y: number,
  radius: number,
) {
  context.save();
  context.translate(x, y);
  context.fillStyle = RESOURCES[resource].color;
  context.strokeStyle = 'rgba(26, 31, 26, 0.92)';
  context.lineWidth = Math.max(1, radius * 0.16);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.shadowColor = 'rgba(12, 19, 17, 0.38)';
  context.shadowBlur = radius * 0.32;
  context.beginPath();

  switch (resource) {
    case 'fish':
      context.ellipse(-radius * 0.12, 0, radius * 0.52, radius * 0.3, 0, 0, Math.PI * 2);
      context.moveTo(radius * 0.35, 0);
      context.lineTo(radius * 0.8, -radius * 0.38);
      context.lineTo(radius * 0.75, radius * 0.38);
      context.closePath();
      break;
    case 'grain':
      context.moveTo(0, radius * 0.75); context.lineTo(0, -radius * 0.7);
      for (const side of [-1, 1]) {
        for (let step = 0; step < 3; step++) {
          const yy = radius * (0.3 - step * 0.35);
          context.moveTo(0, yy); context.lineTo(side * radius * 0.42, yy - radius * 0.28);
        }
      }
      break;
    case 'timber':
      context.moveTo(0, -radius * 0.82); context.lineTo(-radius * 0.62, radius * 0.24);
      context.lineTo(-radius * 0.2, radius * 0.18); context.lineTo(-radius * 0.55, radius * 0.66);
      context.lineTo(radius * 0.55, radius * 0.66); context.lineTo(radius * 0.2, radius * 0.18);
      context.lineTo(radius * 0.62, radius * 0.24); context.closePath();
      break;
    case 'game':
      context.arc(0, radius * 0.18, radius * 0.27, 0, Math.PI * 2);
      context.moveTo(-radius * 0.16, 0); context.lineTo(-radius * 0.55, -radius * 0.62);
      context.moveTo(-radius * 0.4, -radius * 0.38); context.lineTo(-radius * 0.72, -radius * 0.3);
      context.moveTo(radius * 0.16, 0); context.lineTo(radius * 0.55, -radius * 0.62);
      context.moveTo(radius * 0.4, -radius * 0.38); context.lineTo(radius * 0.72, -radius * 0.3);
      break;
    case 'stone':
      polygon(context, radius, 6, -Math.PI / 2, 0.82);
      break;
    case 'iron':
      context.rect(-radius * 0.62, -radius * 0.35, radius * 1.24, radius * 0.7);
      context.moveTo(-radius * 0.42, -radius * 0.35); context.lineTo(-radius * 0.23, -radius * 0.62);
      context.lineTo(radius * 0.42, -radius * 0.62); context.lineTo(radius * 0.62, -radius * 0.35);
      break;
    case 'copper':
      context.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
      context.moveTo(-radius * 0.25, -radius * 0.72); context.lineTo(radius * 0.25, -radius * 0.72);
      break;
    case 'gold':
      context.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray * Math.PI / 4;
        context.moveTo(Math.cos(angle) * radius * 0.58, Math.sin(angle) * radius * 0.58);
        context.lineTo(Math.cos(angle) * radius * 0.85, Math.sin(angle) * radius * 0.85);
      }
      break;
    case 'salt':
      polygon(context, radius, 4, Math.PI / 4, 0.72);
      context.moveTo(0, -radius * 0.72); context.lineTo(0, radius * 0.72);
      context.moveTo(-radius * 0.72, 0); context.lineTo(radius * 0.72, 0);
      break;
    case 'coal':
      context.moveTo(-radius * 0.7, radius * 0.32); context.lineTo(-radius * 0.5, -radius * 0.46);
      context.lineTo(0, -radius * 0.72); context.lineTo(radius * 0.68, -radius * 0.18);
      context.lineTo(radius * 0.47, radius * 0.62); context.lineTo(-radius * 0.2, radius * 0.72);
      context.closePath();
      break;
    case 'uranium':
      context.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
      for (let lobe = 0; lobe < 3; lobe++) {
        const angle = lobe * Math.PI * 2 / 3 - Math.PI / 2;
        context.moveTo(Math.cos(angle) * radius * 0.3, Math.sin(angle) * radius * 0.3);
        context.arc(Math.cos(angle) * radius * 0.5, Math.sin(angle) * radius * 0.5, radius * 0.3, angle - 1.1, angle + 1.1);
      }
      break;
  }
  context.fill();
  context.stroke();
  if (resource === 'grain' || resource === 'game') {
    context.shadowBlur = 0;
    context.strokeStyle = RESOURCES[resource].color;
    context.lineWidth = Math.max(0.85, radius * 0.1);
    context.stroke();
  }
  context.restore();
}

export function drawWave(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x - 2, y); context.quadraticCurveTo(x - 1, y - 1, x, y);
  context.quadraticCurveTo(x + 1, y + 1, x + 2, y);
  context.strokeStyle = color; context.lineWidth = 0.55; context.stroke();
}

export function drawGrass(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x, y + 1.4); context.lineTo(x, y - 1.2);
  context.moveTo(x, y + 0.5); context.lineTo(x - 1.1, y - 0.3);
  context.moveTo(x, y + 0.2); context.lineTo(x + 1.1, y - 0.7);
  context.strokeStyle = color; context.lineWidth = 0.55; context.stroke();
}

export function drawPine(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x, y - 2.1); context.lineTo(x - 1.7, y + 1.1);
  context.lineTo(x - 0.45, y + 0.8); context.lineTo(x - 1.1, y + 2);
  context.lineTo(x + 1.1, y + 2); context.lineTo(x + 0.45, y + 0.8);
  context.lineTo(x + 1.7, y + 1.1); context.closePath();
  context.fillStyle = color; context.fill();
}

export function drawCanopy(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.arc(x - 0.8, y, 1.25, 0, Math.PI * 2);
  context.arc(x + 0.7, y - 0.35, 1.45, 0, Math.PI * 2);
  context.fillStyle = color; context.fill();
}

export function drawDune(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x - 2, y + 0.8);
  context.quadraticCurveTo(x - 0.5, y - 1.7, x + 1.8, y + 0.5);
  context.strokeStyle = color; context.lineWidth = 0.6; context.stroke();
}

export function drawReeds(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x - 1, y + 1.6); context.lineTo(x - 0.8, y - 1.3);
  context.moveTo(x, y + 1.6); context.lineTo(x, y - 1.8);
  context.moveTo(x + 1, y + 1.6); context.lineTo(x + 0.7, y - 0.9);
  context.strokeStyle = color; context.lineWidth = 0.55; context.stroke();
}

export function drawStone(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.beginPath();
  context.moveTo(x - 1.5, y + 1); context.lineTo(x - 0.6, y - 1.1);
  context.lineTo(x + 1.2, y - 0.6); context.lineTo(x + 1.5, y + 1);
  context.closePath(); context.strokeStyle = color; context.lineWidth = 0.55; context.stroke();
}

export function drawCrag(context: CanvasRenderingContext2D, x: number, y: number, color: string, snow: boolean) {
  context.beginPath();
  context.moveTo(x - 2, y + 1.7); context.lineTo(x, y - 2.1); context.lineTo(x + 2, y + 1.7);
  context.moveTo(x, y - 2.1); context.lineTo(x + 0.15, y + 1.4);
  context.strokeStyle = color; context.lineWidth = 0.65; context.stroke();
  if (snow) {
    context.beginPath();
    context.moveTo(x - 0.8, y - 0.55); context.lineTo(x, y - 2.1); context.lineTo(x + 0.8, y - 0.55);
    context.closePath(); context.fillStyle = '#fbfbf4'; context.fill();
  }
}

function polygon(
  context: CanvasRenderingContext2D,
  radius: number,
  sides: number,
  rotation: number,
  scale: number,
) {
  for (let side = 0; side < sides; side++) {
    const angle = rotation + side * Math.PI * 2 / sides;
    const x = Math.cos(angle) * radius * scale;
    const y = Math.sin(angle) * radius * scale;
    if (side === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function visibleBounds(world: AtlasWorld, camera: Camera, metrics: DrawMetrics, margin: number) {
  const halfWidth = metrics.width / (2 * metrics.pixelsPerCell);
  const halfHeight = metrics.height / (2 * metrics.pixelsPerCell);
  return {
    minX: Math.max(0, Math.floor(camera.x - halfWidth) - margin),
    maxX: Math.min(world.width - 1, Math.ceil(camera.x + halfWidth) + margin),
    minY: Math.max(0, Math.floor(camera.y - halfHeight) - margin),
    maxY: Math.min(world.height - 1, Math.ceil(camera.y + halfHeight) + margin),
  };
}

function forEachVisible(
  bounds: ReturnType<typeof visibleBounds>,
  worldWidth: number,
  visit: (index: number, x: number, y: number) => void,
) {
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) visit(y * worldWidth + x, x, y);
  }
}

function worldToScreen(x: number, y: number, camera: Camera, metrics: DrawMetrics) {
  return {
    x: (x - camera.x) * metrics.pixelsPerCell + metrics.width / 2,
    y: (y - camera.y) * metrics.pixelsPerCell + metrics.height / 2,
  };
}

function keyDirection(key: string) {
  if (key === 'ArrowLeft') return { x: -1, y: 0 };
  if (key === 'ArrowRight') return { x: 1, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -1 };
  if (key === 'ArrowDown') return { x: 0, y: 1 };
  return undefined;
}

function isWater(biome: Biome) {
  return biome === 'ocean' || biome === 'coast';
}

function parseColor(color: string): Rgb {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      Number.parseInt(hex[0] + hex[0], 16),
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [100, 110, 90];
}

function blend(first: Rgb, second: Rgb, amount: number): Rgb {
  return [
    first[0] + (second[0] - first[0]) * amount,
    first[1] + (second[1] - first[1]) * amount,
    first[2] + (second[2] - first[2]) * amount,
  ];
}

function rgbString(color: Rgb) {
  return `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;
}

function hash(first: number, second: number) {
  let value = Math.imul(first + 91, 374761393) ^ Math.imul(second + 17, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
