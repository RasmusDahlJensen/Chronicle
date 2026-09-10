import { parentPort, workerData } from 'node:worker_threads';
import { createSimulationRuntime, SIMULATION_LIMITS } from './simulation-runtime.ts';
import { SimulationError, simulationUnavailable } from '../simulation-errors.ts';
import type { SimulationRequest, SimulationResult } from '../simulation-protocol.ts';

const port = parentPort;
if (!port) throw new Error('The simulation authority requires a worker.');
try {
  const runtime = createSimulationRuntime({ directory: workerData.directory });
  const timer = setInterval(() => runtime.tick(), SIMULATION_LIMITS.tickMs);
  port.on('message', (request: SimulationRequest) => {
    try {
      let result: SimulationResult;
      switch (request.action) {
        case 'open': result = runtime.open(request.input); break;
        case 'initialize': result = runtime.initialize(request.input, request.bundle); break;
        case 'observe': result = runtime.observe(request.input); break;
        case 'release': result = runtime.release(request.input); break;
        case 'command': result = runtime.command(request.input); break;
        case 'close':
          clearInterval(timer); runtime.close(); result = null;
          port.postMessage({ id: request.id, result }); port.close(); return;
      }
      port.postMessage({ id: request.id, result });
    } catch (error) {
      const safe = error instanceof SimulationError ? error : simulationUnavailable();
      port.postMessage({ id: request.id, error: { code: safe.code, message: safe.message, statusCode: safe.statusCode } });
    }
  });
  port.postMessage({ ready: true });
} catch (error) {
  const safe = error instanceof SimulationError ? error : simulationUnavailable();
  port.postMessage({ id: 0, error: { code: safe.code, message: safe.message, statusCode: safe.statusCode } });
  port.close();
}
