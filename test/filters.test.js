import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFilter, EMPTY_FILTER_VALUE, buildFilterOptions, distinctFilterValues } from '../src/filters/index.js';
import { ClientData, ServerData, encodeParams } from '../src/core/DataSource.js';
import { Store, emptyState } from '../src/core/Store.js';
import { I18n } from '../src/i18n/index.js';
import { Lattice } from '../src/Lattice.js';

test('text: substring, case-insensitive', () => {
  const f = getFilter('text');
  assert.equal(f.match('foo', 'Foobar'), true);
  assert.equal(f.match('xyz', 'Foobar'), false);
});

test('text: negace prefixem !', () => {
  const f = getFilter('text');
  assert.equal(f.match('!foo', 'bar'), true);
  assert.equal(f.match('!foo', 'foobar'), false);
  assert.equal(f.isEmpty(''), true);
});

test('number: operátory', () => {
  const f = getFilter('number');
  assert.equal(f.match('>5', 8), true);
  assert.equal(f.match('>5', 3), false);
  assert.equal(f.match('<=10', 10), true);
  assert.equal(f.match('7', 7), true);
  assert.deepEqual(f.toServer('n', '>=5'), [{ field: 'n', type: '>=', value: '5' }]);
});

test('number-range: min/max', () => {
  const f = getFilter('number-range');
  assert.equal(f.match({ min: 10, max: 20 }, 15), true);
  assert.equal(f.match({ min: 10, max: 20 }, 25), false);
  assert.equal(f.isEmpty({ min: null, max: null }), true);
  assert.deepEqual(f.toServer('n', { min: 10, max: null }), [{ field: 'n', type: '>=', value: 10 }]);
});

test('date-range: jedno pole → jeden server param "from|to"', () => {
  const f = getFilter('date-range');
  assert.equal(f.match({ from: '2026-01-01', to: '2026-12-31' }, '2026-06-15'), true);
  assert.equal(f.match({ from: '2026-01-01', to: '2026-03-31' }, '2026-06-15'), false);
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: '2026-12-31' }),
    [{ field: 'd', type: 'dateRange', value: '2026-01-01|2026-12-31' }]);
});

test('date-range: dynamický preset (tokeny) — match i toServer rozvine relativně', () => {
  const f = getFilter('date-range');
  const iso = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const today = iso(new Date());
  // {from:'today', to:'today'} matchne dnešek, ne včerejšek
  assert.equal(f.match({ from: 'today', to: 'today' }, today), true);
  const y = new Date(); y.setDate(y.getDate() - 1);
  assert.equal(f.match({ from: 'today', to: 'today' }, iso(y)), false);
  // toServer rozvine token na konkrétní datum (server tokeny neřeší)
  assert.deepEqual(f.toServer('d', { from: 'today', to: 'today' }),
    [{ field: 'd', type: 'dateRange', value: `${today}|${today}` }]);
  // minulý týden = sow-1w..eow-1w → obě konkrétní data
  const [lw] = f.toServer('d', { from: 'sow-1w', to: 'eow-1w' });
  assert.match(lw.value, /^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/);
});

test('date-two: dvě pole → dva server params (jedno nepovinné)', () => {
  const f = getFilter('date-two');
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: null }),
    [{ field: 'd', type: '>=', value: '2026-01-01' }]);
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: '2026-12-31' }),
    [{ field: 'd', type: '>=', value: '2026-01-01' }, { field: 'd', type: '<=', value: '2026-12-31' }]);
});

test('multiselect: in', () => {
  const f = getFilter('multiselect');
  assert.equal(f.match(['A', 'B'], 'B'), true);
  assert.equal(f.match(['A', 'B'], 'C'), false);
  assert.deepEqual(f.toServer('c', ['A', 'B']), [{ field: 'c', type: 'in', value: ['A', 'B'] }]);
});

test('multiselect-exclude: notIn (inverze multiselectu)', () => {
  const f = getFilter('multiselect-exclude');
  assert.equal(f.match(['A', 'B'], 'B'), false);   // vybrané se skryjí
  assert.equal(f.match(['A', 'B'], 'C'), true);    // ostatní zůstanou
  assert.equal(f.match(['A'], ''), true);          // prázdná buňka není vyloučená
  assert.equal(f.isEmpty([]), true);               // nic nevybráno → nefiltruje
  assert.deepEqual(f.toServer('c', ['A', 'B']), [{ field: 'c', type: 'notIn', value: ['A', 'B'] }]);
});

test('boolean: ano/ne', () => {
  const f = getFilter('boolean');
  assert.equal(f.match('true', true), true);
  assert.equal(f.match('false', true), false);
  assert.equal(f.match('false', 0), true);
});

/* ---- volba „(prázdné)" ve výběrových filtrech (EMPTY_FILTER_VALUE) ------ */

const i18nCs = new I18n('cs');
/** Minimální ctx pro sestavení nabídky (bez DOM). */
const optCtx = { i18n: i18nCs };
const zeme = { field: 'zeme', title: 'Země' };

test('odvozená nabídka: volba prázdné přibude, když sloupec prázdné buňky má', () => {
  const rows = [{ zeme: 'CZ' }, { zeme: null }, { zeme: '' }, { zeme: 'SK' }];
  const raw = distinctFilterValues(rows, zeme);
  assert.deepEqual(raw, ['CZ', 'SK', EMPTY_FILTER_VALUE]);
  // undefined (chybějící klíč) se počítá stejně jako null i ''
  assert.deepEqual(distinctFilterValues([{ zeme: 'CZ' }, {}], zeme), ['CZ', EMPTY_FILTER_VALUE]);
});

test('odvozená nabídka: bez prázdné buňky se volba nenabízí', () => {
  const rows = [{ zeme: 'CZ' }, { zeme: 'SK' }];
  assert.deepEqual(distinctFilterValues(rows, zeme), ['CZ', 'SK']);
  const opts = buildFilterOptions(distinctFilterValues(rows, zeme), zeme, optCtx);
  assert.deepEqual(opts.map((o) => o.value), ['CZ', 'SK']);
});

test('nabídka: volba prázdné je první (mimo abecední řazení) a má přeložený popisek', () => {
  // 'Ať' i 'Zed' by v abecedě obklopily „(prázdné)" — volba přesto patří na začátek
  const opts = buildFilterOptions(['Zed', 'Ať', EMPTY_FILTER_VALUE], zeme, optCtx);
  assert.deepEqual(opts.map((o) => o.value), [EMPTY_FILTER_VALUE, 'Ať', 'Zed']);
  assert.equal(opts[0].label, '(prázdné)');
  assert.equal(new I18n('en').t('filters.empty'), '(empty)');
});

test('statický filterValues bez tokenu se nezmění; s tokenem dostane popisek', () => {
  const col = { field: 'zeme', filterValues: ['CZ', 'SK'] };
  assert.deepEqual(buildFilterOptions(col.filterValues, col, optCtx), [
    { value: 'CZ', label: 'CZ' }, { value: 'SK', label: 'SK' },
  ]);
  const col2 = { field: 'zeme', filterValues: ['CZ', 'SK', EMPTY_FILTER_VALUE] };
  const opts = buildFilterOptions(col2.filterValues, col2, optCtx);
  assert.deepEqual(opts.map((o) => o.value), [EMPTY_FILTER_VALUE, 'CZ', 'SK']);
  assert.equal(opts[0].label, '(prázdné)');
});

test('filterEmptyOption: true připne volbu i statickému číselníku, false ji potlačí', () => {
  const on = { field: 'zeme', filterValues: ['CZ', 'SK'], filterEmptyOption: true };
  assert.deepEqual(buildFilterOptions(on.filterValues, on, optCtx).map((o) => o.value),
    [EMPTY_FILTER_VALUE, 'CZ', 'SK']);
  // false potlačí i volbu z odvozené nabídky
  const off = { field: 'zeme', filterEmptyOption: false };
  const raw = distinctFilterValues([{ zeme: 'CZ' }, { zeme: null }], off);
  assert.deepEqual(buildFilterOptions(raw, off, optCtx).map((o) => o.value), ['CZ']);
});

test('select: token vrátí právě prázdné řádky', () => {
  const f = getFilter('select');
  assert.equal(f.match(EMPTY_FILTER_VALUE, null), true);
  assert.equal(f.match(EMPTY_FILTER_VALUE, undefined), true);
  assert.equal(f.match(EMPTY_FILTER_VALUE, ''), true);
  assert.equal(f.match(EMPTY_FILTER_VALUE, 'CZ'), false);
  assert.equal(f.match(EMPTY_FILTER_VALUE, 0), false);   // nula není prázdno
  assert.equal(f.match('CZ', null), false);              // regrese: bez tokenu prázdno neprojde
  assert.equal(f.isEmpty(EMPTY_FILTER_VALUE), false);    // vybraný token = AKTIVNÍ filtr
  assert.deepEqual(f.toServer('zeme', EMPTY_FILTER_VALUE),
    [{ field: 'zeme', type: '=', value: EMPTY_FILTER_VALUE }]);
});

test('multiselect: token se s hodnotami spojuje přes OR', () => {
  const f = getFilter('multiselect');
  const v = ['SK', EMPTY_FILTER_VALUE];
  assert.equal(f.match(v, 'SK'), true);
  assert.equal(f.match(v, null), true);
  assert.equal(f.match(v, ''), true);
  assert.equal(f.match(v, 'CZ'), false);
  // samotný token = jen prázdné
  assert.equal(f.match([EMPTY_FILTER_VALUE], 'SK'), false);
  assert.equal(f.match([EMPTY_FILTER_VALUE], null), true);
  // regrese: bez tokenu prázdná buňka neprojde
  assert.equal(f.match(['SK'], null), false);
  assert.deepEqual(f.toServer('zeme', v), [{ field: 'zeme', type: 'in', value: v }]);
});

test('multiselect-exclude: token prázdné skryje, bez něj projdou (regrese)', () => {
  const f = getFilter('multiselect-exclude');
  assert.equal(f.match(['SK', EMPTY_FILTER_VALUE], null), false);  // prázdné se skryje
  assert.equal(f.match(['SK', EMPTY_FILTER_VALUE], ''), false);
  assert.equal(f.match(['SK', EMPTY_FILTER_VALUE], 'SK'), false);
  assert.equal(f.match(['SK', EMPTY_FILTER_VALUE], 'CZ'), true);
  assert.equal(f.match(['SK'], null), true);                       // bez tokenu prázdné projde
  assert.equal(f.match(['SK'], ''), true);
  assert.deepEqual(f.toServer('zeme', [EMPTY_FILTER_VALUE]),
    [{ field: 'zeme', type: 'notIn', value: [EMPTY_FILTER_VALUE] }]);
});

test('client-side dotaz: token filtruje celý dataset', async () => {
  const columns = [{ field: 'id', type: 'number' }, { field: 'zeme', type: 'text', filter: 'select' }];
  const data = [{ id: 1, zeme: 'CZ' }, { id: 2, zeme: null }, { id: 3, zeme: '' }, { id: 4, zeme: 'SK' }];
  const cd = new ClientData(data);
  const res = await cd.query({ filters: { zeme: EMPTY_FILTER_VALUE }, columns, paginate: false });
  assert.deepEqual(res.rows.map((r) => r.id), [2, 3]);
  // multiselect: SK NEBO prázdné
  const ms = [{ field: 'id', type: 'number' }, { field: 'zeme', type: 'text', filter: 'multiselect' }];
  const res2 = await new ClientData(data).query({ filters: { zeme: ['SK', EMPTY_FILTER_VALUE] }, columns: ms, paginate: false });
  assert.deepEqual(res2.rows.map((r) => r.id), [2, 3, 4]);
});

test('serverSide: token se serializuje do dotazu jako obyčejná hodnota', () => {
  const sd = new ServerData({ url: '/api' });
  const columns = [{ field: 'zeme', type: 'text', filter: 'multiselect' }];
  const params = sd.buildParams({
    page: 1, size: 50, paginate: true, sort: [],
    filters: { zeme: ['SK', EMPTY_FILTER_VALUE] }, columns,
  });
  assert.deepEqual(params.filter, [{ field: 'zeme', type: 'in', value: ['SK', EMPTY_FILTER_VALUE] }]);
  const qs = decodeURIComponent(encodeParams(params).toString());
  assert.ok(qs.includes(`filter[0][value][1]=${EMPTY_FILTER_VALUE}`), qs);
});

test('uložený filtr s tokenem přežije localStorage round-trip', () => {
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const st = new Store('empty-token', { storage });
  const state = emptyState();
  state.filters = { zeme: EMPTY_FILTER_VALUE, obor: ['IT', EMPTY_FILTER_VALUE] };
  st.save(state);
  const loaded = st.load();
  assert.equal(loaded.filters.zeme, EMPTY_FILTER_VALUE);
  assert.deepEqual(loaded.filters.obor, ['IT', EMPTY_FILTER_VALUE]);

  // snímek sloupcových filtrů (uložené filtry / preset) token unese taky
  const grid = {
    filters: state.filters,
    columns: [
      { field: 'zeme', filter: 'select', defaultFilter: 'select' },
      { field: 'obor', filter: 'multiselect', defaultFilter: 'select', availableFilters: ['select', 'multiselect'] },
    ],
    _activeColumnFilters: Lattice.prototype._activeColumnFilters,
    _captureColumnFilters: Lattice.prototype._captureColumnFilters,
    hasColumnFilters: Lattice.prototype.hasColumnFilters,
  };
  assert.equal(grid.hasColumnFilters(), true); // token = aktivní filtr (indikátor svítí)
  const snap = JSON.parse(JSON.stringify(grid._captureColumnFilters()));
  assert.equal(snap.filters.zeme, EMPTY_FILTER_VALUE);
  assert.deepEqual(snap.filters.obor, ['IT', EMPTY_FILTER_VALUE]);
  assert.equal(snap.filterTypes.obor, 'multiselect'); // odchylka od výchozího typu
});
