import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/filters/index.js'; // registruje built-in filtry (side-effect)
import { getFilter } from '../src/filters/index.js';

const dyn = getFilter('dynamic');

/** Dnešní datum jako 'YYYY-MM-DD' (lokálně) — pro testy relativních tokenů. */
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('dynamic — AND rozsah (absolutní datumy)', () => {
  const v = '>=2024-01-01 AND <=2024-01-31';
  assert.equal(dyn.match(v, '2024-01-15'), true);
  assert.equal(dyn.match(v, '2024-01-01'), true);  // hranice včetně
  assert.equal(dyn.match(v, '2024-01-31'), true);  // hranice včetně
  assert.equal(dyn.match(v, '2023-12-31'), false);
  assert.equal(dyn.match(v, '2024-02-01'), false);
});

test('dynamic — OR dvou otevřených konců', () => {
  const v = '<2024-01-01 OR >2024-12-31';
  assert.equal(dyn.match(v, '2023-06-01'), true);
  assert.equal(dyn.match(v, '2025-01-01'), true);
  assert.equal(dyn.match(v, '2024-06-01'), false);
});

test('dynamic — AND váže těsněji než OR', () => {
  const v = '>=2024-01-01 AND <=2024-01-31 OR =2024-06-15';
  assert.equal(dyn.match(v, '2024-01-15'), true);  // splní AND skupinu
  assert.equal(dyn.match(v, '2024-06-15'), true);  // splní samostatnou OR klauzuli
  assert.equal(dyn.match(v, '2024-03-01'), false); // ani jedno
});

test('dynamic — relativní tokeny (today)', () => {
  const t = todayISO();
  assert.equal(dyn.match('>=today AND <=today', t), true);
  assert.equal(dyn.match('>today', t), false);
  assert.equal(dyn.match('<=today', t), true);
});

test('dynamic — tichá tolerance chyb', () => {
  // celý výraz nesmyslný → nefiltruje (row projde)
  assert.equal(dyn.match('blah blah', '2024-01-15'), true);
  // neplatná klauzule se zahodí, platná zůstane
  assert.equal(dyn.match('>nesmysl AND <=2024-01-31', '2024-01-15'), true);
  assert.equal(dyn.match('>nesmysl AND <=2024-01-31', '2024-02-01'), false);
});

test('dynamic — isEmpty', () => {
  assert.equal(dyn.isEmpty(''), true);
  assert.equal(dyn.isEmpty('   '), true);
  assert.equal(dyn.isEmpty(null), true);
  assert.equal(dyn.isEmpty('>today'), false);
});

test('dynamic — cell bez datumu neprojde', () => {
  assert.equal(dyn.match('>=2024-01-01', ''), false);
  assert.equal(dyn.match('>=2024-01-01', null), false);
  assert.equal(dyn.match('>=2024-01-01', 'not-a-date'), false);
});

test('dynamic — toServer: čisté AND = ploché parametry', () => {
  const out = dyn.toServer('due', '>=2024-01-01 AND <=2024-01-31');
  assert.deepEqual(out, [
    { field: 'due', type: '>=', value: '2024-01-01' },
    { field: 'due', type: '<=', value: '2024-01-31' },
  ]);
});

test('dynamic — toServer: OR přidá combinator/group', () => {
  const out = dyn.toServer('due', '<2024-01-01 OR >2024-12-31');
  assert.equal(out.length, 2);
  assert.equal(out[0].combinator, 'OR');
  assert.equal(out[0].group, 0);
  assert.equal(out[1].group, 1);
});

test('dynamic — toServer: token se rozvine na konkrétní datum', () => {
  const out = dyn.toServer('due', '>=today');
  assert.equal(out.length, 1);
  assert.equal(out[0].type, '>=');
  assert.equal(out[0].value, todayISO()); // ne 'today', ale konkrétní datum
});
