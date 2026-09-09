import { useEffect, useRef } from 'react';
import { createAtlasRenderer } from '../renderer/atlas.ts';
import type { TerrainWorld } from '../world/terrain.ts';

interface TerrainMapProps {
  world: TerrainWorld;
  description: string;
  onReady: (world: TerrainWorld) => void;
  onError: (cause: unknown) => void;
}

/** React owns the canvas element; the renderer owns its pixels and resize subscription. */
export function TerrainMap({ world, description, onReady, onError }: TerrainMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderer: ReturnType<typeof createAtlasRenderer> | undefined;
    try {
      renderer = createAtlasRenderer(canvasRef.current!);
      renderer.setWorld(world);
      onReady(world);
    } catch (cause) {
      onError(cause);
    }
    return () => renderer?.destroy();
  }, [world, onReady, onError]);

  return (
    <canvas
      ref={canvasRef}
      id="terrain-canvas"
      role="img"
      aria-label={description}
      data-fixture={`${world.fixtureId}-v${world.fixtureVersion}`}
    >
      A terrain map of Aster Island. Your browser does not support the canvas element.
    </canvas>
  );
}
