import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, emptyState } from '../src/core/Store.js';

function memStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('Store: round-trip zachová instanci i _gdVersion (verze globálních defaultů)', () => {
  const st = new Store('g1', { storage: memStorage() });
  const state = emptyState();
  state.instance = { theme: 'slate', pageSize: 25, format: { money: { currency: 'EUR' } } };
  state._gdVersion = 12345;
  st.save(state);

  const loaded = st.load();
  assert.equal(loaded.instance.theme, 'slate');
  assert.equal(loaded.instance.pageSize, 25);
  assert.equal(loaded.instance.format.money.currency, 'EUR');
  assert.equal(loaded._gdVersion, 12345); // regrese: dřív se _gdVersion na load zahazoval
});

test('Store: čistý stav má _gdVersion null', () => {
  assert.equal(emptyState()._gdVersion, null);
  const st = new Store('g2', { storage: memStorage() });
  assert.equal(st.load()._gdVersion, null);
});
