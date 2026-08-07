/**
 * Klientský fallback-mock API pro demo BEZ Node backendu (statický hosting).
 *
 * Na produkci (lattice.rudolfsvatek.cz) neběží `demo/server.js`, takže endpointy
 * `/api/campaigns`, `/api/presets`, `/api/advanced-filters`, `/api/defaults`
 * vrací 404 a server-side příklady zůstanou prázdné. Tenhle modul přepíše
 * `window.fetch`, tyto cesty obslouží přímo v prohlížeči nad `demo/data.js`
 * a vrátí IDENTICKÝ JSON jako mock server — kontrakt je portovaný 1:1 z server.js.
 *
 * Aktivace (viz shouldMock): defaultně VŠUDE KROMĚ localhost/127.0.0.1, aby
 * lokální `npm run demo` (Node http server) běžel dál proti reálnému server.js.
 * Přebít lze `?mock=1` / `?mock=0` v URL nebo `window.__LATTICE_MOCK_API__`.
 *
 * Importuje se jako side-effect (`import './mock-api.js'`) hned na začátku
 * app.js / builder.html — spustí se před prvním fetch (ESM pořadí importů).
 */
import { generateCampaigns } from './data.js';

/* Jeden deterministický dataset (stejná velikost jako server.js: 400). */
const DATASET = generateCampaigns(400);

/* In-memory úložiště sdílená mezi „uživateli" jen v rámci jedné session karty. */
const GLOBAL_PRESETS = Object.create(null);
const GLOBAL_ADVANCED = Object.create(null);
const GLOBAL_DEFAULTS = Object.create(null);

/* ---------------- aktivace ---------------- */

function shouldMock() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('mock') === '1') return true;
    if (q.get('mock') === '0') return false;
  } catch { /* location nedostupné → padneme na heuristiku níže */ }
  if (typeof window !== 'undefined' && window.__LATTICE_MOCK_API__ === true) return true;
  if (typeof window !== 'undefined' && window.__LATTICE_MOCK_API__ === false) return false;
  const h = (typeof location !== 'undefined' && location.hostname) || '';
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  return !isLocal; // mockuj všude kromě lokálního Node dev serveru
}

export function installMockApi() {
  if (typeof window === 'undefined' || window.__latticeMockInstalled) return;
  window.__latticeMockInstalled = true;
  const orig = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let u;
    try { u = new URL(url, location.origin); } catch { return orig ? orig(input, init) : Promise.reject(new Error('no fetch')); }
    const path = u.pathname;
    const method = String(
      (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET',
    ).toUpperCase();

    if (path === '/api/campaigns') return json(handleCampaigns(u));
    if (path === '/api/presets') return handleStore(GLOBAL_PRESETS, u, method, init, 'preset');
    if (path === '/api/advanced-filters') return handleStore(GLOBAL_ADVANCED, u, method, init, 'filter');
    if (path === '/api/defaults') return handleDefaults(u, method, init);
    if (path === '/api/fetch' || path === '/demo/api/fetch.php') return handleFetch(u, orig);

    return orig ? orig(input, init) : Promise.reject(new Error('mock: no passthrough fetch'));
  };
}

/* ---------------- /api/campaigns (1:1 dle server.js) ---------------- */

function handleCampaigns(u) {
  const q = parseNested(u.searchParams);
  const page = int(q.page, 1);
  const size = int(q.size, 50);
  const sort = toArray(q.sort);
  const filters = toArray(q.filter);

  let rows = DATASET;
  for (const f of filters) rows = rows.filter((r) => matchFilter(r, f));
  if (sort.length) rows = sortRows(rows, sort);

  const total = rows.length;
  const lastPage = Math.max(1, Math.ceil(total / size));
  const start = (page - 1) * size;
  const data = rows.slice(start, start + size);
  return { data, last_page: lastPage, last_row: total, total };
}

function matchFilter(row, f) {
  const val = row[f.field];
  const fv = f.value;
  switch (f.type) {
    case 'like': {
      const raw = String(fv).trim();
      const neg = raw.startsWith('!');
      const needle = (neg ? raw.slice(1) : raw).toLowerCase();
      if (!needle) return true;
      const has = String(val ?? '').toLowerCase().includes(needle);
      return neg ? !has : has;
    }
    case '!like': {
      const needle = String(fv).trim().toLowerCase();
      if (!needle) return true;
      return !String(val ?? '').toLowerCase().includes(needle);
    }
    case '=': return String(val) === String(fv) || val === fv;
    case '!=': return String(val) !== String(fv);
    case '>': return isDate(fv) ? day(val) > day(fv) : num(val) > num(fv);
    case '<': return isDate(fv) ? day(val) < day(fv) : num(val) < num(fv);
    case '>=': return isDate(fv) ? day(val) >= day(fv) : num(val) >= num(fv);
    case '<=': return isDate(fv) ? day(val) <= day(fv) : num(val) <= num(fv);
    case 'in': return toArr(fv).map(String).includes(String(val));
    case 'dateRange': {
      const [from, to] = String(fv).split('|');
      const t = day(val);
      if (from && t < day(from)) return false;
      if (to && t > day(to)) return false;
      return true;
    }
    default: return true;
  }
}

function sortRows(rows, sort) {
  return rows.slice().sort((a, b) => {
    for (const s of sort) {
      const av = a[s.field], bv = b[s.field];
      let c;
      if (isNumeric(av) && isNumeric(bv)) c = num(av) - num(bv);
      else c = String(av ?? '').localeCompare(String(bv ?? ''), 'cs', { numeric: true });
      if (c) return s.dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

/* ---------------- /api/presets + /api/advanced-filters (sdílená logika) ---------------- */

async function handleStore(store, u, method, init, itemKey) {
  const grid = u.searchParams.get('grid') || 'default';
  store[grid] = store[grid] || [];

  if (method === 'GET') return json(store[grid]);
  if (method === 'POST') {
    const body = await readBody(init);
    const item = body && body[itemKey] ? body[itemKey] : body;
    if (!item || !item.name) return json({ error: 'missing ' + itemKey });
    store[grid] = store[grid].filter((p) => p.name !== item.name); // stejný název přepíše
    store[grid].push(item);
    return json(item);
  }
  if (method === 'DELETE') {
    const id = u.searchParams.get('id');
    store[grid] = store[grid].filter((p) => p.id !== id);
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

/* ---------------- /api/defaults ---------------- */

async function handleDefaults(u, method, init) {
  if (method === 'GET') return json(GLOBAL_DEFAULTS);
  if (method === 'POST') {
    const body = await readBody(init);
    const grid = (body && body.grid) || u.searchParams.get('grid');
    if (!grid || !body.defaults) return json({ error: 'missing grid/defaults' });
    GLOBAL_DEFAULTS[grid] = body.defaults;
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

/* ---------------- /api/fetch (proxy pro „import z URL") ----------------
 * Node server tu obchází CORS. V prohlížeči proxy udělat nejde → zkusíme
 * přímý fetch (funguje jen u serverů s CORS) a jinak vrátíme srozumitelnou
 * hlášku, ať příklad „import z URL" nezamrzne. */
async function handleFetch(u, orig) {
  const target = u.searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) return html('missing/invalid url', 400);
  try {
    const r = await orig(target, { headers: { 'User-Agent': 'Mozilla/5.0 LatticeDemo' } });
    return html(await r.text());
  } catch {
    return html(
      '<h3>Proxy pro import z URL není na statickém demu k dispozici</h3>' +
      '<p>Tento příklad vyžaduje serverový proxy endpoint (<code>demo/server.js</code>), ' +
      'který obchází CORS. Na živém statickém webu prohlížeč cizí stránku načíst nemůže. ' +
      'Spusť lokálně <code>npm run demo</code> pro plnou funkčnost.</p>',
    );
  }
}

/* ---------------- helpers ---------------- */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function html(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function readBody(init) {
  if (!init || init.body == null) return {};
  try { return typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {}; } catch { return {}; }
}

/** filter[0][field]=x → { filter: { '0': { field:'x' } } } */
function parseNested(searchParams) {
  const out = {};
  for (const [key, value] of searchParams.entries()) {
    const path = key.replace(/\]/g, '').split('[');
    let cur = out;
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      if (i === path.length - 1) cur[k] = value;
      else cur = cur[k] || (cur[k] = {});
    }
  }
  return out;
}

/** Objekt s číselnými klíči → pole. */
function toArray(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  return Object.keys(obj).sort((a, b) => a - b).map((k) => obj[k]);
}
function toArr(v) { return Array.isArray(v) ? v : v && typeof v === 'object' ? toArray(v) : [v]; }

function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function num(v) { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function isNumeric(v) { return v !== '' && v != null && Number.isFinite(Number(v)); }
function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }
function day(v) { const d = new Date(v); d.setHours(0, 0, 0, 0); const t = d.getTime(); return Number.isNaN(t) ? 0 : t; }

/* Self-install: mockuj jen když chybí backend (mimo localhost). */
if (shouldMock()) installMockApi();
