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
/** The diplomacy lens (U.4; VISION.md "Diplomacy lens"): each people by its standing with the chosen realm, the realm
 *  itself in brass and peoples it has not met in dark grey. Each standing has its own hue, and their lightness differs
 *  too (CIE L*: not met 21, rival 41, trade partner 54, neutral 59, allied 69, pact 76, the realm 82). Also the treaty
 *  web's colours by kind of treaty. */
export const STANDING_COLORS: Record<'self' | 'allied' | 'pact' | 'trade' | 'rival' | 'neutral' | 'unknown', [number, number, number]> = {
  self: [238, 200, 118], allied: [96, 186, 112], pact: [110, 200, 210], trade: [92, 124, 222], rival: [176, 52, 44], neutral: [150, 140, 122], unknown: [46, 52, 58],
};
export const TREATY_COLORS: Record<'alliance' | 'nonAggression' | 'trade' | 'road', string> = { alliance: '#60ba70', nonAggression: '#40a0b0', trade: '#6f8ff0', road: '#d8c79a' };
/** The perspective lens (U.6): unknown land under fog; remembered land muted toward grey in its last-known people's
 *  colour, or under a grey veil where no one lived. */
export const PERSPECTIVE = { fog: [8, 11, 14] as [number, number, number], fogAlpha: 0.88, rememberedAlpha: 0.5, veil: [120, 120, 120] as [number, number, number], veilAlpha: 0.3 } as const;
export const muted = (color: [number, number, number]): [number, number, number] => [0, 1, 2].map(at => Math.round(color[at] * 0.45 + 120 * 0.55)) as [number, number, number];
/** The population density lens (U.6): people per km² on a logarithmic scale from 0.01 (a forager's land) to 300 (the
 *  crowded heartlands of a late history), dark violet to yellow. */
export const DENSITY_RANGE = [0.01, 300] as const;
const DENSITY_STOPS: [number, number, number][] = [[48, 18, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
export function densityColor(density: number): [number, number, number] {
  const [low, high] = DENSITY_RANGE, at = Math.max(0, Math.min(1, (Math.log10(Math.max(density, low)) - Math.log10(low)) / (Math.log10(high) - Math.log10(low)))) * (DENSITY_STOPS.length - 1);
  const from = DENSITY_STOPS[Math.floor(at)], to = DENSITY_STOPS[Math.min(DENSITY_STOPS.length - 1, Math.floor(at) + 1)], part = at - Math.floor(at);
  return [0, 1, 2].map(index => Math.round(from[index] + (to[index] - from[index]) * part)) as [number, number, number];
}
/** Each inhabited region's people per km²: its people (one marker per region) over its area. */
export function regionDensities(markers: { regions: readonly number[]; populations: readonly number[] }, areaOf: (region: number) => number) {
  const densities = new Map<number, number>();
  markers.regions.forEach((region, index) => { const area = areaOf(region); if (area > 0) densities.set(region, markers.populations[index] / area); });
  return densities;
}
export const DENSITY_GRADIENT = `linear-gradient(to right, ${DENSITY_STOPS.map(stop => `rgb(${stop.join(' ')})`).join(', ')})`;
/** A chosen story's regions (U.3): the rest of the map's territories fade to this share of their alpha, its own are
 *  drawn fully, and its land no one holds now in this brass colour. */
export const HIGHLIGHT = { fade: 0.25, alpha: 0.9, empty: [226, 189, 114] as [number, number, number], emptyAlpha: 0.6 } as const;

/**
 * A distinct colour for each founding people (lineage), as [r, g, b]: hues a golden angle apart, skipping the blues
 * of seas and lakes, in two lightness steps so neighbours in the sequence differ.
 */
export function lineageColor(lineage: number): [number, number, number] {
  let hue = (lineage * 137.508 + 20) % 360;
  if (hue > 180 && hue < 240) hue = (hue + 75) % 360;
  return hslToRgb(hue, 0.62, lineage % 2 ? 0.42 : 0.55);
}

/**
 * A distinct colour for each polity (tribe or civilization), as [r, g, b]: hues a golden angle apart from a different
 * start than the lineages, skipping the blues of seas and lakes, in three lightness and two saturation steps so that
 * polities founded one after another differ even when their hues are close.
 */
export function polityColor(id: number): [number, number, number] {
  let hue = (id * 137.508 + 55) % 360;
  if (hue > 180 && hue < 240) hue = (hue + 75) % 360;
  return hslToRgb(hue, id % 2 ? 0.5 : 0.68, [0.4, 0.52, 0.62][id % 3]);
}

/**
 * A culture's map colour as [r, g, b] from its hue (a daughter's lies near its parent's, so families of cultures share
 * a colour family), in three lightness steps by id so neighbours differ. The hue circle is squeezed evenly into the
 * colours outside the blues of seas and lakes (180–240°), so nearby hues stay nearby (except across 0°).
 */
export function cultureColor(hue: number, id: number): [number, number, number] {
  const shown = (240 + ((hue % 360 + 360) % 360) * 300 / 360) % 360;
  return hslToRgb(shown, 0.6, [0.42, 0.5, 0.58][id % 3]);
}

/** A religion's map colour as [r, g, b]: strong, so faiths stand out against the pale folk ways. */
export function faithColor(hue: number): [number, number, number] {
  return hslToRgb((240 + ((hue % 360 + 360) % 360) * 300 / 360) % 360, 0.7, 0.45);
}

/** The folk ways of a people's culture on the faith map: pale and neutral. */
export const FOLK_COLOR: [number, number, number] = [214, 207, 190];

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
