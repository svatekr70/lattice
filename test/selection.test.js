import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lattice } from '../src/Lattice.js';

/**
 * Mock kontextu pro výběr řádků (bez DOM). `serverSide` = zdroj dat neumí `allRows()`,
 * takže grid nezná klíče nezobrazených stránek (jako u ServerData).
 */
function makeGrid({ serverSide = false, total = 365, pageRows = 50 } = {}) {
  const rows = Array.from({ length: pageRows }, (_, i) => ({ id: i + 1 }));
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const ctx = {
    rows, total,
    keyField: 'id',
    selectable: { enabled: true, mode: 'multi' },
    selected: new Set(),
    selectScope: 'page',
    selectAllFiltered: false,
    selectExcept: new Set(),
    options: {},
    dataSource: serverSide ? {} : { data: all, allRows: () => all },
    renderer: { updateSelectionUI() {}, updateSelectAllCheckbox() {}, updateFilterClearBtn() {} },
  };
  const bind = [
    'isSelectable', 'rowKey', 'isSelected', 'setRowSelected', 'toggleRow', 'selectKeys',
    'setSelectScope', 'scopeRows', 'pageCount', 'filteredCount', 'selectedCount',
    'isScopeAllSelected', 'toggleScopeSelection', 'invertSelection', 'clearSelection',
    'selectPage', 'selectAllRecords', 'isPageAllSelected', 'isAllRecordsSelected',
    'selectAll', 'getSelection', 'getSelectedKeys', 'getSelectedRows',
    '_afterSelectionChange', '_resetSelectAllScope',
  ];
  for (const m of bind) ctx[m] = Lattice.prototype[m];
  return ctx;
}

test('pageCount — kolik řádků je opravdu na stránce (poslední stránka je kratší)', () => {
  assert.equal(makeGrid({ pageRows: 50 }).pageCount(), 50);
  assert.equal(makeGrid({ pageRows: 15 }).pageCount(), 15, 'poslední stránka s 15 řádky');
});

test('filteredCount — server-side bere total, ne jen načtenou stránku', () => {
  const server = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  assert.equal(server.filteredCount(), 365, 'popisek „Všechny záznamy (365)"');
  const client = makeGrid({ total: 365, pageRows: 50 });
  assert.equal(client.filteredCount(), 365);
});

test('rozsah „stránka" vybere jen zobrazené řádky', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.setSelectScope('page');
  g.toggleScopeSelection();
  assert.equal(g.selectedCount(), 50);
  assert.equal(g.selectAllFiltered, false);
  assert.equal(g.isSelected('300'), false, 'řádky mimo stránku vybrané nejsou');
});

test('rozsah „všechny záznamy" server-side vybere i nezobrazené (příznak + výjimky)', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  assert.equal(g.selectAllFiltered, true);
  assert.equal(g.selectedCount(), 365, 'vybráno je všech 365, i to, co není vidět');
  assert.equal(g.isSelected('300'), true, 'řádek z jiné stránky se ukáže vybraný, až na ni vstoupíš');

  g.setRowSelected('7', false);                 // ruční odškrtnutí = výjimka
  assert.equal(g.isSelected('7'), false);
  assert.equal(g.selectedCount(), 364);
  assert.deepEqual(g.getSelection(), { all: true, count: 364, keys: [], excluded: ['7'] });

  g.setRowSelected('7', true);
  assert.equal(g.selectedCount(), 365);
});

test('rozsah „všechny záznamy" client-side vyjmenuje klíče (aplikace je dostane)', () => {
  const g = makeGrid({ total: 40, pageRows: 10 });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  assert.equal(g.selectAllFiltered, false);
  assert.equal(g.selectedCount(), 40);
  assert.equal(g.getSelectedKeys().length, 40);
});

test('odškrtnutí hlavičkového checkboxu v režimu „vybráno vše" zruší celý výběr', () => {
  const g = makeGrid({ serverSide: true });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  g.toggleScopeSelection();
  assert.equal(g.selectAllFiltered, false);
  assert.equal(g.selectedCount(), 0);
});

test('rozsah „stránka" v režimu „vybráno vše" odškrtne jen zobrazené řádky', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  g.setSelectScope('page');
  g.toggleScopeSelection();                     // vypnout stránku
  assert.equal(g.selectAllFiltered, true);
  assert.equal(g.selectedCount(), 315, '365 minus 50 zobrazených');
});

test('invertovat výběr v režimu „vybráno vše" nechá vybrané právě výjimky', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  g.setRowSelected('3', false);
  g.setRowSelected('9', false);
  g.invertSelection();
  assert.equal(g.selectAllFiltered, false);
  assert.deepEqual(g.getSelectedKeys().sort(), ['3', '9']);
});

test('změna filtru zruší režim „vybráno vše" (platil pro jinou množinu dat)', () => {
  const g = makeGrid({ serverSide: true });
  g.setSelectScope('all');
  g.toggleScopeSelection();
  g._resetSelectAllScope();
  assert.equal(g.selectAllFiltered, false);
  assert.equal(g.selectedCount(), 0);
});

test('onSelectionChange dostane i popis režimu (3. argument)', () => {
  const g = makeGrid({ serverSide: true, total: 365 });
  const calls = [];
  g.options.onSelectionChange = (rows, keys, info) => calls.push(info);
  g.setSelectScope('all');
  g.toggleScopeSelection();
  assert.equal(calls.at(-1).all, true);
  assert.equal(calls.at(-1).count, 365);
});

/* ---- volby v menu vybírají rovnou (dřív jen přepínaly rozsah) ---- */

test('selectPage — klik na „Stránka (N)" vybere zobrazené řádky', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.selectPage();
  assert.equal(g.selectScope, 'page');
  assert.equal(g.selectedCount(), 50);
  assert.equal(g.isPageAllSelected(), true);
  assert.equal(g.isSelected('300'), false);
});

test('selectAllRecords — klik na „Všechny záznamy (N)" vybere i nezobrazené', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.selectAllRecords();
  assert.equal(g.selectScope, 'all');
  assert.equal(g.selectAllFiltered, true);
  assert.equal(g.selectedCount(), 365);
  assert.equal(g.isAllRecordsSelected(), true);
  assert.equal(g.isSelected('300'), true);
});

test('selectAllRecords — client-side vyjmenuje klíče a obě volby se poznají', () => {
  const g = makeGrid({ total: 40, pageRows: 10 });
  g.selectPage();
  assert.equal(g.isPageAllSelected(), true);
  assert.equal(g.isAllRecordsSelected(), false, 'stránka ano, všechny záznamy ne');
  g.selectAllRecords();
  assert.equal(g.selectedCount(), 40);
  assert.equal(g.isAllRecordsSelected(), true);
  assert.equal(g.getSelectedKeys().length, 40);
});

test('selectPage v režimu „vybráno vše" vrátí zobrazené řádky zpět do výběru', () => {
  const g = makeGrid({ serverSide: true, total: 365, pageRows: 50 });
  g.selectAllRecords();
  g.setSelectScope('page');
  g.toggleScopeSelection();                 // odškrtnout stránku → výjimky
  assert.equal(g.selectedCount(), 315);
  g.selectPage();                           // a zase ji vybrat
  assert.equal(g.selectedCount(), 365);
  assert.equal(g.selectExcept.size, 0);
});
