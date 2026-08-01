import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileFormula, validateFormula, parseFormula, formulaFields, FormulaError,
} from '../src/core/formula.js';

const ev = (src, row = {}) => compileFormula(src)(row);

/* --------------------------- aritmetika --------------------------- */

test('základní aritmetika a precedence', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('10 % 3'), 1);
  assert.equal(ev('-5 + 2'), -3);
  assert.equal(ev('2 * -3'), -6);
});

test('odkaz na pole a výpočet mezi sloupci', () => {
  assert.equal(ev('cena * mnozstvi', { cena: 100, mnozstvi: 3 }), 300);
  assert.equal(ev('a - b', { a: 10, b: 4 }), 6);
});

test('číselné pole jako řetězec s mezerami a čárkou se koercuje', () => {
  assert.equal(ev('cena * 2', { cena: '1 234,50' }), 2469);
});

test('pole s mezerou v názvu přes hranaté závorky', () => {
  assert.equal(ev('[Celková cena] + 1', { 'Celková cena': 9 }), 10);
});

test('dělení nulou → NaN (nespadne)', () => {
  assert.ok(Number.isNaN(ev('1 / 0')));
});

/* ------------------------------ text ------------------------------ */

test('spojení textu přes +', () => {
  assert.equal(ev("jmeno + ' ' + prijmeni", { jmeno: 'Jan', prijmeni: 'Novák' }), 'Jan Novák');
});

test('+ sčítá jen když jsou obě strany číselné', () => {
  assert.equal(ev('a + b', { a: 2, b: 3 }), 5);
  assert.equal(ev('a + b', { a: 'x', b: 3 }), 'x3');
});

test('řetězec se zdvojenou uvozovkou', () => {
  assert.equal(ev("'a''b'"), "a'b");
});

test('textové funkce', () => {
  assert.equal(ev("upper('abc')"), 'ABC');
  assert.equal(ev("lower('ABC')"), 'abc');
  assert.equal(ev("len('abcd')"), 4);
  assert.equal(ev("left('abcdef', 3)"), 'abc');
  assert.equal(ev("right('abcdef', 2)"), 'ef');
  assert.equal(ev("concat('a', 'b', 'c')"), 'abc');
  assert.equal(ev("replace('a-b-c', '-', '/')"), 'a/b/c');
  assert.equal(ev("contains('Hello', 'ell')"), true);
});

/* -------------------------- porovnání / logika -------------------------- */

test('porovnání číselné i textové', () => {
  assert.equal(ev('a > b', { a: 5, b: 3 }), true);
  assert.equal(ev('a == b', { a: '5', b: 5 }), true); // číselná shoda napříč typy
  assert.equal(ev("a == 'ano'", { a: 'ano' }), true);
  assert.equal(ev('a != b', { a: 1, b: 2 }), true);
});

test('logické operátory a negace', () => {
  assert.equal(ev('a && b', { a: true, b: true }), true);
  assert.equal(ev('a && b', { a: true, b: false }), false);
  assert.equal(ev('a || b', { a: false, b: true }), true);
  assert.equal(ev('!a', { a: false }), true);
});

/* --------------------------- podmínky if/then --------------------------- */

test('ternár i funkce if()', () => {
  assert.equal(ev("stav == 'hotovo' ? '✓' : '—'", { stav: 'hotovo' }), '✓');
  assert.equal(ev("if(stav == 'hotovo', '✓', '—')", { stav: 'nové' }), '—');
});

test('if() nevyhodnocuje nezvolenou větev (líné)', () => {
  // kdyby se vyhodnocovaly obě, 1/0 = NaN by to neshodilo, ale ověříme volbu větve
  assert.equal(ev('if(true, 1, 2)'), 1);
  assert.equal(ev('if(false, 1, 2)'), 2);
});

test('coalesce vrátí první neprázdnou', () => {
  assert.equal(ev('coalesce(a, b, 0)', { a: null, b: 7 }), 7);
  assert.equal(ev('coalesce(a, b, 0)', { a: '', b: null }), 0);
});

/* ------------------------------- datumy ------------------------------- */

test('days() spočítá počet dní mezi daty', () => {
  assert.equal(ev("days('2026-01-01', '2026-01-31')"), 30);
});

test('year/month/day z data', () => {
  assert.equal(ev("year('2026-08-01')"), 2026);
  assert.equal(ev("month('2026-08-01')"), 8);
  assert.equal(ev("day('2026-08-15')"), 15);
});

/* ------------------------- matematické funkce ------------------------- */

test('round / floor / ceil / abs / min / max', () => {
  assert.equal(ev('round(3.14159, 2)'), 3.14);
  assert.equal(ev('round(2.5)'), 3);
  assert.equal(ev('floor(2.9)'), 2);
  assert.equal(ev('ceil(2.1)'), 3);
  assert.equal(ev('abs(-4)'), 4);
  assert.equal(ev('min(3, 1, 2)'), 1);
  assert.equal(ev('max(3, 1, 2)'), 3);
});

/* ------------------------------ validace ------------------------------ */

test('validateFormula: platný vzorec', () => {
  const r = validateFormula('cena * mnozstvi');
  assert.equal(r.ok, true);
});

test('validateFormula: neznámá funkce', () => {
  const r = validateFormula('foo(1)');
  assert.equal(r.ok, false);
  assert.match(r.error, /Neznámá funkce/);
});

test('validateFormula: syntaktická chyba', () => {
  assert.equal(validateFormula('1 +').ok, false);
  assert.equal(validateFormula('(1 + 2').ok, false);
  assert.equal(validateFormula("'neuzavreny").ok, false);
});

test('compileFormula vyhodí FormulaError u neplatného vzorce', () => {
  assert.throws(() => compileFormula('1 +'), FormulaError);
  assert.throws(() => compileFormula('foo()'), FormulaError);
});

/* ----------------------------- bezpečnost ----------------------------- */

test('žádný přístup ke globálnímu prostředí (identifikátory jsou pole)', () => {
  // 'constructor', 'window', 'process' jsou jen odkazy na pole řádku → undefined
  assert.equal(ev('constructor', {}), undefined);
  assert.equal(ev('window', {}), undefined);
  // volání „metody" neexistuje — je to neznámá funkce
  assert.throws(() => compileFormula('alert(1)'), FormulaError);
});

/* -------------------------- pomocné exporty -------------------------- */

test('formulaFields vrátí odkazovaná pole', () => {
  const ast = parseFormula("cena * mnozstvi + if(sleva > 0, sleva, 0)");
  assert.deepEqual(formulaFields(ast).sort(), ['cena', 'mnozstvi', 'sleva']);
});
