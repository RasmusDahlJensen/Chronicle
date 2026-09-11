import type { SimulationState } from '../../shared/simulation.ts';

type Society = NonNullable<SimulationState['settlements']>;
export type SettlementCenter = Society['centers'][number];
const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

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

export function SelectedSettlement({ center, main, color }: { center: SettlementCenter; main: boolean; color: string }) {
  return <section className="selected-settlement" aria-label="Selected settlement" data-selected-settlement={center.id}>
    <p className="atlas-detail-label">{main ? 'Main center' : 'Community'} · {center.kind === 'camp' ? 'Mobile camp' : 'Established settlement'}</p>
    <h3>{center.name}</h3>
    <dl className="world-water-facts">
      <div><dt>Population</dt><dd>{center.population}</dd></div>
      <div><dt>Founded</dt><dd>Day {center.foundedDay + 1}</dd></div>
      <div><dt>Color</dt><dd>{color}</dd></div><div><dt>Camp cell</dt><dd>{center.cellId}</dd></div>
      <div><dt>Food reserves</dt><dd>{format(center.food)} person-days</dd></div>
      <div><dt>Collected today</dt><dd>{format(center.collected)}</dd></div>
      <div><dt>Consumed today</dt><dd>{format(center.consumed)}</dd></div>
      <div><dt>Working area</dt><dd>{center.workingCells.length} cells</dd></div>
      <div><dt>Territory</dt><dd>{center.territory.length} cells</dd></div>
    </dl>
    <p className="settlement-decision">{center.decision}</p>
    <p className="atlas-panel-note">Dashed cells show this center’s working area. It is distinct from territory; no formal province exists yet.</p>
  </section>;
}
