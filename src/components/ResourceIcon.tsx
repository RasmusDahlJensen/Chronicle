import { useEffect, useRef } from 'react';
import type { Resource } from '../../shared/atlas.ts';
import { drawAtlasResourceIcon } from '../renderer/biome-atlas.ts';

/** The legend uses the same pictograms as the map, with adjacent text labels. */
export function ResourceIcon({ resource }: { resource: Resource }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 48, 48);
    drawAtlasResourceIcon(context, resource, 24, 24, 17);
  }, [resource]);
  return <canvas className="atlas-resource-icon" ref={canvasRef} width={48} height={48} aria-hidden="true" />;
}
