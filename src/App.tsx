import { useCallback, useEffect, useMemo, useState } from 'react';
import { TerrainMap } from './components/TerrainMap.tsx';
import { loadTerrain } from './api/terrain.ts';
import { summarizeTerrain, type TerrainWorld } from './world/terrain.ts';

const number = new Intl.NumberFormat('en');

interface TerrainState {
  world: TerrainWorld | null;
  resets: number;
  error: string | null;
  loading: boolean;
  renderFailed: boolean;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'The terrain could not be displayed.';
}

export default function App() {
  const [{ world, resets, error, loading, renderFailed }, setTerrain] = useState<TerrainState>({
    world: null, resets: 0, error: null, loading: true, renderFailed: false,
  });
  const [request, setRequest] = useState(0);
  const [renderedWorld, setRenderedWorld] = useState<TerrainWorld | null>(null);
  const areas = useMemo(() => world ? summarizeTerrain(world) : null, [world]);
  const onError = useCallback((cause: unknown) => {
    setTerrain(current => ({ ...current, error: errorMessage(cause), loading: false, renderFailed: true }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTerrain(controller.signal).then(nextWorld => {
      if (controller.signal.aborted) return;
      setTerrain(current => ({
        world: nextWorld, resets: current.world ? current.resets + 1 : 0,
        error: null, loading: false, renderFailed: false,
      }));
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setTerrain(current => ({ ...current, loading: false, error: errorMessage(cause) }));
    });
    return () => controller.abort();
  }, [request]);

  function resetTerrain() {
    if (loading || rendering || renderFailed) return;
    setTerrain(current => ({ ...current, loading: true, error: null }));
    setRequest(current => current + 1);
  }

  const rendering = world !== null && renderedWorld !== world && !renderFailed;
  const status = loading ? 'Loading terrain…'
    : error !== null ? 'Terrain unavailable'
    : renderedWorld !== world ? 'Preparing terrain…'
    : resets > 0 ? `Original terrain restored · ${resets}`
    : 'Terrain ready to view';

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="wordmark" aria-label="Chronicle">
          <svg
            className="wordmark__mark"
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <circle cx="16" cy="16" r="13.25" />
            <path d="M16 5.5v21M5.5 16h21" />
            <path className="wordmark__needle" d="m12.2 19.8 2.6-5 5-2.6-2.6 5-5 2.6Z" />
            <path d="M8.5 24.5c2.25-1.25 4.75-1.25 7.5 0 2.75-1.25 5.25-1.25 7.5 0" />
          </svg>
          <span>Chronicle</span>
        </div>
        <p className="study-index">Terrain lab <span aria-hidden="true">/</span> 01</p>
      </header>

      <main className="atlas-layout">
        <aside className="study-panel" aria-labelledby="island-title">
          <div className="study-panel__intro">
            <p className="eyebrow">Fixed terrain study</p>
            <h1 id="island-title">{world?.name ?? 'Aster Island'}</h1>
            <p className="lede">
              A handcrafted island fixture for studying coastline, open plain,
              and rising ground in Chronicle’s first atlas plate.
            </p>
          </div>

          <section className="terrain-key" aria-labelledby="terrain-key-title">
            <h2 id="terrain-key-title">Terrain &amp; area</h2>
            <dl className="legend-list">
              <div className="legend-row">
                <dt><span className="swatch swatch--water" aria-hidden="true"></span>Water</dt>
                <dd><span id="water-area">{areas ? number.format(areas.waterKm2) : '—'}</span> km²</dd>
              </div>
              <div className="legend-row">
                <dt><span className="swatch swatch--plains" aria-hidden="true"></span>Plains</dt>
                <dd><span id="plains-area">{areas ? number.format(areas.plainsKm2) : '—'}</span> km²</dd>
              </div>
              <div className="legend-row">
                <dt><span className="swatch swatch--hills" aria-hidden="true"></span>Hills</dt>
                <dd><span id="hills-area">{areas ? number.format(areas.hillsKm2) : '—'}</span> km²</dd>
              </div>
            </dl>
            <p className="area-total"><span>Island land</span><strong><span id="land-area">{areas ? number.format(areas.landKm2) : '—'}</span> km²</strong></p>
          </section>

          <div className="study-actions">
            <button
              id="reset-terrain"
              type="button"
              onClick={resetTerrain}
              disabled={renderFailed}
              aria-disabled={loading || rendering || renderFailed}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.1 6.8A6.4 6.4 0 1 1 3.8 13" />
                <path d="M4.1 3.4v3.4h3.4" />
              </svg>
              <span>{error !== null && !renderFailed ? 'Retry terrain' : 'Reset terrain'}</span>
            </button>
            <p id="terrain-status" role="status" aria-live="polite">{status}</p>
          </div>
        </aside>

        <section className="map-column" aria-labelledby="plate-title">
          <figure className="map-plate">
            <div id="map-frame" aria-busy={loading || rendering}>
              {!world && <p className="map-placeholder">{error ? 'Terrain is unavailable.' : 'Loading terrain…'}</p>}
              {world && (
                <TerrainMap
                  world={world}
                  description={`${world.name}: a fixed island with ${number.format(areas!.plainsKm2)} square kilometres of plains and ${number.format(areas!.hillsKm2)} square kilometres of hills, surrounded by water.`}
                  onReady={setRenderedWorld}
                  onError={onError}
                />
              )}
            </div>
            <figcaption id="plate-title">
              <span>Plate I</span>
              <span>Aster Island terrain survey</span>
            </figcaption>
          </figure>
          <p id="render-error" role="alert" hidden={error === null}>
            {error}
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <p>Aster Island <span aria-hidden="true">·</span> Handcrafted fixture</p>
        <p>Chronicle <span aria-hidden="true">/</span> World studies</p>
      </footer>
    </div>

  );
}
