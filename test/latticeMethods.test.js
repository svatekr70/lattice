import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lattice } from '../src/Lattice.js';
import { ServerData } from '../src/core/DataSource.js';
import { readFile } from 'node:fs/promises';

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

/* ---- setInstance({pageSize}) synchronizuje this.pageSize ---- */

function instanceCtx() {
  const ctx = Object.create(Lattice.prototype);
  const noop = () => {};
  ctx.instance = { pageSize: 20 };
  ctx.pageSize = 20;
  ctx.page = 3;
  ctx.saveState = noop;
  ctx.renderer = new Proxy({}, { get: () => noop }); // libovolná renderer.* metoda = no-op
  ctx._refreshed = 0;
  ctx.refresh = function () { this._refreshed++; };
  return ctx;
}

test('setInstance({pageSize}) synchronizuje this.pageSize a refreshuje', () => {
  // regrese: refresh()/pager čtou this.pageSize, ne this.instance.pageSize —
  // bez sync se změna projevila až po reloadu.
  const ctx = instanceCtx();
  ctx.setInstance({ pageSize: 50 });
  assert.equal(ctx.pageSize, 50, 'this.pageSize synchronizován');
  assert.equal(ctx.instance.pageSize, 50);
  assert.equal(ctx.page, 1, 'reset na první stránku');
  assert.equal(ctx._refreshed, 1, 'proběhl refresh');
});

/* ---- loadMore: request-id guard proti opožděné odpovědi ---- */

function progressiveCtx(query) {
  const ctx = Object.create(Lattice.prototype);
  const noop = () => {};
  Object.assign(ctx, {
    progressive: true, _loadingMore: false, loadedRows: [], loadedPage: 0,
    pageSize: 10, sort: [], filters: {}, advanced: null, universal: null, columns: [],
    lastPage: 5, total: 50, options: {},
    progressiveDone: () => false, universalActive: () => false,
    renderer: new Proxy({}, { get: () => noop }),
    dataSource: { query },
  });
  return ctx;
}

test('loadMore: happy path přisype řádky a posune loadedPage', async () => {
  const ctx = progressiveCtx(async () => ({ rows: [{ id: 1 }, { id: 2 }], total: 50, lastPage: 5 }));
  await ctx.loadMore();
  assert.deepEqual(ctx.loadedRows, [{ id: 1 }, { id: 2 }]);
  assert.equal(ctx.loadedPage, 1);
});

test('loadMore: opožděná odpověď přebitá refreshem se zahodí', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = progressiveCtx(async () => { await gate; return { rows: [{ id: 9 }], total: 50, lastPage: 5 }; });
  const p = ctx.loadMore();          // rozjede request, reqId = 1, čeká na gate
  ctx._reqId = 999;                  // simulace: mezitím proběhl refresh (bump reqId + reset)
  ctx.loadedRows = []; ctx.loadedPage = 0;
  release();
  await p;
  assert.deepEqual(ctx.loadedRows, [], 'stará odpověď nesmí přisypat řádky');
  assert.equal(ctx.loadedPage, 0, 'cursor se neposune');
});

/* ---- sbalování skupin řádků ---- */

// Minimální kontext pro toggleGroup — bez DOM (saveState i renderBody stubneme).
function groupCtx() {
  const ctx = Object.create(Lattice.prototype);
  ctx.groupsCollapsed = new Set();
  ctx.saveState = () => {};
  ctx.renderer = { renderBody() {} };
  return ctx;
}

// Strom skupin: A → [A/x → [A/x/1], A/y]
function groupTree() {
  const S = '\u0000';
  return {
    key: 'A',
    groups: [
      { key: 'A' + S + 'x', groups: [{ key: 'A' + S + 'x' + S + '1', rows: [] }] },
      { key: 'A' + S + 'y', rows: [] },
    ],
  };
}

test('toggleGroup: sbalení skupiny sbalí natrvalo i celý její podstrom', () => {
  const S = '\u0000';
  const ctx = groupCtx();
  const node = groupTree();

  ctx.toggleGroup('A', node);
  assert.deepEqual([...ctx.groupsCollapsed].sort(), ['A', 'A' + S + 'x', 'A' + S + 'x' + S + '1', 'A' + S + 'y'].sort());

  ctx.toggleGroup('A', node); // rozbalení nadřazené — podskupiny zůstávají sbalené
  assert.equal(ctx.isGroupCollapsed('A'), false);
  assert.deepEqual([...ctx.groupsCollapsed].sort(), ['A' + S + 'x', 'A' + S + 'x' + S + '1', 'A' + S + 'y'].sort());

  ctx.toggleGroup('A' + S + 'x', node.groups[0]); // klik na podskupinu ji rozbalí
  assert.equal(ctx.isGroupCollapsed('A' + S + 'x'), false);
  assert.equal(ctx.isGroupCollapsed('A' + S + 'x' + S + '1'), true, 'její vlastní podskupiny zůstávají sbalené');
});

test('toggleGroup: bez uzlu stromu přepne jen samotnou skupinu', () => {
  const ctx = groupCtx();
  ctx.toggleGroup('A');
  assert.deepEqual([...ctx.groupsCollapsed], ['A']);
  ctx.toggleGroup('A');
  assert.deepEqual([...ctx.groupsCollapsed], []);
});

/* ---- verze knihovny ---- */

test('VERSION odpovídá package.json (patička i CDN pin ukazují totéž)', async () => {
  const { VERSION } = await import('../src/version.js');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('RELEASES — seznam vydání pro záložku „O Lattice" je vygenerovaný a úplný', async () => {
  const { RELEASES } = await import('../src/releases.js');
  const { VERSION } = await import('../src/version.js');
  assert.ok(RELEASES.length > 0);
  assert.equal(RELEASES[0].version, VERSION, 'nejnovější vydání = aktuální verze (spusť `npm run releases`)');
  for (const r of RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.text.length > 10 && r.text.length <= 261, 'shrnutí má rozumnou délku');
  }
});
