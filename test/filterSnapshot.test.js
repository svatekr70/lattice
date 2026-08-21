import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/filters/index.js'; // registruje built-in filtry (getFilter uvnitř Lattice)
import { Lattice } from '../src/Lattice.js';

/**
 * Mock kontextu pro volání metod snímků sloupcových filtrů přes prototyp (bez DOM).
 * Naváže potřebné metody z prototypu a doplní stuby (renderer, saveState, refresh…).
 */
function makeGrid({ global = false } = {}) {
  const ctx = {
    filters: {},
    advanced: null,
    page: 1,
    state: { advancedFilters: [] },
    globalAdvanced: [],
    store: { save() {} },
    renderer: { renderToolbar() {}, renderHeader() {}, applyLayout() {} },
    options: global ? { onSaveGlobalAdvancedFilter() {} } : {},
    columns: [
      { field: 'name', filter: 'text', defaultFilter: 'text', availableFilters: ['text', 'select', 'multiselect'] },
      { field: 'due', filter: 'date-range', defaultFilter: 'date-range', availableFilters: ['date-range', 'date-two', 'dynamic'] },
    ],
    // stuby vedlejších efektů
    saveState() {}, refresh() {}, _emitFilter() {}, _clearActivePreset() {},
    clearAdvanced() { this.advanced = null; },
    applyAdvanced(tree) { this.advanced = tree; },
  };
  const bind = [
    '_saveNamedFilter', 'listAdvanced', 'activeSavedId', 'buttonAdvanced', 'toggleSavedAdvanced',
    '_isSnapshot', '_isSavedActive', '_sameFilters', '_activeColumnFilters', 'hasColumnFilters',
    '_captureColumnFilters', 'saveFilterSnapshot', 'applyFiltersSnapshot', 'clearColumnFilters',
    'overwriteSavedFilter', 'renameSavedFilter', 'deleteAdvanced', 'setAdvancedDisplay',
  ];
  for (const m of bind) ctx[m] = Lattice.prototype[m];
  return ctx;
}

test('_captureColumnFilters — jen neprázdné hodnoty + odchylky typu', () => {
  const g = makeGrid();
  g.filters = { name: 'abc', due: { from: '2024-01-01', to: null }, empty: { from: null, to: null } };
  g.columns.push({ field: 'empty', filter: 'date-range', defaultFilter: 'date-range', availableFilters: ['date-range', 'date-two'] });
  const snap = g._captureColumnFilters();
  assert.deepEqual(Object.keys(snap.filters).sort(), ['due', 'name']); // 'empty' (prázdný date-range) vypadl
  assert.deepEqual(snap.filterTypes, {}); // oba výchozí typy → žádná odchylka
});

test('_captureColumnFilters — zaznamená nestandardní typ filtru', () => {
  const g = makeGrid();
  g.columns[1].filter = 'dynamic'; // uživatel přepnul 'due' na dynamický
  g.filters = { due: '>today-14 AND <today+14' };
  const snap = g._captureColumnFilters();
  assert.deepEqual(snap.filterTypes, { due: 'dynamic' });
});

test('_captureColumnFilters / hasColumnFilters — prázdné = null / false', () => {
  const g = makeGrid();
  assert.equal(g._captureColumnFilters(), null);
  assert.equal(g.hasColumnFilters(), false);
  g.filters = { name: 'x' };
  assert.equal(g.hasColumnFilters(), true);
});

test('saveFilterSnapshot — uloží kind:columns + filters (lokálně)', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const item = g.saveFilterSnapshot('Moje', 'local', true);
  assert.equal(item.kind, 'columns');
  assert.equal(item.asButton, true);
  assert.deepEqual(item.filters, { name: 'abc' });
  assert.equal(g.state.advancedFilters.length, 1);
  // objeví se ve společném seznamu
  assert.equal(g.listAdvanced()[0].kind, 'columns');
});

test('saveFilterSnapshot — bez aktivního filtru vrací null', () => {
  const g = makeGrid();
  assert.equal(g.saveFilterSnapshot('X', 'local'), null);
});

test('saveFilterSnapshot (global) — callback dostane kind + filters', () => {
  const g = makeGrid({ global: true });
  let cb = null;
  g.options.onSaveGlobalAdvancedFilter = (x) => { cb = x; };
  g.filters = { name: 'abc' };
  g.saveFilterSnapshot('Sdílené', 'global', false);
  assert.equal(cb.kind, 'columns');
  assert.deepEqual(cb.filters, { name: 'abc' });
  assert.equal(g.globalAdvanced.length, 1);
});

test('applyFiltersSnapshot — obnoví filtry i typ sloupce', () => {
  const g = makeGrid();
  const snap = { filters: { due: '>today-1y' }, filterTypes: { due: 'dynamic' } };
  g.applyFiltersSnapshot(snap);
  assert.deepEqual(g.filters, { due: '>today-1y' });
  assert.equal(g.columns[1].filter, 'dynamic'); // typ obnoven
  assert.equal(g.page, 1);
});

test('activeSavedId — snímek se pozná podle shody filtrů (nezávisle na pořadí)', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const item = g.saveFilterSnapshot('Moje', 'local', false);
  // stejné filtry v jiném pořadí klíčů
  g.filters = { name: 'abc' };
  assert.equal(g.activeSavedId(), item.id);
  g.filters = { name: 'jiné' };
  assert.equal(g.activeSavedId(), '');
});

test('activeSavedId — prázdný objekt ve filtrech nerozbije shodu snímku', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const item = g.saveFilterSnapshot('Moje', 'local', false);
  // 'due' zůstane jako prázdný date-range objekt (jako by ho uživatel vyprázdnil)
  g.filters = { name: 'abc', due: { from: null, to: null } };
  assert.equal(g.activeSavedId(), item.id, 'prázdné pole se ignoruje');
});

test('toggleSavedAdvanced — snímek: aplikuj, pak zruš sloupcové filtry', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const item = g.saveFilterSnapshot('Moje', 'local', true);
  g.filters = {}; // deaktivováno
  g.toggleSavedAdvanced(item.id); // neaktivní → aplikuj
  assert.deepEqual(g.filters, { name: 'abc' });
  g.toggleSavedAdvanced(item.id); // aktivní → zruš
  assert.deepEqual(g.filters, {});
});

test('clearColumnFilters — vyčistí jen sloupcové (advanced nechá)', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  g.advanced = { combinator: 'AND', rules: [{ field: 'x', op: 'eq', value: '1' }] };
  g.clearColumnFilters();
  assert.deepEqual(g.filters, {});
  assert.ok(g.advanced); // rozšířený filtr zůstal
});


/* ---- úprava uloženého filtru: přepsání aktuálními filtry, přejmenování ---- */

test('overwriteSavedFilter — přepíše snímek tím, co je právě v hlavičce', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const orig = g.saveFilterSnapshot('Moje', 'local', { button: true, select: false });

  g.filters = { name: 'xyz' };                 // uživatel si naklikal jiné filtry
  const saved = g.overwriteSavedFilter(orig.id);
  assert.equal(saved.id, orig.id, 'stejná položka (id se drží)');
  assert.deepEqual(saved.filters, { name: 'xyz' });
  assert.equal(saved.name, 'Moje', 'název zůstává');
  assert.equal(saved.asButton, true, 'volby zobrazení zůstávají');
  assert.equal(saved.asSelect, false);
  assert.equal(g.state.advancedFilters.length, 1, 'nevznikla druhá položka');
});

test('overwriteSavedFilter — bez aktivního filtru neudělá nic', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const orig = g.saveFilterSnapshot('Moje', 'local');
  g.filters = {};
  assert.equal(g.overwriteSavedFilter(orig.id), null);
  assert.deepEqual(g.state.advancedFilters[0].filters, { name: 'abc' }, 'původní snímek zůstal');
});

test('renameSavedFilter — změní jen název, obsah a id zůstanou', () => {
  const g = makeGrid();
  g.filters = { name: 'abc' };
  const orig = g.saveFilterSnapshot('Staré', 'local', { button: true });
  const renamed = g.renameSavedFilter(orig.id, '  Nové  ');
  assert.equal(renamed.id, orig.id);
  assert.equal(renamed.name, 'Nové');
  assert.deepEqual(renamed.filters, { name: 'abc' });
  assert.equal(renamed.asButton, true);
  assert.deepEqual(g.state.advancedFilters.map((f) => f.name), ['Nové'], 'stará položka nezůstala');
  assert.equal(g.renameSavedFilter(orig.id, '   '), null, 'prázdný název se ignoruje');
});

test('renameSavedFilter — název, který už existuje, tu druhou položku nahradí', () => {
  const g = makeGrid();
  g.filters = { name: 'a' };
  const first = g.saveFilterSnapshot('První', 'local');
  g.filters = { name: 'b' };
  g.saveFilterSnapshot('Druhý', 'local');
  g.renameSavedFilter(first.id, 'Druhý');
  assert.deepEqual(g.state.advancedFilters.map((f) => f.name), ['Druhý']);
  assert.deepEqual(g.state.advancedFilters[0].filters, { name: 'a' }, 'zůstal ten přejmenovaný');
});
