import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresetStore, normalizeDisplay } from '../src/features/presets.js';
import { Lattice } from '../src/Lattice.js';
import { buildColumns } from '../src/core/ColumnModel.js';

/** Minimální fake grid — PresetStore sahá jen na tohle. */
function fakeGrid(globalAdapter = null) {
  return {
    state: { presets: [] },
    options: { presets: globalAdapter ? { global: globalAdapter } : null },
    saved: 0,
    saveState() { this.saved++; },
    captureState() { return { columns: [{ field: 'a', visible: true, width: 100, frozen: false }], sort: [], filters: {} }; },
  };
}

test('lokální preset: uložení, seznam, smazání', () => {
  const grid = fakeGrid();
  const ps = new PresetStore(grid);
  assert.equal(ps.hasAdapter(), false);
  assert.equal(ps.canSaveGlobal(), false);

  const p = ps.saveLocal('Můj pohled');
  assert.equal(p.name, 'Můj pohled');
  assert.equal(ps.local().length, 1);
  assert.equal(grid.saved, 1);

  const all = ps.all();
  assert.equal(all[0].scope, 'local');

  ps.remove({ ...p, scope: 'local' });
  assert.equal(ps.local().length, 0);
});

test('stejný název přepíše lokální preset', () => {
  const ps = new PresetStore(fakeGrid());
  ps.saveLocal('X');
  ps.saveLocal('X');
  assert.equal(ps.local().length, 1);
});

test('prázdný název se neuloží', () => {
  const ps = new PresetStore(fakeGrid());
  assert.equal(ps.saveLocal('   '), null);
  assert.equal(ps.local().length, 0);
});

test('globální presety přes adaptér aplikace', async () => {
  const store = [];
  const adapter = {
    load: async () => store.slice(),
    save: async (preset) => { store.push(preset); return preset; },
    remove: async (id) => { const i = store.findIndex((p) => p.id === id); if (i >= 0) store.splice(i, 1); },
  };
  const ps = new PresetStore(fakeGrid(adapter));
  assert.equal(ps.hasAdapter(), true);
  assert.equal(ps.canSaveGlobal(), true);

  await ps.loadGlobals();
  assert.equal(ps.globals.length, 0);

  const g = ps.saveGlobal('Firemní');
  assert.equal(g.scope, 'global');
  assert.equal(store.length, 1);
  assert.equal(ps.all().find((p) => p.scope === 'global').name, 'Firemní');

  await ps.remove(g);
  assert.equal(store.length, 0);
  assert.equal(ps.globals.length, 0);
});

test('globální presety přes callback + init pole', async () => {
  const saved = [];
  const removed = [];
  const grid = {
    state: { presets: [] }, saved: 0,
    options: {
      globalPresets: [{ id: 'g1', name: 'Firemní', state: {} }],
      onSaveGlobalPreset: (p) => saved.push(p),
      onDeleteGlobalPreset: (p) => removed.push(p),
    },
    saveState() { this.saved++; },
    captureState() { return { columns: [], sort: [], filters: {} }; },
  };
  const ps = new PresetStore(grid);
  assert.equal(ps.hasAdapter(), false);        // init pole není adaptér
  assert.equal(ps.canSaveGlobal(), true);      // callback → lze ukládat
  assert.equal(ps.globals.length, 1);          // předané pole
  assert.equal(ps.all().find((p) => p.scope === 'global').name, 'Firemní');

  const g = ps.saveGlobal('Nový');
  assert.equal(g.scope, 'global');
  assert.equal(ps.globals.length, 2);
  assert.equal(saved.length, 1);               // callback dostal preset
  assert.equal(saved[0].name, 'Nový');

  await ps.remove(g);
  assert.equal(ps.globals.length, 1);
  assert.equal(removed.length, 1);
});

test('preset „jako tlačítko" / „jako výběr": uložení, seznamy, přepnutí', () => {
  const grid = fakeGrid();
  const ps = new PresetStore(grid);

  const plain = ps.saveLocal('Jen v panelu');
  assert.equal(plain.asButton, false);
  assert.equal(plain.asSelect, false, 'bez volby preset v toolbaru není');
  assert.deepEqual(ps.buttons(), []);
  assert.deepEqual(ps.selects(), []);

  const pinned = ps.saveLocal('S tlačítkem', null, { button: true });
  assert.equal(pinned.asButton, true);
  assert.deepEqual(ps.buttons().map((p) => p.name), ['S tlačítkem']);

  const listed = ps.saveLocal('Ve výběru', null, { select: true });
  assert.equal(listed.asSelect, true);
  assert.deepEqual(ps.selects().map((p) => p.name), ['Ve výběru']);

  // přepnutí u už uloženého presetu (bez opětovného ukládání pod jménem)
  ps.setDisplay({ ...plain, scope: 'local' }, 'asButton', true);
  assert.deepEqual(ps.buttons().map((p) => p.name).sort(), ['Jen v panelu', 'S tlačítkem']);
  ps.setDisplay({ ...pinned, scope: 'local' }, 'asButton', false);
  assert.deepEqual(ps.buttons().map((p) => p.name), ['Jen v panelu']);
  ps.setDisplay({ ...listed, scope: 'local' }, 'asSelect', false);
  assert.deepEqual(ps.selects(), []);
});

test('přepsání lokálního presetu stejným názvem zachová id', () => {
  const ps = new PresetStore(fakeGrid());
  const first = ps.saveLocal('X');
  const second = ps.saveLocal('X', null, { button: true, select: true });
  assert.equal(second.id, first.id, 'stejný název = tatáž položka (downstream upsert)');
  assert.equal(ps.local().length, 1);
  assert.equal(ps.local()[0].asButton, true);
  assert.equal(ps.local()[0].asSelect, true);
});

test('globální preset: volba zobrazení projde callbackem a jde přepnout', () => {
  const saved = [];
  const grid = {
    state: { presets: [] }, saved: 0,
    options: { onSaveGlobalPreset: (p) => saved.push(p) },
    saveState() { this.saved++; },
    captureState() { return { columns: [], sort: [], filters: {} }; },
  };
  const ps = new PresetStore(grid);

  const g = ps.saveGlobal('Firemní', null, { button: true, select: true });
  assert.equal(g.asButton, true);
  assert.equal(saved[0].asButton, true, 'aplikace dostane i volbu zobrazení');
  assert.equal(saved[0].asSelect, true);
  assert.deepEqual(ps.buttons().map((p) => p.name), ['Firemní']);

  ps.setDisplay(g, 'asButton', false);
  assert.deepEqual(ps.buttons(), []);
  assert.deepEqual(ps.selects().map((p) => p.name), ['Firemní']);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].asButton, false, 'změna se pošle aplikaci k uložení');
});

test('normalizeDisplay: objekt, legacy boolean i výchozí hodnota', () => {
  assert.deepEqual(normalizeDisplay({ button: true, select: false }), { asButton: true, asSelect: false });
  assert.deepEqual(normalizeDisplay(true), { asButton: true, asSelect: false }, 'legacy asButton=true → jen tlačítko');
  assert.deepEqual(normalizeDisplay(false), { asButton: false, asSelect: true }, 'legacy asButton=false → jen výběr');
  assert.deepEqual(normalizeDisplay(undefined), { asButton: false, asSelect: true });
  assert.deepEqual(normalizeDisplay(undefined, { asButton: false, asSelect: false }), { asButton: false, asSelect: false });
});

/* ---- captureState / applyPreset: nastavení tabulky (instance) v presetu ---- */

/**
 * Grid bez DOM: metody z prototypu, data a rendery jako stuby (stejný trik jako
 * v latticeMethods.test.js).
 */
function latticeCtx(instance = {}) {
  const ctx = Object.create(Lattice.prototype);
  const noop = () => {};
  Object.assign(ctx, {
    options: {},
    columnDefs: [{ field: 'a' }, { field: 'b' }],
    sort: [], filters: {}, page: 1,
    state: {},
    instance: Object.assign({
      pageSize: 50, groupBy: null, groupDisplay: 'headers', groupRepeat: true,
      summaryRow: 'none', groupSubtotals: false, externalFiltersCollapsed: false,
      cssVars: {},
    }, instance),
    renderer: { applyInstanceStyles: noop, renderToolbar: noop, renderHeader: noop, renderBody: noop, applyLayout: noop },
    groupsCollapsed: new Set(), colGroupsCollapsed: new Set(),
    saveState: noop,
    refresh: noop,
  });
  ctx.pageSize = ctx.instance.pageSize;
  ctx.columns = buildColumns(ctx.columnDefs, []);
  return ctx;
}

test('captureState: preset nese seskupení, souhrnný řádek i mezisoučty', () => {
  const grid = latticeCtx({ groupBy: ['a'], summaryRow: 'all', groupSubtotals: true, externalFiltersCollapsed: true });
  const st = grid.captureState();
  assert.deepEqual(st.instance.groupBy, ['a']);
  assert.equal(st.instance.summaryRow, 'all');
  assert.equal(st.instance.groupSubtotals, true);
  assert.equal('externalFiltersCollapsed' in st.instance, false, 'přechodný UI stav se do presetu nekopíruje');
});

test('captureState: snapshot je hluboká kopie (pozdější změna instance ho nezmění)', () => {
  const grid = latticeCtx({ groupBy: [{ field: 'a', part: 'month' }] });
  const st = grid.captureState();
  grid.instance.groupBy[0].part = 'year';
  grid.instance.cssVars['--lattice-accent'] = '#f00';
  assert.equal(st.instance.groupBy[0].part, 'month');
  assert.deepEqual(st.instance.cssVars, {});
});

test('applyPreset: nastavení z presetu se nasadí, pageSize se synchronizuje', () => {
  const grid = latticeCtx();
  grid.instance.externalFiltersCollapsed = true; // uživatelův sbalený panel
  grid.applyPreset({ id: 'p1', state: {
    columns: [], sort: [], filters: {},
    instance: { groupBy: ['a'], summaryRow: 'page', groupSubtotals: true, pageSize: 25 },
  } });
  assert.deepEqual(grid.instance.groupBy, ['a']);
  assert.equal(grid.instance.summaryRow, 'page');
  assert.equal(grid.instance.groupSubtotals, true);
  assert.equal(grid.pageSize, 25, 'pager čte this.pageSize');
  assert.equal(grid.instance.groupDisplay, 'headers', 'volba mimo snapshot spadne na výchozí');
  assert.equal(grid.instance.externalFiltersCollapsed, true, 'přechodný UI stav zůstává uživateli');
});

test('togglePreset: druhý klik vrátí výchozí zobrazení, filtry a řazení zůstanou', () => {
  const grid = latticeCtx({ groupBy: ['b'], summaryRow: 'all', pageSize: 100 });
  grid.pageSize = 100;
  grid.sort = [{ field: 'a', dir: 'asc' }];
  grid.filters = { a: 'x' };
  const preset = { id: 'p1', state: { columns: [], instance: { groupBy: ['a'], summaryRow: 'page', pageSize: 25 } } };

  grid.togglePreset(preset);                    // 1. klik = použít
  assert.equal(grid._activePresetId, 'p1');
  assert.deepEqual(grid.instance.groupBy, ['a']);

  grid.togglePreset(preset);                    // 2. klik = výchozí zobrazení
  assert.equal(grid._activePresetId, null);
  assert.deepEqual(grid.instance.groupBy, null, 'seskupení spadlo na výchozí');
  assert.equal(grid.instance.summaryRow, 'none');
  assert.equal(grid.pageSize, grid.instance.pageSize);
  assert.deepEqual(grid.sort, [{ field: 'a', dir: 'asc' }], 'řazení zůstává');
  assert.deepEqual(grid.filters, { a: 'x' }, 'filtry zůstávají v platnosti');
});

test('resetView: respektuje options.instance a nechá přechodný stav UI', () => {
  const grid = latticeCtx({ groupBy: ['a'], externalFiltersCollapsed: true });
  grid.options.instance = { summaryRow: 'all', pageSize: 30 };
  grid.resetView();
  assert.equal(grid.instance.summaryRow, 'all', 'výchozí = options.instance, ne natvrdo prázdno');
  assert.equal(grid.pageSize, 30);
  assert.equal(grid.instance.externalFiltersCollapsed, true, 'sbalený panel filtrů zůstává uživateli');
  assert.deepEqual(grid.state.columns, []);
});

test('applyPreset: starý preset (bez instance) nastavení tabulky nemění', () => {
  const grid = latticeCtx({ groupBy: ['b'], summaryRow: 'all', groupSubtotals: true, pageSize: 100 });
  grid.pageSize = 100;
  grid.applyPreset({ id: 'old', state: { columns: [], sort: [{ field: 'a', dir: 'asc' }], filters: {} } });
  assert.deepEqual(grid.instance.groupBy, ['b']);
  assert.equal(grid.instance.summaryRow, 'all');
  assert.equal(grid.instance.groupSubtotals, true);
  assert.equal(grid.pageSize, 100);
  assert.deepEqual(grid.sort, [{ field: 'a', dir: 'asc' }], 'sloupce/řazení/filtry se aplikují dál');
});

test('captureState(parts): uloží jen vybrané části', () => {
  const grid = latticeCtx({ groupBy: ['a'] });
  grid.sort = [{ field: 'a', dir: 'asc' }];
  grid.filters = { a: 'x' };

  const onlyCols = grid.captureState({ columns: true, filters: false, instance: false });
  assert.equal(Array.isArray(onlyCols.columns), true);
  assert.equal('sort' in onlyCols, false);
  assert.equal('filters' in onlyCols, false);
  assert.equal('instance' in onlyCols, false);

  const onlyTable = grid.captureState({ columns: false, filters: false, instance: true });
  assert.deepEqual(Object.keys(onlyTable), ['instance']);

  const onlyFilters = grid.captureState({ columns: false, filters: true, instance: false });
  assert.deepEqual(onlyFilters.sort, [{ field: 'a', dir: 'asc' }]);
  assert.deepEqual(onlyFilters.filters, { a: 'x' });

  assert.deepEqual(Object.keys(grid.captureState()).sort(), ['columns', 'filters', 'instance', 'sort'], 'bez argumentu = vše');
});

test('applyPreset: část, kterou preset nenese, se nemění', () => {
  const grid = latticeCtx({ groupBy: ['a'], summaryRow: 'all' });
  grid.sort = [{ field: 'b', dir: 'desc' }];
  grid.filters = { b: 'keep' };
  const before = grid.columns;

  // preset „jen nastavení tabulky"
  grid.applyPreset({ id: 'p', state: { instance: { groupBy: null, summaryRow: 'none' } } });
  assert.equal(grid.instance.groupBy, null);
  assert.deepEqual(grid.sort, [{ field: 'b', dir: 'desc' }], 'řazení zůstává');
  assert.deepEqual(grid.filters, { b: 'keep' }, 'filtry zůstávají');
  assert.equal(grid.columns, before, 'sloupce se ani nepřestavují');

  // preset „jen filtry a řazení"
  grid.applyPreset({ id: 'p2', state: { sort: [], filters: {} } });
  assert.deepEqual(grid.sort, []);
  assert.deepEqual(grid.filters, {});
  assert.equal(grid.instance.summaryRow, 'none', 'nastavení tabulky se nepřepsalo');
});

test('presetContents: co preset nese (i u starých presetů)', () => {
  const grid = latticeCtx();
  assert.deepEqual(grid.presetContents({ state: { columns: [], sort: [], filters: {} } }),
    { columns: true, filters: true, instance: false }, 'starý preset = bez nastavení tabulky');
  assert.deepEqual(grid.presetContents({ state: { instance: {} } }),
    { columns: false, filters: false, instance: true });
  assert.deepEqual(grid.presetContents({}), { columns: false, filters: false, instance: false });
});

test('PresetStore: parts se propíšou do captureState', () => {
  const seen = [];
  const grid = {
    state: { presets: [] }, options: {},
    saveState() {},
    captureState(parts) { seen.push(parts); return {}; },
  };
  const ps = new PresetStore(grid);
  ps.saveLocal('A', { columns: true, filters: false, instance: true });
  assert.deepEqual(seen[0], { columns: true, filters: false, instance: true });
});

test('resetColumns: vrátí i seskupení řádků a zahodí sbalené skupiny', () => {
  const grid = latticeCtx({ groupBy: ['a'], groupDisplay: 'columns', groupRepeat: false, summaryRow: 'all', theme: 'slate', groupColWidths: { a: 260 } });
  grid.groupsCollapsed.add('Praha');
  grid.colGroupsCollapsed.add('Kontakt');
  grid.rerenderColumns = () => {};

  grid.resetColumns();

  assert.equal(grid.instance.groupBy, null, 'seskupení zpět na výchozí');
  assert.equal(grid.instance.groupDisplay, 'headers');
  assert.equal(grid.instance.groupRepeat, true);
  assert.equal(grid.groupsCollapsed.size, 0);
  assert.equal(grid.colGroupsCollapsed.size, 0);
  assert.deepEqual(grid.instance.groupColWidths, {}, 'i šířky vedoucích sloupců seskupení');
  assert.equal(grid.instance.summaryRow, 'all', 'nastavení tabulky mimo dialog sloupců zůstává');
  assert.equal(grid.instance.theme, 'slate');
  assert.deepEqual(grid.state.columns, []);
});

test('resetColumns: respektuje options.instance jako výchozí seskupení', () => {
  const grid = latticeCtx({ groupBy: ['a'] });
  grid.options = { instance: { groupBy: ['b'] } };
  grid.rerenderColumns = () => {};
  grid.resetColumns();
  assert.deepEqual(grid.instance.groupBy, ['b'], 'výchozí z konfigurace aplikace, ne prázdno');
});

test('skupina presetu: uložení, přepnutí, zrušení', () => {
  const grid = fakeGrid();
  const ps = new PresetStore(grid);

  const p = ps.saveLocal('Prodeje dnes', null, { select: true }, '  Prodeje  ');
  assert.equal(p.group, 'Prodeje', 'skupina se ořízne');

  const plain = ps.saveLocal('Bez skupiny', null, { select: true });
  assert.equal('group' in plain, false, 'prázdná skupina se neukládá');

  ps.setGroup({ ...plain, scope: 'local' }, 'Faktury');
  assert.equal(ps.local().find((x) => x.name === 'Bez skupiny').group, 'Faktury');

  ps.setGroup({ ...p, scope: 'local' }, '');
  assert.equal('group' in ps.local().find((x) => x.name === 'Prodeje dnes'), false, 'prázdná skupina ji zruší');
});

test('skupina globálního presetu projde callbackem', () => {
  const saved = [];
  const grid = {
    state: { presets: [] },
    options: { onSaveGlobalPreset: (p) => saved.push(p) },
    saveState() {},
    captureState() { return {}; },
  };
  const ps = new PresetStore(grid);
  const g = ps.saveGlobal('Firemní', null, { select: true }, 'Prodeje');
  assert.equal(saved[0].group, 'Prodeje');

  ps.setGroup(g, 'Faktury');
  assert.equal(saved[1].group, 'Faktury');
  assert.equal(ps.globals[0].group, 'Faktury');
});
