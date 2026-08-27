import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pagination } from '../src/features/pagination.js';
import { Renderer } from '../src/render/Renderer.js';
import { ClientData, ServerData } from '../src/core/DataSource.js';
import { I18n } from '../src/i18n/index.js';

const columns = [
  { field: 'name', type: 'text', filter: 'text' },
  { field: 'n', type: 'number', filter: 'number-range' },
];

/** 10 řádků: n = 1..10, name = 'a1'..'a5' a 'b6'..'b10'. */
const data = Array.from({ length: 10 }, (_, i) => ({
  name: (i < 5 ? 'a' : 'b') + (i + 1),
  n: i + 1,
}));

/**
 * Paginátor nad falešným gridem — bez DOM. `render()` potřebuje document,
 * `infoText()` ne, a právě ten text testujeme.
 */
function pager({ dataSource, total, lang = 'cs', tree = null }) {
  const p = Object.create(Pagination.prototype);
  p.grid = { i18n: new I18n(lang), dataSource, total, tree };
  return p;
}

/** Projede dotaz client-side zdrojem a vrátí text paginace pro první stránku. */
async function infoFor(request, { pageSize = 5, lang = 'cs' } = {}) {
  const ds = new ClientData(data);
  const res = await ds.query({ page: 1, pageSize, paginate: true, sort: [], filters: {}, columns, ...request });
  const total = res.total;
  const from = total === 0 ? 0 : 1;
  const to = Math.min(pageSize, total);
  return pager({ dataSource: ds, total }).infoText(from, to, total);
}

test('bez filtru: text je stejný jako dosud (pagination.showing)', async () => {
  assert.equal(await infoFor({}), 'Zobrazeno 1-5 z 10 řádků');
});

test('sloupcový filtr: přibude přípona s velikostí celého datasetu', async () => {
  assert.equal(
    await infoFor({ filters: { n: { min: 4 } } }),
    'Zobrazeno 1-5 z 7 řádků (filtrováno z celkem 10)',
  );
});

test('quick search zužuje total → přípona', async () => {
  assert.equal(
    await infoFor({ search: 'a' }),
    'Zobrazeno 1-5 z 5 řádků (filtrováno z celkem 10)',
  );
});

test('univerzální filtr zužuje total → přípona', async () => {
  assert.equal(
    await infoFor({ universal: { field: 'n', op: 'gt', value: 6 } }),
    'Zobrazeno 1-4 z 4 řádků (filtrováno z celkem 10)',
  );
});

test('rozšířený filtr zužuje total → přípona', async () => {
  const advanced = { combinator: 'AND', rules: [{ field: 'n', op: 'lte', value: 3 }] };
  assert.equal(
    await infoFor({ advanced }),
    'Zobrazeno 1-3 z 3 řádků (filtrováno z celkem 10)',
  );
});

test('filtr, který nic neodfiltruje (total === totalAll): přípona se neukáže', async () => {
  assert.equal(await infoFor({ filters: { n: { min: 1 } } }), 'Zobrazeno 1-5 z 10 řádků');
});

test('prázdný výsledek: zůstává pagination.empty, žádná přípona', async () => {
  assert.equal(await infoFor({ filters: { n: { min: 99 } } }), 'Žádné záznamy');
});

test('server-side: rawRows() neexistuje → text jako dosud', () => {
  const p = pager({ dataSource: new ServerData({ url: '/api' }), total: 7 });
  assert.equal(p.infoText(1, 5, 7), 'Zobrazeno 1-5 z 7 řádků');
  assert.equal(p.totalAll(), null);
});

test('tree režim: totalAll se nedohaduje (zploštělý strom vs. syrové řádky)', () => {
  const p = pager({ dataSource: new ClientData(data), total: 3, tree: { expanded: new Set() } });
  assert.equal(p.totalAll(), null);
  assert.equal(p.infoText(1, 3, 3), 'Zobrazeno 1-3 z 3 řádků');
});

test('změna stránky ani velikosti stránky příponu nemění', async () => {
  const ds = new ClientData(data);
  const filters = { n: { min: 4 } }; // 7 z 10
  const a = await ds.query({ page: 2, pageSize: 5, paginate: true, sort: [], filters, columns });
  const b = await ds.query({ page: 1, pageSize: 3, paginate: true, sort: [], filters, columns });
  assert.equal(
    pager({ dataSource: ds, total: a.total }).infoText(6, 7, a.total),
    'Zobrazeno 6-7 z 7 řádků (filtrováno z celkem 10)',
  );
  assert.equal(
    pager({ dataSource: ds, total: b.total }).infoText(1, 3, b.total),
    'Zobrazeno 1-3 z 7 řádků (filtrováno z celkem 10)',
  );
});

test('přípona je i v ostatních jazycích', () => {
  const ds = new ClientData(data);
  assert.equal(pager({ dataSource: ds, total: 4, lang: 'en' }).infoText(1, 4, 4),
    'Showing 1-4 of 4 rows (filtered from 10 total)');
  assert.equal(pager({ dataSource: ds, total: 4, lang: 'pl' }).infoText(1, 4, 4),
    'Wyświetlono 1-4 z 4 wierszy (przefiltrowano z 10)');
  assert.equal(pager({ dataSource: ds, total: 4, lang: 'sk' }).infoText(1, 4, 4),
    'Zobrazené 1-4 z 4 riadkov (filtrované z celkovo 10)');
});

test('vlastní slovník bez showingFiltered padá na angličtinu, showing zůstává vlastní', () => {
  const dict = { pagination: { showing: 'Řádky {from}–{to} ({total})' } };
  const ds = new ClientData(data);
  assert.equal(pager({ dataSource: ds, total: 10, lang: dict }).infoText(1, 5, 10), 'Řádky 1–5 (10)');
  assert.equal(pager({ dataSource: ds, total: 4, lang: dict }).infoText(1, 4, 4),
    'Showing 1-4 of 4 rows (filtered from 10 total)');
});

test('paginationPosition:"both" kreslí týž paginátor do hlavičky i patičky', () => {
  const node = () => ({ firstChild: null, style: {}, removeChild() {} });
  const footer = node();
  const topPager = node();
  const ds = new ClientData(data);
  const p = pager({ dataSource: ds, total: 4 });
  const drawn = [];

  const r = Object.create(Renderer.prototype);
  r.nodes = { footer, topPager };
  r.grid = {
    progressive: false,
    instance: { paginationPosition: 'both' },
    options: { features: { version: false } },
    pagination: { render: (c) => drawn.push({ container: c, text: p.infoText(1, 4, 4) }) },
  };
  r.renderFooter();

  assert.deepEqual(drawn.map((d) => d.container), [footer, topPager]);
  assert.equal(drawn[0].text, drawn[1].text);
  assert.equal(drawn[0].text, 'Zobrazeno 1-4 z 4 řádků (filtrováno z celkem 10)');
});
