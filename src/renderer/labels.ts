/** A place name to draw: where its text starts (left, vertical middle), its tier and whether it is a capital. */
export interface PlaceLabel { x: number; y: number; name: string; tier: number; capital: boolean }

/**
 * The names a crowded map can show: capitals first, then larger places, each kept only if its box (from `width`, the
 * drawn text width, and a fixed line height) overlaps none already kept. Zooming in spreads places out and brings the
 * rest back.
 */
export function placeLabels<T extends PlaceLabel>(labels: readonly T[], width: (label: T) => number, half = 8): T[] {
  const ordered = [...labels].sort((a, b) => Number(b.capital) - Number(a.capital) || b.tier - a.tier);
  const kept: T[] = [], boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const label of ordered) {
    const box = { x1: label.x - 2, y1: label.y - half, x2: label.x + width(label) + 2, y2: label.y + half };
    if (boxes.some(other => box.x1 < other.x2 && other.x1 < box.x2 && box.y1 < other.y2 && other.y1 < box.y2)) continue;
    boxes.push(box); kept.push(label);
  }
  return kept;
}
