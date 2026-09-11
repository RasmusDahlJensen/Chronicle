import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHTNPlan } from '../scripts/planning/htn.ts';
// The pinned package has no declarations; this test audits its actual published behavior.
// @ts-expect-error gameplan-htn@1.0.1 does not ship TypeScript declarations.
import HTN from 'gameplan-htn';

test('the pinned raw HTN package reads the oldest projected balance after repeated spending', () => {
  const context = new HTN.Context();
  context.WorldState = { food: 100 };
  context.init();
  const spend = (name: string) => ({
    name,
    operator: () => 'success',
    effects: [{ name, type: 'planonly', action: (ctx: typeof context, type: string) => ctx.setState('food', ctx.getState('food') - 30, false, type) }],
  });
  const domain = new HTN.Domain({ name: 'Known 1.0.1 stack bug', tasks: [{ name: 'Overdraw', type: 'sequence', tasks: [
    spend('spend-30'), spend('spend-another-30'),
    { name: 'require-70', operator: () => 'success', conditions: [(ctx: typeof context) => ctx.getState('food') >= 70] },
  ] }] });
  const result = domain.findPlan(context);
  assert.equal(result.status, 'succeeded', 'raw 1.0.1 incorrectly admits the final requirement with only 40 food');
  assert.equal(result.plan.length, 3);
  assert.equal(context.WorldState.food, 100, 'the planning probe must not spend live food');
});

test('HTN decomposes ordered methods into steps using each newly projected state', () => {
  const initial = { food: 100, improved: false };
  let calls = 0;
  const result = selectHTNPlan(initial, [{ id: 'invest-then-expand', steps: ['invest', 'expand'] }, { id: 'wait', steps: ['wait'] }], (state, step) => {
    calls++;
    if (step === 'invest') return { food: state.food - 30, improved: true };
    if (step === 'expand') return state.improved && state.food >= 60 ? { ...state, food: state.food - 60 } : null;
    return state;
  });
  assert.deepEqual(result, { methodId: 'invest-then-expand', steps: ['invest', 'expand'], expanded: 2 });
  assert.equal(calls, 2, 'conditions and effects must share the same projected transition');
  assert.deepEqual(initial, { food: 100, improved: false });
});

test('HTN rejects repeated overspending and rolls a failed method back before considering its fallback', () => {
  const inputs: number[] = [];
  const result = selectHTNPlan({ food: 100 }, [
    { id: 'overdraw', steps: ['spend-30', 'spend-30', 'require-70'] },
    { id: 'affordable', steps: ['require-100', 'spend-30'] },
  ], (state, step) => {
    inputs.push(state.food);
    if (step === 'spend-30') return { food: state.food - 30 };
    return state.food >= Number(step.slice(8)) ? state : null;
  });
  assert.deepEqual(result, { methodId: 'affordable', steps: ['require-100', 'spend-30'], expanded: 5 });
  assert.deepEqual(inputs, [100, 70, 40, 100, 100]);
});

test('HTN isolates nested mutation and failed projections from the input and other methods', () => {
  const initial = { stock: { food: 100 }, history: [] as string[] };
  const before = structuredClone(initial);
  const result = selectHTNPlan(initial, [{ id: 'bad', steps: ['fail'] }, { id: 'good', steps: ['finish'] }], (state, step) => {
    assert.equal(state.stock.food, 100);
    assert.equal(state.history.length, 0);
    state.stock.food = 0;
    state.history.push(step);
    return step === 'fail' ? null : state;
  });
  assert.deepEqual(result, { methodId: 'good', steps: ['finish'], expanded: 2 });
  assert.deepEqual(initial, before);
});

test('HTN decisions repeat deterministically and replan from changed committed inputs', () => {
  const methods = [{ id: 'invest', steps: ['pay'] }, { id: 'wait', steps: ['wait'] }];
  const transition = (state: { food: number }, step: string) => step === 'pay' ? (state.food >= 50 ? { food: state.food - 50 } : null) : state;
  for (let n = 0; n < 100; n++) {
    assert.deepEqual(selectHTNPlan({ food: 100 }, methods, transition), { methodId: 'invest', steps: ['pay'], expanded: 1 });
    assert.deepEqual(selectHTNPlan({ food: 10 }, methods, transition), { methodId: 'wait', steps: ['wait'], expanded: 2 });
  }
  assert.equal(selectHTNPlan({ food: 10 }, [methods[0]], transition), null);
});

test('HTN rejects domains exceeding the bounded method or step budget before projecting', () => {
  const transition = () => { throw new Error('must not project an invalid domain'); };
  assert.throws(() => selectHTNPlan({}, Array.from({ length: 13 }, (_, n) => ({ id: String(n), steps: ['wait'] })), transition), /12/);
  assert.throws(() => selectHTNPlan({}, [{ id: 'deep', steps: ['a', 'b', 'c', 'd'] }], transition), /3/);
  assert.throws(() => selectHTNPlan({}, [{ id: 'empty', steps: [] }], transition), /step/i);
  assert.throws(() => selectHTNPlan({}, [{ id: 'same', steps: ['a'] }, { id: 'same', steps: ['b'] }], transition), /unique/i);
  assert.equal(selectHTNPlan({}, [], transition), null);
});
