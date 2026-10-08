import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from 'typebox';
import { DEFAULT_WORLD_SETTINGS, WorldSettingsSchema, type WorldSettings } from '../shared/generated-world.ts';
import type { ApiError } from '../shared/http.ts';
import { ChroniclePageSchema, EVENT_TYPES, MAX_CHRONICLE_PAGE, ObserverFrameSchema, RegionMapSchema, SimulationControlSchema, type EventType, type SimulationControl } from '../shared/simulation.ts';
import type { SimulationHost, SimulationWorker } from './simulation-host.ts';

/**
 * Observer routes for the simulation (VISION.md "Observer views"). They have their own admission limit, separate
 * from map responses, so polling observers cannot starve geography delivery or the other way round.
 */
export function registerSimulationRoutes(app: FastifyInstance, host: SimulationHost, admissionLimit: number) {
  let admitted = 0;
  const failure = (reply: FastifyReply, status: number, code: ApiError['error']['code'], message: string) =>
    reply.code(status).header('retry-after', '1').send({ error: { code, message, requestId: reply.request.id } });
  const worldQuery = { seed: Type.Optional(WorldSettingsSchema.properties.seed), size: Type.Optional(WorldSettingsSchema.properties.size) };
  const cursor = Type.Optional(Type.String({ pattern: '^\\d{1,9}$' })), inspect = Type.Optional(Type.String({ pattern: '^\\d{1,6}$' })), view = Type.Optional(Type.String({ pattern: '^\\d{1,9}$' }));

  async function withSimulation<T>(reply: FastifyReply, query: Partial<WorldSettings>, use: (simulation: SimulationWorker) => Promise<T>) {
    if (admitted >= admissionLimit) return failure(reply, 503, 'OVERLOADED', 'The simulation is busy. Try again shortly.');
    admitted++;
    try {
      return await use(await host.attach({ ...DEFAULT_WORLD_SETTINGS, ...query }));
    } finally {
      admitted--;
    }
  }

  app.get<{ Querystring: Partial<WorldSettings> & { cursor?: string; inspect?: string; view?: string } }>('/api/simulation/frame', {
    schema: {
      querystring: Type.Object({ ...worldQuery, cursor, inspect, view }, { additionalProperties: false }),
      response: { 200: ObserverFrameSchema },
    },
  }, (request, reply) => {
    const { cursor: from, inspect, view: perspective, ...world } = request.query;
    return withSimulation(reply, world, simulation => simulation.frame(Number(from ?? 0), inspect === undefined ? undefined : Number(inspect), perspective === undefined ? undefined : Number(perspective)));
  });
  app.get<{ Querystring: Partial<WorldSettings> }>('/api/simulation/regions', {
    schema: { querystring: Type.Object(worldQuery, { additionalProperties: false }), response: { 200: RegionMapSchema } },
  }, (request, reply) => withSimulation(reply, request.query, simulation => simulation.regions()));
  // The reply is a frame with the events from `cursor` on, so events emitted by the control itself are not skipped.
  app.post<{ Querystring: Partial<WorldSettings> & { cursor?: string; inspect?: string; view?: string }; Body: SimulationControl }>('/api/simulation/control', {
    schema: {
      querystring: Type.Object({ ...worldQuery, cursor, inspect, view }, { additionalProperties: false }), body: SimulationControlSchema,
      response: { 200: ObserverFrameSchema },
    },
  }, (request, reply) => {
    const { cursor: from, inspect: region, view: perspective, ...world } = request.query;
    return withSimulation(reply, world, simulation => simulation.control(request.body, from === undefined ? Number.MAX_SAFE_INTEGER : Number(from),
      region === undefined ? undefined : Number(region), perspective === undefined ? undefined : Number(perspective)));
  });
  // (U.5) A page of the chronicle, read backward: before an event id (else from the newest), up to `limit` events of
  // the comma-separated `types`, acted in by `polity`, of at least importance `min`.
  type ChronicleQueryString = Partial<WorldSettings> & { before?: string; limit?: string; types?: string; polity?: string; min?: string };
  app.get<{ Querystring: ChronicleQueryString }>('/api/simulation/chronicle', {
    schema: {
      querystring: Type.Object({
        ...worldQuery, before: Type.Optional(Type.String({ pattern: '^\\d{1,9}$' })), limit: Type.Optional(Type.String({ pattern: '^\\d{1,3}$' })),
        types: Type.Optional(Type.String({ pattern: `^[A-Za-z]{1,40}(,[A-Za-z]{1,40}){0,${EVENT_TYPES.length - 1}}$` })), polity: Type.Optional(Type.String({ pattern: '^\\d{1,9}$' })),
        min: Type.Optional(Type.String({ pattern: '^(0(\\.\\d{1,3})?|1(\\.0{1,3})?)$' })),
      }, { additionalProperties: false }),
      response: { 200: ChroniclePageSchema },
    },
  }, (request, reply) => {
    const { before, limit, types, polity, min, ...world } = request.query;
    // A request to correct, not to retry: no retry-after, as for the schema's own refusals.
    const invalid = (text: string) => reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: text, requestId: request.id } });
    const kinds = types === undefined ? null : types.split(',');
    if (kinds?.some(type => !(EVENT_TYPES as readonly string[]).includes(type))) return invalid('Unknown event type.');
    const size = limit === undefined ? MAX_CHRONICLE_PAGE : Number(limit);
    if (size < 1 || size > MAX_CHRONICLE_PAGE) return invalid(`A page holds 1 to ${MAX_CHRONICLE_PAGE} events.`);
    return withSimulation(reply, world, simulation => simulation.chronicle({
      before: before === undefined ? null : Number(before), limit: size, types: kinds as EventType[] | null, polity: polity === undefined ? null : Number(polity), min: min === undefined ? 0 : Number(min),
    }));
  });
  return { snapshot: () => ({ ...host.snapshot(), admitted, admissionLimit }) };
}
