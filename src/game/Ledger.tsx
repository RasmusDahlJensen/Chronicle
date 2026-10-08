import { useMemo, useState } from 'react';
import { ERA_NAMES, SETTLEMENT_TIERS, type ObserverFrame } from '../../shared/simulation.ts';
import { AGREEMENT_NAMES } from '../observer/labels.ts';
import { cssColor, cultureColor, faithColor, polityColor, TREATY_COLORS } from '../observer/palettes.ts';
import type { RegionData } from '../observer/useWorldMap.ts';
import { people } from './RealmPanel.tsx';

const number = new Intl.NumberFormat('en');
type Civ = ObserverFrame['civList'][number];

/**
 * The ledger (U.4; the "Observatory" direction): the world over time, the table of realms and the treaty web, from the
 * frame. Choosing a realm returns to the map at its capital.
 */
export function Ledger({ frame, regions, width, height, onChoose }: { frame: ObserverFrame; regions: RegionData | null; width: number; height: number; onChoose: (cell: number, civ: number) => void }) {
  return <section className="game-ledger-view" aria-label="Ledger">
    <div className="game-ledger-charts">
      <PeopleChart frame={frame} />
      <PowersChart frame={frame} />
      <CountsChart frame={frame} />
    </div>
    <RealmTable civs={frame.civList} total={frame.civs} onChoose={onChoose} />
    <div className="game-ledger-charts">
      <WorldNow frame={frame} />
      <Wonders frame={frame} />
      <Peoples frame={frame} />
    </div>
    <TreatyWeb frame={frame} regions={regions} width={width} height={height} onChoose={onChoose} />
  </section>;
}

const CHART = { width: 640, height: 200, left: 56, right: 12, top: 18, bottom: 22 } as const;
interface Line { key: string; name: string; color: string; points: [number, number][]; width?: number }

/** A line chart over the years 0–now, with the ages marked. */
function Chart({ label, lines, ages, year }: { label: string; lines: Line[]; ages: ObserverFrame['ages']; year: number }) {
  const top = Math.max(1, ...lines.flatMap(line => line.points.map(point => point[1])));
  const x = (at: number) => CHART.left + at / Math.max(1, year) * (CHART.width - CHART.left - CHART.right);
  const y = (value: number) => CHART.height - CHART.bottom - value / top * (CHART.height - CHART.top - CHART.bottom);
  return <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={label} className="game-chart">
    <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(0)} y2={y(0)} className="game-chart-axis" />
    <text x={CHART.left - 6} y={y(top) + 4} textAnchor="end" className="game-chart-label">{people(top)}</text>
    <text x={CHART.left - 6} y={y(0)} textAnchor="end" className="game-chart-label">0</text>
    {[0, Math.round(year / 2), year].map((at, index) => <text key={index} x={x(at)} y={CHART.height - 6} textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'} className="game-chart-label">{number.format(at)}</text>)}
    {ages.map(age => <g key={age.era}><line x1={x(age.year)} x2={x(age.year)} y1={CHART.top} y2={y(0)} className="game-chart-age" /><text x={x(age.year) + 3} y={CHART.top - 4} className="game-chart-label">{ERA_NAMES[age.era]}</text></g>)}
    {lines.map(line => line.points.length > 1 && <polyline key={line.key} points={line.points.map(([at, value]) => `${x(at).toFixed(1)},${y(value).toFixed(1)}`).join(' ')} fill="none" stroke={line.color} strokeWidth={line.width ?? 1.5} />)}
  </svg>;
}

function Legend({ lines }: { lines: Line[] }) {
  return <ul className="game-chart-legend">{lines.map(line => <li key={line.key}><span className="game-swatch" style={{ backgroundColor: line.color }} aria-hidden="true" />{line.name}</li>)}</ul>;
}

/** The world's people year by year. */
function PeopleChart({ frame }: { frame: ObserverFrame }) {
  const year = Math.floor(frame.tick / 12);
  const lines: Line[] = [{ key: 'world', name: 'The world', color: '#ece4d2', width: 2.5, points: frame.series.map(([at, population]) => [at, population]) }];
  return <figure className="game-ledger-card">
    <figcaption><h2>People</h2><span className="game-muted">The world's people, year by year</span></figcaption>
    <Chart label={`The world's people over ${number.format(year)} years: ${number.format(frame.population)} now`} lines={lines} ages={frame.ages} year={year} />
  </figure>;
}

/** The largest realms' people from their census, each from its first census as a civilization. */
function PowersChart({ frame }: { frame: ObserverFrame }) {
  const year = Math.floor(frame.tick / 12), names = new Map(frame.civList.map(civ => [civ.id, civ.name]));
  const lines: Line[] = frame.census.ids.map((id, index) => ({
    key: String(id), name: `The ${names.get(id) ?? '?'}`, color: cssColor(polityColor(id)),
    points: frame.census.years.map((at, step): [number, number] => [at, frame.census.people[index][step]]).filter(([, value], step, all) => value > 0 || all.slice(0, step).some(([, before]) => before > 0)),
  }));
  return <figure className="game-ledger-card">
    <figcaption><h2>The great powers</h2><span className="game-muted">The largest realms' people from their census (every ten years; fewer points over a long history), each since it became a civilization</span></figcaption>
    {lines.length ? <><Chart label={`The people of the ${lines.length} largest realms over time`} lines={lines} ages={frame.ages} year={year} /><Legend lines={lines} /></>
      : <p className="game-muted">No civilization has risen yet.</p>}
  </figure>;
}

/** Peoples (tribes and civilizations) and civilizations over time. */
function CountsChart({ frame }: { frame: ObserverFrame }) {
  const year = Math.floor(frame.tick / 12);
  const lines: Line[] = [
    { key: 'polities', name: 'Tribes and civilizations', color: '#aaa292', points: frame.series.map(([at, , polities]) => [at, polities]) },
    { key: 'civs', name: 'Civilizations', color: '#e2bd72', width: 2, points: frame.census.years.map((at, step): [number, number] => [at, frame.census.civs[step]]) },
  ];
  return <figure className="game-ledger-card">
    <figcaption><h2>Peoples and realms</h2><span className="game-muted">How many peoples live, and how many of them are civilizations</span></figcaption>
    <Chart label={`${number.format(frame.polities)} peoples, ${number.format(frame.civs)} of them civilizations, in year ${number.format(year)}`} lines={lines} ages={frame.ages} year={year} />
    <Legend lines={lines} />
  </figure>;
}

type Column = { key: keyof Civ; label: string; format: (civ: Civ) => string; numeric: boolean };
const COLUMNS: Column[] = [
  { key: 'name', label: 'Realm', format: civ => civ.name, numeric: false },
  { key: 'population', label: 'People', format: civ => people(civ.population), numeric: true },
  { key: 'regions', label: 'Regions', format: civ => number.format(civ.regions), numeric: true },
  { key: 'settlements', label: 'Settlements', format: civ => number.format(civ.settlements), numeric: true },
  { key: 'era', label: 'Era', format: civ => ERA_NAMES[civ.era], numeric: true },
  { key: 'culture', label: 'Culture', format: civ => civ.culture, numeric: false },
  { key: 'faith', label: 'Faith', format: civ => civ.faith ?? 'folk ways', numeric: false },
  { key: 'treasury', label: 'Treasury', format: civ => people(civ.treasury), numeric: true },
  { key: 'stability', label: 'Stability', format: civ => civ.stability.toFixed(2), numeric: true },
  { key: 'unrest', label: 'In unrest', format: civ => number.format(civ.unrest), numeric: true },
  { key: 'trade', label: 'Trade agreements', format: civ => number.format(civ.trade), numeric: true },
  { key: 'roads', label: 'Joint roads', format: civ => number.format(civ.roads), numeric: true },
  { key: 'pacts', label: 'Pacts', format: civ => number.format(civ.pacts), numeric: true },
  { key: 'allies', label: 'Allies', format: civ => number.format(civ.allies), numeric: true },
  { key: 'soldiers', label: 'Army', format: civ => people(civ.soldiers), numeric: true },
];

/** Every civilization (the 100 largest), sortable by any column. */
function RealmTable({ civs, total, onChoose }: { civs: Civ[]; total: number; onChoose: (cell: number, civ: number) => void }) {
  const [sort, setSort] = useState<{ key: keyof Civ; descending: boolean }>({ key: 'population', descending: true });
  const rows = useMemo(() => [...civs].sort((a, b) => {
    const x = a[sort.key] ?? '', y = b[sort.key] ?? '';
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return (sort.descending ? -order : order) || a.id - b.id;
  }), [civs, sort]);
  return <section className="game-ledger-card game-ledger-table" aria-label="Realms">
    <h2>Realms</h2>
    {total > civs.length && <p className="game-muted">The {number.format(civs.length)} largest of {number.format(total)} civilizations.</p>}
    {civs.length ? <div className="game-table-scroll"><table>
      <caption className="game-sr-only">Civilizations, sorted by {COLUMNS.find(column => column.key === sort.key)!.label.toLowerCase()}</caption>
      <thead><tr>{COLUMNS.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'} className={column.numeric ? 'game-numeric' : undefined}>
        <button type="button" onClick={() => setSort(current => ({ key: column.key, descending: current.key === column.key ? !current.descending : column.numeric }))}>{column.label}</button>
      </th>)}</tr></thead>
      <tbody>{rows.map(civ => <tr key={civ.id}>{COLUMNS.map(column => column.key === 'name'
        ? <th key="name" scope="row"><button type="button" onClick={() => onChoose(civ.capitalCell, civ.id)} title={`Show the ${civ.name} on the map`}>
          <span className="game-swatch" style={{ backgroundColor: cssColor(polityColor(civ.id)) }} aria-hidden="true" />{civ.name}</button></th>
        : <td key={column.key} className={column.numeric ? 'game-numeric' : undefined}>{column.format(civ)}</td>)}</tr>)}</tbody>
    </table></div> : <p className="game-muted">No civilization has risen yet.</p>}
  </section>;
}

const TIER_PLURALS = ['villages', 'towns', 'cities', 'metropolises'] as const;
const count = (value: number, one: string, many: string) => `${number.format(value)} ${value === 1 ? one : many}`;

/** The world now (U.7): its people, peoples and realms, settlements by tier and ruins, fields, roads and trade. */
function WorldNow({ frame }: { frame: ObserverFrame }) {
  const tiers = SETTLEMENT_TIERS.map((_, tier) => frame.settlements.tiers.filter(value => value === tier).length);
  const razed = frame.ruins.razed.filter(Boolean).length, bridges = frame.roads.bridges.filter(Boolean).length, bySea = frame.trades.sea.filter(Boolean).length;
  const fields = frame.fields.cells.reduce((sum, cells) => sum + cells, 0);
  return <section className="game-ledger-card" aria-label="The world now">
    <h2>The world now</h2>
    <dl className="game-facts" id="game-world-now">
      <div><dt>People</dt><dd>{people(frame.population)}{frame.specialists ? `, ${people(frame.specialists)} of them townspeople and specialists` : ''}</dd></div>
      <div><dt>Peoples</dt><dd>{count(frame.civs, 'civilization', 'civilizations')} and {count(frame.polities - frame.civs, 'tribe', 'tribes')} in {count(frame.markers.regions.length, 'region', 'regions')} of {number.format(frame.counters.regions)}</dd></div>
      <div><dt>Settlements</dt><dd>{tiers.some(Boolean) ? tiers.map((value, tier) => value ? count(value, SETTLEMENT_TIERS[tier], TIER_PLURALS[tier]) : '').filter(Boolean).reverse().join(' · ') : 'none yet'}{frame.ruins.cells.length ? ` · ${count(frame.ruins.cells.length, 'ruin', 'ruins')}${razed ? `, ${number.format(razed)} razed` : ''}` : ''}</dd></div>
      <div><dt>Fields</dt><dd>{fields ? `${count(fields, 'cell', 'cells')} of farmland cultivated in ${count(frame.fields.regions.length, 'region', 'regions')}` : 'none yet'}</dd></div>
      <div><dt>Roads</dt><dd>{frame.roads.a.length ? `${count(frame.roads.a.length, 'stretch', 'stretches')}${bridges ? `, ${count(bridges, 'bridge', 'bridges')}` : ''}` : 'none yet'}</dd></div>
      <div><dt>Trade</dt><dd>{frame.trades.from.length ? `${count(frame.trades.from.length, 'route', 'routes')} of trade agreements${bySea ? `, ${number.format(bySea)} by sea` : ''}` : 'no trade agreements yet'}</dd></div>
      <div><dt>Faiths</dt><dd>{count(frame.cultures.length, 'culture', 'cultures')} and {count(frame.religions.length, 'religion', 'religions')}</dd></div>
    </dl>
  </section>;
}

/** The wonders of the world (U.7): those standing, and those being built, with where and by whom. */
function Wonders({ frame }: { frame: ObserverFrame }) {
  const standing = frame.wonders.filter(wonder => wonder.built !== null), building = frame.wonders.filter(wonder => wonder.built === null);
  const line = (wonder: ObserverFrame['wonders'][number]) => <li key={`${wonder.name}-${wonder.city}`}><strong>{wonder.name[0].toUpperCase()}{wonder.name.slice(1)}</strong> <span className="game-muted">at {wonder.city}, of the {wonder.civ} · {wonder.built !== null ? `completed in year ${number.format(wonder.built)}` : `begun in year ${number.format(wonder.begun)}`}</span></li>;
  return <section className="game-ledger-card" aria-label="Wonders of the world">
    <h2>Wonders of the world</h2>
    {frame.wonders.length ? <>
      {standing.length > 0 && <ul className="game-list" id="game-wonders">{standing.map(line)}</ul>}
      {building.length > 0 && <><h3>Being built</h3><ul className="game-list">{building.map(line)}</ul></>}
    </> : <p className="game-muted">No wonder stands or is being built yet.</p>}
  </section>;
}

/** The largest cultures and the religions (U.7), with their regions and people. */
function Peoples({ frame }: { frame: ObserverFrame }) {
  return <section className="game-ledger-card" aria-label="Cultures and religions">
    <h2>Cultures and religions</h2>
    <table className="game-small-table" id="game-cultures"><caption className="game-sr-only">The largest cultures</caption>
      <thead><tr><th scope="col">Culture</th><th scope="col" className="game-numeric">Regions</th><th scope="col" className="game-numeric">People</th></tr></thead>
      <tbody>{frame.cultures.slice(0, 12).map(entry => <tr key={entry.id}><th scope="row"><span className="game-swatch" style={{ backgroundColor: cssColor(cultureColor(entry.hue, entry.id)) }} aria-hidden="true" /> {entry.name}{entry.parent ? <span className="game-muted"> · from the {entry.parent}</span> : null}</th>
        <td className="game-numeric">{number.format(entry.regions)}</td><td className="game-numeric">{people(entry.population)}</td></tr>)}</tbody>
    </table>
    {frame.cultures.length > 12 && <p className="game-muted">And {number.format(frame.cultures.length - 12)} more cultures.</p>}
    {frame.religions.length ? <table className="game-small-table" id="game-religions"><caption className="game-sr-only">The religions</caption>
      <thead><tr><th scope="col">Religion</th><th scope="col" className="game-numeric">Realms</th><th scope="col" className="game-numeric">Regions</th><th scope="col" className="game-numeric">People</th></tr></thead>
      <tbody>{frame.religions.slice(0, 12).map(entry => <tr key={entry.id}><th scope="row"><span className="game-swatch" style={{ backgroundColor: cssColor(faithColor(entry.hue)) }} aria-hidden="true" /> The {entry.name} faith</th>
        <td className="game-numeric">{number.format(entry.civs)}</td><td className="game-numeric">{number.format(entry.regions)}</td><td className="game-numeric">{people(entry.population)}</td></tr>)}</tbody>
    </table> : <p className="game-muted">No religion has been founded yet: every people keeps the folk ways of its culture.</p>}
    {frame.religions.length > 12 && <p className="game-muted">And {number.format(frame.religions.length - 12)} more religions.</p>}
  </section>;
}

const WEB_KINDS = ['alliance', 'nonAggression', 'trade', 'road'] as const;
const WEB_COUNTS: Record<typeof WEB_KINDS[number], [string, string]> = { alliance: ['alliance', 'alliances'], nonAggression: ['pact', 'pacts'], trade: ['pair trading', 'pairs trading'], road: ['joint road', 'joint roads'] };

/** The civilizations at their capitals, joined by their treaties; choosing one shows its own and names its partners. */
function TreatyWeb({ frame, regions, width, height, onChoose }: { frame: ObserverFrame; regions: RegionData | null; width: number; height: number; onChoose: (cell: number, civ: number) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  // The land (every region's centre) changes only with the world, not with each frame.
  const land = useMemo(() => regions && <g className="game-web-land">{regions.map.regions.map(region => <circle key={region.id} cx={region.centroid % width + 0.5} cy={Math.floor(region.centroid / width) + 0.5} r={1.6 * width / 512} />)}</g>, [regions, width]);
  const civs = new Map(frame.civList.map(civ => [civ.id, civ]));
  const at = (civ: Civ) => ({ x: civ.capitalCell % width + 0.5, y: Math.floor(civ.capitalCell / width) + 0.5 });
  const largest = Math.max(1, ...frame.civList.map(civ => civ.population)), scale = width / 512;
  const shown = frame.treaties.filter(treaty => civs.has(treaty.a) && civs.has(treaty.b));
  const focus = chosen !== null && civs.has(chosen) ? civs.get(chosen)! : null;
  const mine = focus ? shown.filter(treaty => treaty.a === focus.id || treaty.b === focus.id) : [];
  // An edge across the date line is drawn the short way round, in two parts.
  const segments = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    if (Math.abs(dx) <= width / 2) return [[from, to]];
    const shift = dx > 0 ? -width : width;
    return [[from, { x: to.x + shift, y: to.y }], [{ x: from.x - shift, y: from.y }, to]];
  };
  return <section className="game-ledger-card game-web" aria-label="Treaty web">
    <h2>The treaty web</h2>
    <p className="game-muted">The largest civilizations at their capitals, joined by their treaties now: {WEB_KINDS.map(kind => { const count = shown.filter(treaty => treaty.kind === kind).length; return `${number.format(count)} ${WEB_COUNTS[kind][count === 1 ? 0 : 1]}`; }).join(', ')}.</p>
    <ul className="game-chart-legend">{WEB_KINDS.map(kind => <li key={kind}><span className="game-swatch" style={{ backgroundColor: TREATY_COLORS[kind] }} aria-hidden="true" />{AGREEMENT_NAMES[kind]}</li>)}</ul>
    <label className="game-web-choose">Realm <select value={focus?.id ?? ''} onChange={event => setChosen(event.target.value === '' ? null : Number(event.target.value))}>
      <option value="">All realms</option>
      {frame.civList.map(civ => <option key={civ.id} value={civ.id}>The {civ.name}</option>)}
    </select></label>
    <svg viewBox={`0 0 ${width} ${height}`} className="game-web-map" role="img" aria-label={`Treaty web: ${count(shown.length, 'treaty', 'treaties')} between ${count(civs.size, 'civilization', 'civilizations')}`} data-treaties={shown.length}>
      <rect x={0} y={0} width={width} height={height} className="game-web-sea" />
      {land}
      {shown.map(treaty => segments(at(civs.get(treaty.a)!), at(civs.get(treaty.b)!)).map((part, index) => <line key={`${treaty.a}-${treaty.b}-${treaty.kind}-${index}`}
        x1={part[0].x} y1={part[0].y} x2={part[1].x} y2={part[1].y} stroke={TREATY_COLORS[treaty.kind]} strokeWidth={(treaty.kind === 'trade' ? 0.8 + Math.min(3, treaty.count) * 0.5 : 1.2) * scale}
        opacity={focus ? (treaty.a === focus.id || treaty.b === focus.id ? 1 : 0.12) : 0.7} />))}
      {frame.civList.map(civ => { const point = at(civ); return <circle key={civ.id} cx={point.x} cy={point.y} r={(2 + Math.sqrt(civ.population / largest) * 9) * scale}
        fill={cssColor(polityColor(civ.id))} stroke={focus?.id === civ.id ? '#f3d79c' : '#0b1116'} strokeWidth={(focus?.id === civ.id ? 2 : 0.8) * scale} className="game-web-node"
        onClick={() => setChosen(current => current === civ.id ? null : civ.id)}><title>The {civ.name}</title></circle>; })}
    </svg>
    {focus && <div className="game-web-partners" aria-live="polite">
      <h3>The {focus.name}</h3>
      {mine.length ? <ul>{WEB_KINDS.map(kind => { const partners = mine.filter(treaty => treaty.kind === kind).map(treaty => civs.get(treaty.a === focus.id ? treaty.b : treaty.a)!.name);
        return partners.length ? <li key={kind}><span className="game-swatch" style={{ backgroundColor: TREATY_COLORS[kind] }} aria-hidden="true" />{AGREEMENT_NAMES[kind]}: {partners.map(name => `the ${name}`).join(', ')}</li> : null; })}</ul>
        : <p className="game-muted">No treaties with the largest realms now.</p>}
      <button type="button" onClick={() => onChoose(focus.capitalCell, focus.id)}>Show the {focus.name} on the map</button>
    </div>}
  </section>;
}
