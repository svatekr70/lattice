import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimální DOM stub — link/icon formatter staví <a> přes document.createElement.
// Vlastnosti (href, textContent, className, target, rel, innerHTML) se přiřazují
// volně na objekt; metody musí existovat.
globalThis.document = {
  createElement: () => ({ setAttribute() {}, appendChild() {} }),
};

const { getFormatter, isTruthy } = await import('../src/types/columnTypes.js');

const linkFmt = getFormatter({ type: 'link' });

test('link: výchozí href = urlPrefix + hodnota + urlSuffix, text = hodnota', () => {
  const col = { type: 'link', formatterParams: { urlPrefix: '/c/', urlSuffix: '/' } };
  const a = linkFmt('acme', col, { name: 'acme' });
  assert.equal(a.href, '/c/acme/');
  assert.equal(a.textContent, 'acme');
});

test('link: urlField skládá URL z jiného pole než zobrazený text', () => {
  const col = { type: 'link', formatterParams: { urlPrefix: '/clients/edit/', urlField: 'id' } };
  const a = linkFmt('3D Vision s.r.o.', col, { id: 123, name: '3D Vision s.r.o.' });
  assert.equal(a.href, '/clients/edit/123');   // URL přes ID
  assert.equal(a.textContent, '3D Vision s.r.o.'); // v buňce svítí název
});

test('link: url builder vrací celé href z řádku', () => {
  const col = { type: 'link', formatterParams: { url: (v, row) => `/clients/edit/${row.id}?from=grid` } };
  const a = linkFmt('Firma', col, { id: 7, name: 'Firma' });
  assert.equal(a.href, '/clients/edit/7?from=grid');
  assert.equal(a.textContent, 'Firma');
});

test('link: label přebije zobrazený text, URL zůstane z urlField', () => {
  const col = { type: 'link', formatterParams: { label: 'Detail', urlField: 'id', urlPrefix: '/x/' } };
  const a = linkFmt('Název', col, { id: 9 });
  assert.equal(a.href, '/x/9');
  assert.equal(a.textContent, 'Detail');
});

test('link: prázdná hodnota → prázdný výstup', () => {
  assert.equal(linkFmt('', { type: 'link' }, {}), '');
  assert.equal(linkFmt(null, { type: 'link' }, {}), '');
});

/* ----------------------------- isTruthy ----------------------------- */

test('isTruthy: case-insensitive true/ano/yes (i velkými písmeny)', () => {
  for (const v of [true, 1, '1', 'true', 'True', 'TRUE', 'ano', 'ANO', 'yes', 'YES', 'Yes', ' ano ']) {
    assert.equal(isTruthy(v), true, `${JSON.stringify(v)} má být truthy`);
  }
});

test('isTruthy: ostatní hodnoty jsou false', () => {
  for (const v of [false, 0, '0', 'false', 'ne', 'no', '', null, undefined, 'cokoli']) {
    assert.equal(isTruthy(v), false, `${JSON.stringify(v)} má být false`);
  }
});
