import type { SimulationCommand, SimulationObserve, SimulationOpen, SimulationView } from '../shared/simulation.ts';
import type { WorldStudyBundle } from '../shared/civilization.ts';
import type { ApiError } from '../shared/http.ts';

export type SimulationRequest = { id: number } & (
  | { action: 'open'; input: SimulationOpen }
  | { action: 'initialize'; input: SimulationOpen; bundle: WorldStudyBundle }
  | { action: 'observe' | 'release'; input: SimulationObserve }
  | { action: 'command'; input: SimulationCommand }
  | { action: 'close' }
);
export type SimulationResult = SimulationView | { released: true } | null;
export type SimulationWorkerMessage = { ready: true } | {
  id: number; result: SimulationResult;
} | { id: number; error: { code: ApiError['error']['code']; message: string; statusCode: number } };
