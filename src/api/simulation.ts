import { Check } from 'typebox/value';
import type { WorldSettings } from '../../shared/generated-world.ts';
import { ApiErrorSchema } from '../../shared/http.ts';
import { parseChroniclePage, parseObserverFrame, parseRegionMap, type ChroniclePage, type ChronicleQuery, type ObserverFrame, type SimulationControl } from '../../shared/simulation.ts';

/** Browser client for the simulation's observer routes. Every response is validated before use. */
const MAX_FRAME_BYTES = 1024 * 1024, MAX_REGION_MAP_BYTES = 6 * 1024 * 1024;

function query(settings: WorldSettings, extra: Record<string, string> = {}) {
  return new URLSearchParams({ seed: settings.seed, size: settings.size, ...extra }).toString();
}

async function requestJson(path: string, maximum: number, callerSignal: AbortSignal, init: RequestInit = {}) {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)]);
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal, cache: 'no-store', headers: { Accept: 'application/json', ...init.headers } });
  } catch (cause) {
    if (callerSignal.aborted) throw cause;
    throw new Error('The simulation could not be reached. Check that Chronicle is running.');
  }
  const text = await response.text();
  if (text.length > maximum) throw new Error('The simulation response was too large.');
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('The simulation response was invalid. Try again.'); }
  if (!response.ok) throw new Error(Check(ApiErrorSchema, body) ? body.error.message : 'The simulation is unavailable. Try again.');
  return body;
}

/** The newest frame with events from `cursor` on; `inspect` asks for one region's details, `view` for one people's
 *  perspective (U.6). */
export async function fetchObserverFrame(settings: WorldSettings, cursor: number, signal: AbortSignal, inspect: number | null = null, view: number | null = null): Promise<ObserverFrame> {
  const extra: Record<string, string> = { cursor: String(cursor) };
  if (inspect !== null) extra.inspect = String(inspect);
  if (view !== null) extra.view = String(view);
  return parseObserverFrame(await requestJson(`/api/simulation/frame?${query(settings, extra)}`, MAX_FRAME_BYTES, signal));
}

/** Apply a control; the reply is a frame with the events from `cursor` on, including any the control itself caused. */
export async function sendSimulationControl(settings: WorldSettings, control: SimulationControl, cursor: number, signal: AbortSignal, inspect: number | null = null, view: number | null = null): Promise<ObserverFrame> {
  const extra: Record<string, string> = { cursor: String(cursor) };
  if (inspect !== null) extra.inspect = String(inspect);
  if (view !== null) extra.view = String(view);
  return parseObserverFrame(await requestJson(`/api/simulation/control?${query(settings, extra)}`, MAX_FRAME_BYTES, signal, {
    method: 'POST', body: JSON.stringify(control), headers: { 'Content-Type': 'application/json' },
  }));
}

/** A page of the chronicle (U.5), read backward with the query's filters. */
export async function fetchChroniclePage(settings: WorldSettings, chronicle: ChronicleQuery, signal: AbortSignal): Promise<ChroniclePage> {
  const extra: Record<string, string> = { limit: String(chronicle.limit) };
  if (chronicle.before !== null) extra.before = String(chronicle.before);
  if (chronicle.types !== null) extra.types = chronicle.types.join(',');
  if (chronicle.polity !== null) extra.polity = String(chronicle.polity);
  if (chronicle.min > 0) extra.min = chronicle.min.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return parseChroniclePage(await requestJson(`/api/simulation/chronicle?${query(settings, extra)}`, MAX_FRAME_BYTES, signal));
}

export async function fetchRegionMap(settings: WorldSettings, signal: AbortSignal) {
  return parseRegionMap(await requestJson(`/api/simulation/regions?${query(settings)}`, MAX_REGION_MAP_BYTES, signal));
}
