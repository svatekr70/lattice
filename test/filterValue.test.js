/**
 * Normalizace hodnoty filtru z programového `setFilter` — a hlasité selhání
 * u tvaru, kterému filtr nerozumí. Dřív se špatný tvar uložil, `isEmpty` ho
 * zahodila a v tabulce zůstaly VŠECHNY řádky: vypadá to jako „filtr nefiltruje".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilterValue, getFilter } from '../src/filters/index.js';

/** Odchytí console.warn a vrátí pole hlášek. */
function captureWarn(fn) {
  const orig = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  try { fn(); } finally { console.warn = orig; }
  return seen;
}

const dateCol = () => ({ field: 'date', filter: 'date-range' });

test('date-range přijme všechny tvary, ve kterých rozsah putuje ven', () => {
  const want = { from: '2026-08-01', to: '2026-08-31' };
  assert.deepEqual(normalizeFilterValue(dateCol(), { from: '2026-08-01', to: '2026-08-31' }), want);
  assert.deepEqual(normalizeFilterValue(dateCol(), '2026-08-01|2026-08-31'), want, 'serializovaný tvar "od|do"');
  assert.deepEqual(normalizeFilterValue(dateCol(), ['2026-08-01', '2026-08-31']), want);
  assert.deepEqual(normalizeFilterValue(dateCol(), { min: '2026-08-01', max: '2026-08-31' }), want);
  // Jednostranný rozsah (přesně tak ho vrací toServer, když je vyplněné jen Od).
  assert.deepEqual(normalizeFilterValue(dateCol(), '2026-08-01|'), { from: '2026-08-01', to: null });
});

test('normalizovaný rozsah filtr opravdu filtruje', () => {
  const f = getFilter('date-range');
  const v = normalizeFilterValue(dateCol(), '2026-08-01|2026-08-31');
  assert.equal(f.isEmpty(v), false);
  assert.equal(f.match(v, '2026-08-15'), true);
  assert.equal(f.match(v, '2026-09-15'), false);
});

test('nerozpoznaný tvar: varování v konzoli a filtr se NEnastaví', () => {
  const col = dateCol();
  let out;
  const warns = captureWarn(() => { out = normalizeFilterValue(col, '15. 8. 2026'); });
  assert.equal(out, null, 'nerozpoznaný tvar se nesmí uložit jako „platný"');
  assert.equal(warns.length, 1);
  assert.match(warns[0], /date/);
  assert.match(warns[0], /\{from, to\}/, 'hláška říká, co se čeká');
  // Podruhé se na stejný sloupec už neopakuje.
  assert.equal(captureWarn(() => normalizeFilterValue(col, '15. 8. 2026')).length, 0);
});

test('multiselect: skalár se zabalí do pole (a objekt se ohlásí)', () => {
  const col = { field: 'country', filter: 'multiselect' };
  assert.deepEqual(normalizeFilterValue(col, 'SK'), ['SK']);
  assert.deepEqual(normalizeFilterValue(col, ['SK', 'CZ']), ['SK', 'CZ']);
  assert.deepEqual(normalizeFilterValue(col, 7), ['7']);
  assert.equal(captureWarn(() => normalizeFilterValue(col, { a: 1 })).length, 1);
});

test('select: jednoprvkové pole projde, víc hodnot je chyba', () => {
  const col = { field: 'state', filter: 'select' };
  assert.equal(normalizeFilterValue(col, ['open']), 'open');
  assert.equal(normalizeFilterValue(col, 'open'), 'open');
  let out;
  const warns = captureWarn(() => { out = normalizeFilterValue(col, ['open', 'done']); });
  assert.equal(out, null);
  assert.match(warns[0], /multiselect/, 'hláška poradí správný typ filtru');
});

test('boolean: true/false se přeloží na hodnotu ovládacího prvku', () => {
  const col = { field: 'active', filter: 'boolean' };
  assert.equal(normalizeFilterValue(col, true), 'true');
  assert.equal(normalizeFilterValue(col, false), 'false');
  assert.equal(normalizeFilterValue(col, 0), 'false');
  assert.equal(normalizeFilterValue(col, 'true'), 'true');
  // Dřív: setFilter(f, true) → match porovnal true !== 'true' a filtrovalo se NAOPAK.
  const f = getFilter('boolean');
  assert.equal(f.match(normalizeFilterValue(col, true), true), true);
  assert.equal(f.match(normalizeFilterValue(col, true), false), false);
});

test('number-range: {min,max} | [min,max] | "min|max"', () => {
  const col = { field: 'n', filter: 'number-range' };
  assert.deepEqual(normalizeFilterValue(col, [10, 20]), { min: 10, max: 20 });
  assert.deepEqual(normalizeFilterValue(col, '10|20'), { min: '10', max: '20' });
  assert.deepEqual(normalizeFilterValue(col, { min: 10 }), { min: 10, max: null });
});

test('prázdná hodnota a filtr bez parseValue projdou beze změny', () => {
  assert.equal(normalizeFilterValue(dateCol(), null), null);
  assert.equal(normalizeFilterValue(dateCol(), ''), '');
  assert.equal(normalizeFilterValue({ field: 'x' }, { cokoli: 1 }).cokoli, 1, 'sloupec bez filtru');
});
