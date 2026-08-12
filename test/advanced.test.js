import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalGroup, evalCondition, isEmptyTree, resolveToken } from '../src/filters/advancedEval.js';

/** YYYY-MM-DD o `n` dní od dneška (lokálně). */
function dayStr(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('operátory podmínky', () => {
  const r = { category: 'Newsletter', region: 'Plzeň', budget: 50000, name: '' };
  assert.equal(evalCondition({ field: 'category', op: 'eq', value: 'newsletter' }, r), true);
  assert.equal(evalCondition({ field: 'category', op: 'neq', value: 'PPC' }, r), true);
  assert.equal(evalCondition({ field: 'region', op: 'starts', value: 'P' }, r), true);
  assert.equal(evalCondition({ field: 'region', op: 'contains', value: 'lz' }, r), true);
  assert.equal(evalCondition({ field: 'budget', op: 'lt', value: '100000' }, r), true);
  assert.equal(evalCondition({ field: 'budget', op: 'gt', value: '100000' }, r), false);
  assert.equal(evalCondition({ field: 'category', op: 'in', value: 'Email, Newsletter' }, r), true);
  assert.equal(evalCondition({ field: 'category', op: 'nin', value: 'Email, PPC' }, r), true);
  assert.equal(evalCondition({ field: 'name', op: 'empty' }, r), true);
  assert.equal(evalCondition({ field: 'region', op: 'nempty' }, r), true);
});

test('datumové porovnání u lt/gt', () => {
  const r = { d: '2026-06-15' };
  assert.equal(evalCondition({ field: 'd', op: 'gt', value: '2026-01-01' }, r), true);
  assert.equal(evalCondition({ field: 'd', op: 'lt', value: '2026-01-01' }, r), false);
});

test('vnořený strom AND/OR — scénář ze zadání', () => {
  // Kategorie in (Newsletter, PPC) AND (Region začíná P a ≠ Praha) AND (Rozpočet <100000 nebo >300000)
  const tree = {
    combinator: 'AND',
    rules: [
      { field: 'category', op: 'in', value: 'Newsletter, PPC' },
      { combinator: 'AND', rules: [
        { field: 'region', op: 'starts', value: 'P' },
        { field: 'region', op: 'neq', value: 'Praha' },
      ] },
      { combinator: 'OR', rules: [
        { field: 'budget', op: 'lt', value: '100000' },
        { field: 'budget', op: 'gt', value: '300000' },
      ] },
    ],
  };
  const ok1 = { category: 'Newsletter', region: 'Plzeň', budget: 50000 };
  const ok2 = { category: 'PPC', region: 'Plzeň', budget: 400000 };
  const badRegion = { category: 'Newsletter', region: 'Praha', budget: 50000 };
  const badCat = { category: 'Email', region: 'Plzeň', budget: 50000 };
  const badBudget = { category: 'PPC', region: 'Plzeň', budget: 200000 };
  const badStart = { category: 'PPC', region: 'Brno', budget: 50000 };

  assert.equal(evalGroup(tree, ok1), true);
  assert.equal(evalGroup(tree, ok2), true);
  assert.equal(evalGroup(tree, badRegion), false);
  assert.equal(evalGroup(tree, badCat), false);
  assert.equal(evalGroup(tree, badBudget), false);
  assert.equal(evalGroup(tree, badStart), false);
});

test('relativní datové tokeny — resolveToken', () => {
  assert.equal(resolveToken('today'), dayStr(0));
  assert.equal(resolveToken('today+14'), dayStr(14));
  assert.equal(resolveToken('today-7'), dayStr(-7));
  assert.equal(resolveToken('today+2w'), dayStr(14));
  assert.equal(resolveToken(' TODAY + 3 D '), dayStr(3)); // case-insensitive + mezery
  assert.match(resolveToken('now'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  // neznámé/běžné hodnoty projdou beze změny
  assert.equal(resolveToken('yesterday'), 'yesterday');
  assert.equal(resolveToken('2026-01-01'), '2026-01-01');
  assert.equal(resolveToken(42), 42);
  assert.equal(resolveToken('today+1x'), 'today+1x'); // neplatná jednotka → není token
});

test('měsíční/roční posun tokenu', () => {
  const d = new Date();
  const m = new Date(); m.setMonth(m.getMonth() + 1);
  const y = new Date(); y.setFullYear(y.getFullYear() - 1);
  const fmt = (dt) => { const p = (x) => String(x).padStart(2, '0'); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; };
  assert.equal(resolveToken('today+1m'), fmt(m));
  assert.equal(resolveToken('today-1y'), fmt(y));
  void d;
});

test('token ve vyhodnocení podmínky — „končí za 14 dní"', () => {
  // Zkušební doba končí přesně za 14 dní → lte today+14 = true, gt today = true
  const endsIn14 = { probation_end: dayStr(14) };
  const endsIn20 = { probation_end: dayStr(20) };
  const endedYesterday = { probation_end: dayStr(-1) };

  assert.equal(evalCondition({ field: 'probation_end', op: 'lte', value: 'today+14' }, endsIn14), true);
  assert.equal(evalCondition({ field: 'probation_end', op: 'lte', value: 'today+14' }, endsIn20), false);
  // „končí v příštích 14 dnech" = gte today AND lte today+14
  const tree = { combinator: 'AND', rules: [
    { field: 'probation_end', op: 'gte', value: 'today' },
    { field: 'probation_end', op: 'lte', value: 'today+14' },
  ] };
  assert.equal(evalGroup(tree, endsIn14), true);
  assert.equal(evalGroup(tree, endsIn20), false);
  assert.equal(evalGroup(tree, endedYesterday), false);
});

test('token v seznamu in/nin', () => {
  const r = { d: dayStr(0) };
  assert.equal(evalCondition({ field: 'd', op: 'in', value: 'today, today+1' }, r), true);
  assert.equal(evalCondition({ field: 'd', op: 'nin', value: 'today-1, today+1' }, r), true);
});

test('prázdný strom = projde vše', () => {
  assert.equal(isEmptyTree({ combinator: 'AND', rules: [] }), true);
  assert.equal(evalGroup({ combinator: 'AND', rules: [] }, { x: 1 }), true);
});

/* --- saveAdvanced: přepis pod stejným názvem zachová id (v1.6.1) --- */

import { Lattice } from '../src/Lattice.js';

/** Minimální mock kontextu pro volání saveAdvanced přes prototyp (bez DOM/rendereru). */
function mockGridCtx({ global = false } = {}) {
  return {
    state: { advancedFilters: [] },
    globalAdvanced: [],
    store: { save() {} },
    renderer: { renderToolbar() {} },
    options: global ? { onSaveGlobalAdvancedFilter() {} } : {},
    listAdvanced: Lattice.prototype.listAdvanced,
    _saveNamedFilter: Lattice.prototype._saveNamedFilter,
    _isSnapshot: Lattice.prototype._isSnapshot,
    _isSavedActive: Lattice.prototype._isSavedActive,
    _sameFilters: Lattice.prototype._sameFilters,
  };
}
const save = Lattice.prototype.saveAdvanced;

test('saveAdvanced (local) — přepis stejného názvu zachová id', () => {
  const ctx = mockGridCtx();
  const a = save.call(ctx, 'Zkušebka', { combinator: 'AND', rules: [] }, 'local');
  const b = save.call(ctx, 'Zkušebka', { combinator: 'OR', rules: [] }, 'local');
  assert.equal(a.id, b.id);                       // stejné id → přepis, ne nový záznam
  assert.equal(ctx.state.advancedFilters.length, 1);
  assert.equal(ctx.state.advancedFilters[0].tree.combinator, 'OR');
});

test('saveAdvanced (global) — přepis stejného názvu zachová id', () => {
  const ctx = mockGridCtx({ global: true });
  let lastCb = null;
  ctx.options.onSaveGlobalAdvancedFilter = (x) => { lastCb = x; };
  const a = save.call(ctx, 'Sdílený', { combinator: 'AND', rules: [] }, 'global');
  const b = save.call(ctx, 'Sdílený', { combinator: 'OR', rules: [] }, 'global');
  assert.equal(a.id, b.id);                       // stejné id → aplikace přepíše DB řádek
  assert.equal(lastCb.id, a.id);                  // callback dostane totéž id
  assert.equal(ctx.globalAdvanced.length, 1);
  assert.equal(ctx.globalAdvanced[0].tree.combinator, 'OR');
});

test('saveAdvanced — asButton se uloží u lokálního i globálního filtru', () => {
  const loc = mockGridCtx();
  const a = save.call(loc, 'Tlačítko', { combinator: 'AND', rules: [] }, 'local', true);
  assert.equal(a.asButton, true);
  assert.equal(loc.state.advancedFilters[0].asButton, true);

  const glob = mockGridCtx({ global: true });
  let cbArg = null;
  glob.options.onSaveGlobalAdvancedFilter = (x) => { cbArg = x; };
  const g = save.call(glob, 'Sdílené tlačítko', { combinator: 'AND', rules: [] }, 'global', true);
  assert.equal(g.asButton, true);
  assert.equal(cbArg.asButton, true, 'callback dostane asButton k perzistenci');

  // výchozí (bez parametru) = false
  const b = save.call(loc, 'Bez tlačítka', { combinator: 'AND', rules: [] }, 'local');
  assert.equal(b.asButton, false);
});

test('buttonAdvanced — vrací jen filtry označené asButton (lokální + globální)', () => {
  const ctx = mockGridCtx({ global: true });
  ctx.options.onSaveGlobalAdvancedFilter = () => {};
  save.call(ctx, 'Lok-btn', { combinator: 'AND', rules: [] }, 'local', true);
  save.call(ctx, 'Lok-select', { combinator: 'AND', rules: [] }, 'local', false);
  save.call(ctx, 'Glob-btn', { combinator: 'AND', rules: [] }, 'global', true);
  const btns = Lattice.prototype.buttonAdvanced.call(ctx);
  assert.equal(btns.length, 2);
  assert.deepEqual(btns.map((f) => f.name).sort(), ['Glob-btn', 'Lok-btn']);
});

test('toggleSavedAdvanced — aplikuje neaktivní, zruší aktivní', () => {
  const ctx = mockGridCtx();
  const applied = [];
  ctx.advanced = null;
  ctx.applyAdvanced = function (tree) { this.advanced = tree; applied.push('apply'); };
  ctx.clearAdvanced = function () { this.advanced = null; applied.push('clear'); };
  const item = save.call(ctx, 'Pře', { combinator: 'AND', rules: [{ field: 'x', op: 'eq', value: '1' }] }, 'local', true);

  Lattice.prototype.toggleSavedAdvanced.call(ctx, item.id); // neaktivní → aplikuj
  assert.equal(ctx.advanced.rules.length, 1);
  Lattice.prototype.toggleSavedAdvanced.call(ctx, item.id); // aktivní → zruš
  assert.equal(ctx.advanced, null);
  assert.deepEqual(applied, ['apply', 'clear']);
});

test('saveAdvanced — různé názvy = různá id', () => {
  const ctx = mockGridCtx();
  const a = save.call(ctx, 'A', { combinator: 'AND', rules: [] }, 'local');
  const b = save.call(ctx, 'B', { combinator: 'AND', rules: [] }, 'local');
  assert.notEqual(a.id, b.id);
  assert.equal(ctx.state.advancedFilters.length, 2);
});

test('prázdná podskupina pod OR neprosákne jako true (nefiltruje vše)', () => {
  // regrese: prázdná skupina vracela true → pod OR rodičem propustila VŠECHNY řádky.
  const tree = {
    combinator: 'OR',
    rules: [
      { field: 'category', op: 'eq', value: 'Newsletter' }, // reálná podmínka
      { combinator: 'AND', rules: [] },                       // prázdná podskupina
    ],
  };
  assert.equal(evalGroup(tree, { category: 'Newsletter' }), true, 'shoda přes reálnou podmínku');
  assert.equal(evalGroup(tree, { category: 'PPC' }), false, 'prázdná podskupina nesmí propustit');
});

test('nedokončená podmínka (bez op) v OR neprosákne', () => {
  const tree = {
    combinator: 'OR',
    rules: [
      { field: 'category', op: 'eq', value: 'Newsletter' },
      { field: 'region', value: 'Praha' }, // chybí op → neúčinná
    ],
  };
  assert.equal(evalGroup(tree, { category: 'PPC', region: 'Brno' }), false);
});

test('úplně prázdná skupina nefiltruje (matchne vše)', () => {
  assert.equal(evalGroup({ combinator: 'OR', rules: [] }, { x: 1 }), true);
  assert.equal(evalGroup({ combinator: 'AND', rules: [] }, { x: 1 }), true);
});

test('prázdné/chybějící pole nesplní ordering (lt/lte/gt/gte)', () => {
  // regrese: prázdné pole se řadilo jako „< cokoli" → splnilo lt/lte.
  for (const op of ['lt', 'lte', 'gt', 'gte']) {
    assert.equal(evalCondition({ field: 'budget', op, value: '100' }, { budget: '' }), false, `prázdné + ${op}`);
    assert.equal(evalCondition({ field: 'missing', op, value: '100' }, {}), false, `chybějící + ${op}`);
  }
  // neprázdná hodnota se dál porovnává normálně
  assert.equal(evalCondition({ field: 'budget', op: 'lt', value: '100' }, { budget: '50' }), true);
});

test('relativní měsíční/roční token nepřeteče přes konec měsíce', () => {
  // regrese: today+1m přes setMonth přetékalo (31.1 → 3.3). Invariant: měsíc je
  // přesně +1 (mod 12), nikdy +2. (Reálně se projeví na 29.–31. dni.)
  const now = new Date();
  const parseMonth = (iso) => Number(iso.slice(0, 10).split('-')[1]);
  const expMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getMonth() + 1;
  assert.equal(parseMonth(resolveToken('today+1m')), expMonth);
  const expYearMonth = new Date(now.getFullYear() + 1, now.getMonth(), 1).getMonth() + 1;
  assert.equal(parseMonth(resolveToken('today+1y')), expYearMonth);
});
