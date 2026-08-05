import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lattice } from '../src/Lattice.js';
import { ServerData } from '../src/core/DataSource.js';

/** YYYY-MM-DD o `n` dní od dneška. */
function dayStr(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---- getServerParams / getServerQuery (server-side) ---- */

// Instance přes Object.create(prototype) → metody i gettery se resolvují z prototypu,
// datová pole a stuby přiřadíme přímo (bez DOM/plné konstrukce).
function serverCtx(ajax = { url: '/api' }) {
  const ctx = Object.create(Lattice.prototype);
  Object.assign(ctx, {
    dataSource: new ServerData(ajax),
    page: 2, pageSize: 25,
    sort: [{ field: 'name', dir: 'asc' }],
    filters: {},
    advanced: { combinator: 'AND', rules: [{ field: 'probation_end', op: 'lte', value: 'today+7' }] },
    universal: null,
    quickSearch: 'abc',
    columns: [],
  });
  return ctx;
}

test('getServerParams: skládá sort/search/advanced s rozvinutými tokeny, bez stránkování', () => {
  const p = serverCtx().getServerParams({ paginate: false });
  assert.equal('page' in p, false, 'paginate:false → bez page/size');
  assert.equal(p.search, 'abc');
  assert.deepEqual(p.sort, [{ field: 'name', dir: 'asc' }]);
  assert.equal(JSON.parse(p.advanced).rules[0].value, dayStr(7), 'token rozvinut');
});

test('getServerParams: paginate:true přidá page/size', () => {
  const p = serverCtx().getServerParams({ paginate: true });
  assert.equal(p.page, 2);
  assert.equal(p.size, 25);
});

test('getServerParams: client-side (ne ServerData) vrací {}', () => {
  const ctx = Object.create(Lattice.prototype);
  ctx.dataSource = { data: [] };
  assert.deepEqual(ctx.getServerParams({}), {});
});

test('getServerQuery: advanced je i u POST gridu JSON string v querystringu', () => {
  const qs = serverCtx({ url: '/api', method: 'POST' }).getServerQuery({ paginate: false });
  const sp = new URLSearchParams(qs);
  assert.equal(typeof sp.get('advanced'), 'string');
  assert.equal(JSON.parse(sp.get('advanced')).rules[0].value, dayStr(7));
  assert.equal([...sp.keys()].some((k) => k.startsWith('advanced[')), false, 'žádný bracket rozklad');
  assert.equal(sp.get('search'), 'abc');
});

test('getServerParams: respektuje ajax.requestBuilder', () => {
  const ctx = serverCtx({ url: '/api', requestBuilder: (s) => ({ custom: s.search }) });
  assert.deepEqual(ctx.getServerParams({}), { custom: 'abc' });
});

/* ---- zvýraznění (podbarvení) řádků ---- */

function hlCtx() {
  const saved = [];
  const ctx = Object.create(Lattice.prototype);
  ctx.highlightedKeys = new Set();
  ctx.keyField = 'id';
  ctx.state = {};
  ctx.renderer = { updateHighlightUI() {} };
  ctx.options = {};
  ctx.savedSnapshots = saved;
  ctx.saveState = function () { saved.push([...this.highlightedKeys]); };
  return ctx;
}

test('highlightRow / toggleRowHighlight / isHighlighted / clearHighlights', () => {
  const ctx = hlCtx();
  ctx.highlightRow(5);
  assert.equal(ctx.isHighlighted(5), true);
  assert.equal(ctx.isHighlighted({ id: 5 }), true, 'přijme i objekt řádku');
  assert.deepEqual(ctx.highlightedRows, ['5']);

  ctx.toggleRowHighlight(5);            // vypnout
  assert.equal(ctx.isHighlighted(5), false);

  ctx.highlightRow(1);
  ctx.highlightRow(2);
  assert.deepEqual(ctx.highlightedRows, ['1', '2']);
  ctx.clearHighlights();
  assert.deepEqual(ctx.highlightedRows, []);
});

test('highlightRow persistuje (saveState) a volá onHighlightChange', () => {
  const ctx = hlCtx();
  const seen = [];
  ctx.options.onHighlightChange = (ids) => seen.push(ids);
  ctx.highlightRow(7);
  assert.deepEqual(ctx.savedSnapshots.at(-1), ['7'], 'stav uložen');
  assert.deepEqual(seen.at(-1), ['7'], 'callback dostal pole id');
});

test('clearHighlights je no-op když není co mazat (nevolá saveState)', () => {
  const ctx = hlCtx();
  ctx.clearHighlights();
  assert.equal(ctx.savedSnapshots.length, 0);
});
