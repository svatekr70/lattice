import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, moveId } from '../src/util/order.js';
import { PresetStore } from '../src/features/presets.js';
import { Lattice } from '../src/Lattice.js';

const ids = (list) => list.map((x) => x.id);

test('applyOrder — seřadí podle id, neznámé na konec v původním pořadí', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(ids(applyOrder(items, ['c', 'a'])), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(applyOrder(items, [])), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(applyOrder(items, undefined)), ['a', 'b', 'c', 'd']);
  // id smazané položky v seznamu nevadí
  assert.deepEqual(ids(applyOrder(items, ['x', 'd'])), ['d', 'a', 'b', 'c']);
});

test('moveId — před / za cíl, neplatné → null', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveId(items, 'c', 'a', 'before'), ['c', 'a', 'b']);
  assert.deepEqual(moveId(items, 'a', 'c', 'after'), ['b', 'c', 'a']);
  assert.deepEqual(moveId(items, 'a', 'b', 'after'), ['b', 'a', 'c']);
  assert.equal(moveId(items, 'a', 'a'), null);
  assert.equal(moveId(items, 'x', 'a'), null);
});

test('moveSavedFilter — pořadí lokálních i globálních filtrů, persistuje se', () => {
  let saved = 0;
  const ctx = {
    state: { advancedFilters: [{ id: 'l1', name: 'L1' }, { id: 'l2', name: 'L2' }] },
    globalAdvanced: [{ id: 'g1', name: 'G1', scope: 'global' }],
    store: { save() { saved++; } },
    renderer: { renderToolbar() {} },
  };
  for (const m of ['listAdvanced', 'moveSavedFilter']) ctx[m] = Lattice.prototype[m].bind(ctx);
  assert.deepEqual(ids(ctx.listAdvanced()), ['l1', 'l2', 'g1']);
  assert.equal(ctx.moveSavedFilter('g1', 'l1', 'before'), true);
  assert.deepEqual(ids(ctx.listAdvanced()), ['g1', 'l1', 'l2']);
  assert.deepEqual(ctx.state.filterOrder, ['g1', 'l1', 'l2']);
  assert.equal(saved, 1);
  // nově uložený filtr jde na konec
  ctx.state.advancedFilters.push({ id: 'l3', name: 'L3' });
  assert.deepEqual(ids(ctx.listAdvanced()), ['g1', 'l1', 'l2', 'l3']);
  assert.equal(ctx.moveSavedFilter('nope', 'l1'), false);
});

test('PresetStore.move — pořadí pohledů platí i pro tlačítka a výběr', () => {
  const grid = {
    state: { presets: [] },
    options: { globalPresets: [{ id: 'g', name: 'G', asButton: true, asSelect: true }] },
    saveState() {},
    captureState() { return {}; },
  };
  const ps = new PresetStore(grid);
  const a = ps.saveLocal('A', undefined, { button: true, select: true });
  const b = ps.saveLocal('B', undefined, { button: true, select: true });
  assert.deepEqual(ids(ps.all()), [a.id, b.id, 'g']);
  assert.equal(ps.move('g', a.id, 'before'), true);
  assert.deepEqual(ids(ps.all()), ['g', a.id, b.id]);
  assert.deepEqual(ids(ps.buttons()), ['g', a.id, b.id]);
  assert.deepEqual(ids(ps.selects()), ['g', a.id, b.id]);
});
