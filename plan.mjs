export const townsToCounties = {
  Clonmel: ['Tipperary'], Fermoy: ['Cork'], Mallow: ['Cork'], Bandon: ['Cork'],
  Enniscorthy: ['Wexford'], Ennis: ['Clare'], Athlone: ['Westmeath', 'Roscommon'],
  'Carrick-on-Shannon': ['Leitrim', 'Roscommon']
};
const codes = { Tipperary:'EI26', Cork:'EI04', Wexford:'EI30', Clare:'EI03', Westmeath:'EI29', Leitrim:'EI14', Roscommon:'EI24' };
export const levels = ['Normal', 'Standby', 'Barriers'];
export const columns = 'town,county,river,crew_based_here,barrier_sets,pumps,sandbags,staff_on_call,flow_override_m3s,warning_override,notes'.split(',');

export function readSheet(csv, history) {
  const lines = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (ch === '\n') { lines.push(row); row = []; }
    } else value += ch;
  }
  if (quoted) throw Error('Team Sheet CSV contains an unclosed quote.');
  if (row.length || value) lines.push([...row, value.replace(/\r$/, '')]);
  if (lines.shift()?.join(',').replace(/^\uFEFF/, '') !== columns.join(',')) throw Error('Team Sheet headers differ from the brief.');
  const entries = lines.filter(row => row.some(Boolean)).map(row => {
    if (row.length !== columns.length) throw Error('Team Sheet row has the wrong number of columns.');
    return Object.fromEntries(columns.map((key, i) => [key, row[i].trim()]));
  });
  if (entries.length !== history.length || new Set(entries.map(e => e.town)).size !== history.length) throw Error('Team Sheet must contain eight unique towns.');
  return history.map(h => {
    const entry = entries.find(e => e.town === h.town);
    if (!entry || entry.county !== townsToCounties[h.town][0] || ![h.river, h.river.replace('Munster ', '')].includes(entry.river)) throw Error('Check town, county and river for ' + h.town);
    for (const field of ['barrier_sets','pumps','sandbags','staff_on_call']) {
      if (!/^\d+$/.test(entry[field]) || !Number.isSafeInteger(Number(entry[field]))) throw Error('Invalid ' + field + ' for ' + h.town);
      entry[field] = Number(entry[field]);
    }
    if (entry.flow_override_m3s && (!Number.isFinite(Number(entry.flow_override_m3s)) || Number(entry.flow_override_m3s) < 0)) throw Error('Invalid flow override for ' + h.town);
    entry.warning_override = entry.warning_override.toLowerCase();
    if (entry.warning_override && !['orange','red'].includes(entry.warning_override)) throw Error('Invalid warning override for ' + h.town);
    return entry;
  });
}

export function warningsFor(feed, town, now) {
  if (feed === null) return null;
  const regions = townsToCounties[town].map(county => codes[county]);
  return feed.filter(w => w.type === 'Rain' && w.status === 'Warning' &&
    Date.parse(w.expiry) > now && Date.parse(w.onset) <= now + 172800000 &&
    w.regions.some(code => regions.includes(code)));
}

export function plan(history, sheet, forecasts, feed, now) {
  const result = history.map((h, index) => {
    const entry = sheet[index], forecast = forecasts[index];
    const warning = warningsFor(feed, h.town, now);
    const flowOverride = entry.flow_override_m3s !== '';
    const peak = flowOverride ? Number(entry.flow_override_m3s) : forecast ? Math.max(...forecast.values) : null;
    const uplift = Boolean(entry.warning_override || warning?.some(w => ['orange','red'].includes(w.level)));
    const base = peak === null ? null : peak >= h.p99 ? 2 : peak >= h.p95 ? 1 : 0;
    const level = base === null ? null : Math.min(base + Number(uplift), 2);
    return { ...h, entry, forecast, warning, flowOverride, peak, uplift, base, level,
      priority: peak === null ? null : (peak / h.p99 - 1) * 100, crew: null };
  });
  const roster = {
    Clonmel: ['Clonmel','Fermoy','Enniscorthy'],
    Mallow: ['Mallow','Fermoy','Bandon'],
    Athlone: ['Athlone','Carrick-on-Shannon','Ennis']
  };
  if (/mallow crew.*mallow only/i.test(sheet.find(e => e.town === 'Mallow').notes)) roster.Mallow = ['Mallow'];
  const slots = Object.keys(roster).flatMap(base => [base, base]);
  const assigned = slots.map(() => null);
  function allocate(town, visited) {
    return slots.some((crew, i) => {
      if (visited.has(i) || !roster[crew].includes(town.town)) return false;
      visited.add(i);
      if (assigned[i] && !allocate(assigned[i], visited)) return false;
      assigned[i] = town;
      return true;
    });
  }
  result.filter(t => t.level === 2 && t.entry.barrier_sets > 0)
    .sort((a,b) => b.priority - a.priority || b.peak - a.peak || a.town.localeCompare(b.town))
    .forEach(t => allocate(t, new Set()));
  assigned.forEach((t,i) => { if (t) t.crew = slots[i]; });
  return result.map(t => ({ ...t, effective: t.level === 2 && !t.crew ? 1 : t.level }));
}

export function proposedFlow(question) {
  const text = question.normalize('NFKC').replace(/\u2212/g, '-');
  const explicit = text.match(/(?<![\d.:+\-])([+-]?\d+(?:\.\d+)?)\s*(?:m\s*3\s*(?:\/\s*s|s|per\s+second)|cubic\s+met(?:res|ers)\s+per\s+second)\b/i);
  const plain = text.match(/\b(?:reach(?:es|ed)?|rise(?:s)?\s+to|hits?|at)\s+([+-]?\d+(?:\.\d+)?)\s*[?!.]*\s*$/i);
  const value = Number((explicit ?? plain)?.[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
