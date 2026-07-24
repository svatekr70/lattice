/**
 * Dokumentace Lattice (záložka „Dokumentace" v demu). Každá stránka je
 * `build(root, ctx)`, která poskládá obsah z helperů; živé ukázky vytvoří přes
 * `live(ctx, {...})` a zaregistrují se ke zničení při přepnutí stránky.
 *
 * ctx = { data, lang, register(grid) }
 */
import { Lattice } from '../src/index.js';
import { campaignColumns, coreColumns, withEditing } from './columns.js';

/* ---------------- helpery ---------------- */
function el(tag, cls, html) {
  const parts = tag.split('.'); const node = document.createElement(parts[0]);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}
const h2 = (t) => el('h2', null, t);
const h3 = (t) => el('h3', null, t);
const h4 = (t) => el('h4', null, t);
const lead = (html) => el('p', 'doc-lead', html);
const p = (html) => el('p', 'doc-p', html);
const code = (txt) => { const pre = el('pre', 'doc-code'); pre.textContent = txt; return pre; };
const note = (html, warn) => el('div', 'doc-note' + (warn ? ' warn' : ''), html);
function ul(items) {
  const list = el('ul', 'doc-ul');
  for (const it of items) list.appendChild(el('li', 'doc-li', it));
  return list;
}
function table(head, rows) {
  const wrap = el('div', 'doc-scroll');
  const t = el('table', 'doc-table');
  const thead = el('thead'); const htr = el('tr');
  for (const h of head) htr.appendChild(el('th', null, h));
  thead.appendChild(htr); t.appendChild(thead);
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const c of r) tr.appendChild(el('td', null, c));
    tb.appendChild(tr);
  }
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}
function live(ctx, opts) {
  const wrap = el('div', 'doc-live');
  if (opts.label) wrap.appendChild(el('div', 'doc-live-label', opts.label));
  const host = el('div');
  wrap.appendChild(host);
  const grid = new Lattice(host, Object.assign({ i18n: ctx.lang }, opts.config));
  ctx.register(grid);
  return wrap;
}
/** Poskládá potomky do rootu (přeskočí null). */
function build(root, nodes) { for (const n of nodes) if (n) root.appendChild(n); }

/* ---------------- stránky ---------------- */

function docZaciname(root, ctx) {
  build(root, [
    h2('Začínáme'),
    lead('Lattice je datová mřížka ve vanilla JS — <b>ESM modul bez build kroku a bez závislostí</b>. Naimportuješ třídu, dáš jí sloupce a data, a tabulka žije.'),

    h3('Instalace'),
    p('<b>Nejrychleji z CDN</b> — celá knihovna jedním requestem (sbalený ESM soubor), bez buildu:'),
    code(`<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/svatekr70/lattice@main/dist/lattice.css">
<div id="grid"></div>
<script type="module">
  import { Lattice } from 'https://cdn.jsdelivr.net/gh/svatekr70/lattice@main/dist/lattice.min.js';
  new Lattice('#grid', { id: 'kampane', columns, data });
</script>`),
    note('Pro produkci připni verzi místo <code>@main</code> — tag <code>@v0.1.0</code> nebo konkrétní commit (neměnný, nejbezpečnější).'),
    p('<b>Přes npm</b> (bundler / vlastní build):'),
    code("npm i lattice"),
    code("import { Lattice } from 'lattice';\nimport 'lattice/css';"),
    p('<b>Nebo bez CDN i npm</b> — zkopíruj složku <code>src/</code> do projektu a importuj přímo (čisté ESM, jen víc requestů):'),
    code("import { Lattice } from './src/index.js';\nimport './src/lattice.css';"),
    note('Žádný bundler není potřeba. Funguje i přes <code>&lt;script type="module"&gt;</code> přímo v prohlížeči.'),

    h3('První tabulka'),
    code(`const grid = new Lattice('#grid', {
  id: 'kampane',            // POVINNÉ: klíč pro uložení stavu (localStorage)
  columns: [
    { field: 'id',   title: 'ID',    type: 'id' },
    { field: 'name', title: 'Název', type: 'text', filter: 'text' },
    { field: 'budget', title: 'Rozpočet', type: 'money' },
  ],
  data: rows,              // pole objektů
  pageSize: 25,
});`),
    live(ctx, {
      label: 'Živá ukázka:',
      config: { id: 'doc-first', columns: campaignColumns(), data: ctx.data.slice(0, 40), pageSize: 5 },
    }),

    h3('Zdroj dat'),
    p('Dva režimy:'),
    ul([
      '<b>Client-side</b> — předáš <code>data: [...]</code> (pole objektů). Filtrování, řazení i stránkování počítá knihovna v paměti.',
      '<b>Server-side</b> — <code>serverSide: true, ajaxUrl: \'/api/…\'</code>. Knihovna posílá <code>page, size, sort[…], filter[…], search</code> a čeká odpověď <code>{ data, total }</code>. Vhodné pro velké datasety (+ <code>progressiveLoad: \'scroll\'|\'load\'</code>).',
    ]),
    note('Velké datasety (stránkování, progresivní načítání, virtuální scrollování) mají vlastní stránku <b>Data, seskupení a souhrny</b>.'),

    h3('Ukládání stavu'),
    p('Veškerý uživatelský stav (pořadí/šířky/viditelnost sloupců, řazení, filtry, nastavení tabulky, lokální presety) žije v <b>jednom</b> klíči <code>lattice:&lt;id&gt;</code> v localStorage. Proto je <code>id</code> povinné. Data jsou oddělená — knihovna je nepersistuje.'),
    note('Filozofie: <b>knihovna počítá, aplikace persistuje.</b> Knihovna nikdy nesahá na backend sama — emituje callbacky (viz <i>Interakce → Callbacky</i>) a aplikace si uložení řeší.'),
  ]);
}

function docSloupce(root, ctx) {
  build(root, [
    h2('Sloupce'),
    lead('Sloupec je objekt v poli <code>columns</code>. Minimálně <code>field</code>; <code>type</code> určuje formát i výchozí filtr.'),

    h3('Definice sloupce'),
    table(['Vlastnost', 'Typ', 'Popis'], [
      ['<code>field</code>', 'string', 'Klíč v datovém objektu (u computed sloupce jen identita).'],
      ['<code>title</code>', 'string', 'Popisek hlavičky (výchozí = field).'],
      ['<code>type</code>', 'string', "Datový typ → formát a výchozí filtr. Viz <i>Typy a formátování</i>."],
      ['<code>value</code>', 'function', '<code>(row) ⇒ any</code> — odvozená (computed) hodnota z celého řádku. Řadí/filtruje/hledá/exportuje se podle ní; needituje se.'],
      ['<code>validator</code>', 'various', "Deklarativní validace editace: <code>'required'</code> | RegExp | <code>{ min, max, minLen, maxLen, pattern, message }</code> | <code>fn(v,row)⇒true|string</code> | pole pravidel."],
      ['<code>width</code>', 'number', 'Výchozí šířka v px (uživatel může měnit tažením).'],
      ['<code>minWidth</code>', 'number', 'Minimální šířka.'],
      ['<code>align</code>', "'left'|'center'|'right'", 'Zarovnání (jinak dle typu).'],
      ['<code>frozen</code>', "true|'left'|'right'", "Ukotvení sloupce. <code>'never'</code> zakáže ukotvení uživatelem."],
      ['<code>group</code>', 'string', 'Název skupiny sloupců (spojí sousední sloupce pod společné záhlaví).'],
      ['<code>filter</code>', 'string', "Typ filtru; když se vynechá, odvodí se z typu (viz <i>Filtry</i>)."],
      ['<code>editable</code>', 'boolean', 'Povolí inline editaci buňky.'],
      ['<code>headerSort</code>', 'boolean', 'Řazení klikem na hlavičku (výchozí true).'],
      ['<code>formatter</code>', 'function', '<code>(value, col, row) ⇒ string|Node</code> — vlastní vykreslení buňky.'],
      ['<code>formatterParams</code>', 'object', 'Parametry formátovače daného typu.'],
      ['<code>summary</code> / <code>rowSummary</code>', 'string[]', 'Souhrnné funkce sloupce (dole) / řádku (vpravo). Viz <i>Data & rozvržení</i>.'],
      ['<code>responsive</code>', 'number|false', 'Pořadí skládání při <code>responsive: true</code> (vyšší = schová se dřív). <code>false</code> = nikdy neschovat.'],
    ]),

    h3('Ukotvení a skupiny'),
    code(`columns: [
  { field: 'id',   type: 'id',   frozen: 'left' },
  { field: 'name', type: 'text', frozen: 'left' },
  { field: 'q1', title: 'Q1', type: 'money', group: 'Kvartály' },
  { field: 'q2', title: 'Q2', type: 'money', group: 'Kvartály' },
]`),
    live(ctx, {
      label: 'Ukotvený sloupec + skupina (posuň vodorovně):',
      config: (() => {
        const cols = campaignColumns();
        cols.find((c) => c.field === 'id').frozen = 'left';
        cols.find((c) => c.field === 'name').frozen = 'left';
        return { id: 'doc-frozen', columns: cols, data: ctx.data.slice(0, 30), pageSize: 6 };
      })(),
    }),

    h3('Řazení'),
    p('Klik na hlavičku cyklí <b>vzestupně → sestupně → zrušit</b>. <b>Shift+klik</b> přidá sloupec do <b>víceúrovňového řazení</b> (odznak pořadí 1,2,3…). Programově <code>grid.sortColumn(field, dir)</code> / <code>grid.toggleSort(field, append)</code>.'),

    h3('Automatické sloupce'),
    p('Když <code>columns</code> nevyplníš (nebo <code>autoColumns: true</code>), odvodí se z klíčů dat — typy se uhodnou z hodnot. Praktické pro import CSV/JSON.'),
    code(`new Lattice('#grid', { id: 'auto', autoColumns: true, data: rows });`),
  ]);
}

function docTypy(root, ctx) {
  build(root, [
    h2('Typy a formátování'),
    lead('Typ sloupce určuje, jak se hodnota zobrazí. Číselné a datumové typy mají navíc <b>Excel-like formát</b> — globálně i jako výjimku sloupce.'),

    h3('Vestavěné typy'),
    table(['Typ', 'Zobrazení'], [
      ['<code>text</code>', 'Prostý text.'],
      ['<code>id</code>', 'Identifikátor záznamu — needituje se, drží klíč řádku.'],
      ['<code>number</code>', 'Číslo (des. místa, oddělovač tisíců, záporná barevně/v závorkách).'],
      ['<code>money</code>', 'Měna se symbolem (CZK/EUR/…).'],
      ['<code>date</code> / <code>datetime</code> / <code>time</code>', 'Datum/čas dle vzoru (<code>dd.mm.yyyy</code>, <code>d. mmmm yyyy</code>…).'],
      ['<code>boolean</code> / <code>tick</code>', 'Ano/Ne (✓/✕) / jen ✓ když pravda.'],
      ['<code>progress</code>', 'Vodorovný pruh (<code>formatterParams: { max, color, showValue }</code>).'],
      ['<code>rating</code>', 'Hvězdičky (<code>formatterParams: { max }</code>).'],
      ['<code>sparkline</code>', 'Mini graf z pole hodnot — SVG, bez závislosti (<code>formatterParams: { type:\'line\'|\'bar\', color, fill }</code>).'],
      ['<code>link</code>', 'Odkaz (<code>{ urlPrefix, target, label }</code>).'],
      ['<code>image</code>', 'Obrázek z URL/data: (+ lightbox).'],
      ['<code>icon</code>', 'Ikona/emoji (<code>{ icons: {hodnota: emoji} }</code>).'],
      ['<code>color</code>', 'Barevná výplň buňky.'],
      ['<code>html</code>', 'Vykreslí HTML (jen pro důvěryhodná data).'],
    ]),
    live(ctx, { label: 'Ukázka typů:', config: { id: 'doc-types', columns: campaignColumns(), data: ctx.data.slice(0, 30), pageSize: 6 } }),

    h3('Formát čísel a datumů'),
    p('Formát se řídí ve třech úrovních (priorita zdola nahoru): <b>výchozí → def.formatterParams → globální (Nastavení tabulky) → výjimka sloupce</b>.'),
    ul([
      '<b>Globálně</b>: Nastavení tabulky → „Formát hodnot" (des. místa, tisíce, záporná, měna, vzor data, locale).',
      '<b>Per-sloupec</b>: v dialogu „Sloupce" ikona <code>0.0</code> → „Podle tabulky" / „Vlastní formát".',
      '<b>V kódu</b>: <code>column.format = { … }</code> nebo za běhu <code>grid.setColumnFormat(field, patch)</code> a <code>grid.setFormat(kind, patch)</code>.',
    ]),
    code(`columns: [
  { field: 'amount', type: 'money', format: { negative: 'red' } },     // záporné červeně
  { field: 'rate',   type: 'number', format: { decimals: 4 } },
  { field: 'date',   type: 'date',   format: { pattern: 'd. mmmm yyyy' } },
]
// globálně:
grid.setFormat('money', { currency: 'EUR', decimals: 2 });`),
    note('Vzory data: <code>yyyy yy · mmmm mmm mm m · dddd ddd dd d · HH H · nn (minuty) · ss · a</code>. Názvy měsíců/dnů se berou z i18n.'),

    h3('Podmíněné formátování'),
    p('Obarvení řádků/buněk podle hodnot (jako conditional formatting v Excelu) — deklarativně přes třídy nebo inline styl:'),
    ul([
      '<code>rowClass(row, i) ⇒ string|string[]</code> a <code>rowStyle(row, i) ⇒ styleObj</code> — na tabulce.',
      '<code>column.cellClass(value, row, col)</code> a <code>column.cellStyle(value, row, col)</code> — na sloupci.',
    ]),
    code(`new Lattice('#grid', {
  columns: [{ field: 'score', type: 'number',
    cellStyle: (v) => ({ color: v >= 70 ? 'green' : v >= 40 ? 'orange' : 'red' }) }],
  rowStyle: (row) => row.status === 'Dokončeno' ? { background: '#eaf7ef' } : null,
});`),
    h4('Barevná škála (semafor) — z UI'),
    p('Pro číselné sloupce je i <b>bez kódu</b>: dialog „Sloupce" → ikona <code>0.0</code> → „Barevná škála (semafor)". Nastavíš <b>3/5/7 hladin</b>, vlastní <b>prahy</b> (předvyplněné automatikou z dat), volbu <b>„Obarvit: pozadí / text"</b> (výplň buňky vs. barevné číslo) a přepínač <b>„Obráceně (nízké = zelené)"</b> — pro metriky, kde je nízká hodnota lepší.'),
    p('<b>Kotevní barvy</b> škály (nejnižší · střed · nejvyšší) se nastavují <b>globálně</b> v <b>Nastavení tabulky → Vzhled → „Barvy škály (semafor)"</b> (výchozí červená / žlutá / zelená; větší škály se mezi nimi dopočítají). Přeberou je všechny sloupce s podmíněným formátem. V kódu:'),
    code(`new Lattice('#grid', {
  instance: { scaleColors: ['#e5534b', '#f2c037', '#42a05a'] },  // low, mid, high
  columns: [{ field: 'score', type: 'number',
    condFormat: { on: true, levels: 5, mode: 'text', reverse: true } }],
  // mode: 'bg' (pozadí, výchozí) | 'text' (barevné číslo)
  // prahy dopočte automaticky, nebo je zadáš do thresholds: [40, 70]
});`),

    h3('Vlastní typ'),
    code(`import { registerType } from './src/index.js';
registerType('rag', (value) => {
  const span = document.createElement('span');
  span.textContent = value >= 80 ? '🟢' : value >= 50 ? '🟠' : '🔴';
  return span;
});
// pak: { field:'score', type:'rag' }`),
  ]);
}

function docFiltry(root, ctx) {
  build(root, [
    h2('Filtry'),
    lead('Filtry mohou být v záhlaví sloupců, v panelu nad tabulkou, jako jeden univerzální filtr, nebo vypnuté. Typ se odvodí z datového typu sloupce.'),

    h3('Typy filtrů'),
    table(['Filtr', 'Pro typ', 'Chování'], [
      ['<code>text</code>', 'text', 'Obsahuje (prefix <code>!</code> = neobsahuje).'],
      ['<code>number</code>', 'number/money/…', 'Porovnání <code>=, &gt;, &lt;</code>.'],
      ['<code>number-range</code>', 'number/money/…', 'Rozsah Od–Do.'],
      ['<code>date-range</code> / <code>date-two</code>', 'date/datetime', 'Kalendářní rozsah / dvě pole Od / Do.'],
      ['<code>select</code> / <code>multiselect</code>', 'kdykoli', 'Výběr jedné / více hodnot (Select2-like, řazeno locale-aware).'],
      ['<code>boolean</code>', 'boolean', 'Ano / Ne / Vše.'],
    ]),

    h3('Odvození z typu'),
    p('Pokud <code>filter</code> nezadáš, číselné/datumové/textové sloupce jsou <b>filtrovatelné rovnou</b> — filtr je dostupný (zapneš ho v dialogu „Sloupce"), jen ve výchozím stavu vypnutý. Explicitní <code>filter</code>/<code>filterTypes</code> je zapnutý hned.'),
    code(`{ field: 'budget', type: 'money' }                    // filtr dostupný (vypnutý)
{ field: 'name', type: 'text', filter: 'text' }        // filtr zapnutý
{ field: 'status', filter: 'select',
  filterValues: ['Plánováno','Běží','Dokončeno'] }     // výběr z hodnot`),
    live(ctx, {
      label: 'Filtry v záhlaví:',
      config: { id: 'doc-filters', columns: campaignColumns(), data: ctx.data.slice(0, 60), pageSize: 6 },
    }),

    h3('Rychlé hledání přes vše'),
    p('<code>quickSearch: true</code> přidá do toolbaru pole, které filtruje napříč <b>všemi viditelnými sloupci</b> (podřetězec, nezáleží na diakritice ani velikosti). Za běhu <code>grid.setQuickSearch(term)</code>. Server-side se posílá jako parametr <code>search</code>.'),

    h3('Umístění filtrů'),
    p('Nastavení tabulky → „Umístění filtrů": <code>header</code> (v záhlaví) · <code>external</code> (panel nad tabulkou, sbalitelný) · <code>universal</code> (jeden filtr přes vybrané pole) · <code>none</code>. Navíc je vždy k dispozici <b>rozšířený filtr</b> (skládání podmínek A/NEBO).'),

    h3('Vlastní filtr'),
    code(`import { registerFilter } from './src/index.js';
registerFilter('even', {
  build(column, ctx) { /* vrať ovládací prvek, volej ctx.onChange(value) */ },
  isEmpty: (v) => v == null,
  match: (value, cell) => Number(cell) % 2 === 0,
  toServer: (field, value) => [{ field, type: 'even', value }],
});`),
  ]);
}

function docInterakce(root, ctx) {
  build(root, [
    h2('Interakce'),
    lead('Editace, výběr, přesouvání řádků a kontextová menu — vše opt-in přes konfiguraci.'),

    h3('Inline editace'),
    p('Zapne se <code>editable: true</code> na sloupci (nebo globálně). Editor se vybere podle typu (text, číslo, výběr, datum+čas, barva, progress tažením, rating klikem, boolean). Změnu dostane aplikace přes <code>onCellEdit</code>; před přijetím lze validovat přes <code>onCellValidate</code>.'),
    live(ctx, {
      label: 'Dvojklik do buňky:',
      config: { id: 'doc-edit', columns: withEditing(campaignColumns()), data: ctx.data.slice(0, 30), pageSize: 6,
        onCellValidate: ({ field, newValue }) => field !== 'name' || !!String(newValue).trim() },
    }),

    h3('Výběr řádků'),
    code(`new Lattice('#grid', {
  selectable: true,        // | 'single' | 5 (max)
  onSelectionChange: (rows, keys) => console.log(keys),
});
// hromadné operace:
grid.getSelectedKeys(); grid.getSelectedRows();`),

    h3('Přesouvání řádků'),
    ul([
      '<code>movableRows: true</code> — přetahování v rámci tabulky (úchyt vlevo). Emituje <code>onRowMove</code>.',
      '<code>acceptExternalRows: true|\'copy\'</code> — přijímání řádků z jiné Lattice instance (<code>onRowReceive</code>).',
    ]),

    h3('Přístupnost a klávesová navigace'),
    p('Grid má ARIA role (<code>grid/row/gridcell/columnheader</code>, <code>aria-sort</code>, <code>aria-selected</code>) a klávesovou navigaci buněk:'),
    ul([
      '<b>Šipky</b> — pohyb mezi buňkami · <b>Home/End</b> — první/poslední ve řádku (s Ctrl/⌘ celá tabulka) · <b>PageUp/Down</b> — o 10 řádků.',
      '<b>Enter / F2</b> — editace buňky (u editovatelných sloupců).',
      'Do gridu se dá vejít Tabem (roving tabindex), fokus buňky má viditelný obrys.',
    ]),

    h3('Kontextová menu'),
    ul([
      '<code>rowContextMenu: (row) ⇒ [{label, action}]</code> — pravý klik na # / ID sloupec.',
      '<code>cellContextMenu: (ctx) ⇒ […]</code> — pravý klik na buňku.',
      '<code>headerMenu: true</code> na sloupci — ⋮ menu v hlavičce (řazení, skrytí, ukotvení, seskupení…).',
      '<code>column.cellPopup / headerPopup</code> — plovoucí panel s vlastním obsahem.',
    ]),
  ]);
}

function docCallbacky(root) {
  build(root, [
    h2('Callbacky'),
    lead('Knihovna nikdy nesahá na backend sama — počítá a přes callbacky předává aplikaci, co má uložit či na co reagovat.'),

    h3('Interakce'),
    table(['Callback', 'Kdy'], [
      ['<code>onRowClick(row, i, e)</code>', 'Levý klik na řádek.'],
      ['<code>onCellClick(ctx, e)</code>', 'Levý klik na buňku (<code>{row,value,field,index,col}</code>).'],
      ['<code>onRowContext(row, i, e)</code>', 'Pravý klik na řádek.'],
    ]),
    h3('Data a editace'),
    table(['Callback', 'Kdy'], [
      ['<code>onCellEdit({field,row,oldValue,newValue})</code>', 'Po přijetí inline editace.'],
      ['<code>onCellValidate(ctx) ⇒ boolean</code>', 'Před přijetím editace (false = zamítnout).'],
      ['<code>onDataChange(action, rows)</code>', 'Po změně dat (add/update/delete/import…).'],
      ['<code>onRowMove(payload)</code>', 'Po přesunu řádku (co uložit).'],
      ['<code>onRowReceive(row, meta)</code>', 'Po přijetí řádku z jiné tabulky.'],
      ['<code>onRangeCopy / onRangePaste</code>', 'Kopírování/vkládání rozsahu buněk.'],
      ['<code>onSelectionChange(rows, keys)</code>', 'Změna výběru řádků.'],
    ]),
    h3('Stav a rozvržení'),
    table(['Callback', 'Kdy'], [
      ['<code>onSort(sort)</code>', 'Změna řazení — <code>[{field,dir}]</code>.'],
      ['<code>onFilter({filters,universal,advanced})</code>', 'Změna filtrů.'],
      ['<code>onPageChange({page,pageSize,…})</code>', 'Změna stránky / velikosti.'],
      ['<code>onColumnLayoutChange({kind,detail,columns})</code>', 'Přesun/šířka/skrytí/ukotvení/skupina — pro uložení layoutu na backend.'],
      ['<code>onDataLoad / onError</code>', 'Server-side načtení dat / chyba.'],
    ]),
    note('Snímek layoutu pro persistenci: <code>grid.getColumnLayout()</code>.'),
  ]);
}

function docNastaveni(root) {
  build(root, [
    h2('Nastavení tabulky'),
    lead('Modální okno (ikona ⚙) se skupinami: Vzhled · Rozvržení · Stránkování a filtry · Sloupce a řádky · Formát hodnot. Vše se persistuje do stavu instance.'),

    h3('Přehled voleb'),
    table(['Skupina', 'Volby'], [
      ['Vzhled', 'Motiv, písmo, velikost písma, hustota, otočení hlaviček, pruhované řádky.'],
      ['Rozvržení', 'Režim šířek (fitData/fitColumns/…), změna šířky (živě/vodicí čára), zalamování textu, náhrada prázdné buňky.'],
      ['Stránkování a filtry', 'Umístění stránkování, výchozí velikost stránky, umístění filtrů.'],
      ['Sloupce a řádky', 'Výchozí řazení, číslování řádků, souhrnný řádek, sloupec výběru, sloupec akcí.'],
      ['Formát hodnot', 'Locale + formát čísel/měny/datumu/času (viz <i>Typy a formátování</i>).'],
    ]),

    h3('Motivy (vzhledy)'),
    p('Motiv jen přemapuje CSS proměnné (barvy i strukturu — font, zaoblení, padding, styl hlaviček) a platí i na plovoucí panely. Vestavěné: <code>default, auto</code> (dle systému — <code>prefers-color-scheme</code>), <code>minimal, compact, slate</code> (tmavý), <code>ocean, warm, contrast, bootstrap5, tailwind, material</code>. V kódu: <code>instance: { theme: \'auto\' }</code> nebo <code>grid.setInstance({ theme })</code>.'),

    h3('Vlastní úpravy (přepíší motiv)'),
    p('Motiv definuje vzhled přes CSS proměnné; jednotlivé z nich lze pro tabulku <b>přepsat</b> — Nastavení tabulky → tab <b>„Vlastní úpravy"</b>: písmo tabulky i <b>záhlaví zvlášť</b> (select s náhledem, systémová i <b>Google Fonts</b>), barvy (akcent, odkazy, text, okraje, pozadí záhlaví, <b>liché/sudé řádky, najetí myší</b>), tučnost záhlaví, zaoblení, padding buňky… V kódu přes <code>instance.cssVars</code> (jakákoli <code>--lattice-*</code> proměnná):'),
    note('Google Fonts se načtou přes <code>&lt;link&gt;</code> z CDN (jen když otevřeš tento tab). Není to závislost knihovny — vlastní/samohostované písmo zadáš přes <code>instance.cssVars["--lattice-font"]</code>.'),
    code(`new Lattice('#grid', {
  instance: {
    theme: 'slate',
    cssVars: { '--lattice-accent': '#e91e63', '--lattice-link': '#e91e63',
               '--lattice-cell-pad-y': '4px', '--lattice-header-weight': '700' },
  },
});`),

    h3('V kódu'),
    code(`new Lattice('#grid', {
  instance: {
    theme: 'slate', density: 'compact', pageSize: 50,
    filterLayout: 'external', summaryRow: 'page',
    format: { money: { currency: 'EUR' } },
  },
});
grid.setInstance({ theme: 'ocean' });`),
  ]);
}

function docPresety(root) {
  build(root, [
    h2('Presety a globální nastavení'),
    lead('Uložené pohledy (sloupce/řazení/filtry) a globální výchozí konfigurace, kterou správce prosadí ostatním.'),

    h3('Lokální presety'),
    p('Per-uživatel, v localStorage. Kompletně v knihovně — v dialogu „Sloupce" pole na název + ikona záložky. Klik na název preset aplikuje.'),

    h3('Globální presety (sdílené)'),
    p('Sdílení mezi uživateli zajišťuje <b>aplikace</b>. Pole se předá při startu, uložení posílá callback (ikona globusu vedle záložky). Klik na název globálního presetu si tabulku nastaví jako u lokálního.'),
    code(`new Lattice('#grid', {
  globalPresets,                                  // pole uložené aplikací
  onSaveGlobalPreset: (preset) => saveToDb(preset),
  onDeleteGlobalPreset: (preset) => removeFromDb(preset.id),
});`),

    h3('Globální výchozí nastavení (admin → všem)'),
    p('Správce nastaví tabulku a tlačítkem „Uložit jako výchozí pro všechny" (v nastavení) pošle snímek aplikaci. Ta ho servíruje ostatním jako <code>globalDefaults</code>.'),
    ul([
      '<b>Nový uživatel</b> (bez uloženého stavu) se naseeduje výchozím nastavením automaticky.',
      '<b>Existující uživatel</b> se <b>nepřepisuje</b> — v nastavení se objeví nabídka „Použít" (u nové verze i „Ponechat moje" + tečka). „Použít" je dostupné vždy, takže se lze k předloze kdykoli vrátit.',
      'Verzování přes <code>version</code> — přepíše se jen při novější verzi, jinak si uživatel drží své úpravy.',
    ]),
    code(`new Lattice('#grid', {
  globalDefaults: { version, state },                 // od aplikace
  onSaveGlobalDefaults: ({version, state}) => saveToDb(...),
});`),
    note('Vše přes callbacky — perzistenci (DB, sdílení) řeší aplikace. V EverFLOW napojíš na Nette + Doctrine; ve statickém demu na PHP <code>api.php</code> (viz <i>Nasazení</i>).'),
  ]);
}

function docLokalizace(root) {
  build(root, [
    h2('Lokalizace'),
    lead('Vestavěná čeština a angličtina; snadno přidáš další jazyk.'),
    h3('Volba jazyka'),
    code(`new Lattice('#grid', { i18n: 'cs' });   // 'cs' | 'en' | vlastní slovník (objekt)
grid.setLanguage('en');`),
    h3('Nový jazyk'),
    p('V demu je nástroj <b>„Překlad do dalšího jazyka"</b> — vygeneruje z cs/en všechny řetězce, přeložíš (ručně nebo přes „zadání pro překladač"), stáhneš hotový <code>&lt;kód&gt;.js</code> a uložíš do <code>src/i18n/</code>. Registrace pak jedním voláním:'),
    code(`import { registerLanguage } from './src/index.js';
import de from './src/i18n/de.js';
registerLanguage('de', de);
new Lattice('#grid', { i18n: 'de' });`),
    note('Locale pro formát čísel/datumů je oddělený od jazyka UI (Nastavení tabulky → Jazyk formátu). Řazení hodnot ve filtru je locale-aware (v češtině „č" hned za „c").'),
  ]);
}

function docNasazeni(root) {
  build(root, [
    h2('Nasazení'),
    lead('Grid je celý client-side — na statickém hostingu jede sám. Server je potřeba jen pro sdílené věci.'),
    h3('Statický hosting'),
    p('Nahraj <code>src/</code> + svoji stránku. Funguje tabulka, filtry, editace, motivy, formáty, <b>lokální</b> presety i veškeré nastavení (localStorage). Bez serveru.'),
    h3('Sdílené věci (potřebují server)'),
    p('Globální presety a globální výchozí konfigurace jsou sdílené → musí je držet backend. Na sdíleném PHP hostingu (Wedos apod.) stačí přiložený <code>api.php</code> (flat-file JSON, bez DB) + <code>.htaccess</code>; lokálně <code>php -S localhost:8000 router.php</code>. Detaily v <code>DEPLOY.md</code>.'),
    h3('EverFLOW / Nette'),
    p('Callbacky (<code>onSaveGlobalPreset</code>, <code>onSaveGlobalDefaults</code>, <code>onColumnLayoutChange</code>, <code>onDataChange</code>…) napojíš na Nette presenter + Doctrine. Knihovna počítá, aplikace persistuje.'),
  ]);
}

function docApi(root) {
  build(root, [
    h2('API reference'),
    lead('Nejčastější volby konstruktoru a metody instance. (Ne vyčerpávající — viz zdroj.)'),

    h3('Volby konstruktoru'),
    table(['Volba', 'Popis'], [
      ['<code>id</code>', 'Klíč persistence (povinné).'],
      ['<code>columns</code>', 'Pole definic sloupců.'],
      ['<code>data</code>', 'Client-side data (pole objektů).'],
      ['<code>serverSide</code> / <code>ajaxUrl</code> / <code>progressiveLoad</code>', 'Server-side režim.'],
      ['<code>virtualScroll</code>', 'Virtuální scrollování (obří client-side data, bez stránkování).'],
      ['<code>quickSearch</code>', 'Pole rychlého hledání přes všechny sloupce.'],
      ['<code>rowClass</code> / <code>rowStyle</code>', 'Podmíněné formátování řádku (třídy / styl dle dat).'],
      ['<code>keyField</code>', "Klíč řádku (jinak sloupec typu 'id' nebo 'id')."],
      ['<code>pageSize</code>', 'Výchozí velikost stránky.'],
      ['<code>instance</code>', 'Výchozí nastavení tabulky (theme, layout, format, …).'],
      ['<code>selectable</code>', "true | 'single' | číslo (max)."],
      ['<code>selectionActions</code>', 'Lišta hromadných akcí nad výběrem: <code>[{ label, onClick(rows, keys, grid), danger? }]</code>.'],
      ['<code>rowDetail</code>', 'Rozbalovací detail řádku: <code>(row) =&gt; HTMLElement | string</code>.'],
      ['<code>responsive</code>', 'Úzký viewport skládá přetečené sloupce do detailu (řídí <code>col.responsive</code>).'],
      ['<code>pinnedTop</code> / <code>pinnedBottom</code>', 'Připnuté řádky (pole objektů) — vždy viditelné nahoře/dole. Za běhu <code>setPinnedRows({top,bottom})</code>.'],
      ['<code>urlState</code>', 'Sync řazení/filtrů/hledání/stránky do URL query stringu (sdílitelné pohledy). <code>true</code> nebo <code>{ key }</code>.'],
      ['<code>fillHandle</code>', 'Táhnutím rohu výběru vyplnit rozsah (auto při <code>rangeSelection</code> + editaci; <code>false</code> vypne).'],
      ['<code>editable</code>', 'Globální povolení editace.'],
      ['<code>movableRows</code> / <code>acceptExternalRows</code>', 'Přesun / příjem řádků.'],
      ['<code>treeData</code>', 'Hierarchická data (strom).'],
      ['<code>rangeSelection</code>', 'Výběr rozsahu buněk + schránka. Automaticky přidá <b>souhrn výběru</b> (počet/součet/průměr/min/max) a <b>fill handle</b>.'],
      ['<code>history</code>', 'Undo/redo (client-side).'],
      ['<code>actions</code>', 'Sloupec akcí (ikony / ⋮ menu).'],
      ['<code>i18n</code>', "'cs' | 'en' | vlastní slovník."],
      ['<code>globalPresets</code> / <code>globalDefaults</code>', 'Sdílené presety / výchozí konfigurace.'],
      ['<code>on…</code> callbacky', 'Viz <i>Callbacky</i>.'],
    ]),

    h3('Metody instance'),
    table(['Metoda', 'Popis'], [
      ['<code>setData(rows)</code> / <code>updateData(rows)</code>', 'Nahradit / sloučit data.'],
      ['<code>addRow / updateRow / deleteRow(s)</code>', 'Mutace řádků (emitují onDataChange, historie).'],
      ['<code>moveRow / receiveExternalRow</code>', 'Přesun / příjem řádku.'],
      ['<code>sortColumn(field, dir)</code> / <code>toggleSort(field)</code>', 'Řazení.'],
      ['<code>setFilter(field, value)</code> / <code>clearFilters()</code>', 'Filtry.'],
      ['<code>setPage(n)</code> / <code>setPageSize(n)</code>', 'Stránkování.'],
      ['<code>setInstance(patch)</code>', 'Nastavení tabulky (theme, layout, …).'],
      ['<code>setFormat(kind, patch)</code> / <code>setColumnFormat(field, patch)</code>', 'Formát globálně / per-sloupec.'],
      ['<code>setColumnSummary / setColumnRowSummary(field, fns)</code>', 'Souhrny sloupce / řádku.'],
      ['<code>getSelectedRows() / getSelectedKeys()</code>', 'Výběr.'],
      ['<code>getColumnLayout()</code>', 'Snímek layoutu sloupců.'],
      ['<code>undo() / redo() / clearHistory()</code>', 'Historie.'],
      ['<code>exportData / download / print</code>', "Export (csv | tsv | json | xml | excel) / tisk. Excel = SpreadsheetML, bez závislosti."],
      ['<code>importFile / importFromUrl / importHTMLTable / importXML</code>', 'Import.'],
      ['<code>setLanguage(lang)</code>', 'Změna jazyka.'],
      ['<code>applyPreset(preset)</code>', 'Aplikace presetu.'],
      ['<code>destroy()</code>', 'Zrušení instance.'],
    ]),

    h3('Registry (globální)'),
    table(['Funkce', 'Popis'], [
      ['<code>registerType(name, formatter)</code>', 'Vlastní datový typ.'],
      ['<code>registerFilter(name, def)</code>', 'Vlastní filtr.'],
      ['<code>registerLanguage(code, dict)</code>', 'Vlastní jazyk.'],
    ]),
  ]);
}

function docData(root, ctx) {
  build(root, [
    h2('Data, seskupení a souhrny'),
    lead('Seskupení řádků, souhrny nad sloupci i řádky, mezisoučty skupin a práce s velkými datasety.'),

    h3('Seskupení řádků'),
    p('Řádky lze seskupit podle hodnoty sloupce — i víceúrovňově (skupina ve skupině). Zapíná se pinem „seskupit" v dialogu „Sloupce" nebo v konfiguraci. Seskupený sloupec zmizí z tabulky a stane se klikací hlavičkou skupiny (sbalení/rozbalení).'),
    code(`new Lattice('#grid', { columns, data,
  instance: { groupBy: ['region', 'owner'] },   // víceúrovňově
});`),
    live(ctx, {
      label: 'Seskupeno podle regionu:',
      config: { id: 'doc-group', columns: campaignColumns(), data: ctx.data.slice(0, 120), pageSize: 200, instance: { groupBy: ['region'] } },
    }),

    h3('Souhrny sloupců a řádků'),
    p('Křížové souhrny jako v tabulkovém procesoru — nastavují se ikonou <b>Σ</b> v dialogu „Sloupce" (dvě sady) nebo v konfiguraci:'),
    ul([
      '<code>column.summary: [\'sum\',\'avg\',…]</code> — souhrnný <b>řádek dole</b> (agreguje sloupec přes všechny/zobrazené řádky).',
      '<code>column.rowSummary: [\'sum\',\'avg\',…]</code> — souhrnný <b>sloupec vpravo</b> (agreguje řádek přes zapojené sloupce).',
    ]),
    p('Funkce: <code>sum</code> (Σ), <code>avg</code> (⌀), <code>min</code>, <code>max</code>, <code>count</code>. Rozsah dolního souhrnu (zobrazená stránka / všechny záznamy) přepíná Nastavení tabulky → „Souhrnný řádek".'),

    h3('Mezisoučty skupin'),
    p('Když jsou řádky seskupené a sloupce mají souhrnné funkce, zapni <b>Nastavení tabulky → „Mezisoučty skupin"</b> (<code>instance.groupSubtotals: true</code>) a za každou skupinou (na každé úrovni seskupení) se zobrazí mezisoučtový řádek.'),

    h3('Velké datasety (stránkování · progresivní · virtuální)'),
    ul([
      '<b>Stránkování</b> — výchozí. Velikost stránky v Nastavení tabulky nebo <code>pageSize</code>.',
      '<b>Progresivní načítání</b> (server-side) — <code>progressiveLoad: \'scroll\'</code> (nekonečné) nebo <code>\'load\'</code> (tlačítko).',
      '<b>Virtuální scrollování</b> (client-side) — <code>virtualScroll: true</code> vykreslí jen viditelné okno řádků bez stránkování; plynulé i pro desítky tisíc řádků. Řazení/filtry/hledání běží nad celým datasetem. Jen ploché řádky (ne strom/seskupení).',
    ]),
    code(`new Lattice('#grid', { columns, data: bigRows,   // klidně 50k+
  virtualScroll: true,
});`),
  ]);
}

/* ---------------- registr stránek ---------------- */
export const DOC_GROUPS = [
  { category: 'Základ', items: [
    { id: 'zaciname', title: 'Začínáme', build: docZaciname },
    { id: 'sloupce', title: 'Sloupce', build: docSloupce },
    { id: 'typy', title: 'Typy a formátování', build: docTypy },
  ] },
  { category: 'Data', items: [
    { id: 'data', title: 'Data, seskupení a souhrny', build: docData },
  ] },
  { category: 'Filtrování', items: [
    { id: 'filtry', title: 'Filtry', build: docFiltry },
  ] },
  { category: 'Interakce', items: [
    { id: 'interakce', title: 'Editace, výběr, menu', build: docInterakce },
    { id: 'callbacky', title: 'Callbacky', build: docCallbacky },
  ] },
  { category: 'Nastavení', items: [
    { id: 'nastaveni', title: 'Nastavení tabulky', build: docNastaveni },
    { id: 'presety', title: 'Presety a globální nastavení', build: docPresety },
  ] },
  { category: 'Ostatní', items: [
    { id: 'lokalizace', title: 'Lokalizace', build: docLokalizace },
    { id: 'nasazeni', title: 'Nasazení', build: docNasazeni },
  ] },
  { category: 'Reference', items: [
    { id: 'api', title: 'API reference', build: docApi },
  ] },
];

export const DOC_ALL = DOC_GROUPS.flatMap((g) => g.items);
