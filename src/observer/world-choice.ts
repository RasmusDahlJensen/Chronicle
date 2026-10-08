import { DEFAULT_WORLD_SETTINGS, parseWorldSettings, type WorldSettings } from '../../shared/generated-world.ts';

/**
 * The world chosen in this tab (U.1): the game and the lab show the same world, so opening the lab from the game (or
 * going back) keeps it. Kept in session storage; anything missing or invalid falls back to the default world.
 */
const KEY = 'chronicle.world';

export function chosenWorld(): WorldSettings {
  try {
    const stored = sessionStorage.getItem(KEY);
    return stored ? parseWorldSettings(JSON.parse(stored)) : DEFAULT_WORLD_SETTINGS;
  } catch { return DEFAULT_WORLD_SETTINGS; }
}

export function rememberWorld(settings: WorldSettings) {
  try { sessionStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage may be unavailable: the default is used */ }
}
