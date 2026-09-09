import { useCallback, useMemo, useState } from 'react';
import { TerrainMap } from './components/TerrainMap.tsx';
import { createAsterIsland } from './fixtures/aster-island.ts';
import { summarizeTerrain, type TerrainWorld } from './world/terrain.ts';

const number = new Intl.NumberFormat('en');

interface TerrainState {
  world: TerrainWorld | null;
  resets: number;
  error: string | null;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'The terrain could not be displayed.';
}

function initialTerrain(): TerrainState {
  try {
    return { world: createAsterIsland(), resets: 0, error: null };
  } catch (cause) {
    return { world: null, resets: 0, error: errorMessage(cause) };
  }
}

export default function App() {
  const [{ world, resets, error }, setTerrain] = useState(initialTerrain);
  const [renderedWorld, setRenderedWorld] = useState<TerrainWorld | null>(null);
  const areas = useMemo(() => world ? summarizeTerrain(world) : null, [world]);
  const onError = useCallback((cause: unknown) => {
    setTerrain(current => ({ ...current, error: errorMessage(cause) }));
  }, []);

  function resetTerrain() {
    try {
      const nextWorld = createAsterIsland();
      setTerrain(current => ({ world: nextWorld, resets: current.resets + 1, error: null }));
    } catch (cause) {
      onError(cause);
    }
  }

  const status = error !== null ? 'Terrain unavailable'
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
            <h1 id="island-title">Aster Island</h1>
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
                <dd><span id="water-area">{number.format(areas?.waterKm2 ?? 0)}</span> km²</dd>
              </div>
              <div className="legend-row">
                <dt><span className="swatch swatch--plains" aria-hidden="true"></span>Plains</dt>
                <dd><span id="plains-area">{number.format(areas?.plainsKm2 ?? 0)}</span> km²</dd>
              </div>
              <div className="legend-row">
                <dt><span className="swatch swatch--hills" aria-hidden="true"></span>Hills</dt>
                <dd><span id="hills-area">{number.format(areas?.hillsKm2 ?? 0)}</span> km²</dd>
              </div>
            </dl>
            <p className="area-total"><span>Island land</span><strong><span id="land-area">{number.format(areas?.landKm2 ?? 0)}</span> km²</strong></p>
          </section>

          <div className="study-actions">
            <button id="reset-terrain" type="button" onClick={resetTerrain} disabled={error !== null}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.1 6.8A6.4 6.4 0 1 1 3.8 13" />
                <path d="M4.1 3.4v3.4h3.4" />
              </svg>
              <span>Reset terrain</span>
            </button>
            <p id="terrain-status" role="status" aria-live="polite">{status}</p>
          </div>
        </aside>

        <section className="map-column" aria-labelledby="plate-title">
          <figure className="map-plate">
            <div id="map-frame">
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
