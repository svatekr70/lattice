import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientData, encodeParams } from '../src/core/DataSource.js';

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
