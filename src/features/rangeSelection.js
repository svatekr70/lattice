/**
 * RangeManager — výběr obdélníkového rozsahu BUNĚK (spreadsheet-like) + schránka.
 *
 *  - myš:      mousedown na buňku = kotva, tažení / mouseover rozšiřuje rozsah,
 *              shift+klik rozšíří od kotvy,
 *  - klávesy:  šipky posunou aktivní buňku, shift+šipky rozšíří rozsah,
 *  - Ctrl/⌘+C: zkopíruje rozsah do schránky jako TSV (kompatibilní s Excelem),
 *  - Ctrl/⌘+V: vloží TSV od aktivní buňky do EDITOVATELNÝCH buněk (onCellEdit).
 *
 * Rozsah se počítá nad reálnými datovými sloupci (bez syntetických) a řádky
 * aktuální stránky (grid.rows). Zdrojově agnostické — pracuje s hodnotami řádků.
 */
export class RangeManager {
  constructor(grid) {
    this.grid = grid;
    this.anchor = null;  // { r, c }
    this.focus = null;   // aktivní buňka { r, c }
    this.dragging = false;
  }

  /** Reálné datové sloupce v render pořadí (bez přesun/výběr/číslování/akce). */
  cols() {
    return this.grid.renderer.renderColumns().list
      .filter((c) => !c._move && !c._select && !c._rownum && !c._actions && !c._actionsMenu);
  }

  attach(root, body) {
    this.root = root;
    this.body = body;
    root.tabIndex = 0; // ať může přijmout fokus pro klávesy

    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const coord = this.coordOf(e.target);
      if (!coord) return;
      root.focus();
      if (e.shiftKey && this.anchor) this.setFocus(coord);
      else { this.anchor = coord; this.setFocus(coord); }
      this.dragging = true;
      root.classList.add('is-range-mode');
      e.preventDefault(); // zabraň označení textu při tažení
    });
    body.addEventListener('mouseover', (e) => {
      if (!this.dragging) return;
      const coord = this.coordOf(e.target);
      if (coord) this.setFocus(coord);
    });
    this._onUp = () => { this.dragging = false; };
    window.addEventListener('mouseup', this._onUp);
    root.addEventListener('keydown', (e) => this.onKey(e));
  }

  destroy() { if (this._onUp) window.removeEventListener('mouseup', this._onUp); this.grid.renderer.updateRangeStatus(''); }

  /** Souřadnice { r, c } z DOM cíle (buňky), nebo null. */
  coordOf(target) {
    const cell = target.closest && target.closest('.lattice-cell[data-field]');
    if (!cell) return null;
    const rowEl = cell.closest('.lattice-row');
    if (!rowEl || rowEl.dataset.index == null) return null;
    const r = Number(rowEl.dataset.index);
    const c = this.cols().findIndex((col) => col.field === cell.dataset.field);
    if (c < 0 || Number.isNaN(r)) return null;
    return { r, c };
  }

  setFocus(coord) { this.focus = coord; this.apply(); }

  /** Normalizovaný obdélník rozsahu, nebo null. */
  rect() {
    if (!this.anchor || !this.focus) return null;
    return {
      r1: Math.min(this.anchor.r, this.focus.r), r2: Math.max(this.anchor.r, this.focus.r),
      c1: Math.min(this.anchor.c, this.focus.c), c2: Math.max(this.anchor.c, this.focus.c),
    };
  }

  /** Nastaví CSS třídy (is-range / is-range-active) na buňky v rozsahu. */
  apply() {
    const body = this.grid.renderer.nodes.body;
    for (const el of body.querySelectorAll('.is-range, .is-range-active')) el.classList.remove('is-range', 'is-range-active');
    const rc = this.rect();
    if (!rc) return;
    const cols = this.cols();
    for (const rowEl of body.querySelectorAll('.lattice-row')) {
      const r = Number(rowEl.dataset.index);
      if (Number.isNaN(r) || r < rc.r1 || r > rc.r2) continue;
      for (let c = rc.c1; c <= rc.c2; c++) {
        const cell = this.cellIn(rowEl, cols[c]);
        if (cell) cell.classList.add('is-range');
      }
    }
    const active = this.cellAt(this.focus);
    if (active) active.classList.add('is-range-active');
    this.grid.renderer.updateRangeStatus(this.summaryText());
    this._placeFillHandle(rc);
  }

  /** Souhrn označeného rozsahu (počet buněk + agregace čísel) pro status bar. */
  summaryText() {
    const rc = this.rect();
    if (!rc) return '';
    const cellCount = (rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1);
    if (cellCount <= 1) return ''; // jediná buňka → status neukazuj
    const cols = this.cols();
    const nums = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const row = this.grid.rows[r];
      if (!row) continue;
      for (let c = rc.c1; c <= rc.c2; c++) { const n = rangeNum(row[cols[c].field]); if (n != null) nums.push(n); }
    }
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const loc = this.grid.i18n.locale || undefined;
    const fmt = (x) => new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(x);
    const parts = [t('range.cells').replace('{n}', cellCount)];
    if (nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      parts.push(
        `${t('range.sum')}: ${fmt(sum)}`,
        `${t('range.avg')}: ${fmt(sum / nums.length)}`,
        `${t('range.min')}: ${fmt(Math.min(...nums))}`,
        `${t('range.max')}: ${fmt(Math.max(...nums))}`,
      );
    }
    return parts.join('   ·   ');
  }

  cellIn(rowEl, col) { return col ? rowEl.querySelector('.lattice-cell[data-field="' + col.field + '"]') : null; }
  cellAt(coord) {
    if (!coord) return null;
    const rowEl = [...this.grid.renderer.nodes.body.querySelectorAll('.lattice-row')].find((r) => Number(r.dataset.index) === coord.r);
    return rowEl ? this.cellIn(rowEl, this.cols()[coord.c]) : null;
  }

  onKey(e) {
    if (!this.anchor || !this.focus) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === 'c' || e.key === 'C')) { this.copy(); e.preventDefault(); return; }
    if (meta && (e.key === 'v' || e.key === 'V')) { this.paste(); e.preventDefault(); return; }
    if (meta && (e.key === 'a' || e.key === 'A')) { this.selectAll(); e.preventDefault(); return; }
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const maxR = (this.grid.rows.length || 1) - 1;
    const maxC = this.cols().length - 1;
    const nr = Math.max(0, Math.min(maxR, this.focus.r + delta[0]));
    const nc = Math.max(0, Math.min(maxC, this.focus.c + delta[1]));
    if (e.shiftKey) this.setFocus({ r: nr, c: nc });
    else { this.anchor = { r: nr, c: nc }; this.setFocus({ r: nr, c: nc }); }
    this.cellAt(this.focus)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  selectAll() {
    this.anchor = { r: 0, c: 0 };
    this.setFocus({ r: (this.grid.rows.length || 1) - 1, c: this.cols().length - 1 });
  }

  /** 2D pole hodnot rozsahu (řádky × sloupce). */
  values() {
    const rc = this.rect();
    if (!rc) return [];
    const cols = this.cols();
    const out = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const row = this.grid.rows[r];
      const line = [];
      for (let c = rc.c1; c <= rc.c2; c++) line.push(row ? row[cols[c].field] : '');
      out.push(line);
    }
    return out;
  }

  /** Zkopíruje rozsah do schránky jako TSV (kompatibilní se Sheets/Excel). */
  copy() {
    const data = this.values();
    const tsv = data.map((row) => row.map((v) => (v == null ? '' : String(v))).join('\t')).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).catch(() => {});
    if (this.grid.options.onRangeCopy) this.grid.options.onRangeCopy(data, tsv);
    return tsv;
  }

  /** Vloží TSV ze schránky od aktivní buňky do editovatelných buněk. */
  async paste() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    this.pasteText(text);
  }

  pasteText(text) {
    const grid = this.grid;
    const rc = this.rect();
    if (!rc || !text) return;
    const cols = this.cols();
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const changed = [], hist = [];
    matrix.forEach((cells, ri) => cells.forEach((val, ci) => {
      const r = rc.r1 + ri, c = rc.c1 + ci;
      const row = grid.rows[r], col = cols[c];
      if (!row || !col) return;
      const editable = col.editable === true || grid.options.editable === true;
      if (!editable) return;
      const oldValue = row[col.field];
      const newValue = typeof oldValue === 'number' && val !== '' && !Number.isNaN(Number(val)) ? Number(val) : val;
      if (newValue === oldValue) return;
      row[col.field] = newValue;
      changed.push(row);
      hist.push({ type: 'edit', row, before: { [col.field]: oldValue }, after: { [col.field]: newValue } });
      if (grid.options.onCellEdit) grid.options.onCellEdit({ field: col.field, row, oldValue, newValue });
    }));
    if (hist.length) grid.history?.record({ type: 'batch', entries: hist }); // vložení = jeden krok historie
    if (changed.length) { grid.renderer.renderBody(); this.apply(); }
    if (grid.options.onRangePaste) grid.options.onRangePaste(changed);
    return changed;
  }

  /* ---- fill handle (táhni roh výběru → vyplň/kopíruj s posloupností) ---- */

  fillEnabled() {
    const g = this.grid;
    if (g.options.fillHandle === false) return false;
    return g.options.editable === true || g.columns.some((c) => c.editable === true);
  }

  _placeFillHandle(rc) {
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll('.lattice-fill-handle').forEach((h) => h.remove());
    body.querySelectorAll('.has-fill-handle').forEach((c) => c.classList.remove('has-fill-handle'));
    if (!rc || !this.fillEnabled()) return;
    const cols = this.cols();
    const cornerRow = [...body.querySelectorAll('.lattice-row')].find((r) => Number(r.dataset.index) === rc.r2);
    const cell = cornerRow && this.cellIn(cornerRow, cols[rc.c2]);
    if (!cell) return;
    cell.classList.add('has-fill-handle');
    const h = document.createElement('div');
    h.className = 'lattice-fill-handle';
    h.title = this.grid.i18n.t('range.fill');
    h.addEventListener('mousedown', (e) => this._startFill(e, rc));
    cell.appendChild(h);
  }

  _startFill(e, src) {
    e.stopPropagation(); e.preventDefault();
    this._fillSrc = src; this._fillTarget = null;
    const onMove = (ev) => { const coord = this.coordOf(ev.target); if (coord) this._previewFill(coord); };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      this._commitFill();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  _previewFill(coord) {
    const s = this._fillSrc; if (!s) return;
    let t = null;
    if (coord.r > s.r2) t = { r1: s.r2 + 1, r2: coord.r, c1: s.c1, c2: s.c2, axis: 'v' };
    else if (coord.r < s.r1) t = { r1: coord.r, r2: s.r1 - 1, c1: s.c1, c2: s.c2, axis: 'v' };
    else if (coord.c > s.c2) t = { r1: s.r1, r2: s.r2, c1: s.c2 + 1, c2: coord.c, axis: 'h' };
    else if (coord.c < s.c1) t = { r1: s.r1, r2: s.r2, c1: coord.c, c2: s.c1 - 1, axis: 'h' };
    this._fillTarget = t;
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll('.is-fill-preview').forEach((c) => c.classList.remove('is-fill-preview'));
    if (!t) return;
    const cols = this.cols();
    for (const rowEl of body.querySelectorAll('.lattice-row')) {
      const r = Number(rowEl.dataset.index);
      if (Number.isNaN(r) || r < t.r1 || r > t.r2) continue;
      for (let c = t.c1; c <= t.c2; c++) { const cell = this.cellIn(rowEl, cols[c]); if (cell) cell.classList.add('is-fill-preview'); }
    }
  }

  _commitFill() {
    const s = this._fillSrc, t = this._fillTarget;
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll('.is-fill-preview').forEach((c) => c.classList.remove('is-fill-preview'));
    this._fillSrc = null; this._fillTarget = null;
    if (!t) { this.apply(); return; }
    const grid = this.grid, cols = this.cols();
    const editableCol = (col) => col && (col.editable === true || grid.options.editable === true);
    const changed = [], hist = [];
    if (t.axis === 'v') {
      for (let c = s.c1; c <= s.c2; c++) {
        const col = cols[c]; if (!editableCol(col)) continue;
        const sVals = []; for (let r = s.r1; r <= s.r2; r++) sVals.push(grid.rows[r] ? grid.rows[r][col.field] : '');
        for (let r = t.r1; r <= t.r2; r++) { const row = grid.rows[r]; if (row) this._writeFill(row, col, fillSequence(sVals, r - s.r1), changed, hist); }
      }
    } else {
      for (let r = s.r1; r <= s.r2; r++) {
        const row = grid.rows[r]; if (!row) continue;
        const sVals = []; for (let c = s.c1; c <= s.c2; c++) sVals.push(row[cols[c].field]);
        for (let c = t.c1; c <= t.c2; c++) { const col = cols[c]; if (editableCol(col)) this._writeFill(row, col, fillSequence(sVals, c - s.c1), changed, hist); }
      }
    }
    if (hist.length) grid.history?.record({ type: 'batch', entries: hist });
    if (changed.length) {
      grid.renderer.renderBody();
      this.anchor = { r: Math.min(s.r1, t.r1), c: Math.min(s.c1, t.c1) };
      this.setFocus({ r: Math.max(s.r2, t.r2), c: Math.max(s.c2, t.c2) });
    } else this.apply();
    if (grid.options.onFill) grid.options.onFill(changed);
  }

  _writeFill(row, col, newValue, changed, hist) {
    const oldValue = row[col.field];
    let nv = newValue;
    if (typeof oldValue === 'number' && nv != null && nv !== '' && !Number.isNaN(Number(nv))) nv = Number(nv);
    if (nv === oldValue) return;
    row[col.field] = nv;
    changed.push(row);
    hist.push({ type: 'edit', row, before: { [col.field]: oldValue }, after: { [col.field]: nv } });
    if (this.grid.options.onCellEdit) this.grid.options.onCellEdit({ field: col.field, row, oldValue, newValue: nv });
  }
}

/** Číslo z hodnoty buňky pro souhrn rozsahu (čárka i tečka). */
function rangeNum(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Chytré vyplnění: ze zdrojových hodnot odvodí hodnotu na pozici `offset`
 * (0 = první zdrojová). Číselná/datumová posloupnost se dopočítá (aritmeticky),
 * jinak se zdroj cyklicky kopíruje. Exportováno kvůli testům.
 */
export function fillSequence(sVals, offset) {
  const n = sVals.length;
  if (!n) return '';
  const nums = sVals.map(rangeNum);
  if (nums.every((x) => x != null)) {
    const step = n >= 2 ? avgStep(nums) : 0;
    const v = nums[0] + step * offset;
    return (Number.isInteger(step) && Number.isInteger(nums[0])) ? Math.round(v) : v;
  }
  const dates = sVals.map(fillDate);
  if (dates.every((d) => d != null)) {
    const ms = dates.map((d) => d.getTime());
    const step = n >= 2 ? avgStep(ms) : 0;
    return isoDate(new Date(ms[0] + step * offset));
  }
  return sVals[((offset % n) + n) % n];
}
function avgStep(arr) { let s = 0; for (let i = 1; i < arr.length; i++) s += arr[i] - arr[i - 1]; return s / (arr.length - 1); }
function fillDate(v) {
  if (v == null || v === '' || typeof v === 'boolean' || typeof v === 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoDate(d) { const p = (x) => String(x).padStart(2, '0'); return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); }
