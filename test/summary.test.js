import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimální DOM stub — vestavěný money formatter staví <span> pro záporné číslo,
// když má formát negative:'red'. `nodeType` je tu podstatné: podle něj se pozná
// uzel bez globálu Node (ten mimo prohlížeč neexistuje).
globalThis.document = {
  createElement: () => ({ nodeType: 1, textContent: '', className: '' }),
};

const { formatSummaryValue, formatterText, isSummaryRow, SUMMARY_ROW } = await import('../src/features/summary.js');

/** Uzel, jaký by vrátil formátovač obarvující částku podle znaménka. */
const node = (text) => ({ nodeType: 1, textContent: text });

test('formatterText: řetězec projde, uzel vydá svůj text', () => {
  assert.equal(formatterText('1 234 Kč'), '1 234 Kč');
  assert.equal(formatterText(node('−1 234 Kč')), '−1 234 Kč');
  assert.equal(formatterText(null), '');
  assert.equal(formatterText(undefined), '');
  assert.equal(formatterText(42), '42');
});

test('souhrn u formátovače vracejícího řetězec (regrese)', () => {
  const col = { type: 'money', field: 'cena', formatter: (v) => `${v} Kč` };
  assert.equal(formatSummaryValue('sum', 1234, col), '1234 Kč');
  assert.equal(formatSummaryValue('avg', 617, col), '617 Kč');
});

test('souhrn u formátovače vracejícího DOM uzel ukáže číslo, ne [object …]', () => {
  const col = { type: 'money', field: 'cena', formatter: (v) => node(v < 0 ? `−${-v} Kč` : `${v} Kč`) };
  const sum = formatSummaryValue('sum', 1234, col);
  assert.equal(sum, '1234 Kč');
  assert.ok(!sum.includes('[object'), 'uzel se nesmí přetavit na svůj popis');
  assert.equal(formatSummaryValue('avg', -617, col), '−617 Kč');
});

test('vestavěný money s negative:red vrací uzel — souhrn ho taky unese', () => {
  // Bez custom formátovače: negText() postaví <span class="lattice-num-neg">.
  const col = { type: 'money', field: 'cena', _fmt: { currency: 'CZK', negative: 'red', decimals: 0 } };
  const out = formatSummaryValue('sum', -1234, col);
  assert.ok(!out.includes('[object'), out);
  assert.match(out, /1\D?234/, 'v souhrnu je vidět částka');
  // Měna dokazuje, že se opravdu prošlo formátovačem a nespadlo se na locale.
  assert.match(out, /Kč/, out);
  assert.match(out, /^-/, 'záporný souhrn si nechá znaménko');
});

test('formátovač, který spadne nebo vrátí uzel bez textu, souhrn nevyprázdní', () => {
  const boom = { type: 'money', field: 'cena', formatter: (v, c, row) => row.id.toUpperCase() };
  assert.equal(formatSummaryValue('sum', 1234, boom), (1234).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  const iconOnly = { type: 'money', field: 'cena', formatter: () => node('') };
  assert.equal(formatSummaryValue('sum', 1234, iconOnly), (1234).toLocaleString(undefined, { maximumFractionDigits: 0 }));
});

test('formátovač dostane v souhrnu poznatelný „řádek“, ne prázdný objekt', () => {
  let seen;
  const col = { type: 'money', field: 'cena', formatter: (v, c, row) => { seen = row; return `${v}`; } };
  formatSummaryValue('sum', 10, col);
  assert.equal(seen, SUMMARY_ROW);
  assert.equal(isSummaryRow(seen), true);
  assert.equal(seen.__latticeSummary, true);
  // Musí se číst stejně bezpečně jako prázdný objekt — na null by tohle spadlo.
  assert.equal(seen.cokoli, undefined);
  assert.equal(Object.isFrozen(seen), true, 'sdílený objekt nesmí jít přepsat zvenčí');
});

test('isSummaryRow rozezná běžný řádek od souhrnu', () => {
  assert.equal(isSummaryRow({ id: 1, cena: 10 }), false);
  assert.equal(isSummaryRow(null), false);
  assert.equal(isSummaryRow(undefined), false);
  assert.equal(isSummaryRow({}), false);
  assert.equal(isSummaryRow(SUMMARY_ROW), true);
});

test('count a prázdné hodnoty formátovačem neprocházejí', () => {
  let called = 0;
  const col = { type: 'money', field: 'cena', formatter: (v) => { called++; return `${v} Kč`; } };
  assert.equal(formatSummaryValue('count', 51000, col), '51000');
  assert.equal(formatSummaryValue('sum', null, col), '');
  assert.equal(formatSummaryValue('sum', NaN, col), '');
  assert.equal(called, 0, 'počet ani prázdno se neformátují jako částka');
});

test('nepeněžní sloupce se formátují podle locale (regrese)', () => {
  const col = { type: 'number', field: 'skore' };
  assert.equal(formatSummaryValue('sum', 1234.567, col), (1235).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  assert.equal(formatSummaryValue('avg', 1.5, col), (1.5).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  assert.equal(formatSummaryValue('formula', 53.64, col), (53.64).toLocaleString(undefined, { maximumFractionDigits: 2 }));
});
