import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAggregate, validateAggregate, FormulaError } from '../src/core/formula.js';

const agg = (src, rows) => compileAggregate(src)(rows);

/* --------------- poolované poměry (ratio-of-sums) --------------- */

test('Dovolatelnost = Σ spojeno / Σ vytoceno × 100 (poolovaně, ne průměr poměrů)', () => {
  const rows = [
    { vytoceno: 100, spojeno: 50 }, // 50 %
    { vytoceno: 10, spojeno: 9 },   // 90 %
  ];
  // Správně poolovaně: (50+9)/(100+10) = 53,6 %
  assert.equal(Math.round(agg('sum(spojeno) / sum(vytoceno) * 100', rows) * 10) / 10, 53.6);
  // (kontrola, že to NENÍ průměr poměrů = 70 %)
  assert.notEqual(Math.round(agg('sum(spojeno) / sum(vytoceno) * 100', rows)), 70);
});

test('NoShow = Σ neprislo / Σ(prislo + neprislo) × 100', () => {
  const rows = [
    { prislo: 8, neprislo: 2 },
    { prislo: 5, neprislo: 5 },
  ];
  // 7 / 20 * 100 = 35
  assert.equal(agg('sum(neprislo) / (sum(prislo) + sum(neprislo)) * 100', rows), 35);
});

test('vážený průměr: Σ(cena × obchody) / Σ obchody', () => {
  const rows = [
    { cena: 100, obchody: 3 }, // 300
    { cena: 200, obchody: 1 }, // 200
  ];
  // (300+200) / 4 = 125  (prostý průměr cen by byl 150)
  assert.equal(agg('sum(cena * obchody) / sum(obchody)', rows), 125);
});

/* --------------------- agregační funkce --------------------- */

test('sum / avg / min / max / count / median', () => {
  const rows = [{ x: 10 }, { x: 20 }, { x: 30 }, { x: '' }];
  assert.equal(agg('sum(x)', rows), 60);
  assert.equal(agg('avg(x)', rows), 20);          // prázdné se nepočítá
  assert.equal(agg('min(x)', rows), 10);
  assert.equal(agg('max(x)', rows), 30);
  assert.equal(agg('count(x)', rows), 3);          // 3 neprázdné
  assert.equal(agg('median(x)', rows), 20);
});

test('median sudého počtu = průměr dvou prostředních', () => {
  const rows = [{ x: 1 }, { x: 3 }, { x: 5 }, { x: 9 }];
  assert.equal(agg('median(x)', rows), 4); // (3+5)/2
});

test('round nad agregací (doladění výsledku)', () => {
  const rows = [{ a: 1 }, { a: 2 }];
  assert.equal(agg('round(avg(a), 2)', rows), 1.5);
});

test('koerce číselných řetězců („1 234,5") uvnitř agregace', () => {
  const rows = [{ v: '1 234,5' }, { v: '2 000' }];
  assert.equal(agg('sum(v)', rows), 3234.5);
});

test('prázdná sada řádků → NaN, nespadne', () => {
  assert.ok(Number.isNaN(agg('sum(x) / sum(y)', [])));
});

/* --------------------- validace --------------------- */

test('pole mimo agregaci = chyba (nutí použít sum atd.)', () => {
  const r = validateAggregate('spojeno / vytoceno');
  assert.equal(r.ok, false);
  assert.match(r.error, /uvnitř agregace/);
});

test('vnořená agregace = chyba', () => {
  const r = validateAggregate('sum(sum(a))');
  assert.equal(r.ok, false);
  assert.match(r.error, /nelze vnořit/);
});

test('platný poolovaný poměr projde validací', () => {
  assert.equal(validateAggregate('sum(a) / sum(b) * 100').ok, true);
  assert.equal(validateAggregate('sum(cena * obchody) / sum(obchody)').ok, true);
});

test('neznámá funkce = chyba', () => {
  assert.equal(validateAggregate('foo(a)').ok, false);
});

test('compileAggregate vyhodí FormulaError u neplatného vzorce', () => {
  assert.throws(() => compileAggregate('spojeno / vytoceno'), FormulaError);
});
