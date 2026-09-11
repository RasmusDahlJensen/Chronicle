import type { PlannerStudyReport, StudyResult } from '../../scripts/planning/report-types.ts';

export const hostile = '</script><script>globalThis.reportInjected = 1</script><img src="https://invalid.example/image" onerror="globalThis.reportInjected = 2">';
/** Viewer-only measurements, deliberately small and explicit; no simulated outcomes. */
export function reportFixture(): PlannerStudyReport {
  const released: StudyResult = { policy: 'current', initialDay: 0, elapsedMs: 12, projections: 0, simulatedDays: 0, maxDecisionMs: 0,
    points: [
      { day: 0, population: 250, claims: 5, food: 7500, foodLevel: 0, logisticsLevel: 0, starvation: 0, projects: 0 },
      { day: 60, population: 251, claims: 7, food: 8000, foodLevel: 0, logisticsLevel: 0, starvation: 0, projects: 1 },
    ], decisions: [] };
  return { version: 1, generatedAt: '2026-09-11T12:00:00Z', library: 'Viewer fixture library', recommendation: hostile, scenarios: [
    { id: 'ordinary', label: 'Viewer fixture / fertile', description: 'Explicit report fixture; not a simulation study.', results: [released,
      { ...released, policy: 'Forecast planner', elapsedMs: 125, projections: 8, maxDecisionMs: 21, points: [released.points[0],
        { day: 60, population: 253, claims: 9, food: 6200, foodLevel: 1, logisticsLevel: 0, starvation: 0, projects: 2 }],
        decisions: [{ day: 30, plan: 'Improve gathering', reason: 'A measured alternative for this viewer fixture.', alternatives: [
          { plan: hostile, score: 8, minReserveDays: 9.5, netFood: 42, claims: 9, feasible: true },
          { plan: 'Wait', score: 2, minReserveDays: 20, netFood: -3, claims: 7, feasible: false },
        ] }, { day: 60, plan: 'Wait', reason: 'Preserve the current commitment.', alternatives: [] }] },
    ] },
    { id: 'hostile', label: hostile, description: hostile, results: [{ ...released, policy: hostile, initialDay: 100,
      points: [{ day: 100, population: 0, claims: 0, food: 0, foodLevel: 0, logisticsLevel: 0, starvation: 250, projects: 0 }] }] },
    { id: 'empty', label: 'No observations', description: 'A run with no recorded points.', results: [] },
  ] };
}
