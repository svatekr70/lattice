import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns, serializeColumns, resolveColumn } from '../src/core/ColumnModel.js';

const CALC = { field: 'calc1', title: 'Celkem', type: 'number', computed: true, formula: 'cena * mnozstvi' };

test('resolveColumn zkompiluje vzorec do col.value', () => {
  const col = resolveColumn(CALC, null);
  assert.equal(typeof col.value, 'function');
  assert.equal(col.value({ cena: 100, mnozstvi: 3 }), 300);
  assert.equal(col.formula, 'cena * mnozstvi');
});

test('serializeColumns uloží u počítaného sloupce computed/formula/title/type', () => {
  const col = resolveColumn(CALC, null);
  const s = serializeColumns([col])[0];
  assert.equal(s.computed, true);
  assert.equal(s.formula, 'cena * mnozstvi');
  assert.equal(s.title, 'Celkem');
  assert.equal(s.type, 'number');
  assert.equal(s.field, 'calc1');
});

test('běžný sloupec NEmá computed/formula v serializaci', () => {
  const col = resolveColumn({ field: 'cena', type: 'number' }, null);
  const s = serializeColumns([col])[0];
  assert.equal('computed' in s, false);
  assert.equal('formula' in s, false);
});

test('reload: počítaný sloupec se zrekonstruuje jen z uloženého stavu (bez configu)', () => {
  const saved = serializeColumns([resolveColumn(CALC, null)]);
  // žádná definice v configu — dřív by se takový sloupec zahodil
  const cols = buildColumns([], saved);
  assert.equal(cols.length, 1);
  assert.equal(cols[0].field, 'calc1');
  assert.equal(cols[0].title, 'Celkem');
  assert.equal(typeof cols[0].value, 'function');
  assert.equal(cols[0].value({ cena: 10, mnozstvi: 4 }), 40);
});

test('reload: počítaný sloupec si drží pořadí i šířku mezi normálními sloupci', () => {
  const calc = resolveColumn(CALC, null);
  calc.width = 220;
  const saved = [{ field: 'b' }, serializeColumns([calc])[0], { field: 'a' }];
  const cols = buildColumns([{ field: 'a' }, { field: 'b' }], saved);
  assert.deepEqual(cols.map((c) => c.field), ['b', 'calc1', 'a']);
  const c = cols.find((x) => x.field === 'calc1');
  assert.equal(c.width, 220);
  assert.equal(c.value({ cena: 2, mnozstvi: 5 }), 10);
});

test('neplatný uložený vzorec nespadne (value → undefined)', () => {
  const saved = [{ field: 'calc1', computed: true, formula: '1 +', title: 'X', type: 'number', width: 150, visible: true }];
  const cols = buildColumns([], saved);
  assert.equal(cols.length, 1);
  assert.equal(cols[0].value({}), undefined); // degraduje, nehodí výjimku
});

test('počítaný sloupec je jen ke čtení (editable false, type id nerozhoduje)', () => {
  const col = resolveColumn(CALC, null);
  // isComputed se odvozuje z value fn; editable zůstává false (nebylo zapnuté)
  assert.equal(col.editable, false);
});
