import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalGroup, evalCondition, isEmptyTree } from '../src/filters/advancedEval.js';

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

test('prázdný strom = projde vše', () => {
  assert.equal(isEmptyTree({ combinator: 'AND', rules: [] }), true);
  assert.equal(evalGroup({ combinator: 'AND', rules: [] }, { x: 1 }), true);
});
