import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientData, ServerData, encodeParams } from '../src/core/DataSource.js';
import { resolveTreeTokens } from '../src/filters/advancedEval.js';

const columns = [
  { field: 'name', type: 'text', filter: 'text' },
  { field: 'n', type: 'number', filter: 'number-range' },
];
const data = [
  { name: 'alfa', n: 30 },
  { name: 'beta', n: 10 },
  { name: 'gama', n: 20 },
  { name: 'delta', n: 40 },
];

test('client: řazení číselně vzestupně', async () => {
  const cd = new ClientData(data);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: true, sort: [{ field: 'n', dir: 'asc' }], filters: {}, columns });
  assert.deepEqual(r.rows.map((x) => x.n), [10, 20, 30, 40]);
});

test('client: filtr + stránkování', async () => {
  const cd = new ClientData(data);
  const r = await cd.query({ page: 1, pageSize: 2, paginate: true, sort: [], filters: { n: { min: 20 } }, columns });
  assert.equal(r.total, 3); // n>=20 → 30,20,40
  assert.equal(r.lastPage, 2);
  assert.equal(r.rows.length, 2);
});

/* --- zdroj možností pro odvozené select/multiselect filtry --- */

test('client: rawRows() drží CELÝ dataset i po filtrovaném dotazu', async () => {
  const cd = new ClientData(data);
  await cd.query({ page: 1, pageSize: 10, paginate: true, sort: [], filters: { name: 'alfa' }, columns });
  // allRows() = filtrovaná sada (pro souhrny), rawRows() = celý dataset (pro nabídku filtru)
  assert.deepEqual(cd.allRows().map((x) => x.name), ['alfa']);
  assert.deepEqual(cd.rawRows().map((x) => x.name), ['alfa', 'beta', 'gama', 'delta']);
});

test('client: invalidate() zahodí zapamatovanou filtrovanou sadu', async () => {
  const cd = new ClientData(data);
  await cd.query({ page: 1, pageSize: 10, paginate: true, sort: [], filters: { name: 'alfa' }, columns });
  assert.equal(cd.allRows().length, 1);
  cd.invalidate(); // grid zruší filtry — data se přepočítají až v refresh()
  assert.equal(cd.allRows().length, 4);
});

test('client: rawRows() vidí změny dat (setData/addRow/deleteRow)', async () => {
  const cd = new ClientData(data);
  cd.addRow({ name: 'epsilon', n: 50 });
  assert.equal(cd.rawRows().length, 5);
  cd.deleteRow('name', 'alfa');
  assert.deepEqual(cd.rawRows().map((x) => x.name), ['beta', 'gama', 'delta', 'epsilon']);
  cd.setData([{ name: 'jedna', n: 1 }]);
  assert.deepEqual(cd.rawRows().map((x) => x.name), ['jedna']);
});

test('server: rawRows() nemá (celou sadu nezná) → nabídka jen z filterValues/filterUrl', () => {
  const sd = new ServerData({ url: '/api' });
  assert.equal(typeof sd.rawRows, 'undefined');
});

test('client: bez stránkování vrátí vše', async () => {
  const cd = new ClientData(data);
  const r = await cd.query({ page: 1, pageSize: 2, paginate: false, sort: [], filters: {}, columns });
  assert.equal(r.rows.length, 4);
  assert.equal(r.lastPage, 1);
});

test('client: progress/rating se řadí číselně', async () => {
  const cols = [{ field: 'p', type: 'progress' }, { field: 'r', type: 'rating' }];
  const rows = [{ p: 80, r: 2 }, { p: 20, r: 5 }, { p: 50, r: 1 }];
  const cd = new ClientData(rows);
  const byP = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'p', dir: 'desc' }], filters: {}, columns: cols });
  assert.deepEqual(byP.rows.map((x) => x.p), [80, 50, 20]);
  const byR = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'r', dir: 'asc' }], filters: {}, columns: cols });
  assert.deepEqual(byR.rows.map((x) => x.r), [1, 2, 5]);
});

test('encodeParams: bracket formát kontraktu', () => {
  const sp = encodeParams({
    page: 2, size: 50,
    sort: [{ field: 'name', dir: 'asc' }],
    filter: [{ field: 'x', type: 'like', value: 'ab' }],
  });
  assert.equal(
    decodeURIComponent(sp.toString()),
    'page=2&size=50&sort[0][field]=name&sort[0][dir]=asc&filter[0][field]=x&filter[0][type]=like&filter[0][value]=ab',
  );
});

/* ---- ServerData: rozšířený filtr (advanced) v request parametrech ---- */

/** YYYY-MM-DD o `n` dní od dneška (pro ověření rozvinutých tokenů). */
function dayStr(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const advTree = { combinator: 'AND', rules: [{ field: 'probation_end', op: 'lte', value: 'today+14' }] };
const baseReq = { page: 1, pageSize: 25, paginate: true, sort: [], filters: {}, columns: [] };

test('ServerData: GET posílá advanced jako JSON string s rozvinutými tokeny', () => {
  const sd = new ServerData({ url: '/api' });
  const params = sd.buildParams({ ...baseReq, advanced: advTree });
  assert.equal(typeof params.advanced, 'string', 'GET → JSON string');
  const parsed = JSON.parse(params.advanced);
  assert.equal(parsed.rules[0].value, dayStr(14), 'token today+14 rozvinut na konkrétní datum');
  assert.equal(parsed.combinator, 'AND');
});

test('ServerData: POST posílá advanced jako vnořený objekt', () => {
  const sd = new ServerData({ url: '/api', method: 'POST' });
  const params = sd.buildParams({ ...baseReq, advanced: advTree });
  assert.equal(typeof params.advanced, 'object', 'POST → vnořený objekt');
  assert.equal(params.advanced.rules[0].value, dayStr(14));
});

test('ServerData: resolveTokens:false ponechá tokeny', () => {
  const sd = new ServerData({ url: '/api', method: 'POST', resolveTokens: false });
  const params = sd.buildParams({ ...baseReq, advanced: advTree });
  assert.equal(params.advanced.rules[0].value, 'today+14', 'token nerozvinut');
});

test('ServerData: prázdný strom advanced neposílá', () => {
  const sd = new ServerData({ url: '/api' });
  const p1 = sd.buildParams({ ...baseReq, advanced: { combinator: 'AND', rules: [] } });
  assert.equal('advanced' in p1, false);
  const p2 = sd.buildParams({ ...baseReq, advanced: null });
  assert.equal('advanced' in p2, false);
});

test('ServerData: paramNames.advanced přejmenuje klíč', () => {
  const sd = new ServerData({ url: '/api', paramNames: { advanced: 'ladv' } });
  const params = sd.buildParams({ ...baseReq, advanced: advTree });
  assert.equal('ladv' in params, true);
  assert.equal('advanced' in params, false);
});

test('ServerData: advanced přes encodeParams je jeden URL parametr', () => {
  const sd = new ServerData({ url: '/api' });
  const params = sd.buildParams({ ...baseReq, paginate: false, advanced: advTree });
  const sp = encodeParams(params);
  const raw = sp.get('advanced');
  assert.equal(typeof raw, 'string');
  assert.equal(JSON.parse(raw).rules[0].value, dayStr(14));
  // žádné bracket-rozklady advanced[…]
  assert.equal([...sp.keys()].some((k) => k.startsWith('advanced[')), false);
});

test('resolveTreeTokens: rozvine i vnořené skupiny a in/nin seznamy', () => {
  const tree = { combinator: 'OR', rules: [
    { field: 'a', op: 'gte', value: 'today' },
    { combinator: 'AND', rules: [{ field: 'b', op: 'in', value: 'today, today+1' }] },
  ] };
  const out = resolveTreeTokens(tree);
  assert.equal(out.rules[0].value, dayStr(0));
  assert.equal(out.rules[1].rules[0].value, `${dayStr(0)},${dayStr(1)}`);
  // původní strom se nezměnil (hluboká kopie)
  assert.equal(tree.rules[0].value, 'today');
});

/* ---- computed (odvozené) sloupce: col.value ---- */

const computedCols = [
  { field: 'revenue', type: 'money' },
  { field: 'cost', type: 'money' },
  { field: 'margin', type: 'money', value: (r) => r.revenue - r.cost },
  { field: 'full', type: 'text', value: (r) => r.first + ' ' + r.last },
];
const computedData = [
  { first: 'Jan', last: 'Novák', revenue: 100, cost: 40 },   // margin 60
  { first: 'Eva', last: 'Adamová', revenue: 100, cost: 90 }, // margin 10
  { first: 'Petr', last: 'Balý', revenue: 100, cost: 70 },   // margin 30
];

test('computed: řazení podle odvozené hodnoty (margin)', async () => {
  const cd = new ClientData(computedData);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'margin', dir: 'asc' }], filters: {}, columns: computedCols });
  assert.deepEqual(r.rows.map((x) => x.revenue - x.cost), [10, 30, 60]);
});

test('computed: hledání v odvozeném textovém sloupci', async () => {
  const cd = new ClientData(computedData);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'Adamová', columns: computedCols });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].first, 'Eva');
});

test('computed: cache hledání se invaliduje při updateRow', async () => {
  const cd = new ClientData([{ id: 1, first: 'Jan', last: 'Novák', revenue: 0, cost: 0 }]);
  let r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'Novák', columns: computedCols });
  assert.equal(r.rows.length, 1);
  cd.updateRow('id', 1, { last: 'Svoboda' });
  r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'Novák', columns: computedCols });
  assert.equal(r.rows.length, 0, 'po změně příjmení už staré jméno nenajde');
});

test('sort: stabilní pro shodné klíče', async () => {
  const rows = [{ id: 1, g: 'a' }, { id: 2, g: 'a' }, { id: 3, g: 'a' }];
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'g', dir: 'asc' }], filters: {}, columns: [{ field: 'g', type: 'text' }] });
  assert.deepEqual(r.rows.map((x) => x.id), [1, 2, 3]);
});

test('buildSearchIndex: první hledání je „teplé" a správné', async () => {
  const cd = new ClientData([
    { id: 1, name: 'Dvořák', city: 'Brno' },
    { id: 2, name: 'Novák', city: 'Praha' },
  ]);
  const cols = [{ field: 'name', type: 'text' }, { field: 'city', type: 'text' }];
  cd.buildSearchIndex(cols);
  // index je předpočítaný (WeakMap naplněná)
  assert.equal(cd._searchCache.get(cd.data[0]).includes('dvorak'), true, 'diakritika odstraněna');
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'praha', columns: cols });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, 2);
});

test('buildSearchIndex: přepočet po změně množiny sloupců', async () => {
  const cd = new ClientData([{ id: 1, name: 'Alfa', note: 'tajné' }]);
  cd.buildSearchIndex([{ field: 'name', type: 'text' }]);        // note NENÍ v indexu
  let r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'tajné', columns: [{ field: 'name', type: 'text' }] });
  assert.equal(r.rows.length, 0, 'note se neprohledává, když není mezi sloupci');
  r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [], filters: {}, search: 'tajné', columns: [{ field: 'name', type: 'text' }, { field: 'note', type: 'text' }] });
  assert.equal(r.rows.length, 1, 'po přidání sloupce note se index přepočítá a najde');
});

/* ---- rowMatches: jednořádkový matcher (tree filtrování) ---- */
import { rowMatches } from '../src/core/DataSource.js';

test('rowMatches: text filtr + quickSearch', () => {
  const cols = [{ field: 'name', type: 'text', filter: 'text' }, { field: 'city', type: 'text' }];
  assert.equal(rowMatches({ name: 'Dvořák', city: 'Brno' }, { filters: { name: 'dvo' }, columns: cols }), true);
  assert.equal(rowMatches({ name: 'Novák', city: 'Brno' }, { filters: { name: 'dvo' }, columns: cols }), false);
  assert.equal(rowMatches({ name: 'Novák', city: 'Brno' }, { search: 'brno', columns: cols }), true);
  assert.equal(rowMatches({ name: 'Novák', city: 'Praha' }, { search: 'brno', columns: cols }), false);
});

test('rowMatches: prázdné filtry → vždy true', () => {
  assert.equal(rowMatches({ a: 1 }, { filters: {}, search: '', columns: [{ field: 'a' }] }), true);
});

test('rowMatches: fulltext nematchuje přes hranici polí', () => {
  // regrese: pole se spojovala join('') → "abc"+"def"="abcdef" a hledání "cde"
  // (přes hranici) falešně matchlo. Oddělovač  to odstraní.
  const cols = [{ field: 'a' }, { field: 'b' }];
  assert.equal(rowMatches({ a: 'abc', b: 'def' }, { search: 'cde', columns: cols }), false, 'přes hranici NE');
  assert.equal(rowMatches({ a: 'abc', b: 'def' }, { search: 'abc', columns: cols }), true);
  assert.equal(rowMatches({ a: 'abc', b: 'def' }, { search: 'def', columns: cols }), true);
});
