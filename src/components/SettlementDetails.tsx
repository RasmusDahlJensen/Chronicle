import type { SimulationState } from '../../shared/simulation.ts';
import { COUNTRY_GOAL_LABELS, type CountryAI } from '../../shared/country-ai.ts';

type Society = NonNullable<SimulationState['settlements']>;
export type SettlementCenter = Society['centers'][number];
const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

export function CountryDecisions({ ai, society, countryGrowth = false, development = false }: { ai: CountryAI; society: Society; countryGrowth?: boolean; development?: boolean }) {
  const goalLabel = (goal: keyof typeof COUNTRY_GOAL_LABELS) => countryGrowth && goal === 'expand' ? 'Claim neighboring land' : COUNTRY_GOAL_LABELS[goal];
  const centerName = (id: string) => society.centers.find(center => center.id === id)?.name ?? id;
  return <section className="country-decisions" aria-label="Country decisions">
    <h3>Country decisions</h3>
    <dl className="world-water-facts">
      <div><dt>Reserve target</dt><dd>{ai.profile.reserveDays} days</dd></div>
      <div><dt>Commitment duration</dt><dd>{ai.profile.commitmentDays} days</dd></div>
      <div><dt>Expansion preference</dt><dd>{ai.profile.expansion}/100</dd></div>
      {!countryGrowth && <div><dt>Mobility preference</dt><dd>{ai.profile.mobility}/100</dd></div>}
    </dl>
    <p className="atlas-panel-note">{countryGrowth ? 'Expansion preference influences neighboring claims. Food reserves, available workers and continuing support determine whether a claim can proceed.' : 'Higher expansion and mobility preferences favor extending local presence and moving for food. Local food, people and access determine which projects are possible.'}</p>
    <p className="atlas-panel-note country-history-seed">History seed: <span>{ai.historySeed}</span></p>
    {ai.decisions.length === 0 ? <p className="atlas-panel-note">{countryGrowth ? society.centers[0].population === 0 ? 'No active commitments remain after collapse.' : development ? 'The capital evaluates its next investment, claim or reserve priority when time advances.' : 'The capital evaluates its next claim or reserve commitment when time advances.' : 'Communities evaluate their next commitment when time advances.'}</p>
      : <ul className="country-commitments">{ai.decisions.map(decision => <li key={decision.settlementId} data-country-decision={decision.settlementId}>
        <strong>{centerName(decision.settlementId)} · {goalLabel(decision.goal)}</strong>
        <p className="atlas-panel-note">Since day {decision.sinceDay + 1} · Review day {decision.reviewDay + 1}{decision.targetCellId !== null && ` · Target cell ${decision.targetCellId}`}</p>
        <p className="settlement-decision">{decision.reason}</p>
        {development ? <p className="atlas-panel-note">Strategic priority; project reservations and progress appear in Country investment.</p> : <p className="atlas-panel-note">Reserved locally: {format(decision.reservedFood)} food person-days · {decision.reservedPeople} people. {countryGrowth ? 'Food is paid on completion; the crew remains part of the population. Feasibility is checked daily.' : 'Reservations remain in this center’s stores and population until used.'}</p>}
        <details><summary>Alternatives considered</summary><p className="atlas-panel-note">{development ? 'At the last strategic review; shared project feasibility is checked daily.' : 'At the last review; commitments are checked daily.'}</p><ul className="country-alternatives">{decision.alternatives.map((alternative, index) => <li key={`${alternative.goal}-${alternative.targetCellId}-${index}`}>
          <strong>{goalLabel(alternative.goal)}</strong>
          <span>{alternative.eligible ? `Eligible · Score ${alternative.score}/100` : 'Unavailable'}{alternative.targetCellId !== null && ` · Cell ${alternative.targetCellId}`}</span>
          <p>{alternative.reason}</p>
        </li>)}</ul></details>
      </li>)}</ul>}
    {ai.history.length > 0 && <details className="country-history"><summary>Recent country decisions</summary><ol>{[...ai.history].reverse().map((event, index) => <li key={`${event.day}-${event.settlementId}-${index}`}><span>Day {event.day + 1} · {centerName(event.settlementId)} · {goalLabel(event.goal)}</span><p>{event.reason}</p></li>)}</ol></details>}
  </section>;
}

export function SettlementEconomy({ society, onLocate, mapAvailable }: {
  society: Society; onLocate: (id: string) => void; mapAvailable: boolean;
}) {
  const food = society.centers.reduce((sum, center) => sum + center.food, 0);
  const population = society.centers.reduce((sum, center) => sum + center.population, 0);
  const territory = new Set(society.centers.flatMap(center => center.territory));
  return <section className="settlement-economy" aria-label="Settlements and subsistence">
    <h3>Settlements &amp; subsistence</h3>
    <dl className="world-water-facts">
      <div><dt>Food reserves</dt><dd data-food-reserves>{format(food)}</dd></div>
      <div><dt>Reserve coverage</dt><dd>{format(food / population)} days</dd></div>
      <div><dt>Territory</dt><dd>{territory.size} cells</dd></div>
      <div><dt>Centers</dt><dd data-center-count>{society.centers.length}</dd></div>
    </dl>
    <p className="atlas-panel-note">Food is measured in person-days: one unit feeds one person for a day. Borders show maintained tribal territory.</p>
    <details><summary>Food accounting since beginning</summary><dl className="world-water-facts">
      <div><dt>Collected</dt><dd data-total-collected>{format(society.totalCollected)}</dd></div>
      <div><dt>Consumed</dt><dd data-total-consumed>{format(society.totalConsumed)}</dd></div>
      <div><dt>Establishment spent</dt><dd>{format(society.establishmentSpent)}</dd></div>
      <div><dt>Unmet food need</dt><dd>{format(society.totalShortfall)}</dd></div>
    </dl></details>
    <ul className="settlement-list">{society.centers.map(center => <li key={center.id} data-settlement-id={center.id}>
      <div className="settlement-title"><strong>{center.name}</strong><span>{center.id === society.mainSettlementId ? 'Main center' : 'Community'}</span></div>
      <p className="atlas-panel-note">{center.kind === 'camp' ? 'Mobile camp' : 'Established settlement'} · {center.population} people · {center.territory.length} territory cells</p>
      <p className="settlement-decision">{center.decision}</p>
      {center.shortfall > 0 && <p className="settlement-shortfall">Unmet need today: {format(center.shortfall)} person-days</p>}
      <button type="button" disabled={!mapAvailable} onClick={() => onLocate(center.id)}>Locate {center.name}</button>
    </li>)}</ul>
    {society.history.length > 0 && <details className="settlement-history"><summary>Recent settlement activity</summary><ol>{[...society.history].reverse().map((event, index) => <li key={`${event.day}-${index}`}><span>Day {event.day + 1}</span> {event.message}</li>)}</ol></details>}
  </section>;
}

export function SelectedSettlement({ center, main, color, countryGrowth = false }: { center: SettlementCenter; main: boolean; color: string; countryGrowth?: boolean }) {
  return <section className="selected-settlement" aria-label="Selected settlement" data-selected-settlement={center.id}>
    <p className="atlas-detail-label">{countryGrowth ? 'Capital camp' : `${main ? 'Main center' : 'Community'} · ${center.kind === 'camp' ? 'Mobile camp' : 'Established settlement'}`}</p>
    <h3>{center.name}</h3>
    <dl className="world-water-facts">
      <div><dt>Population</dt><dd>{center.population}</dd></div>
      <div><dt>Founded</dt><dd>Day {center.foundedDay + 1}</dd></div>
      <div><dt>Color</dt><dd>{color}</dd></div><div><dt>Camp cell</dt><dd>{center.cellId}</dd></div>
      <div><dt>Food reserves</dt><dd>{format(center.food)} person-days</dd></div>
      <div><dt>Collected today</dt><dd>{format(center.collected)}</dd></div>
      <div><dt>Consumed today</dt><dd>{format(center.consumed)}</dd></div>
      <div><dt>Working area</dt><dd>{center.workingCells.length} cells</dd></div>
      <div><dt>{countryGrowth ? 'Capital footprint' : 'Territory'}</dt><dd>{center.territory.length} cells</dd></div>
    </dl>
    <p className="settlement-decision">{center.decision}</p>
    <p className="atlas-panel-note">{countryGrowth ? 'Dashed cells show the capital’s working area within country claims. Its inhabited footprint is the capital cell; no formal province exists yet.' : 'Dashed cells show this center’s working area. It is distinct from territory; no formal province exists yet.'}</p>
  </section>;
}
