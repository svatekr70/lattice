import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresetStore } from '../src/features/presets.js';

/** Minimální fake grid — PresetStore sahá jen na tohle. */
function fakeGrid(globalAdapter = null) {
  return {
    state: { presets: [] },
    options: { presets: globalAdapter ? { global: globalAdapter } : null },
    saved: 0,
    saveState() { this.saved++; },
    captureState() { return { columns: [{ field: 'a', visible: true, width: 100, frozen: false }], sort: [], filters: {} }; },
  };
}

test('lokální preset: uložení, seznam, smazání', () => {
  const grid = fakeGrid();
  const ps = new PresetStore(grid);
  assert.equal(ps.hasAdapter(), false);
  assert.equal(ps.canSaveGlobal(), false);

  const p = ps.saveLocal('Můj pohled');
  assert.equal(p.name, 'Můj pohled');
  assert.equal(ps.local().length, 1);
  assert.equal(grid.saved, 1);

  const all = ps.all();
  assert.equal(all[0].scope, 'local');

  ps.remove({ ...p, scope: 'local' });
  assert.equal(ps.local().length, 0);
});

test('stejný název přepíše lokální preset', () => {
  const ps = new PresetStore(fakeGrid());
  ps.saveLocal('X');
  ps.saveLocal('X');
  assert.equal(ps.local().length, 1);
});

test('prázdný název se neuloží', () => {
  const ps = new PresetStore(fakeGrid());
  assert.equal(ps.saveLocal('   '), null);
  assert.equal(ps.local().length, 0);
});

test('globální presety přes adaptér aplikace', async () => {
  const store = [];
  const adapter = {
    load: async () => store.slice(),
    save: async (preset) => { store.push(preset); return preset; },
    remove: async (id) => { const i = store.findIndex((p) => p.id === id); if (i >= 0) store.splice(i, 1); },
  };
  const ps = new PresetStore(fakeGrid(adapter));
  assert.equal(ps.hasAdapter(), true);
  assert.equal(ps.canSaveGlobal(), true);

  await ps.loadGlobals();
  assert.equal(ps.globals.length, 0);

  const g = ps.saveGlobal('Firemní');
  assert.equal(g.scope, 'global');
  assert.equal(store.length, 1);
  assert.equal(ps.all().find((p) => p.scope === 'global').name, 'Firemní');

  await ps.remove(g);
  assert.equal(store.length, 0);
  assert.equal(ps.globals.length, 0);
});

test('globální presety přes callback + init pole', async () => {
  const saved = [];
  const removed = [];
  const grid = {
    state: { presets: [] }, saved: 0,
    options: {
      globalPresets: [{ id: 'g1', name: 'Firemní', state: {} }],
      onSaveGlobalPreset: (p) => saved.push(p),
      onDeleteGlobalPreset: (p) => removed.push(p),
    },
    saveState() { this.saved++; },
    captureState() { return { columns: [], sort: [], filters: {} }; },
  };
  const ps = new PresetStore(grid);
  assert.equal(ps.hasAdapter(), false);        // init pole není adaptér
  assert.equal(ps.canSaveGlobal(), true);      // callback → lze ukládat
  assert.equal(ps.globals.length, 1);          // předané pole
  assert.equal(ps.all().find((p) => p.scope === 'global').name, 'Firemní');

  const g = ps.saveGlobal('Nový');
  assert.equal(g.scope, 'global');
  assert.equal(ps.globals.length, 2);
  assert.equal(saved.length, 1);               // callback dostal preset
  assert.equal(saved[0].name, 'Nový');

  await ps.remove(g);
  assert.equal(ps.globals.length, 1);
  assert.equal(removed.length, 1);
});
