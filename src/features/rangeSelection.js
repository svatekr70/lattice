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

  destroy() { if (this._onUp) window.removeEventListener('mouseup', this._onUp); }

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
}
