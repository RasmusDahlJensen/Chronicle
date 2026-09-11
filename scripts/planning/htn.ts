// The pinned dependency publishes JavaScript only. Keep its untyped API inside
// this comparison adapter; the live simulation does not depend on the planner.
// @ts-expect-error gameplan-htn@1.0.1 does not ship TypeScript declarations.
import untypedHTN from 'gameplan-htn';

interface PlanningContext {
  WorldState: Record<string, number>;
  ContextState: 'planning' | 'executing';
  WorldStateChangeStack: Record<string, { value: number; effectType: string }[]>;
  MethodTraversalRecord: number[];
  init(): void;
  getState(key: string): number;
  setState(key: string, value: number, dirty: boolean, effectType: string): void;
}
interface PrimitiveDefinition {
  name: string;
  operator: () => 'success';
  conditions: ((context: PlanningContext) => boolean)[];
  effects: {
    name: string;
    type: 'planonly';
    action: (context: PlanningContext, effectType: string) => void;
  }[];
}
interface MethodDefinition {
  name: string;
  type: 'sequence';
  tasks: PrimitiveDefinition[];
}
const HTN = untypedHTN as {
  Context: new () => PlanningContext;
  Domain: new (definition: { name: string; tasks: MethodDefinition[] }) => {
    findPlan(context: PlanningContext): {
      status: 'succeeded' | 'failed' | 'rejected' | 'partial';
      plan: { Name: string }[];
    };
  };
};

/** The 1.0.1 package pushes pending changes but reads the oldest entry.
 * Override only that read, retaining the library's sequence rollback machinery.
 * This adapter uses fresh contexts and plan-only effects, never permanent
 * effects or partial plans. The published defect and repair have regressions.
 */
function contextWithLatestState(): PlanningContext {
  const context = new HTN.Context();
  context.WorldState = { snapshotId: 0 };
  context.init();
  context.getState = function (key) {
    if (this.ContextState === 'executing') return this.WorldState[key];
    const stack = this.WorldStateChangeStack[key];
    if (!stack) throw new Error(`Uninitialized HTN state key: ${key}`);
    return stack.length ? stack[stack.length - 1].value : this.WorldState[key];
  };
  return context;
}

/** Decompose the first feasible ordered method using isolated core projections.
 * The caller owns committed plans and actual execution; no effects touch initial.
 * expanded counts transition calls, including failed projections, exactly once.
 */
export function selectHTNPlan<T>(
  initial: T,
  methods: readonly { id: string; steps: string[] }[],
  transition: (state: T, step: string) => T | null,
): { methodId: string; steps: string[]; expanded: number } | null {
  if (methods.length > 12) throw new Error('HTN comparison allows at most 12 methods.');
  if (new Set(methods.map((method) => method.id)).size !== methods.length)
    throw new Error('HTN method IDs must be unique.');
  for (const method of methods) {
    if (!method.id.trim()) throw new Error('HTN method IDs must be nonempty.');
    if (method.steps.length < 1 || method.steps.length > 3 || method.steps.some((step) => !step.trim()))
      throw new Error('HTN methods require 1 to 3 nonempty steps.');
  }
  if (!methods.length) return null;
  const snapshots: T[] = [structuredClone(initial)];
  let expanded = 0;
  const primitive = (step: string): PrimitiveDefinition => {
    // Conditions and effects refer to the same projection. Failed-method
    // rollback restores snapshotId; it cannot mutate another method's inputs.
    const projected = new Map<number, number | null>();
    const project = (context: PlanningContext): number | null => {
      const source = context.getState('snapshotId');
      if (projected.has(source)) return projected.get(source)!;
      expanded++;
      const next = transition(structuredClone(snapshots[source]), step);
      const id = next === null ? null : snapshots.push(structuredClone(next)) - 1;
      projected.set(source, id);
      return id;
    };
    return {
      name: step,
      operator: () => 'success',
      conditions: [(context) => project(context) !== null],
      effects: [{
        name: `Project ${step}`,
        type: 'planonly',
        action(context, effectType) {
          const id = project(context);
          if (id === null) throw new Error('HTN applied an invalid transition.');
          context.setState('snapshotId', id, false, effectType);
        },
      }],
    };
  };
  const context = contextWithLatestState();
  const domain = new HTN.Domain({
    name: 'Country planning comparison',
    tasks: methods.map((method) => ({ name: method.id, type: 'sequence', tasks: method.steps.map(primitive) })),
  });
  const result = domain.findPlan(context);
  if (result.status !== 'succeeded') return null;
  const method = methods[context.MethodTraversalRecord[0]];
  const steps = result.plan.map((task) => task.Name);
  if (!method || steps.length !== method.steps.length || steps.some((step, index) => step !== method.steps[index]))
    throw new Error('HTN returned an unexpected method decomposition.');
  return { methodId: method.id, steps, expanded };
}
