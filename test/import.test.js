import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseJSON } from '../src/core/fileImport.js';
import { deriveColumns, inferType, humanize } from '../src/core/autoColumns.js';

test('parseCSV — hlavička, čísla, boolean, oddělovač čárka', () => {
  const rows = parseCSV('id,name,active\n1,Alice,true\n2,Bob,false');
  assert.deepEqual(rows, [
    { id: 1, name: 'Alice', active: true },
    { id: 2, name: 'Bob', active: false },
  ]);
});

test('parseCSV — uvozovky, čárka a newline uvnitř pole', () => {
  const rows = parseCSV('name,note\n"Doe, John","řádek 1\nřádek 2"\n"say ""hi""",ok');
  assert.equal(rows[0].name, 'Doe, John');
  assert.equal(rows[0].note, 'řádek 1\nřádek 2');
  assert.equal(rows[1].name, 'say "hi"');
});

test('parseCSV — autodetekce středníku', () => {
  const rows = parseCSV('a;b;c\n1;2;3');
  assert.deepEqual(rows, [{ a: 1, b: 2, c: 3 }]);
});

test('parseCSV — leading zero se nezkonvertuje na číslo', () => {
  const rows = parseCSV('code\n007');
  assert.equal(rows[0].code, '007');
});

test('parseJSON — pole i {data:[…]} i jeden objekt', () => {
  assert.equal(parseJSON('[{"a":1}]').length, 1);
  assert.equal(parseJSON('{"data":[{"a":1},{"a":2}]}').length, 2);
  assert.deepEqual(parseJSON('{"a":1}'), [{ a: 1 }]);
});

test('inferType — odhad typu ze vzorku', () => {
  assert.equal(inferType([1, 2, 3]), 'number');
  assert.equal(inferType([true, false]), 'boolean');
  assert.equal(inferType(['2025-01-01', '2025-12-31']), 'date');
  assert.equal(inferType(['Praha', 'Brno']), 'text');
  assert.equal(inferType([]), 'text');
});

test('humanize — field → čitelný název', () => {
  assert.equal(humanize('first_name'), 'First name');
  assert.equal(humanize('createdAt'), 'Created At');
  assert.equal(humanize('budget-czk'), 'Budget czk');
});

test('deriveColumns — sloupce z klíčů + typy + filtry', () => {
  const cols = deriveColumns([
    { id: 1, name: 'Alice', budget: 1000, joined: '2025-01-01', active: true },
    { id: 2, name: 'Bob', budget: 2000, joined: '2025-02-01', active: false },
  ]);
  assert.deepEqual(cols.map((c) => c.field), ['id', 'name', 'budget', 'joined', 'active']);
  const byField = Object.fromEntries(cols.map((c) => [c.field, c]));
  assert.equal(byField.id.type, 'number');
  assert.equal(byField.name.type, 'text');
  assert.equal(byField.joined.type, 'date');
  assert.equal(byField.active.type, 'boolean');
  assert.equal(byField.active.filter, 'boolean');
  assert.equal(byField.name.title, 'Name');
});

test('deriveColumns — sjednotí klíče napříč řádky (v pořadí výskytu)', () => {
  const cols = deriveColumns([{ a: 1 }, { a: 2, b: 3 }, { c: 4 }]);
  assert.deepEqual(cols.map((c) => c.field), ['a', 'b', 'c']);
});
