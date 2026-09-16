/**
 * Vlastní komparační hodnota sloupce (`sortValue`) — řazení podle něčeho jiného
 * než podle toho, co je ve `field`: počet položek v poli, sekundy pod textem
 * „2m 30s", datum v českém tvaru. Dřív se kvůli tomu musel dopočítávat pomocný
 * sloupec do dat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientData } from '../src/core/DataSource.js';
import { buildColumns } from '../src/core/ColumnModel.js';

const rows = [
  { id: 1, missing: ['a', 'b', 'c'], duration: '2m 30s', cz: '3. 1. 2026' },
  { id: 2, missing: [], duration: '10s', cz: '1. 12. 2025' },
  { id: 3, missing: ['a'], duration: '1h 5m', cz: '15. 6. 2026' },
];

const secs = (s) => {
  let t = 0;
  for (const [, n, u] of String(s).matchAll(/(\d+)\s*([hms])/g)) t += Number(n) * { h: 3600, m: 60, s: 1 }[u];
  return t;
};
const czDate = (s) => { const [d, m, y] = String(s).split('.').map((x) => Number(x.trim())); return new Date(y, m - 1, d); };

const columns = [
  { field: 'missing', type: 'text', sortValue: (r) => r.missing.length },
  { field: 'duration', type: 'text', sortValue: (r) => secs(r.duration) },
  { field: 'cz', type: 'text', sortValue: (r) => czDate(r.cz) },
];

const ids = async (field, dir) => {
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field, dir }], filters: {}, columns });
  return r.rows.map((x) => x.id);
};

test('sortValue: číslo (počet položek v poli)', async () => {
  assert.deepEqual(await ids('missing', 'asc'), [2, 3, 1]);
  assert.deepEqual(await ids('missing', 'desc'), [1, 3, 2]);
});

test('sortValue: sekundy pod formátovaným textem (abecedně by vyšlo jinak)', async () => {
  assert.deepEqual(await ids('duration', 'asc'), [2, 1, 3]);
  // Bez sortValue se řadí podle TEXTU (collator s numeric:true) → '1h 5m' < '2m 30s' < '10s'.
  const cd = new ClientData(rows);
  const plain = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'duration', dir: 'asc' }], filters: {}, columns: [{ field: 'duration', type: 'text' }] });
  assert.deepEqual(plain.rows.map((r) => r.id), [3, 1, 2], 'jiné pořadí než podle sekund'); 
});

test('sortValue: Date se řadí časem', async () => {
  assert.deepEqual(await ids('cz', 'asc'), [2, 1, 3]);
});

test('sortValue vracející null se řadí jako chybějící hodnota (vzestupně první)', async () => {
  const cols = [{ field: 'x', sortValue: (r) => (r.id === 2 ? null : r.id) }];
  const cd = new ClientData(rows);
  const asc = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'x', dir: 'asc' }], filters: {}, columns: cols });
  assert.deepEqual(asc.rows.map((r) => r.id), [2, 1, 3]);
});

test('sortValue, která spadne, řazení nepoloží (řádek jde pod prázdnou hodnotu)', async () => {
  const cols = [{ field: 'x', sortValue: (r) => r.nic.nic }];
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'x', dir: 'asc' }], filters: {}, columns: cols });
  assert.deepEqual(r.rows.map((x) => x.id), [1, 2, 3], 'stabilní původní pořadí');
});

test('mix čísel a textů z jedné sortValue se sjednotí na text (deterministicky)', async () => {
  const cols = [{ field: 'x', sortValue: (r) => (r.id === 1 ? 'bb' : r.id * 10) }];
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 10, paginate: false, sort: [{ field: 'x', dir: 'asc' }], filters: {}, columns: cols });
  assert.deepEqual(r.rows.map((x) => x.id), [2, 3, 1], "'20' < '30' < 'bb'");
});

test('sortValue se přenese z definice do resolved sloupce', () => {
  const fn = (r) => r.id;
  const cols = buildColumns([{ field: 'a', sortValue: fn }, { field: 'b' }], []);
  assert.equal(cols[0].sortValue, fn);
  assert.equal(cols[1].sortValue, null);
});
