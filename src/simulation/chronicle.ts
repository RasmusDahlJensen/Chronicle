import type { ChronicleEvent, EventType } from '../../shared/simulation.ts';

/**
 * The chronicle: structured events with causes, stored in id order (VISION.md "The Chronicle"). Systems emit
 * events during a tick; the chronicle system flushes them at the end of the tick so ids follow system order.
 * A running FNV-1a hash over the serialized log makes determinism checks cheap at any length.
 */
export interface EventInput {
  type: EventType;
  actors?: ChronicleEvent['actors'];
  region?: number | null; settlement?: number | null;
  causes?: ChronicleEvent['causes'];
  parents?: number[];
  /** 0–1; systems compute it from population affected, actor size, rarity and firsts. */
  importance: number;
  data?: ChronicleEvent['data'];
}

export class Chronicle {
  readonly events: ChronicleEvent[] = [];
  private pending: EventInput[] = [];
  private hashValue = 0x811c9dc5;

  emit(input: EventInput) { this.pending.push(input); }

  /** Assign ids and commit this tick's events (system order, then emission order). */
  flush(tick: number) {
    for (const input of this.pending) {
      const event: ChronicleEvent = {
        id: this.events.length, tick, type: input.type, actors: input.actors ?? [], region: input.region ?? null,
        settlement: input.settlement ?? null, causes: input.causes ?? [], parents: input.parents ?? [],
        importance: input.importance, data: input.data ?? {},
      };
      this.events.push(event);
      const text = JSON.stringify(event);
      let hash = this.hashValue;
      for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
      this.hashValue = hash >>> 0;
    }
    this.pending = [];
  }

  get pendingCount() { return this.pending.length; }
  get hash() { return this.hashValue.toString(16).padStart(8, '0'); }

  /** Events with id ≥ cursor, keeping the newest `limit` when more exist. */
  since(cursor: number, limit: number) {
    const start = Math.max(0, cursor, this.events.length - limit);
    return this.events.slice(start);
  }
}
