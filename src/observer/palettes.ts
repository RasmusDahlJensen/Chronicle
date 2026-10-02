/**
 * Observer map palettes (VISION.md: presentation data lives in a browser-side module). Era colours run from earthy
 * Stone-age tones to cool modern ones, so a map of markers reads as a map of technological ages.
 */
export const ERA_COLORS: readonly string[] = [
  '#b8865a', // Stone
  '#c8743a', // Neolithic
  '#b5562f', // Bronze
  '#8f4a3b', // Iron
  '#7a5c8e', // Classical
  '#4f6d9a', // Medieval
  '#357f8a', // Early modern
  '#3f7f4f', // Industrial
  '#5a5f66', // Modern
  '#2f3440', // Atomic
];

export const SETTLEMENT_COLOR = '#f4efe0';
export const SETTLEMENT_STROKE = '#2b1d12';

/** Territory opacity: bands roam lightly over their land; settled civilizations hold theirs. */
export const TERRITORY_ALPHA = { band: 0.55, civ: 0.78 } as const;

/**
 * A distinct colour for each founding people (lineage), as [r, g, b]: hues a golden angle apart, skipping the blues
 * of seas and lakes, in two lightness steps so neighbours in the sequence differ.
 */
export function lineageColor(lineage: number): [number, number, number] {
  let hue = (lineage * 137.508 + 20) % 360;
  if (hue > 180 && hue < 240) hue = (hue + 75) % 360;
  return hslToRgb(hue, 0.62, lineage % 2 ? 0.42 : 0.55);
}

/** An era's map colour as [r, g, b]. */
export function eraColor(era: number): [number, number, number] {
  const hex = ERA_COLORS[era] ?? ERA_COLORS[0];
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

/** Pack a colour and opacity as little-endian RGBA for canvas image data. */
export function packColor([red, green, blue]: [number, number, number], alpha: number) {
  return (red | green << 8 | blue << 16 | Math.round(alpha * 255) << 24) >>> 0;
}

export const cssColor = ([red, green, blue]: [number, number, number]) => `rgb(${red}, ${green}, ${blue})`;

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, segment = hue / 60, x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [r, g, b] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
