/**
 * Lattice — hlavní třída a orchestrátor.
 *
 * Drží JEDEN živý stav (sloupce, řazení, filtry, instance), koordinuje datový
 * zdroj, render a features. Persistence jde vždy přes saveState() do jednoho
 * blobu (Store) — jeden zdroj pravdy.
 *
 * Deterministický init:
 *   načti blob → sestav finální sloupce → postav skelet → vykresli → načti data
 */
import { Store, emptyState } from './core/Store.js';
import { buildColumns, serializeColumns, flattenGroups, resolveColumn } from './core/ColumnModel.js';
import { validateFormula, validateAggregate, FormulaError } from './core/formula.js';
import { dateBucket } from './core/dateParts.js';
import { deriveColumns, columnsFor } from './core/autoColumns.js';
import { parseFile, parseHTMLTable, tableToRows, parseXML } from './core/fileImport.js';
import { buildExport, downloadFile, EXPORT_META } from './core/exporter.js';
import { printTable } from './features/print.js';
import { ClientData, ServerData, rowMatches, encodeParams } from './core/DataSource.js';
import { getFilter } from './filters/index.js';
import { I18n } from './i18n/index.js';
import { Renderer } from './render/Renderer.js';
import { Gear } from './features/gear.js';
import { InstanceSettings } from './features/instanceSettings.js';
import { Pagination } from './features/pagination.js';
import { PresetStore, normalizeDisplay } from './features/presets.js';
import { measureColumnWidth } from './features/resize.js';
import { AdvancedFilter } from './features/advancedFilter.js';
import { SaveFiltersPanel } from './features/saveFilters.js';
import { EditManager } from './features/editing.js';
import { TreeManager } from './features/tree.js';
import { RangeManager } from './features/rangeSelection.js';
import { History } from './features/history.js';
import { DEFAULT_FORMATS, formatKind, formatKeys } from './core/format.js';

const INSTANCE_DEFAULTS = {
  paginationPosition: 'footer', // 'footer' | 'header' | 'both' | 'none'
  layout: 'fitData',   // 'fit' = roztáhnout do šířky | 'fitData' = dle obsahu
  density: 'comfortable',
  fontSize: 14,
  pageSize: 50,
  filterLayout: 'header', // 'header' = filtry v záhlaví | 'external' = panel nad tabulkou
  externalFiltersCollapsed: false, // sbalení externího filtračního panelu (šetří místo na malých monitorech)
  rowNumbers: 'none',     // 'none' | 'continuous' (průběžné) | 'perPage' (od 1 na každé stránce)
  headerRotate: 'none',   // otočení hlaviček (hromadně): 'none' | '90' | '270'
  summaryRow: 'none',     // souhrnný řádek: 'none' | 'page' (zobrazená stránka) | 'all' (všechny záznamy)
  groupSubtotals: false,  // mezisoučty za každou skupinu řádků (dle col.summary)
  rowNumberWidth: null,   // uživatelská šířka číslovacího sloupce (null = auto)
  groupBy: null,          // seskupení řádků: pole (field) | {field,part} | jejich pole (víceúrovňové)
  groupDisplay: 'headers',// jak zobrazit úrovně seskupení: 'headers' (vnořené hlavičky) | 'columns' (vedoucí sloupce)
  groupRepeat: true,      // opakovat hodnotu seskupení v každém řádku (true) | jen v záhlaví skupiny (false, jen headers)
  selectColumn: true,     // zobrazit sloupec s checkboxy (jen když je selectable)
  selectRowClick: false,  // klik na řádek = výběr (false = vybírá jen checkbox)
  rowHighlight: false,    // klik na řádek = přepnutí zvýraznění (podbarvení); true | 'click' zapne, false vypne
  actionsLayout: 'column', // sloupec akcí: 'column' (poslední sloupec) | 'menu' (⋮ v číslování řádků)
  resizeGuide: false,     // změna šířky sloupce: false = živě | true = s vodicí čárou (aplikuje se v mouseup)
  theme: 'default',       // vzhled: 'default' | 'auto' (dle systému) | 'minimal' | 'compact' | 'slate' (tmavý) | 'ocean' | 'warm' | 'contrast' | 'bootstrap5' | 'tailwind' | 'material'
  fontFamily: '',         // '' = dle motivu | jinak CSS font-family override
  zebra: true,            // pruhované řádky
  wrapText: false,        // zalamovat text v buňkách (jinak … ořez)
  wrapHeader: false,      // zalamovat názvy sloupců v záhlaví (nezávisle na wrapText); auto-fit počítá s 2 řádky
  emptyText: '',          // placeholder pro prázdné buňky (např. '—')
  linkNewTab: false,      // odkazy (typ 'link') otevírat v nové kartě (+ ikona); per-sloupec přebije formatterParams.target
  locale: '',             // BCP-47 locale pro formát čísel/měny ('' = dle prohlížeče)
  scaleColors: null,      // kotevní barvy podmíněné škály [low, mid, high]; null = výchozí (červená/žlutá/zelená)
  cssVars: {},            // vlastní CSS proměnné (přepíšou motiv): { '--lattice-accent': '#e91e63', … }
  format: {},             // globální formát zobrazení po druzích: { number, money, date, datetime, time }
};

/**
 * Přechodný UI stav, který žije v `instance`, ale není „nastavení“ — do presetu
 * ani do globálních výchozích se nekopíruje (jinak by cizí preset uživateli
 * zavíral filtrační panel).
 */
const TRANSIENT_INSTANCE_KEYS = ['externalFiltersCollapsed'];

/**
 * Normalizuje výběr částí stavu pro `captureState`. Nezadáno (nebo chybějící
 * klíč) = zachytit — aby volání bez argumentu dál ukládalo celý stav.
 */
function presetParts(parts) {
  const p = parts || {};
  return { columns: p.columns !== false, filters: p.filters !== false, instance: p.instance !== false };
}

/**
 * Volby z `instance`, které se ovládají z dialogu „Sloupce" a přeskupují sloupce —
 * „Obnovit výchozí" je vrací spolu se sloupci.
 */
const COLUMN_INSTANCE_KEYS = ['groupBy', 'groupDisplay', 'groupRepeat'];

/** Je to obyčejný objekt (ne null, ne pole)? */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export class Lattice {
  constructor(mount, options = {}) {
    this.el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!this.el) throw new Error(`Lattice: mount element nenalezen (${mount}).`);
    if (!options.id) throw new Error('Lattice: chybí `id` (klíč pro persistenci).');

    this.options = options;
    this.i18n = new I18n(options.i18n);
    this.store = new Store(options.id, { storage: options.storage });

    // 1) načti persistovaný stav
    this._freshUser = !this.store.has(); // úplně nový uživatel (žádný uložený stav)?
    this.state = this.store.load();

    // 1b) globální výchozí nastavení tabulky (od aplikace). Automaticky se použije
    //     JEN pro úplně nového uživatele (seed). Existujícího uživatele NEpřepisuje —
    //     nová verze se jen nabídne tlačítkem v nastavení (respektuje jeho úpravy,
    //     třeba jiný jazyk než globál).
    this._applyGlobalDefaults();

    // 2) instance nastavení: defaults ← config.instance ← persistovaný stav
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, options.instance, this.state.instance);
    if (options.pageSize != null && this.state.instance.pageSize == null) {
      this.instance.pageSize = options.pageSize;
    }
    // migrace ze staršího boolean `pagination` na `paginationPosition`
    if (this.state.instance.paginationPosition == null && typeof this.state.instance.pagination === 'boolean') {
      this.instance.paginationPosition = this.state.instance.pagination ? 'footer' : 'none';
    }
    this.pageSize = this.instance.pageSize;

    // 3) deterministicky sestav finální sloupce (PŘED renderem)
    // autoColumns: když se sloupce nezadají (nebo explicitně autoColumns:true),
    // odvodí se z klíčů dat. columnDefs = kanonická definice.
    this.autoColumns = options.autoColumns === true || !(options.columns && options.columns.length);
    let defs = options.columns || [];
    if (this.autoColumns && !defs.length && Array.isArray(options.data) && options.data.length) {
      defs = deriveColumns(options.data);
    }
    this.columnDefs = defs;
    this.columns = buildColumns(defs, this.state.columns);

    // 4) živý stav řazení/filtrů z blobu
    this.sort = Array.isArray(this.state.sort) ? this.state.sort.slice() : [];
    this.filters = Object.assign({}, this.state.filters);
    this.quickSearch = ''; // rychlé hledání přes vše (transientní, nepersistuje se)
    this.advanced = this.state.advanced || null; // aktivní rozšířený filtr (strom)
    // Globální (sdílené) rozšířené filtry — localStorage je per-prohlížeč, takže
    // sdílení napříč uživateli knihovna sama nezajistí: pole dodá APLIKACE přes
    // options.globalAdvancedFilters (načtené z DB dle options.id), uložení/smazání
    // řeší přes callbacky onSaveGlobalAdvancedFilter / onDeleteGlobalAdvancedFilter.
    // Nepersistují se do blobu (žijí v paměti instance, aplikace je zdroj pravdy).
    this.globalAdvanced = (Array.isArray(options.globalAdvancedFilters) ? options.globalAdvancedFilters : [])
      .map((f) => ({ ...f, scope: 'global' }));
    this.universal = this.state.universal || null; // univerzální filtr { field, op, value }
    // Synchronizace stavu do URL query stringu (sdílitelné filtrované pohledy).
    this.urlState = options.urlState ? { key: (typeof options.urlState === 'object' && options.urlState.key) || options.id } : null;
    this.groupsCollapsed = new Set(this.state.groups || []); // sbalené skupiny řádků
    this.colGroupsCollapsed = new Set(this.state.colGroups || []); // sbalené skupiny SLOUPCŮ (dle názvu)
    // Tree data (hierarchie) — když je zapnuté, nahrazuje stránkovaný datový zdroj.
    this.tree = options.treeData ? new TreeManager(this, options) : null;
    this.treeView = null;
    // Výběr rozsahu buněk (spreadsheet-like) + schránka.
    this.range = options.rangeSelection ? new RangeManager(this) : null;
    // Historie změn dat (undo/redo) — jen client-side.
    this.history = (options.history && !options.serverSide) ? new History(this, options.historySize) : null;

    // 5) datový zdroj
    // Klíč řádku: explicitní keyField > sloupec typu 'id' > 'id'. Typ 'id' říká,
    // co posílat pro identifikaci záznamu (a nikdy se needituje).
    const idCol = flattenGroups(defs).find((c) => c && c.type === 'id');
    this.keyField = options.keyField || (idCol && idCol.field) || 'id';
    // Progresivní načítání (jen server-side): 'scroll' (nekonečné) | 'load' (tlačítko) | null
    this.progressive = (options.serverSide && (options.progressiveLoad === 'scroll' || options.progressiveLoad === 'load')) ? options.progressiveLoad : null;
    // Virtuální scrollování (jen client-side ploché řádky): vykreslí jen viditelné
    // řádky bez stránkování — pro obří datasety. Při seskupení/stromu se nepoužije.
    this.virtual = options.virtualScroll === true && !options.serverSide && !options.treeData;
    // Rozbalovací detail řádku (master-detail): funkce vrací obsah panelu pod řádkem.
    // Jen ploché řádky (ne strom, ne virtuální scroll). Stav rozbalení je transientní.
    this.detailFn = (typeof options.rowDetail === 'function' && !options.treeData && !this.virtual) ? options.rowDetail : null;
    this.expandedDetails = new Set();
    // Připnuté řádky (vždy viditelné nahoře/dole) — pole objektů řádků.
    this.pinnedTop = Array.isArray(options.pinnedTop) ? options.pinnedTop.slice() : [];
    this.pinnedBottom = Array.isArray(options.pinnedBottom) ? options.pinnedBottom.slice() : [];
    // Responsivní skládání: při úzkém viewportu se přetečené (nefixované) sloupce
    // schovají do rozbalovacího detailu řádku. Jen ploché řádky (ne strom/virtuál).
    this.responsive = options.responsive === true && !options.treeData && !this.virtual;
    this.loadedRows = [];   // akumulátor řádků napříč stránkami
    this.loadedPage = 0;    // nejvyšší dosud načtená stránka
    this.movable = options.movableRows === true; // přesouvání řádků tažením
    this.orderField = options.orderField || null; // pole pořadí (ploché reorder / sourozenci)
    // Přijímání řádků z jiných tabulek: true/'move' (přesun) | 'copy' (kopie) | false
    this.acceptExternalRows = options.acceptExternalRows || false;
    INSTANCES.set(options.id, this); // registr pro přesun mezi tabulkami
    this.selectable = normSelectable(options.selectable); // výběr řádků (checkboxy)
    this.selected = new Set(); // klíče vybraných řádků (keyField, string)
    this.selectScope = 'page'; // rozsah výběru pro horní checkbox / invert ('page' | 'all')
    this.highlightedKeys = new Set(this.state.highlighted || []); // klíče zvýrazněných (podbarvených) řádků; přežívá re-render, persistuje se
    this.serverSide = !!options.serverSide;
    this.dataSource = this.serverSide
      ? new ServerData(resolveAjax(options))
      : new ClientData(options.data || []);

    // 6) stránkování
    this.page = 1;
    this.rows = [];
    this.total = 0;
    this.lastPage = 1;

    // 6b) přepiš řazení/filtry/hledání/stránku z URL (sdílitelné pohledy) — až po
    //     inicializaci stránky, ať ji URL může nastavit.
    this._readUrl();

    // 7) features + render
    this._activePresetId = null;
    this.presets = new PresetStore(this);
    this.gear = new Gear(this);
    this.instanceSettings = new InstanceSettings(this);
    this.advancedFilter = new AdvancedFilter(this);
    this.saveFiltersPanel = new SaveFiltersPanel(this);
    this.pagination = new Pagination(this);
    this.renderer = new Renderer(this);
    this.renderer.mount();
    this.renderer.renderHeader();
    this.renderer.applyLayout();

    // Inline editace (opt-in přes column.editable / options.editable)
    this.editManager = new EditManager(this);
    this.editManager.attach();

    // 8) načti data
    this.refresh();
    this._scheduleSearchIndex(); // předpočítej vyhledávací index na pozadí

    // 9) globální presety (async, dodá je aplikace přes adaptér) — po načtení
    //    případně překreslit otevřený gear panel
    if (this.presets.hasAdapter()) {
      this.presets.loadGlobals().then(() => this.gear?.refresh());
    }

    // Po aplikaci globálních defaultů persistuj (verze + přepsaný stav), aby se
    // příště nepřepisovalo a uživatelovy úpravy se držely do další verze.
    if (this._gdJustApplied) { this.saveState(); this._gdJustApplied = false; }
  }

  /* =================== URL sync (sdílitelné pohledy) =================== */

  /** Kompaktní payload stavu pro URL (jen neprázdné části). */
  _urlPayload() {
    const p = {};
    if (this.sort && this.sort.length) p.s = this.sort.map((x) => [x.field, x.dir === 'desc' ? 'd' : 'a']);
    if (this.filters && Object.keys(this.filters).length) p.f = this.filters;
    if (this.quickSearch) p.q = this.quickSearch;
    if (this.page > 1) p.p = this.page;
    if (this.universal && this.universal.field) p.u = this.universal;
    if (this.advanced) p.a = this.advanced;
    return p;
  }

  /** Zapíše stav do URL query stringu (replaceState — nezaplní historii). */
  _writeUrl() {
    if (!this.urlState || typeof window === 'undefined' || !window.history) return;
    try {
      const url = new URL(window.location.href);
      const payload = this._urlPayload();
      if (Object.keys(payload).length) url.searchParams.set(this.urlState.key, JSON.stringify(payload));
      else url.searchParams.delete(this.urlState.key);
      window.history.replaceState(null, '', url);
    } catch { /* no-op */ }
  }

  /** Načte stav z URL query stringu (při initu) — přepíše řazení/filtry/hledání/stránku. */
  _readUrl() {
    if (!this.urlState || typeof window === 'undefined') return;
    let raw;
    try { raw = new URL(window.location.href).searchParams.get(this.urlState.key); } catch { return; }
    if (!raw) return;
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (Array.isArray(p.s)) this.sort = p.s.map(([field, d]) => ({ field, dir: d === 'd' ? 'desc' : 'asc' }));
    if (p.f && typeof p.f === 'object') this.filters = { ...p.f };
    if (typeof p.q === 'string') this.quickSearch = p.q;
    if (p.p) this.page = Number(p.p) || 1;
    if (p.u) this.universal = p.u;
    if (p.a) this.advanced = p.a;
  }

  /* =================== persistence =================== */

  /** Sestaví blob z živého stavu a uloží (jeden zdroj pravdy). */
  saveState() {
    this.state.columns = serializeColumns(this.columns);
    this.state.sort = this.sort;
    this.state.filters = this.filters;
    this.state.advanced = this.advanced;
    this.state.universal = this.universal;
    // Persistuj celou instanci (všechny volby nastavení tabulky) — jeden zdroj
    // pravdy, automaticky zahrne i nově přidané volby (theme, format, locale…).
    this.state.instance = { ...this.instance };
    this.state.groups = [...this.groupsCollapsed];
    this.state.colGroups = [...this.colGroupsCollapsed];
    this.state.highlighted = [...this.highlightedKeys];
    if (this.tree) this.state.tree = [...this.tree.expanded];
    this.store.save(this.state);
  }

  /* =================== globální výchozí nastavení (admin → všem) =================== */

  /**
   * Při startu: globální defaulty se automaticky použijí JEN pro úplně nového
   * uživatele (seed do jeho stavu). Existující uživatel se nepřepisuje — nová
   * verze se mu jen nabídne v nastavení (globalDefaultsAvailable → tlačítko).
   */
  _applyGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || gd.version == null || !gd.state) return;
    if (this.state._gdVersion === gd.version) return; // tuhle verzi už zná
    if (!this._freshUser) return;                     // existující uživatel → jen nabídnout
    this._writeGdIntoState(gd);
    this._gdJustApplied = true; // po sestavení persistovat
  }

  /** Zapíše snapshot globálních defaultů do persistovaného stavu (před sestavením). */
  _writeGdIntoState(gd) {
    const s = gd.state;
    if (s.instance) this.state.instance = { ...s.instance };
    if (Array.isArray(s.columns)) this.state.columns = s.columns;
    if ('sort' in s) this.state.sort = s.sort;
    if ('filters' in s) this.state.filters = s.filters;
    this.state._gdVersion = gd.version;
  }

  /** Existuje vůbec nějaké globální výchozí nastavení od správce? */
  hasGlobalDefaults() {
    const gd = this.options.globalDefaults;
    return !!(gd && gd.state);
  }

  /** Je k dispozici NOVÁ verze globálního nastavení, kterou uživatel ještě neviděl? */
  globalDefaultsAvailable() {
    const gd = this.options.globalDefaults;
    return !!(gd && gd.version != null && gd.state && this.state._gdVersion !== gd.version);
  }

  /** Použije globální výchozí nastavení TEĎ (na pokyn uživatele) a uloží lokálně. */
  applyGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || !gd.state) return;
    const s = gd.state;
    this._applyInstanceSnapshot(s.instance);
    if (Array.isArray(s.columns)) this.columns = buildColumns(this.columnDefs || [], s.columns);
    this.sort = Array.isArray(s.sort) ? s.sort.slice() : [];
    this.filters = Object.assign({}, s.filters);
    this.state._gdVersion = gd.version;
    this._activePresetId = null;
    this.saveState();
    this.renderer.applyInstanceStyles();
    this.renderer.renderToolbar();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this.refresh();
  }

  /** „Ponechat moje nastavení" — jen potvrdí verzi, ať se nabídka znovu neukazuje. */
  dismissGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || gd.version == null) return;
    this.state._gdVersion = gd.version;
    this.saveState();
    this.renderer.renderToolbar();
  }

  /** Lze uložit globální výchozí nastavení? (aplikace dodala callback) */
  canSaveGlobalDefaults() {
    return typeof this.options.onSaveGlobalDefaults === 'function';
  }

  /**
   * Uloží aktuální nastavení tabulky jako globální výchozí pro všechny. Knihovna
   * jen sestaví snapshot (instance + sloupce + řazení + filtry) s novou verzí a
   * předá aplikaci přes callback onSaveGlobalDefaults({version, state}); ta ho
   * uloží a bude servírovat ostatním uživatelům (přepíše jim i localStorage).
   */
  setGlobalDefaults() {
    const cb = this.options.onSaveGlobalDefaults;
    if (typeof cb !== 'function') return null;
    const version = Date.now();
    const payload = {
      version,
      state: {
        instance: this.captureInstance(),
        columns: serializeColumns(this.columns),
        sort: JSON.parse(JSON.stringify(this.sort)),
        filters: JSON.parse(JSON.stringify(this.filters)),
      },
    };
    cb(payload);
    // Označ tuto verzi jako aplikovanou i pro admina (ať se mu to znovu nepřepíše).
    this.state._gdVersion = version;
    this.saveState();
    return payload;
  }

  /* =================== data =================== */

  /** Znovu načte data dle aktuálního stavu a vykreslí tělo + patičku. */
  async refresh() {
    this._writeUrl(); // promítni aktuální stav do URL (je-li urlState zapnutý)
    // Tree režim: data jsou hierarchická, žádné stránkování/dotaz na server.
    if (this.tree) return this.renderTree();
    // Progresivní režim: refresh = RESET (nový sort/filtr) → od stránky 1, čistý akumulátor.
    if (this.progressive) { this.page = 1; this.loadedRows = []; this.loadedPage = 0; }
    const reqId = (this._reqId = (this._reqId || 0) + 1);
    this.renderer.setLoading(true);
    try {
      const res = await this.dataSource.query({
        page: this.page,
        pageSize: this.pageSize,
        paginate: this.virtual ? false : (this.progressive ? true : this.paginationEnabled()),
        sort: this.sort,
        filters: this.filters,
        advanced: this.advanced,
        universal: this.universalActive() ? this.universal : null,
        search: this.quickSearch || '',
        columns: this.columns,
      });
      if (reqId !== this._reqId) return; // dorazila starší odpověď → zahodit

      this.total = res.total ?? (res.rows || []).length;
      this.lastPage = res.lastPage || 1;

      if (this.progressive) {
        // Server seřadil/vyfiltroval celý dataset; my držíme jen načtené stránky.
        this.loadedRows = (res.rows || []).slice();
        this.loadedPage = 1;
        this.rows = this.loadedRows;
      } else {
        this.rows = res.rows || [];
        // Kdyby po filtru/změně velikosti zbyla neplatná stránka, doskoč a načti znovu.
        if (this.paginationEnabled() && this.page > this.lastPage && this.lastPage >= 1 && this.page > 1) {
          this.page = this.lastPage;
          return this.refresh();
        }
      }

      this.renderer.setLoading(false);
      this.renderer.renderBody();
      this.renderer.renderFooter();
      if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.page, sort: this.sort });
    } catch (err) {
      if (reqId !== this._reqId) return;
      this.renderer.setLoading(false);
      this.renderer.setError();
      if (this.options.onError) this.options.onError(err);
      else console.error('[Lattice] chyba načtení dat:', err);
    }
  }

  /** Tree režim: sestaví ploché pořadí viditelných uzlů a vykreslí (bez stránkování). */
  renderTree() {
    // Aktivní filtr? Ve stromu se nefiltruje přes dotaz — projedeme uzly ručně
    // (zachová se cesta k shodě a větve se shodou se rozbalí).
    const anyFilter = Object.keys(this.filters).length > 0
      || !!(this.quickSearch && this.quickSearch.trim())
      || this.universalActive() || this.advancedActive();
    let view;
    if (anyFilter) {
      const predicate = (row) => rowMatches(row, {
        filters: this.filters, search: this.quickSearch || '', columns: this.columns,
        universal: this.universalActive() ? this.universal : null,
        advanced: this.advancedActive() ? this.advanced : null,
      });
      view = this.tree.filteredRows(predicate);
    } else {
      view = this.tree.visibleRows();
    }
    this.treeView = view;
    this.rows = view.map((v) => v.row);
    this.total = this.rows.length;
    this.lastPage = 1;
    this.renderer.setLoading(false);
    this.renderer.renderBody();
    this.renderer.renderFooter();
    if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.page, sort: this.sort, tree: true });
  }

  /** Je stránkování (klasický paginátor) zapnuté? V tree i progresivním režimu ne. */
  paginationEnabled() {
    return !this.tree && !this.progressive && this.instance.paginationPosition !== 'none';
  }

  /** Jsou v progresivním režimu načtené všechny stránky? */
  progressiveDone() {
    return this.loadedPage >= this.lastPage;
  }

  /**
   * Progresivní režim: dotáhne DALŠÍ stránku a PŘIPOJÍ řádky (nemění sort/filtr).
   * Používá se u nekonečného scrollu i tlačítka „Načíst další".
   */
  async loadMore() {
    if (!this.progressive || this._loadingMore || this.progressiveDone()) return;
    this._loadingMore = true;
    this.renderer.setProgressiveLoading(true);
    const next = this.loadedPage + 1;
    // Stejný token jako refresh() — když mezitím proběhne refresh (změna řazení/
    // filtru → reset loadedRows), opožděná odpověď loadMore se zahodí a nepřisype
    // staré řádky na nový akumulátor.
    const reqId = (this._reqId = (this._reqId || 0) + 1);
    try {
      const res = await this.dataSource.query({
        page: next, pageSize: this.pageSize, paginate: true,
        sort: this.sort, filters: this.filters, advanced: this.advanced,
        universal: this.universalActive() ? this.universal : null, columns: this.columns,
      });
      if (reqId !== this._reqId) return; // přebito novějším requestem → zahodit
      this.loadedRows.push(...(res.rows || []));
      this.loadedPage = next;
      this.total = res.total ?? this.total;
      this.lastPage = res.lastPage || this.lastPage;
      this.rows = this.loadedRows;
      this.renderer.renderBody();
      this.renderer.renderFooter();
      if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.loadedPage, sort: this.sort });
    } catch (err) {
      if (this.options.onError) this.options.onError(err); else console.error('[Lattice] progresivní načtení selhalo:', err);
    } finally {
      this._loadingMore = false;
      this.renderer.setProgressiveLoading(false);
    }
  }

  /** Nastaví client-side data za běhu (nebo tree data v tree režimu). */
  setData(data) {
    if (this.selected.size) this.selected.clear(); // nová data = staré klíče neplatí
    if (this.tree) {
      this.tree.setData(data);
      this.refresh();
    } else if (this.dataSource instanceof ClientData) {
      this.dataSource.setData(data);
      this.page = 1;
      this.refresh();
      this._scheduleSearchIndex();
    }
  }

  /**
   * Předpočítá vyhledávací index na pozadí (idle), aby i první hledání bylo
   * rychlé. Jen client-side a jen když je quickSearch zapnutý — jinak zbytečná
   * práce. Bezpečné volat opakovaně (poslední naplánování vyhraje).
   */
  _scheduleSearchIndex() {
    if (!this.options.quickSearch || this.serverSide) return;
    if (!this.dataSource || typeof this.dataSource.buildSearchIndex !== 'function') return;
    if (this._searchIdle != null) return; // už naplánováno
    const build = () => { this._searchIdle = null; try { this.dataSource.buildSearchIndex(this.columns); } catch { /* no-op */ } };
    if (typeof requestIdleCallback === 'function') this._searchIdle = requestIdleCallback(build, { timeout: 800 });
    else this._searchIdle = setTimeout(build, 0);
  }

  /* =================== řazení =================== */

  /** Cyklí řazení sloupce (asc → desc → zrušit). `append` (Shift) = víceúrovňové. */
  toggleSort(field, append) {
    this._clearActivePreset();
    const cur = this.sort.find((s) => s.field === field);
    let dir;
    if (!cur) dir = 'asc';
    else if (cur.dir === 'asc') dir = 'desc';
    else dir = null; // třetí klik = zrušit řazení tohoto sloupce
    if (append) {
      const next = this.sort.map((s) => ({ ...s }));
      const i = next.findIndex((s) => s.field === field);
      if (dir == null) { if (i >= 0) next.splice(i, 1); }       // třetí klik → odebrat
      else if (i >= 0) next[i].dir = dir;                       // cyklit na místě (drží pořadí)
      else next.push({ field, dir });                          // nový → na konec
      this._setSort(next);
    } else {
      this._setSort(dir ? [{ field, dir }] : []);
    }
  }

  /** Interní: nastaví pole řazení a překreslí. */
  _setSort(arr) {
    this.sort = arr;
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.refresh();
    this._emitSort();
  }

  /** Explicitně seřadí sloupec ('asc'|'desc'|null = zrušit). */
  sortColumn(field, dir) {
    this._clearActivePreset();
    this._setSort(dir ? [{ field, dir }] : []);
  }

  /**
   * Řazení SKUPIN z hlavičky skupiny (i pro pole skryté seskupením). Nastaví
   * pole jako PRIMÁRNÍ řadicí klíč (skupiny se podle něj seřadí) a zachová
   * ostatní řazení jako sekundární (řazení řádků uvnitř skupin). Cyklus asc↔desc.
   */
  cycleGroupSort(field) {
    this._clearActivePreset();
    const cur = this.sort.find((s) => s.field === field);
    const dir = !cur || cur.dir === 'desc' ? 'asc' : 'desc';
    const others = this.sort.filter((s) => s.field !== field);
    this._setSort([{ field, dir }, ...others]);
  }

  /** Aktuální směr řazení pole ('asc'|'desc'|null). */
  sortDir(field) {
    const s = this.sort.find((x) => x.field === field);
    return s ? s.dir : null;
  }

  /** Přizpůsobí šířku jednoho sloupce obsahu. */
  autoFitColumn(field) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    const w = measureColumnWidth(col, this);
    if (w) { col.width = w; this._clearActivePreset(); this.saveState(); this.renderer.applyLayout(); }
  }

  /* =================== filtry =================== */

  setFilter(field, value) {
    this._clearActivePreset();
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete this.filters[field];
    } else {
      this.filters[field] = value;
    }
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitFilter();
  }

  /** Rychlé hledání přes všechny viditelné sloupce (transientní). */
  setQuickSearch(term) {
    this.quickSearch = term || '';
    this.page = 1;
    this.refresh();
    this._emitFilter();
  }

  clearFilters() {
    this.clearAllFilters();
  }

  /** Je aplikovaný nějaký filtr (sloupcový / univerzální / rozšířený)? Ne quickSearch. */
  hasActiveFilters() {
    return Object.keys(this.filters).length > 0 || this.universalActive() || this.advancedActive();
  }

  /**
   * Zruší všechny APLIKOVANÉ filtry — sloupcové, univerzální i aktivní rozšířený
   * (a rychlé hledání). ULOŽENÉ rozšířené filtry zůstávají (jen se deaktivují).
   */
  clearAllFilters() {
    this.filters = {};
    this.quickSearch = '';
    this.universal = null;
    this.advanced = null;
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
  }

  /* =================== univerzální filtr =================== */

  /** Je univerzální filtr aktivní (má pole i hodnotu)? */
  universalActive() {
    const u = this.universal;
    return !!(u && u.field && u.op && u.value != null && String(u.value) !== '');
  }

  /** Nastaví univerzální filtr { field, op, value } (nebo null = zrušit). */
  setUniversal(u) {
    this.universal = u && u.field ? { field: u.field, op: u.op || 'contains', value: u.value ?? '' } : null;
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitFilter();
  }

  clearUniversal() {
    this.setUniversal(null);
  }

  /* =================== seskupení řádků (row grouping) =================== */

  /**
   * Pořadí polí, podle kterých seskupujeme (víceúrovňově). Normalizuje
   * instance.groupBy (string kvůli zpětné kompatibilitě nebo pole) a vyfiltruje
   * jen platná, neopakující se pole odpovídající existujícímu sloupci.
   */
  /**
   * Normalizované deskriptory seskupení (víceúrovňově). Položka instance.groupBy
   * může být `field` (string) nebo `{ field, part }` (datumová úroveň — rok,
   * kvartál, …). Vrací `[{ field, part, id }]`; `id` je stabilní klíč
   * (`field` nebo `field@part`), unikátní a odpovídající existujícímu sloupci.
   */
  groupDescriptors() {
    const g = this.instance.groupBy;
    const arr = Array.isArray(g) ? g : (g ? [g] : []);
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const field = typeof item === 'string' ? item : (item && item.field);
      const part = typeof item === 'string' ? null : (item && item.part) || null;
      if (!field || !this.columns.some((c) => c.field === field)) continue;
      const id = part ? field + '@' + part : field;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ field, part, id });
    }
    return out;
  }

  /** Zpětně kompatibilní: jen názvy polí použitých k seskupení (bez ohledu na part). */
  groupFields() {
    return this.groupDescriptors().map((d) => d.field);
  }

  /** Pole, jejichž SYROVÁ hodnota je seskupení (part == null) → skryjí se jako běžný sloupec. */
  groupedRawFields() {
    return this.groupDescriptors().filter((d) => !d.part).map((d) => d.field);
  }

  /** Je seskupení řádků aktivní (aspoň jedna platná úroveň)? */
  groupActive() {
    return this.groupDescriptors().length > 0;
  }

  /** Stabilní id deskriptoru pro (field, part). */
  groupId(field, part = null) {
    return part ? field + '@' + part : field;
  }

  /** Je daná úroveň (field + volitelný part) použita k seskupení? */
  isRowGrouped(field, part = null) {
    const id = this.groupId(field, part);
    return this.groupDescriptors().some((d) => d.id === id);
  }

  /** Úroveň (1-based) seskupení pro (field, part), nebo 0 když se neseskupuje. */
  rowGroupLevel(field, part = null) {
    const id = this.groupId(field, part);
    return this.groupDescriptors().findIndex((d) => d.id === id) + 1;
  }

  /** Přepne, zda se podle úrovně (field + volitelný part) seskupuje (přidá na konec / odebere). */
  toggleRowGroup(field, part = null) {
    const id = this.groupId(field, part);
    const arr = this.groupDescriptors();
    const i = arr.findIndex((d) => d.id === id);
    if (i === -1) arr.push({ field, part, id }); else arr.splice(i, 1);
    // Zpět na serializovatelný tvar (string pro syrové pole, {field,part} pro datumovou úroveň).
    const groupBy = arr.map((d) => (d.part ? { field: d.field, part: d.part } : d.field));
    this.setInstance({ groupBy: groupBy.length ? groupBy : null });
  }

  /**
   * Rozdělí řádky do (případně vnořeného) stromu skupin dle groupFields().
   * Všechny řádky stejné hodnoty se sesbírají dohromady (v pořadí prvního
   * výskytu), takže skupina je souvislá i bez řazení. Vrací pole uzlů:
   *   { field, value, key, level, count, rows?:[{row,index}], groups?:[...] }.
   * `key` je celá cesta (unikátní pro stav sbalení), `index` původní index
   * v grid.rows (editace / rowClick / číslování).
   */
  buildGroups(rows) {
    const descriptors = this.groupDescriptors();
    const indexed = rows.map((row, index) => ({ row, index }));
    return this._groupLevel(indexed, descriptors, 0, '', []);
  }

  _groupLevel(items, descriptors, level, parentKey, parentPath) {
    const desc = descriptors[level];
    const { field, part } = desc;
    const last = level === descriptors.length - 1;
    const map = new Map();
    for (const it of items) {
      const raw = it.row[field];
      const bucket = part ? dateBucket(raw, part, this.i18n) : null;
      const value = bucket ? bucket.label : it.row[field];
      const vkey = value == null || value === '' ? '\u0000empty' : String(value);
      let g = map.get(vkey);
      if (!g) { g = { value, vkey, sort: bucket ? bucket.sort : null, items: [] }; map.set(vkey, g); }
      g.items.push(it);
    }
    let groups = [...map.values()];
    // Datumové úrovně seřadíme dle kbelíku; směr převezmeme z řazení seskupeného
    // sloupce (klik na šipku v hlavičce skupiny → roky/kvartály/… vzestupně/sestupně).
    // Syrová pole nechají pořadí výskytu (které už kopíruje aktivní řazení řádků,
    // a cycleGroupSort nastaví seskupené pole jako primární řadicí klíč).
    if (part) {
      const sorted = this.sort.find((s) => s.field === field);
      const dir = sorted && sorted.dir === 'desc' ? -1 : 1;
      groups.sort((a, b) => dir * ((a.sort ?? 0) - (b.sort ?? 0)));
    }
    return groups.map((g) => {
      const key = parentKey ? parentKey + '\u0000' + g.vkey : g.vkey;
      const path = [...parentPath, { field, part, value: g.value }]; // cesta úroveň→hodnota (pro přesun mezi skupinami)
      const base = { field, part, value: g.value, key, level, count: g.items.length, path };
      return last
        ? { ...base, rows: g.items }
        : { ...base, groups: this._groupLevel(g.items, descriptors, level + 1, key, path) };
    });
  }

  isGroupCollapsed(key) {
    return this.groupsCollapsed.has(key);
  }

  /** Přepne sbalení / rozbalení skupiny (persistováno) a překreslí tělo. */
  toggleGroup(key) {
    if (this.groupsCollapsed.has(key)) this.groupsCollapsed.delete(key);
    else this.groupsCollapsed.add(key);
    this.saveState();
    this.renderer.renderBody();
  }

  /** Je skupina SLOUPCŮ (dle názvu) sbalená? */
  isColGroupCollapsed(title) {
    return this.colGroupsCollapsed.has(title);
  }

  /**
   * Přepne sbalení / rozbalení skupiny SLOUPCŮ. Sbalená skupina se v tabulce
   * schová do úzkého proužku (jen ikona pro rozbalení); persistuje se. Mění se
   * sada sloupců i šířky → překreslí hlavičku, tělo a přepočítá layout.
   */
  toggleColGroup(title) {
    if (!title) return;
    if (this.colGroupsCollapsed.has(title)) this.colGroupsCollapsed.delete(title);
    else this.colGroupsCollapsed.add(title);
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
  }

  /** Nastaví připnuté řádky (nahoře/dole) a překreslí. `{ top?, bottom? }`. */
  setPinnedRows(patch = {}) {
    if ('top' in patch) this.pinnedTop = Array.isArray(patch.top) ? patch.top.slice() : [];
    if ('bottom' in patch) this.pinnedBottom = Array.isArray(patch.bottom) ? patch.bottom.slice() : [];
    this.renderer.renderPinned();
  }

  /* =================== rozbalovací detail řádku (master-detail) =================== */

  /** Je pod řádkem (dle klíče) rozbalený detail? */
  isDetailExpanded(key) {
    return this.expandedDetails.has(String(key));
  }

  /** Přepne rozbalení detailu řádku (transientní — nepersistuje se) a překreslí tělo. */
  toggleDetail(key) {
    const k = String(key);
    if (this.expandedDetails.has(k)) this.expandedDetails.delete(k);
    else this.expandedDetails.add(k);
    this.renderer.renderBody();
  }

  /* =================== rozšířený filtr =================== */

  /** Aplikuje rozšířený filtr (strom pravidel) nebo ho zruší (null). */
  applyAdvanced(tree) {
    this._clearActivePreset();
    this.advanced = tree && tree.rules && tree.rules.length ? tree : null;
    this.page = 1;
    this.saveState();
    this.refresh();
    this.renderer.renderToolbar(); // zvýraznění tlačítka
  }

  clearAdvanced() {
    this.applyAdvanced(null);
  }

  /** Je rozšířený filtr aktivní? */
  advancedActive() {
    return !!(this.advanced && this.advanced.rules && this.advanced.rules.length);
  }

  /** Lze uložit globální rozšířený filtr? (aplikace dodala callback) */
  canSaveGlobalAdvanced() {
    return typeof this.options.onSaveGlobalAdvancedFilter === 'function';
  }

  /**
   * Uloží pojmenovaný rozšířený filtr (stejný název ve stejném scope přepíše).
   *  - scope 'local' (výchozí) — do localStorage blobu (jen pro tohoto uživatele),
   *    kompletně v knihovně, bez závislosti na aplikaci.
   *  - scope 'global' — knihovna filtr jen sestaví, ukáže v seznamu a předá aplikaci
   *    přes callback onSaveGlobalAdvancedFilter({ id, name, tree }); ta zajistí
   *    perzistenci a sdílení mezi uživateli (DB). Vrací sestavenou položku.
   */
  saveAdvanced(name, tree, scope = 'local', display = false) {
    return this._saveNamedFilter(name, scope, display, { tree: JSON.parse(JSON.stringify(tree)) });
}

  /**
   * Společná perzistence pojmenovaného uloženého filtru (rozšířený strom NEBO snímek
   * sloupcových filtrů). `fields` nese specifika druhu ({ tree } | { kind, filters, filterTypes }).
   * Stejný název ve stejném scope přepíše (zachová id → downstream INSERT … ON DUPLICATE KEY).
   *  - local  → do localStorage blobu (state.advancedFilters), kompletně v knihovně.
   *  - global → knihovna položku sestaví a předá aplikaci přes onSaveGlobalAdvancedFilter;
   *    ta zajistí perzistenci a sdílení (DB). Payload nese i `fields` (u snímku tedy kind+filters).
   */
  _saveNamedFilter(name, scope, display, fields) {
    name = String(name || '').trim();
    if (!name) return null;
    // Zobrazení v toolbaru: tlačítko a/nebo výběr. Legacy boolean = jen tlačítko
    // (a tím pádem ne ve výběru), jak se `asButton` chovalo od v1.10.0.
    const core = { name, ...normalizeDisplay(display), ...fields };
    if (scope === 'global') {
      const existing = this.globalAdvanced.find((f) => f.name === name);
      const id = existing ? existing.id : uid();
      this.globalAdvanced = this.globalAdvanced.filter((f) => f.name !== name);
      const norm = { id, ...core, scope: 'global' };
      this.globalAdvanced.push(norm);
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === 'function') cb({ id, ...core });
      this.renderer.renderToolbar(); // aktualizovat rychlý select + řadu tlačítek v toolbaru
      return norm;
    }
    const existing = (this.state.advancedFilters || []).find((f) => f.name === name);
    const item = { id: existing ? existing.id : uid(), ...core };
    this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.name !== name);
    this.state.advancedFilters.push(item);
    this.store.save(this.state);
    this.renderer.renderToolbar(); // aktualizovat rychlý select + řadu tlačítek v toolbaru
    return item;
  }

  /**
   * Přepne u uloženého filtru jeho zobrazení v toolbaru — `key` je `'asButton'`
   * (rychlá řada tlačítek) nebo `'asSelect'` (rozbalovací výběr). U globálního filtru
   * pošle změnu aplikaci stejným callbackem jako uložení. `@v1.14.0`
   */
  setAdvancedDisplay(id, key, on) {
    if (key !== 'asButton' && key !== 'asSelect') return null;
    const g = this.globalAdvanced.find((f) => f.id === id);
    if (g) {
      // starší položka zná jen asButton → dopočítej druhou hodnotu, ať se chování nepřeklopí
      if (g.asSelect === undefined) g.asSelect = !g.asButton;
      g[key] = !!on;
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === 'function') { const { scope, ...core } = g; cb({ ...core }); }
      this.renderer.renderToolbar();
      return g;
    }
    const item = (this.state.advancedFilters || []).find((f) => f.id === id);
    if (!item) return null;
    if (item.asSelect === undefined) item.asSelect = !item.asButton;
    item[key] = !!on;
    this.store.save(this.state);
    this.renderer.renderToolbar();
    return item;
  }

  /** Smaže uložený rozšířený filtr (lokální z blobu; globální z UI + callback aplikace). */
  deleteAdvanced(id) {
    const g = this.globalAdvanced.find((f) => f.id === id);
    if (g) {
      this.globalAdvanced = this.globalAdvanced.filter((f) => f.id !== id);
      const cb = this.options.onDeleteGlobalAdvancedFilter;
      if (typeof cb === 'function') cb({ id: g.id, name: g.name });
      this.renderer.renderToolbar();
      return;
    }
    this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.id !== id);
    this.store.save(this.state);
    this.renderer.renderToolbar();
  }

  /** Uložené rozšířené filtry pro UI: lokální (scope:'local') + globální (scope:'global'). */
  listAdvanced() {
    const loc = (this.state.advancedFilters || []).map((f) => ({ ...f, scope: 'local' }));
    return [...loc, ...this.globalAdvanced];
  }

  /** Je uložená položka snímkem sloupcových filtrů (vs. rozšířený strom)? */
  _isSnapshot(item) {
    return !!(item && item.kind === 'columns');
  }

  /** Odpovídá uložená položka aktuálně aplikovanému stavu filtrů? */
  _isSavedActive(item) {
    // porovnáváme jen NEPRÁZDNÉ sloupcové filtry — this.filters může držet prázdné objekty
    // (např. date-two pošle {from:null,to:null}), které by jinak shodu rozbily
    if (this._isSnapshot(item)) return this._sameFilters(this._activeColumnFilters(), item.filters);
    return !!(this.advanced && JSON.stringify(this.advanced) === JSON.stringify(item.tree));
  }

  /** Id uloženého filtru odpovídajícího aktuálnímu stavu (nebo ''). */
  activeSavedId() {
    const f = this.listAdvanced().find((x) => this._isSavedActive(x));
    return f ? f.id : '';
  }

  /** Uložené filtry označené k zobrazení jako tlačítko (řada nad ikonami v toolbaru). */
  buttonAdvanced() {
    return this.listAdvanced().filter((f) => f.asButton);
  }

  /**
   * Uložené filtry patřící do rozbalovacího výběru v toolbaru. Položka bez volby
   * (uložená před v1.14.0) se řídí postaru: co není tlačítko, je ve výběru.
   */
  selectAdvanced() {
    return this.listAdvanced().filter((f) => (f.asSelect === undefined ? !f.asButton : !!f.asSelect));
  }

  /** Přepínač uloženého filtru (toggle): aplikuje ho, nebo zruší, když už je aktivní. */
  toggleSavedAdvanced(id) {
    const item = this.listAdvanced().find((f) => f.id === id);
    if (!item) return;
    const active = this._isSavedActive(item);
    if (this._isSnapshot(item)) {
      if (active) this.clearColumnFilters();
      else this.applyFiltersSnapshot(item);
    } else if (active) this.clearAdvanced();
    else this.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
  }

  /* ------- snímky sloupcových filtrů (uživatel „naklikal" filtry a uloží je) ------- */

  /** Porovná dvě mapy filtrů field→value nezávisle na pořadí klíčů. */
  _sameFilters(a, b) {
    const ka = Object.keys(a || {}).sort();
    const kb = Object.keys(b || {}).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }

  /** Aktivní sloupcové filtry (jen ty s neprázdnou hodnotou dle typu filtru). */
  _activeColumnFilters() {
    const out = {};
    for (const [field, value] of Object.entries(this.filters || {})) {
      const col = this.columns.find((c) => c.field === field);
      if (!col || !col.filter) continue;
      const def = getFilter(col.filter);
      if (def && !def.isEmpty(value)) out[field] = value;
    }
    return out;
  }

  /** Je aplikovaný aspoň jeden sloupcový filtr (má hodnotu)? Pro viditelnost ukládací ikony. */
  hasColumnFilters() {
    return Object.keys(this._activeColumnFilters()).length > 0;
  }

  /**
   * Sejme aktuální sloupcové filtry do přenosného snímku: hodnoty + nestandardní
   * typy filtru u dotčených sloupců (aby po načtení fungoval např. přepnutý „Dynamické").
   * Vrací null, když žádný sloupcový filtr není aktivní.
   */
  _captureColumnFilters() {
    const filters = this._activeColumnFilters();
    if (!Object.keys(filters).length) return null;
    const filterTypes = {};
    for (const c of this.columns) {
      if (c.field in filters && c.filter !== c.defaultFilter) filterTypes[c.field] = c.filter;
    }
    return { filters: JSON.parse(JSON.stringify(filters)), filterTypes };
  }

  /** Uloží aktuální sloupcové filtry pod názvem (local/global, volitelně jako tlačítko). */
  saveFilterSnapshot(name, scope = 'local', display = false) {
    const snap = this._captureColumnFilters();
    if (!snap) return null;
    return this._saveNamedFilter(name, scope, display, {
      kind: 'columns', filters: snap.filters, filterTypes: snap.filterTypes,
    });
  }

  /* ------- úprava uloženého filtru (přepsání hodnot, přejmenování) ------- */

  /**
   * Přepíše uložený snímek **aktuálními** sloupcovými filtry z hlavičky. Uživatel si
   * filtry přenastaví v tabulce, otevře panel uložených filtrů a u položky klikne na
   * disketu. Zůstává `id`, název, rozsah i volby zobrazení. Vrací `null`, když není
   * co uložit (žádný aktivní sloupcový filtr) nebo položka není snímek. `@v1.14.0`
   */
  overwriteSavedFilter(id) {
    const item = this.listAdvanced().find((f) => f.id === id);
    if (!item || item.kind !== 'columns' || !this.hasColumnFilters()) return null;
    return this.saveFilterSnapshot(item.name, item.scope || 'local', {
      button: !!item.asButton,
      select: item.asSelect === undefined ? !item.asButton : !!item.asSelect,
    });
  }

  /**
   * Přejmenuje uložený filtr (snímek i strom) — mění jen název, `id` a obsah zůstávají.
   * Případná jiná položka téhož názvu ustoupí, ať nevznikne dvojice. `@v1.14.0`
   */
  renameSavedFilter(id, name) {
    const nm = String(name || '').trim();
    if (!nm) return null;
    const g = this.globalAdvanced.find((f) => f.id === id);
    const target = g || (this.state.advancedFilters || []).find((f) => f.id === id);
    if (!target || target.name === nm) return null;
    if (g) this.globalAdvanced = this.globalAdvanced.filter((f) => f.id === id || f.name !== nm);
    else this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.id === id || f.name !== nm);
    target.name = nm;
    if (g) {
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === 'function') { const { scope, ...core } = target; cb({ ...core }); }
    } else {
      this.store.save(this.state);
    }
    this.renderer.renderToolbar();
    return target;
  }

  /** Obnoví uložený snímek sloupcových filtrů zpět do políček hlavičky a přefiltruje. */
  applyFiltersSnapshot(snap) {
    if (!snap || !snap.filters) return;
    this._clearActivePreset();
    const types = snap.filterTypes || {};
    // u dotčených sloupců obnov typ filtru (odchylka nebo výchozí), ať sedí tvar hodnoty
    for (const c of this.columns) {
      if (!(c.field in snap.filters)) continue;
      const t = types[c.field];
      c.filter = (t && c.availableFilters && c.availableFilters.includes(t)) ? t : c.defaultFilter;
    }
    this.filters = JSON.parse(JSON.stringify(snap.filters));
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader(); // políčka filtrů zobrazí obnovené hodnoty
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
  }

  /** Zruší jen sloupcové filtry (univerzální/rozšířený/quickSearch nechá být). */
  clearColumnFilters() {
    if (!Object.keys(this.filters).length) return;
    this._clearActivePreset();
    this.filters = {};
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
  }

  /* =================== stránkování =================== */

  setPage(page) {
    const p = Math.min(Math.max(1, page), this.lastPage || 1);
    if (p === this.page) return;
    this.page = p;
    this.refresh();
    this._emitPageChange();
  }

  setPageSize(size) {
    this.pageSize = size;
    this.instance.pageSize = size;
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitPageChange();
  }

  /* =================== sloupce =================== */

  /**
   * Přesune sloupec `field` před/za `targetField`. Při seskupení platí omezení:
   * sloupec ve skupině se smí přesouvat JEN v rámci téže skupiny; neseskupený
   * sloupec se přesouvá na úrovni top-level položek (před/za celou skupinu nebo
   * jiný neseskupený sloupec) — skupiny se tak nikdy nerozpadnou.
   */
  moveColumn(field, targetField, position = 'before') {
    this._clearActivePreset();
    const moved = this.columns.find((c) => c.field === field);
    const toCol = this.columns.find((c) => c.field === targetField);
    if (!moved || !toCol || field === targetField) return;

    const gMoved = moved.group || null;
    const gTarget = toCol.group || null;

    if (gMoved) {
      if (gTarget !== gMoved) return; // mimo skupinu nelze
      this._spliceMove(field, targetField, position);
    } else {
      this._moveTopLevel([field], targetField, position);
    }
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout('move', { field, targetField, position });
  }

  /** Přesune celou skupinu `groupTitle` před/za top-level položku s `targetField`. */
  moveGroup(groupTitle, targetField, position = 'before') {
    this._clearActivePreset();
    const fields = this.columns.filter((c) => c.group === groupTitle).map((c) => c.field);
    const target = this.columns.find((c) => c.field === targetField);
    if (!fields.length || !target || target.group === groupTitle) return;
    this._moveTopLevel(fields, targetField, position);
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout('moveGroup', { group: groupTitle, targetField, position });
  }

  /** Přesune sloupec v ploché řadě (v rámci skupiny). */
  _spliceMove(field, targetField, position) {
    const cols = this.columns;
    const from = cols.findIndex((c) => c.field === field);
    const [m] = cols.splice(from, 1);
    let to = cols.findIndex((c) => c.field === targetField);
    if (to === -1) { cols.splice(from, 0, m); return; }
    if (position === 'after') to += 1;
    cols.splice(to, 0, m);
  }

  /** Přesune blok sloupců (skupinu / neseskupený sloupec) před/za top-level položku cíle. */
  _moveTopLevel(fields, targetField, position) {
    const set = new Set(fields);
    const block = this.columns.filter((c) => set.has(c.field));
    const rest = this.columns.filter((c) => !set.has(c.field));
    const target = rest.find((c) => c.field === targetField);
    if (!target) return; // cíl byl uvnitř přesouvaného bloku
    const gTarget = target.group || null;

    let idx;
    if (gTarget) {
      // vlož před/za celou cílovou skupinu
      const first = rest.findIndex((c) => c.group === gTarget);
      let last = first;
      while (last + 1 < rest.length && rest[last + 1].group === gTarget) last++;
      idx = position === 'after' ? last + 1 : first;
    } else {
      const tIdx = rest.findIndex((c) => c.field === targetField);
      idx = position === 'after' ? tIdx + 1 : tIdx;
    }
    rest.splice(idx, 0, ...block);
    this.columns = rest;
  }

  setColumnVisible(field, visible) {
    this._clearActivePreset();
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.visible = !!visible;
    this.saveState();
    this.rerenderColumns();
    this.gear?.refresh(); // sync checkboxu v panelu (klik na název sloupce ho jinak nechá viset)
    this._emitColumnLayout('visibility', { field, visible: col.visible });
  }

  setColumnWidth(field, width) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.width = Math.max(col.minWidth, width);
    this._clearActivePreset();
    this.saveState();
    this.renderer.applyLayout();
    this._emitColumnLayout('resize', { field, width: col.width });
  }

  /** frozen: true|'left' = vlevo, 'right' = vpravo, false = neukotveno. */
  setColumnFrozen(field, frozen) {
    this._clearActivePreset();
    const col = this.columns.find((c) => c.field === field);
    if (!col || col.frozenAllowed === false) return;
    col.frozen = frozen === 'left' ? true : frozen;
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout('frozen', { field, frozen: col.frozen });
  }

  /**
   * Přepne typ filtru sloupce (např. number ↔ number-range). Hodnota filtru se
   * vyčistí (tvary se mezi typy liší) a přepočítají se data.
   */
  setColumnFilterType(field, filterType) {
    const col = this.columns.find((c) => c.field === field);
    if (!col || !col.availableFilters.includes(filterType)) return;
    if (col.filter === filterType) return;
    this._clearActivePreset();
    col.filter = filterType;
    const had = field in this.filters;
    delete this.filters[field]; // hodnota starého typu už nedává smysl
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.refresh();
    if (had) this._emitFilter();
  }

  /** Nastaví souhrnné funkce sloupce (pole, např. ['sum','avg']). */
  setColumnSummary(field, summary) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.summary = Array.isArray(summary) ? summary : [];
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }

  /** Přejmenuje sloupec (titulek). Prázdný název vrátí výchozí z definice. */
  setColumnTitle(field, title) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    const v = String(title == null ? '' : title).trim();
    col.title = v || col.defaultTitle;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /** Barva záhlaví SLOUPCE (pozadí + písmo); prázdné hodnoty barvu zruší. */
  setColumnHeaderColor(field, { background, color } = {}) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.headerBackground = background || null;
    col.headerColor = color || null;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /** Barva záhlaví celé SKUPINY sloupců (nastaví se na všechny její členy). */
  setColGroupHeaderColor(title, { background, color } = {}) {
    if (!title) return;
    let any = false;
    for (const c of this.columns) {
      if (c.group === title) { c.groupHeaderBackground = background || null; c.groupHeaderColor = color || null; any = true; }
    }
    if (!any) return;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /**
   * Formát BUŇKY sloupce (vzhled těla: zarovnání, tučné/kurzíva/podtržení/
   * přeškrtnutí, barva písma/pozadí). `patch` se sloučí; `null` formát zruší.
   */
  setColumnCellFormat(field, patch) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    if (patch === null) col.cellFormat = null;
    else {
      const next = Object.assign({}, col.cellFormat, patch);
      // Prázdný objekt (žádná aktivní vlastnost) → null, ať se nepersistuje zbytečně.
      const hasAny = Object.keys(next).some((k) => next[k]);
      col.cellFormat = hasAny ? next : null;
    }
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }

  /**
   * Vzorec pro souhrnný ŘÁDEK sloupce (vážený / poolovaný souhrn z agregací
   * jiných sloupců — viz core/formula.js). `formula` null/'' vzorec zruší.
   * @throws {FormulaError} když je vzorec neplatný.
   */
  setColumnSummaryFormula(field, formula, label) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    const src = String(formula == null ? '' : formula).trim();
    if (src) {
      const chk = validateAggregate(src);
      if (!chk.ok) throw new FormulaError(chk.error);
    }
    col.summaryFormula = src || null;
    // Název řádku (vlevo) — jen když je vzorec; jinak se zruší i popisek.
    if (label !== undefined) col.summaryFormulaLabel = src ? (String(label).trim() || null) : null;
    else if (!src) col.summaryFormulaLabel = null;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }

  /* =================== formát zobrazení (číslo/měna/datum) =================== */

  /**
   * Efektivní formát sloupce: výchozí < globální (instance) < def.formatterParams
   * < výjimka sloupce (col.format). Vrací null pro typy bez formátování.
   */
  effectiveFormat(col) {
    const kind = formatKind(col.type);
    if (!kind) return null;
    const keys = formatKeys(kind);
    const pick = (o) => { const r = {}; if (o) for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
    const global = this.instance.format && this.instance.format[kind];
    const localeBase = (kind === 'number' || kind === 'money') && this.instance.locale ? { locale: this.instance.locale } : {};
    // Priorita (nízká→vysoká): výchozí < locale < def.formatterParams (výchozí
    // sloupce) < globální nastavení tabulky < výjimka sloupce (col.format / def.format).
    return { kind, ...DEFAULT_FORMATS[kind], ...localeBase, ...pick(col.formatterParams), ...pick(global), ...pick(col.format) };
  }

  /** Efektivní globální formát druhu (výchozí + instance override) — pro UI nastavení. */
  effectiveFormatFor(kind) {
    const keys = formatKeys(kind);
    const pick = (o) => { const r = {}; if (o) for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
    return { ...DEFAULT_FORMATS[kind], ...pick(this.instance.format && this.instance.format[kind]) };
  }

  /** Globální formát pro druh (number/money/date/datetime/time) — sloučí patch. */
  setFormat(kind, patch) {
    const fmt = Object.assign({}, this.instance.format);
    fmt[kind] = Object.assign({}, fmt[kind], patch);
    this.instance.format = fmt;
    this.saveState();
    this.renderer.renderBody();
  }

  /**
   * Automatické prahy pro barevnou škálu (levels-1 hodnot rovnoměrně mezi min/max
   * sloupce nad aktuálně filtrovanou sadou).
   */
  autoThresholds(field, levels) {
    const rows = (this.dataSource && this.dataSource.allRows) ? this.dataSource.allRows() : (this.rows || []);
    let min = Infinity, max = -Infinity;
    for (const r of rows) {
      const n = Number(String(r[field] ?? '').replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(n)) { if (n < min) min = n; if (n > max) max = n; }
    }
    if (!Number.isFinite(min) || min === max) return [];
    const th = [];
    for (let k = 1; k < levels; k++) th.push(Math.round(min + (max - min) * k / levels));
    return th;
  }

  /** Podmíněná barevná škála sloupce (semafor); patch=null ji zruší. */
  setColumnCondFormat(field, patch) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    if (patch === null) col.condFormat = null;
    else {
      const cur = col.condFormat || { on: false, levels: 3, reverse: false, thresholds: null };
      const next = Object.assign({}, cur, patch);
      // Při zapnutí bez prahů dopočítat automatické.
      if (next.on && (!Array.isArray(next.thresholds) || next.thresholds.length !== next.levels - 1)) {
        next.thresholds = this.autoThresholds(field, next.levels);
      }
      col.condFormat = next;
    }
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }

  /** Výjimka formátu jednoho sloupce; patch=null zruší výjimku (řídí se globálem). */
  setColumnFormat(field, patch) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.format = patch === null ? null : Object.assign({}, col.format, patch);
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }

  /** Zapojení sloupce do souhrnu ŘÁDKŮ (pravý sloupec) — pole funkcí. */
  setColumnRowSummary(field, fns) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.rowSummary = Array.isArray(fns) ? fns : [];
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();  // přibývá/ubývá pravý sloupec → přestav i hlavičku
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /** Zdroj řádků pro souhrn dle rozsahu: 'all' = celá filtrovaná sada, jinak stránka. */
  summarySource(scope) {
    if (scope === 'all' && typeof this.dataSource.allRows === 'function') return this.dataSource.allRows();
    return this.rows;
  }

  /** Přepne rozsah souhrnu přímo z řádku (stránka ↔ všechny záznamy). */
  toggleSummaryScope() {
    this.instance.summaryRow = this.instance.summaryRow === 'all' ? 'page' : 'all';
    this.saveState();
    this.renderer.renderBody();
  }

  /** Otočení hlavičky sloupce: null = podle tabulky | 'none' | '90' | '270'. */
  setColumnHeaderRotate(field, rotate) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.headerRotate = rotate || null;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /** Zapne/vypne zobrazení filtru u konkrétního sloupce. */
  setColumnFilterEnabled(field, enabled) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    col.filterEnabled = !!enabled;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }

  /**
   * Přiřadí sloupec do skupiny (nebo ho ze skupiny vyjme, group=null).
   * Po změně srovná pořadí tak, aby skupiny zůstaly celistvé (souvislé).
   */
  setColumnGroup(field, group) {
    const col = this.columns.find((c) => c.field === field);
    if (!col) return;
    this._clearActivePreset();
    col.group = group || null;
    this._normalizeGroups();
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout('group', { field, group: col.group });
  }

  /** Rozpustí celou skupinu — všechny její sloupce se vrátí na neseskupenou úroveň. */
  ungroup(groupTitle) {
    if (!groupTitle) return;
    let changed = false;
    for (const c of this.columns) if (c.group === groupTitle) { c.group = null; changed = true; }
    if (!changed) return;
    this.colGroupsCollapsed.delete(groupTitle); // rozpuštěná skupina už nemá co sbalovat
    this._clearActivePreset();
    this._normalizeGroups();
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout('ungroup', { group: groupTitle });
  }

  /** Seznam existujících skupin v pořadí prvního výskytu. */
  groupNames() {
    const out = [];
    for (const c of this.columns) {
      if (c.group && !out.includes(c.group)) out.push(c.group);
    }
    return out;
  }

  /** Srovná sloupce tak, aby členové každé skupiny byli souvislí (u prvního výskytu). */
  _normalizeGroups() {
    const seen = new Set();
    const out = [];
    for (const col of this.columns) {
      const g = col.group || null;
      if (g === null) { out.push(col); continue; }
      if (seen.has(g)) continue;
      seen.add(g);
      for (const c of this.columns) if ((c.group || null) === g) out.push(c);
    }
    this.columns = out;
  }

  /** Přizpůsobí šířku všech viditelných sloupců nejširšímu obsahu (auto-fit). */
  autoFitColumns() {
    for (const col of this.columns) {
      if (!col.visible) continue;
      const w = measureColumnWidth(col, this);
      if (w) col.width = w;
    }
    this._clearActivePreset();
    this.saveState();
    this.renderer.applyLayout();
  }

  /**
   * Zahodí uživatelské úpravy sloupců a vrátí výchozí (z definice). Vrací i
   * volby, které se zapínají v tomtéž dialogu a sloupce přeskupují — tedy
   * **seskupení řádků** (seskupený sloupec se kvůli němu stěhuje dopředu
   * a ukotvuje, bez resetu by ho „Obnovit výchozí" neumělo srovnat). Zbytek
   * nastavení tabulky (motiv, stránkování, souhrnný řádek…) patří do „Nastavení
   * tabulky", na ten tenhle reset nesahá.
   */
  resetColumns() {
    this._clearActivePreset();
    this.columns = buildColumns(this.columnDefs || [], []);
    this.state.columns = [];
    const base = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance);
    for (const k of COLUMN_INSTANCE_KEYS) this.instance[k] = base[k];
    this.groupsCollapsed.clear();    // sbalené skupiny řádků patřily starému seskupení
    this.colGroupsCollapsed.clear(); // i sbalené skupiny sloupců jsou stav sloupců
    this.saveState();
    this.rerenderColumns();
  }

  /**
   * Vymění definici sloupců za běhu (např. po importu s autoColumns). Ve výchozím
   * stavu zahodí persistovaný stav sloupců (nová struktura = nová sada).
   */
  setColumns(defs, { keepState = false } = {}) {
    this._clearActivePreset();
    this.columnDefs = Array.isArray(defs) ? defs : [];
    this.columns = buildColumns(this.columnDefs, keepState ? this.state.columns : []);
    if (!keepState) this.state.columns = [];
    this.saveState();
    this.rerenderColumns();
  }

  /* =================== počítané sloupce (vzorec z UI) =================== */

  /**
   * Přidá počítaný sloupec definovaný vzorcem. Hodnota se počítá z ostatních
   * sloupců (viz src/core/formula.js). Počítané sloupce jsou jen ke čtení a
   * persistují se (localStorage i presety). Vrací `field` nového sloupce.
   * @throws {FormulaError} když je vzorec neplatný.
   */
  addComputedColumn({ title, type = 'number', formula } = {}) {
    const src = String(formula == null ? '' : formula).trim();
    if (!src) throw new FormulaError('Prázdný vzorec');
    const chk = validateFormula(src);
    if (!chk.ok) throw new FormulaError(chk.error);
    const field = this._uniqueComputedField();
    const def = {
      field,
      title: (title != null && String(title).trim()) ? String(title).trim() : this.i18n.t('calc.defaultTitle'),
      type: type || 'text',
      computed: true,
      formula: src,
    };
    this.columns.push(resolveColumn(def, null));
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
    return field;
  }

  /**
   * Upraví existující počítaný sloupec (název / typ / vzorec). Zachová
   * uživatelský stav sloupce (šířka, viditelnost, souhrny, formát, pořadí).
   * @throws {FormulaError} když je nový vzorec neplatný.
   */
  updateComputedColumn(field, { title, type, formula } = {}) {
    const idx = this.columns.findIndex((c) => c.field === field);
    if (idx < 0 || this.columns[idx].formula == null) return;
    const old = this.columns[idx];
    const src = formula != null ? String(formula).trim() : old.formula;
    const chk = validateFormula(src);
    if (!chk.ok) throw new FormulaError(chk.error);
    const def = {
      field,
      title: (title != null && String(title).trim()) ? String(title).trim() : old.title,
      type: type || old.type,
      computed: true,
      formula: src,
    };
    // Zachovat persistovaný stav sloupce (serializace jednoho sloupce → resolve).
    this.columns[idx] = resolveColumn(def, serializeColumns([old])[0]);
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
  }

  /** Odebere počítaný sloupec (jen sloupce vytvořené vzorcem lze smazat). */
  removeComputedColumn(field) {
    const idx = this.columns.findIndex((c) => c.field === field);
    if (idx < 0 || this.columns[idx].formula == null) return;
    this.columns.splice(idx, 1);
    delete this.filters[field];
    this.sort = this.sort.filter((s) => s.field !== field);
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
  }

  /** Vygeneruje neobsazený `field` pro počítaný sloupec (calc1, calc2, …). */
  _uniqueComputedField() {
    const used = new Set(this.columns.map((c) => c.field));
    let n = 1, f;
    do { f = 'calc' + n++; } while (used.has(f));
    return f;
  }

  /* =================== import dat / souboru =================== */

  /**
   * Nahraje řádky za běhu. Když je zapnuté autoColumns, přegeneruje sloupce
   * podle nové struktury dat. Zdrojově agnostické (data odkudkoli).
   */
  importRows(rows) {
    rows = Array.isArray(rows) ? rows : [];
    if (this.autoColumns) this.setColumns(deriveColumns(rows));
    this.setData(rows);
    return rows.length;
  }

  /** Načte a rozparsuje lokální soubor (CSV/JSON) a nahraje ho do gridu. */
  async importFile(file) {
    const { rows, format } = await parseFile(file);
    this.importRows(rows);
    return { count: rows.length, format };
  }

  /**
   * Nahraje data z HTML `<table>`. Zdroj může být přímo table element, nebo
   * HTML string + index tabulky na stránce. Sloupce se odvodí z hlaviček
   * (název sloupce = text `<th>`), typy ze vzorku hodnot.
   */
  importHTMLTable(source, index = 0) {
    const parsed = (source && source.tagName === 'TABLE') ? tableToRows(source) : parseHTMLTable(source, index);
    const { rows, fields, titles } = parsed;
    this.autoColumns = true;
    this.setColumns(columnsFor(fields, rows, titles));
    this.setData(rows);
    return rows.length;
  }

  /** Nahraje data z XML (ATOM/RSS/obecné) — automaticky najde záznamový element. */
  importXML(text, opts = {}) {
    const { rows, fields, titles } = parseXML(text, opts);
    this.autoColumns = true;
    this.setColumns(columnsFor(fields, rows, titles));
    this.setData(rows);
    return rows.length;
  }

  /**
   * Načte stránku/feed z URL a zobrazí ji: HTML → N-tá `<table>`, XML/ATOM/RSS
   * → záznamy. Formát se rozpozná z obsahu (nebo vynuť `format: 'html'|'xml'`).
   * Kvůli CORS je v prohlížeči třeba stejný origin nebo proxy — předej
   * `proxy(url)→url` (v EverFLOW by to byl backend endpoint).
   * @returns {Promise<{count:number, format:'html'|'xml'}>}
   */
  async importFromUrl(url, index = 0, { proxy, format } = {}) {
    const res = await fetch(proxy ? proxy(url) : url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    const isXML = format === 'xml' || (format !== 'html' && (/xml|atom|rss/i.test(ct) || /^\s*<(\?xml|feed|rss)\b/i.test(text)));
    const count = isXML ? this.importXML(text) : this.importHTMLTable(text, index);
    return { count, format: isXML ? 'xml' : 'html' };
  }

  /* =================== export / stažení =================== */

  /** Sloupce pro export (viditelné, s field+title). Přepsatelné opts.columns. */
  exportColumns() {
    return this.columns.filter((c) => c.visible).map((c) => ({ field: c.field, title: c.title }));
  }

  /**
   * Řádky pro export — client: celá filtrovaná+seřazená sada (i mimo stránku);
   * server: aktuálně načtená stránka (server nemá všechna data v paměti).
   */
  exportRows() {
    return (this.dataSource.allRows && this.dataSource.allRows()) || this.rows || [];
  }

  /**
   * Sestaví obsah exportu jako string. `format`: 'csv'|'tsv'|'json'|'xml'.
   * `opts`: { delimiter, header, columns, rows }.
   */
  exportData(format = 'csv', opts = {}) {
    const rows = opts.rows || this.exportRows();
    const cols = opts.columns || this.exportColumns();
    return buildExport(format, rows, cols, opts);
  }

  /** Vytiskne tabulku (viditelné sloupce + aktuální filtrovaná data). */
  print(opts = {}) {
    const cols = opts.columns || this.exportColumns();
    const rows = opts.rows || this.exportRows();
    printTable(opts.title != null ? opts.title : (this.options.printTitle || ''), cols, rows, opts);
  }

  /** Stáhne data jako soubor. Vrací i obsah (string). */
  download(format = 'csv', opts = {}) {
    const content = this.exportData(format, opts);
    const meta = EXPORT_META[String(format).toLowerCase()] || EXPORT_META.csv;
    const name = (opts.filename || this.options.id || 'export') + '.' + meta.ext;
    downloadFile(content, name, meta.mime);
    return content;
  }

  /* =================== granulární změny řádků =================== */

  /** Zdroj dat pro mutace — jen client-side (ne server, ne tree). */
  _mutableSource() {
    if (this.tree) { console.warn('[Lattice] addRow/updateRow/deleteRow nejsou v tree režimu podporované.'); return null; }
    if (!(this.dataSource instanceof ClientData)) { console.warn('[Lattice] granulární změny řádků fungují jen v client-side režimu.'); return null; }
    return this.dataSource;
  }

  /** Sjednocený event „knihovna změnila data" (add|update|delete). */
  _emitDataChange(action, rows) {
    if (this.options.onDataChange) this.options.onDataChange(action, rows);
  }

  /** Zaznamená úpravu buňky do historie (volá inline editace i vložení rozsahu). */
  recordEdit(row, field, oldValue, newValue) {
    this.history?.record({ type: 'edit', row, before: { [field]: oldValue }, after: { [field]: newValue } });
  }

  undo() { this.history?.undo(); }
  redo() { this.history?.redo(); }
  clearHistory() { this.history?.clear(); }

  /** Spustí inline editaci konkrétní buňky (např. z cell menu „Editovat zde"). */
  editCell(rowIndex, field) {
    const col = this.columns.find((c) => c.field === field);
    const rowData = this.rows[rowIndex];
    if (!col || !rowData || !this.editManager.editable(col)) return false;
    const cell = this.renderer.nodes.body.querySelector('.lattice-row[data-index="' + rowIndex + '"] .lattice-cell[data-field="' + field + '"]');
    if (!cell) return false;
    this.editManager.start(cell, col, rowData, rowIndex);
    return true;
  }

  /** Přidá řádek (na konec, nebo na začátek při atStart=true) a překreslí. */
  addRow(row, atStart = false) {
    const src = this._mutableSource();
    if (!src) return null;
    src.addRow(row, atStart);
    this.refresh();
    this.history?.record({ type: 'add', row, atStart });
    this._emitDataChange('add', [row]);
    return row;
  }

  /** Upraví řádek podle klíče (keyField) sloučením patch. Vrátí řádek nebo null. */
  updateRow(key, patch) {
    const src = this._mutableSource();
    if (!src) return null;
    const existing = src.data.find((r) => this.rowKey(r) === String(key));
    const before = {}, after = {};
    if (existing) for (const f in patch) if (f !== this.keyField) { before[f] = existing[f]; after[f] = patch[f]; }
    const row = src.updateRow(this.keyField, key, patch);
    this.refresh();
    if (row) { this.history?.record({ type: 'edit', row, before, after }); this._emitDataChange('update', [row]); }
    return row;
  }

  /** Smaže řádek podle klíče. Vrátí true, když se něco smazalo. */
  deleteRow(key) {
    const src = this._mutableSource();
    if (!src) return false;
    const index = src.data.findIndex((r) => this.rowKey(r) === String(key)); // pozice pro undo
    const row = index >= 0 ? src.data[index] : null;
    const ok = src.deleteRow(this.keyField, key);
    this.refresh();
    if (ok) { if (row) this.history?.record({ type: 'delete', row, index }); this._emitDataChange('delete', [{ [this.keyField]: key }]); }
    return ok;
  }

  /** Hromadně smaže řádky dle klíčů (jeden onDataChange). Vrátí počet smazaných. */
  deleteRows(keys) {
    const src = this._mutableSource();
    if (!src) return 0;
    const removed = [], entries = [];
    for (const k of (Array.isArray(keys) ? keys : [keys])) {
      const index = src.data.findIndex((r) => this.rowKey(r) === String(k)); // pozice pro undo
      const row = index >= 0 ? src.data[index] : null;
      if (src.deleteRow(this.keyField, k)) { removed.push({ [this.keyField]: k }); if (row) entries.push({ type: 'delete', row, index }); }
    }
    this.refresh();
    if (removed.length) { if (entries.length) this.history?.record({ type: 'batch', entries }); this._emitDataChange('delete', removed); }
    return removed.length;
  }

  /** Hromadná změna: upsert řádků dle keyField. Vrátí dotčené řádky. */
  updateData(rows) {
    const src = this._mutableSource();
    if (!src) return [];
    const incoming = Array.isArray(rows) ? rows : [rows];
    let entries = null;
    if (this.history && !this._replayingHistory) {
      entries = incoming.map((inc) => {
        const existing = src.data.find((r) => this.rowKey(r) === String(inc[this.keyField]));
        if (!existing) return { type: 'add', row: inc };
        const before = {}, after = {};
        for (const f in inc) if (f !== this.keyField) { before[f] = existing[f]; after[f] = inc[f]; }
        return { type: 'edit', row: existing, before, after };
      });
    }
    const changed = src.upsertMany(this.keyField, incoming);
    this.refresh();
    if (entries && entries.length) this.history?.record({ type: 'batch', entries });
    this._emitDataChange('update', changed);
    return changed;
  }

  /* =================== přesouvání řádků (drag reorder) =================== */

  isMovable() { return this.movable; }

  /** Má grid definované řádkové akce (options.actions)? */
  hasActions() { return Array.isArray(this.options.actions) && this.options.actions.length > 0; }

  /**
   * Přesune řádek (index v aktuálně zobrazených this.rows) k cílovému řádku.
   * zone: 'before' | 'after' | 'inside' (inside = jako potomek; jen ve stromu).
   * Ve stromu deleguje na TreeManager, jinak na plochý reorder. Po přesunu
   * překreslí a zavolá options.onRowMove(result) s tím, co má aplikace uložit.
   */
  moveRow(fromIndex, toIndex, zone) {
    const dragRow = this.rows[fromIndex];
    const targetRow = this.rows[toIndex];
    if (!dragRow || !targetRow || dragRow === targetRow) return;
    let result = null;
    if (this.tree) {
      result = this.tree.moveNode(this.rowKey(dragRow), this.rowKey(targetRow), zone);
    } else if (this.groupActive()) {
      result = this._moveRowGrouped(dragRow, targetRow, zone);
    } else {
      const flatZone = zone === 'inside' ? 'after' : zone; // plochá data nemají hierarchii
      const changed = this.dataSource.moveRow
        ? this.dataSource.moveRow(this.keyField, this.rowKey(dragRow), this.rowKey(targetRow), flatZone, this.orderField)
        : null;
      if (changed) result = { row: dragRow, format: 'flat', toIndex, changed };
    }
    if (!result) return;
    this.refresh();
    if (this.options.onRowMove) this.options.onRowMove(result);
  }

  /**
   * Přesun v seskupeném zobrazení: řádek přebere skupinové hodnoty cílového
   * řádku (přesune se do jeho skupiny) a přeuspořádá se vedle něj.
   */
  _moveRowGrouped(dragRow, targetRow, zone) {
    const fields = this.groupFields();
    const groupChanged = fields.some((f) => dragRow[f] !== targetRow[f]);
    for (const f of fields) dragRow[f] = targetRow[f]; // přebere celou skupinovou cestu
    const flatZone = zone === 'inside' ? 'after' : zone;
    const changed = this.dataSource.moveRow
      ? this.dataSource.moveRow(this.keyField, this.rowKey(dragRow), this.rowKey(targetRow), flatZone, this.orderField)
      : [dragRow];
    const set = new Set(changed || []);
    set.add(dragRow);
    return { row: dragRow, format: 'group', groupBy: fields.slice(), groupChanged, changed: [...set] };
  }

  /**
   * Přesun řádku na HLAVIČKU skupiny → řádek přebere skupinové hodnoty té
   * skupiny (node.path). Volá se z drop handleru hlavičky skupiny.
   */
  moveRowToGroupHeader(fromIndex, node) {
    const dragRow = this.rows[fromIndex];
    if (!dragRow || !node || !Array.isArray(node.path)) return;
    let groupChanged = false;
    for (const { field, value } of node.path) {
      if (dragRow[field] !== value) { dragRow[field] = value; groupChanged = true; }
    }
    this.refresh();
    if (this.options.onRowMove) {
      this.options.onRowMove({ row: dragRow, format: 'group', groupBy: this.groupFields(), groupChanged, changed: [dragRow] });
    }
  }

  /**
   * Přijme řádek přetažený z JINÉ tabulky (payload = { src, key, row }). Default
   * 'move' přidá řádek sem a odebere ho ze zdroje; 'copy' zdroj nechá. Aplikace
   * může reagovat přes onRowReceive(row, { fromId, key, mode }).
   */
  receiveExternalRow(payload) {
    if (!this.acceptExternalRows || !payload || !payload.row) return;
    const mode = this.acceptExternalRows === 'copy' ? 'copy' : 'move';
    const source = INSTANCES.get(payload.src);
    this.addRow(payload.row);
    if (mode === 'move' && source && source !== this) source.deleteRow(payload.key);
    if (this.options.onRowReceive) this.options.onRowReceive(payload.row, { fromId: payload.src, key: payload.key, mode });
  }

  /* =================== výběr řádků (selection) =================== */

  isSelectable() { return this.selectable.enabled; }

  /** Klíč řádku (keyField, jako string) — používá se pro výběr i mutace. */
  rowKey(row) { return row == null ? '' : String(row[this.keyField]); }

  /** Je řádek (objekt nebo klíč) vybraný? */
  isSelected(row) {
    return this.selected.has(typeof row === 'object' && row !== null ? this.rowKey(row) : String(row));
  }

  /** Nastaví výběr jednoho řádku (respektuje single/max). */
  setRowSelected(key, on) {
    key = String(key);
    if (on) {
      if (this.selectable.mode === 'single') this.selected.clear();
      if (this.selectable.max && !this.selected.has(key) && this.selected.size >= this.selectable.max) {
        this.selected.delete(this.selected.values().next().value); // překročen limit → odeber nejstarší
      }
      this.selected.add(key);
    } else {
      this.selected.delete(key);
    }
    this._afterSelectionChange();
  }

  toggleRow(key) { this.setRowSelected(key, !this.selected.has(String(key))); }

  /** Hromadně nastaví výběr sady klíčů (pro shift-výběr rozsahu). */
  selectKeys(keys, on) {
    for (const k of keys) { if (on) this.selected.add(String(k)); else this.selected.delete(String(k)); }
    this._afterSelectionChange();
  }

  /**
   * Rozsah výběru — 'page' (aktuální stránka) nebo 'all' (všechny filtrované
   * záznamy). Horní checkbox i invertování se vztahují právě na tento rozsah.
   */
  setSelectScope(scope) {
    this.selectScope = scope === 'all' ? 'all' : 'page';
    this.renderer.updateSelectAllCheckbox();
  }

  /** Řádky aktuálního rozsahu (stránka nebo všechny filtrované). */
  scopeRows() {
    if (this.selectScope === 'all') return (this.dataSource.allRows && this.dataSource.allRows()) || this.rows;
    return this.rows || [];
  }

  /** Počet řádků odpovídajících filtru (pro popisek „všechny záznamy (N)"). */
  filteredCount() {
    const rows = (this.dataSource.allRows && this.dataSource.allRows()) || this.rows;
    return rows.length;
  }

  /** Jsou vybrané všechny řádky aktuálního rozsahu? */
  isScopeAllSelected() {
    const rows = this.scopeRows();
    return rows.length > 0 && rows.every((r) => this.selected.has(this.rowKey(r)));
  }

  /** Vybere / odznačí celý aktuální rozsah (dle isScopeAllSelected). */
  toggleScopeSelection() {
    const rows = this.scopeRows();
    const on = !this.isScopeAllSelected();
    for (const r of rows) { const k = this.rowKey(r); if (on) this.selected.add(k); else this.selected.delete(k); }
    this._afterSelectionChange();
  }

  /** Invertuje výběr v rámci aktuálního rozsahu (stránka nebo vše). */
  invertSelection() {
    for (const r of this.scopeRows()) {
      const k = this.rowKey(r);
      if (this.selected.has(k)) this.selected.delete(k); else this.selected.add(k);
    }
    this._afterSelectionChange();
  }

  clearSelection() { this.selected.clear(); this._afterSelectionChange(); }

  /** Vybere všechny filtrované záznamy (bez ohledu na rozsah) — convenience API. */
  selectAll() {
    for (const r of ((this.dataSource.allRows && this.dataSource.allRows()) || this.rows)) this.selected.add(this.rowKey(r));
    this._afterSelectionChange();
  }

  getSelectedKeys() { return [...this.selected]; }

  /** Vybrané řádky jako objekty (z client dat, jinak z aktuální stránky). */
  getSelectedRows() {
    const src = this.dataSource.data || this.rows || [];
    return src.filter((r) => this.selected.has(this.rowKey(r)));
  }

  _afterSelectionChange() {
    this.renderer.updateSelectionUI();
    if (this.options.onSelectionChange) this.options.onSelectionChange(this.getSelectedRows(), this.getSelectedKeys());
  }

  /**
   * Serverové request parametry, které by grid právě teď poslal (sort/filter/search/advanced
   * dle `ajax.paramNames`, s rozvinutými relativními datovými tokeny). Pro vlastní endpointy
   * aplikace (např. „ID všech filtrovaných řádků" napříč stránkami, nebo export) — týž filtr
   * bez ruční duplikace serializace. Respektuje i `ajax.requestBuilder`.
   * Jen v server-side režimu; client-side vrací `{}`.
   * @param {{paginate?: boolean}} [opts] `paginate:true` přidá i `page`/`size` (default `false` = bez stránkování → „vše filtrované").
   * @returns {object}
   */
  getServerParams({ paginate = false } = {}) {
    if (!(this.dataSource instanceof ServerData)) return {};
    const state = {
      page: this.page,
      pageSize: this.pageSize,
      paginate,
      sort: this.sort,
      filters: this.filters,
      advanced: this.advanced,
      universal: this.universalActive() ? this.universal : null,
      search: this.quickSearch || '',
      columns: this.columns,
    };
    const ajax = this.dataSource.ajax;
    return ajax.requestBuilder ? ajax.requestBuilder(state) : this.dataSource.buildParams(state);
  }

  /**
   * Hotový urlencoded querystring z {@link getServerParams} (bracket-formát kontraktu).
   * Rozšířený filtr `advanced` je vždy jako JSON string, takže querystring funguje i u
   * gridu s `ajax.method: 'POST'`. Připoj za `?`/`&` na vlastní GET endpoint.
   * @param {{paginate?: boolean}} [opts]
   * @returns {string}
   */
  getServerQuery(opts) {
    let params = this.getServerParams(opts);
    const advKey = (this.dataSource.names && this.dataSource.names.advanced) || 'advanced';
    if (params[advKey] && typeof params[advKey] === 'object') {
      params = { ...params, [advKey]: JSON.stringify(params[advKey]) };
    }
    return encodeParams(params).toString();
  }

  /* ---------------- zvýraznění (podbarvení) řádků ---------------- */

  /** Zvýrazněné řádky jako pole klíčů (keyField). */
  get highlightedRows() { return [...this.highlightedKeys]; }

  /** Je řádek (objekt nebo klíč) zvýrazněný? */
  isHighlighted(row) {
    return this.highlightedKeys.has(typeof row === 'object' && row !== null ? this.rowKey(row) : String(row));
  }

  /** Zapne/vypne zvýraznění jednoho řádku. Překreslí jen dotčený řádek (bez plného re-renderu). */
  highlightRow(key, on = true) {
    key = String(key);
    if (on) this.highlightedKeys.add(key); else this.highlightedKeys.delete(key);
    this._afterHighlightChange(key);
  }

  toggleRowHighlight(key) { this.highlightRow(key, !this.highlightedKeys.has(String(key))); }

  /** Zruší veškeré zvýraznění. */
  clearHighlights() {
    if (!this.highlightedKeys.size) return;
    this.highlightedKeys.clear();
    this._afterHighlightChange();
  }

  _afterHighlightChange(key) {
    this.renderer.updateHighlightUI(key);
    this.saveState();
    if (this.options.onHighlightChange) this.options.onHighlightChange(this.highlightedRows);
  }

  /** Re-render po změně sady/pořadí sloupců (data se nemění, nenačítá se znovu). */
  rerenderColumns() {
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this._scheduleSearchIndex(); // změna sloupců → přepočítej index (jiná množina polí)
  }

  /* =================== presety =================== */

  /**
   * Snapshot persistovatelného stavu (pro uložení do presetu / globálních výchozích).
   * Zachytit se dá VŠE, co si uživatel může naklikat: sloupce (pořadí, šířky,
   * souhrny, formáty, barvy záhlaví…), řazení + filtry a nastavení tabulky
   * (`instance`) — včetně seskupení řádků, souhrnného řádku a mezisoučtů skupin.
   *
   * `parts` (nepovinné) vybírá, co se do snímku dostane: `{ columns, filters,
   * instance }`. Nezadáno = všechno. Část, kterou snímek neobsahuje, se při
   * aplikaci NEMĚNÍ — tak vznikne třeba preset „jen filtry".
   */
  captureState(parts) {
    const p = presetParts(parts);
    const st = {};
    if (p.columns) st.columns = serializeColumns(this.columns);
    if (p.filters) {
      st.sort = JSON.parse(JSON.stringify(this.sort));
      st.filters = JSON.parse(JSON.stringify(this.filters));
    }
    if (p.instance) st.instance = this.captureInstance();
    return st;
  }

  /** Které části preset obsahuje (pro UI: popisek „co preset nese"). */
  presetContents(preset) {
    const st = (preset && preset.state) || {};
    return {
      columns: Array.isArray(st.columns),
      filters: Array.isArray(st.sort) || isPlainObject(st.filters),
      instance: isPlainObject(st.instance),
    };
  }

  /**
   * Snapshot nastavení tabulky. Bere celou `instance` (ať se nově přidaná volba
   * zachytí sama od sebe) kromě přechodného UI stavu, který není „nastavení“ —
   * ten by se přes preset přenášet neměl. Hloubková kopie: preset musí přežít
   * další změny živé instance (cssVars, format, scaleColors, groupBy).
   */
  captureInstance() {
    const snap = JSON.parse(JSON.stringify(this.instance));
    for (const k of TRANSIENT_INSTANCE_KEYS) delete snap[k];
    return snap;
  }

  /**
   * Nasadí snapshot nastavení do živé instance — stejný merge jako při startu
   * (výchozí ← options.instance ← snapshot), takže volba, kterou snapshot nezná,
   * spadne na výchozí hodnotu. Přechodný UI stav zůstává uživateli, jaký měl.
   */
  _applyInstanceSnapshot(snap) {
    const prev = this.instance;
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance,
      JSON.parse(JSON.stringify(snap || {})));
    for (const k of TRANSIENT_INSTANCE_KEYS) this.instance[k] = prev[k];
    // pozor: refresh()/pager čtou this.pageSize (ne this.instance.pageSize).
    this.pageSize = this.instance.pageSize;
  }

  /** Presety označené k zobrazení jako tlačítko (řada nad ikonami v toolbaru). `@v1.14.0` */
  buttonPresets() {
    return this.presets ? this.presets.buttons() : [];
  }

  /** Presety označené k zobrazení v rozbalovacím výběru v toolbaru. `@v1.14.0` */
  selectPresets() {
    return this.presets ? this.presets.selects() : [];
  }

  /** Aplikuje preset — sestaví sloupce/řazení/filtry/nastavení ze snapshotu a překreslí. */
  applyPreset(preset) {
    const st = preset && preset.state ? preset.state : {};
    // Aplikuje se jen to, co snímek OBSAHUJE. Chybějící část se nemění — ať už
    // ji uživatel při ukládání odškrtl, nebo je preset ze starší verze (ta
    // nastavení tabulky neukládala, tak mu seskupení ani motiv nepřepíšeme).
    if (Array.isArray(st.columns)) {
      // Stejný deterministický init jako při startu → konzistentní výsledek.
      this.columns = buildColumns(this.columnDefs || [], st.columns);
    }
    if (Array.isArray(st.sort)) this.sort = JSON.parse(JSON.stringify(st.sort));
    if (isPlainObject(st.filters)) this.filters = JSON.parse(JSON.stringify(st.filters));
    if (isPlainObject(st.instance)) {
      this._applyInstanceSnapshot(st.instance);
      this.renderer.applyInstanceStyles();
    }
    this.page = 1;
    this._activePresetId = preset.id;
    this.saveState();
    this.renderer.renderToolbar(); // zvýraznění tlačítka aktivního presetu
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this.refresh();
  }

  /**
   * Přepínač presetu (klik na tlačítko v rychlé řadě): neaktivní preset aplikuje,
   * u aktivního vrátí **výchozí zobrazení** — obdoba „vypnutí" u uložených filtrů.
   * `@v1.14.0`
   */
  togglePreset(preset) {
    if (!preset) return;
    if (this._activePresetId === preset.id) this.resetView();
    else this.applyPreset(preset);
  }

  /**
   * Vrátí **výchozí zobrazení**: sloupce a nastavení tabulky jako po startu bez
   * presetu (výchozí ← `options.instance`). Co si uživatel naklikal *mimo* zobrazení
   * — **filtry** (sloupcové, univerzální, rozšířený), **řazení** i rychlé hledání —
   * zůstává v platnosti. `@v1.14.0`
   */
  resetView() {
    this._activePresetId = null;
    this.columns = buildColumns(this.columnDefs || [], []);
    this.state.columns = [];
    const prev = this.instance;
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance);
    for (const k of TRANSIENT_INSTANCE_KEYS) this.instance[k] = prev[k]; // sbalený panel filtrů ap. zůstává
    this.pageSize = this.instance.pageSize;
    this.groupsCollapsed.clear();    // sbalené skupiny patřily starému seskupení
    this.colGroupsCollapsed.clear();
    this.page = 1;
    this.saveState();
    this.renderer.applyInstanceStyles();
    this.renderer.renderToolbar();
    this.rerenderColumns();
    this.refresh();
  }

  /** Zruší označení aktivního presetu (uživatel začal měnit ručně). */
  _clearActivePreset() {
    const had = this._activePresetId;
    this._activePresetId = null;
    // Zhasnout zvýraznění, jen když preset opravdu svítil jako tlačítko v toolbaru —
    // jinak by se toolbar překresloval při každé změně filtru/šířky sloupce.
    if (had && this.renderer && this.buttonPresets().some((p) => p.id === had)) this.renderer.renderToolbar();
  }

  /* =================== callbacky stavu (pro aplikaci) =================== */

  /** Řazení se změnilo → options.onSort([{field,dir}, …]). */
  _emitSort() {
    if (this.options.onSort) this.options.onSort(this.sort.map((s) => ({ ...s })));
  }

  /** Filtry se změnily → options.onFilter({filters, universal, advanced}). */
  _emitFilter() {
    this.renderer.updateFilterClearBtn(); // ukázat/skrýt mazací ikonu v záhlaví
    if (this.options.onFilter) this.options.onFilter({
      filters: JSON.parse(JSON.stringify(this.filters)),
      universal: this.universal ? { ...this.universal } : null,
      advanced: this.advanced ? JSON.parse(JSON.stringify(this.advanced)) : null,
    });
  }

  /** Stránka/velikost stránky se změnily → options.onPageChange({page,pageSize,lastPage,total}). */
  _emitPageChange() {
    if (this.options.onPageChange) this.options.onPageChange({
      page: this.page, pageSize: this.pageSize, lastPage: this.lastPage, total: this.total,
    });
  }

  /**
   * Snímek uspořádání sloupců (pro persistenci layoutu na backend). Jen reálné
   * datové sloupce (bez synthetických _move/_select/_rownum/_actions).
   */
  getColumnLayout() {
    return this.columns
      .filter((c) => !c._move && !c._select && !c._rownum && !c._actions && !c._actionsMenu)
      .map((c, i) => ({
        field: c.field, order: i,
        visible: c.visible !== false,
        width: c.width ?? null,
        frozen: c.frozen || false,
        group: c.group || null,
      }));
  }

  /** Layout sloupců se změnil → options.onColumnLayoutChange({kind, detail, columns}). */
  _emitColumnLayout(kind, detail) {
    if (this.options.onColumnLayoutChange) {
      this.options.onColumnLayoutChange({ kind, detail: detail || null, columns: this.getColumnLayout() });
    }
  }

  /* =================== instance =================== */

  setInstance(patch) {
    Object.assign(this.instance, patch);
    this.renderer.applyInstanceStyles();
    this.saveState();
    if ('filterLayout' in patch) this.renderer.renderHeader(); // přesun filtrů záhlaví ↔ externě
    else if ('externalFiltersCollapsed' in patch) this.renderer.renderExternalFilters(); // jen sbalit/rozbalit panel
    if ('rowNumbers' in patch) { this.renderer.renderHeader(); this.renderer.renderBody(); this.renderer.applyLayout(); }
    if ('headerRotate' in patch) { this.renderer.renderHeader(); this.renderer.applyLayout(); }
    if ('wrapHeader' in patch) { this.renderer.applyLayout(); } // změna výšky záhlaví → přepočítat sticky offsety
    if ('summaryRow' in patch || 'groupSubtotals' in patch) { this.renderer.renderBody(); }
    if ('emptyText' in patch || 'wrapText' in patch || 'locale' in patch || 'scaleColors' in patch || 'linkNewTab' in patch) { this.renderer.renderBody(); }
    if ('groupBy' in patch || 'groupDisplay' in patch) { this.renderer.renderHeader(); this.renderer.renderBody(); this.renderer.applyLayout(); this.gear?.refresh(); }
    if ('groupRepeat' in patch) { this.renderer.renderBody(); }
    if ('selectColumn' in patch) { this.renderer.renderHeader(); this.renderer.renderBody(); this.renderer.applyLayout(); }
    if ('selectRowClick' in patch || 'rowHighlight' in patch) { this.renderer.renderBody(); } // znovu navázat klik-listenery
    if ('actionsLayout' in patch) { this.renderer.renderHeader(); this.renderer.renderBody(); this.renderer.applyLayout(); }
    if ('paginationPosition' in patch || 'pageSize' in patch) {
      // pozor: refresh()/pager čtou this.pageSize (ne this.instance.pageSize) —
      // bez této synchronizace by se změna projevila až po reloadu.
      if ('pageSize' in patch) this.pageSize = this.instance.pageSize;
      this.page = 1;
      this.refresh(); // refresh překreslí i pagery (renderFooter)
    } else {
      this.renderer.applyLayout();
    }
  }

  /* =================== ostatní =================== */

  setLanguage(lang) {
    this.i18n.setLang(lang);
    this.renderer.renderToolbar();
    this.renderer.renderHeader();
    this.renderer.renderFooter();
    this.renderer.applyLayout();
  }

  destroy() {
    this.gear?.close();
    this.instanceSettings?.close();
    this.renderer.destroy();
    if (INSTANCES.get(this.options.id) === this) INSTANCES.delete(this.options.id);
  }
}

// Registr živých instancí (klíč = id) — kvůli přesunu řádků mezi tabulkami.
const INSTANCES = new Map();

/** Normalizuje options.selectable na { enabled, mode, max }. */
function normSelectable(v) {
  if (v === true) return { enabled: true, mode: 'multi', max: 0 };
  if (v === 'single') return { enabled: true, mode: 'single', max: 1 };
  if (typeof v === 'number' && v > 0) return { enabled: true, mode: 'multi', max: v };
  return { enabled: false, mode: 'multi', max: 0 };
}

function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Sestaví ajax config z různých forem zadání (ajax objekt nebo ajaxUrl). */
function resolveAjax(options) {
  if (options.ajax && typeof options.ajax === 'object') return options.ajax;
  if (options.ajaxUrl) return { url: options.ajaxUrl };
  throw new Error('Lattice: serverSide=true vyžaduje `ajax` nebo `ajaxUrl`.');
}
