import { DEVELOPMENT_LABELS, developmentEffects, type CountryDevelopment as Development } from '../../shared/country-development.ts';

const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

/** Show the host's funded work and the same completed modifiers used by its economy. */
export function CountryDevelopment({ development }: { development: Development }) {
  const effects = developmentEffects(development), { budget } = development;
  return <section className="country-development" aria-label="Country investment">
    <h3>Country investment</h3>
    <dl className="world-water-facts">
      <div><dt>Food gathering level</dt><dd data-food-level>{development.foodLevel}</dd></div>
      <div><dt>Logistics level</dt><dd data-logistics-level>{development.logisticsLevel}</dd></div>
      <div><dt>Gathering improvement</dt><dd data-food-effect>{format((effects.foodMultiplier - 1) * 100)}%</dd></div>
      <div><dt>Effective travel reach</dt><dd data-logistics-effect>×{format(effects.reachMultiplier)}</dd></div>
      <div><dt>Sparse claim support</dt><dd>{format(effects.supportMultiplier * 100)}% of base terrain effort</dd></div>
    </dl>
    <p className="atlas-panel-note">Completed food investment improves gathering on usable owned land. Logistics improves access and lowers sparse claim support effort. Land, workers and food still limit actual output.</p>
    <h4>Shared project budget</h4>
    <dl className="world-water-facts">
      <div><dt>Reserved food</dt><dd data-reserved-food>{format(budget.reservedFood)}</dd></div>
      <div><dt>Reserved workers</dt><dd data-reserved-workers>{format(budget.reservedWorkers)}</dd></div>
      <div><dt>Food after safety reserve</dt><dd data-available-food>{format(budget.availableFood)}</dd></div>
      <div><dt>Workers outside projects</dt><dd data-available-workers>{format(budget.availableWorkers)}</dd></div>
      <div><dt>Active projects / capacity</dt><dd>{development.projects.length} / {budget.projectSlots}</dd></div>
      <div><dt>Investment food paid</dt><dd data-investment-spent>{format(development.investmentSpent)}</dd></div>
      <div><dt>Project work performed</dt><dd data-project-worker-days>{format(development.workerDays)}</dd></div>
      <div><dt>Completed / cancelled</dt><dd>{development.completedProjects} / {development.cancelledProjects}</dd></div>
    </dl>
    <p className="atlas-panel-note">Food reservations stay in stores until completion and are paid once. Food after the safety reserve excludes all reservations and seven days of consumption. Workers outside support and projects also gather food; further work must cover food production and the country's reserve target.</p>
    <p className="atlas-panel-note">Project work is measured in worker-days, including work on cancelled projects. Cancelling releases unspent reservations; it does not restore time already worked.</p>
    {development.projects.length === 0 ? <p className="atlas-panel-note" data-no-projects>{budget.projectSlots === 0 ? 'No active projects remain after collapse.' : 'No funded projects. The country evaluates affordable work when time advances.'}</p>
      : <ul className="country-projects">{development.projects.map(project => {
        const start = development.history.find(event => event.projectId === project.id && event.event === 'started');
        return <li key={project.id} data-country-project={project.id}>
          <div className="settlement-title"><strong>{DEVELOPMENT_LABELS[project.kind]}</strong><span>{project.targetCellId === null ? `Level ${project.level}` : `Cell ${project.targetCellId}`}</span></div>
          <p className="atlas-panel-note">{format(project.cost)} food · {project.workers} workers · Started day {project.startedDay + 1}</p>
          <progress aria-label={`${DEVELOPMENT_LABELS[project.kind]} progress`} value={project.progress} max={project.duration} />
          <p className="country-project-progress">{project.progress} / {project.duration} days</p>
          {start && <p className="settlement-decision">{start.message}</p>}
        </li>;
      })}</ul>}
    {development.history.length > 0 && <details className="settlement-history">
      <summary>Recent investment and claim projects</summary>
      <ol>{[...development.history].reverse().map((event, index) => <li key={`${event.projectId}-${event.event}-${index}`}>
        <span>Day {event.day + 1} · {DEVELOPMENT_LABELS[event.kind]} · {event.event}</span> {event.message}
      </li>)}</ol>
    </details>}
  </section>;
}
