import { createAsterIsland } from './fixtures/aster-island.ts';
import { createAtlasRenderer } from './renderer/atlas.ts';
import { summarizeTerrain } from './world/terrain.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#terrain-canvas')!;
const reset = document.querySelector<HTMLButtonElement>('#reset-terrain')!;
const status = document.querySelector<HTMLElement>('#terrain-status')!;
const error = document.querySelector<HTMLElement>('#render-error')!;

try {
  const renderer = createAtlasRenderer(canvas);
  const number = new Intl.NumberFormat('en');
  let resets = 0;

  function loadTerrain(isReset: boolean) {
    const world = createAsterIsland();
    const areas = summarizeTerrain(world);
    renderer.setWorld(world);
    for (const [id, value] of Object.entries({
      'land-area': areas.landKm2, 'water-area': areas.waterKm2,
      'plains-area': areas.plainsKm2, 'hills-area': areas.hillsKm2,
    })) {
      const element = document.getElementById(id);
      if (element) element.textContent = number.format(value);
    }
    canvas.dataset.fixture = `${world.fixtureId}-v${world.fixtureVersion}`;
    canvas.setAttribute('aria-label', `${world.name}: a fixed island with ${number.format(areas.plainsKm2)} square kilometres of plains and ${number.format(areas.hillsKm2)} square kilometres of hills, surrounded by water.`);
    if (isReset) resets++;
    status.textContent = isReset ? `Original terrain restored · ${resets}` : 'Terrain ready to view';
  }

  const onReset = () => {
    try { loadTerrain(true); }
    catch (cause) { showError(cause); }
  };
  reset.addEventListener('click', onReset);
  loadTerrain(false);
  import.meta.hot?.dispose(() => {
    renderer.destroy();
    reset.removeEventListener('click', onReset);
  });
} catch (cause) {
  showError(cause);
}

function showError(cause: unknown) {
  error.hidden = false;
  error.textContent = cause instanceof Error ? cause.message : 'The terrain could not be displayed.';
  status.textContent = 'Terrain unavailable';
  reset.disabled = true;
}
