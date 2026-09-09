import type { TerrainWorld } from '../world/terrain.ts';

type Color = readonly [number, number, number];

/** Rasterization and presentation are read-only views of the shared cell data. */
export function createAtlasRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not open the terrain canvas.');
  let plate: HTMLCanvasElement | undefined;
  let currentWorld: TerrainWorld | undefined;

  function redraw() {
    if (!plate || !currentWorld) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    context!.drawImage(plate, 0, 0, canvas.width, canvas.height);
    context!.save();
    context!.scale(canvas.width / plate.width, canvas.height / plate.height);
    drawChartDetails(context!, currentWorld, 6, Math.max(1, 850 / rect.width));
    context!.restore();
    canvas.dataset.rendered = 'true';
  }

  const observer = new ResizeObserver(redraw);
  observer.observe(canvas);

  return {
    setWorld(world: TerrainWorld) {
      const started = performance.now();
      plate = paintPlate(world);
      currentWorld = world;
      redraw();
      canvas.dataset.renderMs = (performance.now() - started).toFixed(1);
    },
    destroy() { observer.disconnect(); },
  };
}

function paintPlate(world: TerrainWorld) {
  const scale = 6;
  const plate = document.createElement('canvas');
  plate.width = world.width * scale;
  plate.height = world.height * scale;
  const ctx = plate.getContext('2d')!;
  const pixels = ctx.createImageData(plate.width, plate.height);
  const elevations = world.cells.map(cell => cell.elevation);

  function heightAt(x: number, y: number) {
    x = Math.max(0, Math.min(world.width - 1, x));
    y = Math.max(0, Math.min(world.height - 1, y));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, world.width - 1);
    const y1 = Math.min(y0 + 1, world.height - 1);
    const a = mix(elevations[y0 * world.width + x0], elevations[y0 * world.width + x1], x - x0);
    const b = mix(elevations[y1 * world.width + x0], elevations[y1 * world.width + x1], x - x0);
    return mix(a, b, y - y0);
  }

  for (let py = 0; py < plate.height; py++) {
    for (let px = 0; px < plate.width; px++) {
      const x = (px + 0.5) / scale - 0.5;
      const y = (py + 0.5) / scale - 0.5;
      const h = heightAt(x, y);
      const grain = (hash(px, py) - 0.5) * 9;
      let color: Color;
      let shade = 1;

      if (h < 0) {
        const depth = -h;
        color = blend([172, 198, 186], [106, 153, 163], Math.min(1, depth / 250));
        color = blend(color, [77, 116, 132], Math.min(1, depth / 1800));
        // Quiet depth bands echo the engraved coastal rings of an old atlas.
        const ring = depth < 260 ? Math.pow(Math.max(0, Math.cos(depth / 12)), 16) * 0.04 : 0;
        shade = 1 + ring + Math.sin(py * 0.16 + px * 0.014) * 0.008;
      } else {
        color = blend([220, 210, 165], [187, 194, 144], Math.min(1, h / 150));
        color = blend(color, [155, 160, 120], Math.max(0, Math.min(1, (h - 150) / 500)));
        color = blend(color, [213, 203, 164], Math.max(0, Math.min(1, (h - 650) / 450)));
        const dx = (heightAt(x + 0.8, y) - heightAt(x - 0.8, y)) * 0.035;
        const dy = (heightAt(x, y + 0.8) - heightAt(x, y - 0.8)) * 0.035;
        const light = (dx * 0.55 + dy * 0.65 + 1.4) / Math.hypot(dx, dy, 1.4);
        shade = 0.78 + light * 0.30;
        if (h < 20) color = blend([231, 218, 175], color, h / 20);
        if (h < 5) shade *= 0.78;
      }

      const offset = (py * plate.width + px) * 4;
      pixels.data[offset] = color[0] * shade + grain;
      pixels.data[offset + 1] = color[1] * shade + grain;
      pixels.data[offset + 2] = color[2] * shade + grain;
      pixels.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return plate;
}

function drawChartDetails(ctx: CanvasRenderingContext2D, world: TerrainWorld, scale: number, textScale: number) {
  const width = world.width * scale;
  const height = world.height * scale;

  // Sparse graticule is a visual reference in this local, flat study, not latitude/longitude.
  ctx.strokeStyle = 'rgba(239, 230, 195, 0.13)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 7]);
  for (let x = 24 * scale; x < width; x += 24 * scale) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 24 * scale; y < height; y += 24 * scale) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(width * 0.16, height * 0.75);
  ctx.rotate(-0.17);
  ctx.fillStyle = 'rgba(238, 230, 205, 0.75)';
  ctx.font = `italic ${24 * textScale}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText('The Pale Sea', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(width * 0.51, height * 0.54);
  ctx.rotate(0.65);
  ctx.textAlign = 'center';
  ctx.font = `italic ${18 * textScale}px Georgia, serif`;
  ctx.lineWidth = 4 * textScale;
  ctx.strokeStyle = 'rgba(218, 211, 177, 0.65)';
  ctx.strokeText('Aster Highlands', 0, 0);
  ctx.fillStyle = '#4c5140';
  ctx.fillText('Aster Highlands', 0, 0);
  ctx.restore();

  // The scale is derived from the world cell area, not from arbitrary screen pixels.
  const kmPerCell = Math.sqrt(world.cellAreaKm2);
  const bar = 20 / kmPerCell * scale;
  const bx = width - bar - 40;
  const by = height - 42;
  ctx.strokeStyle = '#e8dfc0';
  ctx.fillStyle = '#e8dfc0';
  ctx.lineWidth = 1.5 * textScale;
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + bar, by);
  for (let i = 0; i <= 2; i++) {
    ctx.moveTo(bx + i * bar / 2, by - 4); ctx.lineTo(bx + i * bar / 2, by + 4);
  }
  ctx.stroke();
  ctx.font = `${12 * textScale}px Georgia, serif`;
  ctx.textAlign = 'center';
  if (textScale > 1.2) {
    ctx.fillText('20 km', bx + bar / 2, by - 10);
  } else {
    ctx.fillText('0', bx, by + 19);
    ctx.fillText('10', bx + bar / 2, by + 19);
    ctx.fillText('20 km', bx + bar, by + 19);
  }
}

function mix(a: number, b: number, amount: number) { return a + (b - a) * amount; }
function blend(a: Color, b: Color, amount: number): Color {
  return [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)];
}
function hash(x: number, y: number) {
  let n = Math.imul(x + 91, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
