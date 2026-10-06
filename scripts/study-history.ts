import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseWorldSettings, type WorldBundle, type WorldSettings } from '../shared/generated-world.ts';
import { createSimulationHost, type SimulationReport } from '../server/simulation-host.ts';
import { ERA_NAMES, RIVER_TIERS } from '../shared/simulation.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Headless history study (VISION.md "Headless study"). Each seed's world comes through the lab's path
 * (generateWorld → encodeGeneratedWorld → the simulation worker's manifest/tile validation → region derivation) and
 * runs in the same dedicated simulation worker the host uses, so timings are measured through the real worker path.
 *
 *   npm run study:history -- --seed Chronicle --years 3000
 *   npm run study:history -- --all --years 3000 --out .chronicle/studies/m0
 */
const STUDY_SEEDS = ['Chronicle', 'Elsewhere', 'Atlas', 'Verdant', 'Aster'] as const;

interface Stats { year: number; [metric: string]: number }
interface SeedResult { seed: string; settings: WorldSettings; report: SimulationReport; wallMs: number; setupMs: number }

const { values } = parseArgs({
  options: {
    seed: { type: 'string', multiple: true }, all: { type: 'boolean', default: false },
    years: { type: 'string', default: '3000' }, size: { type: 'string', default: 'large' },
    out: { type: 'string', default: '.chronicle/studies/latest' }, events: { type: 'boolean', default: true },
  },
});
const seeds = values.all ? [...STUDY_SEEDS] : values.seed?.length ? values.seed : ['Chronicle'];
const years = Number(values.years);
if (!Number.isInteger(years) || years < 1 || years > 5000) throw new Error('--years must be an integer from 1 to 5000.');
await mkdir(values.out, { recursive: true });

const bundles = new Map<string, WorldBundle>();
const host = createSimulationHost({
  loadWorld: async settings => {
    const bundle = bundles.get(settings.seed);
    if (!bundle) throw new Error(`No study world for ${settings.seed}.`);
    return bundle;
  },
  maxInstances: seeds.length, requestTimeoutMs: 600_000,
});
const results: SeedResult[] = [];
try {
  // Geography is generated one seed at a time; the simulations then run in parallel workers.
  for (const seed of seeds) {
    const settings = parseWorldSettings({ seed, size: values.size });
    const started = performance.now();
    bundles.set(seed, encodeGeneratedWorld(await generateWorld(settings)));
    console.log(`${seed}: geography ready in ${Math.round(performance.now() - started)} ms`);
  }
  results.push(...await Promise.all(seeds.map(async seed => {
    const settings = parseWorldSettings({ seed, size: values.size });
    const setupStarted = performance.now();
    const simulation = await host.attach(settings);
    const setupMs = performance.now() - setupStarted;
    const started = performance.now();
    await simulation.runTo(years);
    const wallMs = performance.now() - started;
    const report = await simulation.report(values.events);
    console.log(`${seed}: ${years} years in ${(wallMs / 1000).toFixed(1)} s (${(wallMs / years).toFixed(2)} ms/year), ${report.eventCount} events, hash ${report.eventLogHash}`);
    return { seed, settings, report, wallMs, setupMs };
  })));
} finally {
  await host.close();
}

for (const result of results) {
  const directory = join(values.out, result.seed);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'stats.json'), `${JSON.stringify(result.report.stats, null, 1)}\n`);
  await writeFile(join(directory, 'knowledge.json'), `${JSON.stringify(result.report.knowledge, null, 1)}\n`);
  await writeFile(join(directory, 'series.json'), `${JSON.stringify(result.report.series)}\n`);
  await writeFile(join(directory, 'timing.json'), `${JSON.stringify({ wallMs: result.wallMs, setupMs: result.setupMs, years, systems: result.report.timing }, null, 1)}\n`);
  if (result.report.events) await writeFile(join(directory, 'events.jsonl'), result.report.events.map(event => JSON.stringify(event)).join('\n') + (result.report.events.length ? '\n' : ''));
}
const summary = storyHealth(results);
await writeFile(join(values.out, 'story-health.md'), summary);
for (const [metric, label, column] of [['population', 'World population', 1], ['polities', 'Polities (tribes and civilizations)', 2]] as const) {
  await writeFile(join(values.out, `${metric}.svg`), chart(label, results.map(result => ({ name: result.seed, points: result.report.series.filter(point => point[0] % 10 === 0).map(point => [point[0], point[column]] as const) }))));
}
await writeFile(join(values.out, 'largestShare.svg'), chart('Largest polity share', results.map(result => ({ name: result.seed, points: (result.report.stats as Stats[]).map(row => [row.year, row.largestShare] as const) }))));
console.log(`\n${summary}\nWrote ${values.out}`);

/** The brief's story-health table: per seed and century, plus per-system timing per simulated year. */
function storyHealth(rows: SeedResult[]) {
  const lines = ['| Seed | Year | Polities | Tribes | Bands | Civs | Settlements | Population | Specialists | Know Agriculture | Leading era | Occupied regions | Most regions in one polity | Largest share | Water-region population share (land share) | Moves | Splits (broke away) | First contacts | Regions a civilization knows | Famine deaths | Events |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const result of rows) for (const stats of result.report.stats as Stats[]) {
    if (stats.year > 1000 && stats.year % 500 !== 0) continue;
    lines.push(`| ${result.seed} | ${stats.year} | ${stats.polities} | ${stats.tribes} | ${stats.bands} | ${stats.civs} | ${stats.settlements} | ${stats.population.toLocaleString('en')} | ${stats.specialists.toLocaleString('en')} | ${Math.round(stats.agricultureShare * 100)}% | ${ERA_NAMES[stats.leadingEra]} | ${stats.occupiedRegions} | ${stats.largestRegions} | ${(stats.largestShare * 100).toFixed(1)}% | ${(stats.waterPopulationShare * 100).toFixed(0)}% (${(stats.waterRegionShare * 100).toFixed(0)}%) | ${stats.bandMoves} | ${stats.bandSplits} (${stats.bandBreakaways}) | ${stats.firstContacts} | ${stats.civKnownRegions} | ${stats.famineDeaths.toLocaleString('en')} | ${stats.events} |`);
  }
  // M2 acceptance (VISION.md): where and when Agriculture began, and world growth around the year a quarter of the
  // world's people lived in polities that knew it.
  lines.push('', '| Seed | First Agriculture (year) | Region: top-quartile farming, river tier, open lake | A quarter of people know it (year) | Growth 300 years before → after | After ÷ before | Plateau windows (first 1,000 years) | Eras first reached |',
    '| --- | ---: | --- | ---: | --- | ---: | --- | --- |');
  for (const result of rows) {
    const { knowledge, series } = result.report, agriculture = knowledge.agriculture;
    const population = (year: number) => series.find(point => point[0] === year)?.[1];
    const rate = (from: number, to: number) => { const a = population(from), b = population(to); return a && b ? (b / a) ** (1 / (to - from)) - 1 : null; };
    const quarter = Math.floor(knowledge.agricultureQuarterYear);
    const before = quarter > 0 ? rate(Math.max(0, quarter - 300), quarter) : null, after = quarter > 0 ? rate(quarter, quarter + 300) : null;
    const growth = before === null || after === null ? '—' : `${(before * 100).toFixed(2)} → ${(after * 100).toFixed(2)} %/yr`;
    const factor = before === null || after === null ? '—' : before <= 0 ? (after >= 0.001 ? 'earlier ≤ 0, later ≥ 0.1%' : 'fails') : (after / before).toFixed(1);
    lines.push(`| ${result.seed} | ${agriculture ? agriculture.year.toFixed(0) : 'not yet'} | ${agriculture ? `${agriculture.topQuartile ? 'yes' : 'no'}, ${RIVER_TIERS[agriculture.riverTier]}, ${agriculture.openLake ? 'yes' : 'no'}` : '—'} | ${quarter > 0 ? quarter : '—'} | ${growth} | ${factor} | ${plateaus(series).join(', ') || 'none'} | ${knowledge.eras.map(entry => `${entry.era} ${Math.round(entry.year)}`).join(', ')} |`);
  }
  // M3 acceptance (VISION.md): settled civilizations at 1,000, borders along barriers, first contact, expansion gaps.
  lines.push('', '| Seed | Civilizations at 1,000 (10–60) | Border ratio against civilization land at 1,000 / 3,000 (M3: > 1.0) · against all land at 1,000 / 3,000 (M6: ≥ 1.5 by 3,000) | First contacts by 1,000 | Longest gap between expansions, median / max (years) | By 1,000: tribes joined · unions · expansions · bands taken in · bands moved on · expeditions · migrants | Unrest at 1,000: regions (outbreaks so far) · mean stability |',
    '| --- | ---: | --- | ---: | --- | --- | --- |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[], at = (year: number) => stats.find(row => row.year === year);
    const y1000 = at(1000), y3000 = at(3000), gaps = [...result.report.politics.longestExpansionGaps].sort((a, b) => a - b);
    const gap = gaps.length ? `${gaps[Math.floor(gaps.length / 2)]} / ${gaps[gaps.length - 1]}` : '—';
    lines.push(`| ${result.seed} | ${y1000?.civs ?? '—'} | ${y1000?.borderRatio ?? '—'} / ${y3000?.borderRatio ?? '—'} · ${y1000?.borderRatioAll ?? '—'} / ${y3000?.borderRatioAll ?? '—'} | ${y1000?.firstContacts ?? '—'} | ${gap} | ${y1000 ? `${y1000.joined} · ${y1000.unions} · ${y1000.expansions} · ${y1000.absorbed} · ${y1000.displaced} · ${y1000.expeditions} · ${y1000.migrants.toLocaleString('en')}` : '—'} | ${y1000 ? `${y1000.unrestRegions} (${y1000.unrestOutbreaks}) · ${y1000.meanStability}` : '—'} |`);
  }
  // Research paths (VISION.md "Paths, not a timeline", M3 acceptance added after the M3 review): independent
  // inventions of Agriculture, the civilizations' eras and how much they differ in what they know, and exchanges.
  lines.push('', '| Seed | Agriculture invented independently by 1,000 / 3,000 | Polities knowing Agriculture at 700 / 1,000 | Civilization eras at 1,000 / 2,000 / 3,000 | Fewest–most techs a civilization knows at 1,000 / 2,000 / 3,000 | Exchanges agreed (with tribes) of offered, by 1,000 / 3,000 |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[], at = (year: number) => stats.find(row => row.year === year);
    const show = (years: number[], value: (row: Stats) => string | number) => years.map(year => { const row = at(year); return row ? value(row) : '—'; }).join(' / ');
    lines.push(`| ${result.seed} | ${show([1000, 3000], row => row.agricultureInventions)} | ${show([700, 1000], row => `${Math.round(row.agricultureShare * 100)}%`)} | ${show([1000, 2000, 3000], row => row.civEras)} | ${show([1000, 2000, 3000], row => `${row.civTechsMin}–${row.civTechsMax}`)} | ${show([1000, 3000], row => `${row.exchanges} (${row.tribeExchanges}) of ${row.exchangeOffers}`)} |`);
  }
  // M3b acceptance (VISION.md): settlements by water or a resource site, and the tiers they reach.
  lines.push('', '| Seed | Settlements by water or a site at 1,000 / 2,000 / 3,000 (M3b: ≥ 80%) | Villages · towns · cities · metropolises at 1,000 | at 1,500 | at 3,000 | Founded by growth · ruins resettled · tier changes |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[], at = (year: number) => stats.find(row => row.year === year), m = result.report.metrics;
    const tiers = (year: number) => { const row = at(year); return row ? `${row.villages} · ${row.towns} · ${row.cities} · ${row.metropolises}` : '—'; };
    lines.push(`| ${result.seed} | ${[1000, 2000, 3000].map(year => { const row = at(year); return row ? `${Math.round(row.settlementsByWater * 100)}%` : '—'; }).join(' / ')} | ${tiers(1000)} | ${tiers(1500)} | ${tiers(3000)} | ${m.settlementsGrown} · ${m.ruinsResettled} · ${m.tierChanges} |`);
  }
  // M3b: wealth and buildings (VISION.md "Buildings", "Wealth").
  lines.push('', '| Seed | Standing buildings at 1,000 / 2,000 / 3,000 | Completed · lost to unpaid upkeep by 3,000 | Completed by type by 3,000 | Treasuries at 1,000 / 3,000 |', '| --- | --- | --- | --- | --- |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[], at = (year: number) => stats.find(row => row.year === year), m = result.report.metrics;
    const byType = new Map<string, number>();
    for (const event of (result.report.events ?? []) as { type: string; data: Record<string, unknown> }[]) if (event.type === 'buildingCompleted') byType.set(String(event.data.building), (byType.get(String(event.data.building)) ?? 0) + 1);
    lines.push(`| ${result.seed} | ${[1000, 2000, 3000].map(year => at(year)?.buildings ?? '—').join(' / ')} | ${m.buildingsCompleted} · ${m.buildingsLost} | ${[...byType].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(', ') || '—'} | ${[1000, 3000].map(year => at(year)?.wealth.toLocaleString('en') ?? '—').join(' / ')} |`);
  }
  // M3b acceptance (VISION.md): at least one wonder completed by year 2,500 in most seeds.
  lines.push('', '| Seed | Wonders completed by 2,500 (M3b: ≥ 1 in most seeds) | Wonders completed, by year | Destroyed · abandoned by 3,000 |', '| --- | ---: | --- | --- |');
  for (const result of rows) {
    const done = ((result.report.events ?? []) as { type: string; tick: number; data: Record<string, unknown> }[]).filter(event => event.type === 'wonderCompleted');
    lines.push(`| ${result.seed} | ${done.filter(event => event.tick <= 2500 * 12).length} | ${done.map(event => `${event.data.wonder} ${Math.floor(event.tick / 12)} (${event.data.civ})`).join(', ') || '—'} | ${result.report.metrics.wondersDestroyed} · ${result.report.metrics.wondersAbandoned} |`);
  }
  // Story health: the decision mix per century (share of decision steps by chosen action).
  lines.push('', '| Seed | Century ending | Decision steps | Expand | Explore | Unite | Share knowledge | Build | Do nothing |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[];
    for (let at = 1; at < stats.length; at++) {
      const row = stats[at], previous = stats[at - 1];
      if (row.year > 1000 && row.year % 500 !== 0) continue;
      const expand = row.chosenExpand - previous.chosenExpand, explore = row.chosenExplore - previous.chosenExplore, nothing = row.chosenNothing - previous.chosenNothing;
      const unite = (row.chosenUnite ?? 0) - (previous.chosenUnite ?? 0), sharing = (row.chosenShare ?? 0) - (previous.chosenShare ?? 0), building = (row.chosenBuild ?? 0) - (previous.chosenBuild ?? 0);
      const total = expand + explore + unite + sharing + building + nothing;
      if (!total) continue;
      const share = (count: number) => `${(count / total * 100).toFixed(1)}%`;
      lines.push(`| ${result.seed} | ${row.year} | ${total.toLocaleString('en')} | ${share(expand)} | ${share(explore)} | ${share(unite)} | ${share(sharing)} | ${share(building)} | ${share(nothing)} |`);
    }
  }
  // M1 acceptance (VISION.md), read from the same run.
  lines.push('', '| Seed | Occupied habitable land, least-settled starting landmass (years 300 / 500 / 700 / 1000) |', '| --- | --- |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[];
    lines.push(`| ${result.seed} | ${[300, 500, 700, 1000].map(year => { const row = stats.find(entry => entry.year === year); return row ? `${Math.round(row.occupiedHabitableShare * 100)}%` : '—'; }).join(' / ')} |`);
  }
  lines.push('', '| Seed | Population ×(0→500) | Grows 0→500 | Bands ×(0→500) | Occupied ×(0→500) | Silent band-years | Longest stay above 1.1× capacity (months) | Moves citing depletion or pressure (led by them) | Water population ÷ water land (year 500) |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of rows) {
    const stats = result.report.stats as Stats[], start = stats.find(row => row.year === 0), at500 = stats.find(row => row.year === 500), m = result.report.metrics;
    if (!start || !at500) continue;
    const ratio = (a: number, b: number) => b > 0 ? (a / b).toFixed(1) : '—';
    lines.push(`| ${result.seed} | ${ratio(at500.population, start.population)} | ${at500.population > start.population ? 'yes' : 'no'} | ${ratio(at500.bands, start.bands)} | ${ratio(at500.occupiedRegions, start.occupiedRegions)} | ${m.silentBandYears} | ${m.maxOverCapacityMonths} | ${m.moves ? `${Math.round(m.movesCitingPressure / m.moves * 100)}% of ${m.moves} (${Math.round(m.movesLedByPressure / m.moves * 100)}%)` : '—'} | ${at500.waterRegionShare > 0 ? (at500.waterPopulationShare / at500.waterRegionShare).toFixed(2) : '—'} |`);
  }
  lines.push('', '| Seed | Regions | Islands | Landmasses | Outside range | Area p5 / p50 / p95 km² | Coastal | River ≥ river | Great river | Open lake |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |');
  for (const result of rows) {
    const p = result.report.partition;
    lines.push(`| ${result.seed} | ${p.regions} | ${p.islands} | ${p.landmasses} | ${p.outsideRange} | ${p.areaP5} / ${p.areaP50} / ${p.areaP95} | ${p.coastal} | ${p.river} | ${p.greatRiver} | ${p.openLake} |`);
  }
  lines.push('', '| Seed | Setup ms | ms per simulated year | Slowest systems (ms total) | State hash |', '| --- | ---: | ---: | --- | --- |');
  for (const result of rows) {
    const slowest = [...result.report.timing].sort((a, b) => b.ms - a.ms).slice(0, 3).map(entry => `${entry.system} ${entry.ms.toFixed(0)}`).join(', ');
    lines.push(`| ${result.seed} | ${Math.round(result.setupMs)} | ${(result.wallMs / years).toFixed(2)} | ${slowest} | \`${result.report.stateHash}\` |`);
  }
  return `${lines.join('\n')}\n`;
}

/** 300-year windows in the first 1,000 years where polity count and world population both stay within ±5% (VISION.md "Plateau"). */
function plateaus(series: [number, number, number][]) {
  const at = new Map(series.map(point => [point[0], point]));
  const found: string[] = [];
  for (let end = 300; end <= 1000; end += 10) {
    const a = at.get(end - 300), b = at.get(end);
    if (!a || !b || !a[1] || !a[2]) continue;
    if (Math.abs(b[1] / a[1] - 1) <= 0.05 && Math.abs(b[2] / a[2] - 1) <= 0.05) found.push(`${end - 300}–${end}`);
  }
  return found;
}

/** A small dependency-free SVG line chart with one line per seed. */
function chart(title: string, series: { name: string; points: (readonly [number, number])[] }[]) {
  const width = 720, height = 360, left = 70, right = 140, top = 40, bottom = 40;
  const xs = series.flatMap(line => line.points.map(point => point[0])), ys = series.flatMap(line => line.points.map(point => point[1]));
  const maxX = Math.max(1, ...xs), maxY = Math.max(1e-9, ...ys);
  const x = (value: number) => left + value / maxX * (width - left - right);
  const y = (value: number) => height - bottom - value / maxY * (height - top - bottom);
  const colors = ['#2a6f97', '#c05746', '#6a994e', '#8e5ea2', '#d4a017'];
  const format = (value: number) => maxY <= 1 ? `${(value * 100).toFixed(0)}%` : Math.round(value).toLocaleString('en');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => `<line x1="${left}" x2="${width - right}" y1="${y(maxY * fraction)}" y2="${y(maxY * fraction)}" stroke="#ddd"/><text x="${left - 6}" y="${y(maxY * fraction) + 4}" text-anchor="end" font-size="11">${format(maxY * fraction)}</text>`).join('');
  const lines = series.map((line, index) => `<polyline fill="none" stroke="${colors[index % colors.length]}" stroke-width="2" points="${line.points.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(' ')}"/><text x="${width - right + 10}" y="${top + 16 * index + 10}" font-size="12" fill="${colors[index % colors.length]}">${line.name}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif"><rect width="100%" height="100%" fill="#fff"/><text x="${left}" y="24" font-size="15" font-weight="600">${title}</text>${ticks}<line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#333"/><text x="${left}" y="${height - 14}" font-size="11">Year 0</text><text x="${width - right}" y="${height - 14}" font-size="11" text-anchor="end">Year ${maxX}</text>${lines}</svg>\n`;
}
