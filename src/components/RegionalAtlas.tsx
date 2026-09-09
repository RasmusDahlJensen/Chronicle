import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AtlasWorld, Biome, Resource } from '../../shared/atlas.ts';
import { loadAtlas } from '../api/atlas.ts';
import { BIOMES, RESOURCES, summarizeAtlas } from '../world/atlas.ts';
import { RESOURCE_RULES } from '../world/resources.ts';
import { parentAtlasSelection, type AtlasSelection } from '../renderer/atlas-selection.ts';
import { AtlasCanvas, type AtlasLayers } from './AtlasCanvas.tsx';
import { ResourceIcon } from './ResourceIcon.tsx';

const number = new Intl.NumberFormat('en');
const biomeEntries = Object.entries(BIOMES) as [Biome, (typeof BIOMES)[Biome]][];
const resourceEntries = Object.entries(RESOURCES) as [Resource, (typeof RESOURCES)[Resource]][];

interface AtlasState {
  world: AtlasWorld | null;
  resets: number;
  error: string | null;
  loading: boolean;
  renderFailed: boolean;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'The atlas could not be displayed.';
}

export function RegionalAtlas() {
  const [{ world, resets, error, loading, renderFailed }, setAtlas] = useState<AtlasState>({
    world: null, resets: 0, error: null, loading: true, renderFailed: false,
  });
  const [request, setRequest] = useState(0);
  const [renderedWorld, setRenderedWorld] = useState<AtlasWorld | null>(null);
  const [selection, setSelection] = useState<AtlasSelection>(null);
  const [layers, setLayers] = useState<AtlasLayers>({ resources: true, provinces: false, grid: false, resourceFilter: null });
  const summary = useMemo(() => world ? summarizeAtlas(world) : null, [world]);
  const cell = selection?.kind === 'cell' ? world?.cells[selection.cellId] ?? null : null;
  const provinceId = selection?.kind === 'province' ? selection.provinceId : cell?.provinceId ?? null;
  const province = provinceId ? world?.provinces.find(candidate => candidate.id === provinceId) : null;
  const provinceSummary = province ? summary?.provinces.get(province.id) ?? null : null;
  const country = province?.countryId ? world?.countries.find(candidate => candidate.id === province.countryId) : null;
  const onError = useCallback((cause: unknown) => {
    setAtlas(current => ({ ...current, error: errorMessage(cause), loading: false, renderFailed: true }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAtlas(controller.signal).then(nextWorld => {
      if (controller.signal.aborted) return;
      setSelection(null);
      setAtlas(current => ({
        world: nextWorld, resets: current.world ? current.resets + 1 : 0,
        error: null, loading: false, renderFailed: false,
      }));
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setAtlas(current => ({ ...current, loading: false, error: errorMessage(cause) }));
    });
    return () => controller.abort();
  }, [request]);

  const rendering = world !== null && renderedWorld !== world && !renderFailed;
  const busy = loading || rendering;
  const status = loading ? (world ? 'Reloading the regional atlas…' : 'Loading the regional atlas…')
    : error ? (world && !renderFailed ? 'Reload failed · Previous atlas retained' : 'Atlas unavailable')
    : rendering ? 'Drawing the atlas…'
    : resets ? `Original atlas restored · ${resets}` : 'Atlas ready to explore';

  function resetAtlas() {
    if (busy || renderFailed) return;
    setAtlas(current => ({ ...current, loading: true, error: null }));
    setRequest(current => current + 1);
  }

  return (
    <div className="regional-atlas">
      <header className="atlas-header">
        <a className="atlas-brand" href="/" aria-label="Chronicle home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" /><path d="M16 2v28M2 16h28M10 22l4-8 8-4-4 8Z" /></svg>Chronicle</a>
        <span className="atlas-header-study">The regional atlas <span aria-hidden="true">/</span> Study 02</span>
        <a className="atlas-archive-link" href="?scenario=aster">Aster Island study <span aria-hidden="true">↗</span></a>
      </header>

      <main>
        <div className="atlas-intro">
          <div><p className="atlas-eyebrow">Geography &amp; natural resources</p><h1>{world?.name ?? 'Verdant Reach'}</h1><p className="atlas-description">An authored regional study of coastlines, biomes, and the resources beneath them.</p></div>
          <dl className="atlas-overview" aria-label="Atlas totals">
            <div><dt>Land area</dt><dd><span id="atlas-land-area">{summary ? number.format(summary.landKm2) : '—'}</span><span className="atlas-unit"> km²</span></dd></div>
            <div><dt>Cells</dt><dd id="atlas-cell-count">{world ? number.format(world.cells.length) : '—'}</dd></div>
            <div><dt>Provinces</dt><dd id="atlas-province-count">{world ? number.format(world.provinces.length) : '—'}</dd></div>
          </dl>
        </div>

        <div className="atlas-workspace">
          <aside className="atlas-sidebar" aria-label="Atlas legend and layers">
            <section className="atlas-panel-section" aria-labelledby="atlas-layers-title">
              <p className="atlas-section-index">01 / View</p><h2 id="atlas-layers-title">Map layers</h2>
              <div className="atlas-layer-options">
                <label><input type="checkbox" checked={layers.resources} onChange={event => setLayers(current => ({ ...current, resources: event.target.checked }))} /><span>Resources</span></label>
                <label><input type="checkbox" checked={layers.provinces} onChange={event => setLayers(current => ({ ...current, provinces: event.target.checked }))} /><span>Provinces</span></label>
                <label><input type="checkbox" checked={layers.grid} onChange={event => setLayers(current => ({ ...current, grid: event.target.checked }))} /><span>Cell grid</span></label>
              </div>
              <label className="atlas-filter-label" htmlFor="atlas-resource-filter">Resource filter</label>
              <select id="atlas-resource-filter" value={layers.resourceFilter ?? ''} disabled={!layers.resources} onChange={event => setLayers(current => ({ ...current, resourceFilter: event.target.value ? event.target.value as Resource : null }))}>
                <option value="">All resources</option>{resourceEntries.map(([resource, detail]) => <option key={resource} value={resource}>{detail.label}</option>)}
              </select>
            </section>
            <section className="atlas-panel-section" aria-labelledby="atlas-biomes-title">
              <div className="atlas-section-heading"><h2 id="atlas-biomes-title">Biomes</h2><span>km²</span></div>
              <ul className="atlas-biome-legend">{biomeEntries.map(([biome, detail]) => <li key={biome}><span className="atlas-biome-name"><span className="atlas-biome-swatch" style={{ backgroundColor: detail.color }} aria-hidden="true" />{detail.label}</span><span>{summary ? number.format(summary.biomes[biome]) : '—'}</span></li>)}</ul>
            </section>
            <section className="atlas-panel-section atlas-resource-section" aria-labelledby="atlas-resources-title">
              <h2 id="atlas-resources-title">Natural resources</h2><p className="atlas-panel-note">Scattered sites of initial natural potential. Counts are sites, not produced stockpiles.</p>
              <ul className="atlas-resource-legend">{resourceEntries.map(([resource, detail]) => <li key={resource}><span className="atlas-resource-symbol"><ResourceIcon resource={resource} /></span><span className="atlas-resource-name">{detail.label}</span><span className="atlas-resource-count" aria-label={`${summary ? number.format(summary.resources[resource]) : '—'} ${detail.label} sites`}>{summary ? number.format(summary.resources[resource]) : '—'}</span></li>)}</ul>
              <p className="atlas-panel-note atlas-marker-note">{summary ? number.format(summary.resourceSites) : '—'} resource sites in this study. This preview reveals every resource type.</p>
            </section>
          </aside>

          <section className="atlas-map-stage" aria-label="Regional map" aria-busy={busy}>
            <div className="atlas-map-card">{world ? <AtlasCanvas world={world} layers={layers} selection={selection} onSelect={setSelection} onReady={setRenderedWorld} onError={onError} /> : <div className="atlas-loading-map"><span className="atlas-loading-compass" aria-hidden="true">✦</span><p>{error ? 'The atlas is unavailable.' : 'Preparing your atlas…'}</p><span>{error ? 'Use Retry atlas to load this regional study.' : 'Reading the regional geography from the local host.'}</span></div>}</div>
            <div className="atlas-map-caption"><span>Plate II <span aria-hidden="true">—</span> Verdant Reach</span><span>Regional geography study</span></div>
            <div className="atlas-status-row"><p id="atlas-status" role="status" aria-live="polite">{status}</p><button className="atlas-reset-button" type="button" disabled={renderFailed} aria-disabled={busy || renderFailed} onClick={resetAtlas}>{error && !renderFailed ? 'Retry atlas' : 'Reset atlas'}<span aria-hidden="true">↻</span></button></div>
            {error && <p className="atlas-error" role="alert">{error}</p>}
          </section>

          <aside className="atlas-inspector" aria-labelledby="atlas-inspector-title">
            <p className="atlas-section-index">02 / Inspect</p><div className="atlas-section-heading"><h2 id="atlas-inspector-title">{selection?.kind === 'province' ? 'Province detail' : selection?.kind === 'cell' ? 'Cell detail' : 'Inspect the atlas'}</h2>{selection && <button className="atlas-clear-selection" type="button" onClick={() => setSelection(null)} aria-label="Clear selection">×</button>}</div>
            {selection?.kind === 'province' && province && provinceSummary ? <div className="atlas-selected-province" data-selected-province={province.id} aria-live="polite">
              <section className="atlas-province-resources" aria-label="Province resources">
                <div className="atlas-province-resource-heading"><div><p className="atlas-detail-label">Province resources</p><h3>{province.name}</h3></div><span className="atlas-province-site-total">{number.format(provinceSummary.resourceSites)} {provinceSummary.resourceSites === 1 ? 'site' : 'sites'}</span></div>
                <dl className="atlas-province-facts"><div><dt>Area</dt><dd>{number.format(provinceSummary.areaKm2)} km²</dd></div><div><dt>Cells</dt><dd>{number.format(provinceSummary.cellCount)}</dd></div><div><dt>Country</dt><dd>{country?.name ?? 'Unclaimed'}</dd></div></dl>
                {provinceSummary.resourceSites ? <ul>{resourceEntries.filter(([resource]) => provinceSummary.resources[resource] > 0).map(([resource, detail]) => <li key={resource}><span className="atlas-resource-symbol"><ResourceIcon resource={resource} /></span><span>{detail.label}</span><strong className="atlas-province-resource-count">{number.format(provinceSummary.resources[resource])}</strong></li>)}</ul> : <p className="atlas-province-resource-empty">No resource sites in this province</p>}
                <p className="atlas-province-selection-hint">Click inside {province.name} again to inspect a cell.</p>
              </section>
            </div> : cell ? <div className="atlas-selected-cell" data-selected-cell={cell.id} aria-live="polite">
              <div className="atlas-cell-biome" style={{ borderColor: BIOMES[cell.biome].color }}><p>Cell {number.format(cell.id)}</p><h3>{BIOMES[cell.biome].label}</h3></div>
              <dl className="atlas-cell-facts"><div><dt>Elevation</dt><dd>{number.format(cell.elevation)} m</dd></div><div><dt>Cell area</dt><dd>{number.format(world!.cellAreaKm2)} km²</dd></div></dl>
              <section className="atlas-cell-resource" aria-label="Selected cell resource">{cell.resource !== null ? <>
                <p className="atlas-detail-label">Resource site</p><p className="atlas-resource-value"><span><ResourceIcon resource={cell.resource} /></span>{RESOURCES[cell.resource].label}</p>
                <dl className="atlas-resource-facts"><div><dt>Site type</dt><dd>{RESOURCE_RULES[cell.resource].kind === 'renewable' ? 'Renewable' : 'Mineral'}</dd></div><div><dt>Required extraction technology</dt><dd>{RESOURCE_RULES[cell.resource].extractionTechnology}</dd></div></dl>
                <p className="atlas-panel-note">This site is natural potential; extraction and production are not active.</p>
              </> : <>
                <p className="atlas-detail-label">Natural potential</p><p className="atlas-resource-empty">No resource site in this cell</p><p className="atlas-panel-note">This cell still has its biome. It has no special resource site in this study.</p>
              </>}</section>
              {province && <button className="atlas-back-selection" type="button" onClick={() => setSelection(parentAtlasSelection(world!, selection))}><span aria-hidden="true">←</span> Back to province</button>}
              <dl className="atlas-geography-tree"><div><dt>Cell</dt><dd>#{number.format(cell.id)}</dd></div><div><dt>Province</dt><dd>{province?.name ?? 'Open water'}</dd></div><div><dt>Country</dt><dd>{country?.name ?? (province ? 'Unclaimed' : 'No country')}</dd></div></dl>
            </div> : <div className="atlas-inspector-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 10h44v44H10zM10 25h44M10 39h44M25 10v44M39 10v44" /><path className="atlas-inspector-cell" d="M25 25h14v14H25z" /></svg><h3>A closer look</h3><p>Click land to inspect its province, then click inside that province again to inspect a cell. Water opens cell detail directly.</p><span>Cells form provinces.<br />Provinces can belong to countries.</span></div>}
            <div className="atlas-unclaimed-note"><span aria-hidden="true">◇</span><p>All provinces are unclaimed in this study. Countries and living systems come later.</p></div>
          </aside>
        </div>
      </main>
      <footer className="atlas-footer"><span>Chronicle / World studies</span><span>Authored regional atlas · Scattered resource sites</span></footer>
    </div>
  );
}
