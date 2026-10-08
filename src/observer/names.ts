/**
 * The peoples' names the observer has seen in this history (U.1). Each frame names the polities acting in its own
 * events; the event lists keep events from many frames, so the names are kept too, merged frame by frame, and dropped
 * when a new run or epoch starts.
 */
export function mergeNames(current: ReadonlyMap<number, string>, pairs: readonly (readonly [number, string])[], fresh: boolean) {
  if (!pairs.length && !fresh) return current;
  const next = new Map(fresh ? [] : current);
  for (const [id, name] of pairs) next.set(id, name);
  return next;
}

/** Names for `describeEvent` ("the Vraye"), "#id" for a people not yet named. */
export function nameOf(names: ReadonlyMap<number, string>) {
  return (id: number) => { const name = names.get(id); return name ? `the ${name}` : `#${id}`; };
}
