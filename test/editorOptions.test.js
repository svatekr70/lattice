/**
 * Číselník editoru: `editorParams.values` nezávisle na `filterValues`, se
 * ZACHOVANÝMI hodnotami. Teprve tím jde editovat sloupec se třemi stavy
 * (`true` / `false` / `null`) napřímo, místo textového protějšku v datech —
 * tedy dvou zdrojů pravdy v jednom řádku.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOptions, sameOptionValue } from '../src/features/editing.js';
import { EMPTY_FILTER_VALUE } from '../src/filters/index.js';

test('editorParams.values má přednost a hodnoty nepřevádí na řetězec', async () => {
  const col = {
    field: 'completed',
    filterValues: ['Ano', 'Ne'],                       // číselník FILTRU (řetězce)
    editorParams: { values: [
      { value: true, label: 'Ano' },
      { value: false, label: 'Ne' },
      { value: null, label: 'Neuvedeno' },
    ] },
  };
  const opts = await loadOptions(col);
  assert.deepEqual(opts.map((o) => o.value), [true, false, null]);
  assert.deepEqual(opts.map((o) => o.label), ['Ano', 'Ne', 'Neuvedeno']);
});

test('bez editorParams.values se číselník sdílí s filtrem (řetězce, bez tokenu „(prázdné)")', async () => {
  const opts = await loadOptions({ field: 'state', filterValues: ['open', { value: 2, label: 'Hotovo' }, EMPTY_FILTER_VALUE] });
  assert.deepEqual(opts, [{ value: 'open', label: 'open' }, { value: '2', label: 'Hotovo' }]);
});

test('editorParams.values zvládne i holé hodnoty', async () => {
  const opts = await loadOptions({ field: 'p', editorParams: { values: [1, 2, 3] } });
  assert.deepEqual(opts.map((o) => o.value), [1, 2, 3]);
  assert.deepEqual(opts.map((o) => o.label), ['1', '2', '3']);
});

test('sameOptionValue: null je vlastní stav, nesplývá s prázdnem ani s false', () => {
  assert.equal(sameOptionValue(null, null), true);
  assert.equal(sameOptionValue(false, false), true);
  assert.equal(sameOptionValue(true, true), true);
  assert.equal(sameOptionValue(null, false), false);
  assert.equal(sameOptionValue(null, ''), false);
  assert.equal(sameOptionValue(false, ''), false);
  // Tolerance na číslo vs. řetězec a velikost písmen (číselník z API vs. data).
  assert.equal(sameOptionValue(2, '2'), true);
  assert.equal(sameOptionValue('Open', 'open'), true);
  assert.equal(sameOptionValue(true, 'true'), true, 'filterValues nesou řetězce');
});

test('která volba je v tříhodnotovém sloupci aktivní', async () => {
  const col = { field: 'completed', editorParams: { values: [
    { value: true, label: 'Ano' }, { value: false, label: 'Ne' }, { value: null, label: 'Neuvedeno' },
  ] } };
  const opts = await loadOptions(col);
  const active = (cell) => opts.findIndex((o) => sameOptionValue(o.value, cell));
  assert.equal(active(true), 0);
  assert.equal(active(false), 1);
  assert.equal(active(null), 2);
  assert.equal(active(undefined), 2, 'chybějící údaj padne na volbu pro null');
});
