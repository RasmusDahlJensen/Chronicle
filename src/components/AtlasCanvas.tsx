import { useCallback, useEffect, useRef, useState } from 'react';
import type { AtlasWorld } from '../../shared/atlas.ts';
import { createBiomeAtlasRenderer, type AtlasLayers } from '../renderer/biome-atlas.ts';
import type { AtlasSelection } from '../renderer/atlas-selection.ts';

export type { AtlasLayers } from '../renderer/biome-atlas.ts';

interface AtlasCanvasProps {
  world: AtlasWorld;
  layers: AtlasLayers;
  selection: AtlasSelection;
  onSelect: (selection: AtlasSelection) => void;
  onReady: (world: AtlasWorld) => void;
  onError: (cause: unknown) => void;
}

/** Keep the renderer alive across UI updates; its lifecycle belongs to this canvas. */
export function AtlasCanvas({ world, layers, selection, onSelect, onReady, onError }: AtlasCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createBiomeAtlasRenderer> | null>(null);
  const callbacks = useRef({ onSelect, onReady, onError });
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbacks.current = { onSelect, onReady, onError };
  }, [onSelect, onReady, onError]);

  const reportFailure = useCallback((cause: unknown) => {
    rendererRef.current?.destroy();
    rendererRef.current = null;
    setFailed(true);
    callbacks.current.onError(cause);
  }, []);

  useEffect(() => {
    try {
      rendererRef.current = createBiomeAtlasRenderer(canvasRef.current!, {
        onSelect: selection => callbacks.current.onSelect(selection),
        onViewChange: setZoom,
      });
    } catch (cause) {
      reportFailure(cause);
    }
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [reportFailure]);

  useEffect(() => {
    if (!rendererRef.current) return;
    try {
      rendererRef.current.setWorld(world);
      callbacks.current.onReady(world);
    } catch (cause) {
      reportFailure(cause);
    }
  }, [world, reportFailure]);

  useEffect(() => {
    try {
      rendererRef.current?.setLayers(layers);
    } catch (cause) {
      reportFailure(cause);
    }
  }, [layers, reportFailure]);

  useEffect(() => {
    try {
      rendererRef.current?.setSelection(selection);
    } catch (cause) {
      reportFailure(cause);
    }
  }, [selection, world, reportFailure]);

  function changeView(action: 'in' | 'out' | 'fit') {
    if (!rendererRef.current) return;
    try {
      if (action === 'fit') rendererRef.current.fit();
      else rendererRef.current.zoomBy(action === 'in' ? 1.5 : 1 / 1.5);
    } catch (cause) {
      reportFailure(cause);
    }
  }

  return (
    <>
      <div className="atlas-map-toolbar">
        <span className="atlas-map-mode"><span aria-hidden="true" /> Biome atlas</span>
        <div className="atlas-zoom-controls" role="group" aria-label="Map view">
          <button type="button" aria-label="Zoom out" disabled={failed} onClick={() => changeView('out')}>−</button>
          <span className="atlas-zoom-value" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={failed} onClick={() => changeView('in')}>+</button>
          <button className="atlas-fit-button" type="button" disabled={failed} onClick={() => changeView('fit')}>Fit map</button>
        </div>
      </div>
      <div className="atlas-canvas-frame">
        <canvas
          ref={canvasRef}
          id="world-canvas"
          role="img"
          tabIndex={0}
          aria-label={`${world.name}: regional biome and natural resource atlas. Click to select a province, then click inside it to inspect a cell. Click the selected land cell again to return to its province.`}
          aria-describedby="atlas-map-help"
        >
          The regional atlas needs a browser with Canvas 2D support.
        </canvas>
        <span className="atlas-north-mark" aria-hidden="true"><span>N</span>↑</span>
      </div>
      <p id="atlas-map-help" className="atlas-map-help">Click a province, then a cell · Click the selected land cell again to return to its province · Drag to explore · Scroll to zoom. Keyboard: arrows inspect cells, Enter selects, Escape goes back, Shift + arrows pan, + / − zoom, Home fits the map.</p>
    </>
  );
}
