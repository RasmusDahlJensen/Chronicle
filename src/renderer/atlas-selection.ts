import type { AtlasWorld } from '../../shared/atlas.ts';

/** Observer selection is view state, separate from authoritative world data. */
export type AtlasSelection =
  | { kind: 'province'; provinceId: string }
  | { kind: 'cell'; cellId: number }
  | null;

export function pickAtlasCell(world: AtlasWorld, selection: AtlasSelection, cellId: number): AtlasSelection {
  const cell = world.cells[cellId];
  if (!cell) return selection;
  const activeProvinceId = selection?.kind === 'province' ? selection.provinceId
    : selection?.kind === 'cell' ? world.cells[selection.cellId]?.provinceId : null;
  const clickedSelectedCell = selection?.kind === 'cell' && selection.cellId === cellId;
  if (cell.provinceId !== null && (cell.provinceId !== activeProvinceId || clickedSelectedCell)) {
    return { kind: 'province', provinceId: cell.provinceId };
  }
  return { kind: 'cell', cellId };
}

export function parentAtlasSelection(world: AtlasWorld, selection: AtlasSelection): AtlasSelection {
  if (selection?.kind === 'cell') {
    const provinceId = world.cells[selection.cellId]?.provinceId;
    if (provinceId != null) return { kind: 'province', provinceId };
  }
  return null;
}
