import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientData } from '../src/core/DataSource.js';

function seed() {
  return new ClientData([
    { id: 1, name: 'Alice', score: 10 },
    { id: 2, name: 'Bob', score: 20 },
    { id: 3, name: 'Cara', score: 30 },
  ]);
}

test('addRow — na konec i na začátek', () => {
  const d = seed();
  d.addRow({ id: 4, name: 'Dan' });
  assert.equal(d.data.length, 4);
  assert.equal(d.data[3].name, 'Dan');
  d.addRow({ id: 0, name: 'Zero' }, true);
  assert.equal(d.data[0].name, 'Zero');
});

test('updateRow — sloučí patch, najde i při number vs string', () => {
  const d = seed();
  const r = d.updateRow('id', '2', { score: 99 });
  assert.equal(r.name, 'Bob');
  assert.equal(r.score, 99);
  assert.equal(d.data.find((x) => x.id === 2).score, 99);
});

test('updateRow — neexistující klíč vrátí null', () => {
  const d = seed();
  assert.equal(d.updateRow('id', 999, { score: 1 }), null);
});

test('deleteRow — smaže dle klíče', () => {
  const d = seed();
  assert.equal(d.deleteRow('id', 2), true);
  assert.deepEqual(d.data.map((r) => r.id), [1, 3]);
  assert.equal(d.deleteRow('id', 2), false);
});

test('upsertMany — existující sloučí, nové přidá', () => {
  const d = seed();
  d.upsertMany('id', [
    { id: 2, score: 200 },       // update
    { id: 5, name: 'Eve' },      // insert
  ]);
  assert.equal(d.data.length, 4);
  assert.equal(d.data.find((r) => r.id === 2).score, 200);
  assert.equal(d.data.find((r) => r.id === 2).name, 'Bob'); // ostatní pole zůstala
  assert.equal(d.data.find((r) => r.id === 5).name, 'Eve');
});

test('mutace invalidují _filtered cache (allRows se přepočítá)', async () => {
  const d = seed();
  await d.query({ page: 1, pageSize: 50, paginate: false, sort: [], filters: {}, columns: [] });
  assert.equal(d.allRows().length, 3);
  d.addRow({ id: 9, name: 'New' });
  assert.equal(d.allRows().length, 4); // cache zneplatněná → allRows padne na aktuální this.data
  assert.equal(d.data.length, 4);
});

test('moveRow — ploché přeuspořádání + přečíslování position', () => {
  const d = new ClientData([
    { id: 1, name: 'A', position: 1 },
    { id: 2, name: 'B', position: 2 },
    { id: 3, name: 'C', position: 3 },
  ]);
  const changed = d.moveRow('id', 3, 1, 'before', 'position'); // C před A
  assert.deepEqual(d.data.map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(d.data.map((r) => r.position), [1, 2, 3]);
  assert.ok(changed.length >= 1);
});

test('moveRow — after cíle', () => {
  const d = new ClientData([{ id: 1 }, { id: 2 }, { id: 3 }]);
  d.moveRow('id', 1, 3, 'after');
  assert.deepEqual(d.data.map((r) => r.id), [2, 3, 1]);
});
