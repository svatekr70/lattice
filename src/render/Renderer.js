/**
 * Renderer — veškerý DOM gridu. Bere hotový model z Lattice (this.grid) a
 * vykresluje ho; sám nedrží zdroj pravdy (ten je v Lattice/Store).
 *
 * Struktura DOM:
 *   .lattice (root = mount)                 [density/layout třídy, --lattice-font-size]
 *     .lattice-toolbar                       gear + nastavení instance
 *     .lattice-viewport  (overflow:auto)     jediný scroll kontejner (H i V)
 *       .lattice-table   (width = Σ šířek)
 *         .lattice-header (sticky top)
 *           .lattice-header-row              titulky, řazení, resize handle
 *           .lattice-filter-row              header filtry (jen když existují)
 *         .lattice-body                      řádky aktuální stránky
 *     .lattice-footer                        paginace
 *     .lattice-overlay                       loading / empty / error
 *
 * Frozen sloupce se fyzicky seskupí (vlevo / uprostřed / vpravo) a přišpendlí
 * přes position:sticky s offsety počítanými z AKTUÁLNÍHO pořadí → přesun +
 * ukotvení sloupce funguje konzistentně.
 */
import { el, clear, debounce } from '../util/dom.js';
import { getFormatter } from '../types/columnTypes.js';
import { getFilter } from '../filters/index.js';
import { attachResize, attachRowNumberResize } from '../features/resize.js';
import { attachHeaderDrag, attachGroupDrag } from '../features/columnDrag.js';
import { openMenu, openMenuAt } from '../features/menu.js';
import { openPopup } from '../features/popup.js';
import { attachMoveHandle, attachDropZone, attachGroupDropZone, attachExternalDrop } from '../features/rowMove.js';
import { isNumericType, computeSummary, computeRowSummary, SUMMARY_SYMBOL, SUMMARY_ORDER } from '../features/summary.js';
import { compileAggregate } from '../core/formula.js';
import { levelColor, levelIndex, DEFAULT_SCALE_COLORS } from '../core/colorScale.js';
import { dateBucket } from '../core/dateParts.js';
import { cellValue, isComputed } from '../core/cellValue.js';

export class Renderer {
  constructor(grid) {
    this.grid = grid;
    this.nodes = {};
  }

  /** Postaví neměnný skelet a připojí ho do mount elementu. */
  mount() {
    const root = this.grid.el;
    root.classList.add('lattice');
    root.setAttribute('role', 'grid');
    clear(root);

    const toolbar = el('div.lattice-toolbar');
    const selectionBar = el('div.lattice-selection-bar');
    const topPager = el('div.lattice-footer.lattice-top-pager');
    const universalBar = el('div.lattice-universal-bar');
    const externalFilters = el('div.lattice-external-filters');
    const topScroll = el('div.lattice-top-scroll');
    const topScrollInner = el('div.lattice-top-scroll-inner');
    topScroll.appendChild(topScrollInner);
    const viewport = el('div.lattice-viewport');
    const table = el('div.lattice-table');
    const header = el('div.lattice-header');
    const groupRow = el('div.lattice-group-row');
    const headerRow = el('div.lattice-header-row');
    const filterRow = el('div.lattice-filter-row');
    const pinnedTop = el('div.lattice-pinned.lattice-pinned-top');
    const pinnedBottom = el('div.lattice-pinned.lattice-pinned-bottom');
    const body = el('div.lattice-body');
    const summaryBar = el('div.lattice-summary-bar');
    const footer = el('div.lattice-footer');
    const overlay = el('div.lattice-overlay');

    header.append(groupRow, headerRow, filterRow, pinnedTop); // pinnedTop se lepí spolu s hlavičkou
    table.append(header, body, pinnedBottom);
    viewport.append(table);
    const rangeStatus = el('div.lattice-range-status');
    root.append(toolbar, selectionBar, topPager, universalBar, externalFilters, topScroll, viewport, summaryBar, footer, rangeStatus, overlay);

    this.nodes = { root, toolbar, selectionBar, topPager, universalBar, externalFilters, topScroll, topScrollInner, viewport, table, header, groupRow, headerRow, filterRow, pinnedTop, pinnedBottom, body, summaryBar, footer, rangeStatus, overlay };

    // Horní vodorovný scrollbar synchronizovaný s viewportem (obousměrně).
    let syncing = false;
    topScroll.addEventListener('scroll', () => {
      if (syncing) return; syncing = true; viewport.scrollLeft = topScroll.scrollLeft; syncing = false;
    });
    viewport.addEventListener('scroll', () => {
      if (syncing) return; syncing = true; topScroll.scrollLeft = viewport.scrollLeft; syncing = false;
    });

    // Re-layout frozen offsetů při změně šířky viewportu (např. „fit" mód).
    this._onResize = () => { if (this.grid.responsive) this._reflowResponsive(); this.applyLayout(); };
    window.addEventListener('resize', this._onResize);

    // Responsivní skládání: sleduj šířku viewportu (kontejnerově, ne jen okno).
    if (this.grid.responsive) {
      this._computeResponsive(); // počáteční stav ještě před prvním renderHeader
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this._reflowResponsive());
        this._ro.observe(viewport);
      }
    }

    this.renderToolbar();
    this.applyInstanceStyles();
    if (this.grid.range) this.grid.range.attach(root, body);
    if (this.grid.acceptExternalRows) attachExternalDrop(viewport, this);
    // Klávesové zkratky historie (Ctrl/⌘+Z zpět, Ctrl+Y / Ctrl+Shift+Z znovu).
    if (this.grid.history) {
      if (root.tabIndex < 0) root.tabIndex = 0;
      root.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.target.closest('input, textarea, select')) return; // needat zásah do editace textu
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.grid.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.grid.redo(); }
      });
    }
    // Progresivní nekonečné scrollování — u paty viewportu dotáhni další stránku
    // (jen v módu 'scroll'; mód lze přepnout i za běhu).
    if (this.grid.progressive) {
      viewport.addEventListener('scroll', () => {
        if (this.grid.progressive === 'scroll' && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 80) this.grid.loadMore();
      });
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this.grid.range?.destroy();
    clear(this.grid.el);
    this.grid.el.classList.remove('lattice');
  }

  /* -------- pořadí sloupců pro render (frozen seskupené) -------- */

  /** Viditelné sloupce rozdělené na left-frozen / normal / right-frozen. */
  renderColumns() {
    const left = [], mid = [], right = [];
    // Sloupec s čísly řádků — vždy první a ukotvený vlevo (když je zapnutý).
    const mv = this.moveColumn();
    if (mv) left.push(mv);
    const sc = this.selectionColumn();
    if (sc) left.push(sc);
    const rn = this.rowNumberColumn();
    if (rn) left.push(rn);
    const grid = this.grid;
    // Sloupce seskupené podle SYROVÉ hodnoty se z běžné pozice skryjí (ukážou se
    // jako ukotvené vedoucí sloupce vlevo — v obou režimech). Datumové úrovně (part)
    // původní sloupec nechají (seskupuješ podle roku, ale pořád vidíš celé datum).
    const grouped = new Set(grid.groupActive() ? grid.groupedRawFields() : []);
    // Akce v režimu 'menu' bez zapnutého číslování řádků: ⋮ tlačítko dej do ID
    // sloupce (je-li zobrazen), jinak vynuť číslovací sloupec a dej ⋮ do něj.
    this._menuIdField = null;
    if (grid.hasActions() && grid.instance.actionsLayout === 'menu' && !rn) {
      const idCol = grid.columns.find((c) => c.visible && c.type === 'id' && !grouped.has(c.field));
      if (idCol) this._menuIdField = idCol.field;
      else left.push(this.rowNumberColumn(true)); // žádné ID → vynucené číslování s ⋮
    }
    // Vedoucí syntetické sloupce úrovní seskupení (vlevo, ukotvené) — v OBOU režimech.
    // 'headers' k nim navíc přidá sbalitelné lišty skupin; 'columns' nechá ploché řádky.
    if (grid.groupActive()) {
      for (const gc of this.groupLevelColumns()) left.push(gc);
    }
    const collapsed = (grid.responsive && this._collapsed) ? this._collapsed : null;
    const colGroupsCollapsed = grid.colGroupsCollapsed;
    const emittedColGroup = new Set();
    this._collapsedCols = [];
    for (const c of grid.columns) {
      if (!c.visible) continue;
      if (grouped.has(c.field)) continue;
      // Sbalená skupina sloupců → místo všech členů jeden úzký zástupný proužek
      // (u prvního člena; členové jsou po _normalizeGroups souvislí).
      const cg = c.group || null;
      if (cg && colGroupsCollapsed && colGroupsCollapsed.has(cg)) {
        if (emittedColGroup.has(cg)) continue;
        emittedColGroup.add(cg);
        const strip = this.colGroupStrip(c);
        if (strip.frozen === 'right') right.push(strip);
        else if (strip.frozen) left.push(strip);
        else mid.push(strip);
        continue;
      }
      if (c.frozen === 'right') right.push(c);
      else if (c.frozen) left.push(c);
      else if (collapsed && collapsed.has(c.field)) this._collapsedCols.push(c); // schováno → do detailu
      else mid.push(c);
    }
    // Akce v režimu 'column' → poslední sloupec, ukotvený vpravo.
    if (grid.hasActions() && grid.instance.actionsLayout === 'column') right.push(this.actionsColumn());
    // Souhrn řádků → syntetické sloupce zcela vpravo (jeden na každou aktivní funkci).
    for (const rs of this.rowSummaryColumns()) right.push(rs);
    return { list: [...left, ...mid, ...right], left, mid, right };
  }

  /**
   * Vedoucí syntetické sloupce pro režim 'columns' — jeden na každou úroveň
   * seskupení, vlevo a ukotvené, s hodnotou kbelíku (rok/kvartál/…) na řádku.
   */
  groupLevelColumns() {
    const grid = this.grid;
    const i18n = grid.i18n;
    return grid.groupDescriptors().map((desc) => {
      const col = grid.columns.find((c) => c.field === desc.field);
      const title = col ? this.groupLevelTitle({ part: desc.part }, col) : desc.field;
      return {
        field: '__group__' + desc.id, title,
        type: 'text', filter: null, group: null, headerSort: false,
        frozen: 'left', frozenAllowed: false, visible: true,
        minWidth: 90, width: 130, align: 'left',
        availableFilters: [], filterEnabled: false, _groupCol: desc,
        formatter: (_v, _col, row) => {
          // „Jen v záhlaví skupiny" (groupRepeat:false) v režimu headers → buňky prázdné,
          // hodnota je v liště skupiny; frozen sloupec zůstává jako ukotvený prostor.
          if (grid.instance.groupRepeat === false && grid.instance.groupDisplay !== 'columns') return '';
          const raw = row ? row[desc.field] : null;
          if (!desc.part) return raw == null ? '' : String(raw);
          const b = dateBucket(raw, desc.part, i18n);
          return b ? b.label : '';
        },
      };
    });
  }

  /**
   * Zástupný (úzký) sloupec pro SBALENOU skupinu sloupců. Drží pozici i frozen
   * stranu podle prvního člena; tělo je prázdné, záhlaví skupiny nad ním nese
   * ikonu pro rozbalení.
   */
  colGroupStrip(member) {
    const g = member.group;
    return {
      field: ' cg:' + g, title: g, type: 'text',
      group: g, defaultGroup: g,
      filter: null, filterEnabled: false, availableFilters: [], headerSort: false,
      frozen: member.frozen || false, frozenAllowed: false, visible: true,
      align: 'center', minWidth: COLGROUP_STRIP_W, width: COLGROUP_STRIP_W,
      headerRotate: null, summary: [], rowSummary: [], summaryFormula: null,
      formatter: null, value: null, _colGroupStrip: true, _colGroup: g,
      groupHeaderBackground: member.groupHeaderBackground || null,
      groupHeaderColor: member.groupHeaderColor || null,
    };
  }

  /** Syntetický sloupec s úchytem pro přetahování řádků (nebo null). */
  moveColumn() {
    if (!this.grid.isMovable()) return null;
    return {
      field: '__move__', title: '', type: 'text', filter: null, group: null,
      frozen: true, frozenAllowed: false, visible: true, align: 'center',
      minWidth: 28, width: 30, availableFilters: [], filterEnabled: false, _move: true,
    };
  }

  /** Syntetický výběrový sloupec s checkboxy (nebo null když výběr není zapnutý). */
  selectionColumn() {
    if (!this.grid.isSelectable() || this.grid.instance.selectColumn === false) return null;
    return {
      field: '__select__', title: '', type: 'text', filter: null, group: null,
      frozen: true, frozenAllowed: false, visible: true, align: 'center',
      minWidth: 40, width: this.grid.selectable.mode === 'single' ? 40 : 54,
      availableFilters: [], filterEnabled: false, _select: true,
    };
  }

  /** Syntetický sloupec „Akce" (poslední, ukotvený vpravo) s inline ikonami. */
  actionsColumn() {
    const n = this.grid.options.actions.length;
    return {
      field: '__actions__', title: this.grid.i18n.t('actions.title'), type: 'text', filter: null, group: null,
      frozen: 'right', frozenAllowed: false, visible: true, align: 'center',
      minWidth: 54, width: Math.max(54, n * 30 + 14), availableFilters: [], filterEnabled: false, _actions: true,
    };
  }

  /**
   * Aktivní funkce souhrnu řádků (sjednocení col.rowSummary napříč viditelnými
   * sloupci, v pevném pořadí) + pro každou seznam zapojených sloupců.
   */
  rowSummaryModel() {
    const cols = this.grid.columns.filter((c) => c.visible && (c.rowSummary || []).length);
    const fns = SUMMARY_ORDER.filter((fn) => cols.some((c) => c.rowSummary.includes(fn)));
    return fns.map((fn) => ({
      fn,
      cols: cols.filter((c) => c.rowSummary.includes(fn) && (fn === 'count' || isNumericType(c.type))),
    }));
  }

  /** Syntetické pravé sloupce se souhrnem přes řádek (jeden na funkci). */
  rowSummaryColumns() {
    return this.rowSummaryModel().map(({ fn, cols }) => ({
      field: '__rowsum_' + fn + '__', title: SUMMARY_SYMBOL[fn], type: 'number', filter: null, group: null,
      frozen: 'right', frozenAllowed: false, visible: true, align: 'right',
      minWidth: 90, width: 130, availableFilters: [], filterEnabled: false,
      _rowsum: true, _fn: fn, _cols: cols,
    }));
  }

  /** Syntetický úzký gutter s ⋮ menu akcí (když není číslování řádků). */
  actionsMenuColumn() {
    return {
      field: '__actions_menu__', title: '', type: 'text', filter: null, group: null,
      frozen: true, frozenAllowed: false, visible: true, align: 'center',
      minWidth: 30, width: 34, availableFilters: [], filterEnabled: false, _actionsMenu: true,
    };
  }

  /**
   * Syntetický sloupec s čísly řádků (nebo null když je vypnutý).
   * `force` = vynutí sloupec i při rowNumbers 'none' (režim ⋮ menu bez ID sloupce).
   */
  rowNumberColumn(force = false) {
    const set = this.grid.instance.rowNumbers;
    const mode = (set && set !== 'none') ? set : (force ? 'continuous' : null);
    if (!mode) return null;
    // Šířka dle nejdelšího čísla na stránce.
    const maxNum = mode === 'perPage'
      ? Math.min(this.grid.pageSize, this.grid.total || this.grid.pageSize)
      : (this.grid.total || 0);
    const digits = Math.max(2, String(Math.max(1, maxNum)).length);
    // uživatelská šířka (po resize) má přednost před automatickou;
    // v režimu 'menu' přidáme místo na ⋮ tlačítko akcí uvnitř číslovacího sloupce.
    const menuActions = this.grid.hasActions() && this.grid.instance.actionsLayout === 'menu';
    const width = this.grid.instance.rowNumberWidth || (22 + digits * 9 + (menuActions ? 22 : 0));
    return {
      field: '__rownum__', title: '#', type: 'text', filter: null, group: null,
      frozen: true, frozenAllowed: false, visible: true, align: 'right',
      minWidth: 36, width, availableFilters: [], filterEnabled: false,
      _rownum: true, _mode: mode, _menuActions: menuActions,
    };
  }

  /* -------- layout: šířky + frozen offsety -------- */

  applyLayout() {
    const { list, left, right } = this.renderColumns();
    const widths = this.computeWidths(list);

    // Šířka tabulky = Σ šířek. V režimu 'fitData'/'fitDataTable' se tabulka NEROZTAHUJE
    // na celou šířku (jen dle obsahu → vpravo může zůstat prázdno); ostatní vyplní.
    const totalWidth = list.reduce((s, c) => s + widths.get(c.field), 0);
    const noFill = this.grid.instance.layout === 'fitData' || this.grid.instance.layout === 'fitDataTable';
    this.nodes.table.style.width = totalWidth + 'px';
    this.nodes.table.style.minWidth = noFill ? '0px' : '100%';

    // Horní vodorovný scrollbar: šířka „obsahu" = šířka tabulky; ukázat jen při přetečení.
    this.nodes.topScrollInner.style.width = totalWidth + 'px';
    const overflows = totalWidth > this.nodes.viewport.clientWidth + 1;
    this.nodes.topScroll.style.display = overflows ? 'block' : 'none';

    // Levé offsety (kumulativně zleva).
    const leftOff = new Map();
    let acc = 0;
    for (const c of left) { leftOff.set(c.field, acc); acc += widths.get(c.field); }
    // Pravé offsety (kumulativně zprava).
    const rightOff = new Map();
    acc = 0;
    for (let i = right.length - 1; i >= 0; i--) {
      const c = right[i];
      rightOff.set(c.field, acc);
      acc += widths.get(c.field);
    }

    // Hranice skupin: sloupec, za kterým se mění skupina (i skupina↔neseskupený).
    const groupEdges = new Set();
    for (let k = 0; k < list.length - 1; k++) {
      if ((list[k].group || null) !== (list[k + 1].group || null)) groupEdges.add(list[k].field);
    }
    // Frozen hrany: na pravém okraji ukotvení má přednost stín ukotvení před hranou skupiny.
    const frozenEdges = new Set();
    if (left.length) frozenEdges.add(left[left.length - 1].field);
    if (right.length) frozenEdges.add(right[0].field);

    this.layout = { widths, leftOff, rightOff, list, groupEdges, frozenEdges };
    this.styleCells();
  }

  /**
   * Efektivní šířky sloupců podle layout režimu instance:
   *  - fitData / fitDataFill / fitDataTable: šířky dle obsahu (beze změny),
   *  - fitColumns ('fit'): proporčně vyplní šířku viewportu,
   *  - fitDataStretch: poslední sloupec pohltí zbývající šířku.
   */
  computeWidths(list) {
    const widths = new Map();
    for (const c of list) widths.set(c.field, Math.max(c.minWidth, c.width));
    const mode = this.grid.instance.layout;
    const vpWidth = this.nodes.viewport.clientWidth;
    const total = list.reduce((s, c) => s + widths.get(c.field), 0);
    if (!vpWidth || !list.length || total >= vpWidth) return widths;

    if (mode === 'fit' || mode === 'fitColumns') {
      // Přebytek rozdělit proporčně (frozen/syntetické necháme být).
      const targets = list.filter((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._colGroupStrip);
      const flex = targets.length ? targets : list;
      const extra = vpWidth - total;
      const base = flex.reduce((s, c) => s + widths.get(c.field), 0) || 1;
      for (const c of flex) widths.set(c.field, widths.get(c.field) + extra * (widths.get(c.field) / base));
    } else if (mode === 'fitDataStretch') {
      // Poslední „normální" sloupec absorbuje zbytek.
      const last = [...list].reverse().find((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._colGroupStrip);
      if (last) widths.set(last.field, widths.get(last.field) + (vpWidth - total));
    }
    return widths;
  }

  /** Aplikuje šířky + sticky offsety na už vykreslené buňky (bez re-buildu). */
  styleCells() {
    if (!this.layout) return;
    const { widths, leftOff, rightOff, groupEdges, frozenEdges } = this.layout;
    const cells = this.nodes.table.querySelectorAll('[data-field]');
    for (const cell of cells) {
      const field = cell.dataset.field;
      const w = widths.get(field);
      if (w == null) continue;
      cell.style.width = w + 'px';
      cell.style.left = '';
      cell.style.right = '';
      cell.classList.remove('is-frozen', 'is-frozen-left', 'is-frozen-right', 'is-frozen-edge');
      // Silná hrana skupiny — ale na okraji ukotvení má přednost stín ukotvení.
      cell.classList.toggle('is-gedge', groupEdges.has(field) && !frozenEdges.has(field));
      if (leftOff.has(field)) {
        cell.classList.add('is-frozen', 'is-frozen-left');
        cell.style.left = leftOff.get(field) + 'px';
      } else if (rightOff.has(field)) {
        cell.classList.add('is-frozen', 'is-frozen-right');
        cell.style.right = rightOff.get(field) + 'px';
      }
    }
    // Označit vnitřní hranu frozen bloku (pro stín).
    this.markFrozenEdges();
    // Dorovnat šířky/pozice skupinového řádku.
    this.sizeGroupRow();
  }

  markFrozenEdges() {
    const { left, right } = this.renderColumns();
    const edgeLeft = left[left.length - 1];
    const edgeRight = right[0];
    for (const cell of this.nodes.table.querySelectorAll('[data-field]')) {
      cell.classList.remove('is-frozen-edge-left', 'is-frozen-edge-right');
      if (edgeLeft && cell.dataset.field === edgeLeft.field) cell.classList.add('is-frozen-edge-left');
      if (edgeRight && cell.dataset.field === edgeRight.field) cell.classList.add('is-frozen-edge-right');
    }
  }

  /* -------- render částí -------- */

  renderAll() {
    this.renderHeader();
    this.renderBody();
    this.renderFooter();
    this.applyLayout();
  }

  renderHeader() {
    const { headerRow, filterRow } = this.nodes;
    clear(headerRow);
    clear(filterRow);
    const { list } = this.renderColumns();
    this.buildGroupRow(list);
    // Filtry: v záhlaví ('header'), v externím panelu ('external'), nebo vypnuté ('none').
    const mode = this.grid.instance.filterLayout;
    const showHeaderFilters = mode === 'header';
    const anyFilter = showHeaderFilters && list.some((c) => c.filter && c.filterEnabled);

    for (const col of list) {
      headerRow.appendChild(this.buildHeaderCell(col));
      // Prázdné buňky i pro sloupce bez filtru → zachová zarovnání s hlavičkou.
      if (anyFilter) filterRow.appendChild(this.buildFilterCell(col));
    }
    filterRow.style.display = anyFilter ? '' : 'none';
    // Vysoká hlavička, když je aspoň jeden sloupec s otočeným popiskem.
    const anyRot = list.some((c) => !c._rownum && this.effectiveRotate(c) !== 'none');
    this.nodes.header.classList.toggle('has-rot', anyRot);
    this.renderExternalFilters();
    this.renderUniversalBar();
  }

  /** Univerzální filtr: Pole / Typ / Hodnota / Zrušit. */
  renderUniversalBar() {
    const bar = this.nodes.universalBar;
    clear(bar);
    if (this.grid.instance.filterLayout !== 'universal') { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const u = grid.universal || {};
    const cols = grid.columns;

    const fieldSel = el('select.lattice-uni-field');
    for (const c of cols) fieldSel.appendChild(el('option', { value: c.field, text: c.title }));
    fieldSel.value = u.field || (cols[0] && cols[0].field) || '';

    const typeSel = el('select.lattice-uni-type');
    for (const o of UNIVERSAL_OPS) typeSel.appendChild(el('option', { value: o.op, text: o.label }));
    typeSel.value = u.op || 'contains';

    const value = el('input.lattice-uni-value', { type: 'text', placeholder: t('universal.value'), value: u.value ?? '' });

    const apply = () => grid.setUniversal({ field: fieldSel.value, op: typeSel.value, value: value.value });
    const applyDebounced = debounce(apply, grid.options.filterDebounce ?? 300);
    fieldSel.addEventListener('change', apply);
    typeSel.addEventListener('change', apply);
    value.addEventListener('input', applyDebounced);

    const clearBtn = el('button.lattice-uni-clear', { type: 'button', text: t('universal.clear') });
    clearBtn.addEventListener('click', () => { value.value = ''; grid.clearUniversal(); });

    bar.append(
      el('span.lattice-uni-label', { text: t('universal.field') }), fieldSel,
      el('span.lattice-uni-label', { text: t('universal.type') }), typeSel,
      el('span.lattice-uni-label', { text: t('universal.valueLabel') }), value,
      clearBtn,
    );
  }

  /** Efektivní otočení hlavičky sloupce (per sloupec přepíše hromadné nastavení). */
  effectiveRotate(col) {
    const r = col.headerRotate != null ? col.headerRotate : this.grid.instance.headerRotate;
    return r === '90' || r === '270' ? r : 'none';
  }

  /** Externí filtry nad tabulkou (responzivní mřížka: label + ovládací prvek). */
  renderExternalFilters() {
    const box = this.nodes.externalFilters;
    clear(box);
    if (this.grid.instance.filterLayout !== 'external') {
      box.style.display = 'none';
      return;
    }
    const cols = this.grid.columns.filter((c) => c.visible && c.filter && c.filterEnabled);
    if (cols.length === 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    const t = (k, v) => this.grid.i18n.t(k, v);
    const collapsed = this.grid.instance.externalFiltersCollapsed === true;
    const active = Object.keys(this.grid.filters || {}).length;

    // Hlavička s toggle — na malých monitorech lze panel filtrů sbalit.
    const head = el('div.lattice-ext-head');
    const btn = el('button.lattice-ext-toggle', {
      type: 'button',
      title: collapsed ? t('filters.showPanel') : t('filters.hidePanel'),
    }, [
      el('span.lattice-ext-chevron', { html: CHEVRON_SVG, class: collapsed ? 'is-collapsed' : '' }),
      el('span.lattice-ext-title', { text: t('filters.panelTitle') }),
    ]);
    if (active > 0) btn.appendChild(el('span.lattice-ext-badge', { text: t('filters.activeCount', { n: active }) }));
    btn.addEventListener('click', () => {
      this.grid.setInstance({ externalFiltersCollapsed: !collapsed });
    });
    head.appendChild(btn);
    box.appendChild(head);

    const grid = el('div.lattice-ext-grid');
    grid.style.display = collapsed ? 'none' : 'grid';
    for (const col of cols) {
      const field = el('div.lattice-ext-field');
      field.appendChild(el('label.lattice-ext-label', { text: col.title }));
      const wrap = this.buildFilterControl(col);
      if (wrap) field.appendChild(wrap);
      grid.appendChild(field);
    }
    box.appendChild(grid);
  }

  /**
   * Řádek skupin nad hlavičkami. Cely spanů se tvoří z běhů sousedních sloupců
   * se stejnou skupinou v rámci stejné frozen-strany. Sloupce bez skupiny mají
   * prázdný spanující cell (drží zarovnání). Zobrazí se jen když skupiny existují.
   */
  buildGroupRow(list) {
    const { groupRow } = this.nodes;
    clear(groupRow);
    // Mapa barev skupin (title → {bg,color}) — leaf hlavičky ji zdědí, pokud
    // nemají vlastní barvu. Naplní se níže při procházení skupin.
    this._groupHeaderStyle = new Map();
    const hasGroups = list.some((c) => c.group);
    if (!hasGroups) {
      groupRow.style.display = 'none';
      return;
    }
    groupRow.style.display = '';

    const side = (c) => (c.frozen === 'right' ? 'right' : c.frozen ? 'left' : 'mid');
    let i = 0;
    while (i < list.length) {
      const g = list[i].group || null;
      const s = side(list[i]);
      let j = i;
      // běh sousedních sloupců se stejnou skupinou i frozen-stranou
      while (j < list.length && (list[j].group || null) === g && side(list[j]) === s) j++;
      const members = list.slice(i, j);
      const cell = el('div.lattice-gcell', { dataset: { fields: members.map((m) => m.field).join(',') } });
      if (g) {
        const t = this.grid.i18n.t.bind(this.grid.i18n);
        const collapsed = this.grid.isColGroupCollapsed(g);
        cell.title = g;
        cell.classList.toggle('is-col-collapsed', collapsed);
        // Vlastní barvy záhlaví skupiny (stačí na kterémkoli členu; nese je i proužek).
        const styled = members.find((m) => m.groupHeaderBackground || m.groupHeaderColor) || members[0];
        if (styled.groupHeaderBackground) cell.style.background = styled.groupHeaderBackground;
        if (styled.groupHeaderColor) cell.style.color = styled.groupHeaderColor;
        if (styled.groupHeaderBackground || styled.groupHeaderColor) {
          this._groupHeaderStyle.set(g, { bg: styled.groupHeaderBackground, color: styled.groupHeaderColor });
        }
        // Ikona sbalit / rozbalit skupinu sloupců (vlevo, jako caret).
        const tgl = el('button.lattice-gcell-toggle', {
          type: 'button',
          title: collapsed ? t('columns.expandGroup') : t('columns.collapseGroup'),
          text: collapsed ? '+' : '−',
          class: collapsed ? 'is-collapsed' : '',
        });
        tgl.addEventListener('mousedown', (e) => e.stopPropagation()); // ať nezačne tažení
        tgl.addEventListener('click', (e) => { e.stopPropagation(); this.grid.toggleColGroup(g); });
        cell.appendChild(tgl);
        cell.appendChild(el('span.lattice-gcell-title', { text: g }));
        // (Zrušení skupiny × a barva jsou v dialogu Sloupce → skupina, ať se
        //  na destruktivní akce omylem neklikne přímo v gridu.)
      } else {
        cell.classList.add('is-empty');
      }
      attachGroupDrag(cell, g, this.grid); // tažení celé skupiny
      groupRow.appendChild(cell);
      i = j;
    }
  }

  /** Nastaví šířky a sticky offsety cell skupinového řádku (dle layoutu). */
  sizeGroupRow() {
    if (!this.layout) return;
    const { widths, leftOff, rightOff, groupEdges, frozenEdges } = this.layout;
    for (const cell of this.nodes.groupRow.children) {
      const fields = (cell.dataset.fields || '').split(',').filter(Boolean);
      if (!fields.length) continue;
      const last = fields[fields.length - 1];
      const w = fields.reduce((s, f) => s + (widths.get(f) || 0), 0);
      cell.style.width = w + 'px';
      cell.style.left = '';
      cell.style.right = '';
      cell.classList.remove('is-frozen', 'is-frozen-left', 'is-frozen-right', 'is-frozen-edge-left', 'is-frozen-edge-right');
      cell.classList.toggle('is-gedge', groupEdges.has(last) && !frozenEdges.has(last));
      // pás nad posledním ukotveným sloupcem převezme stín ukotvení
      if (frozenEdges.has(last) && leftOff.has(last)) cell.classList.add('is-frozen-edge-left');
      if (leftOff.has(fields[0])) {
        cell.classList.add('is-frozen', 'is-frozen-left');
        cell.style.left = leftOff.get(fields[0]) + 'px';
      } else if (rightOff.has(fields[fields.length - 1])) {
        cell.classList.add('is-frozen', 'is-frozen-right');
        cell.style.right = rightOff.get(fields[fields.length - 1]) + 'px';
      }
    }
  }

  buildHeaderCell(col) {
    const grid = this.grid;
    // Proužek sbalené skupiny sloupců — prázdná hlavička (ovládá se z řádku skupin).
    if (col._colGroupStrip) {
      return el('div.lattice-hcell.lattice-colgroup-striph', { dataset: { field: col.field }, class: 'is-center' });
    }
    // Souhrn řádků — hlavička se symbolem funkce (Σ/⌀/min/max/#) + názvem funkce.
    if (col._rowsum) {
      return el('div.lattice-hcell.lattice-rowsum-cell', {
        dataset: { field: col.field }, class: 'is-right', title: grid.i18n.t('summary.name.' + col._fn),
      }, [el('span.lattice-hcell-title', { text: col.title })]);
    }
    // Sloupec akcí — titulek „Akce"; gutter s ⋮ menu — prázdná hlavička.
    if (col._actions) {
      return el('div.lattice-hcell.lattice-actions-cell', { dataset: { field: col.field }, class: 'is-center' },
        [el('span.lattice-hcell-title', { text: col.title })]);
    }
    if (col._actionsMenu) {
      return el('div.lattice-hcell.lattice-actions-cell', { dataset: { field: col.field }, class: 'is-center' });
    }
    // Sloupec s úchytem přesunu — prázdná hlavička.
    if (col._move) {
      return el('div.lattice-hcell.lattice-move-cell', { dataset: { field: col.field }, class: 'is-center' });
    }
    // Výběrový sloupec — checkbox označí STRÁNKU; caret menu nabídne vše/invert/zrušit.
    if (col._select) {
      const cell = el('div.lattice-hcell.lattice-select-cell', { dataset: { field: col.field }, class: 'is-center' });
      if (grid.selectable.mode !== 'single') {
        const scopeLabel = grid.selectScope === 'all' ? grid.i18n.t('select.scopeAll', { n: grid.filteredCount() }) : grid.i18n.t('select.scopePage');
        const cb = el('input.lattice-select-all', { type: 'checkbox', title: scopeLabel });
        cb.addEventListener('click', (e) => { e.stopPropagation(); grid.toggleScopeSelection(); });
        cell.appendChild(cb);
        const caret = el('button.lattice-select-menu', { type: 'button', title: grid.i18n.t('select.menu'), text: '▾' });
        caret.addEventListener('click', (e) => { e.stopPropagation(); this.openSelectMenu(caret); });
        cell.appendChild(caret);
      }
      return cell;
    }
    // Sloupec s čísly řádků — prostá hlavička bez řazení/resize/dragu/filtru.
    if (col._rownum) {
      const cell = el('div.lattice-hcell.lattice-rownum-cell', {
        dataset: { field: col.field }, class: 'is-' + (col.align || 'right'),
      }, [el('span.lattice-hcell-title', { text: col.title })]);
      // resize handle — šířka # sloupce se ukládá do instance
      const handle = el('div.lattice-resize-handle');
      attachRowNumberResize(handle, grid);
      cell.appendChild(handle);
      return cell;
    }
    const sortState = grid.sort.find((s) => s.field === col.field);
    const rot = this.effectiveRotate(col);
    const cell = el('div.lattice-hcell', {
      dataset: { field: col.field }, role: 'columnheader',
      class: [col.align ? 'is-' + col.align : '', rot !== 'none' ? 'is-rot-' + rot : ''].filter(Boolean).join(' '),
    });
    if (col.headerSort && grid.options.headerSort !== false) {
      cell.setAttribute('aria-sort', sortState ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }

    // Menu hlavičky — ⋮ ikona VLEVO před názvem (a pravý klik) → příkazy sloupce + vlastní.
    if (col.headerMenu) {
      const mbtn = el('button.lattice-hcell-menu', { type: 'button', title: this.grid.i18n.t('menu.column'), text: '⋮' });
      mbtn.addEventListener('mousedown', (e) => e.stopPropagation());
      mbtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(mbtn, this.headerMenuItems(col), (v, it) => it && it.action && it.action(mbtn, col)); });
      cell.appendChild(mbtn);
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        openMenuAt(e.pageX, e.pageY, this.headerMenuItems(col), (v, it) => it && it.action && it.action(cell, col));
      });
    }

    // Barvy záhlaví sloupce: vlastní má přednost, jinak se zdědí barva skupiny.
    let hbg = col.headerBackground, hcol = col.headerColor;
    if (col.group && this._groupHeaderStyle) {
      const gs = this._groupHeaderStyle.get(col.group);
      if (gs) { hbg = hbg || gs.bg; hcol = hcol || gs.color; }
    }
    if (hbg) cell.style.background = hbg;
    if (hcol) cell.style.color = hcol;

    const label = el('span.lattice-hcell-title', { text: col.title });
    cell.appendChild(label);

    if (col.headerSort && grid.options.headerSort !== false) {
      cell.classList.add('is-sortable');
      const arrow = el('span.lattice-sort', { text: sortState ? (sortState.dir === 'asc' ? '▲' : '▼') : '' });
      // Víceúrovňové řazení → odznak pořadí (1,2,3…).
      if (sortState && grid.sort.length > 1) {
        arrow.appendChild(el('sup.lattice-sort-order', { text: String(grid.sort.indexOf(sortState) + 1) }));
      }
      cell.appendChild(arrow);
      // Shift+klik = přidat/upravit sloupec ve víceúrovňovém řazení.
      label.addEventListener('click', (e) => grid.toggleSort(col.field, e.shiftKey));
      label.title = grid.i18n.t('menu.sortMulti');
    }

    // Popup hlavičky — malá ikona ⓘ otevře plovoucí panel (info / nastavení sloupce).
    if (typeof col.headerPopup === 'function') {
      const info = el('button.lattice-hcell-popup', { type: 'button', title: this.grid.i18n.t('popup.info'), text: 'ⓘ' });
      info.addEventListener('mousedown', (e) => e.stopPropagation()); // ať nezačne drag hlavičky
      info.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopup(info, (close) => col.headerPopup({ col, grid, close }));
      });
      cell.appendChild(info);
    }

    // Drag & drop pořadí přímo za titulek hlavičky.
    attachHeaderDrag(cell, col, grid);

    // Resize handle (Excel-like) na pravém okraji.
    const handle = el('div.lattice-resize-handle');
    attachResize(handle, col, grid);
    cell.appendChild(handle);

    return cell;
  }

  buildFilterCell(col) {
    const cell = el('div.lattice-fcell', { dataset: { field: col.field } });
    const wrap = this.buildFilterControl(col);
    if (wrap) cell.appendChild(wrap);
    return cell;
  }

  /** Ovládací prvek filtru + přepínač typu (sdílené pro záhlaví i externí panel). */
  buildFilterControl(col) {
    if (!col.filter || !col.filterEnabled) return null;
    const def = getFilter(col.filter);
    if (!def) return null;

    const ctx = {
      i18n: this.grid.i18n,
      value: this.grid.filters[col.field],
      debounceMs: this.grid.options.filterDebounce ?? 300,
      fetchJson: (url) => fetch(url).then((r) => r.json()),
      onChange: (value) => this.grid.setFilter(col.field, value),
      // Distinktní hodnoty sloupce z dat — fallback pro select/multiselect bez filterValues.
      distinctValues: () => {
        const src = (this.grid.dataSource.allRows && this.grid.dataSource.allRows()) || this.grid.rows || [];
        const seen = new Set(), out = [];
        for (const r of src) { const v = cellValue(r, col); if (v != null && v !== '' && !seen.has(v)) { seen.add(v); out.push(v); } }
        return out;
      },
    };
    const control = def.build(col, ctx);
    control.classList.add('lattice-fcell-control');
    const wrap = el('div.lattice-filter-wrap', {}, [control]);

    // Přepínač typu filtru — jen když je z čeho vybírat.
    if (Array.isArray(col.availableFilters) && col.availableFilters.length > 1) {
      wrap.appendChild(this.buildFilterTypeSwitcher(col));
    }
    return wrap;
  }

  buildFilterTypeSwitcher(col) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const btn = el('button.lattice-ftype-btn', {
      type: 'button',
      title: t('filterTypes.change'),
      html: FILTER_SVG,
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const items = col.availableFilters.map((f) => ({
        value: f,
        label: t('filterTypes.' + f),
        active: f === col.filter,
      }));
      openMenu(btn, items, (value) => grid.setColumnFilterType(col.field, value));
    });
    return btn;
  }

  renderBody() {
    const { body } = this.nodes;
    clear(body);
    // Efektivní formát (číslo/měna/datum) navěsíme na sloupce, ať k němu formátovače
    // i souhrny mají přístup (nedostávají grid/instance přímo).
    for (const c of this.grid.columns) { c._fmt = this.grid.effectiveFormat(c); c._i18n = this.grid.i18n; c._linkNewTab = this.grid.instance.linkNewTab; }
    const { list } = this.renderColumns();
    const rows = this.grid.rows || [];

    this.renderPinned(list); // připnuté řádky (nahoře/dole) — nezávislé na těle

    // Tree režim: dekorace (odsazení + šipka) patří do prvního datového sloupce.
    // Stromová dekorace (odsazení + šipka) patří do prvního REÁLNÉHO datového
    // sloupce — ne do syntetických (přesun/výběr/číslování/akce).
    this._treeColField = this.grid.tree
      ? (list.find((c) => !c._rownum && !c._move && !c._select && !c._actions && !c._actionsMenu && !c._rowsum) || {}).field
      : null;

    // Master-detail / responsivní kolaps: šipka pro rozbalení detailu patří do
    // prvního reálného datového sloupce (nekoliduje se stromem — ten má vlastní režim).
    this._detailColField = (this._hasDetail() && !this.grid.tree)
      ? (list.find((c) => !c._rownum && !c._move && !c._select && !c._actions && !c._actionsMenu && !c._rowsum) || {}).field
      : null;

    // Virtuální scrollování — vykreslí jen viditelné okno řádků (obří datasety).
    if (this.grid.virtual && !this.grid.groupActive() && rows.length) {
      this._vList = list;
      this._vRows = rows;
      this._rowH = this._measureRowHeight(list, rows);
      this._bindVirtualScroll();
      this._virtualPaint();
      this.renderSummaryBar();
      this.updateOverlay();
      this.updateSelectAllCheckbox();
      this.renderSelectionBar();
      this.grid.range?.apply();
      return;
    }

    const frag = document.createDocumentFragment();
    const colsMode = this.grid.instance.groupDisplay === 'columns';
    if (this.grid.groupActive() && !colsMode) {
      // Řádky rozdělené do (i vnořeného) stromu skupin; každá skupina má
      // klikací hlavičku (sbalení/rozbalení). Číslo pruhu (zebra) běží průběžně.
      this.renderGroupNodes(this.grid.buildGroups(rows), list, frag, { n: 0 });
    } else if (this.grid.groupActive()) {
      // Režim 'columns': ploché řádky seřazené dle skupin, hodnota úrovní ve vedoucích sloupcích.
      const items = flattenGroupItems(this.grid.buildGroups(rows));
      items.forEach(({ row, index }, i) => this._appendRow(frag, row, index, i, list));
    } else {
      rows.forEach((rowData, i) => this._appendRow(frag, rowData, i, i, list));
    }
    body.appendChild(frag);

    // Souhrnné řádky (dle instance.summaryRow: 'page' | 'all').
    const scope = this.grid.instance.summaryRow;
    if (scope === 'page' || scope === 'all') {
      const summary = this.buildSummary(list, scope);
      if (summary) body.appendChild(summary);
    }
    this.renderSummaryBar();

    this.updateOverlay();
    this.updateSelectAllCheckbox();
    this.renderSelectionBar();
    this.grid.range?.apply();
    // šířky/frozen na čerstvé buňky
    if (this.layout) this.styleCells();
    this.attachKeyNav();
  }

  /* -------- virtuální scrollování (jen client-side ploché řádky) -------- */

  /** Změří výšku řádku (jedna sonda) — pro výpočet virtuálního okna. */
  _measureRowHeight(list, rows) {
    const probe = this.buildDataRow(rows[0], 0, 0, list);
    probe.style.visibility = 'hidden'; probe.style.position = 'absolute';
    this.nodes.body.appendChild(probe);
    if (this.layout) this.styleCells();
    const h = probe.offsetHeight || 34;
    probe.remove();
    return h;
  }

  _bindVirtualScroll() {
    if (this._vScrollBound) return;
    this._vScrollBound = true;
    this.nodes.viewport.addEventListener('scroll', () => {
      if (!this.grid.virtual || this.grid.groupActive()) return;
      if (this._vRaf) return;
      this._vRaf = requestAnimationFrame(() => { this._vRaf = null; this._virtualPaint(); });
    });
  }

  /** Překreslí jen viditelné okno řádků + rozpěrky (nad/pod) reprezentující celek. */
  _virtualPaint() {
    const body = this.nodes.body, vp = this.nodes.viewport;
    const rows = this._vRows, list = this._vList, rowH = this._rowH || 34;
    const total = rows.length;
    const buffer = 8;
    const start = Math.max(0, Math.floor(vp.scrollTop / rowH) - buffer);
    const per = Math.ceil((vp.clientHeight || 400) / rowH) + buffer * 2;
    const end = Math.min(total, start + per);

    clear(body);
    if (start > 0) body.appendChild(el('div.lattice-vspacer', { style: { height: start * rowH + 'px' } }));
    for (let i = start; i < end; i++) body.appendChild(this.buildDataRow(rows[i], i, i, list));
    if (end < total) body.appendChild(el('div.lattice-vspacer', { style: { height: (total - end) * rowH + 'px' } }));

    const scope = this.grid.instance.summaryRow;
    if (scope === 'page' || scope === 'all') {
      const summary = this.buildSummary(list, scope);
      if (summary) body.appendChild(summary);
    }
    if (this.layout) this.styleCells();
    this.attachKeyNav();
  }

  /* -------- přístupnost: klávesová navigace buněk (šipky, Home/End, Enter) -------- */

  /** Datové řádky pro navigaci (bez souhrnných / skupinových hlaviček). */
  _navRows() {
    return [...this.nodes.body.querySelectorAll('.lattice-row')]
      .filter((r) => !r.classList.contains('lattice-summary-row'));
  }

  attachKeyNav() {
    const body = this.nodes.body;
    if (!this._keyNavBound) {
      this._keyNavBound = true;
      body.addEventListener('keydown', (e) => this._onGridKey(e));
      body.addEventListener('focusin', (e) => {
        const cell = e.target.closest && e.target.closest('.lattice-cell');
        if (cell && cell.parentElement && cell.parentElement.classList.contains('lattice-row')) {
          const rows = this._navRows();
          const r = rows.indexOf(cell.parentElement);
          const c = [...cell.parentElement.children].indexOf(cell);
          if (r >= 0) this._focusPos = { r, c };
        }
      });
    }
    // Roving tabindex — právě jedna buňka je „vstupní" (tabindex 0), ostatní -1.
    const rows = this._navRows();
    for (const row of rows) for (const cell of row.children) cell.tabIndex = -1;
    if (!rows.length) return;
    const pos = this._focusPos || { r: 0, c: 0 };
    const row = rows[Math.min(pos.r, rows.length - 1)] || rows[0];
    const cell = row.children[Math.min(pos.c, row.children.length - 1)] || row.children[0];
    if (cell) cell.tabIndex = 0;
  }

  _onGridKey(e) {
    const cell = e.target.closest && e.target.closest('.lattice-cell');
    if (!cell || !cell.parentElement || !cell.parentElement.classList.contains('lattice-row')) return;
    // Uvnitř editoru (input/textarea/select) navigaci neřešíme.
    if (e.target !== cell && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const rows = this._navRows();
    const rowEl = cell.parentElement;
    let r = rows.indexOf(rowEl);
    let c = [...rowEl.children].indexOf(cell);
    if (r < 0) return;
    const lastR = rows.length - 1;
    const lastC = rowEl.children.length - 1;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': r = Math.min(lastR, r + 1); break;
      case 'ArrowUp': r = Math.max(0, r - 1); break;
      case 'ArrowRight': c = Math.min(lastC, c + 1); break;
      case 'ArrowLeft': c = Math.max(0, c - 1); break;
      case 'Home': c = e.ctrlKey || e.metaKey ? (r = 0, 0) : 0; break;
      case 'End': c = lastC; if (e.ctrlKey || e.metaKey) r = lastR; break;
      case 'PageDown': r = Math.min(lastR, r + 10); break;
      case 'PageUp': r = Math.max(0, r - 10); break;
      case 'Enter': case 'F2': {
        const idx = Number(rowEl.dataset.index);
        const field = cell.dataset.field;
        if (!Number.isNaN(idx) && field && this.grid.editManager) this.grid.editCell(idx, field);
        e.preventDefault();
        return;
      }
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    this._focusCell(rows, r, c);
  }

  _focusCell(rows, r, c) {
    const row = rows[r]; if (!row) return;
    const cell = row.children[Math.min(c, row.children.length - 1)]; if (!cell) return;
    for (const rw of rows) for (const cc of rw.children) cc.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
    this._focusPos = { r, c };
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Po změně výběru: přepni třídy řádků a stav checkboxů (bez plného re-renderu). */
  updateSelectionUI() {
    const grid = this.grid;
    if (!grid.isSelectable()) return;
    for (const rowEl of this.nodes.body.querySelectorAll('.lattice-row')) {
      const idx = Number(rowEl.dataset.index);
      const data = grid.rows[idx];
      if (!data) continue; // souhrnné řádky nemají data-index
      const sel = grid.isSelected(data);
      rowEl.classList.toggle('is-selected', sel);
      const cb = rowEl.querySelector('.lattice-select-cb');
      if (cb) cb.checked = sel;
    }
    this.updateSelectAllCheckbox();
    this.renderSelectionBar();
  }

  /**
   * Lišta hromadných akcí nad výběrem. Aktivní jen když jsou zadané
   * `options.selectionActions` a je něco vybráno. Akce dostane vybrané řádky,
   * klíče a grid; aplikace si persistenci/refresh řeší sama.
   */
  renderSelectionBar() {
    const bar = this.nodes.selectionBar;
    if (!bar) return;
    const grid = this.grid;
    const actions = grid.options.selectionActions;
    const n = grid.selected.size;
    clear(bar);
    if (!grid.isSelectable() || !Array.isArray(actions) || !actions.length || n === 0) {
      bar.classList.remove('is-active');
      return;
    }
    const t = grid.i18n.t.bind(grid.i18n);
    bar.appendChild(el('span.lattice-selbar-count', { text: t('selection.count').replace('{n}', n) }));
    for (const a of actions) {
      const b = el('button.lattice-selbar-action' + (a.danger ? '.is-danger' : ''), { type: 'button', title: a.title || '' });
      if (a.icon) b.appendChild(el('span.lattice-selbar-ico', { html: a.icon }));
      b.appendChild(el('span', { text: a.label || '' }));
      b.addEventListener('click', () => { if (typeof a.onClick === 'function') a.onClick(grid.getSelectedRows(), grid.getSelectedKeys(), grid); });
      bar.appendChild(b);
    }
    bar.appendChild(el('span.lattice-selbar-spacer'));
    const clearBtn = el('button.lattice-selbar-clear', { type: 'button', text: t('selection.clear') });
    clearBtn.addEventListener('click', () => grid.clearSelection());
    bar.appendChild(clearBtn);
    bar.classList.add('is-active');
  }

  /** Status bar se souhrnem označeného rozsahu buněk (počet, součet, průměr…). */
  updateRangeStatus(text) {
    const bar = this.nodes.rangeStatus;
    if (!bar) return;
    bar.textContent = text || '';
    bar.classList.toggle('is-active', !!text);
  }

  /**
   * Připnuté řádky (pinnedTop/pinnedBottom) — vždy viditelné bez ohledu na scroll
   * a stránku (souhrnný řádek, „nový záznam", zvýrazněný záznam). Vykreslí se jako
   * datové řádky s třídou is-pinned a nečíselným indexem (nezasahují do editace/výběru).
   */
  renderPinned(list) {
    list = list || this.renderColumns().list;
    const fill = (container, rows, tag) => {
      if (!container) return;
      clear(container);
      const arr = Array.isArray(rows) ? rows : [];
      container.style.display = arr.length ? '' : 'none';
      arr.forEach((rowData, i) => {
        const row = this.buildDataRow(rowData, tag + i, 0, list);
        row.classList.add('is-pinned');
        container.appendChild(row);
      });
    };
    fill(this.nodes.pinnedTop, this.grid.pinnedTop, 'pt');
    fill(this.nodes.pinnedBottom, this.grid.pinnedBottom, 'pb');
    if (this.layout) this.styleCells();
  }

  /** Stav hlavičkového checkboxu (checked / indeterminate dle AKTUÁLNÍHO ROZSAHU). */
  updateSelectAllCheckbox() {
    const grid = this.grid;
    if (!grid.isSelectable()) return;
    const cb = this.nodes.headerRow.querySelector('.lattice-select-all');
    if (!cb) return;
    const rows = grid.scopeRows();
    let sel = 0;
    for (const r of rows) if (grid.selected.has(grid.rowKey(r))) sel++;
    cb.checked = rows.length > 0 && sel === rows.length;
    cb.indeterminate = sel > 0 && sel < rows.length;
    cb.title = grid.selectScope === 'all' ? grid.i18n.t('select.scopeAll', { n: grid.filteredCount() }) : grid.i18n.t('select.scopePage');
  }

  /**
   * Menu výběru: přepínač rozsahu (Stránka / Všechny záznamy) + invertovat + zrušit.
   * Rozsah určuje, na co se vztahuje horní checkbox i invertování.
   */
  openSelectMenu(anchor) {
    const g = this.grid;
    const t = g.i18n.t.bind(g.i18n);
    openMenu(anchor, [
      { value: 'scope-page', label: t('select.scopePage'), active: g.selectScope === 'page' },
      { value: 'scope-all', label: t('select.scopeAll', { n: g.filteredCount() }), active: g.selectScope === 'all' },
      { value: 'invert', label: t('select.invert') },
      { value: 'none', label: t('select.none') },
    ], (v) => {
      if (v === 'scope-page') g.setSelectScope('page');
      else if (v === 'scope-all') g.setSelectScope('all');
      else if (v === 'invert') g.invertSelection();
      else g.clearSelection();
    });
  }

  /**
   * Datový řádek. `index` = původní index v grid.rows (editace / rowClick /
   * číslování), `stripe` = pořadí pro zebra pruhování (odlišné při seskupení).
   */
  buildDataRow(rowData, index, stripe, list) {
    const row = el('div.lattice-row', { dataset: { index: String(index) }, role: 'row' });
    if (stripe % 2) row.classList.add('is-odd');
    const grid = this.grid;
    if (grid.isSelectable()) {
      const sel = grid.isSelected(rowData);
      if (sel) row.classList.add('is-selected');
      row.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
    // Podmíněné formátování řádku (od aplikace): třídy / inline styl dle dat.
    applyCond(row, grid.options.rowClass, grid.options.rowStyle, [rowData, index]);
    for (const col of list) row.appendChild(this.buildBodyCell(col, rowData, index));

    // Cíl přetažení (inside = reparent; jen ve stromovém režimu).
    if (grid.isMovable()) attachDropZone(row, this, () => index, !!grid.tree);

    // Menu řádku se NEspouští z celého řádku (kolidovalo by s buňkami) — jen z
    // # / ID sloupce (viz _attachRowMenuTrigger). Buňky mají vlastní cellContextMenu.

    // Výběr klikem na řádek (když je zapnutý selectRowClick) — ignoruje interaktivní prvky.
    const rowClickCb = grid.options.onRowClick || grid.options.rowClick; // onRowClick preferováno; rowClick = zpětná kompat.
    const rowClickSelect = grid.isSelectable() && grid.instance.selectRowClick;
    if (rowClickSelect || rowClickCb) {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.lattice-resize-handle')) return;
        if (rowClickSelect && !e.target.closest('a, button, input, select, textarea, label, .lattice-select-cell')) {
          if (e.shiftKey && this._lastSelIdx != null) {
            const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
            grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), true);
          } else {
            grid.toggleRow(grid.rowKey(rowData));
          }
          this._lastSelIdx = index;
        }
        if (rowClickCb) rowClickCb(rowData, index, e);
      });
      row.classList.add('is-clickable');
    }

    // Raw pravý klik na řádek (rowContext). Capture fáze, ať se
    // spustí i když buňka svůj contextmenu zastaví (cellContextMenu). Prevenci
    // nativního menu nechává na aplikaci (e.preventDefault() v jejím handleru).
    if (typeof grid.options.onRowContext === 'function') {
      row.addEventListener('contextmenu', (e) => grid.options.onRowContext(rowData, index, e), true);
    }
    return row;
  }

  /** Je pro řádky aktivní rozbalovací detail (uživatelský nebo responsivní kolaps)? */
  _hasDetail() {
    return !!this.grid.detailFn || (this.grid.responsive && this._collapsedCols && this._collapsedCols.length > 0);
  }

  /** Vloží datový řádek a hned za něj (je-li rozbalený) jeho detail panel. */
  _appendRow(frag, rowData, index, stripe, list) {
    frag.appendChild(this.buildDataRow(rowData, index, stripe, list));
    if (this._hasDetail() && this.grid.isDetailExpanded(this.grid.rowKey(rowData))) {
      const d = this.buildDetailRow(rowData, index);
      if (d) frag.appendChild(d);
    }
  }

  /**
   * Full-width řádek s detailem. Obsah = (1) schované sloupce z responsivního
   * kolapsu jako „popisek: hodnota" + (2) volitelný `options.rowDetail`.
   * Vnitřek je sticky-left (vidět i při horizontálním scrollu); šířka = viewport.
   */
  buildDetailRow(rowData, index) {
    const inner = el('div.lattice-detail-inner');
    const w = this.nodes.viewport ? this.nodes.viewport.clientWidth : 0;
    if (w) inner.style.width = w + 'px';

    // (1) responsivně schované sloupce → mřížka popisek/hodnota
    const collapsed = (this.grid.responsive && this._collapsedCols) ? this._collapsedCols : [];
    if (collapsed.length) {
      const grid = el('div.lattice-detail-fields');
      for (const col of collapsed) {
        const formatter = getFormatter(col);
        const out = formatter(cellValue(rowData, col), col, rowData);
        const valEl = el('span.lattice-detail-val');
        if (out instanceof Node) valEl.appendChild(out);
        else valEl.textContent = out == null ? '' : String(out);
        grid.appendChild(el('div.lattice-detail-field', {}, [
          el('span.lattice-detail-label', { text: col.title }),
          valEl,
        ]));
      }
      inner.appendChild(grid);
    }

    // (2) uživatelský detail
    if (this.grid.detailFn) {
      let content;
      try { content = this.grid.detailFn(rowData, index); } catch { content = null; }
      if (content instanceof Node) inner.appendChild(content);
      else if (content != null) {
        const box = el('div.lattice-detail-custom');
        box.innerHTML = String(content);
        inner.appendChild(box);
      }
    }

    if (!inner.childNodes.length) return null;
    return el('div.lattice-detail-row', { role: 'row', dataset: { detailFor: String(index) } }, [inner]);
  }

  /**
   * Přepočítá, které (nefixované) sloupce se při aktuální šířce viewportu schovají
   * do detailu. Vrací true, když se množina schovaných změnila (→ překreslit).
   * Heuristika: fixní šířka (frozen + syntetické + „responsive:false") se rezervuje,
   * zbytek se plní zleva; přetečené sloupce se schovávají v pořadí priority
   * (col.responsive číslo, vyšší dřív) a pak zprava.
   */
  _computeResponsive() {
    const grid = this.grid;
    if (!grid.responsive) {
      const had = this._collapsedSig;
      this._collapsed = null; this._collapsedSig = '';
      return !!had;
    }
    const avail = this.nodes.viewport ? this.nodes.viewport.clientWidth : 0;
    if (!avail) return false;
    const grouped = new Set(grid.groupFields());
    let reserve = 8 + 24; // padding + místo na šipku detailu
    if (grid.isMovable()) reserve += 32;
    if (grid.isSelectable()) reserve += 36;
    if (grid.instance.rowNumbers) reserve += 44;
    let fixed = 0;
    const collapsible = [];
    let idx = 0;
    for (const c of grid.columns) {
      if (!c.visible || grouped.has(c.field)) continue;
      const w = colWidth(c);
      if (c.frozen || c.responsive === false) { fixed += w; continue; }
      collapsible.push({ c, w, prio: typeof c.responsive === 'number' ? c.responsive : 0, i: idx++ });
    }
    const budget = avail - fixed - reserve;
    let sum = collapsible.reduce((a, x) => a + x.w, 0);
    const hideOrder = collapsible.slice().sort((a, b) => (b.prio - a.prio) || (b.i - a.i));
    const collapsedSet = new Set();
    let k = 0;
    while (sum > budget && k < hideOrder.length && collapsedSet.size < collapsible.length - 1) {
      const h = hideOrder[k++];
      collapsedSet.add(h.c.field);
      sum -= h.w;
    }
    const sig = [...collapsedSet].sort().join(',');
    const changed = sig !== (this._collapsedSig || '');
    this._collapsed = collapsedSet.size ? collapsedSet : null;
    this._collapsedSig = sig;
    return changed;
  }

  /** Přepočítá responsivní kolaps a při změně přerenderuje hlavičku i tělo. */
  _reflowResponsive() {
    if (!this.grid.responsive) return;
    if (this._computeResponsive()) {
      this.renderHeader();
      this.applyLayout();
      this.renderBody();
    }
  }

  /**
   * Rekurzivně vykreslí uzly stromu skupin do fragmentu. Sbalený uzel skryje
   * celý svůj podstrom. Zebra pruhování (stripe.n) běží průběžně přes vše.
   */
  renderGroupNodes(nodes, list, frag, stripe) {
    for (const node of nodes) {
      const collapsed = this.grid.isGroupCollapsed(node.key);
      frag.appendChild(this.buildGroupHeader(node, collapsed));
      if (collapsed) continue;
      if (node.rows) {
        for (const { row, index } of node.rows) this._appendRow(frag, row, index, stripe.n++, list);
      } else {
        this.renderGroupNodes(node.groups, list, frag, stripe);
      }
      const sub = this.buildGroupSubtotal(node, list); // mezisoučet za skupinu (opt-in)
      if (sub) frag.appendChild(sub);
    }
  }

  /** Mezisoučet za skupinu řádků — jeden řádek na aktivní souhrnnou funkci. */
  buildGroupSubtotal(node, list) {
    if (!this.grid.instance.groupSubtotals) return null;
    const plan = this._summaryRowPlan(list);
    if (!plan.length) return null;
    const rows = collectGroupRows(node);
    const frag = document.createDocumentFragment();
    for (const r of plan) frag.appendChild(this._summaryRow(list, r, rows, { rowClass: 'lattice-group-subtotal' }));
    return frag;
  }

  /**
   * Klikatelná hlavička skupiny řádků. Roztažená přes celou šířku tabulky,
   * popisek přilepený vlevo (sticky), takže je čitelný i při horizontálním scrollu.
   * Odsazení dle úrovně (node.level); ukazuje hodnotu skupiny a počet řádků.
   */
  buildGroupHeader(node, collapsed) {
    const grid = this.grid;
    const col = grid.columns.find((c) => c.field === node.field);
    const label = this.groupLabel(node.value, col);
    const levelTitle = this.groupLevelTitle(node, col);
    const row = el('div.lattice-rowgroup' + (collapsed ? '.is-collapsed' : ''), {
      dataset: { key: node.key }, role: 'button', tabindex: '0',
      class: 'is-level-' + node.level,
      title: (levelTitle ? levelTitle + ': ' : '') + label,
    });
    // Řadicí šipka: řadí pořadí SKUPIN podle tohoto pole (i když je sloupec
    // skrytý seskupením). Klik nešíří dál, aby neroztahoval/nesbaloval skupinu.
    const dir = grid.sortDir(node.field);
    const sortBtn = el('button.lattice-rowgroup-sort' + (dir ? '.is-' + dir : ''), {
      type: 'button', title: grid.i18n.t('group.sort'),
      text: dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅',
    });
    sortBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    sortBtn.addEventListener('click', (e) => { e.stopPropagation(); grid.cycleGroupSort(node.field); });

    const inner = el('div.lattice-rowgroup-inner', {
      style: { paddingLeft: (10 + node.level * 20) + 'px' },
    }, [
      el('span.lattice-rowgroup-toggle', { html: CHEVRON_SVG }),
      levelTitle ? el('span.lattice-rowgroup-field', { text: levelTitle + ':' }) : null,
      el('span.lattice-rowgroup-title', { text: label }),
      el('span.lattice-rowgroup-count', { text: String(node.count) }),
      sortBtn,
    ]);
    row.appendChild(inner);
    const toggle = () => grid.toggleGroup(node.key);
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    // Přesun mezi skupinami — hlavička skupiny je cíl přetažení řádku.
    if (grid.isMovable()) attachGroupDropZone(row, this, node);
    return row;
  }

  /** Titulek úrovně seskupení: název sloupce, u datumové úrovně + část (např. „Vytvořeno · Kvartál"). */
  groupLevelTitle(node, col) {
    if (!col) return '';
    if (!node.part) return col.title;
    const part = this.grid.i18n.t('group.parts.' + node.part);
    return col.title + ' · ' + part;
  }

  /** Čitelný popisek hodnoty skupiny (prázdné → placeholder, boolean → Ano/Ne). */
  groupLabel(value, col) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    if (value == null || value === '') return t('group.empty');
    if (col && (col.type === 'boolean' || col.type === 'tick')) return value ? t('filters.yes') : t('filters.no');
    return String(value);
  }

  /* -------- řádkové akce -------- */

  /**
   * Vyhodnotí akce pro daný řádek: skryje `visible(row)===false` (řízení
   * přístupu), doplní výchozí ikonu/titulek/danger u známých názvů (edit/view/
   * delete) a spočítá `disabled(row)`.
   */
  resolveActions(row) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    return (this.grid.options.actions || [])
      .filter((a) => typeof a.visible !== 'function' || a.visible(row))
      .map((a) => {
        const def = ACTION_DEFAULTS[a.name] || {};
        const key = 'actions.' + a.name;
        const tr = t(key);
        return {
          name: a.name,
          icon: a.icon != null ? a.icon : (def.icon || '•'),
          title: a.title != null ? a.title : (tr === key ? a.name : tr),
          danger: a.danger != null ? a.danger : !!def.danger,
          disabled: typeof a.disabled === 'function' ? a.disabled(row) : !!a.disabled,
          onClick: a.onClick,
        };
      });
  }

  /** Inline ikony akcí (režim 'column'). */
  buildActionButtons(row, index) {
    const wrap = el('span.lattice-actions');
    for (const a of this.resolveActions(row)) {
      const btn = el('button.lattice-action-btn' + (a.danger ? '.is-danger' : ''), {
        type: 'button', title: a.title, html: a.icon,
      });
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (!a.disabled && a.onClick) a.onClick(row, index, e); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /** ⋮ tlačítko otevírající menu akcí (režim 'menu'); null když řádek nemá akce. */
  buildActionsMenuButton(row, index) {
    if (!this.resolveActions(row).length) return null;
    const btn = el('button.lattice-actions-menu-btn', { type: 'button', title: this.grid.i18n.t('actions.title'), text: '⋮' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.openActionsMenu(btn, row, index); });
    return btn;
  }

  openActionsMenu(anchor, row, index) {
    const actions = this.resolveActions(row);
    const items = actions.map((a) => ({ value: a.name, label: a.title, disabled: a.disabled, danger: a.danger }));
    openMenu(anchor, items, (name) => {
      const a = actions.find((x) => x.name === name);
      if (a && !a.disabled && a.onClick) a.onClick(row, index);
    });
  }

  /** Označí buňku (# nebo ID) jako spouštěč menu řádku — jen PRAVÝ klik. */
  _attachRowMenuTrigger(cell, rowData, index) {
    cell.classList.add('is-row-menu');
    cell.title = this.grid.i18n.t('menu.row');
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.openRowMenu(e.pageX, e.pageY, rowData, index); });
  }

  /** Otevře kontextové menu řádku na souřadnicích. Vrátí true, když se otevřelo. */
  openRowMenu(x, y, row, index) {
    const build = this.grid.options.rowContextMenu;
    if (typeof build !== 'function') return false;
    const items = build(row, index);
    if (!items || !items.length) return false;
    openMenuAt(x, y, items, (v, it) => it && it.action && it.action(row, index));
    return true;
  }

  /** Položky menu hlavičky sloupce: vestavěné příkazy + vlastní (col.headerMenu). */
  headerMenuItems(col) {
    const g = this.grid;
    const t = g.i18n.t.bind(g.i18n);
    const sortState = g.sort.find((s) => s.field === col.field);
    const items = [
      { label: t('menu.sortAsc'), active: sortState && sortState.dir === 'asc', action: () => g.sortColumn(col.field, 'asc') },
      { label: t('menu.sortDesc'), active: sortState && sortState.dir === 'desc', action: () => g.sortColumn(col.field, 'desc') },
    ];
    if (sortState) items.push({ label: t('menu.sortClear'), action: () => g.sortColumn(col.field, null) });
    items.push({ separator: true }, { label: t('menu.hide'), action: () => g.setColumnVisible(col.field, false) });
    if (col.frozenAllowed !== false) {
      items.push(
        { label: t('menu.pinLeft'), active: col.frozen === true || col.frozen === 'left', action: () => g.setColumnFrozen(col.field, true) },
        { label: t('menu.pinRight'), active: col.frozen === 'right', action: () => g.setColumnFrozen(col.field, 'right') },
      );
      if (col.frozen) items.push({ label: t('menu.unpin'), action: () => g.setColumnFrozen(col.field, false) });
    }
    items.push(
      { separator: true },
      { label: g.isRowGrouped(col.field) ? t('menu.ungroup') : t('menu.groupBy'), action: () => g.toggleRowGroup(col.field) },
      { label: t('menu.fitWidth'), action: () => g.autoFitColumn(col.field) },
    );
    const custom = typeof col.headerMenu === 'function' ? col.headerMenu(col) : (Array.isArray(col.headerMenu) ? col.headerMenu : null);
    if (custom && custom.length) items.push({ separator: true }, ...custom);
    return items;
  }

  /**
   * Souhrnný blok — jeden řádek na každou vybranou funkci (v pevném pořadí
   * SUMMARY_ORDER), napříč všemi sloupci. Popisek funkce v číslovacím sloupci;
   * když číslování není zobrazeno, ukáže se symbol u každé hodnoty.
   * Přepínač rozsahu (Stránka ↔ Vše) je v prvním řádku.
   */
  buildSummary(list, scope) {
    const grid = this.grid;
    const plan = this._summaryRowPlan(list);
    if (!plan.length) return null;
    const srcRows = grid.summarySource(scope);
    const wrap = el('div.lattice-summary');
    plan.forEach((r, i) => wrap.appendChild(this._summaryRow(list, r, srcRows, { first: i === 0, floatLabel: true })));
    return wrap;
  }

  /**
   * Plán souhrnných řádků: nejdřív standardní funkce (v pořadí SUMMARY_ORDER),
   * pak vzorce s vlastním názvem. Vzorec pojmenovaný STEJNĚ jako standardní řádek
   * (např. „Průměr") se do něj sloučí — nevytvoří vlastní řádek. Každá položka:
   * `{ label, fn }` (fn = klíč standardní funkce, nebo null u čistě vzorcového řádku).
   */
  _summaryRowPlan(list) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const plan = [];
    const labels = new Set();
    for (const fn of SUMMARY_ORDER) {
      if (list.some((c) => (c.summary || []).includes(fn))) {
        const label = t('summary.name.' + fn);
        plan.push({ label, fn });
        labels.add(label);
      }
    }
    const defLbl = t('summary.formulaLabel');
    for (const c of list) {
      if (!c.summaryFormula) continue;
      const lbl = c.summaryFormulaLabel || defLbl;
      if (!labels.has(lbl)) { labels.add(lbl); plan.push({ label: lbl, fn: null }); }
    }
    return plan;
  }

  /**
   * Jeden souhrnný řádek dle plánu (`rowSpec = { label, fn }`) nad `srcRows`.
   * Sdílené pro patu i mezisoučty skupin. V každé buňce má vzorec (ƒ) přednost
   * před standardní funkcí — tak se vážený vzorec zobrazí ve „svém" řádku i když
   * je pojmenovaný jako funkce.
   */
  _summaryRow(list, rowSpec, srcRows, opts = {}) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const defFormulaLbl = t('summary.formulaLabel');
    const row = el('div.lattice-row.lattice-summary-row'
      + (opts.rowClass ? '.' + opts.rowClass : '') + (opts.first ? '.is-first' : ''));
    for (const col of list) {
      const cell = el('div.lattice-cell.lattice-summary-cell', {
        dataset: { field: col.field }, class: col.align ? 'is-' + col.align : '',
      });
      if (!col._rownum) {
        const colFormulaLbl = col.summaryFormula ? (col.summaryFormulaLabel || defFormulaLbl) : null;
        if (colFormulaLbl === rowSpec.label) {
          // Vážený vzorec (má přednost) — symbol ƒ naznačuje výpočet vzorcem.
          let val = null;
          try { val = compileAggregate(col.summaryFormula)(srcRows); } catch { val = null; }
          cell.appendChild(el('span.lattice-summary-sym.is-formula', { text: 'ƒ', title: col.summaryFormula }));
          cell.appendChild(el('span.lattice-summary-val', { text: this.formatSummaryValue('formula', val, col) }));
        } else if (rowSpec.fn && (col.summary || []).includes(rowSpec.fn) && (rowSpec.fn === 'count' || isNumericType(col.type))) {
          const val = computeSummary(rowSpec.fn, col, srcRows);
          cell.appendChild(el('span.lattice-summary-sym', { text: SUMMARY_SYMBOL[rowSpec.fn], title: t('summary.name.' + rowSpec.fn) }));
          cell.appendChild(el('span.lattice-summary-val', { text: this.formatSummaryValue(rowSpec.fn, val, col) }));
        }
      }
      row.appendChild(cell);
    }
    if (opts.floatLabel) {
      const lbl = el('span.lattice-summary-rowlabel', { text: rowSpec.label, title: rowSpec.label });
      row.appendChild(el('div.lattice-summary-label-wrap', {}, [lbl]));
    }
    return row;
  }

  /** Pruh nad dolní paticí s přepínačem rozsahu souhrnu (Stránka / Vše). */
  renderSummaryBar() {
    const bar = this.nodes.summaryBar;
    clear(bar);
    const grid = this.grid;
    const scope = grid.instance.summaryRow;
    const anySummary = grid.columns.some((c) => (c.summary || []).length || c.summaryFormula);
    if (scope === 'none' || !anySummary) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    const t = grid.i18n.t.bind(grid.i18n);

    const label = el('span.lattice-summary-bar-label', { text: t('summary.barLabel') });
    const toggle = el('button.lattice-summary-bar-toggle', {
      type: 'button', title: t('summary.scopeToggle'),
      text: scope === 'all' ? t('summary.scopeAllLong') : t('summary.scopePageLong'),
    });
    toggle.addEventListener('click', () => grid.toggleSummaryScope());
    bar.append(label, toggle);
  }

  formatSummaryValue(fn, val, col) {
    if (val == null || (typeof val === 'number' && !Number.isFinite(val))) return '';
    if (fn === 'count') return String(val);
    if (col.type === 'money') return getFormatter(col)(val, col, {});
    // vzorec (vážený souhrn) i průměr ukazujeme s desetinami (poměry), zbytek celé.
    const maxdec = (fn === 'avg' || fn === 'formula') ? 2 : 0;
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: maxdec });
  }

  /** Aplikuje uživatelský „formát buňky" (zarovnání, řez písma, barvy) na buňku. */
  applyCellFormat(cell, col) {
    const cf = col.cellFormat;
    if (!cf) return;
    if (cf.align) {
      cell.classList.remove('is-left', 'is-center', 'is-right');
      cell.classList.add('is-' + cf.align);
    }
    if (cf.bold) cell.style.fontWeight = '700';
    if (cf.italic) cell.style.fontStyle = 'italic';
    const deco = [];
    if (cf.underline) deco.push('underline');
    if (cf.strike) deco.push('line-through');
    if (deco.length) cell.style.textDecoration = deco.join(' ');
    if (cf.color) cell.style.color = cf.color;
    if (cf.background) cell.style.background = cf.background;
  }

  buildBodyCell(col, rowData, index) {
    // Proužek sbalené skupiny sloupců — prázdná buňka.
    if (col._colGroupStrip) {
      return el('div.lattice-cell.lattice-colgroup-strip', { dataset: { field: col.field } });
    }
    // Sloupec akcí — inline ikony.
    if (col._actions) {
      const cell = el('div.lattice-cell.lattice-actions-cell', { dataset: { field: col.field }, class: 'is-center' });
      cell.appendChild(this.buildActionButtons(rowData, index));
      return cell;
    }
    // Gutter s ⋮ menu akcí.
    if (col._actionsMenu) {
      const cell = el('div.lattice-cell.lattice-actions-cell', { dataset: { field: col.field }, class: 'is-center' });
      const btn = this.buildActionsMenuButton(rowData, index);
      if (btn) cell.appendChild(btn);
      return cell;
    }
    // Sloupec s úchytem pro tažení řádku.
    if (col._move) {
      const cell = el('div.lattice-cell.lattice-move-cell', { dataset: { field: col.field }, class: 'is-center' });
      const grip = el('span.lattice-move-grip', { title: this.grid.i18n.t('move.drag'), text: '⠿' });
      attachMoveHandle(grip, this, () => index);
      cell.appendChild(grip);
      return cell;
    }
    // Výběrový sloupec — checkbox (podpora shift-výběru rozsahu).
    if (col._select) {
      const grid = this.grid;
      const cell = el('div.lattice-cell.lattice-select-cell', { dataset: { field: col.field }, class: 'is-center' });
      const cb = el('input.lattice-select-cb', { type: 'checkbox', checked: grid.isSelected(rowData) });
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.shiftKey && this._lastSelIdx != null) {
          const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
          grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), cb.checked);
        } else {
          grid.setRowSelected(grid.rowKey(rowData), cb.checked);
        }
        this._lastSelIdx = index;
      });
      cell.appendChild(cb);
      return cell;
    }
    // Sloupec s čísly řádků — číslo zobrazených řádků dle režimu.
    if (col._rownum) {
      const num = col._mode === 'perPage'
        ? index + 1
        : (this.grid.page - 1) * this.grid.pageSize + index + 1;
      const cell = el('div.lattice-cell.lattice-rownum', {
        dataset: { field: col.field }, class: 'is-' + (col.align || 'right'),
      });
      // V režimu 'menu' je uvnitř číslovacího sloupce ⋮ tlačítko akcí (za číslem), jinak jen číslo.
      if (col._menuActions) {
        cell.classList.add('has-actions-menu');
        cell.appendChild(el('span.lattice-rownum-num', { text: String(num) }));
        const btn = this.buildActionsMenuButton(rowData, index);
        if (btn) cell.appendChild(btn);
      } else {
        cell.textContent = String(num);
        // Číslovací sloupec jako spouštěč menu řádku (levý klik) — nekoliduje s buňkami.
        if (typeof this.grid.options.rowContextMenu === 'function') this._attachRowMenuTrigger(cell, rowData, index);
      }
      return cell;
    }
    // Souhrn řádku (pravý syntetický sloupec) — agregace přes zapojené sloupce.
    if (col._rowsum) {
      const val = computeRowSummary(col._fn, col._cols, rowData);
      const cell = el('div.lattice-cell.lattice-rowsum-cell', { dataset: { field: col.field }, class: 'is-right' });
      cell.appendChild(el('span.lattice-summary-val', {
        text: this.formatSummaryValue(col._fn, val, col._cols[0] || col),
      }));
      return cell;
    }
    const value = cellValue(rowData, col);
    // Typ 'id' a odvozené (computed) sloupce se nikdy needitují.
    const editable = col.type !== 'id' && !isComputed(col) && (col.editable === true || this.grid.options.editable === true);
    const cell = el('div.lattice-cell', {
      dataset: { field: col.field }, role: 'gridcell',
      class: [col.align ? 'is-' + col.align : '', editable ? 'is-editable' : ''].filter(Boolean).join(' '),
      title: editable ? this.grid.i18n.t('edit.hint') : undefined,
    });
    this.applyCellFormat(cell, col); // vzhled buňky (zarovnání, řez, barvy) z UI
    const formatter = getFormatter(col);
    const out = formatter(value, col, rowData);
    if (out instanceof Node) cell.appendChild(out);
    else if (out == null || out === '') {
      // Prázdná hodnota → volitelný placeholder (např. „—").
      const ph = this.grid.instance.emptyText;
      if (ph) cell.appendChild(el('span.lattice-empty-cell', { text: ph }));
    } else cell.textContent = String(out);

    // Podmíněná barevná škála (semafor) — konfigurovatelná v UI (dialog Sloupce).
    const scale = condScaleColor(col, value, this.grid);
    if (scale) {
      if (scale.bg) { cell.style.backgroundColor = scale.bg; if (scale.fg) cell.style.color = scale.fg; cell.classList.add('is-condscale'); }
      if (scale.text) { cell.style.color = scale.text; cell.style.fontWeight = '600'; }
    }
    // Podmíněné formátování buňky (od aplikace): třídy / inline styl dle hodnoty.
    applyCond(cell, col.cellClass, col.cellStyle, [value, rowData, col]);

    // ⋮ menu akcí hostované v ID sloupci (režim 'menu' bez číslování řádků).
    if (this._menuIdField && col.field === this._menuIdField) {
      const txt = cell.textContent;
      cell.textContent = '';
      cell.classList.add('has-actions-menu');
      cell.appendChild(el('span.lattice-rownum-num', { text: txt }));
      const btn = this.buildActionsMenuButton(rowData, index);
      if (btn) cell.appendChild(btn);
    }

    // Buňka typu 'id' spouští menu ŘÁDKU (needituje se, nemá cell menu).
    if (col.type === 'id' && typeof this.grid.options.rowContextMenu === 'function') {
      this._attachRowMenuTrigger(cell, rowData, index);
    } else if (typeof this.grid.options.cellContextMenu === 'function') {
      // Kontextové menu BUŇKY (pravý klik) — jiné než menu řádku (např. „Editovat zde").
      cell.addEventListener('contextmenu', (e) => {
        const ctx = { row: rowData, value, field: col.field, index, col, cell, grid: this.grid };
        const items = this.grid.options.cellContextMenu(ctx);
        if (!items || !items.length) return;
        e.preventDefault(); e.stopPropagation();
        openMenuAt(e.pageX, e.pageY, items, (v, it) => it && it.action && it.action(ctx));
      });
    }

    // Tree režim: první datový sloupec dostane odsazení dle hloubky + šipku.
    if (this._treeColField && col.field === this._treeColField && this.grid.treeView) {
      const meta = this.grid.treeView[index];
      if (meta) this.decorateTreeCell(cell, meta);
    }

    // Master-detail: šipka pro rozbalení detailu do prvního datového sloupce.
    if (this._detailColField && col.field === this._detailColField) {
      const key = this.grid.rowKey(rowData);
      const expanded = this.grid.isDetailExpanded(key);
      const toggle = el('button.lattice-detail-toggle' + (expanded ? '.is-expanded' : ''), {
        type: 'button', html: CHEVRON_SVG, title: this.grid.i18n.t('detail.toggle'),
        'aria-expanded': expanded ? 'true' : 'false',
      });
      toggle.addEventListener('click', (e) => { e.stopPropagation(); this.grid.toggleDetail(key); });
      cell.classList.add('is-detail-cell');
      cell.prepend(toggle);
    }

    // Popup buňky (klik → plovoucí panel s obsahem od aplikace).
    if (typeof col.cellPopup === 'function') {
      cell.classList.add('is-popup');
      cell.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select, textarea')) return;
        e.stopPropagation();
        openPopup(cell, (close) => col.cellPopup({ row: rowData, value, field: col.field, index, cell, grid: this.grid, close }));
      });
    }

    // Raw klik na buňku (cellClick) — ignoruje interaktivní prvky.
    if (typeof this.grid.options.onCellClick === 'function') {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select, textarea, label')) return;
        this.grid.options.onCellClick({ row: rowData, value, field: col.field, index, col, cell, grid: this.grid }, e);
      });
    }
    return cell;
  }

  /** Vloží do buňky odsazení podle hloubky a rozbalovací šipku (nebo prázdné místo u listů). */
  decorateTreeCell(cell, meta) {
    cell.classList.add('is-tree-cell');
    const indent = el('span.lattice-tree-indent', { style: { width: meta.depth * 20 + 'px' } });
    let toggle;
    if (meta.hasChildren) {
      toggle = el('span.lattice-tree-toggle' + (meta.expanded ? '.is-expanded' : ''), { html: CHEVRON_SVG });
      toggle.addEventListener('click', (e) => { e.stopPropagation(); this.grid.tree.toggle(meta.key); });
    } else {
      toggle = el('span.lattice-tree-toggle.is-leaf');
    }
    cell.prepend(toggle);
    cell.prepend(indent);
  }

  renderFooter() {
    // Progresivní režim: místo paginátoru info „Načteno X z N" (+ tlačítko „Načíst další").
    if (this.grid.progressive) { this._renderProgressiveFooter(); return; }
    // Paginace v záhlaví / zápatí / obojím / nikde (dle instance.paginationPosition).
    const pos = this.grid.instance.paginationPosition;
    this._renderPager(this.nodes.footer, pos === 'footer' || pos === 'both');
    this._renderPager(this.nodes.topPager, pos === 'header' || pos === 'both');
  }

  _renderProgressiveFooter() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    clear(this.nodes.topPager); this.nodes.topPager.style.display = 'none';
    const footer = this.nodes.footer;
    clear(footer); footer.style.display = '';
    const info = el('div.lattice-page-info', {
      text: t('progressive.loaded', { loaded: grid.rows.length, total: grid.total }),
    });
    footer.appendChild(info);
    if (grid.progressiveDone()) {
      footer.appendChild(el('span.lattice-progressive-done', { text: t('progressive.allLoaded') }));
    } else if (grid.progressive === 'load') {
      const btn = el('button.lattice-load-more', {
        type: 'button',
        text: grid._loadingMore ? t('progressive.loading') : t('progressive.loadMore', { n: grid.total - grid.rows.length }),
      });
      btn.disabled = !!grid._loadingMore;
      btn.addEventListener('click', () => grid.loadMore());
      footer.appendChild(btn);
    } else if (grid._loadingMore) {
      footer.appendChild(el('span.lattice-progressive-done', { text: t('progressive.loading') }));
    }
  }

  /** Vizuální stav „dobírám další stránku" (jen aktualizuje patičku). */
  setProgressiveLoading() { if (this.grid.progressive) this.renderFooter(); }

  _renderPager(container, show) {
    if (show) {
      container.style.display = '';
      this.grid.pagination.render(container);
    } else {
      clear(container);
      container.style.display = 'none';
    }
  }

  /**
   * Ikona toolbaru — knihovna dodává bezzávislostní SVG default, hostitelská
   * aplikace ho může přepsat přes options.icons (např. Bootstrap Icons v EverFLOW:
   *   icons: { settings: '<i class="bi bi-gear"></i>', columns: '<i class="bi bi-layout-three-columns"></i>' }).
   * Klíče: 'settings', 'columns', 'advancedFilter'.
   */
  icon(name, fallback) {
    const custom = this.grid.options.icons && this.grid.options.icons[name];
    return custom != null && custom !== '' ? custom : fallback;
  }

  /** Ovládání historie: undo · redo · vymazat historii. */
  buildHistoryControls() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const h = grid.history;
    const wrap = el('div.lattice-hist-controls');
    const btn = (html, title, on, disabled) => {
      const b = el('button.lattice-hist-btn', { type: 'button', title, html });
      b.disabled = disabled;
      if (!disabled) b.addEventListener('click', on);
      return b;
    };
    wrap.append(
      btn(UNDO_SVG, t('history.undo') + (h.undoSize() ? ' (' + h.undoSize() + ')' : ''), () => grid.undo(), !h.canUndo()),
      btn(REDO_SVG, t('history.redo') + (h.redoSize() ? ' (' + h.redoSize() + ')' : ''), () => grid.redo(), !h.canRedo()),
      btn(CLEAR_HIST_SVG, t('history.clear'), () => grid.clearHistory(), !h.canUndo() && !h.canRedo()),
    );
    return wrap;
  }

  /** Ovládání úrovní stromu: sbalit vše · − úroveň · N/M · + úroveň · rozbalit vše. */
  buildTreeControls() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const tree = grid.tree;
    const wrap = el('div.lattice-tree-controls');
    const readout = el('span.lattice-tree-level', { text: (tree.level ?? 0) + ' / ' + (tree.depthMax || 0) });
    const sync = () => { readout.textContent = (tree.level ?? 0) + ' / ' + (tree.depthMax || 0); };
    const btn = (label, title, on) => {
      const b = el('button.lattice-tree-btn', { type: 'button', title, text: label });
      b.addEventListener('click', () => { on(); sync(); });
      return b;
    };
    wrap.append(
      btn(t('tree.collapseAll'), t('tree.collapseAll'), () => tree.collapseAll()),
      btn('−', t('tree.levelDown'), () => tree.stepLevel(-1)),
      el('span.lattice-tree-level-wrap', {}, [el('span.lattice-tree-level-cap', { text: t('tree.level') }), readout]),
      btn('+', t('tree.levelUp'), () => tree.stepLevel(1)),
      btn(t('tree.expandAll'), t('tree.expandAll'), () => tree.expandAll()),
    );
    return wrap;
  }

  renderToolbar() {
    const { toolbar } = this.nodes;
    clear(toolbar);
    const f = this.grid.options.features || {};
    // Levá skupina toolbaru: historie (undo/redo) + ovládání úrovní stromu.
    const leftGroup = el('div.lattice-toolbar-left');
    if (this.grid.history) leftGroup.appendChild(this.buildHistoryControls());
    if (this.grid.tree) leftGroup.appendChild(this.buildTreeControls());
    // Rychlé hledání přes všechny sloupce (opt-in přes options.quickSearch).
    if (this.grid.options.quickSearch) {
      const search = el('input.lattice-quicksearch', {
        type: 'search', placeholder: this.grid.i18n.t('filters.quickSearch'), value: this.grid.quickSearch || '',
      });
      let deb;
      search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => this.grid.setQuickSearch(search.value), 200); });
      leftGroup.appendChild(search);
    }
    if (leftGroup.children.length) toolbar.appendChild(leftGroup);
    // Mazací ikona (trychtýř s červeným křížkem): zruší VŠECHNY aplikované filtry
    // (sloupcové/univerzální/rozšířený). Viditelná jen když nějaký filtr platí.
    // Uložené rozšířené filtry nemaže.
    const clearBtn = el('button.lattice-tool-btn.lattice-clear-filters' + (this.grid.hasActiveFilters() ? '.is-visible' : ''), {
      type: 'button', title: this.grid.i18n.t('columns.clearFilters'), html: CLEAR_FILTER_SVG,
    });
    clearBtn.addEventListener('click', () => this.grid.clearAllFilters());
    toolbar.appendChild(clearBtn);
    if (f.advancedFilter !== false) {
      const grid = this.grid;
      const t = grid.i18n.t.bind(grid.i18n);
      const advBtn = el('button.lattice-tool-btn', {
        type: 'button', title: t('advanced.title'),
        class: grid.advancedActive() ? 'is-active' : '', html: this.icon('advancedFilter', ADV_SVG),
      });
      advBtn.addEventListener('click', () => grid.advancedFilter.toggle(advBtn));
      toolbar.appendChild(advBtn);

      // Rychlý výběr uloženého rozšířeného filtru přímo v toolbaru (když nějaký je).
      const saved = grid.listAdvanced();
      if (saved.length) {
        const sel = el('select.lattice-adv-quick', { title: t('advanced.title') });
        sel.appendChild(el('option', { value: '', text: t('advanced.savedPlaceholder') }));
        for (const s of saved) sel.appendChild(el('option', { value: s.id, text: s.name }));
        sel.value = grid.activeSavedId();
        sel.addEventListener('change', () => {
          if (!sel.value) { grid.clearAdvanced(); return; }
          const item = saved.find((x) => x.id === sel.value);
          if (item) grid.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
        });
        toolbar.appendChild(sel);
      }
    }
    if (f.gear !== false) {
      const gearBtn = el('button.lattice-tool-btn', { type: 'button', title: this.grid.i18n.t('columns.manage'), html: this.icon('columns', GEAR_SVG) });
      gearBtn.addEventListener('click', () => this.grid.gear.toggle(gearBtn));
      toolbar.appendChild(gearBtn);
    }
    if (f.instanceSettings !== false) {
      const setBtn = el('button.lattice-tool-btn', { type: 'button', title: this.grid.i18n.t('instance.title'), html: this.icon('settings', COG_SVG) });
      // Tečka signalizuje nové globální výchozí nastavení od správce (k použití).
      if (this.grid.globalDefaultsAvailable()) setBtn.classList.add('has-gd-note');
      setBtn.addEventListener('click', () => this.grid.instanceSettings.toggle(setBtn));
      toolbar.appendChild(setBtn);
    }
    // Nápověda: odkaz na uživatelskou příručku (nová karta). Výchozí je oficiální
    // URL; aplikace ji přepíše options.helpUrl, nebo skryje ikonu options.helpUrl: null.
    const helpUrl = this.grid.options.helpUrl === undefined ? DEFAULT_HELP_URL : this.grid.options.helpUrl;
    if (f.help !== false && helpUrl) {
      toolbar.appendChild(el('a.lattice-tool-btn.lattice-help-btn', {
        href: helpUrl, target: '_blank', rel: 'noopener noreferrer',
        title: this.grid.i18n.t('help.title'), html: HELP_SVG,
      }));
    }
  }

  /** Ukáže/skryje mazací ikonu filtrů v záhlaví podle toho, zda je nějaký aplikován. */
  updateFilterClearBtn() {
    const btn = this.nodes.toolbar && this.nodes.toolbar.querySelector('.lattice-clear-filters');
    if (btn) btn.classList.toggle('is-visible', this.grid.hasActiveFilters());
  }

  /* -------- overlay stavy -------- */

  setLoading(on) {
    this.nodes.root.classList.toggle('is-loading', !!on);
    if (on) this.showOverlay(this.grid.i18n.t('loading'), 'loading');
    else this.updateOverlay();
  }
  setError(msg) {
    this.showOverlay(msg || this.grid.i18n.t('error'), 'error');
  }
  updateOverlay() {
    const empty = !this.grid.rows || this.grid.rows.length === 0;
    if (empty && !this.nodes.root.classList.contains('is-loading')) {
      this.showOverlay(this.grid.i18n.t('empty'), 'empty');
    } else {
      this.hideOverlay();
    }
  }
  showOverlay(text, kind) {
    const o = this.nodes.overlay;
    o.className = 'lattice-overlay is-' + kind;
    o.textContent = text;
    o.style.display = 'flex';
  }
  hideOverlay() {
    this.nodes.overlay.style.display = 'none';
  }

  /* -------- vzhled instance (density/font/layout) -------- */

  applyInstanceStyles() {
    const { root } = this.nodes;
    const inst = this.grid.instance;
    root.classList.toggle('is-compact', inst.density === 'compact');
    root.classList.toggle('is-comfortable', inst.density !== 'compact');
    root.classList.toggle('layout-fit', inst.layout === 'fit');
    root.classList.toggle('layout-fitData', inst.layout !== 'fit');
    root.classList.toggle('no-zebra', inst.zebra === false);
    root.classList.toggle('wrap-text', inst.wrapText === true);
    root.classList.toggle('wrap-header', inst.wrapHeader === true);
    // Motiv — atribut na <html>, aby ho dědil grid i plovoucí panely na body.
    const theme = inst.theme && inst.theme !== 'default' ? inst.theme : null;
    if (theme) document.documentElement.setAttribute('data-lattice-theme', theme);
    else document.documentElement.removeAttribute('data-lattice-theme');

    // Vlastní CSS proměnné (přepíšou motiv pro tento grid) — inline na rootu, takže
    // vyhrají nad :root motivem. Nejdřív uklidit dřívější, ať nezůstávají staré.
    for (const name of (this._cssVarNames || [])) root.style.removeProperty(name);
    const applied = [];
    const cv = inst.cssVars || {};
    for (const name in cv) {
      if (String(name).startsWith('--lattice-') && cv[name] != null && cv[name] !== '') {
        root.style.setProperty(name, cv[name]); applied.push(name);
      }
    }
    this._cssVarNames = applied;

    // Font a velikost písma mají vlastní ovládání — nastavit AŽ po cssVars (mají přednost).
    root.style.setProperty('--lattice-font-size', (inst.fontSize || 14) + 'px');
    if (inst.fontFamily) root.style.setProperty('--lattice-font', inst.fontFamily);
    else if (!('--lattice-font' in cv)) root.style.removeProperty('--lattice-font');

    // Boolean ✓/✕ barvy = krajní barvy semaforu (scaleColors), ať ladí s podmíněnou
    // škálou: pravda = horní (zelená), nepravda = dolní (červená). cssVars mají přednost.
    const sc = (Array.isArray(inst.scaleColors) && inst.scaleColors.length === 3) ? inst.scaleColors : DEFAULT_SCALE_COLORS;
    if (!('--lattice-bool-true' in cv)) root.style.setProperty('--lattice-bool-true', sc[2]);
    if (!('--lattice-bool-false' in cv)) root.style.setProperty('--lattice-bool-false', sc[0]);
  }
}

/**
 * Podmíněné formátování — aplikuje na element třídy (funkce → string|string[])
 * a/nebo inline styl (funkce → objekt CSS vlastností). Ticho ignoruje chyby.
 */
function applyCond(node, classFn, styleFn, args) {
  if (typeof classFn === 'function') {
    try {
      const c = classFn(...args);
      const cls = Array.isArray(c) ? c : (c ? String(c).split(/\s+/) : []);
      for (const x of cls) if (x) node.classList.add(x);
    } catch { /* no-op */ }
  }
  if (typeof styleFn === 'function') {
    try {
      const s = styleFn(...args);
      if (s && typeof s === 'object') for (const k in s) node.style[k] = s[k];
    } catch { /* no-op */ }
  }
}

/**
 * Barva buňky pro podmíněnou škálu (semafor): hodnotu zařadí mezi prahy do
 * hladiny 0..(levels-1) a vrátí barvu z červené→zelené (reverse ji obrátí).
 */
function condScaleColor(col, value, grid) {
  const cf = col.condFormat;
  if (!cf || !cf.on) return null;
  const v = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const levels = cf.levels || 3;
  const th = (Array.isArray(cf.thresholds) && cf.thresholds.length === levels - 1) ? cf.thresholds : grid.autoThresholds(col.field, levels);
  if (!th || !th.length) return null;
  const idx = levelIndex(v, th);
  // Barvy kotev: výjimka sloupce (cf.colors) > globální nastavení tabulky > výchozí.
  const colors = (Array.isArray(cf.colors) && cf.colors.length === 3) ? cf.colors : (grid.instance.scaleColors || DEFAULT_SCALE_COLORS);
  return levelColor(colors, idx, levels, cf.reverse, cf.mode);
}

/** Sesbírá všechny datové řádky pod uzlem skupiny (rekurzivně přes podskupiny). */
function collectGroupRows(node) {
  if (node.rows) return node.rows.map((r) => r.row);
  const out = [];
  for (const g of node.groups || []) out.push(...collectGroupRows(g));
  return out;
}

/** Zploští strom skupin do plochého pole { row, index } v pořadí skupin (režim 'columns'). */
function flattenGroupItems(nodes, out = []) {
  for (const node of nodes) {
    if (node.rows) out.push(...node.rows);
    else flattenGroupItems(node.groups || [], out);
  }
  return out;
}

// operátory univerzálního filtru + !like
const UNIVERSAL_OPS = [
  { op: 'eq', label: '=' }, { op: 'lt', label: '<' }, { op: 'lte', label: '<=' },
  { op: 'gt', label: '>' }, { op: 'gte', label: '>=' }, { op: 'neq', label: '!=' },
  { op: 'contains', label: 'like' }, { op: 'ncontains', label: '!like' },
];

const FILTER_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
// nálevka s ozubením/hvězdičkou = rozšířený filtr
// Rozšířený filtr: trychtýř s výraznější hvězdičkou (větší, čitelnější).
// Rozšířený filtr: trychtýř s výrazným „+" (přidání podmínek) — zlatý, čitelný i v aktivním stavu.
const ADV_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h14l-5 6.5v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-star-on, #f5b301)" stroke-width="3" stroke-linecap="round" d="M18 11.5v7m-3.5-3.5h7"/></svg>';
const GEAR_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 4h12v1.5H2zM2 7.25h12v1.5H2zM2 10.5h12V12H2z"/></svg>';
// Trychtýř s výrazným ČERVENÝM křížkem — zrušení všech filtrů (danger barva).
const CLEAR_FILTER_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
// Undo/redo — zakřivené šipky; ✕ pro vymazání historie.
const UNDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></svg>';
const REDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h2"/></svg>';
const CLEAR_HIST_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// Chevron dolů (rozbaleno); CSS ho u sbalené skupiny otočí na -90°.
const CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>';
// Šířka proužku sbalené skupiny sloupců (jen ikona pro rozbalení).
const COLGROUP_STRIP_W = 34;

/** Odhad šířky sloupce pro responsivní výpočet (uživatelská → min → default). */
function colWidth(c) {
  const w = Number(c.width) || Number(c.minWidth) || 0;
  return w > 0 ? w : 120;
}
// Výchozí ikony běžných akcí (aplikace je může přepsat vlastní `icon`).
const EYE_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 3C4.5 3 1.7 5.1.5 8c1.2 2.9 4 5 7.5 5s6.3-2.1 7.5-5C14.3 5.1 11.5 3 8 3zm0 8.3A3.3 3.3 0 118 4.7a3.3 3.3 0 010 6.6zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z"/></svg>';
const PENCIL_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12.1 1.6a1.4 1.4 0 012 2l-.9.9-2-2 .9-.9zM10 3.2l2 2-6.7 6.7-2.6.6.6-2.6L10 3.2z"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2zm-2.5 4h9l-.7 8.3a1 1 0 01-1 .9H5.2a1 1 0 01-1-.9L3.5 6zm2.7 1.5.3 6h1l-.3-6h-1zm3.6 0-.3 6h1l.3-6h-1z"/></svg>';
const ACTION_DEFAULTS = {
  view: { icon: EYE_SVG },
  edit: { icon: PENCIL_SVG },
  delete: { icon: TRASH_SVG, danger: true },
};
// Obrysové ozubené kolo (Bootstrap Icons „bi-gear", MIT) — bezzávislostní inline SVG.
const COG_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/></svg>';
const HELP_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/></svg>';
const DEFAULT_HELP_URL = 'https://lattice.rudolfsvatek.cz/prirucka/';
