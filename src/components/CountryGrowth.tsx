import type { CountryGrowth as Growth } from '../../shared/country-growth.ts';
import type { CountryDevelopment } from '../../shared/country-development.ts';
import type { SimulationState } from '../../shared/simulation.ts';

const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
type Society = NonNullable<SimulationState['settlements']>;

/** Inspection reads the saved economy; it does not estimate production or run rules. */
export function CountryGrowth({
  country,
  society,
  development,
  cellAreaKm2,
  onLocate,
  mapAvailable,
}: {
  country: Growth;
  society: Society;
  development?: CountryDevelopment;
  cellAreaKm2: number;
  onLocate: (id: string) => void;
  mapAvailable: boolean;
}) {
  const capital = society.centers[0],
    metrics = country.metrics;
  const collapsed = capital.population === 0;
  return (
    <section className="country-growth" aria-label="Country growth">
      <h3>Country growth</h3>
      {collapsed && (
        <p className="settlement-shortfall" data-country-collapsed>
          Country collapsed. No people or active claims remain. The founding capital is retained in the saved history.
        </p>
      )}
      <dl className="world-water-facts">
        <div>
          <dt>Claimed land</dt>
          <dd data-country-claims>{country.territory.cells.length} cells</dd>
        </div>
        <div>
          <dt>Claimed area</dt>
          <dd>{format(country.territory.cells.length * cellAreaKm2)} km²</dd>
        </div>
        <div>
          <dt>Working land</dt>
          <dd data-working-cells>{capital.workingCells.length} cells</dd>
        </div>
        <div>
          <dt>Active capitals</dt>
          <dd data-center-count>{collapsed ? 0 : 1}</dd>
        </div>
        <div>
          <dt>Food reserves</dt>
          <dd data-food-reserves>{format(capital.food)}</dd>
        </div>
        <div>
          <dt>Reserve coverage</dt>
          <dd>{collapsed ? 'No population' : `${format(capital.food / capital.population)} days`}</dd>
        </div>
      </dl>
      <p className="atlas-panel-note">
        Country borders enclose owned land. Dashed cells around the selected capital show where people currently gather
        food. Claimed land needs continuing support, including land that is not worked.
      </p>
      <h4>Daily food &amp; population</h4>
      <dl className="world-water-facts">
        <div>
          <dt>Collected</dt>
          <dd>{format(capital.collected)}</dd>
        </div>
        <div>
          <dt>Consumed</dt>
          <dd>{format(capital.consumed)}</dd>
        </div>
        <div>
          <dt>Unmet food need</dt>
          <dd>{format(capital.shortfall)}</dd>
        </div>
        <div>
          <dt>Land food ceiling</dt>
          <dd>{format(metrics.foodCapacity)} / day</dd>
        </div>
        <div>
          <dt>Upkeep due</dt>
          <dd>{format(metrics.upkeepDue)}</dd>
        </div>
        <div>
          <dt>Upkeep paid</dt>
          <dd>{format(metrics.upkeepPaid)}</dd>
        </div>
        <div>
          <dt>Upkeep shortfall</dt>
          <dd>{format(metrics.upkeepShortfall)}</dd>
        </div>
        <div>
          <dt>Births</dt>
          <dd>{metrics.births}</dd>
        </div>
        <div>
          <dt>Natural deaths</dt>
          <dd>{metrics.naturalDeaths}</dd>
        </div>
        <div>
          <dt>Starvation deaths</dt>
          <dd>{metrics.starvationDeaths}</dd>
        </div>
      </dl>
      <p className="atlas-panel-note">
        Food is measured in person-days: one unit feeds one person for a day. The land food ceiling is before labor
        limits; actual collection depends on available gatherers and access.
      </p>
      <h4>Workforce today</h4>
      <dl className="world-water-facts" data-country-workforce>
        <div>
          <dt>Available workforce</dt>
          <dd>{metrics.workforce}</dd>
        </div>
        <div>
          <dt>Support required</dt>
          <dd>{metrics.supportRequired}</dd>
        </div>
        <div>
          <dt>Support assigned</dt>
          <dd>{metrics.supportWorkers}</dd>
        </div>
        <div>
          <dt>{development ? 'Project workers' : 'Claim crew'}</dt>
          <dd>{metrics.claimWorkers}</dd>
        </div>
        <div>
          <dt>Gatherers</dt>
          <dd>{metrics.gatheringWorkers}</dd>
        </div>
        <div>
          <dt>Idle workers</dt>
          <dd>{metrics.idleWorkers}</dd>
        </div>
        <div>
          <dt>Unsupported duration</dt>
          <dd>{country.unsupportedDays} days</dd>
        </div>
      </dl>
      <p className="atlas-panel-note">
        Sixty percent of people form an abstract labor budget. Support, {development ? 'project workers' : 'claim crews'}, gatherers and idle workers divide
        that budget. {development ? 'Project workers' : 'Claim crews'} are assigned people, not population spent.
      </p>
      <details>
        <summary>Accounting since founding</summary>
        <dl className="world-water-facts">
          <div>
            <dt>Starting population</dt>
            <dd>250</dd>
          </div>
          <div>
            <dt>Births</dt>
            <dd data-total-births>{format(country.births)}</dd>
          </div>
          <div>
            <dt>Natural deaths</dt>
            <dd data-total-natural-deaths>{format(country.naturalDeaths)}</dd>
          </div>
          <div>
            <dt>Starvation deaths</dt>
            <dd data-total-starvation-deaths>{format(country.starvationDeaths)}</dd>
          </div>
          <div>
            <dt>Food need</dt>
            <dd>{format(country.personDays)}</dd>
          </div>
          <div>
            <dt>Starting food</dt>
            <dd>7,500</dd>
          </div>
          <div>
            <dt>Collected</dt>
            <dd data-total-collected>{format(society.totalCollected)}</dd>
          </div>
          <div>
            <dt>Consumed</dt>
            <dd data-total-consumed>{format(society.totalConsumed)}</dd>
          </div>
          <div>
            <dt>Claim food spent</dt>
            <dd>{format(society.establishmentSpent)}</dd>
          </div>
          {development && <div>
            <dt>Investment food spent</dt>
            <dd data-total-investment-spent>{format(development.investmentSpent)}</dd>
          </div>}
          <div>
            <dt>Upkeep paid</dt>
            <dd data-total-upkeep-paid>{format(country.upkeepPaid)}</dd>
          </div>
          <div>
            <dt>Upkeep shortfall</dt>
            <dd>{format(country.upkeepShortfall)}</dd>
          </div>
          <div>
            <dt>Spoilage</dt>
            <dd data-total-spoilage>{format(country.spoilage)}</dd>
          </div>
          <div>
            <dt>Unmet food need</dt>
            <dd>{format(society.totalShortfall)}</dd>
          </div>
          <div>
            <dt>Initial claims</dt>
            <dd>{country.initialCells.length}</dd>
          </div>
          <div>
            <dt>Claims added</dt>
            <dd>{country.claimsAdded}</dd>
          </div>
          <div>
            <dt>Claims released</dt>
            <dd>{country.claimsReleased}</dd>
          </div>
        </dl>
      </details>
      <ul className="settlement-list">
        <li data-settlement-id={capital.id}>
          <div className="settlement-title">
            <strong>{capital.name}</strong>
            <span>{collapsed ? 'Former capital camp' : 'Capital camp'}</span>
          </div>
          <p className="atlas-panel-note">
            {capital.population} people · Founding cell {capital.cellId}
          </p>
          <p className="settlement-decision">{capital.decision}</p>
          <button type="button" disabled={!mapAvailable || collapsed} onClick={() => onLocate(capital.id)}>
            Locate {capital.name}
          </button>
        </li>
      </ul>
      {country.history.length > 0 && (
        <details className="settlement-history">
          <summary>Recent country growth</summary>
          <ol>
            {[...country.history].reverse().map((event, index) => (
              <li key={`${event.day}-${index}`}>
                <span>Day {event.day + 1}</span> {event.message}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
