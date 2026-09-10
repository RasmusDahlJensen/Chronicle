import type { ApiError } from '../shared/http.ts';

/** Only these bounded, deliberate messages cross the worker/HTTP boundary. */
export class SimulationError extends Error {
  code: ApiError['error']['code'];
  statusCode: number;
  constructor(code: ApiError['error']['code'], message: string, statusCode = 503) {
    super(message); this.name = 'SimulationError'; this.code = code; this.statusCode = statusCode;
  }
}
export const simulationUnavailable = () => new SimulationError('UNAVAILABLE', 'The tribal simulation is unavailable. Retry connecting.');
export const simulationConflict = (message = 'The tribe changed. Refresh its state before another command.') => new SimulationError('CONFLICT', message, 409);
