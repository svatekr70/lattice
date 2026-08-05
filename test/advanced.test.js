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
