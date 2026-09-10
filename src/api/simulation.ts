import { Check } from 'typebox/value';
import { ApiErrorSchema } from '../../shared/http.ts';
import type { WorldManifest } from '../../shared/generated-world.ts';
import { MAX_SIMULATION_BYTES, parseSimulationView, type SimulationCommand, type SimulationObserve, type SimulationOpen } from '../../shared/simulation.ts';

export class SimulationConflictError extends Error {}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_SIMULATION_BYTES) {
    await response.body?.cancel(); throw new Error('The tribal response was too large. Retry loading the tribe.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The tribal response was empty. Retry loading the tribe.');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SIMULATION_BYTES) { await reader.cancel(); throw new Error('The tribal response was too large. Retry loading the tribe.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

async function post(action: string, body: SimulationOpen | SimulationObserve | SimulationCommand, caller: AbortSignal, keepalive = false) {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(keepalive ? 5000 : 30_000)]);
  let response: Response;
  try {
    response = await fetch(`/api/simulation/${action}`, { method: 'POST', body: JSON.stringify(body), signal, keepalive,
      cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
  } catch { throw new Error('The tribe could not be reached. Retry tribe to read its saved state.'); }
  if (response.status === 409) {
    await response.body?.cancel();
    throw new SimulationConflictError('The tribe changed elsewhere. Its current state must be refreshed before another command.');
  }
  const payload = await boundedJson(response, signal).catch(cause => {
    if (cause instanceof Error && cause.message.includes('too large')) throw cause;
    throw new Error('The tribal response could not be read. Retry tribe to read its saved state.');
  });
  if (!response.ok) {
    throw new Error(Check(ApiErrorSchema, payload) ? payload.error.message : 'The tribe is unavailable. Retry tribe to read its saved state.');
  }
  return payload;
}

async function view(action: string, body: SimulationOpen | SimulationObserve | SimulationCommand, world: WorldManifest, signal: AbortSignal) {
  const result = parseSimulationView(await post(action, body, signal), world);
  if (result.state.id !== body.instanceId || 'placementSeed' in body && result.state.placementSeed !== body.placementSeed) {
    throw new Error('The host returned a different tribal instance. The previous state has been kept.');
  }
  return result;
}
export const openSimulation = (body: SimulationOpen, world: WorldManifest, signal: AbortSignal) => view('open', body, world, signal);
export const observeSimulation = (body: SimulationObserve, world: WorldManifest, signal: AbortSignal) => view('observe', body, world, signal);
export const commandSimulation = (body: SimulationCommand, world: WorldManifest, signal: AbortSignal) => view('command', body, world, signal);

/** Cleanup has its own short deadline; it must survive cancellation of the view. */
export async function releaseSimulation(body: SimulationObserve) {
  await post('release', body, new AbortController().signal, true);
}
