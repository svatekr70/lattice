/**
 * Nastavení instance gridu — modální okno se skupinami voleb.
 *   Vzhled · Rozvržení · Stránkování a filtry · Sloupce a řádky · Formát hodnot.
 * Vše se persistuje do téhož stavu (grid.saveState) a projeví se ihned.
 */
import { el, clear } from '../util/dom.js';
import { CURRENCIES, DATE_PRESETS, DATETIME_PRESETS, TIME_PRESETS, formatDate } from '../core/format.js';
import { DEFAULT_SCALE_COLORS } from '../core/colorScale.js';
import { openColorPicker } from './headerColor.js';

const SAMPLE_DATE = new Date(2026, 2, 5, 9, 7, 3); // 5. březen 2026, 9:07:03 — jednociferné dny/měsíce/hodiny odliší dd↔d, mm↔m, HH↔H

export class InstanceSettings {
  constructor(grid) {
    this.grid = grid;
    this.overlay = null;
  }

  toggle() {
    if (this.overlay) return this.close();
    this.open();
  }

  open() {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const overlay = el('div.lattice-modal-overlay');
    const modal = el('div.lattice-modal');
    const head = el('div.lattice-modal-head', {}, [
      el('span.lattice-modal-title', { text: t('instance.title') }),
      el('button.lattice-modal-x', { type: 'button', title: t('instance.done'), text: '×' }),
    ]);
    const bodyEl = el('div.lattice-modal-body');
    this.render(bodyEl);
    const footChildren = [];
    if (this.grid.canSaveGlobalDefaults()) {
      const gBtn = el('button.lattice-modal-global', { type: 'button', title: t('instance.saveGlobalHint'), text: t('instance.saveGlobalDefaults') });
      gBtn.addEventListener('click', () => {
        this.grid.setGlobalDefaults();
        const old = gBtn.textContent; gBtn.textContent = t('instance.saveGlobalDone'); gBtn.disabled = true;
        setTimeout(() => { gBtn.textContent = old; gBtn.disabled = false; }, 1400);
      });
      footChildren.push(gBtn);
    }
    footChildren.push(el('button.lattice-modal-done', { type: 'button', text: t('instance.done') }));
    const foot = el('div.lattice-modal-foot', {}, footChildren);
    modal.append(head, bodyEl, foot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    head.querySelector('.lattice-modal-x').addEventListener('click', () => this.close());
    foot.querySelector('.lattice-modal-done').addEventListener('click', () => this.close());
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
    this._esc = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._esc);
    this.overlay = overlay;
    this._body = bodyEl;
  }

  close() {
    if (this._esc) document.removeEventListener('keydown', this._esc);
    this.overlay?.remove();
    this.overlay = null;
    this._esc = null;
  }

  /** Překreslí tělo (po změně, která ovlivní dostupnost dalších voleb). */
  refreshBody() {
    if (this._body) this.render(this._body);
  }

  render(body) {
    clear(body);
    const grid = this.grid;
    const inst = grid.instance;
    const t = grid.i18n.t.bind(grid.i18n);
    const set = (patch) => { grid.setInstance(patch); };

    // Globální výchozí nastavení od správce. Banner je dostupný VŽDY, když nějaké
    // existuje (uživatel se může kdykoli vrátit k předloze). Když je navíc NOVÁ
    // verze, text je výraznější a přibude „Ponechat moje".
    if (grid.hasGlobalDefaults()) {
      const isNew = grid.globalDefaultsAvailable();
      const banner = el('div.lattice-set-gdnote', { class: isNew ? 'is-new' : '' });
      banner.appendChild(el('span.lattice-set-gdnote-txt', { text: t(isNew ? 'instance.gdAvailable' : 'instance.gdReset') }));
      const apply = el('button.lattice-set-gdnote-apply', { type: 'button', text: t('instance.gdApply') });
      apply.addEventListener('click', () => { grid.applyGlobalDefaults(); this.render(body); });
      banner.appendChild(apply);
      if (isNew) {
        const keep = el('button.lattice-set-gdnote-keep', { type: 'button', text: t('instance.gdKeepMine') });
        keep.addEventListener('click', () => { grid.dismissGlobalDefaults(); this.render(body); });
        banner.appendChild(keep);
      }
      body.appendChild(banner);
    }

    // Skupiny jako taby — přehlednější než dlouhý scroll.
    const tabBar = el('div.lattice-set-tabs');
    const panels = el('div.lattice-set-panels');
    body.append(tabBar, panels);
    const tabs = [];
    const activate = (i) => {
      this._tab = i;
      tabs.forEach((tb, j) => { tb.btn.classList.toggle('is-active', j === i); tb.panel.hidden = j !== i; });
    };
    const makeTab = (title) => {
      const panel = el('div.lattice-set-panel');
      const btn = el('button.lattice-set-tab', { type: 'button', text: title });
      const idx = tabs.length;
      btn.addEventListener('click', () => activate(idx));
      tabs.push({ btn, panel });
      tabBar.appendChild(btn); panels.appendChild(panel);
      return panel;
    };

    /* ---------- Vzhled ---------- */
    const gA = makeTab(t('instance.groupAppearance'));
    gA.appendChild(rowSelect(t('instance.theme'), inst.theme || 'default', [
      ['default', t('instance.themeDefault')], ['auto', t('instance.themeAuto')],
      ['minimal', t('instance.themeMinimal')],
      ['compact', t('instance.themeCompact')], ['slate', t('instance.themeSlate')],
      ['ocean', t('instance.themeOcean')], ['warm', t('instance.themeWarm')],
      ['contrast', t('instance.themeContrast')], ['bootstrap5', t('instance.themeBootstrap5')],
      ['tailwind', t('instance.themeTailwind')], ['material', t('instance.themeMaterial')],
    ], (v) => set({ theme: v })));
    gA.appendChild(rowRange(t('instance.fontSize'), inst.fontSize || 14, 11, 20, (v) => set({ fontSize: v })));
    gA.appendChild(rowSelect(t('instance.density'), inst.density || 'comfortable', [
      ['comfortable', t('instance.comfortable')], ['compact', t('instance.compact')],
    ], (v) => set({ density: v })));
    gA.appendChild(rowSelect(t('instance.headerRotate'), inst.headerRotate || 'none', [
      ['none', t('instance.headerRotateNone')], ['90', t('instance.headerRotate90')], ['270', t('instance.headerRotate270')],
    ], (v) => set({ headerRotate: v })));
    gA.appendChild(rowToggle(t('instance.zebra'), inst.zebra !== false, (v) => set({ zebra: v })));
    gA.appendChild(rowScaleColors(t('instance.scaleColors'), inst.scaleColors || DEFAULT_SCALE_COLORS, (arr) => set({ scaleColors: arr }), t));

    /* ---------- Rozvržení ---------- */
    const gL = makeTab(t('instance.groupLayout'));
    const layoutVal = inst.layout === 'fit' ? 'fitColumns' : (inst.layout || 'fitData');
    gL.appendChild(rowSelect(t('instance.layout'), layoutVal, [
      ['fitData', t('instance.fitData')], ['fitDataFill', t('instance.fitDataFill')],
      ['fitDataStretch', t('instance.fitDataStretch')], ['fitColumns', t('instance.fitColumns')],
    ], (v) => set({ layout: v })));
    gL.appendChild(rowSelect(t('instance.resizeMode'), inst.resizeGuide ? 'guide' : 'native', [
      ['native', t('instance.resizeNative')], ['guide', t('instance.resizeGuide')],
    ], (v) => set({ resizeGuide: v === 'guide' })));
    gL.appendChild(rowToggle(t('instance.wrapText'), inst.wrapText === true, (v) => set({ wrapText: v })));
    gL.appendChild(rowToggle(t('instance.linkNewTab'), inst.linkNewTab === true, (v) => set({ linkNewTab: v })));
    gL.appendChild(rowText(t('instance.emptyText'), inst.emptyText || '', t('instance.emptyTextPlaceholder'), (v) => set({ emptyText: v })));

    /* ---------- Stránkování a filtry ---------- */
    const gP = makeTab(t('instance.groupPagination'));
    gP.appendChild(rowSelect(t('instance.pagination'), inst.paginationPosition || 'footer', [
      ['header', t('instance.paginationHeader')], ['footer', t('instance.paginationFooter')],
      ['both', t('instance.paginationBoth')], ['none', t('instance.paginationNone')],
    ], (v) => set({ paginationPosition: v })));
    gP.appendChild(rowSelect(t('instance.pageSizeDefault'), String(inst.pageSize || 50),
      [['10', '10'], ['25', '25'], ['50', '50'], ['100', '100'], ['200', '200']],
      (v) => set({ pageSize: Number(v) })));
    gP.appendChild(rowSelect(t('instance.filterLayout'), inst.filterLayout || 'header', [
      ['header', t('instance.filterInHeader')], ['external', t('instance.filterExternal')],
      ['universal', t('instance.filterUniversal')], ['none', t('instance.filterOff')],
    ], (v) => set({ filterLayout: v })));

    /* ---------- Sloupce a řádky ---------- */
    const gC = makeTab(t('instance.groupColumns'));
    // Výchozí řazení — pohodlný výběr sloupce + směru (nastaví grid.sort).
    const sortable = grid.columns.filter((c) => c.headerSort !== false && c.title && !c._rownum && !c._select);
    const sortOpts = [['', t('instance.sortNone')]];
    for (const c of sortable) {
      sortOpts.push([c.field + ' asc', c.title + ' ' + t('instance.sortAscSuffix')]);
      sortOpts.push([c.field + ' desc', c.title + ' ' + t('instance.sortDescSuffix')]);
    }
    const curSort = grid.sort && grid.sort[0];
    gC.appendChild(rowSelect(t('instance.defaultSort'), curSort ? curSort.field + ' ' + curSort.dir : '', sortOpts, (v) => {
      if (!v) grid.sortColumn('', null);
      else { const [f, d] = v.split(' '); grid.sortColumn(f, d); }
    }));
    gC.appendChild(rowSelect(t('instance.rowNumbers'), inst.rowNumbers || 'none', [
      ['none', t('instance.rowNumbersNone')], ['continuous', t('instance.rowNumbersContinuous')], ['perPage', t('instance.rowNumbersPerPage')],
    ], (v) => set({ rowNumbers: v })));
    gC.appendChild(rowSelect(t('instance.summaryRow'), inst.summaryRow || 'none', [
      ['none', t('instance.summaryNone')], ['page', t('instance.summaryPage')], ['all', t('instance.summaryAll')],
    ], (v) => set({ summaryRow: v })));
    gC.appendChild(rowToggle(t('instance.groupSubtotals'), inst.groupSubtotals === true, (v) => set({ groupSubtotals: v })));
    gC.appendChild(rowSelect(t('group.display'), inst.groupDisplay || 'headers', [
      ['headers', t('group.displayHeaders')], ['columns', t('group.displayColumns')],
    ], (v) => set({ groupDisplay: v })));
    // „Opakovat hodnoty v řádcích" dává smysl jen u vnořených hlaviček (v režimu
    // 'columns' není lišta, kam by hodnota jinak šla).
    if ((inst.groupDisplay || 'headers') !== 'columns') {
      gC.appendChild(rowToggle(t('group.repeat'), inst.groupRepeat !== false, (v) => set({ groupRepeat: v })));
    }
    if (grid.isSelectable()) {
      gC.appendChild(rowToggle(t('instance.selectColumn'), inst.selectColumn !== false, (v) => set({ selectColumn: v })));
      gC.appendChild(rowSelect(t('instance.selectTrigger'), inst.selectRowClick ? 'row' : 'checkbox', [
        ['checkbox', t('instance.selectByCheckbox')], ['row', t('instance.selectByRow')],
      ], (v) => set({ selectRowClick: v === 'row' })));
    }
    if (grid.hasActions()) {
      gC.appendChild(rowSelect(t('instance.actionsLayout'), inst.actionsLayout || 'column', [
        ['column', t('instance.actionsAsColumn')], ['menu', t('instance.actionsAsMenu')],
      ], (v) => set({ actionsLayout: v })));
    }

    /* ---------- Formát hodnot ---------- */
    const gF = makeTab(t('instance.groupFormat'));
    gF.appendChild(rowSelect(t('instance.locale'), inst.locale || '', [
      ['', t('instance.localeDefault')], ['cs-CZ', 'Čeština (cs-CZ)'], ['sk-SK', 'Slovenčina (sk-SK)'],
      ['en-US', 'English (en-US)'], ['en-GB', 'English (en-GB)'], ['de-DE', 'Deutsch (de-DE)'],
      ['pl-PL', 'Polski (pl-PL)'], ['fr-FR', 'Français (fr-FR)'],
    ], (v) => set({ locale: v })));
    for (const kind of ['number', 'money', 'date', 'datetime', 'time']) {
      const label = { number: 'fmtNumber', money: 'fmtMoney', date: 'fmtDate', datetime: 'fmtDatetime', time: 'fmtTime' }[kind];
      const cur = grid.effectiveFormatFor(kind);
      gF.appendChild(el('div.lattice-set-subhead', { text: t('instance.' + label) }));
      for (const f of formatFields(kind, cur, grid, (patch) => grid.setFormat(kind, patch))) gF.appendChild(f);
    }

    /* ---------- Vlastní úpravy (přepíší zvolený motiv) ---------- */
    const gX = makeTab(t('instance.groupCustom'));
    gX.appendChild(el('div.lattice-set-hint', { text: t('instance.cssHint') }));
    const cv = inst.cssVars || {};
    const merge = (name, value) => {
      const next = Object.assign({}, grid.instance.cssVars);
      if (value == null || value === '') delete next[name]; else next[name] = value;
      set({ cssVars: next });
    };
    // Písmo tabulky (fontFamily) a záhlaví (--lattice-header-font) — select s náhledem.
    gX.appendChild(fontSelectRow(t('instance.cssFontTable'), inst.fontFamily || '', (v) => set({ fontFamily: v })));
    gX.appendChild(fontSelectRow(t('instance.cssFontHeader'), cv['--lattice-header-font'] || '', (v) => merge('--lattice-header-font', v || null)));
    gX.appendChild(colorGrid([
      [t('instance.cssAccent'), '--lattice-accent'], [t('instance.cssLink'), '--lattice-link'],
      [t('instance.cssText'), '--lattice-text'], [t('instance.cssBorder'), '--lattice-border'],
      [t('instance.cssHeaderBg'), '--lattice-header-bg'], [t('instance.cssRowEven'), '--lattice-bg'],
      [t('instance.cssRowOdd'), '--lattice-row-odd'], [t('instance.cssRowHover'), '--lattice-row-hover'],
    ], grid, cv, merge));
    gX.appendChild(cssSelectRow(t('instance.cssHeaderWeight'), '--lattice-header-weight', cv,
      [['', '—'], ['400', '400'], ['500', '500'], ['600', '600'], ['700', '700']], merge));
    gX.appendChild(cssPxRow(t('instance.cssRadius'), '--lattice-radius', grid, cv, merge));
    gX.appendChild(cssPxRow(t('instance.cssCellPadY'), '--lattice-cell-pad-y', grid, cv, merge));
    gX.appendChild(cssPxRow(t('instance.cssCellPadX'), '--lattice-cell-pad-x', grid, cv, merge));
    const resetBtn = el('button.lattice-modal-global', { type: 'button', text: t('instance.cssReset') });
    resetBtn.addEventListener('click', () => { set({ cssVars: {} }); this.render(body); });
    gX.appendChild(field('', resetBtn));

    activate(Math.min(this._tab || 0, tabs.length - 1)); // zobraz aktivní tab (zapamatovaný)
  }
}

/* ============ formátovací pole (sdílené s per-column dialogem) ============ */

/** Vrátí řady ovládacích prvků pro daný druh formátu; onChange(patch) je aplikuje. */
export function formatFields(kind, cur, grid, onChange) {
  const t = grid.i18n.t.bind(grid.i18n);
  const rows = [];
  if (kind === 'number' || kind === 'money') {
    if (kind === 'money') {
      rows.push(rowSelect(t('instance.fmtCurrency'), cur.currency || 'CZK', CURRENCIES.map((c) => [c, c]), (v) => onChange({ currency: v })));
    }
    rows.push(rowSelect(t('instance.fmtDecimals'), cur.decimals == null ? 'auto' : String(cur.decimals),
      [['auto', t('instance.fmtDecimalsAuto')], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
      (v) => onChange({ decimals: v === 'auto' ? null : Number(v) })));
    rows.push(rowToggle(t('instance.fmtThousands'), cur.thousands !== false, (v) => onChange({ thousands: v })));
    rows.push(rowSelect(t('instance.fmtNegative'), cur.negative || 'minus', [
      ['minus', t('instance.negMinus')], ['red', t('instance.negRed')],
      ['paren', t('instance.negParen')], ['redparen', t('instance.negRedParen')],
    ], (v) => onChange({ negative: v })));
  } else {
    const presets = kind === 'date' ? DATE_PRESETS : kind === 'datetime' ? DATETIME_PRESETS : TIME_PRESETS;
    const opts = presets.map((p) => [p, formatDate(SAMPLE_DATE, p, grid.i18n) + '  (' + p + ')']);
    opts.push(['__custom__', t('instance.fmtCustom')]);
    const isCustom = !presets.includes(cur.pattern);
    // Živý náhled aktualizuje jak výběr předlohy, tak vlastní vzor.
    const preview = el('span.lattice-fmt-preview', { text: formatDate(SAMPLE_DATE, cur.pattern, grid.i18n) });
    const patInput = el('input.lattice-set-input', { type: 'text', value: cur.pattern || '', title: 'dd mm yyyy · d m · mmmm mmm · ddd dddd · HH H · nn · ss' });
    const setPattern = (pattern) => { preview.textContent = formatDate(SAMPLE_DATE, pattern, grid.i18n); onChange({ pattern }); };
    patInput.addEventListener('input', () => setPattern(patInput.value));
    rows.push(rowSelect(t('instance.fmtPattern'), isCustom ? '__custom__' : cur.pattern, opts, (v) => {
      if (v === '__custom__') { patInput.focus(); return; }
      patInput.value = v; setPattern(v);
    }));
    rows.push(field(t('instance.fmtCustom'), patInput)); // vlastní vzor
    rows.push(field('', preview));
  }
  return rows;
}

/* ============ stavební prvky ============ */

function field(labelText, control) {
  return el('label.lattice-set-row', {}, [el('span.lattice-set-label', { text: labelText }), control]);
}

function rowToggle(labelText, value, onChange) {
  const cb = el('input', { type: 'checkbox', checked: !!value });
  cb.addEventListener('change', () => onChange(cb.checked));
  return field(labelText, cb);
}

function rowSelect(labelText, value, options, onChange) {
  const sel = el('select.lattice-set-input');
  for (const [val, lab] of options) sel.appendChild(el('option', { value: val, text: lab }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return field(labelText, sel);
}

function rowText(labelText, value, placeholder, onChange) {
  const inp = el('input.lattice-set-input', { type: 'text', value: value || '', placeholder: placeholder || '' });
  inp.addEventListener('input', () => onChange(inp.value));
  return field(labelText, inp);
}

function rowRange(labelText, value, min, max, onChange) {
  const wrap = el('span.lattice-set-range');
  const range = el('input', { type: 'range', min, max, step: 1, value });
  const out = el('span.lattice-set-range-val', { text: value + 'px' });
  range.addEventListener('input', () => { out.textContent = range.value + 'px'; onChange(Number(range.value)); });
  wrap.append(range, out);
  return field(labelText, wrap);
}

/* ---- vlastní CSS override (přepíší motiv) ---- */
function rgb2hex(s) {
  if (!s) return null;
  s = s.trim();
  if (s[0] === '#') return s.length === 4 ? '#' + [...s.slice(1)].map((c) => c + c).join('') : s.slice(0, 7);
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseInt(x, 10));
  return '#' + p.slice(0, 3).map((n) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, '0')).join('');
}
function effVar(grid, name) { return getComputedStyle(grid.el).getPropertyValue(name).trim(); }

/** Kompaktní grid barevných voleb (2 sloupce) — šetří místo. Klik → šestiúhelníkový picker. */
function colorGrid(items, grid, cv, merge) {
  const t = grid.i18n.t.bind(grid.i18n);
  const wrap = el('div.lattice-color-grid');
  for (const [label, name] of items) {
    const def = () => rgb2hex(effVar(grid, name)) || '#000000';
    const btn = el('button.lattice-scale-color', { type: 'button', style: { background: cv[name] || def() } });
    btn.addEventListener('click', () => openColorPicker(btn, {
      t, current: cv[name] || def(),
      onPick: (color) => { btn.style.background = color; merge(name, color); },
      onClear: () => { btn.style.background = def(); merge(name, null); },
    }));
    wrap.appendChild(el('span.lattice-color-cell', {}, [btn, el('span.lattice-color-lbl', { text: label })]));
  }
  return wrap;
}
// Nabídka písem: systémová (náhled hned) + Google Fonts (načtou se přes <link>).
const FONTS = [
  { label: '— dle motivu / tabulky —', value: '' },
  { label: 'Systémové', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Sans (Arial)', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif (Georgia)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { label: 'Inter', value: '"Inter", sans-serif', google: 'Inter:wght@400;600;700' },
  { label: 'Roboto', value: '"Roboto", sans-serif', google: 'Roboto:wght@400;500;700' },
  { label: 'Open Sans', value: '"Open Sans", sans-serif', google: 'Open+Sans:wght@400;600;700' },
  { label: 'Lato', value: '"Lato", sans-serif', google: 'Lato:wght@400;700' },
  { label: 'Montserrat', value: '"Montserrat", sans-serif', google: 'Montserrat:wght@400;600;700' },
  { label: 'Poppins', value: '"Poppins", sans-serif', google: 'Poppins:wght@400;600;700' },
  { label: 'Nunito', value: '"Nunito", sans-serif', google: 'Nunito:wght@400;600;700' },
  { label: 'Merriweather (serif)', value: '"Merriweather", serif', google: 'Merriweather:wght@400;700' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace', google: 'JetBrains+Mono:wght@400;600' },
];
let _gfLoaded = false;
/** Jednorázově načte Google Fonts CSS pro nabízené rodiny (kvůli náhledu i použití). */
function ensureGoogleFonts() {
  if (_gfLoaded || typeof document === 'undefined') return;
  _gfLoaded = true;
  const fams = FONTS.filter((f) => f.google).map((f) => 'family=' + f.google);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?' + fams.join('&') + '&display=swap';
  document.head.appendChild(link);
}
/** Select písma s náhledem (každá volba stylovaná svým fontem). */
function fontSelectRow(label, value, onChange) {
  ensureGoogleFonts();
  const sel = el('select.lattice-set-input.lattice-font-select');
  const known = FONTS.some((f) => f.value === value);
  if (value && !known) { const o = el('option', { value, text: 'Vlastní', style: { fontFamily: value } }); sel.appendChild(o); }
  for (const f of FONTS) {
    const o = el('option', { value: f.value, text: f.label });
    if (f.value) o.style.fontFamily = f.value;
    sel.appendChild(o);
  }
  sel.value = value || '';
  sel.style.fontFamily = value || '';
  sel.addEventListener('change', () => { sel.style.fontFamily = sel.value; onChange(sel.value); });
  return field(label, sel);
}

function cssPxRow(label, name, grid, cv, merge) {
  const inp = el('input.lattice-set-input', { type: 'number', min: 0, max: 40, step: 1,
    value: cv[name] ? parseInt(cv[name], 10) : '', placeholder: effVar(grid, name) || 'px' });
  inp.addEventListener('change', () => merge(name, inp.value !== '' ? inp.value + 'px' : null));
  return field(label, inp);
}
function cssSelectRow(label, name, cv, options, merge) {
  const sel = el('select.lattice-set-input');
  for (const [v, l] of options) sel.appendChild(el('option', { value: v, text: l }));
  sel.value = cv[name] || '';
  sel.addEventListener('change', () => merge(name, sel.value || null));
  return field(label, sel);
}

/** Tři barvy škály (low/mid/high) — přeberou je sloupce s podmíněným formátem. Klik → šestiúhelníkový picker. */
function rowScaleColors(labelText, colors, onChange, t) {
  const wrap = el('span.lattice-scale-colors');
  const vals = [colors[0], colors[1], colors[2]];
  const btns = [0, 1, 2].map((i) => {
    const btn = el('button.lattice-scale-color', { type: 'button', style: { background: vals[i] || '#888888' } });
    btn.addEventListener('click', () => openColorPicker(btn, {
      t, current: vals[i],
      onPick: (color) => { vals[i] = color; btn.style.background = color; onChange(vals.slice()); },
      onClear: () => { vals[i] = DEFAULT_SCALE_COLORS[i]; btn.style.background = vals[i]; onChange(vals.slice()); },
    }));
    return btn;
  });
  wrap.append(...btns);
  return field(labelText, wrap);
}
