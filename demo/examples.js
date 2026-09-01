/**
 * Registr demo příkladů — každá feature zvlášť.
 * Každý příklad: { id, title, blurb, code, mount(el, ctx) → Lattice }.
 * `mount` vytvoří instanci nakonfigurovanou právě pro danou vlastnost a vrátí
 * ji (app.js ji při přepnutí zničí). `id` je zároveň klíč persistence.
 */
import { Lattice } from '../src/index.js';
import { campaignColumns, coreColumns, withEditing, showcaseColumns } from './columns.js';
import { orgFlat, orgNested, orgNestedSet, orgColumns, orgColumnsNS } from './orgdata.js';
import { i18nStudioExample } from './i18nStudio.js';

const ADV_SAMPLE_NAME = 'Ukázka: PPC/Bannery ≥ 100k';

/**
 * Malý dataset pro příklad „Prázdné hodnoty ve filtru" — schválně děravý:
 * `null`, `''` i úplně chybějící klíč, ať je vidět, že se všechny tři případy
 * chovají stejně. Kampaňová data se pro tohle nehodí (jsou vyplněná).
 */
const EMPTY_DEMO_ROWS = [
  { id: 1, firma: 'Alfa Media',   zeme: 'CZ', obor: 'IT',            tarif: 'Pro',   stav: 'Aktivní' },
  { id: 2, firma: 'Beta Trade',   zeme: null, obor: null,            tarif: null,    stav: null },
  { id: 3, firma: 'Cedr Group',   zeme: '',   obor: 'IT',            tarif: '',      stav: 'Archiv' },
  { id: 4, firma: 'Delta s.r.o.', zeme: 'SK', obor: null,            tarif: 'Basic', stav: '' },
  { id: 5, firma: 'Enigma a.s.',  zeme: 'CZ', obor: 'Stavebnictví',  tarif: 'Pro',   stav: 'Aktivní' },
  { id: 6, firma: 'Fenix plus',                                      tarif: 'Basic', stav: 'Archiv' },
  { id: 7, firma: 'Gama servis',  zeme: 'PL', obor: 'Doprava',       tarif: null,    stav: 'Aktivní' },
  { id: 8, firma: 'Hydra tech',   zeme: null, obor: 'IT',            tarif: 'Pro',   stav: null },
];

/** Společné volby (jazyk + callbacky) pro všechny příklady. */
function base(ctx, extra) {
  const id = extra && extra.id;
  return {
    i18n: ctx.lang,
    onCellEdit: ({ field, row, oldValue, newValue }) =>
      console.log(`[edit] ${field}:`, oldValue, '→', newValue, `(id ${row.id})`),
    // Globální výchozí nastavení tabulky (admin → všem) — aplikace je spravuje dle id.
    globalDefaults: ctx.globalDefaultsFor ? ctx.globalDefaultsFor(id) : undefined,
    onSaveGlobalDefaults: ctx.saveGlobalDefaults ? (d) => ctx.saveGlobalDefaults(id, d) : undefined,
    ...extra,
  };
}

/**
 * Showcase „Datové typy" — přepínač Plochá / Strom / Seskupeno nad jedním
 * datasetem (showcaseColumns + parentId hierarchie). Vrací { destroy } pro úklid.
 */
function datatypesShowcase(el, ctx) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  let grid = null;
  const modes = {
    flat:  { label: '📋 Plochá tabulka',              cfg: { pageSize: 15, instance: { summaryRow: 'page' } } },
    tree:  { label: '🌳 Strom (programy → kampaně)',  cfg: { treeData: true, treeParentField: 'parentId', treeIdField: 'id', treeStartExpanded: 1 } },
    group: { label: '🗂️ Seskupeno podle kategorie',  cfg: { pageSize: 500, instance: { groupBy: ['category'], summaryRow: 'all', groupSubtotals: true } } },
  };
  const buttons = {};
  const show = (m) => {
    Object.entries(buttons).forEach(([k, b]) => b.classList.toggle('is-active', k === m));
    if (grid) { try { grid.destroy(); } catch { /* no-op */ } }
    gridEl.innerHTML = '';
    const cfg = modes[m].cfg;
    grid = new Lattice(gridEl, base(ctx, {
      id: 'ex-datatypes-' + m, keyField: 'id', columns: showcaseColumns(), data: ctx.data,
      quickSearch: true, ...cfg,
      instance: { linkNewTab: true, ...(cfg.instance || {}) },
    }));
  };
  for (const [k, m] of Object.entries(modes)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.textContent = m.label;
    b.addEventListener('click', () => show(k));
    buttons[k] = b; bar.appendChild(b);
  }
  show('flat');
  return { destroy() { try { grid && grid.destroy(); } catch { /* no-op */ } } };
}

const RAW_GROUPS = [
  {
    category: 'Základ',
    items: [
      {
        id: 'ex-client',
        title: 'Client-side data',
        blurb: 'Vše v prohlížeči: filtrování, řazení, přeuspořádání a resize sloupců, stránkování. Stav se ukládá do localStorage.',
        code: `new Lattice('#grid', {\n  id: 'ex-client',\n  columns,\n  data,          // pole objektů\n  pageSize: 25,\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-client', columns: campaignColumns(), data: ctx.data, pageSize: 25,
        })),
      },
      {
        id: 'ex-server',
        title: 'Server-side (mock API)',
        blurb: 'Filtrování/řazení/stránkování běží na serveru přes kontrakt page/size/sort/filter → {data,last_page,total}. Tady je mockuje Node server.',
        code: `new Lattice('#grid', {\n  id: 'ex-server',\n  columns,\n  serverSide: true,\n  ajaxUrl: '/api/campaigns',\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-server', columns: campaignColumns(), pageSize: 25,
          serverSide: true, ajaxUrl: '/api/campaigns',
        })),
      },
      {
        id: 'ex-progressive',
        title: 'Progresivní načítání (velké datasety)',
        blurb: 'Server-side: místo paginátoru se řádky dobírají po stránkách — nekonečným scrollováním nebo tlačítkem „Načíst další". Řazení a filtry běží na serveru; jejich změna resetuje (od 1. stránky nově seřazeného/filtrovaného výsledku). Nikdy se nenačítá celý dataset najednou.',
        code: `new Lattice('#grid', {\n  id: 'ex-progressive', columns,\n  serverSide: true, ajaxUrl: '/api/campaigns',\n  pageSize: 20,\n  progressiveLoad: 'scroll',   // | 'load' (tlačítko)\n})`,
        mount: (el, ctx) => progressiveExample(el, ctx),
      },
      {
        id: 'ex-virtual',
        title: 'Virtuální scrollování',
        blurb: 'Client-side 50 000 řádků BEZ stránkování — vykreslují se jen viditelné řádky (+ rezerva), takže DOM zůstává malý a scroll plynulý. Řazení, filtry i rychlé hledání fungují nad celým datasetem. Zapíná se virtualScroll: true (jen ploché client-side řádky).',
        code: `new Lattice('#grid', {
  id: 'ex-virtual', columns, data: bigRows,   // klidně 50k+
  virtualScroll: true,   // vykreslí jen viditelné okno řádků
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-virtual', keyField: 'id', virtualScroll: true, quickSearch: true,
          data: bigData(50000),
          columns: [
            { field: 'id', title: 'ID', type: 'id', width: 80 },
            { field: 'name', title: 'Název', type: 'text', width: 180, filter: 'text' },
            { field: 'category', title: 'Kategorie', type: 'text', width: 160, filter: 'select' },
            { field: 'owner', title: 'Vlastník', type: 'text', width: 150, filter: 'select' },
            { field: 'region', title: 'Region', type: 'text', width: 140, filter: 'select' },
            { field: 'score', title: 'Skóre', type: 'number', width: 110, filter: 'number-range' },
            { field: 'budget', title: 'Rozpočet', type: 'money', width: 160, filter: 'number-range' },
          ],
        })),
      },
      {
        id: 'ex-export',
        title: 'Export / stažení',
        blurb: 'Stáhni aktuální (filtrovaná + seřazená) data: CSV s volitelným oddělovačem (čárka / středník / tabulátor = TSV), JSON, XML, nebo Excel (SpreadsheetML — Excel/LibreOffice ho otevřou přímo). Bez závislostí; PDF se neřeší. Filtruj/seřaď nahoře a export to respektuje.',
        code: `grid.download('csv')                       // ,\ngrid.download('csv', { delimiter: ';' })   // ;\ngrid.download('tsv')                       // tab\ngrid.download('json')\ngrid.download('xml')\ngrid.download('excel')                     // .xls (SpreadsheetML, bez závislosti)\n// grid.exportData(fmt, opts) vrátí obsah jako string`,
        mount: (el, ctx) => exportExample(el, ctx),
      },
    ],
  },
  {
    category: 'Řazení',
    items: [
      {
        id: 'ex-sort',
        title: 'Řazení přes všechny typy',
        blurb: 'Klikni na hlavičku: 1. klik = vzestupně (↑), 2. = sestupně (↓), 3. = zrušit. Shift+klik = víceúrovňové řazení (odznak pořadí 1,2,3…). Funguje pro všechny datové typy. Tady je to SERVER-SIDE: server seřadí CELÝ dataset a vrátí jen aktuální stránku.',
        code: `new Lattice('#grid', {\n  id: 'ex-sort', columns,\n  serverSide: true,\n  ajaxUrl: '/api/campaigns',   // request: sort[0][field], sort[0][dir], page, size\n  onDataLoad: ({ total, rows, sort }) => {\n    // server seřadil 'total' záznamů, vrátil jen 'rows.length' (stránku)\n  },\n})`,
        mount: (el, ctx) => sortExample(el, ctx),
      },
    ],
  },
  {
    category: 'Filtrování',
    items: [
      {
        id: 'ex-search',
        title: 'Rychlé hledání',
        blurb: 'Jedno pole v toolbaru filtruje napříč VŠEMI viditelnými sloupci (podřetězec, nezáleží na diakritice ani velikosti). Zkus „brno", „ppc" nebo „dvořák". Zapíná se volbou quickSearch: true.',
        code: `new Lattice('#grid', {
  id: 'ex-search', columns, data,
  quickSearch: true,   // pole „Hledat ve všem…" v toolbaru
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-search', columns: campaignColumns(), data: ctx.data, pageSize: 15, quickSearch: true,
        })),
      },
      {
        id: 'ex-filter-header',
        title: 'Filtry v záhlaví',
        blurb: 'Každý sloupec má vlastní filtr podle typu: text, číslo/rozsah, výběr, multiselect, <b>vyloučit více</b> (inverze multiselectu — zaškrtnuté hodnoty se skryjí, viz sloupec Stav), datum (rozsah, od/do i <b>dynamický</b> výraz jako <code>&gt;today-14 AND &lt;today+14</code> — u pole je tlačítko „?" s hotovými obdobími), ano/ne. Kalendář „Datum (rozsah)" má přepínač <b>„dynamické období"</b> (preset se uloží relativně a zůstane živý). Typ lze přepínat trychtýřem u sloupce. Když nějaký filtr zapneš, objeví se vpravo nahoře ikona <b>trychtýř+disketa</b> — uloží „naklikané" filtry pod názvem (i jako tlačítko, lokálně/globálně).',
        code: `columns = [\n  { field: 'name', filter: 'text' },\n  { field: 'budget', filter: 'number-range' },\n  { field: 'category', filter: 'multiselect' },\n  { field: 'status', filter: 'multiselect-exclude' },   // vybrané hodnoty se SKRYJÍ\n  { field: 'createdAt', filter: 'date-range' },\n  { field: 'startsAt', filter: 'dynamic' },   // >today-14 AND <today+14\n]`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-filter-header', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          instance: { filterLayout: 'header' },
        })),
      },
      {
        id: 'ex-filter-empty',
        title: 'Prázdné hodnoty ve filtru',
        blurb: 'Sloupec vyplněný jen u části řádků jde profiltrovat i na to, co v něm <b>chybí</b> — v nabídce je navíc volba <b>(prázdné)</b>, která projde buňky <code>null</code>, <code>undefined</code> i <code>\'\'</code>. Zkus <b>Země</b> (Výběr) a <b>Obor</b> (Více hodnot — volba se s ostatními spojí přes <b>NEBO</b>: „IT nebo prázdné"). U <b>Stavu</b> je <i>Vyloučit více</i>: prázdné řádky procházejí, dokud volbu nezaškrtneš — pak se skryjí. Volba se nabídne, <b>jen když sloupec prázdnou buňku opravdu má</b>, a stojí vždy první. Sloupec <b>Tarif</b> má statický <code>filterValues</code>, kam knihovna nesahá — volba tam chybí; <b>Stav</b> ukazuje opt-in přes <code>Lattice.EMPTY_FILTER_VALUE</code> v číselníku (potlačit jde i <code>filterEmptyOption: false</code>). Hodnotou filtru je token <code>__LATTICE_EMPTY__</code>, takže ho uvidíš i v server-side dotazu.',
        code: `columns = [
  // nabídka odvozená z dat → volba „(prázdné)" se přidá sama, když je co
  { field: 'zeme',  title: 'Země', filter: 'select' },
  { field: 'obor',  title: 'Obor', filter: 'multiselect' },

  // statický číselník → knihovna do něj nesahá, volba se NEnabídne
  { field: 'tarif', title: 'Tarif', filter: 'select',
    filterValues: ['Basic', 'Pro'] },

  // …leda si ji vložíš sám (popisek doplní knihovna)
  { field: 'stav',  title: 'Stav', filter: 'multiselect-exclude',
    filterValues: ['Aktivní', 'Archiv', Lattice.EMPTY_FILTER_VALUE] },

  // { …, filterEmptyOption: true }   // připnout vždy
  // { …, filterEmptyOption: false }  // potlačit i u odvozené nabídky
]

// Hodnota filtru = vyhrazený token (import { EMPTY_FILTER_VALUE } from 'lattice')
grid.setFilter('zeme', Lattice.EMPTY_FILTER_VALUE)          // jen prázdné
grid.setFilter('obor', ['IT', Lattice.EMPTY_FILTER_VALUE])  // IT NEBO prázdné`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-filter-empty', pageSize: 25, data: EMPTY_DEMO_ROWS.map((r) => ({ ...r })),
          columns: [
            { field: 'id',    title: 'ID',    type: 'number', width: 70, align: 'right' },
            { field: 'firma', title: 'Firma', type: 'text',   width: 160, filter: 'text' },
            { field: 'zeme',  title: 'Země',  type: 'text',   width: 150, filter: 'select' },
            { field: 'obor',  title: 'Obor',  type: 'text',   width: 190, filter: 'multiselect' },
            { field: 'tarif', title: 'Tarif', type: 'text',   width: 150, filter: 'select', filterValues: ['Basic', 'Pro'] },
            { field: 'stav',  title: 'Stav',  type: 'text',   width: 190, filter: 'multiselect-exclude', filterValues: ['Aktivní', 'Archiv', Lattice.EMPTY_FILTER_VALUE] },
          ],
        })),
      },
      {
        id: 'ex-filter-external',
        title: 'Filtry nad tabulkou',
        blurb: 'Místo filtrů v záhlaví sloupců se zobrazí panel nad tabulkou (responzivní mřížka: popisek + ovládací prvek). Hodí se, když nechceš mít filtry v hlavičce. Přepínatelné v Nastavení tabulky → Umístění filtrů.',
        code: `new Lattice('#grid', {\n  id: 'ex-filter-external',\n  columns, data,\n  instance: { filterLayout: 'external' },  // header | external | universal | none\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-filter-external', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          instance: { filterLayout: 'external' },
        })),
      },
      {
        id: 'ex-filter-universal',
        title: 'Univerzální filtr',
        blurb: 'Jeden filtr místo filtrů ve sloupcích: Pole → Typ (=, <, >, like, !like…) → Hodnota. Přepínatelné v Nastavení tabulky.',
        code: `new Lattice('#grid', {\n  id: 'ex-universal',\n  columns, data,\n  instance: { filterLayout: 'universal' },\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-filter-universal', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          instance: { filterLayout: 'universal' },
        })),
      },
      {
        id: 'ex-filter-advanced',
        title: 'Rozšířený filtr',
        blurb: 'Excel-like skládání pravidel: vnořené skupiny A zároveň / NEBO, mnoho operátorů. Filtry lze pojmenovat a uložit — <b>lokálně</b> (jen pro mě, v prohlížeči) nebo <b>globálně</b> (sdílené všem, spravuje APLIKACE). Globální uložení posílá callback (zelený globus v panelu), načtená pole dodá aplikace při startu; globální filtry poznáš v selectu podle 🌐. Předvyplněná ukázka je aktivní a uložená v quick-selectu (ikona nálevky v toolbaru ji otevře). <b>Relativní datum</b>: do hodnoty u datového sloupce napiš token <code>today</code>, <code>today+14</code>, <code>today-7</code>, <code>today+2w</code>/<code>+1m</code>/<code>+1y</code> nebo <code>now</code> — dopočítá se vždy podle aktuálního dne, takže uložený filtr „posouvá okno" s časem (např. <i>Vytvořeno ≥ today-3m</i>). <b>Nemusíš skládat strom</b> — i „naklikané" sloupcové filtry uložíš přes <code>grid.saveFilterSnapshot(name, scope)</code> (ikona trychtýř+disketa u filtrů); snímky žijí ve <b>stejném seznamu i callbacku</b> (payload nese <code>kind:\'columns\'</code>).',
        code: `const tree = {\n  combinator: 'AND',\n  rules: [\n    { combinator: 'OR', rules: [\n      { field: 'category', op: 'eq', value: 'PPC' },\n      { field: 'category', op: 'eq', value: 'Bannery' },\n    ] },\n    { field: 'budget', op: 'gte', value: 100000 },\n  ],\n}\ngrid.saveAdvanced('Lokální filtr', tree)            // jen pro mě (localStorage)\ngrid.saveAdvanced('Sdílený filtr', tree, 'global')  // → onSaveGlobalAdvancedFilter\ngrid.applyAdvanced(tree)\n\n// Relativní datum bez pevné hodnoty (token se dopočítá při vyhodnocení):\n// „končí v příštích 14 dnech" = probation_end mezi today a today+14\ngrid.applyAdvanced({ combinator: 'AND', rules: [\n  { field: 'probation_end', op: 'gte', value: 'today' },\n  { field: 'probation_end', op: 'lte', value: 'today+14' },  // today±N[d|w|m|y], now\n] })\n\n// Globální filtry dodá/persistuje aplikace:\nnew Lattice('#grid', {\n  globalAdvancedFilters,                              // pole uložené aplikací (stromy i snímky)\n  onSaveGlobalAdvancedFilter: (f) => saveToDb(f),     // globus → callback (celý objekt f)\n  onDeleteGlobalAdvancedFilter: (f) => removeFromDb(f.id),\n})\n\n// Bez stromu: ulož „naklikané" sloupcové filtry jako snímek (stejný seznam/callback):\ngrid.setFilter('category', 'PPC')\ngrid.saveFilterSnapshot('Jen PPC', 'global')  // → onSaveGlobalAdvancedFilter, payload kind:'columns'`,
        mount: (el, ctx) => {
          const grid = new Lattice(el, base(ctx, {
            id: 'ex-filter-advanced', columns: campaignColumns(), data: ctx.data, pageSize: 25,
            globalAdvancedFilters: ctx.globalAdvancedFilters,
            onSaveGlobalAdvancedFilter: ctx.onSaveGlobalAdvancedFilter,
            onDeleteGlobalAdvancedFilter: ctx.onDeleteGlobalAdvancedFilter,
          }));
          const sample = {
            combinator: 'AND',
            rules: [
              { combinator: 'OR', rules: [
                { field: 'category', op: 'eq', value: 'PPC' },
                { field: 'category', op: 'eq', value: 'Bannery' },
              ] },
              { field: 'budget', op: 'gte', value: 100000 },
            ],
          };
          // Ulož jako pojmenovaný filtr (do quick-selectu) a aktivuj při prvním zobrazení.
          if (!grid.listAdvanced().some((f) => f.name === ADV_SAMPLE_NAME)) grid.saveAdvanced(ADV_SAMPLE_NAME, sample);
          if (!grid.advancedActive()) grid.applyAdvanced(JSON.parse(JSON.stringify(sample)));
          return grid;
        },
      },
    ],
  },
  {
    category: 'Sloupce',
    items: [
      {
        id: 'ex-frozen',
        title: 'Ukotvené sloupce',
        blurb: 'Sloupce ukotvené vlevo/vpravo zůstanou při horizontálním scrollu na místě. Ukotvení nastavíš pinem v dialogu Sloupce (📌).',
        code: `columns = [\n  { field: 'id', frozen: true },     // vlevo\n  { field: 'name', frozen: true },\n  { field: 'active', frozen: 'right' }, // vpravo\n]`,
        mount: (el, ctx) => {
          const cols = campaignColumns();
          cols.find((c) => c.field === 'id').frozen = true;
          cols.find((c) => c.field === 'name').frozen = true;
          cols.find((c) => c.field === 'active').frozen = 'right';
          return new Lattice(el, base(ctx, { id: 'ex-frozen', columns: cols, data: ctx.data, pageSize: 25 }));
        },
      },
      {
        id: 'ex-groups',
        title: 'Skupiny sloupců',
        blurb: 'Sloupce sdružené pod společnou hlavičkou. Přeuspořádání jen v rámci skupiny nebo celé skupiny. Skupinu lze v záhlaví **sbalit** (ikona „−") do úzkého proužku a zase **rozbalit** („+"). Záhlaví skupiny i sloupce může mít **vlastní barvy** (`headerBackground`/`headerColor`); sloupce bez vlastní barvy zdědí barvu skupiny. Nastavuje se v dialogu Sloupce.',
        code: `columns = [
  // nested skupina s barvou záhlaví (sloupce ji zdědí)
  { title: 'Identifikace', headerBackground: '#0369a1', headerColor: '#fff',
    columns: [ { field: 'name' }, { field: 'owner' }, { field: 'region' } ] },
  // plochá skupina: barva přes groupHeaderBackground na členu
  { field: 'budget', group: 'Výkon', groupHeaderBackground: '#065f46', groupHeaderColor: '#fff' },
  { field: 'score',  group: 'Výkon' },
  // vlastní barva jednoho sloupce (přebije skupinu)
  { field: 'progress', group: 'Výkon', headerBackground: '#fde68a', headerColor: '#92400e' },
]
// sbalení/rozbalení za běhu: grid.toggleColGroup('Výkon')`,
        mount: (el, ctx) => {
          const cols = campaignColumns();
          const set = (f, patch) => Object.assign(cols.find((c) => c.field === f), patch);
          // Skupina „Identifikace" — barva na všech členech (zdědí ji hlavičky sloupců).
          for (const f of ['name', 'owner', 'region']) set(f, { group: 'Identifikace', groupHeaderBackground: '#0369a1', groupHeaderColor: '#ffffff' });
          // Skupina „Výkon" — jiná barva; sloupec „progress" má vlastní (přebije skupinu).
          for (const f of ['budget', 'score', 'progress', 'rating']) set(f, { group: 'Výkon', groupHeaderBackground: '#065f46', groupHeaderColor: '#ffffff' });
          set('progress', { headerBackground: '#fde68a', headerColor: '#92400e' });
          return new Lattice(el, base(ctx, { id: 'ex-groups', columns: cols, data: ctx.data, pageSize: 25 }));
        },
      },
      {
        id: 'ex-rotate',
        title: 'Otočené hlavičky',
        blurb: 'Hlavičky otočené o 90°/270° (hromadně nebo per sloupec) — úspora šířky u úzkých sloupců. Nastavení v dialogu tabulky i Sloupce.',
        code: `new Lattice('#grid', {\n  id: 'ex-rotate',\n  columns, data,\n  instance: { headerRotate: '90' },\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-rotate', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          instance: { headerRotate: '90' },
        })),
      },
      {
        id: 'ex-datatypes',
        title: 'Datové typy (showcase)',
        blurb: 'Jeden dataset, tři pohledy. <b>Sloupce ve skupinách</b> pokrývají všechny typy: id, náhled+lightbox, odkaz (přes <code>urlField</code>), ikona, money, číslo, průběh, hodnocení, <b>sparkline</b> (čára i sloupce), datum, <b>datetime</b>, tick, boolean, html, barva. Přepni <b>Plochá / Strom / Seskupeno</b> — stejná data slouží tabulce, hierarchii (programy → kampaně přes <code>parentId</code>) i seskupení řádků.',
        code: `// jeden dataset (parentId dělá z programů rodiče), tři pohledy:
new Lattice('#grid', { id, columns: showcaseColumns(), data,
  instance: { summaryRow: 'page' } });                 // Plochá
new Lattice('#grid', { id, columns, data,
  treeData: true, treeParentField: 'parentId' });      // Strom
new Lattice('#grid', { id, columns, data,
  instance: { groupBy: ['category'] } });              // Seskupeno`,
        mount: (el, ctx) => datatypesShowcase(el, ctx),
      },
      {
        id: 'ex-format',
        title: 'Formát čísel a datumů',
        blurb: 'Excel-like formát pro čísla (des. místa, oddělovač tisíců, záporná barevně/v závorkách), měnu (symbol) a datum/čas (vzory). Globálně v Nastavení tabulky → „Formát hodnot"; každý sloupec může udělit výjimku ikonou „0.0" v dialogu „Sloupce".',
        code: `columns = [\n  { field: 'amount', type: 'money', format: { negative: 'red' } },\n  { field: 'rate', type: 'number', format: { decimals: 4 } },\n  { field: 'date', type: 'date' },       // vzor dd.mm.yyyy | yyyy-mm-dd | d. mmmm yyyy…\n]\n// globálně: grid.setFormat('money', { currency: 'EUR', decimals: 2 })\n// výjimka:  grid.setColumnFormat('amount', { negative: 'redparen' })`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-format', keyField: 'id', pageSize: 15, data: financeData(),
          columns: [
            { field: 'id', title: 'ID', type: 'id', width: 56 },
            { field: 'label', title: 'Položka', type: 'text', width: 180, filter: 'text' },
            { field: 'amount', title: 'Částka', type: 'money', width: 150, format: { negative: 'red' } },
            { field: 'balance', title: 'Zůstatek', type: 'money', width: 160, format: { negative: 'redparen' } },
            { field: 'rate', title: 'Kurz', type: 'number', width: 110, format: { decimals: 4 } },
            { field: 'qty', title: 'Množství', type: 'number', width: 110 },
            { field: 'date', title: 'Datum', type: 'date', width: 130 },
            { field: 'updatedAt', title: 'Změněno', type: 'datetime', width: 170 },
          ],
        })),
      },
      {
        id: 'ex-conditional',
        title: 'Podmíněné formátování',
        blurb: 'Obarvení podle hodnot. SKÓRE má „semafor" (barevná škála) — konfigurovatelný v UI: dialog Sloupce → ikona 0.0 → „Barevná škála (semafor)": 3/5/7 hladin, vlastní prahy a přepínač „Obráceně" (nízké = zelené). Kromě toho: kód přes cellStyle/cellClass (rozpočet) a rowStyle (dokončené řádky zelenkavé).',
        code: `// A) barevná škála (semafor) — nastavitelná i v UI:
{ field: 'score', type: 'number',
  condFormat: { on: true, levels: 5, reverse: false } }  // prahy dopočte automaticky

// B) vlastní styl kódem:
{ field: 'budget', type: 'money',
  cellStyle: (v) => v < 100000 ? { color: '#dc2626' } : null }
// rowStyle: (row) => row.status === 'Dokončeno' ? { background:'#eaf7ef' } : null`,
        mount: (el, ctx) => {
          const cols = campaignColumns();
          cols.find((c) => c.field === 'score').condFormat = { on: true, levels: 5, reverse: false };
          cols.find((c) => c.field === 'budget').cellStyle = (v) => (v < 100000 ? { color: '#dc2626', fontWeight: '600' } : null);
          return new Lattice(el, base(ctx, {
            id: 'ex-conditional', columns: cols, data: ctx.data, pageSize: 15,
            rowStyle: (row) => (row.status === 'Dokončeno' ? { background: 'rgba(22,163,74,0.07)' } : null),
          }));
        },
      },
      {
        id: 'ex-themes',
        title: 'Vzhledy (motivy)',
        blurb: 'Motivy mění barvy i strukturu — font, zaoblení, padding buněk, styl hlaviček i svislé linky (Bootstrap 5, Tailwind, Material). Platí na grid i plovoucí panely (menu, dropdowny, nastavení). Totéž najdeš v Nastavení tabulky → Vzhled. Ukládá se do stavu instance.',
        code: `new Lattice('#grid', {\n  columns, data,\n  instance: { theme: 'slate' },\n  // 'default' | 'minimal' | 'slate' (tmavý) | 'ocean' | 'warm' | 'contrast'\n})\n\n// nebo za běhu:\ngrid.setInstance({ theme: 'ocean' })`,
        mount: (el, ctx) => themesExample(el, ctx),
      },
      {
        id: 'ex-layout',
        title: 'Režimy layoutu (šířka sloupců)',
        blurb: 'Jak se počítají šířky sloupců a tabulky. Přepínej režimy a sleduj rozdíl (totéž je v Nastavení tabulky → Rozložení).',
        code: `new Lattice('#grid', {\n  instance: { layout: 'fitData' },\n  // 'fitData' | 'fitDataFill' | 'fitDataStretch' | 'fitColumns'\n})`,
        mount: (el, ctx) => layoutExample(el, ctx),
      },
      {
        id: 'ex-resize',
        title: 'Vodicí čára při resize',
        blurb: 'Táhni pravý okraj hlavičky sloupce — místo živé změny se ukáže svislá vodicí čára a nová šířka se aplikuje až po puštění myši (šetří přepočty u širokých tabulek). Přepínatelné v Nastavení tabulky → „Změna šířky sloupců" (Živě / S vodicí čárou).',
        code: `new Lattice('#grid', {\n  id: 'ex-resize', columns, data,\n  instance: { resizeGuide: true },   // false = živě (nativně)\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-resize', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          instance: { resizeGuide: true },
        })),
      },
    ],
  },
  {
    category: 'Řádky',
    items: [
      {
        id: 'ex-grouping',
        title: 'Seskupení řádků',
        blurb: 'Řádky seskupené podle hodnoty sloupce — i víceúrovňově (skupina ve skupině). Seskupené úrovně se ukážou jako **ukotvené vedoucí sloupce vlevo** (při scrollu doprava zůstanou stát, reálné sloupce odjedou za nimi). Zapíná se pinem „seskupit" v dialogu Sloupce; klikni na řadicí šipku v hlavičce skupiny pro seřazení skupin. Zapnuté jsou i MEZISOUČTY za každou skupinu — Nastavení tabulky → „Mezisoučty skupin", a přepínač zobrazení „Úrovně seskupení" (vnořené hlavičky / vedoucí sloupce).',
        code: `new Lattice('#grid', {\n  id: 'ex-grouping',\n  columns: [{ field: 'budget', type: 'money', summary: ['sum','avg'] }, …],\n  instance: { groupBy: ['region', 'owner'], groupSubtotals: true },\n})`,
        mount: (el, ctx) => {
          const cols = campaignColumns();
          cols.find((c) => c.field === 'budget').summary = ['sum', 'avg'];
          cols.find((c) => c.field === 'score').summary = ['avg'];
          return new Lattice(el, base(ctx, {
            id: 'ex-grouping', columns: cols, data: ctx.data, pageSize: 100,
            instance: { groupBy: ['region', 'owner'], groupSubtotals: true },
          }));
        },
      },
      {
        id: 'ex-date-group',
        title: 'Seskupení podle data',
        blurb: 'Datumový sloupec lze seskupit podle úrovní — rok, kvartál, měsíc, týden, den v týdnu, den v měsíci, hodina, minuta — i víc úrovní najednou (Rok → Kvartál → Den v týdnu). Knihovna kbelík odvodí a seřadí chronologicky. V dialogu Sloupce klikni na „seskupit" u datumového sloupce → vyber úrovně. Zobrazení řídí Nastavení tabulky → „Úrovně seskupení": <b>vnořené hlavičky</b>, nebo <b>vedoucí sloupce</b> (rok/kvartál/… zleva u každého řádku).',
        code: `new Lattice('#grid', {\n  columns: [{ field: 'createdAt', type: 'date' }, …],\n  instance: {\n    // víc úrovní jednoho data → { field, part }\n    groupBy: [\n      { field: 'createdAt', part: 'year' },\n      { field: 'createdAt', part: 'quarter' },\n      { field: 'createdAt', part: 'weekday' },\n    ],\n    groupDisplay: 'columns', // nebo 'headers'\n  },\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-date-group', columns: campaignColumns(), data: ctx.data, pageSize: 100,
          instance: {
            groupBy: [
              { field: 'createdAt', part: 'year' },
              { field: 'createdAt', part: 'quarter' },
              { field: 'createdAt', part: 'weekday' },
            ],
            groupDisplay: 'columns',
          },
        })),
      },
      {
        id: 'ex-summary',
        title: 'Souhrny sloupců i řádků',
        blurb: 'Křížové souhrny jako v tabulkovém procesoru. Dole souhrn SLOUPCŮ (součet/průměr každého kvartálu), vpravo souhrn ŘÁDKŮ (roční součet a průměr kvartálů daného produktu). Ikona Σ v dialogu „Sloupce" nabízí obě sady — „Pro sloupce" a „Pro řádky".',
        code: `columns = [\n  // Σ dole (souhrn sloupce) i Σ vpravo (souhrn řádku):\n  { field: 'q1', type: 'money', summary: ['sum','avg'], rowSummary: ['sum','avg'] },\n  { field: 'q2', type: 'money', summary: ['sum','avg'], rowSummary: ['sum','avg'] },\n  { field: 'q3', type: 'money', summary: ['sum','avg'], rowSummary: ['sum','avg'] },\n  { field: 'q4', type: 'money', summary: ['sum','avg'], rowSummary: ['sum','avg'] },\n]\n// instance: { summaryRow: 'page' }  ·  ikona Σ → „Pro sloupce" / „Pro řádky"`,
        mount: (el, ctx) => {
          const q = { type: 'money', summary: ['sum', 'avg'], rowSummary: ['sum', 'avg'] };
          const cols = [
            { field: 'id', title: 'ID', type: 'id', width: 56 },
            { field: 'product', title: 'Produkt', type: 'text', width: 190, filter: 'text' },
            { field: 'q1', title: 'Q1', ...q },
            { field: 'q2', title: 'Q2', ...q },
            { field: 'q3', title: 'Q3', ...q },
            { field: 'q4', title: 'Q4', ...q },
          ];
          return new Lattice(el, base(ctx, {
            id: 'ex-summary', columns: cols, data: quarterlySales(), keyField: 'id', pageSize: 25,
            instance: { summaryRow: 'all' },
          }));
        },
      },
      {
        id: 'ex-rownumbers',
        title: 'Číslování řádků',
        blurb: 'Levý gutter s pořadím řádků — průběžné přes stránky nebo od 1 na každé stránce. Šířku lze roztáhnout. Nastavení v dialogu tabulky.',
        code: `new Lattice('#grid', {\n  id: 'ex-rownumbers',\n  columns, data,\n  instance: { rowNumbers: 'continuous' },\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-rownumbers', columns: coreColumns(), data: ctx.data, pageSize: 25,
          instance: { rowNumbers: 'continuous' },
        })),
      },
      {
        id: 'ex-editing',
        title: 'Inline editace',
        blurb: 'Dvojklik na buňku → editor podle typu: text, číslo, výběr/multiselect (Select2-like), datum + čas, barva (RGB/CMYK), progress tažením, rating klikem, boolean přepínač. onCellEdit dá změnu backendu.',
        code: `columns = withEditing(columns) // editable: true\nnew Lattice('#grid', {\n  id: 'ex-editing', columns, data,\n  onCellEdit: ({ field, row, newValue }) => save(row.id, field, newValue),\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-editing', columns: withEditing(campaignColumns()), data: ctx.data, pageSize: 25,
        })),
      },
      {
        id: 'ex-a11y',
        title: 'Přístupnost a klávesnice',
        blurb: 'Klikni do buňky (nebo se do tabulky dostaň Tabem) a používej klávesnici: ŠIPKY = pohyb mezi buňkami, Home/End = začátek/konec řádku (s Ctrl celá tabulka), PageUp/Down = o 10 řádků, Enter/F2 = editace. Fokus buňky má viditelný obrys. Grid má ARIA role (grid/row/gridcell/columnheader, aria-sort, aria-selected).',
        code: `// Přístupnost je vždy zapnutá — žádná konfigurace není potřeba.
// Klávesy: šipky · Home/End (+Ctrl) · PageUp/Down · Enter/F2 = editace.
new Lattice('#grid', { columns: withEditing(columns), data });`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-a11y', columns: withEditing(campaignColumns()), data: ctx.data, pageSize: 12, selectable: true,
        })),
      },
      {
        id: 'ex-callbacks',
        title: 'Callbacky a události',
        blurb: 'Vše, co knihovna hlásí aplikaci. Klikni na řádek/buňku, řaď (klik na hlavičku), filtruj, přepínej stránky, přesouvej/skrývej/měň šířku sloupců (⋮ menu, tažení), edituj buňky. Pravý klik = onRowContext. Editace „Název" na prázdno je zamítnuta přes onCellValidate.',
        code: `new Lattice('#grid', {\n  columns: withEditing(columns), data, keyField: 'id',\n\n  // interakce\n  onRowClick:    (row, index, e) => open(row),\n  onCellClick:   ({ field, value, row }, e) => {},\n  onRowContext:  (row, index, e) => { e.preventDefault(); menu(row) },\n\n  // změny stavu (persistence / URL / analytika)\n  onSort:        (sort) => {},               // [{ field, dir }]\n  onFilter:      ({ filters, universal, advanced }) => {},\n  onPageChange:  ({ page, pageSize }) => {},\n  onColumnLayoutChange: ({ kind, detail, columns }) => saveLayout(columns),\n\n  // validace PŘED přijetím editace (false = zamítnout)\n  onCellValidate: ({ field, newValue }) => field !== 'name' || !!String(newValue).trim(),\n  onCellEdit:     ({ field, row, newValue }) => save(row.id, field, newValue),\n})`,
        mount: (el, ctx) => callbacksExample(el, ctx),
      },
      {
        id: 'ex-i18n',
        title: 'Překlad do dalšího jazyka',
        blurb: 'Nástroj vygeneruje z cs/en všechny řetězce, přeložíš je (ručně nebo přes „zadání pro překladač" do libovolného překladače/LLM a import zpět), stáhneš hotový soubor a uložíš do src/i18n/. Zástupné symboly {n} zůstávají zachovány, náhled ukáže výsledek živě.',
        code: `// 1) v nástroji přelož a stáhni např. de.js → ulož do src/i18n/\n// 2) zaregistruj jednou a používej jako vestavěný jazyk:\nimport { registerLanguage } from 'lattice';\nimport de from './i18n/de.js';\nregisterLanguage('de', de);\n\nnew Lattice('#grid', { columns, data, i18n: 'de' });\n\n// (nebo bez registrace rovnou objektem:)\nnew Lattice('#grid', { columns, data, i18n: de });`,
        mount: (el, ctx) => i18nStudioExample(el, ctx),
      },
    ],
  },
  {
    category: 'Stránkování',
    items: [
      {
        id: 'ex-pagination',
        title: 'Režimy stránkování',
        blurb: 'Paginace v záhlaví / v zápatí / na obou / vypnutá; velikost stránky; ruční skok na stránku. Nastavení v dialogu tabulky.',
        code: `new Lattice('#grid', {\n  id: 'ex-pagination',\n  columns, data,\n  pageSize: 10,\n  instance: { paginationPosition: 'both' },\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-pagination', columns: coreColumns(), data: ctx.data, pageSize: 10,
          instance: { paginationPosition: 'both' },
        })),
      },
    ],
  },
  {
    category: 'Hierarchie (Tree)',
    items: [
      {
        id: 'ex-tree-nested',
        title: 'Tree — zanořené _children',
        blurb: 'Organizační struktura ze zanořených dat: každý záznam má pole _children s podřízenými stejného tvaru. Rozbalovací šipka + odsazení v prvním sloupci. Stav rozbalení se ukládá. Filtry v záhlaví i rychlé hledání fungují — zachovají cestu k nálezu (rodiče) a větev se shodou se rozbalí.',
        code: `new Lattice('#grid', {\n  id: 'ex-tree-nested',\n  columns: orgColumns(),\n  data: orgNested(),   // [{ name, role, _children:[…] }]\n  treeData: true,\n  treeStartExpanded: 1,\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-tree-nested', columns: orgColumns(), data: orgNested(), quickSearch: true,
          treeData: true, treeIdField: 'id', treeStartExpanded: 1,
        })),
      },
      {
        id: 'ex-tree-flat',
        title: 'Tree — plochý parentId',
        blurb: 'Týž strom z plochého seznamu: každý záznam má vlastní id a odkaz na nadřízeného parentId. Strom si knihovna sestaví sama. Ideální, když z DB chodí plochý výsledek.',
        code: `new Lattice('#grid', {\n  id: 'ex-tree-flat',\n  columns: orgColumns(),\n  data: orgFlat(),   // [{ id, parentId, name, role }]\n  treeData: true,\n  treeIdField: 'id',\n  treeParentField: 'parentId',\n  treeStartExpanded: 1,\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-tree-flat', columns: orgColumns(), data: orgFlat(),
          treeData: true, treeIdField: 'id', treeParentField: 'parentId', treeStartExpanded: 1,
        })),
      },
      {
        id: 'ex-tree-nestedset',
        title: 'Tree — nested set (lft/rgt)',
        blurb: 'Týž strom uložený metodou Nested Set (MPTT): každý záznam nese lft/rgt z obcházení stromu — žádné parentId. Potomci jsou záznamy, jejichž interval [lft,rgt] leží uvnitř rodiče. Hloubku i pořadí si knihovna spočítá z lft/rgt. Sloupce lft/rgt jsou tu schválně vidět.',
        code: `new Lattice('#grid', {\n  id: 'ex-tree-nestedset',\n  columns: orgColumnsNS(),\n  data: orgNestedSet(),   // [{ name, role, lft, rgt }]\n  treeData: true,\n  treeLeftField: 'lft',\n  treeRightField: 'rgt',\n  treeStartExpanded: 1,\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-tree-nestedset', columns: orgColumnsNS(), data: orgNestedSet(),
          treeData: true, treeIdField: 'id', treeLeftField: 'lft', treeRightField: 'rgt', treeStartExpanded: 1,
        })),
      },
    ],
  },
  {
    category: 'Import',
    items: [
      {
        id: 'ex-file',
        title: 'Soubor (CSV / JSON / XML)',
        blurb: 'Bez definice sloupců (autoColumns): po načtení souboru knihovna sama odvodí sloupce z klíčů dat, odhadne typy (číslo/datum/ano-ne/text) a zobrazí tabulku. Vyber soubor, nebo zkus ukázku.',
        code: `const grid = new Lattice('#grid', {\n  id: 'ex-file',\n  autoColumns: true,   // sloupce se odvodí z dat\n})\n\n// z <input type=file>:\ninput.onchange = () => grid.importFile(input.files[0])\n\n// nebo přímo data odkudkoli:\n// grid.importRows(rows)`,
        mount: (el, ctx) => fileLoadExample(el, ctx),
      },
      {
        id: 'ex-web',
        title: 'Z URL (HTML tabulka / XML feed)',
        blurb: 'Zadej URL a číslo tabulky — knihovna stránku načte, najde N-tou HTML <table> a zobrazí ji. Umí i XML (ATOM/RSS): najde opakující se záznam a udělá z něj řádky. Kvůli CORS jde přes serverový proxy (v EverFLOW to bude tvůj backend).',
        code: `// HTML: N-tá <table> na stránce\ngrid.importFromUrl(url, tableIndex, { proxy })\n\n// XML/ATOM/RSS (formát se rozpozná sám)\ngrid.importFromUrl('https://atom.cuzk.gov.cz/get.ashx?theme=RUIAN-CSV-ADR-OB', 0, { proxy })\n\n// proxy jen kvůli CORS — v reálné aplikaci vlastní backend endpoint:\nconst proxy = (u) => 'api/fetch.php?url=' + encodeURIComponent(u)`,
        mount: (el, ctx) => webImportExample(el, ctx),
      },
    ],
  },
  {
    category: 'Přesouvání',
    items: [
      {
        id: 'ex-move-flat',
        title: 'Plochá data (position)',
        blurb: 'Přetáhni řádek za úchyt (⠿) v prvním sloupci nad/pod jiný. U plochých dat s pořadovým polem knihovna po přesunu přečísluje position (1..n) a přes onRowMove ti předá změněné řádky k uložení.',
        code: `new Lattice('#grid', {\n  id: 'ex-move-flat', columns, data,\n  keyField: 'id',\n  movableRows: true,\n  orderField: 'position',   // po přesunu se přečísluje\n  onRowMove: ({ changed }) => persist(changed), // ulož na backend\n})`,
        mount: (el, ctx) => moveFlatExample(el, ctx),
      },
      {
        id: 'ex-move-groups',
        title: 'Přesun mezi skupinami',
        blurb: 'Se zapnutým seskupením (tady dle Regionu): přetáhni řádek za úchyt ⠿ do jiné skupiny — buď na její hlavičku, nebo mezi její řádky. Kromě pořadí se změní i hodnota sloupce, podle kterého se seskupuje (region). onRowMove přinese řádek s novou hodnotou.',
        code: `new Lattice('#grid', {\n  columns, data, keyField: 'id',\n  instance: { groupBy: ['region'] },\n  movableRows: true,\n  onRowMove: ({ row, groupBy, groupChanged }) => {\n    // row[groupBy[0]] = hodnota cílové skupiny (změněná)\n    persist(row)\n  },\n})`,
        mount: (el, ctx) => groupMoveExample(el, ctx),
      },
      {
        id: 'ex-move-children',
        title: 'Strom — zanořené _children',
        blurb: 'Přetáhni uzel za úchyt ⠿ (vezme s sebou celý podstrom). Puštění nad/pod řádek = přeuspořádání mezi sourozenci; puštění „dovnitř" (střed řádku) ho přesune do children jiného uzlu. onRowMove přinese změněné _children k uložení.',
        code: `new Lattice('#grid', {\n  columns: orgColumns(), data: orgNested(),\n  treeData: true, treeIdField: 'id',\n  movableRows: true,\n  onRowMove: ({ changed }) => persist(changed),\n})`,
        mount: (el, ctx) => withEventLog(el, ctx, {
          id: 'ex-move-children', columns: orgColumns(), data: orgNested(),
          treeData: true, treeIdField: 'id', treeStartExpanded: 1, movableRows: true,
        }, 'Přetáhni uzel za úchyt ⠿. „Dovnitř" (střed řádku) = přesun do children cílového uzlu; nad/pod = mezi sourozence.'),
      },
      {
        id: 'ex-move-parentid',
        title: 'Strom — plochý parentId',
        blurb: 'Táhnutím „dovnitř" jiného řádku přepíšeš parentId přesouvaného uzlu (přeřazení pod jiného rodiče); nad/pod mění pořadí mezi sourozenci. onRowMove dá nový parentId i změněné řádky k uložení.',
        code: `new Lattice('#grid', {\n  columns: orgColumns(), data: orgFlat(),\n  treeData: true, treeIdField: 'id', treeParentField: 'parentId',\n  movableRows: true,\n  onRowMove: ({ row, toParentId, changed }) => persist(changed),\n})`,
        mount: (el, ctx) => withEventLog(el, ctx, {
          id: 'ex-move-parentid', columns: orgColumns(), data: orgFlat(),
          treeData: true, treeIdField: 'id', treeParentField: 'parentId', treeStartExpanded: 1, movableRows: true,
        }, 'Přetáhni uzel „dovnitř" jiného → přepíše se parentId. V alertu uvidíš nový parentId i změněné řádky.'),
      },
      {
        id: 'ex-move-nestedset',
        title: 'Strom — nested set (lft/rgt)',
        blurb: 'Nejsložitější případ: po přesunu uzlu (s podstromem) knihovna přečísluje lft/rgt CELÉHO stromu v preorder. onRowMove přinese všechny řádky s novými hodnotami — ty pak uložíš (naivně bulk UPDATE, nebo klasické nested-set shift dotazy).',
        code: `new Lattice('#grid', {\n  columns: orgColumnsNS(), data: orgNestedSet(),\n  treeData: true, treeIdField: 'id',\n  treeLeftField: 'lft', treeRightField: 'rgt',\n  movableRows: true,\n  onRowMove: ({ changed }) => persist(changed), // řádky s novými lft/rgt\n})`,
        mount: (el, ctx) => withEventLog(el, ctx, {
          id: 'ex-move-nestedset', columns: orgColumnsNS(), data: orgNestedSet(),
          treeData: true, treeIdField: 'id', treeLeftField: 'lft', treeRightField: 'rgt', treeStartExpanded: 1, movableRows: true,
        }, 'Přetáhni uzel ⠿. Po přesunu se přečísluje lft/rgt celého stromu — v alertu uvidíš všechny změněné řádky.'),
      },
    ],
  },
  {
    category: 'Akce',
    items: [
      {
        id: 'ex-actions',
        title: 'Sloupec akcí (+ řízení přístupu)',
        blurb: 'Aplikace dodá options.actions (co dělají i kdo na ně má právo). Edit/View/Delete mají výchozí ikony. Řízení přístupu: „Smazat" je skryté u dokončených kampaní (visible), „Upravit" je zakázané u běžících (disabled). V Nastavení tabulky přepni zobrazení: poslední sloupec s ikonami ↔ ⋮ menu v číslování řádků.',
        code: `new Lattice('#grid', {\n  id: 'ex-actions', columns, data, keyField: 'id',\n  instance: { actionsLayout: 'column' }, // 'column' = ikony ve sloupci | 'menu' = ⋮ trojtečkové menu\n  actions: [\n    { name: 'view',   onClick: (row) => open(row) },\n    { name: 'edit',   onClick: (row) => edit(row),\n      disabled: (row) => row.status === 'Běží' },      // zamčené\n    { name: 'delete', onClick: (row) => grid.deleteRow(row.id),\n      visible:  (row) => row.status !== 'Dokončeno',   // řízení přístupu\n      danger: true },\n  ],\n})`,
        mount: (el, ctx) => actionsExample(el, ctx),
      },
    ],
  },
  {
    category: 'Výběr',
    items: [
      {
        id: 'ex-select',
        title: 'Výběr řádků + hromadné úpravy',
        blurb: 'Zaškrtávací sloupec (selectable). Caret (▾) v hlavičce přepíná ROZSAH výběru — „Stránka" nebo „Všechny záznamy (N)" — a na ten rozsah se vztahuje horní checkbox i „Invertovat výběr". Výběr drží podle keyField, takže přežije stránkování, řazení i filtr. Shift-klik vybere rozsah. V Nastavení tabulky lze skrýt sloupec a přepnout výběr klikem na řádek. Vybrané řádky měníš hromadně přes updateData / deleteRow.',
        code: `new Lattice('#grid', {\n  id: 'ex-select', columns, data,\n  keyField: 'id',\n  selectable: true,   // | 'single' | 5 (max)\n  onSelectionChange: (rows) => console.log(rows.length, 'vybráno'),\n})\n\n// hromadná úprava vybraných:\nconst ids = grid.getSelectedKeys()\ngrid.updateData(ids.map((id) => ({ id, status: 'Dokončeno' })))\ngrid.getSelectedRows().forEach((r) => grid.deleteRow(r.id))`,
        mount: (el, ctx) => selectExample(el, ctx),
      },
    ],
  },
  {
    category: 'Popup',
    items: [
      {
        id: 'ex-popup',
        title: 'Popup na buňce i hlavičce',
        blurb: 'Klikni na buňku Vlastník → info karta. Klikni na buňku Stav → interaktivní popup pro změnu stavu (mění data přes updateRow a sám se zavře). Klikni na ⓘ v hlavičce Rozpočet → statistika sloupce. Obsah popupu dodá aplikace (string nebo DOM), dostane close().',
        code: `columns = [\n  { field: 'owner', cellPopup: ({ row }) => '<b>' + row.owner + '</b><br>…' },\n  { field: 'status', cellPopup: ({ row, close, grid }) => buildStatusPicker(row, grid, close) },\n  { field: 'budget', headerPopup: ({ grid, close }) => statsHtml(grid) },\n]`,
        mount: (el, ctx) => popupExample(el, ctx),
      },
      {
        id: 'ex-menu',
        title: 'Menu hlavičky · řádku · buňky',
        blurb: 'Tři různá kontextová menu, každé na pravý klik jinam: ⋮ v hlavičce = příkazy SLOUPCE (řadit, skrýt, ukotvit, seskupit… + vlastní); # nebo ID sloupec = menu ŘÁDKU (Duplikovat / Smazat, s řízením přístupu); běžná buňka = menu BUŇKY (Editovat zde / Kopírovat hodnotu). Sloupec typu „id" se nikdy needituje a slouží jako spouštěč menu řádku.',
        code: `new Lattice('#grid', {\n  columns: [{ field:'id', type:'id' }, { field:'name', headerMenu:true }, …],\n  rowContextMenu:  (row) => [ { label:'Smazat', action:(r)=>grid.deleteRow(r.id) } ],\n  cellContextMenu: ({ field, index, col }) => [\n    { label:'Editovat zde', disabled: !col.editable, action:(c)=>grid.editCell(c.index, c.field) },\n  ],\n})`,
        mount: (el, ctx) => menuExample(el, ctx),
      },
      {
        id: 'ex-history',
        title: 'Historie (zpět / znovu)',
        blurb: 'S history: true se sledují změny dat — úpravy buněk (dvojklik), přidání/smazání řádku, hromadné úpravy i vložení rozsahu. V toolbaru vlevo jsou tlačítka Zpět / Znovu / Vymazat (funguje i Ctrl/⌘+Z a Ctrl+Y). Kolik kroků se drží, nastaví historySize (default 50).',
        code: `new Lattice('#grid', {\n  id: 'ex-history', columns, data, keyField: 'id',\n  editable: true,\n  history: true,\n  historySize: 30,   // kolik kroků držet\n})\n// grid.undo() · grid.redo() · grid.clearHistory()`,
        mount: (el, ctx) => historyExample(el, ctx),
      },
    ],
  },
  {
    category: 'Mezi tabulkami',
    items: [
      {
        id: 'ex-between',
        title: 'Přesun mezi tabulkami (+ koš)',
        blurb: 'Přetáhni řádek za úchyt ⠿ z jedné tabulky do druhé — cílová tabulka ho přijme (acceptExternalRows) a ze zdroje zmizí. Payload řádku jde přes dataTransfer, takže funguje i drop na libovolný prvek: přetáhni řádek na 🗑 koš = smazání. onRowReceive ti dá, co se přijalo.',
        code: `const src = new Lattice('#a', { id:'a', columns, data, movableRows:true })\nconst dst = new Lattice('#b', { id:'b', columns, data:[],\n  movableRows:true, acceptExternalRows:true,   // | 'copy'\n  onRowReceive:(row,{fromId})=> persist(row),\n})\n\n// drop na libovolný prvek (koš):\ntrash.ondragover = e => e.preventDefault()\ntrash.ondrop = e => {\n  const { src, key } = JSON.parse(e.dataTransfer.getData('application/x-lattice-row'))\n  gridById(src).deleteRow(key)\n}`,
        mount: (el, ctx) => betweenTablesExample(el, ctx),
      },
    ],
  },
  {
    category: 'Rozsah buněk',
    items: [
      {
        id: 'ex-range',
        title: 'Výběr rozsahu + schránka',
        blurb: 'Spreadsheet-like výběr obdélníku buněk: táhni myší, shift-klik rozšíří, šipky / shift+šipky posouvají. Ctrl/⌘+C zkopíruje rozsah jako TSV (vlož do Excelu/Sheets), Ctrl/⌘+V vloží TSV do editovatelných buněk. Ctrl/⌘+A vybere vše. Dole naskočí <b>souhrn výběru</b> (počet, součet, průměr, min/max). A táhnutím <b>rohu výběru</b> (fill handle) hodnoty vyplníš přes rozsah — čísla/data se dopočítají jako posloupnost, ostatní se kopírují.',
        code: `new Lattice('#grid', {\n  id: 'ex-range', columns, data,\n  rangeSelection: true,   // výběr rozsahu buněk + Ctrl+C/V\n  editable: true,         // aby šlo vkládat (paste)\n  onRangeCopy: (data, tsv) => {},   // rozsah zkopírován\n  onCellEdit: ({ field, row, newValue }) => save(...),\n})`,
        mount: (el, ctx) => rangeExample(el, ctx),
      },
    ],
  },
  {
    category: 'Živá data',
    items: [
      {
        id: 'ex-reactive',
        title: 'Změny řádků za běhu',
        blurb: 'Granulární API místo Proxy „reaktivity": addRow / updateRow / deleteRow / updateData (dle keyField). Grid se cíleně překreslí. „Živé updaty" simulují push ze serveru (websocket) — periodicky mění skóre náhodných řádků.',
        code: `const grid = new Lattice('#grid', { id, columns, data, keyField: 'id' })\n\ngrid.addRow({ id: 100, name: 'Nová' }, true) // na začátek\ngrid.updateRow(2, { score: 99 })            // merge dle id\ngrid.deleteRow(2)\ngrid.updateData([{ id: 3, score: 50 }, …])  // hromadný upsert\n\n// „reaktivní" scénář = po AJAX/websocketu prostě zavoláš updateRow(...)`,
        mount: (el, ctx) => reactivityExample(el, ctx),
      },
    ],
  },
  {
    category: 'Persistence',
    items: [
      {
        id: 'ex-presets',
        title: 'Presety + nastavení',
        blurb: 'Uložené pohledy — lokální (jen pro mě, v prohlížeči) i globální (sdílené). Nad polem s názvem si zaškrtneš, <b>co preset ponese</b>: <b>Sloupce</b>, <b>Filtry a řazení</b>, <b>Nastavení tabulky</b> (seskupení řádků, souhrnný řádek, mezisoučty skupin, vzhled). Preset pak mění <b>jen ty části, které obsahuje</b> — „jen filtry\" ti nepřerovná sloupce ani nezruší seskupení. Globální spravuje APLIKACE: pole se předá při startu, uložení posílá callback (klik na globus vedle záložky).',
        code: `new Lattice('#grid', {\n  id: 'ex-presets', columns, data,\n  globalPresets,                              // pole uložené aplikací\n  onSaveGlobalPreset: (preset) => saveToDb(preset),   // globus → callback\n  onDeleteGlobalPreset: (preset) => removeFromDb(preset.id),\n})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-presets', columns: campaignColumns(), data: ctx.data, pageSize: 25,
          globalPresets: ctx.globalPresets,
          onSaveGlobalPreset: ctx.onSaveGlobalPreset,
          onDeleteGlobalPreset: ctx.onDeleteGlobalPreset,
        })),
      },
    ],
  },
  {
    category: 'Novinky',
    items: [
      {
        id: 'ex-tips',
        title: 'Tipy pro uživatele',
        blurb: 'Nad tabulkou může být info pruh s jednořádkovým tipem pro toho, kdo v tabulce pracuje — přesun sloupců myší, Shift+klik pro víceúrovňové řazení, typy filtrů, seskupení, souhrny, pohledy… Tip se losuje při každém otevření, šipka vylosuje další. Zapíná se volbou <code>tips: true</code> (výchozí vypnuto), uživatel si pruh vypne křížkem a zapne zpět v <i>Nastavení tabulky → Vzhled</i>. Vestavěných tipů je 69 (cs/en/pl/sk) a nabízejí se jen ty, které na tuhle tabulku sedí — tip o stromu nebo o výběru řádků se v gridu bez nich neukáže. Vlastní tipy aplikace přidá přes <code>tips: { extra: [...] }</code>.',
        code: `new Lattice('#grid', {
  columns, data,
  tips: true,                       // pruh s tipem nad tabulkou (vestavěné tipy)
})

// jemněji: vlastní tipy aplikace (nebo jen ony, bez vestavěných)
new Lattice('#grid', {
  columns, data,
  tips: { extra: ['Detail kampaně otevřeš klikem na řádek.'], builtin: true },
})

// programově:
grid.nextTip()        // vylosuje a zobrazí další tip
grid.hideTips()       // = instance.showTips: false (uživatelská volba, persistuje se)
grid.tipsVisible()`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-tips', columns: campaignColumns(), data: ctx.data, pageSize: 15,
          tips: { extra: ['Tenhle tip dodala aplikace přes tips.extra — vedle vestavěných.'] },
        })),
      },
      {
        id: 'ex-highlight',
        title: 'Zvýraznění řádků',
        blurb: 'Klikni na řádek → žluté podbarvení; druhý klik odbarví, klidně víc řádků najednou. Zapíná <code>instance.rowHighlight: true</code>. Stav drží knihovna — přežije řazení/filtr/stránkování i re-render a persistuje se do localStorage. Klik do editovatelné buňky, akčního tlačítka nebo checkboxu výběru se ignoruje. Barvu řídí CSS proměnná <code>--lattice-row-highlight-bg</code> (bez <code>!important</code>). Poslední sloupec „Poznámka" má <code>col.wrap: true</code> — zalamuje se jen on, ostatní zůstávají na jednom řádku.',
        code: `new Lattice('#grid', {\n  columns, data,\n  instance: { rowHighlight: true },   // klik na řádek přepíná podbarvení\n  onHighlightChange: (keys) => save(keys),\n})\n\n// programově:\ngrid.highlightRow(id)\ngrid.toggleRowHighlight(id)\ngrid.clearHighlights()\ngrid.highlightedRows            // ['12', '34', …]\n\n// per-sloupcové zalamování (nezávislé na globálním wrapText):\ncolumns = [{ field: 'note', title: 'Poznámka', wrap: true }, …]`,
        mount: (el, ctx) => {
          const cols = campaignColumns().concat([
            { field: 'note', title: 'Poznámka', type: 'text', width: 240, wrap: true,
              value: (r) => `Kampaň ${r.name} v regionu ${r.region} spravuje ${r.owner}; rozpočet ${r.budget} Kč, stav „${r.status}".` },
          ]);
          return new Lattice(el, base(ctx, {
            id: 'ex-highlight', columns: cols, data: ctx.data, pageSize: 15,
            instance: { rowHighlight: true },
          }));
        },
      },
      {
        id: 'ex-computed',
        title: 'Počítané sloupce',
        blurb: 'Sloupec nemusí číst jen jedno pole — hodnotu spočítá z celého řádku. V kódu funkcí `value: (row) => …`, nebo vzorcem `formula: \'…\'` (bezpečně vyhodnocený, bez eval). Nově i přímo v UI: v dialogu „Sloupce" (ozubené kolo) tlačítkem „＋ Přidat počítaný sloupec" — zadáš vzorec jako `budget / score` a pole vkládáš klikáním, s živým náhledem. Řadí se, filtruje, hledá i exportuje podle spočítané hodnoty; odvozené sloupce se needitují a UI-vzorce se pamatují (i v presetech).',
        code: `// v kódu — funkcí nebo vzorcem (řetězec):
columns = [
  { field: 'who', title: 'Vlastník (region)',
    value: (r) => r.owner + ' — ' + r.region },
  { field: 'perScore', title: 'Cena za bod', type: 'money',
    formula: 'round(budget / score, 0)' },
]

// za běhu / z UI (dialog Sloupce → „＋ Přidat počítaný sloupec"):
grid.addComputedColumn({
  title: 'Cena za bod', type: 'number',
  formula: 'round(budget / score, 0)',
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-computed', keyField: 'id', pageSize: 15, data: ctx.data,
          columns: [
            { field: 'id', title: 'ID', type: 'id', width: 70 },
            { field: 'name', title: 'Název', type: 'text', width: 190, filter: 'text' },
            { field: 'who', title: 'Vlastník (region)', type: 'text', width: 200, value: (r) => r.owner + ' — ' + r.region },
            { field: 'budget', title: 'Rozpočet', type: 'money', width: 140, formatterParams: { currency: 'CZK' } },
            { field: 'score', title: 'Skóre', type: 'number', width: 90 },
            // Počítaný sloupec zadaný VZORCEM (řetězec) — stejný engine jako v UI.
            { field: 'perScore', title: 'Cena za bod', type: 'money', width: 130, filter: 'number-range', formatterParams: { currency: 'CZK' }, formula: 'score > 0 ? round(budget / score, 0) : 0' },
          ],
        })),
      },
      {
        id: 'ex-rowdetail',
        title: 'Rozbalovací detail řádku',
        blurb: 'Šipka na začátku řádku rozbalí panel pod ním (master-detail). Obsah dodá `rowDetail: (row) => HTMLElement | string`. Ideální pro související data, která se nevejdou do sloupců. Jen ploché řádky (ne strom / virtuální scroll).',
        code: `new Lattice('#grid', {
  id: 'ex-rowdetail', columns, data, keyField: 'id',
  rowDetail: (row) => \`
    <b>\${row.name}</b> — \${row.status}<br>
    Vlastník: \${row.owner} (\${row.region})<br>
    Rozpočet: \${row.budget.toLocaleString('cs')} Kč, skóre \${row.score}\`,
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-rowdetail', keyField: 'id', pageSize: 12, data: ctx.data,
          columns: coreColumns(),
          rowDetail: (row) => {
            const box = document.createElement('div');
            box.style.cssText = 'display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap';
            box.innerHTML = `<div><div style="font-weight:600;font-size:15px;margin-bottom:4px">${row.name}</div>`
              + `<div style="color:var(--lattice-muted)">${row.category} · ${row.status}</div></div>`
              + `<div>Vlastník<br><b>${row.owner}</b> <span style="color:var(--lattice-muted)">(${row.region})</span></div>`
              + `<div>Rozpočet<br><b>${Number(row.budget).toLocaleString('cs')} Kč</b></div>`
              + `<div>Skóre<br><b>${row.score}</b> / 100</div>`;
            return box;
          },
        })),
      },
      {
        id: 'ex-responsive',
        title: 'Responsivní skládání sloupců',
        blurb: 'Zúži okno (nebo tento panel) — přetečené sloupce se automaticky složí do rozbalovacího detailu řádku (šipka vlevo), místo vodorovného scrollu. Pořadí schovávání řídí `col.responsive` (vyšší číslo = schová se dřív), `responsive: false` sloupec připne. Sleduje šířku kontejneru přes ResizeObserver.',
        code: `new Lattice('#grid', {
  id: 'ex-responsive', columns, data, keyField: 'id',
  responsive: true,   // úzký viewport → přetečené sloupce do detailu
})

// priorita skládání per sloupec:
columns = [
  { field: 'name', responsive: false },  // nikdy neschovat
  { field: 'note', responsive: 10 },     // schová se první
]`,
        mount: (el, ctx) => responsiveExample(el, ctx),
      },
      {
        id: 'ex-bulk',
        title: 'Lišta hromadných akcí',
        blurb: 'Vyber řádky (zaškrtávátka) → nad tabulkou naskočí lišta s počtem a tlačítky akcí. Akce dodá aplikace přes `selectionActions`; dostane vybrané řádky, klíče a grid. „Zrušit výběr" je vestavěné. Tady: označit jako dokončené (updateData) a smazat výběr (deleteRow).',
        code: `new Lattice('#grid', {
  id: 'ex-bulk', columns, data, keyField: 'id', selectable: true,
  selectionActions: [
    { label: 'Označit dokončené', onClick: (rows, keys, grid) =>
        grid.updateData(keys.map((id) => ({ id, status: 'Dokončeno' }))) },
    { label: 'Smazat', danger: true, onClick: (rows, keys, grid) => {
        keys.forEach((id) => grid.deleteRow(id)); grid.clearSelection(); } },
  ],
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-bulk', keyField: 'id', pageSize: 12, data: ctx.data.slice(), selectable: true,
          columns: coreColumns(),
          selectionActions: [
            { label: 'Označit dokončené', onClick: (rows, keys, grid) => grid.updateData(keys.map((id) => ({ id, status: 'Dokončeno' }))) },
            { label: 'Smazat', danger: true, onClick: (rows, keys, grid) => { keys.forEach((id) => grid.deleteRow(id)); grid.clearSelection(); } },
          ],
        })),
      },
      {
        id: 'ex-sparkline',
        title: 'Sparkline (mini graf v buňce)',
        blurb: 'Typ sloupce <code>sparkline</code> vykreslí z pole hodnot malý graf — čárový nebo sloupcový, čisté SVG bez závislosti. Barva se dědí z motivu, přepíše <code>color</code>.',
        code: `columns = [
  { field: 'trend', title: 'Trend', type: 'sparkline',
    formatterParams: { type: 'line', fill: true } },
  { field: 'weekly', title: 'Týdny', type: 'sparkline',
    formatterParams: { type: 'bar', color: '#16a34a' } },
]
// data: { trend: [3, 5, 4, 8, 6, 9, 7], … }`,
        mount: (el, ctx) => sparklineExample(el, ctx),
      },
      {
        id: 'ex-pinned',
        title: 'Připnuté řádky (nahoře/dole)',
        blurb: 'Řádky připnuté nad/pod tabulku — vždy viditelné bez ohledu na scroll a stránku. Ideální pro souhrnný řádek nebo zvýrazněný záznam. Dodáš je jako pole objektů.',
        code: `new Lattice('#grid', {
  id: 'ex-pinned', columns, data, keyField: 'id',
  pinnedTop:    [{ name: '★ Prioritní kampaň', budget: 999000 }],
  pinnedBottom: [{ name: 'Σ Celkem', budget: totalBudget }],
})
// za běhu: grid.setPinnedRows({ top, bottom })`,
        mount: (el, ctx) => pinnedExample(el, ctx),
      },
      {
        id: 'ex-validation',
        title: 'Deklarativní validace',
        blurb: 'Pravidla validace přímo na sloupci (<code>validator</code>): povinné, rozsah, délka, regulární výraz nebo vlastní funkce. Neplatná editace se zamítne a buňka blikne červeně. Zkus vymazat Název nebo dát Skóre mimo 0–100.',
        code: `columns = [
  { field: 'name',   editable: true, validator: ['required', { minLen: 3 }] },
  { field: 'score',  editable: true, validator: { min: 0, max: 100 } },
  { field: 'email',  editable: true, validator: { pattern: /.+@.+\\..+/ } },
  { field: 'budget', editable: true, validator: (v) => v >= 0 || 'Nesmí být záporné' },
]
// onCellInvalid: ({ field, error }) => toast(error)`,
        mount: (el, ctx) => validationExample(el, ctx),
      },
      {
        id: 'ex-urlstate',
        title: 'Sdílitelný pohled (URL sync)',
        blurb: 'Řazení, filtry, hledání i stránka se promítají do <b>URL</b> — zkopíruj adresu a pošli kolegovi, uvidí přesně tentýž pohled. Zapíná se <code>urlState: true</code>. Zkus seřadit/filtrovat a koukni do adresního řádku.',
        code: `new Lattice('#grid', {
  id: 'ex-urlstate', columns, data,
  urlState: true,   // stav → ?ex-urlstate={…}; sdílitelný odkaz
})`,
        mount: (el, ctx) => new Lattice(el, base(ctx, {
          id: 'ex-urlstate', columns: campaignColumns(), data: ctx.data, pageSize: 15,
          quickSearch: true, urlState: true,
        })),
      },
    ],
  },
];

/** Zploštělý seznam všech příkladů (kvůli routování dle id). */
/**
 * Přeskupení do 4 kategorií, pojmenované česky. Definice
 * příkladů zůstávají výše; tady je jen roztřídíme podle id.
 */
const CATS = {
  'Novinky': ['ex-filter-empty', 'ex-tips', 'ex-highlight', 'ex-groups', 'ex-computed', 'ex-summary'],
  'Rozvržení': ['ex-datatypes', 'ex-format', 'ex-conditional', 'ex-themes', 'ex-frozen', 'ex-groups', 'ex-rotate', 'ex-rownumbers', 'ex-layout', 'ex-resize',
    'ex-sparkline', 'ex-responsive'],
  'Data': ['ex-client', 'ex-server', 'ex-sort', 'ex-search', 'ex-filter-header', 'ex-filter-empty', 'ex-filter-external', 'ex-filter-universal', 'ex-filter-advanced',
    'ex-pagination', 'ex-grouping', 'ex-date-group', 'ex-summary', 'ex-tree-nested', 'ex-tree-flat', 'ex-tree-nestedset',
    'ex-file', 'ex-web', 'ex-progressive', 'ex-virtual', 'ex-export', 'ex-computed'],
  'Interakce': ['ex-editing', 'ex-a11y', 'ex-callbacks', 'ex-select', 'ex-range', 'ex-popup', 'ex-menu', 'ex-history', 'ex-actions', 'ex-move-flat',
    'ex-move-groups', 'ex-move-children', 'ex-move-parentid', 'ex-move-nestedset', 'ex-between',
    'ex-pinned', 'ex-validation', 'ex-rowdetail', 'ex-bulk'],
  'Pokročilé': ['ex-presets', 'ex-reactive', 'ex-i18n', 'ex-urlstate'],
};
const BY_ID = Object.fromEntries(RAW_GROUPS.flatMap((g) => g.items).map((it) => [it.id, it]));

export const GROUPS = Object.entries(CATS).map(([category, ids]) => ({
  category,
  items: ids.map((id) => BY_ID[id]).filter(Boolean),
}));

export const ALL = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, category: g.category })));

/* ---------------- sdílený „event log" (co Lattice posílá aplikaci) ---------------- */

// Z řádku vytáhne jen id + name + pořadová/skupinová pole (to, co aplikace ukládá).
function slimRow(r, keyField, extra = []) {
  const o = { [keyField]: r[keyField] };
  if (r.name != null) o.name = r.name;
  for (const f of ['position', 'parentId', 'lft', 'rgt', ...extra]) if (f in r) o[f] = r[f];
  return o;
}

/**
 * Obalí Lattice instanci panelem, který vypisuje payloady callbacků
 * (onRowMove / onCellEdit / onSelectionChange) — aby bylo vidět, co knihovna
 * předává hostitelské aplikaci k perzistenci.
 */
function withEventLog(el, ctx, options, introHtml, cfg = {}) {
  const alertData = cfg.alertData !== false;
  if (introHtml) {
    const intro = document.createElement('div');
    intro.style.cssText = 'margin-bottom:10px;color:#6b7583;font-size:13px';
    intro.innerHTML = introHtml;
    el.appendChild(intro);
  }
  const gridEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:12px';
  panel.innerHTML =
    '<div style="font-size:12px;color:#6b7583;margin-bottom:4px">Co Lattice posílá aplikaci (poslední callback):</div>' +
    '<pre class="evlog" style="margin:0;padding:12px 14px;background:#1f2733;color:#e6edf3;border-radius:8px;overflow-x:auto;font-size:12px;line-height:1.5;min-height:40px">— zatím nic — proveď akci v tabulce (přetáhni řádek, uprav buňku, vyber řádky) —</pre>';
  el.append(gridEl, panel);
  const out = panel.querySelector('.evlog');
  // Diskrétní akce (move/edit) vyskočí v alertu + zapíšou do panelu; výběr jen panel.
  const show = (name, payload, alertIt) => {
    const text = 'grid.options.' + name + '(' + JSON.stringify(payload, null, 2) + ')';
    out.textContent = text;
    if (alertIt) window.alert('Lattice → aplikace:\n\n' + text);
  };

  const key = options.keyField || 'id';
  const merged = { ...options };
  const oMove = options.onRowMove, oEdit = options.onCellEdit, oSel = options.onSelectionChange, oData = options.onDataChange;
  merged.onDataChange = (action, rows) => {
    show('onDataChange', { action, rows: rows.map((r) => slimRow(r, key)) }, alertData);
    oData && oData(action, rows);
  };
  merged.onRowMove = (m) => {
    const extra = m.groupBy || []; // u přesunu mezi skupinami ukaž i skupinové pole
    const payload = { row: slimRow(m.row, key, extra), format: m.format, toParentId: m.toParentId, toIndex: m.toIndex, changed: m.changed.map((r) => slimRow(r, key, extra)) };
    if (m.groupChanged != null) payload.groupChanged = m.groupChanged;
    show('onRowMove', payload, true);
    oMove && oMove(m);
  };
  merged.onCellEdit = (e) => {
    show('onCellEdit', { field: e.field, [key]: e.row[key], oldValue: e.oldValue, newValue: e.newValue }, true);
    oEdit && oEdit(e);
  };
  merged.onSelectionChange = (rows, keys) => {
    show('onSelectionChange', { count: rows.length, keys }, false);
    oSel && oSel(rows, keys);
  };
  return new Lattice(gridEl, base(ctx, merged));
}

/**
 * Příklad „Callbacky a události" — rolující log všeho, co knihovna hlásí
 * aplikaci: interakce (onRowClick/onCellClick/onRowContext), změny stavu
 * (onSort/onFilter/onPageChange/onColumnLayoutChange) i validace (onCellValidate).
 */
function callbacksExample(el, ctx) {
  const gridEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:12px';
  panel.innerHTML =
    '<div style="font-size:12px;color:#6b7583;margin-bottom:4px">Události (nejnovější nahoře):</div>' +
    '<pre class="evlog" style="margin:0;padding:12px 14px;background:#1f2733;color:#e6edf3;border-radius:8px;overflow:auto;font-size:12px;line-height:1.5;max-height:240px;min-height:40px">— zatím nic — klikni, řaď, filtruj, přepni stránku, uprav buňku, přesuň sloupec —</pre>';
  el.append(gridEl, panel);
  const out = panel.querySelector('.evlog');
  const lines = [];
  const log = (name, payload) => {
    lines.unshift(name + (payload !== undefined ? '(' + JSON.stringify(payload) + ')' : ''));
    if (lines.length > 14) lines.pop();
    out.textContent = lines.join('\n');
  };

  return new Lattice(gridEl, base(ctx, {
    id: 'ex-callbacks', columns: withEditing(campaignColumns()), data: ctx.data, pageSize: 10, keyField: 'id',
    // interakce
    onRowClick: (row, index) => log('onRowClick', { id: row.id, index }),
    onCellClick: (c) => log('onCellClick', { field: c.field, id: c.row.id, value: c.value }),
    onRowContext: (row, index, e) => { e.preventDefault(); log('onRowContext', { id: row.id, index }); },
    // změny stavu
    onSort: (sort) => log('onSort', sort),
    onFilter: (f) => log('onFilter', f.filters),
    onPageChange: (p) => log('onPageChange', { page: p.page, pageSize: p.pageSize }),
    onColumnLayoutChange: (c) => log('onColumnLayoutChange', { kind: c.kind, detail: c.detail }),
    // validace + edit
    onCellValidate: ({ field, newValue }) => {
      if (field === 'name' && !String(newValue).trim()) { log('onCellValidate → ZAMÍTNUTO', { field, newValue }); return false; }
      return true;
    },
    onCellEdit: (e) => log('onCellEdit', { field: e.field, id: e.row.id, newValue: e.newValue }),
  }));
}

/* ---------------- příklad „Načtení souboru" ---------------- */

const SAMPLE_CSV = `id,name,category,price,in_stock,added
1,Mechanická klávesnice,Periferie,1890,true,2025-03-01
2,Herní myš,Periferie,990,true,2025-03-05
3,Monitor 27 palců,Zobrazovače,7490,false,2025-02-18
4,USB-C hub,Příslušenství,650,true,2025-04-02
5,Webkamera Full HD,Periferie,1290,true,2025-01-22
6,Sluchátka ANC,Audio,3490,false,2025-03-28
7,Dokovací stanice,Příslušenství,4200,true,2025-04-11
8,Podložka pod myš,Příslušenství,190,true,2025-02-09`;

const SAMPLE_JSON = JSON.stringify([
  { id: 1, employee: 'Alena Nováková', department: 'Vedení', salary: 95000, remote: false, hired: '2019-05-01' },
  { id: 2, employee: 'Petr Svoboda', department: 'Technologie', salary: 82000, remote: true, hired: '2020-09-15' },
  { id: 3, employee: 'Jana Kučerová', department: 'Finance', salary: 78000, remote: false, hired: '2021-01-11' },
  { id: 4, employee: 'Marek Dvořák', department: 'Marketing', salary: 71000, remote: true, hired: '2022-03-07' },
  { id: 5, employee: 'Lucie Horáková', department: 'Technologie', salary: 68000, remote: true, hired: '2022-11-20' },
], null, 2);

function fileLoadExample(el, ctx) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<input type="file" accept=".csv,.json,text/csv,application/json" />' +
    '<button data-s="csv" type="button">Zkusit ukázkové CSV</button>' +
    '<button data-s="json" type="button">Zkusit ukázkové JSON</button>' +
    '<span class="status" style="color:#6b7583;font-size:13px"></span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';

  const gridEl = document.createElement('div');
  el.append(bar, gridEl);

  const grid = new Lattice(gridEl, base(ctx, { id: 'ex-file', autoColumns: true, pageSize: 25 }));
  const status = bar.querySelector('.status');
  const done = (n, fmt) => { status.textContent = `Načteno ${n} řádků, ${n ? 'sloupce odvozeny automaticky' : 'žádná data'} (${fmt}).`; };

  bar.querySelector('input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const r = await grid.importFile(file); done(r.count, r.format.toUpperCase()); }
    catch (err) { status.textContent = 'Chyba načtení: ' + err.message; }
  });
  // Ukázky projdou stejnou parsovací cestou jako reálný soubor (přes File).
  bar.querySelector('[data-s="csv"]').addEventListener('click', async () => {
    const r = await grid.importFile(new File([SAMPLE_CSV], 'produkty.csv', { type: 'text/csv' }));
    done(r.count, 'CSV');
  });
  bar.querySelector('[data-s="json"]').addEventListener('click', async () => {
    const r = await grid.importFile(new File([SAMPLE_JSON], 'zamestnanci.json', { type: 'application/json' }));
    done(r.count, 'JSON');
  });

  return grid;
}

/* ---------------- příklad „Import z URL" (HTML tabulka / XML feed) ---------------- */

// Relativní cesta → pod dev Node serverem i na (PHP) hostingu se přeloží na
// /demo/api/fetch.php. V reálné aplikaci by to byl její vlastní backend endpoint.
const PROXY = (u) => 'api/fetch.php?url=' + encodeURIComponent(u);

function webImportExample(el, ctx) {
  const sampleUrl = location.origin + '/demo/sample-tables.html';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<input class="url" type="text" style="flex:1 1 340px;min-width:240px;padding:6px 10px;border:1px solid #cfd5dd;border-radius:6px;font-size:13px" />' +
    '<label style="font-size:13px;color:#6b7583">tabulka #<input class="idx" type="number" value="0" min="0" style="width:52px;padding:6px;border:1px solid #cfd5dd;border-radius:6px" /></label>' +
    '<button data-a="url" type="button">Načíst z URL</button>' +
    '<button data-a="krajE" type="button">Kraje ČR (HTML #0)</button>' +
    '<button data-a="meny" type="button">Měny (HTML #1)</button>' +
    '<button data-a="cuzk" type="button">ČÚZK ATOM feed (XML)</button>' +
    '<span class="status" style="width:100%;color:#6b7583;font-size:13px"></span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  bar.querySelector('.url').value = sampleUrl;

  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  const grid = new Lattice(gridEl, base(ctx, { id: 'ex-web', autoColumns: true, pageSize: 25 }));
  const status = bar.querySelector('.status');

  async function load(url, index) {
    status.textContent = 'Načítám ' + url + ' …';
    try {
      // Stejný origin CORS neřeší → přímý fetch; cizí origin přes backend proxy.
      const sameOrigin = url.startsWith('/') || url.startsWith(location.origin + '/');
      const r = await grid.importFromUrl(url, index, sameOrigin ? {} : { proxy: PROXY });
      status.textContent = `Načteno ${r.count} řádků z ${r.format.toUpperCase()} (${url}).`;
    } catch (err) { status.textContent = 'Chyba: ' + err.message; }
  }

  bar.querySelector('[data-a="url"]').addEventListener('click', () =>
    load(bar.querySelector('.url').value.trim(), Number(bar.querySelector('.idx').value) || 0));
  bar.querySelector('[data-a="krajE"]').addEventListener('click', () => { bar.querySelector('.idx').value = 0; load(sampleUrl, 0); });
  bar.querySelector('[data-a="meny"]').addEventListener('click', () => { bar.querySelector('.idx').value = 1; load(sampleUrl, 1); });
  bar.querySelector('[data-a="cuzk"]').addEventListener('click', () =>
    load('https://atom.cuzk.gov.cz/get.ashx?theme=RUIAN-CSV-ADR-OB', 0));

  return grid;
}

/* ---------------- příklad „Řazení přes všechny typy" (server-side) ---------------- */

function sortExample(el, ctx) {
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-bottom:12px;padding:8px 12px;background:#eef2f7;border-radius:8px;color:#334;font-size:13px';
  panel.textContent = 'Klikni na hlavičku libovolného sloupce…';
  const gridEl = document.createElement('div');
  el.append(panel, gridEl);
  const grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-sort', columns: campaignColumns(), serverSide: true, ajaxUrl: '/api/campaigns', pageSize: 25,
    onDataLoad: ({ total, rows, sort }) => {
      const s = sort && sort.length ? `${sort[0].field} ${sort[0].dir === 'desc' ? '↓ sestupně' : '↑ vzestupně'}` : '(neseřazeno)';
      panel.innerHTML = `<b>Řazení:</b> ${s} &nbsp;·&nbsp; server seřadil <b>${total}</b> záznamů a vrátil jen <b>${rows.length}</b> řádků (aktuální stránka) — ne celý seřazený dataset.`;
    },
  }));
  return grid;
}

/* ---------------- příklad „Sloupec akcí" ---------------- */

function actionsExample(el, ctx) {
  const rows = ctx.data.slice(0, 15).map((r) => ({ ...r }));
  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:12px;color:#6b7583;font-size:13px';
  bar.innerHTML = 'Přepni zobrazení akcí v <b>Nastavení tabulky</b> (ozubené kolo) → „Sloupec akcí". <span class="status"></span>';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  const status = bar.querySelector('.status');

  let grid;
  const actions = [
    { name: 'view', onClick: (row) => { status.textContent = `Zobrazit #${row.id} — ${row.name}`; } },
    { name: 'edit', onClick: (row) => { status.textContent = `Upravit #${row.id} — ${row.name}`; }, disabled: (row) => row.status === 'Běží' },
    { name: 'delete', onClick: (row) => { grid.deleteRow(row.id); status.textContent = `Smazáno #${row.id}`; }, visible: (row) => row.status !== 'Dokončeno', danger: true },
  ];
  grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-actions', columns: coreColumns(), data: rows, keyField: 'id', pageSize: 25,
    instance: { rowNumbers: 'continuous' },
    actions,
  }));
  return grid;
}

/* ---------------- příklad „Přeuspořádání řádků (position)" ---------------- */

function moveFlatExample(el, ctx) {
  const rows = ctx.data.slice(0, 10).map((r, i) => ({ id: r.id, position: i + 1, name: r.name, category: r.category, owner: r.owner, budget: r.budget }));
  const cols = [
    { field: 'position', title: '#', type: 'number', width: 60, align: 'right' },
    { field: 'name', title: 'Název', type: 'text', width: 220 },
    { field: 'category', title: 'Kategorie', type: 'text', width: 150 },
    { field: 'owner', title: 'Vlastník', type: 'text', width: 140 },
    { field: 'budget', title: 'Rozpočet', type: 'money', width: 150, formatterParams: { currency: 'CZK' } },
  ];
  return withEventLog(el, ctx, {
    id: 'ex-move-flat', columns: cols, data: rows, keyField: 'id',
    movableRows: true, orderField: 'position', pageSize: 25,
  }, 'Přetáhni řádek za úchyt ⠿ nad/pod jiný — position se přečísluje 1..n a v alertu uvidíš, co Lattice pošle aplikaci k uložení.');
}

/* ---------------- příklad „Přesun mezi skupinami" ---------------- */

function groupMoveExample(el, ctx) {
  const rows = ctx.data.slice(0, 30).map((r) => ({ id: r.id, name: r.name, category: r.category, owner: r.owner, region: r.region, budget: r.budget }));
  const cols = [
    { field: 'name', title: 'Název', type: 'text', width: 210 },
    { field: 'category', title: 'Kategorie', type: 'text', width: 150 },
    { field: 'owner', title: 'Vlastník', type: 'text', width: 140 },
    { field: 'region', title: 'Region', type: 'text', width: 120 },
    { field: 'budget', title: 'Rozpočet', type: 'money', width: 150, formatterParams: { currency: 'CZK' } },
  ];
  return withEventLog(el, ctx, {
    id: 'ex-move-groups', columns: cols, data: rows, keyField: 'id', pageSize: 100,
    instance: { groupBy: ['region'] },
    movableRows: true,
  }, 'Přetáhni řádek za úchyt ⠿ do jiné skupiny (na hlavičku nebo mezi řádky) — změní se hodnota Regionu a v alertu uvidíš payload.');
}

/* ---------------- příklad „Výběr + hromadné úpravy" ---------------- */

function selectExample(el, ctx) {
  const rows = ctx.data.slice(0, 40).map((r) => ({ ...r }));

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<strong class="cnt" style="font-size:13px">0 vybráno</strong>' +
    '<button data-a="done" type="button" disabled>Nastavit stav → Dokončeno</button>' +
    '<button data-a="paused" type="button" disabled>Nastavit stav → Pozastaveno</button>' +
    '<button data-a="del" type="button" disabled>Smazat vybrané</button>' +
    '<button data-a="clear" type="button" disabled>Zrušit výběr</button>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  el.appendChild(bar);

  const cnt = bar.querySelector('.cnt');
  const btns = [...bar.querySelectorAll('button')];
  // withEventLog přidá panel + alerty: hromadné updateData/deleteRows spustí onDataChange.
  const grid = withEventLog(el, ctx, {
    id: 'ex-select', columns: coreColumns(), data: rows, keyField: 'id', selectable: true, pageSize: 10,
    onSelectionChange: (selRows) => {
      cnt.textContent = selRows.length + ' vybráno';
      for (const b of btns) b.disabled = selRows.length === 0;
    },
  });

  const setStatus = (status) => grid.updateData(grid.getSelectedKeys().map((id) => ({ id, status })));
  bar.querySelector('[data-a="done"]').addEventListener('click', () => setStatus('Dokončeno'));
  bar.querySelector('[data-a="paused"]').addEventListener('click', () => setStatus('Pozastaveno'));
  bar.querySelector('[data-a="del"]').addEventListener('click', () => { grid.deleteRows(grid.getSelectedKeys()); grid.clearSelection(); });
  bar.querySelector('[data-a="clear"]').addEventListener('click', () => grid.clearSelection());

  return grid;
}

/* ---------------- příklad „Progresivní načítání" ---------------- */

function progressiveExample(el, ctx) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<span style="font-size:13px;color:#6b7583">Režim:</span>' +
    '<button data-m="scroll" type="button">Nekonečný scroll</button>' +
    '<button data-m="load" type="button">Tlačítko „Načíst další"</button>' +
    '<span style="font-size:13px;color:#6b7583">Zkus seřadit/filtrovat — resetuje se na 1. stránku.</span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  const gridEl = document.createElement('div');
  gridEl.style.setProperty('--lattice-max-height', '48vh');
  el.append(bar, gridEl);

  const grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-progressive', columns: campaignColumns(), serverSide: true, ajaxUrl: '/api/campaigns',
    pageSize: 20, progressiveLoad: 'scroll',
  }));
  const setMode = (m) => {
    grid.progressive = m;
    grid.renderer.renderFooter();
    for (const b of bar.querySelectorAll('button')) b.style.background = b.dataset.m === m ? '#dbeafe' : '#fff';
  };
  bar.querySelector('[data-m="scroll"]').addEventListener('click', () => setMode('scroll'));
  bar.querySelector('[data-m="load"]').addEventListener('click', () => setMode('load'));
  setMode('scroll');
  return grid;
}

/* ---------------- příklad „Export / stažení" ---------------- */

function exportExample(el, ctx) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<button data-f="csv" type="button">CSV (,)</button>' +
    '<button data-f="csv;" type="button">CSV (;)</button>' +
    '<button data-f="tsv" type="button">TSV (tab)</button>' +
    '<button data-f="json" type="button">JSON</button>' +
    '<button data-f="xml" type="button">XML</button>' +
    '<button data-f="excel" type="button">Excel (.xls)</button>' +
    '<button data-f="print" type="button">🖨 Tisk</button>' +
    '<span class="status" style="color:#6b7583;font-size:13px"></span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  const gridEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:12px';
  panel.innerHTML = '<div style="font-size:12px;color:#6b7583;margin-bottom:4px">Náhled exportu (prvních pár řádků):</div>' +
    '<pre class="prev" style="margin:0;padding:12px 14px;background:#1f2733;color:#e6edf3;border-radius:8px;overflow:auto;max-height:220px;font-size:12px">— klikni na formát —</pre>';
  el.append(bar, gridEl, panel);

  const grid = new Lattice(gridEl, base(ctx, { id: 'ex-export', columns: coreColumns(), data: ctx.data, pageSize: 25 }));
  const prev = panel.querySelector('.prev');
  const status = bar.querySelector('.status');
  const doExport = (fmt, opts) => {
    const content = grid.download(fmt, opts); // stáhne soubor + vrátí obsah
    prev.textContent = content.split('\n').slice(0, 8).join('\n') + (content.split('\n').length > 8 ? '\n…' : '');
    status.textContent = `Staženo (${grid.exportRows().length} řádků).`;
  };
  bar.querySelector('[data-f="csv"]').addEventListener('click', () => doExport('csv'));
  bar.querySelector('[data-f="csv;"]').addEventListener('click', () => doExport('csv', { delimiter: ';' }));
  bar.querySelector('[data-f="tsv"]').addEventListener('click', () => doExport('tsv'));
  bar.querySelector('[data-f="json"]').addEventListener('click', () => doExport('json'));
  bar.querySelector('[data-f="xml"]').addEventListener('click', () => doExport('xml'));
  bar.querySelector('[data-f="excel"]').addEventListener('click', () => doExport('excel'));
  bar.querySelector('[data-f="print"]').addEventListener('click', () => { grid.print({ title: 'Kampaně' }); status.textContent = 'Otevřen tisk (' + grid.exportRows().length + ' řádků).'; });
  return grid;
}

/* ---------------- příklad „Responsivní skládání" ---------------- */

/* ---------------- Novinky: sparkline / pinned / validace ---------------- */

function sparklineExample(el, ctx) {
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const data = ctx.data.slice(0, 30).map((r) => ({
    ...r,
    trend: Array.from({ length: 8 }, () => Math.round(rnd() * 100)),
    weekly: Array.from({ length: 6 }, () => Math.round(rnd() * 50)),
  }));
  return new Lattice(el, base(ctx, {
    id: 'ex-sparkline', keyField: 'id', pageSize: 10, data,
    columns: [
      { field: 'id', title: 'ID', type: 'id', width: 70 },
      { field: 'name', title: 'Kampaň', type: 'text', width: 190 },
      { field: 'trend', title: 'Trend (skóre)', type: 'sparkline', width: 140, formatterParams: { type: 'line', fill: true } },
      { field: 'weekly', title: 'Týdny', type: 'sparkline', width: 120, formatterParams: { type: 'bar', color: '#16a34a' } },
      { field: 'budget', title: 'Rozpočet', type: 'money', width: 140, formatterParams: { currency: 'CZK' } },
    ],
  }));
}

function pinnedExample(el, ctx) {
  const data = ctx.data.slice(0, 60);
  const total = data.reduce((a, r) => a + (r.budget || 0), 0);
  const avg = Math.round(data.reduce((a, r) => a + (r.score || 0), 0) / (data.length || 1));
  return new Lattice(el, base(ctx, {
    id: 'ex-pinned', keyField: 'id', pageSize: 12, data,
    columns: coreColumns(),
    pinnedTop: [{ id: 'top', name: '★ Prioritní: Jarní výprodej', category: 'PPC', owner: 'Nováková', region: 'Praha', budget: 999000, score: 100, status: 'Běží' }],
    pinnedBottom: [{ id: 'sum', name: 'Σ Celkem / ø skóre', budget: total, score: avg, status: '' }],
  }));
}

function validationExample(el, ctx) {
  return new Lattice(el, base(ctx, {
    id: 'ex-validation', keyField: 'id', pageSize: 10, data: ctx.data.slice(0, 40),
    columns: [
      { field: 'id', title: 'ID', type: 'id', width: 70 },
      { field: 'name', title: 'Název (povinné, ≥3)', type: 'text', width: 210, editable: true, validator: ['required', { minLen: 3 }] },
      { field: 'score', title: 'Skóre (0–100)', type: 'number', width: 140, editable: true, validator: { min: 0, max: 100 } },
      { field: 'budget', title: 'Rozpočet (≥0)', type: 'money', width: 160, editable: true, formatterParams: { currency: 'CZK' }, validator: (v) => Number(v) >= 0 || 'Nesmí být záporné' },
    ],
    onCellInvalid: ({ field, error }) => console.log('[invalid]', field, '→', error),
  }));
}

function responsiveExample(el, ctx) {
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:13px;color:#6b7583;margin-bottom:10px';
  hint.textContent = 'Táhni za pravý okraj rámečku a zúži ho — sloupce se začnou skládat do detailu (šipka vlevo).';
  const box = document.createElement('div');
  box.style.cssText = 'resize:horizontal;overflow:auto;border:1px dashed #cfd5dd;border-radius:8px;padding:8px;min-width:340px;max-width:100%;width:100%';
  const gridEl = document.createElement('div');
  box.appendChild(gridEl);
  el.append(hint, box);
  return new Lattice(gridEl, base(ctx, {
    id: 'ex-responsive', keyField: 'id', pageSize: 12, data: ctx.data, responsive: true,
    columns: [
      { field: 'id', title: 'ID', type: 'id', width: 70, responsive: false },
      { field: 'name', title: 'Název', type: 'text', width: 190, filter: 'text', responsive: false },
      { field: 'category', title: 'Kategorie', type: 'text', width: 140 },
      { field: 'owner', title: 'Vlastník', type: 'text', width: 130 },
      { field: 'region', title: 'Region', type: 'text', width: 120 },
      { field: 'budget', title: 'Rozpočet', type: 'money', width: 140, formatterParams: { currency: 'CZK' } },
      { field: 'score', title: 'Skóre', type: 'number', width: 90, responsive: 5 },
      { field: 'status', title: 'Stav', type: 'text', width: 130, responsive: 8 },
    ],
  }));
}

/* ---------------- příklad „Režimy layoutu" ---------------- */

const LAYOUT_MODES = [
  { v: 'fitData', label: 'Dle obsahu (fitData)', desc: 'Sloupce mají šířku podle obsahu. Když se nevejdou, tabulka se horizontálně scrolluje; když naopak zbyde místo, tabulka ho NEVYPLNÍ — vpravo zůstane prázdno.' },
  { v: 'fitDataFill', label: 'Dle obsahu + vyplnit (fitDataFill)', desc: 'Šířky podle obsahu, ale tabulka se roztáhne na celou šířku — řádky (pozadí) vyplní prostor, za posledním sloupcem zůstane prázdné místo v rámci řádku.' },
  { v: 'fitDataStretch', label: 'Poslední roztáhnout (fitDataStretch)', desc: 'Šířky podle obsahu, ale POSLEDNÍ sloupec se roztáhne a pohltí veškerou zbývající šířku — žádné prázdné místo.' },
  { v: 'fitColumns', label: 'Do šířky proporčně (fitColumns)', desc: 'VŠECHNY sloupce se proporčně roztáhnou tak, aby přesně vyplnily šířku tabulky (poměry zůstanou zachované).' },
];

const THEMES = [
  { v: 'default', label: 'Výchozí' },
  { v: 'auto', label: 'Automaticky' },
  { v: 'minimal', label: 'Minimalistický' },
  { v: 'compact', label: 'Kompaktní' },
  { v: 'slate', label: 'Tmavý' },
  { v: 'ocean', label: 'Oceán' },
  { v: 'warm', label: 'Teplý' },
  { v: 'contrast', label: 'Vysoký kontrast' },
  { v: 'bootstrap5', label: 'Bootstrap 5' },
  { v: 'tailwind', label: 'Tailwind' },
  { v: 'material', label: 'Material' },
];

/** Velký dataset (deterministicky) pro virtuální scrollování. */
function bigData(n) {
  const cats = ['Event', 'Bannery', 'PPC', 'Email', 'Newsletter', 'Sociální sítě'];
  const owners = ['Procházková', 'Novák', 'Dvořák', 'Kučera', 'Veselá', 'Svoboda'];
  const regions = ['Brno', 'Praha', 'Ostrava', 'Plzeň', 'Online'];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i + 1,
      name: 'Kampaň #' + (i + 1),
      category: cats[i % cats.length],
      owner: owners[(i * 7) % owners.length],
      region: regions[(i * 3) % regions.length],
      score: (i * 37) % 101,
      budget: 20000 + ((i * 6301) % 480000),
    };
  }
  return out;
}

/** Finanční pohyby (deterministicky) — kladné i záporné částky, kurzy, datumy. */
function financeData() {
  const labels = ['Faktura 2026-001', 'Dobropis 2026-002', 'Platba dodavatel', 'Vratka DPH',
    'Mzdy 12/2025', 'Úrok z vkladu', 'Poplatek banka', 'Prodej licence', 'Storno objednávky',
    'Nájem kanceláře', 'Refundace', 'Provize partner', 'Pokuta z prodlení', 'Dotace', 'Cashback'];
  return labels.map((label, i) => {
    const sign = (i % 3 === 1 || i % 4 === 2) ? -1 : 1;   // část záporných
    const amount = sign * (12000 + ((i * 6301) % 240000));
    return {
      id: i + 1, label,
      amount,
      balance: 500000 + amount - ((i * 4099) % 300000) * (i % 2 ? 1 : -1),
      rate: 24.5 + ((i * 37) % 400) / 100,
      qty: 1 + ((i * 7) % 40),
      date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      updatedAt: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00`,
    };
  });
}

/** Kvartální tržby (deterministicky) — vhodné pro souhrn sloupců i řádků. */
function quarterlySales() {
  const names = ['Klávesnice', 'Myš', 'Monitor 27"', 'Notebook Pro', 'Dokovací stanice',
    'Sluchátka ANC', 'Webkamera 4K', 'Tiskárna', 'Wi-Fi router', 'SSD disk 2 TB',
    'Grafická karta', 'Reproduktory', 'Mikrofon', 'Podložka XL'];
  return names.map((product, i) => {
    const base = 42000 + ((i * 7919) % 88000);
    return {
      id: i + 1, product,
      q1: base,
      q2: Math.round(base * (1 + ((i * 13) % 22) / 100)),
      q3: Math.round(base * (1 + ((i * 17) % 38) / 100)),
      q4: Math.round(base * (1 + ((i * 11) % 55) / 100)),
    };
  });
}

function themesExample(el, ctx) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px';
  bar.innerHTML = THEMES.map((m) => `<button data-v="${m.v}" type="button">${m.label}</button>`).join('');
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);

  const grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-themes', columns: campaignColumns(), data: ctx.data, pageSize: 10, keyField: 'id',
    selectable: true, instance: { summaryRow: 'page' },
  }));
  const setTheme = (v) => {
    grid.setInstance({ theme: v });
    for (const b of bar.querySelectorAll('button')) b.style.background = b.dataset.v === v ? '#dbeafe' : '#fff';
  };
  for (const m of THEMES) bar.querySelector(`[data-v="${m.v}"]`).addEventListener('click', () => setTheme(m.v));
  setTheme(grid.instance.theme || 'default');
  return grid;
}

function layoutExample(el, ctx) {
  const rows = ctx.data.slice(0, 12).map((r) => ({ id: r.id, name: r.name, category: r.category, owner: r.owner }));
  const cols = [
    { field: 'id', title: 'ID', type: 'number', width: 70, align: 'right' },
    { field: 'name', title: 'Název', type: 'text', width: 180 },
    { field: 'category', title: 'Kategorie', type: 'text', width: 140 },
    { field: 'owner', title: 'Vlastník', type: 'text', width: 130 },
  ];
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px';
  bar.innerHTML = LAYOUT_MODES.map((m) => `<button data-v="${m.v}" type="button">${m.label}</button>`).join('');
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  const desc = document.createElement('div');
  desc.style.cssText = 'margin-bottom:12px;padding:10px 12px;background:#eef2f7;border-radius:8px;color:#334;font-size:13px;line-height:1.5';
  const gridEl = document.createElement('div');
  el.append(bar, desc, gridEl);

  const grid = new Lattice(gridEl, base(ctx, { id: 'ex-layout', columns: cols, data: rows, keyField: 'id', pageSize: 25, instance: { layout: 'fitData' } }));
  const setMode = (v) => {
    grid.setInstance({ layout: v });
    const m = LAYOUT_MODES.find((x) => x.v === v);
    desc.innerHTML = '<b>' + m.label + ':</b> ' + m.desc;
    for (const b of bar.querySelectorAll('button')) b.style.background = b.dataset.v === v ? '#dbeafe' : '#fff';
  };
  for (const m of LAYOUT_MODES) bar.querySelector(`[data-v="${m.v}"]`).addEventListener('click', () => setMode(m.v));
  setMode('fitData');
  return grid;
}

/* ---------------- příklad „Historie (zpět / znovu)" ---------------- */

function historyExample(el, ctx) {
  const rows = ctx.data.slice(0, 15).map((r) => ({ id: r.id, name: r.name, category: r.category, owner: r.owner, budget: r.budget, status: r.status }));
  const cols = [
    { field: 'id', title: 'ID', type: 'number', width: 70, align: 'right' },
    { field: 'name', title: 'Název', type: 'text', width: 210, editable: true },
    { field: 'category', title: 'Kategorie', type: 'text', width: 140, editable: true },
    { field: 'owner', title: 'Vlastník', type: 'text', width: 140, editable: true },
    { field: 'budget', title: 'Rozpočet', type: 'money', width: 150, editable: true, formatterParams: { currency: 'CZK' } },
    { field: 'status', title: 'Stav', type: 'text', width: 130, editable: true },
  ];
  let grid, nextId = 9000;
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<button data-a="add" type="button">+ Přidat řádek</button>' +
    '<button data-a="del" type="button">− Smazat první</button>' +
    '<span style="font-size:13px;color:#6b7583">Dvojklik = editace. Zpět/Znovu jsou tlačítka v toolbaru vlevo (nebo Ctrl/⌘+Z, Ctrl+Y).</span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-history', columns: cols, data: rows, keyField: 'id', pageSize: 25, history: true, historySize: 30,
  }));
  bar.querySelector('[data-a="add"]').addEventListener('click', () => { const id = nextId++; grid.addRow({ id, name: 'Nová #' + id, category: 'Event', owner: 'Nováková', budget: 100000, status: 'Plánováno' }, true); });
  bar.querySelector('[data-a="del"]').addEventListener('click', () => { const first = grid.dataSource.data[0]; if (first) grid.deleteRow(first.id); });
  return grid;
}

/* ---------------- příklad „Menu hlavičky + kontextové menu" ---------------- */

function menuExample(el, ctx) {
  const rows = ctx.data.slice(0, 25).map((r) => ({ ...r }));
  let grid, nextId = 10000;
  const cols = coreColumns().map((c) => ({ ...c, headerMenu: true, editable: c.field !== 'id' }));
  cols.find((c) => c.field === 'id').type = 'id'; // typ 'id' → needit., spouští menu řádku
  // Vlastní položka v menu hlavičky sloupce Stav.
  cols.find((c) => c.field === 'status').headerMenu = (col) => [
    { label: 'Vypsat hodnoty sloupce', action: () => { status.textContent = 'Hodnoty „' + col.title + '": ' + [...new Set(grid.dataSource.data.map((r) => r[col.field]))].join(', '); } },
  ];

  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:10px;color:#6b7583;font-size:13px';
  bar.innerHTML = '<b>Pravý klik:</b> na hlavičku (⋮) = menu sloupce · na # nebo ID = menu řádku (Duplikovat/Smazat) · na běžnou buňku = menu buňky (Editovat zde / Kopírovat). <span class="status"></span>';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  const status = bar.querySelector('.status');

  grid = new Lattice(gridEl, base(ctx, {
    id: 'ex-menu', columns: cols, data: rows, keyField: 'id', pageSize: 25,
    instance: { rowNumbers: 'continuous' },
    // Menu ŘÁDKU — pravý klik na # nebo ID sloupec.
    rowContextMenu: (row) => [
      { label: 'Zobrazit detail', action: (r) => { status.textContent = 'Detail #' + r.id + ' — ' + r.name; } },
      { separator: true },
      { label: 'Duplikovat řádek', action: (r) => { grid.addRow({ ...r, id: nextId++, name: r.name + ' (kopie)' }, false); status.textContent = 'Duplikováno #' + r.id; } },
      { label: 'Smazat řádek', danger: true, disabled: row.status === 'Běží', action: (r) => { grid.deleteRow(r.id); status.textContent = 'Smazáno #' + r.id; } },
    ],
    // Menu BUŇKY — pravý klik na běžnou buňku (jiné než menu řádku).
    cellContextMenu: ({ value, field, index, col }) => [
      { label: 'Editovat zde', disabled: col.editable !== true, action: (c) => grid.editCell(c.index, c.field) },
      { label: 'Kopírovat hodnotu', action: (c) => { navigator.clipboard && navigator.clipboard.writeText(String(c.value ?? '')); status.textContent = 'Zkopírováno: ' + c.value; } },
    ],
  }));
  return grid;
}

/* ---------------- příklad „Popup na buňce i hlavičce" ---------------- */

const POPUP_STATUSES = ['Plánováno', 'Běží', 'Pozastaveno', 'Dokončeno'];

function popupExample(el, ctx) {
  const rows = ctx.data.slice(0, 20).map((r) => ({ ...r }));
  let grid;
  const money = (n) => Math.round(n).toLocaleString('cs') + ' Kč';

  const cols = [
    { field: 'id', title: 'ID', type: 'number', width: 70, align: 'right' },
    { field: 'name', title: 'Název', type: 'text', width: 200 },
    {
      field: 'owner', title: 'Vlastník', type: 'text', width: 140,
      cellPopup: ({ row }) => {
        const mine = grid.dataSource.data.filter((r) => r.owner === row.owner);
        const total = mine.reduce((s, r) => s + (r.budget || 0), 0);
        return `<div style="font-weight:600;margin-bottom:6px">${row.owner}</div>` +
          `<div style="color:#6b7583">Kampaní: <b>${mine.length}</b></div>` +
          `<div style="color:#6b7583">Rozpočet celkem: <b>${money(total)}</b></div>`;
      },
    },
    { field: 'region', title: 'Region', type: 'text', width: 120 },
    {
      field: 'budget', title: 'Rozpočet', type: 'money', width: 150, formatterParams: { currency: 'CZK' },
      headerPopup: ({ grid: g }) => {
        const vals = g.dataSource.data.map((r) => r.budget || 0);
        const min = Math.min(...vals), max = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return `<div style="font-weight:600;margin-bottom:6px">Rozpočet — statistika</div>` +
          `<div style="color:#6b7583">min: <b>${money(min)}</b></div>` +
          `<div style="color:#6b7583">max: <b>${money(max)}</b></div>` +
          `<div style="color:#6b7583">průměr: <b>${money(avg)}</b></div>`;
      },
    },
    {
      field: 'status', title: 'Stav', type: 'text', width: 150,
      cellPopup: ({ row, close }) => {
        const box = document.createElement('div');
        box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Změnit stav</div>';
        for (const s of POPUP_STATUSES) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = s;
          b.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 8px;margin:2px 0;border:1px solid #cfd5dd;border-radius:6px;cursor:pointer;background:' + (row.status === s ? '#dbeafe' : '#fff');
          b.addEventListener('click', () => { grid.updateRow(row.id, { status: s }); close(); });
          box.appendChild(b);
        }
        return box;
      },
    },
  ];

  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:10px;color:#6b7583;font-size:13px';
  bar.innerHTML = 'Klikni na <b>Vlastník</b> (info) · <b>Stav</b> (změna) · <b>ⓘ u Rozpočtu</b> (statistika).';
  const gridEl = document.createElement('div');
  el.append(bar, gridEl);
  grid = new Lattice(gridEl, base(ctx, { id: 'ex-popup', columns: cols, data: rows, keyField: 'id', pageSize: 25 }));
  return grid;
}

/* ---------------- příklad „Přesun mezi tabulkami (+ koš)" ---------------- */

function betweenTablesExample(el, ctx) {
  const cols = () => [
    { field: 'name', title: 'Kampaň', type: 'text', width: 200 },
    { field: 'category', title: 'Kategorie', type: 'text', width: 130 },
    { field: 'budget', title: 'Rozpočet', type: 'money', width: 140, formatterParams: { currency: 'CZK' } },
  ];
  const left = ctx.data.slice(0, 12).map((r) => ({ id: r.id, name: r.name, category: r.category, budget: r.budget }));

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start';
  const mk = (title) => {
    const box = document.createElement('div');
    box.style.cssText = 'flex:1 1 380px;min-width:320px';
    const h = document.createElement('div'); h.style.cssText = 'font-weight:600;margin-bottom:6px;font-size:14px'; h.textContent = title;
    const g = document.createElement('div'); g.style.setProperty('--lattice-max-height', '46vh');
    box.append(h, g); return { box, g };
  };
  const A = mk('Dostupné kampaně'); const B = mk('Vybrané pro newsletter');
  const trash = document.createElement('div');
  trash.style.cssText = 'flex:0 0 120px;min-height:120px;display:flex;align-items:center;justify-content:center;border:2px dashed #cfd5dd;border-radius:10px;font-size:34px;color:#94a0af;align-self:stretch';
  trash.textContent = '🗑';
  wrap.append(A.box, B.box, trash);
  const status = document.createElement('div');
  status.style.cssText = 'margin-top:10px;color:#6b7583;font-size:13px';
  status.textContent = 'Přetáhni řádek ⠿ mezi tabulkami, nebo na koš 🗑.';
  el.append(wrap, status);

  const grids = {};
  const notify = (msg) => { status.textContent = msg; window.alert('Lattice → aplikace:\n\n' + msg); };
  grids.a = new Lattice(A.g, base(ctx, {
    id: 'xt-a', columns: cols(), data: left, keyField: 'id', movableRows: true, acceptExternalRows: true,
    onRowReceive: (row, info) => notify(`onRowReceive: „${row.name}" ← z „${info.fromId}" (režim ${info.mode}) do „Dostupné".`),
  }));
  grids.b = new Lattice(B.g, base(ctx, {
    id: 'xt-b', columns: cols(), data: [], keyField: 'id', movableRows: true, acceptExternalRows: true,
    onRowReceive: (row, info) => notify(`onRowReceive: „${row.name}" ← z „${info.fromId}" (režim ${info.mode}) do „Vybrané".`),
  }));

  // Koš — libovolný prvek přijme řádek přes stejný payload (between-elements).
  trash.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('application/x-lattice-row')) { e.preventDefault(); trash.style.borderColor = '#dc2626'; trash.style.color = '#dc2626'; } });
  trash.addEventListener('dragleave', () => { trash.style.borderColor = '#cfd5dd'; trash.style.color = '#94a0af'; });
  trash.addEventListener('drop', (e) => {
    e.preventDefault(); trash.style.borderColor = '#cfd5dd'; trash.style.color = '#94a0af';
    const raw = e.dataTransfer.getData('application/x-lattice-row'); if (!raw) return;
    const p = JSON.parse(raw);
    const src = p.src === 'xt-a' ? grids.a : grids.b;
    src.deleteRow(p.key);
    notify(`Smazáno „${p.row.name}" (drop na koš, z „${p.src}").`);
  });

  const orig = grids.a.destroy.bind(grids.a);
  grids.a.destroy = () => { orig(); try { grids.b.destroy(); } catch { /* no-op */ } };
  return grids.a;
}

/* ---------------- příklad „Výběr rozsahu + schránka" ---------------- */

function rangeExample(el, ctx) {
  const rows = ctx.data.slice(0, 20).map((r) => ({ id: r.id, name: r.name, budget: r.budget, score: r.score, progress: r.progress, rating: r.rating }));
  const cols = [
    { field: 'id', title: 'ID', type: 'number', width: 70, align: 'right' },
    { field: 'name', title: 'Název', type: 'text', width: 210, editable: true },
    { field: 'budget', title: 'Rozpočet', type: 'money', width: 150, editable: true, formatterParams: { currency: 'CZK' } },
    { field: 'score', title: 'Skóre', type: 'number', width: 110, editable: true },
    { field: 'progress', title: 'Průběh', type: 'number', width: 110, editable: true },
    { field: 'rating', title: 'Hodnocení', type: 'number', width: 120, editable: true },
  ];
  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:10px;color:#6b7583;font-size:13px';
  bar.innerHTML = 'Táhni myší přes buňky (nebo šipky/shift+šipky), pak <b>Ctrl/⌘+C</b> zkopíruj, <b>Ctrl/⌘+V</b> vlož. <span class="status"></span>';
  const gridEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:12px';
  panel.innerHTML = '<div style="font-size:12px;color:#6b7583;margin-bottom:4px">Zkopírovaný rozsah (TSV do schránky):</div>' +
    '<pre class="tsv" style="margin:0;padding:12px 14px;background:#1f2733;color:#e6edf3;border-radius:8px;overflow-x:auto;font-size:12px;min-height:24px">— vyber rozsah a stiskni Ctrl/⌘+C —</pre>';
  el.append(bar, gridEl, panel);
  const status = bar.querySelector('.status');
  const tsvOut = panel.querySelector('.tsv');

  return new Lattice(gridEl, base(ctx, {
    id: 'ex-range', columns: cols, data: rows, keyField: 'id', pageSize: 25,
    rangeSelection: true, editable: true,
    onRangeCopy: (data, tsv) => { tsvOut.textContent = tsv; status.textContent = `Zkopírováno ${data.length}×${data[0] ? data[0].length : 0} buněk.`; },
    onRangePaste: (changed) => { status.textContent = `Vloženo do ${changed.length} buněk.`; },
  }));
}

/* ---------------- příklad „Živá data" (granulární změny řádků) ---------------- */

function reactivityExample(el, ctx) {
  // Vlastní kopie dat (mutace se nesmí promítnout do jiných příkladů).
  const rows = ctx.data.slice(0, 12).map((r) => ({ ...r }));
  let nextId = Math.max(...rows.map((r) => r.id)) + 1;
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px';
  bar.innerHTML =
    '<button data-a="add" type="button">+ Přidat řádek</button>' +
    '<button data-a="upd" type="button">✎ Upravit náhodný</button>' +
    '<button data-a="del" type="button">− Smazat první</button>' +
    '<button data-a="live" type="button">▶ Živé updaty</button>' +
    '<span class="status" style="color:#6b7583;font-size:13px"></span>';
  for (const b of bar.querySelectorAll('button')) b.style.cssText = 'padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
  el.appendChild(bar);
  // alertData:false — živé updaty by jinak spustily alert každou sekundu; jen panel.
  const grid = withEventLog(el, ctx, { id: 'ex-reactive', columns: coreColumns(), data: rows, keyField: 'id', pageSize: 25 }, null, { alertData: false });
  const status = bar.querySelector('.status');
  const ids = () => grid.dataSource.data.map((r) => r.id);

  bar.querySelector('[data-a="add"]').addEventListener('click', () => {
    const id = nextId++;
    grid.addRow({ id, name: 'Nová kampaň #' + id, category: 'Event', owner: 'Nováková', region: 'Praha', budget: rand(50000, 500000), score: rand(0, 100), status: 'Plánováno' }, true);
    status.textContent = 'Přidán řádek id ' + id + ' (na začátek).';
  });
  bar.querySelector('[data-a="upd"]').addEventListener('click', () => {
    const list = ids(); if (!list.length) return;
    const id = list[rand(0, list.length)];
    grid.updateRow(id, { score: rand(0, 100), budget: rand(50000, 500000) });
    status.textContent = 'Upraven řádek id ' + id + '.';
  });
  bar.querySelector('[data-a="del"]').addEventListener('click', () => {
    const list = ids(); if (!list.length) return;
    grid.deleteRow(list[0]);
    status.textContent = 'Smazán řádek id ' + list[0] + '.';
  });

  // „Websocket" simulace — každou sekundu upsert skóre náhodného řádku.
  let timer = null;
  const liveBtn = bar.querySelector('[data-a="live"]');
  liveBtn.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; liveBtn.textContent = '▶ Živé updaty'; status.textContent = 'Živé updaty zastaveny.'; return; }
    liveBtn.textContent = '⏸ Zastavit'; status.textContent = 'Živé updaty běží (simulace push ze serveru)…';
    timer = setInterval(() => {
      const list = ids(); if (!list.length) return;
      grid.updateData([{ id: list[rand(0, list.length)], score: rand(0, 100) }]);
    }, 1000);
  });
  // Úklid intervalu při přepnutí příkladu (app.js volá grid.destroy()).
  const origDestroy = grid.destroy.bind(grid);
  grid.destroy = () => { if (timer) clearInterval(timer); origDestroy(); };

  return grid;
}
