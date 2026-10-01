import { RESOURCES, type Resource } from '../world/atlas.ts';

// Shared cartographic drawing helpers: resource marks and the biome motifs used by the generated-world textures.
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
