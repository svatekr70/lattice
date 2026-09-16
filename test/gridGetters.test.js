/**
 * Čtecí protějšky k setterům: getFilter / getFilters / getData a dávkové
 * setColumnsVisible. Bez nich si aplikace musí vést vlastní evidenci toho, co
 * sama nastavila (přepínací tlačítka nad tabulkou), nebo grid při přepnutí
 * presetu sloupců zahodit a postavit znovu (ztratí řazení i stránku).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lattice } from '../src/Lattice.js';
import { ClientData } from '../src/core/DataSource.js';

const COLS = [
  { field: 'name', type: 'text', filter: 'text' },
  { field: 'state', type: 'text', filter: 'multiselect' },
  { field: 'date', type: 'date', filter: 'date-range' },
  { field: 'n', type: 'number', filter: 'number-range' },
];
const DATA = [
  { id: 1, name: 'alfa', state: 'open', date: '2026-08-10', n: 5 },
  { id: 2, name: 'beta', state: 'done', date: '2026-09-10', n: 15 },
  { id: 3, name: 'gama', state: 'open', date: '2026-08-20', n: 25 },
];

/** Grid bez DOM: metody z prototypu, render/persistence zaslepené. */
function grid(data = DATA) {
  const g = Object.create(Lattice.prototype);
  Object.assign(g, {
    dataSource: new ClientData(data),
    columns: COLS.map((c) => ({ ...c, visible: true })),
    filters: {}, sort: [], page: 1, pageSize: 50, rows: data.slice(),
    universal: null, advanced: null, quickSearch: '',
    saveState() {}, refresh() {}, rerenderColumns() {},
    _clearActivePreset() {}, _emitFilter() {},
    _emitColumnLayout(kind, detail) { this._layout = { kind, detail }; },
  });
  return g;
}

test('getFilter vrací hodnotu v tomtéž tvaru, jaký přijímá setFilter', () => {
  const g = grid();
  assert.equal(g.getFilter('name'), undefined, 'nenastavený filtr = undefined');
  g.setFilter('name', 'alfa');
  assert.equal(g.getFilter('name'), 'alfa');
  // Hodnotu lze rovnou vrátit zpátky do setFilter (kolečko drží tvar).
  g.setFilter('name', g.getFilter('name'));
  assert.equal(g.getFilter('name'), 'alfa');
  g.setFilter('name', null);
  assert.equal(g.getFilter('name'), undefined);
});

test('getFilter vrací NORMALIZOVANÝ tvar, ne to, co přišlo', () => {
  const g = grid();
  g.setFilter('date', '2026-08-01|2026-08-31');
  assert.deepEqual(g.getFilter('date'), { from: '2026-08-01', to: '2026-08-31' });
  g.setFilter('state', 'open');
  assert.deepEqual(g.getFilter('state'), ['open']);
});

test('přepínací tlačítko jde napsat bez jediné proměnné navíc', () => {
  const g = grid();
  const toggle = (vals) => {
    const cur = g.getFilter('state') || [];
    const same = cur.length === vals.length && vals.every((v) => cur.includes(v));
    g.setFilter('state', same ? null : vals);
    return !same; // je tlačítko aktivní?
  };
  assert.equal(toggle(['open']), true);
  assert.equal(toggle(['open']), false, 'druhý klik filtr zruší');
  assert.equal(g.getFilter('state'), undefined);
});

test('getFilters vrací mapu jen ÚČINNÝCH filtrů', () => {
  const g = grid();
  g.setFilter('name', 'alfa');
  g.setFilter('state', ['open', 'done']);
  assert.deepEqual(g.getFilters(), { name: 'alfa', state: ['open', 'done'] });
  // Neúčinná hodnota vložená do stavu natvrdo se v mapě ani v getFilter neobjeví.
  g.filters.n = { min: null, max: null };
  assert.deepEqual(Object.keys(g.getFilters()).sort(), ['name', 'state']);
  assert.equal(g.getFilter('n'), undefined);
});

test('getData: filtrovaná sada / stránka / celý dataset', async () => {
  const g = grid();
  await g.dataSource.query({ page: 1, pageSize: 2, paginate: true, sort: [{ field: 'n', dir: 'desc' }], filters: { n: { min: 10 } }, columns: g.columns });
  g.rows = [{ id: 3 }, { id: 2 }];
  assert.deepEqual(g.getData().map((r) => r.id), [3, 2], 'filtrovaná + seřazená sada');
  assert.deepEqual(g.getData('page').map((r) => r.id), [3, 2]);
  assert.deepEqual(g.getData('all').map((r) => r.id), [1, 2, 3], 'bez ohledu na filtr');
  // Kopie pole (zápis do výsledku nerozhodí grid), ale živé řádky.
  g.getData().push({ id: 99 });
  assert.equal(g.getData().length, 2);
  assert.equal(g.getData('all')[0], DATA[0]);
});

test('setColumnsVisible přepne dávku a překreslí jednou', () => {
  const g = grid();
  let renders = 0;
  g.rerenderColumns = () => { renders++; };
  g.setColumnsVisible({ name: true, state: false, date: false });
  assert.deepEqual(g.columns.map((c) => c.visible), [true, false, false, true]);
  assert.equal(renders, 1, 'jedno překreslení na celou dávku');
  assert.deepEqual(g._layout.detail.columns, [{ field: 'state', visible: false }, { field: 'date', visible: false }]);
  // Dávka, která nic nemění, nepřekresluje.
  g.setColumnsVisible({ name: true, state: false });
  assert.equal(renders, 1);
  // Neznámý sloupec se přeskočí, zbytek se provede.
  g.setColumnsVisible({ nesmysl: false, state: true });
  assert.equal(g.columns[1].visible, true);
  assert.equal(renders, 2);
});
