/**
 * Mock server pro demo server-side režimu (bez závislostí, čistý Node http).
 *
 *  - Statické soubory (demo/ + src/) → aby šel ESM import v prohlížeči.
 *  - GET /api/campaigns → implementuje kontrakt:
 *      request:  page, size, sort[0][field], sort[0][dir],
 *                filter[N][field], filter[N][type], filter[N][value]
 *      response: { data, last_page, last_row, total }
 *
 * Spuštění:  npm run demo   → http://localhost:877/demo/
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCampaigns } from './data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = process.env.PORT || 877;
const DATASET = generateCampaigns(240);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/campaigns') return handleApi(url, res);
  if (url.pathname === '/api/presets') return handlePresets(req, url, res);
  if (url.pathname === '/api/defaults') return handleDefaults(req, url, res);
  if (url.pathname === '/api/fetch') return handleFetch(url, res);
  if (url.pathname === '/') return redirect(res, '/demo/');
  return serveStatic(url.pathname, res);
});

/**
 * Globální presety — simulace serverového úložiště sdíleného mezi uživateli.
 * V reálné appce (EverFLOW) to bude Nette endpoint + DB; tady stačí paměť.
 * Keyed dle `grid` (id gridu).
 */
const GLOBAL_PRESETS = Object.create(null);

/**
 * Globální výchozí nastavení tabulky (admin → všem). Keyed dle `grid` id.
 * GET vrátí mapu { gridId: {version, state} }; POST { grid, defaults } uloží.
 */
const GLOBAL_DEFAULTS = Object.create(null);
async function handleDefaults(req, url, res) {
  if (req.method === 'GET') return json(res, GLOBAL_DEFAULTS);
  if (req.method === 'POST') {
    const body = await readBody(req);
    const grid = (body && body.grid) || url.searchParams.get('grid');
    if (!grid || !body.defaults) return json(res, { error: 'missing grid/defaults' });
    GLOBAL_DEFAULTS[grid] = body.defaults;
    return json(res, { ok: true });
  }
  res.writeHead(405); res.end();
}

async function handlePresets(req, url, res) {
  const grid = url.searchParams.get('grid') || 'default';
  GLOBAL_PRESETS[grid] = GLOBAL_PRESETS[grid] || [];

  if (req.method === 'GET') {
    return json(res, GLOBAL_PRESETS[grid]);
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const preset = body && body.preset ? body.preset : body;
    if (!preset || !preset.name) return json(res, { error: 'missing preset' });
    // stejný název přepíše
    GLOBAL_PRESETS[grid] = GLOBAL_PRESETS[grid].filter((p) => p.name !== preset.name);
    GLOBAL_PRESETS[grid].push(preset);
    return json(res, preset);
  }
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    GLOBAL_PRESETS[grid] = GLOBAL_PRESETS[grid].filter((p) => p.id !== id);
    return json(res, { ok: true });
  }
  res.writeHead(405); res.end();
}

/**
 * Proxy pro načtení cizí stránky (obchází CORS pro demo „import z URL").
 * POZOR: otevřený proxy je jen pro lokální demo. V produkci (EverFLOW) by tu
 * byl vlastní backend endpoint s whitelistem/oprávněními, ne otevřený fetch.
 */
async function handleFetch(url, res) {
  const target = url.searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('missing/invalid url');
  }
  try {
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 LatticeDemo' } });
    const body = await r.text();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('fetch failed: ' + err.message);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

server.listen(PORT, () => {
  console.log(`Lattice demo běží na  http://localhost:${PORT}/demo/`);
});

/* ---------------- API ---------------- */

function handleApi(url, res) {
  const q = parseNested(url.searchParams);
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

  json(res, { data, last_page: lastPage, last_row: total, total });
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
    case '>=': return cmpGte(val, fv);
    case '<=': return cmpLte(val, fv);
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

// >= / <= musí fungovat pro čísla i data (date-two posílá ISO datum)
function cmpGte(val, fv) { return isDate(fv) ? day(val) >= day(fv) : num(val) >= num(fv); }
function cmpLte(val, fv) { return isDate(fv) ? day(val) <= day(fv) : num(val) <= num(fv); }

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

/* ---------------- parsování bracket query ---------------- */

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

/* ---------------- statické soubory ---------------- */

async function serveStatic(pathname, res) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, safe);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + pathname);
  }
}

function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
function json(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

/* ---------------- utils ---------------- */

function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function num(v) { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function isNumeric(v) { return v !== '' && v != null && Number.isFinite(Number(v)); }
function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }
function day(v) { const d = new Date(v); d.setHours(0, 0, 0, 0); const t = d.getTime(); return Number.isNaN(t) ? 0 : t; }
