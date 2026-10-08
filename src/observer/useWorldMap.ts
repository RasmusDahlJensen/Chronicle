import { useEffect, useRef, useState } from 'react';
import { inspectWorldCell, type InspectedWorldCell, type WorldManifest } from '../../shared/generated-world.ts';
import type { ObserverFrame, RegionMap } from '../../shared/simulation.ts';
import { createWorldTileClient } from '../api/generated-world.ts';
import { fetchRegionMap } from '../api/simulation.ts';
import { createGeneratedWorldRenderer, type WorldCoordinate, type WorldLayer } from '../renderer/generated-world.ts';
import { cultureColor, ERA_COLORS, eraColor, faithColor, FOLK_COLOR, lineageColor, packColor, polityColor, SETTLEMENT_COLOR, SETTLEMENT_STROKE, TERRITORY_ALPHA } from './palettes.ts';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The world could not be displayed. Try again.';

/** How the peoples' territories are coloured: by polity, by descent (starting band), culture, faith or era, or not at all. */
export type PeoplesLens = 'polity' | 'descent' | 'culture' | 'faith' | 'era' | 'off';
/** The simulation's region partition for a world: the region map, cell → region id + 1, and cell → farmland rank. */
export interface RegionData { map: RegionMap; cells: Uint16Array; fieldRank: Uint16Array }

/** The simulation's region partition for the displayed world (a separate versioned contract from geography). */
export function useRegionMap(world: WorldManifest | null) {
  const [regions, setRegions] = useState<RegionData | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  useEffect(() => {
    if (!world) return;
    const controller = new AbortController();
    setRegions(null); setRegionError(null);
    void fetchRegionMap(world.settings, controller.signal).then(next => {
      if (!controller.signal.aborted && next.map.worldKey === world.worldKey) setRegions(next);
    }).catch(cause => { if (!controller.signal.aborted) setRegionError(message(cause)); });
    return () => controller.abort();
  }, [world]);
  return { regions, regionError };
}

export interface WorldMapOptions {
  world: WorldManifest | null;
  /** The geography under everything: biomes, temperature, moisture or fertility; resource sites and rivers on it. */
  layer: WorldLayer; resources: boolean; rivers: boolean;
  regions: RegionData | null; showRegions: boolean;
  /** The newest observer frame: peoples, settlements, roads, trade routes and fields drawn from it. */
  frame: ObserverFrame | null;
  peoples: PeoplesLens; showTrade: boolean; showFields: boolean; showRoads?: boolean;
  /** The colour around the world (the renderer's default unless given). */
  background?: string;
}

/**
 * The world map, shared by the game and the lab (U.1): the canvas renderer with its detail tiles and cell selection,
 * and the simulation's marks drawn on its overlay from each frame (polity markers, territories, settlements, roads,
 * trade routes and cultivated land). Attach `canvas` and `overlay` to the page's canvases.
 */
export function useWorldMap({ world, layer, resources, rivers, regions, showRegions, frame, peoples, showTrade, showFields, showRoads = true, background }: WorldMapOptions) {
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [tileError, setTileError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: 1, detail: false });
  const [cell, setCell] = useState<InspectedWorldCell | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createGeneratedWorldRenderer> | null>(null);
  const visible = useRef<WorldCoordinate[]>([]);
  const selected = useRef<WorldCoordinate | null>(null);
  const retryDetail = useRef<() => void>(() => {});

  useEffect(() => {
    if (!world || !canvas.current) return;
    let alive = true;
    let selectionRevision = 0;
    const tileClient = createWorldTileClient(world);
    selected.current = null; visible.current = [];
    setCell(null); setInspecting(false); setTileError(null); setCanvasError(null);
    function updateTiles() {
      if (alive) renderer.current?.setTiles(tileClient.tiles);
    }
    function detailFailure(cause: unknown) { if (alive) setTileError(message(cause)); }
    function requestVisible() {
      for (const coordinate of visible.current) void tileClient.request(coordinate.x, coordinate.y).then(updateTiles).catch(detailFailure);
    }
    function inspect(coordinate: WorldCoordinate | null) {
      const revision = ++selectionRevision;
      selected.current = coordinate; setCell(null); setInspecting(coordinate !== null);
      if (!coordinate) return;
      void tileClient.request(Math.floor(coordinate.x / 128), Math.floor(coordinate.y / 128)).then(tile => {
        if (!alive || revision !== selectionRevision) return;
        setCell(inspectWorldCell(world!, tile, coordinate.x, coordinate.y)); setInspecting(false); updateTiles();
      }).catch(cause => { if (alive && revision === selectionRevision) { setInspecting(false); detailFailure(cause); } });
    }
    retryDetail.current = () => {
      tileClient.retryFailures(); setTileError(null); requestVisible();
      if (selected.current) inspect(selected.current);
    };
    try {
      renderer.current = createGeneratedWorldRenderer(canvas.current, world, {
        onSelect: inspect,
        onView: next => {
          if (!alive) return;
          setView({ zoom: next.zoom, detail: next.detail }); visible.current = next.tiles;
          tileClient.setVisibleTiles(next.tiles); requestVisible();
        },
        onError: cause => { if (alive) setCanvasError(message(cause)); },
        background,
      }, overlay.current ?? undefined);
    } catch (cause) { setCanvasError(message(cause)); }
    return () => {
      alive = false; selectionRevision++; tileClient.destroy();
      renderer.current?.destroy(); renderer.current = null;
    };
  }, [world, canvasRevision, background]);

  useEffect(() => { renderer.current?.setLayer(layer, resources, rivers); }, [layer, resources, rivers, world, canvasRevision]);
  useEffect(() => { renderer.current?.setRegions(regions?.cells ?? null, showRegions); }, [regions, showRegions, world, canvasRevision]);

  // Polity markers sit at their region's centre cell, coloured by era; villages on their own cells.
  useEffect(() => {
    if (!renderer.current) return;
    if (!frame || !regions || !world || frame.instance.worldKey !== world.worldKey) { renderer.current.setBands([]); renderer.current.setSettlements([], { fill: SETTLEMENT_COLOR, stroke: SETTLEMENT_STROKE }); renderer.current.setRoads([]); renderer.current.setTrades([]); return; }
    const { regions: at, populations, kinds, eras } = frame.markers;
    renderer.current.setBands(at.map((region, index) => {
      const centroid = regions.map.regions[region]?.centroid ?? 0;
      return { x: centroid % world.width, y: Math.floor(centroid / world.width), population: populations[index], color: ERA_COLORS[eras[index]] ?? ERA_COLORS[0], settled: kinds[index] === 1 };
    }));
    renderer.current.setSettlements(frame.settlements.cells.map((cell, index) => ({
      x: cell % world.width, y: Math.floor(cell / world.width), capital: frame.settlements.capitals[index] === 1, tier: frame.settlements.tiers[index], name: frame.settlements.names[index],
      features: frame.settlements.features[index],
    })),
      { fill: SETTLEMENT_COLOR, stroke: SETTLEMENT_STROKE });
    // Roads join the regions' main places: a capital, else the largest settlement, else the region's centre.
    const anchor = new Map<number, { cell: number; rank: number }>();
    frame.settlements.cells.forEach((cell, index) => {
      const region = regions.cells[cell] - 1, rank = frame.settlements.capitals[index] * 10 + frame.settlements.tiers[index], held = anchor.get(region);
      if (region >= 0 && (!held || rank > held.rank)) anchor.set(region, { cell, rank });
    });
    const place = (region: number) => anchor.get(region)?.cell ?? regions.map.regions[region]?.centroid ?? 0;
    renderer.current.setRoads(showRoads ? frame.roads.a.map((a, index) => {
      const from = place(a), to = place(frame.roads.b[index]);
      return { x1: from % world.width, y1: Math.floor(from / world.width), x2: to % world.width, y2: Math.floor(to / world.width), tier: frame.roads.tiers[index], bridge: frame.roads.bridges[index] === 1, condition: frame.roads.conditions[index] / 100 };
    }) : []);
    // Trade routes (M5.4) between the two hubs of each active agreement.
    renderer.current.setTrades(showTrade ? frame.trades.from.map((from, index) => {
      const to = frame.trades.to[index];
      return { x1: from % world.width, y1: Math.floor(from / world.width), x2: to % world.width, y2: Math.floor(to / world.width), sea: frame.trades.sea[index] === 1 };
    }) : []);
  }, [frame, regions, world, canvasRevision, showTrade, showRoads]);

  // Cultivated land: a region's farmland cells ranked below its cultivated count (VISION.md "Cultivated land").
  const fieldKey = frame && showFields ? `${frame.fields.regions.join(',')}:${frame.fields.cells.join(',')}` : '';
  useEffect(() => {
    if (!renderer.current) return;
    if (!showFields || !frame || !regions || !world || frame.instance.worldKey !== world.worldKey) { renderer.current.setFields(null); return; }
    const counts = new Uint16Array(regions.map.regions.length);
    frame.fields.regions.forEach((region, index) => { counts[region] = frame.fields.cells[index]; });
    const cells = new Uint8Array(regions.cells.length);
    for (let cell = 0; cell < cells.length; cell++) { const region = regions.cells[cell]; if (region && regions.fieldRank[cell] < counts[region - 1]) cells[cell] = 1; }
    renderer.current.setFields(cells);
    // Recomputed only when the cultivated counts change (`fieldKey` follows them), not with every frame.
  }, [fieldKey, regions, world, showFields, canvasRevision]);

  // Each occupied region filled with its people's colour; bands lighter than settled civilizations.
  useEffect(() => {
    if (!renderer.current) return;
    if (peoples === 'off' || !frame || !regions || !world || frame.instance.worldKey !== world.worldKey) { renderer.current.setTerritories(null); return; }
    const fill = new Uint32Array(regions.map.regions.length);
    const { ids, regions: at, kinds, eras, lineages, cultures, faiths } = frame.markers;
    const hues = new Map(frame.cultures.map(entry => [entry.id, entry.hue])), faithHues = new Map(frame.religions.map(entry => [entry.id, entry.hue]));
    for (let index = 0; index < at.length; index++) {
      const color = peoples === 'era' ? eraColor(eras[index]) : peoples === 'descent' ? lineageColor(lineages[index])
        : peoples === 'culture' ? cultureColor(hues.get(cultures[index]) ?? 0, cultures[index])
        : peoples === 'faith' ? (faiths[index] < 0 ? FOLK_COLOR : faithColor(faithHues.get(faiths[index]) ?? 0)) : polityColor(ids[index]);
      if (at[index] < fill.length) fill[at[index]] = packColor(color, kinds[index] === 1 ? TERRITORY_ALPHA.civ : TERRITORY_ALPHA.band);
    }
    renderer.current.setTerritories(fill);
  }, [frame, regions, world, peoples, canvasRevision]);

  /** The simulation region of the selected cell (null when none is selected or the region map is not in yet). */
  const cellRegion = cell && regions ? regions.map.regions[regions.cells[cell.id] - 1] ?? null : null;
  return {
    canvas, overlay, view, cell, cellRegion, inspecting, tileError, canvasError,
    zoomBy: (factor: number) => renderer.current?.zoomBy(factor), fit: () => renderer.current?.fit(),
    clearSelection: () => renderer.current?.clearSelection(), retryDetail: () => retryDetail.current(), retryCanvas: () => setCanvasRevision(current => current + 1),
    /** Centre the map on a cell (by index) and select it. */
    focusCell: (target: number) => { if (world) renderer.current?.focusCell({ x: target % world.width, y: Math.floor(target / world.width) }); },
  };
}
