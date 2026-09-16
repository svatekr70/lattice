/**
 * Filtr nad buňkou s POLEM hodnot (array-contains) + rozpad pole do nabídky.
 *
 * Testy jdou i po „protipokusu": shoda čísla nestačí. Multiselect nad polem
 * dřív propustil VŠECHNO, což se náhodou rovnalo očekávanému počtu — chyba se
 * pozná až tím, že se nesmyslná hodnota musí vyfiltrovat na nulu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFilter, distinctFilterValues, EMPTY_FILTER_VALUE } from '../src/filters/index.js';
import { ClientData } from '../src/core/DataSource.js';

const col = { field: 'missingFields', type: 'text', filter: 'multiselect' };
const rows = [
  { id: 1, missingFields: ['Číslo účtu', 'Datum narození'] },
  { id: 2, missingFields: ['Datum narození'] },
  { id: 3, missingFields: ['Číslo účtu'] },
  { id: 4, missingFields: [] },
  { id: 5, missingFields: null },
];

test('multiselect: shoda = průnik s výběrem není prázdný', () => {
  const f = getFilter('multiselect');
  assert.equal(f.match(['Datum narození'], ['Číslo účtu', 'Datum narození']), true);
  assert.equal(f.match(['Datum narození'], ['Číslo účtu']), false);
  // Protipokus: nesmyslná hodnota nesmí propustit nic.
  assert.equal(f.match(['Neexistuje'], ['Číslo účtu', 'Datum narození']), false);
  // Skalární buňka se chová jako dřív.
  assert.equal(f.match(['SK'], 'SK'), true);
  assert.equal(f.match(['SK'], 'CZ'), false);
});

test('multiselect nad polem: počet sedí s ručním spočítáním (a protipokus dá 0)', async () => {
  const cd = new ClientData(rows);
  const q = (value) => cd.query({ page: 1, pageSize: 50, paginate: false, sort: [], filters: { missingFields: value }, columns: [col] });

  assert.deepEqual((await q(['Datum narození'])).rows.map((r) => r.id), [1, 2]);
  assert.deepEqual((await q(['Číslo účtu'])).rows.map((r) => r.id), [1, 3]);
  // Víc vybraných hodnot = OR mezi nimi.
  assert.deepEqual((await q(['Číslo účtu', 'Datum narození'])).rows.map((r) => r.id), [1, 2, 3]);
  assert.equal((await q(['Neexistuje'])).total, 0, 'protipokus: filtr nesmí propustit všechno');
});

test('prázdné pole i null patří pod volbu „(prázdné)"', async () => {
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 50, paginate: false, sort: [], filters: { missingFields: [EMPTY_FILTER_VALUE] }, columns: [col] });
  assert.deepEqual(r.rows.map((x) => x.id), [4, 5]);
});

test('multiselect-exclude nad polem: vyloučí řádek s kteroukoli vybranou hodnotou', async () => {
  const c = { ...col, filter: 'multiselect-exclude' };
  const cd = new ClientData(rows);
  const r = await cd.query({ page: 1, pageSize: 50, paginate: false, sort: [], filters: { missingFields: ['Číslo účtu'] }, columns: [c] });
  assert.deepEqual(r.rows.map((x) => x.id), [2, 4, 5]);
});

test('select nad polem: shoda, když je hodnota mezi hodnotami buňky', () => {
  const f = getFilter('select');
  assert.equal(f.match('Datum narození', ['Číslo účtu', 'Datum narození']), true);
  assert.equal(f.match('Neexistuje', ['Číslo účtu']), false);
  assert.equal(f.match(EMPTY_FILTER_VALUE, []), true, 'prázdné pole = prázdná buňka');
  assert.equal(f.match(EMPTY_FILTER_VALUE, ['x']), false);
});

test('nabídka odvozená z dat: pole se rozpadne na jednotlivé volby', () => {
  const vals = distinctFilterValues(rows, col);
  assert.deepEqual(vals, ['Číslo účtu', 'Datum narození', EMPTY_FILTER_VALUE]);
});

test('objekt v buňce se ohlásí v konzoli (místo tichého „nic nenajde")', () => {
  const f = getFilter('multiselect');
  const c = { field: 'raw', filter: 'multiselect' };
  const orig = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  try {
    assert.equal(f.match(['x'], { a: 1 }, {}, c), false);
    f.match(['x'], { a: 2 }, {}, c); // druhý řádek už nevaruje
  } finally { console.warn = orig; }
  assert.equal(seen.length, 1, 'varuje se jednou na sloupec, ne pro každý řádek');
  assert.match(seen[0], /raw/);
});
