import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  DEFAULT_WORLD_SETTINGS, WORLD_BIOMES, inspectWorldCell, type InspectedWorldCell, type WorldManifest, type WorldSettings,
} from '../../shared/generated-world.ts';
import { createWorldTileClient, loadGeneratedWorld } from '../api/generated-world.ts';
import {
  MOISTURE_GRADIENT, TEMPERATURE_GRADIENT, WORLD_BIOME_STYLE, createGeneratedWorldRenderer, type WorldCoordinate, type WorldLayer,
} from '../renderer/generated-world.ts';
import { RESOURCES } from '../world/atlas.ts';
import { RESOURCE_RULES } from '../world/resources.ts';
import { ResourceIcon } from './ResourceIcon.tsx';
import './generated-world.css';

const number = new Intl.NumberFormat('en');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The world could not be displayed. Try again.';

export function GeneratedWorldLab() {
  const [world, setWorld] = useState<WorldManifest | null>(null);
  const [seed, setSeed] = useState(DEFAULT_WORLD_SETTINGS.seed);
  const [size, setSize] = useState<WorldSettings['size']>(DEFAULT_WORLD_SETTINGS.size);
  const [request, setRequest] = useState({ settings: DEFAULT_WORLD_SETTINGS, revision: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [layer, setLayer] = useState<WorldLayer>('biomes');
  const [resources, setResources] = useState(true);
  const [rivers, setRivers] = useState(true);
  const [view, setView] = useState({ zoom: 1, detail: false });
  const [cell, setCell] = useState<InspectedWorldCell | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createGeneratedWorldRenderer> | null>(null);
  const client = useRef<ReturnType<typeof createWorldTileClient> | null>(null);
  const visible = useRef<WorldCoordinate[]>([]);
  const selected = useRef<WorldCoordinate | null>(null);
  const retryDetail = useRef<() => void>(() => {});
  const clearSelection = useRef<() => void>(() => {});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void loadGeneratedWorld(request.settings, controller.signal).then(manifest => {
      if (controller.signal.aborted) return;
      setWorld(manifest); setLoading(false);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setLoadError(message(cause)); setLoading(false);
    });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!world || !canvas.current) return;
    let alive = true;
    let selectionRevision = 0;
    const tileClient = createWorldTileClient(world);
    client.current = tileClient;
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
    clearSelection.current = () => renderer.current?.clearSelection();
    try {
      renderer.current = createGeneratedWorldRenderer(canvas.current, world, {
        onSelect: inspect,
        onView: next => {
          if (!alive) return;
          setView({ zoom: next.zoom, detail: next.detail }); visible.current = next.tiles;
          tileClient.setVisibleTiles(next.tiles); requestVisible();
        },
        onError: cause => { if (alive) setCanvasError(message(cause)); },
      });
    } catch (cause) { setCanvasError(message(cause)); }
    return () => {
      alive = false; selectionRevision++; tileClient.destroy(); client.current = null;
      renderer.current?.destroy(); renderer.current = null;
    };
  }, [world, canvasRevision]);

  useEffect(() => { renderer.current?.setLayer(layer, resources, rivers); }, [layer, resources, rivers, world, canvasRevision]);

  function generate(event?: FormEvent) {
    event?.preventDefault();
    setRequest(current => ({ settings: { seed, size }, revision: current.revision + 1 }));
  }
  const status = loading ? (world ? 'Generating replacement world…' : 'Generating your world…')
    : loadError ? (world ? 'Previous world retained · Generation failed' : 'World unavailable')
    : canvasError ? 'World canvas unavailable' : 'World ready to explore';
  const landPercent = world ? world.landCells / (world.width * world.height) * 100 : 0;
  const largestRunoff = useMemo(() => world ? world.hydrology.lakes.reduce((largest, lake) => Math.max(largest, lake.outlet?.runoff ?? 0),
    world.hydrology.rivers.runoff.reduce((largest, runoff) => Math.max(largest, runoff), 1)) : 1, [world]);
  const riverPercent = cell ? cell.water.runoff / largestRunoff * 100 : 0;
  const freshwater = cell ? ({ none: 'No mapped freshwater', river: 'Freshwater river', lake: 'Freshwater lake', lakeshore: 'Freshwater lakeshore' } as const)[cell.water.freshwater] : '';
  const climateDescription = cell ? `${cell.water.kind === 'lake' ? 'This lake cell' : cell.water.kind === 'ocean' ? 'This ocean cell' : cell.elevation >= 1500 ? 'This upland cell' : 'This lowland cell'} has ${cell.temperature < 0 ? 'a below-freezing annual mean' : cell.temperature < 10 ? 'cool annual temperatures' : cell.temperature < 20 ? 'mild annual temperatures' : 'warm annual temperatures'} and ${cell.moisture < 0.3 ? 'dry annual conditions' : cell.moisture > 0.7 ? 'plentiful annual moisture' : 'moderate annual moisture'}. ${cell.biome === 'lakeIce' ? 'The cold supports lake ice.' : cell.water.kind === 'lake' ? 'Lake depth is measured from the water surface to the bed.' : cell.biome === 'seaIce' ? 'The cold supports sea ice.' : cell.water.kind === 'ocean' ? 'Water depth distinguishes shallow sea from deep ocean.' : 'Its temperature, moisture, and elevation together determine the biome.'}` : '';

  return <div className="regional-atlas generated-world-lab">
    <header className="atlas-header">
      <a className="atlas-brand" href="/" aria-label="Chronicle home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" /><path d="M16 2v28M2 16h28M10 22l4-8 8-4-4 8Z" /></svg>Chronicle</a>
      <span className="atlas-header-study">The living world <span aria-hidden="true">/</span> Geography 01</span>
      <a className="atlas-archive-link" href="?scenario=verdant">Regional atlas study <span aria-hidden="true">↗</span></a>
    </header>
    <main>
      <div className="atlas-intro">
        <div><p className="atlas-eyebrow">Seeded geography &amp; annual climate</p><h1>A world taking shape</h1><p className="atlas-description">From frozen poles to tropical forests. Explore the land, waterways, climate, and natural potential of a fictional planet.</p></div>
        <dl className="atlas-overview" aria-label="World totals">
          <div><dt>Planet area</dt><dd>510<span className="atlas-unit"> million km²</span></dd></div>
          <div><dt>Resolution</dt><dd id="world-resolution">{world ? `${number.format(world.width)} × ${number.format(world.height)}` : '—'}</dd></div>
          <div><dt>Land cover</dt><dd>{world ? landPercent.toFixed(1) : '—'}<span className="atlas-unit">%</span></dd></div>
        </dl>
      </div>
      <div className="atlas-workspace">
        <aside className="atlas-sidebar" aria-label="World controls and legend">
          <section className="atlas-panel-section world-generation-controls">
            <p className="atlas-section-index">01 / World</p><h2>Explore a seed</h2>
            <form onSubmit={generate}>
              <label htmlFor="world-seed">World seed</label>
              <input id="world-seed" value={seed} onChange={event => setSeed(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9 _.\-]+" title="1–64 letters, numbers, spaces, dots, underscores or hyphens" autoComplete="off" />
              <label htmlFor="world-size">Resolution</label>
              <select id="world-size" value={size} onChange={event => setSize(event.target.value as WorldSettings['size'])}>
                <option value="large">Large · 1,024 × 512</option><option value="standard">Standard · 512 × 256</option>
              </select>
              <button className="world-generate-button" type="submit">Regenerate world <span aria-hidden="true">↻</span></button>
            </form>
            <p className="atlas-panel-note">The same seed and resolution reproduce this geography. Both resolutions cover the same planet area.</p>
          </section>
          <section className="atlas-panel-section">
            <p className="atlas-section-index">02 / View</p><h2>Map layers</h2>
            <fieldset className="world-layer-options"><legend className="world-sr-only">Map layer</legend>
              {(['biomes', 'temperature', 'moisture'] as const).map(value => <label key={value} className={layer === value ? 'world-layer-selected' : ''}><input type="radio" name="world-layer" value={value} checked={layer === value} onChange={() => setLayer(value)} /><span>{value === 'biomes' ? 'Biomes' : value === 'temperature' ? 'Temperature' : 'Moisture'}</span></label>)}
            </fieldset>
            <label className="world-resource-toggle"><input type="checkbox" checked={rivers} onChange={event => setRivers(event.target.checked)} /> Rivers</label>
            <p className="atlas-panel-note world-river-note">Rivers appear on the biome atlas. Wider channels carry more accumulated runoff.</p>
            <label className="world-resource-toggle"><input type="checkbox" checked={resources} onChange={event => setResources(event.target.checked)} /> Resource sites</label>
            <p className="atlas-panel-note">Site markers appear at detail zoom. Every selected cell uses its full-resolution data.</p>
          </section>
          <section className="atlas-panel-section world-legend" aria-label="Map legend">
            {layer === 'biomes' ? <><div className="atlas-section-heading"><h2>Biomes</h2><span>% of planet</span></div><ul className="atlas-biome-legend">{WORLD_BIOMES.map((biome, index) => <li key={biome}><span className="atlas-biome-name"><span className="atlas-biome-swatch" style={{ backgroundColor: WORLD_BIOME_STYLE[biome].color }} aria-hidden="true" />{WORLD_BIOME_STYLE[biome].label}</span><span>{world ? (world.biomeCounts[index] / (world.width * world.height) * 100).toFixed(1) : '—'}</span></li>)}</ul></>
              : <><h2>{layer === 'temperature' ? 'Annual mean temperature' : 'Annual moisture index'}</h2><div className="world-climate-gradient" style={{ background: layer === 'temperature' ? TEMPERATURE_GRADIENT : MOISTURE_GRADIENT }} /><div className="world-climate-scale"><span>{layer === 'temperature' ? '−40 °C' : '0 · Dry'}</span><span>{layer === 'temperature' ? '0' : '50'}</span><span>{layer === 'temperature' ? '40 °C' : '100 · Wet'}</span></div><p className="atlas-panel-note">{layer === 'temperature' ? 'Latitude, elevation, and regional variation shape the annual temperature. Higher ground is colder.' : 'A relative measure of annual moisture availability shaped by circulation, ocean winds, and mountains. This index is not rainfall in millimetres.'}</p></>}
          </section>
        </aside>
        <section className="atlas-map-stage" aria-label="Generated world map" aria-busy={loading}>
          <div className="atlas-map-card">
            <div className="atlas-map-toolbar"><span className="atlas-map-mode"><span aria-hidden="true" />{layer === 'biomes' ? 'Biome atlas' : layer === 'temperature' ? 'Temperature atlas' : 'Moisture atlas'}</span><div className="atlas-zoom-controls" role="group" aria-label="Map view">
              <button type="button" aria-label="Zoom out" disabled={!world || !!canvasError} onClick={() => renderer.current?.zoomBy(1 / 1.6)}>−</button>
              <span className="atlas-zoom-value">{Math.round(view.zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" disabled={!world || !!canvasError} onClick={() => renderer.current?.zoomBy(1.6)}>+</button>
              <button type="button" className="atlas-fit-button" disabled={!world || !!canvasError} onClick={() => renderer.current?.fit()}>Fit map</button>
            </div></div>
            {world ? <div className="atlas-canvas-frame"><canvas ref={canvas} id="generated-world-canvas" tabIndex={0} role="img" aria-label="Generated planet: biomes, rivers, lakes, temperature, moisture and natural resource sites. Click to inspect a cell." aria-describedby="world-map-help">This world preview requires Canvas 2D support.</canvas><span className="atlas-north-mark" aria-hidden="true"><span>N</span>↑</span></div>
              : <div className="atlas-loading-map"><span className="atlas-loading-compass" aria-hidden="true">✦</span><p>{loadError ? 'The world is unavailable.' : 'A new geography is forming…'}</p><span>{loadError ? 'Use Retry generation to try again.' : 'Preparing continents, climate, and resource sites on the local host.'}</span></div>}
            <p id="world-map-help" className="atlas-map-help">Click to inspect · Drag to explore · Scroll to zoom. Keyboard: arrows inspect, Enter selects, Shift + arrows pan, + / − zoom, Home fits, Escape clears.</p>
          </div>
          <div className="atlas-map-caption"><span>Equal-area atlas <span aria-hidden="true">·</span> East–west wrapping</span><span>{view.detail ? 'Full-resolution detail' : layer === 'biomes' ? 'Terrain overview' : 'Sampled climate overview'}</span></div>
          <div className="atlas-status-row"><p id="world-status" role="status" aria-live="polite">{status}</p>{loadError && <button className="atlas-reset-button" type="button" onClick={() => setRequest(current => ({ ...current, revision: current.revision + 1 }))}>Retry generation</button>}</div>
          {loadError && <p className="atlas-error" role="alert">{loadError}</p>}
          {tileError && <div className="world-inline-error"><p className="atlas-error" role="alert">{tileError}</p><button className="atlas-reset-button" type="button" onClick={() => retryDetail.current()}>Retry detail</button></div>}
          {canvasError && <div className="world-inline-error"><p className="atlas-error" role="alert">{canvasError}</p><button className="atlas-reset-button" type="button" onClick={() => setCanvasRevision(current => current + 1)}>Retry canvas</button></div>}
          <div className="world-climate-note"><span aria-hidden="true">◌</span><p>A geographic preview, before history begins. Rivers connect their catchments to lakes and seas, while weak outflows may end in dry basins. Inland water may have an outlet or lie in a closed basin. Seasons and living societies are still to come.</p></div>
        </section>
        <aside className="atlas-inspector" aria-labelledby="world-inspector-title">
          <p className="atlas-section-index">03 / Inspect</p><div className="atlas-section-heading"><h2 id="world-inspector-title">{cell || inspecting ? 'Cell detail' : 'Read the landscape'}</h2>{(cell || inspecting) && <button className="atlas-clear-selection" type="button" aria-label="Clear selection" onClick={() => clearSelection.current()}>×</button>}</div>
          {cell && world ? <div className="world-selected-cell" data-selected-cell={cell.id} aria-live="polite">
            <div className="atlas-cell-biome" style={{ borderColor: WORLD_BIOME_STYLE[cell.biome].color }}><p>Cell {number.format(cell.id)}</p><h3>{WORLD_BIOME_STYLE[cell.biome].label}</h3></div>
            <dl className="atlas-cell-facts world-cell-facts">
              <div><dt>Latitude</dt><dd>{Math.abs(Math.asin(1 - 2 * (cell.y + 0.5) / world.height) * 180 / Math.PI).toFixed(1)}° {cell.y < world.height / 2 ? 'N' : 'S'}</dd></div>
              <div><dt>{cell.water.kind === 'lake' ? 'Bed elevation' : 'Elevation'}</dt><dd>{number.format(cell.elevation)} m</dd></div>
              <div><dt>Annual temperature</dt><dd id="cell-temperature">{cell.temperature.toFixed(1)} °C</dd></div>
              <div><dt>Moisture index</dt><dd id="cell-moisture">{Math.round(cell.moisture * 100)} / 100</dd></div>
              <div><dt>Cell area</dt><dd>{number.format(Math.round(world.areaKm2 / (world.width * world.height)))} km²</dd></div>
              <div><dt>Grid position</dt><dd>{cell.x}, {cell.y}</dd></div>
            </dl>
            <p className="atlas-panel-note world-cell-explanation">{climateDescription}</p>
            <section className="world-cell-water" aria-label="Selected cell water">
              <p className="atlas-detail-label">Water &amp; freshwater</p>
              <h3>{({ dry: 'Dry land', ocean: 'Ocean', river: 'River', lake: 'Lake' } as const)[cell.water.kind]}</h3>
              <p className="world-freshwater-value">{freshwater}</p>
              {cell.water.kind === 'river' && <><dl className="world-water-facts">
                <div><dt>Relative river size</dt><dd>{riverPercent < 1 ? '<1' : Math.round(riverPercent)}% of largest</dd></div>
                <div><dt>Runoff index</dt><dd>{number.format(cell.water.runoff)}</dd></div>
              </dl><p className="atlas-panel-note">Compared with this world’s largest mapped channel. Annual runoff accumulates from the upstream catchment; the index is not a measured discharge.</p></>}
              {cell.water.kind === 'lake' && cell.water.lake && <><dl className="world-water-facts">
                <div><dt>Lake area</dt><dd>{number.format(Math.round(cell.water.lake.areaKm2))} km²</dd></div>
                <div><dt>Lake level</dt><dd>{number.format(cell.water.lake.level)} m</dd></div>
                <div><dt>Water depth</dt><dd>{number.format(cell.water.lake.depth)} m</dd></div>
                <div><dt>Drainage</dt><dd>{cell.water.lake.closed ? 'Closed basin' : 'One mapped outlet'}</dd></div>
              </dl><p className="atlas-panel-note">{cell.water.lake.closed ? 'Salinity is not modeled. This enclosed lake is not marked as a freshwater source.' : 'This lake drains through a mapped outlet and supplies freshwater along its shore.'}</p></>}
              {cell.water.freshwater === 'lakeshore' && <p className="atlas-panel-note">This cell borders a lake with a mapped outlet.</p>}
            </section>
            <section className="atlas-cell-resource" aria-label="Selected cell resource">{cell.resource ? <><p className="atlas-detail-label">Resource site</p><p className="atlas-resource-value"><span><ResourceIcon resource={cell.resource} /></span>{RESOURCES[cell.resource].label}</p><dl className="atlas-resource-facts"><div><dt>Site type</dt><dd>{RESOURCE_RULES[cell.resource].kind === 'renewable' ? 'Renewable' : 'Mineral'}</dd></div><div><dt>Required extraction technology</dt><dd>{RESOURCE_RULES[cell.resource].extractionTechnology}</dd></div></dl><p className="atlas-panel-note">Natural potential. Extraction and production are not active.</p></> : <><p className="atlas-detail-label">Natural potential</p><p className="atlas-resource-empty">No resource site in this cell</p><p className="atlas-panel-note">Sites are scattered across suitable terrain. Most cells have no special site.</p></>}</section>
          </div> : inspecting ? <p className="atlas-panel-note" role="status">Reading full-resolution cell data…</p> : <div className="atlas-inspector-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 10h44v44H10zM10 25h44M10 39h44M25 10v44M39 10v44" /><path className="atlas-inspector-cell" d="M25 25h14v14H25z" /></svg><h3>A closer look</h3><p>Select any cell to inspect its biome, annual climate, water access, and resource potential.</p><span>Zoom in to explore terrain textures and individual resource markers.</span></div>}
          <div className="world-identity"><p className="atlas-detail-label">Current world</p><strong id="world-current-seed">{world?.settings.seed ?? 'Preparing…'}</strong><p>{world ? `${number.format(world.resourceSites)} scattered resource sites` : 'Geography is being generated'}</p><span>{world ? `Generator ${world.generatorVersion} · ${number.format(world.width * world.height)} cells` : 'Annual climate preview'}</span></div>
          <p className="atlas-panel-note world-projection-note">Equal-area cells; polar shapes are stretched. Map distances are not uniform ground distances. This geography has no political provinces.</p>
        </aside>
      </div>
    </main>
    <footer className="atlas-footer"><span>Chronicle / World studies</span><span>Seeded geography · Annual climate · Natural potential</span></footer>
  </div>;
}
