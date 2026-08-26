import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFilter } from '../src/filters/index.js';

test('text: substring, case-insensitive', () => {
  const f = getFilter('text');
  assert.equal(f.match('foo', 'Foobar'), true);
  assert.equal(f.match('xyz', 'Foobar'), false);
});

test('text: negace prefixem !', () => {
  const f = getFilter('text');
  assert.equal(f.match('!foo', 'bar'), true);
  assert.equal(f.match('!foo', 'foobar'), false);
  assert.equal(f.isEmpty(''), true);
});

test('number: operátory', () => {
  const f = getFilter('number');
  assert.equal(f.match('>5', 8), true);
  assert.equal(f.match('>5', 3), false);
  assert.equal(f.match('<=10', 10), true);
  assert.equal(f.match('7', 7), true);
  assert.deepEqual(f.toServer('n', '>=5'), [{ field: 'n', type: '>=', value: '5' }]);
});

test('number-range: min/max', () => {
  const f = getFilter('number-range');
  assert.equal(f.match({ min: 10, max: 20 }, 15), true);
  assert.equal(f.match({ min: 10, max: 20 }, 25), false);
  assert.equal(f.isEmpty({ min: null, max: null }), true);
  assert.deepEqual(f.toServer('n', { min: 10, max: null }), [{ field: 'n', type: '>=', value: 10 }]);
});

test('date-range: jedno pole → jeden server param "from|to"', () => {
  const f = getFilter('date-range');
  assert.equal(f.match({ from: '2026-01-01', to: '2026-12-31' }, '2026-06-15'), true);
  assert.equal(f.match({ from: '2026-01-01', to: '2026-03-31' }, '2026-06-15'), false);
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: '2026-12-31' }),
    [{ field: 'd', type: 'dateRange', value: '2026-01-01|2026-12-31' }]);
});

test('date-range: dynamický preset (tokeny) — match i toServer rozvine relativně', () => {
  const f = getFilter('date-range');
  const iso = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const today = iso(new Date());
  // {from:'today', to:'today'} matchne dnešek, ne včerejšek
  assert.equal(f.match({ from: 'today', to: 'today' }, today), true);
  const y = new Date(); y.setDate(y.getDate() - 1);
  assert.equal(f.match({ from: 'today', to: 'today' }, iso(y)), false);
  // toServer rozvine token na konkrétní datum (server tokeny neřeší)
  assert.deepEqual(f.toServer('d', { from: 'today', to: 'today' }),
    [{ field: 'd', type: 'dateRange', value: `${today}|${today}` }]);
  // minulý týden = sow-1w..eow-1w → obě konkrétní data
  const [lw] = f.toServer('d', { from: 'sow-1w', to: 'eow-1w' });
  assert.match(lw.value, /^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/);
});

test('date-two: dvě pole → dva server params (jedno nepovinné)', () => {
  const f = getFilter('date-two');
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: null }),
    [{ field: 'd', type: '>=', value: '2026-01-01' }]);
  assert.deepEqual(f.toServer('d', { from: '2026-01-01', to: '2026-12-31' }),
    [{ field: 'd', type: '>=', value: '2026-01-01' }, { field: 'd', type: '<=', value: '2026-12-31' }]);
});

test('multiselect: in', () => {
  const f = getFilter('multiselect');
  assert.equal(f.match(['A', 'B'], 'B'), true);
  assert.equal(f.match(['A', 'B'], 'C'), false);
  assert.deepEqual(f.toServer('c', ['A', 'B']), [{ field: 'c', type: 'in', value: ['A', 'B'] }]);
});

test('multiselect-exclude: notIn (inverze multiselectu)', () => {
  const f = getFilter('multiselect-exclude');
  assert.equal(f.match(['A', 'B'], 'B'), false);   // vybrané se skryjí
  assert.equal(f.match(['A', 'B'], 'C'), true);    // ostatní zůstanou
  assert.equal(f.match(['A'], ''), true);          // prázdná buňka není vyloučená
  assert.equal(f.isEmpty([]), true);               // nic nevybráno → nefiltruje
  assert.deepEqual(f.toServer('c', ['A', 'B']), [{ field: 'c', type: 'notIn', value: ['A', 'B'] }]);
});

test('boolean: ano/ne', () => {
  const f = getFilter('boolean');
  assert.equal(f.match('true', true), true);
  assert.equal(f.match('false', true), false);
  assert.equal(f.match('false', 0), true);
});
