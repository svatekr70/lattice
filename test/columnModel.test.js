import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns, serializeColumns, deriveAvailableFilters, flattenGroups } from '../src/core/ColumnModel.js';

test('výchozí sestavení respektuje definici', () => {
  const cols = buildColumns([{ field: 'a' }, { field: 'b', width: 200 }], []);
  assert.deepEqual(cols.map((c) => c.field), ['a', 'b']);
  assert.equal(cols[0].width, 150); // default
  assert.equal(cols[1].width, 200);
  assert.equal(cols[0].visible, true);
});

test('uložené pořadí má přednost, nové sloupce jdou na konec', () => {
  const defs = [{ field: 'a' }, { field: 'b' }, { field: 'c' }];
  const saved = [{ field: 'c' }, { field: 'a' }]; // b chybí (přidán později v kódu)
  const cols = buildColumns(defs, saved);
  assert.deepEqual(cols.map((c) => c.field), ['c', 'a', 'b']);
});

test('sloupec zmizelý z definice se zahodí', () => {
  const cols = buildColumns([{ field: 'a' }], [{ field: 'x' }, { field: 'a' }]);
  assert.deepEqual(cols.map((c) => c.field), ['a']);
});

test('uložený stav přepíše visible/width/frozen', () => {
  const cols = buildColumns([{ field: 'a', frozen: true }], [{ field: 'a', visible: false, width: 90, frozen: false }]);
  assert.equal(cols[0].visible, false);
  assert.equal(cols[0].width, 90);
  assert.equal(cols[0].frozen, false);
});

test('frozen "right" se zachová (nekonvertuje na true)', () => {
  const cols = buildColumns([{ field: 'a' }], [{ field: 'a', frozen: 'right' }]);
  assert.equal(cols[0].frozen, 'right');
});

test('frozen:"never" zakáže ukotvení i z uloženého stavu', () => {
  const cols = buildColumns([{ field: 'a', frozen: 'never' }], [{ field: 'a', frozen: true }]);
  assert.equal(cols[0].frozen, false);
  assert.equal(cols[0].frozenAllowed, false);
});

test('serializace vytáhne jen persistovaná pole v aktuálním pořadí', () => {
  const cols = buildColumns([{ field: 'a', title: 'A' }, { field: 'b', title: 'B' }], []);
  cols[0].width = 111;
  const ser = serializeColumns(cols);
  assert.deepEqual(ser, [
    { field: 'a', visible: true, width: 111, frozen: false },
    { field: 'b', visible: true, width: 150, frozen: false },
  ]);
});

test('duplicitní field v definici vyhodí chybu', () => {
  assert.throws(() => buildColumns([{ field: 'a' }, { field: 'a' }], []), /duplicitní/);
});

test('výchozí zarovnání dle datového typu (přepsatelné align)', () => {
  const cols = buildColumns([
    { field: 'd', type: 'date' },
    { field: 'dt', type: 'datetime' },
    { field: 'n', type: 'number' },
    { field: 'b', type: 'boolean' },
    { field: 't', type: 'text' },
    { field: 'x', type: 'number', align: 'left' }, // explicitní má přednost
  ], []);
  assert.equal(cols[0].align, 'right');
  assert.equal(cols[1].align, 'right');
  assert.equal(cols[2].align, 'right');
  assert.equal(cols[3].align, 'center');
  assert.equal(cols[4].align, null);
  assert.equal(cols[5].align, 'left');
});

test('skupiny: zploští vnořené columns a přiřadí group leaf sloupcům', () => {
  const defs = [
    { field: 'id', title: 'ID' },
    { title: 'Kontakt', columns: [{ field: 'email' }, { field: 'phone' }] },
    { field: 'note' },
  ];
  const flat = flattenGroups(defs);
  assert.deepEqual(flat.map((d) => d.field), ['id', 'email', 'phone', 'note']);
  assert.equal(flat[1].group, 'Kontakt');
  assert.equal(flat[2].group, 'Kontakt');
  assert.equal(flat[0].group, undefined);

  const cols = buildColumns(defs, []);
  assert.deepEqual(cols.map((c) => c.field), ['id', 'email', 'phone', 'note']);
  assert.equal(cols[1].group, 'Kontakt');
  assert.equal(cols[0].group, null);
});

test('skupina: uživatelský override se persistuje jen když se liší od configu', () => {
  // config bez skupiny → default null, neukládá se
  let cols = buildColumns([{ field: 'a' }, { field: 'b' }], []);
  assert.equal(cols[0].group, null);
  assert.equal('group' in serializeColumns(cols)[0], false);

  // uživatel přiřadí skupinu → uloží se a načte zpět
  cols[0].group = 'G';
  assert.equal(serializeColumns(cols)[0].group, 'G');
  const restored = buildColumns([{ field: 'a' }, { field: 'b' }], [{ field: 'a', group: 'G' }]);
  assert.equal(restored[0].group, 'G');

  // ungroup přepíše konfigurační skupinu (persistuje null)
  const c2 = buildColumns([{ title: 'Grp', columns: [{ field: 'x' }] }], [{ field: 'x', group: null }]);
  assert.equal(c2[0].group, null);
});

/* --- přepínání typu filtru --- */

test('deriveAvailableFilters dle datového typu', () => {
  assert.deepEqual(deriveAvailableFilters({ field: 'n', type: 'number', filter: 'number' }), ['number', 'number-range']);
  assert.deepEqual(deriveAvailableFilters({ field: 'd', type: 'date', filter: 'date-range' }), ['date-range', 'date-two']);
  assert.deepEqual(deriveAvailableFilters({ field: 'b', type: 'boolean', filter: 'boolean' }), ['boolean']);
});

test('text vždy nabídne trojici text/select/multiselect', () => {
  // s číselníkem i bez něj — select/multiselect si hodnoty odvodí z dat
  assert.deepEqual(deriveAvailableFilters({ field: 'c', type: 'text', filter: 'text', filterValues: [{ value: 'x' }] }), ['text', 'select', 'multiselect']);
  assert.deepEqual(deriveAvailableFilters({ field: 'c', type: 'text', filter: 'text' }), ['text', 'select', 'multiselect']);
});

test('explicitní def.filterTypes má přednost a vždy obsahuje aktuální filtr', () => {
  const list = deriveAvailableFilters({ field: 'x', filter: 'number', filterTypes: ['number-range'] });
  assert.deepEqual(list, ['number', 'number-range']);
});

test('filtr se odvodí z typu i bez explicitního filter', () => {
  // číselné/datumové/textové typy jsou filtrovatelné rovnou
  assert.deepEqual(deriveAvailableFilters({ field: 'x', type: 'number' }), ['number', 'number-range']);
  assert.deepEqual(deriveAvailableFilters({ field: 'm', type: 'money' }), ['number', 'number-range']);
  assert.deepEqual(deriveAvailableFilters({ field: 't', type: 'text' }), ['text', 'select', 'multiselect']);
});

test('nefiltrovatelný typ → žádné přepínání (pokud si filtr nevynutí def.filter)', () => {
  assert.deepEqual(deriveAvailableFilters({ field: 'i', type: 'image' }), []);
  assert.deepEqual(deriveAvailableFilters({ field: 'h', type: 'html' }), []);
  // explicitní filtr ho vynutí i u jinak nefiltrovatelného typu
  assert.deepEqual(deriveAvailableFilters({ field: 'h', type: 'html', filter: 'text' }), ['text']);
});

test('filterEnabled: default zapnutý, persistuje se jen vypnutí', () => {
  let cols = buildColumns([{ field: 'a', filter: 'text' }], []);
  assert.equal(cols[0].filterEnabled, true);
  assert.equal('filterEnabled' in serializeColumns(cols)[0], false); // default se neukládá

  cols[0].filterEnabled = false;
  assert.equal(serializeColumns(cols)[0].filterEnabled, false);

  const restored = buildColumns([{ field: 'a', filter: 'text' }], [{ field: 'a', filterEnabled: false }]);
  assert.equal(restored[0].filterEnabled, false);
});

test('odvozený filtr (bez explicitního filter) je dostupný, ale ve výchozím stavu vypnutý', () => {
  const cols = buildColumns([{ field: 'q', type: 'money' }], []);
  assert.deepEqual(cols[0].availableFilters, ['number', 'number-range']);
  assert.equal(cols[0].filter, 'number');          // default = první dostupný
  assert.equal(cols[0].filterEnabled, false);        // odvozený → vypnutý
  assert.equal('filterEnabled' in serializeColumns(cols)[0], false); // default se neukládá
  // zapnutí uživatelem se uloží
  cols[0].filterEnabled = true;
  assert.equal(serializeColumns(cols)[0].filterEnabled, true);
});

test('zvolený typ filtru se persistuje jen když se liší od defaultu', () => {
  const defs = [{ field: 'b', type: 'number', filter: 'number' }];
  // beze změny → filterType se neukládá
  let cols = buildColumns(defs, []);
  assert.equal('filterType' in serializeColumns(cols)[0], false);
  // po změně na number-range → uloží se
  cols[0].filter = 'number-range';
  assert.equal(serializeColumns(cols)[0].filterType, 'number-range');
  // a načte se zpět
  const restored = buildColumns(defs, [{ field: 'b', filterType: 'number-range' }]);
  assert.equal(restored[0].filter, 'number-range');
});
