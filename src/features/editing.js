/**
 * Inline editace buněk — součást knihovny, nezávislá na zdroji dat.
 *
 * Dvojklik na editovatelnou buňku spustí editor podle datového typu (nebo
 * podle filtru u select/multiselect). Po potvrzení se:
 *   1) upraví hodnota v řádku (rowData[field]) — u client zdroje to rovnou mění
 *      podkladová data (řádky jsou reference na objekty v ClientData),
 *   2) zavolá callback options.onCellEdit({field,row,rowIndex,oldValue,newValue})
 *      — tudy si aplikace zařídí persistenci na libovolném backendu.
 *
 * Editace je opt-in: column.editable === true (nebo globálně options.editable).
 * Vše bez externích závislostí.
 */
import { el, clear, onOutside } from '../util/dom.js';
import { positionUnder } from './gear.js';
import { EMPTY_FILTER_VALUE } from '../filters/index.js';

export class EditManager {
  constructor(grid) {
    this.grid = grid;
    this.active = null;
  }

  /** Napojí delegovaný dvojklik na tělo tabulky (voláno po mount). */
  attach() {
    const body = this.grid.renderer.nodes.body;
    body.addEventListener('dblclick', (e) => this.onDblClick(e));
    // U editovatelných buněk potlačit navigaci odkazu / lightbox obrázku na jeden
    // klik — edituje se dvojklikem (jinak by první klik odešel na odkaz / otevřel náhled).
    body.addEventListener('click', (e) => {
      const cell = e.target.closest('.lattice-cell.is-editable');
      if (cell && !cell.classList.contains('is-editing') && (e.target.closest('a') || e.target.closest('img'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  editable(col) {
    if (col.type === 'id') return false; // identifikátor se nikdy needituje
    if (typeof col.value === 'function') return false; // odvozený (computed) sloupec nemá kam zapsat
    return col.editable === true || this.grid.options.editable === true;
  }

  onDblClick(e) {
    if (this.active) return;
    const cell = e.target.closest('.lattice-cell[data-field]');
    if (!cell || cell.classList.contains('lattice-summary-cell') || cell.classList.contains('lattice-rownum')) return;
    const rowEl = cell.closest('.lattice-row[data-index]');
    if (!rowEl) return;
    const col = this.grid.columns.find((c) => c.field === cell.dataset.field);
    if (!col || col._rownum || !this.editable(col)) return;
    const idx = Number(rowEl.dataset.index);
    const rowData = this.grid.rows[idx];
    if (!rowData) return;
    this.start(cell, col, rowData, idx);
  }

  start(cell, col, rowData, idx) {
    const editor = resolveEditor(col);
    if (!editor) return;
    this.active = { cell, col, rowData, idx };
    cell.classList.add('is-editing');
    editor(cell, col, rowData, (val) => this.finish(val));
  }

  finish(val) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.cell.classList.remove('is-editing');
    if (val !== undefined && !equal(val, a.rowData[a.col.field])) {
      const oldValue = a.rowData[a.col.field];
      // 1) Deklarativní validace sloupce (col.validator) — PŘED přijetím.
      const vErr = runValidator(a.col, val, a.rowData, this.grid.i18n);
      if (vErr) {
        this.grid.renderer.renderBody();
        this._flashInvalid(a.idx, a.col.field, vErr);
        const inv = this.grid.options.onCellInvalid;
        if (typeof inv === 'function') { try { inv({ field: a.col.field, row: a.rowData, rowIndex: a.idx, value: val, error: vErr }); } catch { /* no-op */ } }
        return;
      }
      // 2) Imperativní validace aplikace — může edit zamítnout vrácením false.
      const validate = this.grid.options.onCellValidate;
      if (typeof validate === 'function') {
        let ok = true;
        try { ok = validate({ field: a.col.field, row: a.rowData, rowIndex: a.idx, oldValue, newValue: val, col: a.col }); }
        catch (err) { console.error('[Lattice] onCellValidate selhal:', err); ok = false; }
        if (ok === false) { this.grid.renderer.renderBody(); return; } // zamítnuto → ponechá původní hodnotu
      }
      a.rowData[a.col.field] = val; // client zdroj: mění i podkladová data (reference)
      this.grid.recordEdit(a.rowData, a.col.field, oldValue, val); // historie (undo/redo)
      const cb = this.grid.options.onCellEdit;
      if (typeof cb === 'function') {
        try { cb({ field: a.col.field, row: a.rowData, rowIndex: a.idx, oldValue, newValue: val }); }
        catch (err) { console.error('[Lattice] onCellEdit selhal:', err); }
      }
    }
    this.grid.renderer.renderBody(); // překreslí buňku (formát) i souhrn
  }

  /** Krátce zvýrazní buňku jako neplatnou (červený rámeček + tooltip s chybou). */
  _flashInvalid(idx, field, err) {
    const cell = this.grid.renderer.nodes.body.querySelector('.lattice-row[data-index="' + idx + '"] .lattice-cell[data-field="' + field + '"]');
    if (!cell) return;
    cell.classList.add('is-invalid');
    cell.title = err;
    setTimeout(() => { cell.classList.remove('is-invalid'); if (cell.title === err) cell.removeAttribute('title'); }, 1800);
  }
}

/* ============ deklarativní validace sloupce (col.validator) ============ */

/**
 * Spustí `col.validator` nad hodnotou. Vrací null (OK) nebo chybovou hlášku.
 * validator: 'required' | RegExp | fn(value,row,col)→true|false|string |
 *            { required, min, max, minLen, maxLen, pattern, message } | pole pravidel.
 */
export function runValidator(col, value, row, i18n) {
  const v = col.validator;
  if (!v) return null;
  const rules = Array.isArray(v) ? v : [v];
  for (const rule of rules) {
    const err = checkRule(rule, value, row, col, i18n);
    if (err) return err;
  }
  return null;
}

function checkRule(rule, value, row, col, i18n) {
  const t = (k) => (i18n ? i18n.t('validate.' + k) : k);
  const empty = value == null || value === '';
  if (rule === 'required') return empty ? t('required') : null;
  if (typeof rule === 'function') {
    let r; try { r = rule(value, row, col); } catch { return t('invalid'); }
    if (r === true || r == null) return null;
    return typeof r === 'string' ? r : t('invalid');
  }
  if (rule instanceof RegExp) return (!empty && !rule.test(String(value))) ? t('pattern') : null;
  if (rule && typeof rule === 'object') {
    if (rule.required && empty) return rule.message || t('required');
    if (!empty) {
      const s = String(value);
      const num = Number(s.replace(/\s/g, '').replace(',', '.'));
      if (rule.min != null && !(num >= rule.min)) return rule.message || t('min').replace('{n}', rule.min);
      if (rule.max != null && !(num <= rule.max)) return rule.message || t('max').replace('{n}', rule.max);
      if (rule.minLen != null && s.length < rule.minLen) return rule.message || t('minLen').replace('{n}', rule.minLen);
      if (rule.maxLen != null && s.length > rule.maxLen) return rule.message || t('maxLen').replace('{n}', rule.maxLen);
      if (rule.pattern) { const re = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern); if (!re.test(s)) return rule.message || t('pattern'); }
    }
  }
  return null;
}

/* ============ výběr editoru dle sloupce ============ */

function resolveEditor(col) {
  // Explicitní editor má přednost (např. editor:'multiselect' pro buňku s polem hodnot).
  if (col.editor === 'multiselect') return multiselectEditor;
  if (col.editor === 'select') return selectEditor;
  // Filtr 'select' i 'multiselect' → editace je VŽDY jednohodnotový select.
  // (Buňka drží jednu hodnotu; multiselect slouží jen k filtrování.)
  if (col.filter === 'select' || col.filter === 'multiselect') return selectEditor;
  switch (col.type) {
    case 'number':
    case 'money': return numberEditor;
    case 'boolean': return booleanEditor;
    case 'tick': return tickEditor;
    case 'progress': return progressEditor;
    case 'rating': return ratingEditor;
    case 'color': return colorEditor;
    case 'date': return dateEditor(false);
    case 'datetime': return dateEditor(true);
    case 'link': return linkEditor;
    case 'image':
    case 'icon': return urlEditor;
    default: return textEditor;
  }
}

/* ============ jednoduché inline editory ============ */

function textEditor(cell, col, rowData, done) {
  const input = el('input.lattice-edit-input', { type: 'text', value: str(rowData[col.field]) });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => done(input.value), () => done(undefined));
}

function numberEditor(cell, col, rowData, done) {
  const input = el('input.lattice-edit-input.is-number', { type: 'text', inputMode: 'decimal', value: str(rowData[col.field]) });
  input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.,\-]/g, ''); });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => {
    const t = input.value.trim();
    if (t === '') return done(null);
    const n = Number(t.replace(/\s/g, '').replace(',', '.'));
    done(Number.isFinite(n) ? n : undefined);
  }, () => done(undefined));
}

function urlEditor(cell, col, rowData, done) {
  // image / icon — edituje se přímo hodnota (URL / data: URI / emoji / klíč)
  const input = el('input.lattice-edit-input', { type: 'text', value: str(rowData[col.field]) });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => done(input.value), () => done(undefined));
}

function booleanEditor(cell, col, rowData, done) {
  const cur = rowData[col.field];
  done(!(cur === true || cur === 1 || cur === '1' || cur === 'true')); // přepne 2 hodnoty
}
function tickEditor(cell, col, rowData, done) { booleanEditor(cell, col, rowData, done); }

/* ============ rating — klik na hvězdičku ============ */

function ratingEditor(cell, col, rowData, done) {
  const max = (col.formatterParams && col.formatterParams.max != null) ? col.formatterParams.max : 5;
  const cur = Math.round(num(rowData[col.field]) || 0);
  const wrap = el('span.lattice-edit-rating');
  const render = (val) => {
    clear(wrap);
    for (let i = 1; i <= max; i++) {
      const s = el('span.lattice-star ' + (i <= val ? 'is-on' : 'is-off'), { text: '★' });
      s.dataset.v = String(i);
      wrap.appendChild(s);
    }
  };
  render(cur);
  wrap.addEventListener('mousemove', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) render(Number(v)); });
  wrap.addEventListener('mouseleave', () => render(cur));
  wrap.addEventListener('mousedown', (e) => { e.preventDefault(); const v = e.target.dataset && e.target.dataset.v; if (v) done(Number(v)); });
  swapCell(cell, wrap);
  const off = onOutside(wrap, () => { off(); done(undefined); });
}

/* ============ progress — tažení myší ============ */

function progressEditor(cell, col, rowData, done) {
  const max = (col.formatterParams && col.formatterParams.max != null) ? col.formatterParams.max : 100;
  let val = clamp(num(rowData[col.field]) || 0, 0, max);
  const bar = el('div.lattice-edit-progress-bar');
  const track = el('div.lattice-edit-progress', {}, [bar]);
  const label = el('span.lattice-edit-progress-label');
  const apply = (pct) => { pct = clamp(pct, 0, 1); val = Math.round(pct * max); bar.style.width = (pct * 100) + '%'; label.textContent = Math.round(pct * 100) + ' %'; };
  apply(val / max);

  const fromX = (clientX) => { const r = track.getBoundingClientRect(); apply((clientX - r.left) / r.width); };
  track.addEventListener('mousedown', (e) => {
    e.preventDefault();
    fromX(e.clientX);
    const mv = (ev) => fromX(ev.clientX);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); done(val); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
  swapCell(cell, el('div.lattice-edit-progress-wrap', {}, [track, label]));
  const off = onOutside(track, () => { off(); done(undefined); });
}

/* ============ link — text (anchor) + URL, zachová ostatní atributy ============ */

function linkEditor(cell, col, rowData, done) {
  const cur = rowData[col.field];
  const isObj = cur != null && typeof cur === 'object';
  const menu = el('div.lattice-menu.lattice-edit-popup');
  const t = (k) => k;
  let inputs;
  if (isObj) {
    const label = el('input.lattice-edit-input', { type: 'text', value: str(cur.label != null ? cur.label : (cur.text != null ? cur.text : '')) });
    const url = el('input.lattice-edit-input', { type: 'text', value: str(cur.url != null ? cur.url : (cur.href != null ? cur.href : '')) });
    const target = el('input.lattice-edit-input', { type: 'text', value: str(cur.target || '') });
    menu.append(row('Text', label), row('URL', url), row('Target', target));
    inputs = () => {
      const out = { ...cur }; // zachovat ostatní atributy
      if ('label' in cur || cur.label != null) out.label = label.value; else out.text = label.value;
      if ('url' in cur || cur.url != null) out.url = url.value; else out.href = url.value;
      out.target = target.value || undefined;
      return out;
    };
  } else {
    // hodnota je prostý řetězec (URL/část) — edituje se jako text
    const url = el('input.lattice-edit-input', { type: 'text', value: str(cur) });
    menu.append(row('URL', url));
    inputs = () => url.value;
  }
  const okBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: '✓' });
  okBtn.addEventListener('click', () => { close(); done(inputs()); });
  menu.appendChild(el('div.lattice-edit-popup-foot', {}, [okBtn]));

  openPopup(cell, menu, () => done(undefined));
  const off = onOutside(menu, (e) => { if (!menu.contains(e.target)) { close(); done(undefined); } });
  function close() { off(); menu.remove(); }
  function row(lbl, input) { return el('label.lattice-edit-row', {}, [el('span', { text: lbl }), input]); }
}

/* ============ color — picker (myš přes nativní vstup + RGB/CMYK/HEX) ============ */

function colorEditor(cell, col, rowData, done) {
  let rgb = parseColor(str(rowData[col.field])) || { r: 0, g: 0, b: 0 };
  const menu = el('div.lattice-menu.lattice-edit-popup.lattice-edit-color');

  const preview = el('input', { type: 'color', value: rgbToHex(rgb) }); // vizuální výběr myší
  const hex = el('input.lattice-edit-input', { type: 'text', value: rgbToHex(rgb) });
  const r = numIn(rgb.r), g = numIn(rgb.g), b = numIn(rgb.b);
  const cmyk = rgbToCmyk(rgb);
  const c = numIn(cmyk.c, 100), m = numIn(cmyk.m, 100), y = numIn(cmyk.y, 100), k = numIn(cmyk.k, 100);

  const syncFrom = (src) => {
    if (src === 'picker') rgb = parseColor(preview.value);
    else if (src === 'hex') { const p = parseColor(hex.value); if (p) rgb = p; }
    else if (src === 'rgb') rgb = { r: clampI(r.value, 255), g: clampI(g.value, 255), b: clampI(b.value, 255) };
    else if (src === 'cmyk') rgb = cmykToRgb({ c: clampI(c.value, 100), m: clampI(m.value, 100), y: clampI(y.value, 100), k: clampI(k.value, 100) });
    const hx = rgbToHex(rgb);
    preview.value = hx; hex.value = hx;
    r.value = rgb.r; g.value = rgb.g; b.value = rgb.b;
    const ck = rgbToCmyk(rgb); c.value = ck.c; m.value = ck.m; y.value = ck.y; k.value = ck.k;
  };
  preview.addEventListener('input', () => syncFrom('picker'));
  hex.addEventListener('change', () => syncFrom('hex'));
  [r, g, b].forEach((i) => i.addEventListener('input', () => syncFrom('rgb')));
  [c, m, y, k].forEach((i) => i.addEventListener('input', () => syncFrom('cmyk')));

  menu.append(
    el('div.lattice-edit-color-top', {}, [preview, el('label', {}, [el('span', { text: 'HEX' }), hex])]),
    el('div.lattice-edit-color-grp', {}, [el('span.lattice-edit-color-lbl', { text: 'RGB' }), r, g, b]),
    el('div.lattice-edit-color-grp', {}, [el('span.lattice-edit-color-lbl', { text: 'CMYK' }), c, m, y, k]),
  );
  const okBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: '✓' });
  okBtn.addEventListener('click', () => { close(); done(rgbToHex(rgb)); });
  menu.appendChild(el('div.lattice-edit-popup-foot', {}, [okBtn]));

  openPopup(cell, menu, () => done(undefined));
  const off = onOutside(menu, (e) => { if (!menu.contains(e.target)) { close(); done(undefined); } });
  function close() { off(); menu.remove(); }
  function numIn(v, maxAttr = 255) { return el('input.lattice-edit-num', { type: 'number', min: 0, max: maxAttr, value: v }); }
}

/* ============ date / datetime — kalendář (+ čas), bez závislostí ============ */

function dateEditor(withTime) {
  return (cell, col, rowData, done) => {
    const cur = parseDate(rowData[col.field]) || new Date();
    let view = { y: cur.getFullYear(), m: cur.getMonth() };
    let picked = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const menu = el('div.lattice-menu.lattice-edit-popup.lattice-edit-date');
    const cal = el('div.lattice-edit-cal');
    const time = withTime ? el('div.lattice-edit-time') : null;
    let hh = cur.getHours(), mm = cur.getMinutes();

    const monthsCs = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
    const renderCal = () => {
      clear(cal);
      const head = el('div.lattice-edit-cal-head');
      const prev = el('button.lattice-dr-nav', { type: 'button', html: '‹' });
      const next = el('button.lattice-dr-nav', { type: 'button', html: '›' });
      prev.addEventListener('click', () => { view = addMonth(view, -1); renderCal(); });
      next.addEventListener('click', () => { view = addMonth(view, 1); renderCal(); });
      head.append(prev, el('span.lattice-dr-cal-title', { text: monthsCs[view.m] + ' ' + view.y }), next);
      cal.appendChild(head);
      const wd = el('div.lattice-dr-weekdays');
      for (const d of ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']) wd.appendChild(el('span', { text: d }));
      cal.appendChild(wd);
      const grid = el('div.lattice-dr-grid');
      for (const c of monthMatrix(view.y, view.m)) {
        const btn = el('button.lattice-dr-day', { type: 'button', text: String(c.date.getDate()) });
        if (!c.inMonth) btn.classList.add('is-out');
        if (sameDay(c.date, picked)) btn.classList.add('is-selected');
        btn.addEventListener('click', () => { picked = c.date; if (!withTime) commit(); else renderCal(); });
        grid.appendChild(btn);
      }
      cal.appendChild(grid);
    };
    renderCal();
    menu.appendChild(cal);

    if (withTime) {
      const h = el('input.lattice-edit-num', { type: 'number', min: 0, max: 23, value: pad(hh) });
      const mi = el('input.lattice-edit-num', { type: 'number', min: 0, max: 59, value: pad(mm) });
      h.addEventListener('input', () => { hh = clampI(h.value, 23); });
      mi.addEventListener('input', () => { mm = clampI(mi.value, 59); });
      const ok = el('button.lattice-dr-btn.is-primary', { type: 'button', text: '✓' });
      ok.addEventListener('click', () => commit());
      time.append(el('span', { text: '⏱' }), h, el('span', { text: ':' }), mi, ok);
      menu.appendChild(time);
    }

    openPopup(cell, menu, () => done(undefined));
    const off = onOutside(menu, (e) => { if (!menu.contains(e.target)) { close(); done(undefined); } });
    function close() { off(); menu.remove(); }
    function commit() {
      close();
      const d = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), withTime ? hh : 0, withTime ? mm : 0);
      done(withTime ? isoDateTime(d) : isoDate(d));
    }
  };
}

/* ============ select / multiselect (Select2-like, bez závislostí) ============ */

function selectEditor(cell, col, rowData, done) {
  loadOptions(col).then((opts) => {
    const menu = el('div.lattice-menu.lattice-edit-popup.lattice-edit-select');
    const cur = str(rowData[col.field]);
    for (const o of opts) {
      const item = el('div.lattice-menu-item' + (norm(o.value) === norm(cur) ? '.is-active' : ''), { text: o.label });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); close(); done(o.value); });
      menu.appendChild(item);
    }
    openPopup(cell, menu, () => done(undefined));
    const off = onOutside(menu, (e) => { if (!menu.contains(e.target)) { close(); done(undefined); } });
    function close() { off(); menu.remove(); }
  });
}

function multiselectEditor(cell, col, rowData, done) {
  loadOptions(col).then((opts) => {
    const cur = Array.isArray(rowData[col.field]) ? rowData[col.field].map(String) : (rowData[col.field] != null && rowData[col.field] !== '' ? [String(rowData[col.field])] : []);
    const sel = new Set(cur.map(norm));
    const menu = el('div.lattice-menu.lattice-edit-popup.lattice-edit-select');
    const list = el('div.lattice-ms-list');
    const render = () => {
      clear(list);
      for (const o of opts) {
        const on = sel.has(norm(o.value));
        const item = el('div.lattice-menu-item' + (on ? '.is-selected' : ''), {}, [
          el('span.lattice-ms-check', { text: on ? '✓' : '' }), el('span', { text: o.label }),
        ]);
        item.addEventListener('mousedown', (e) => { e.preventDefault(); if (sel.has(norm(o.value))) sel.delete(norm(o.value)); else sel.add(norm(o.value)); render(); });
        list.appendChild(item);
      }
    };
    render();
    const ok = el('button.lattice-dr-btn.is-primary', { type: 'button', text: '✓' });
    ok.addEventListener('click', () => { close(); done(opts.filter((o) => sel.has(norm(o.value))).map((o) => o.value)); });
    menu.append(list, el('div.lattice-edit-popup-foot', {}, [ok]));
    openPopup(cell, menu, () => done(undefined));
    const off = onOutside(menu, (e) => { if (!menu.contains(e.target)) { close(); done(undefined); } });
    function close() { off(); menu.remove(); }
  });
}

function loadOptions(col) {
  const norm = (o) => (o != null && typeof o === 'object' ? { value: String(o.value), label: String(o.label != null ? o.label : o.value) } : { value: String(o), label: String(o) });
  // Číselník je sdílený s filtrem, takže může obsahovat token volby „(prázdné)".
  // Do editoru nepatří — je to hodnota FILTRU, ne buňky (zapsal by se do dat).
  const usable = (list) => list.map(norm).filter((o) => o.value !== EMPTY_FILTER_VALUE);
  if (Array.isArray(col.filterValues)) return Promise.resolve(usable(col.filterValues));
  if (col.filterUrl) return fetch(col.filterUrl).then((r) => r.json()).then((d) => usable(Array.isArray(d) ? d : d.data || [])).catch(() => []);
  return Promise.resolve([]);
}

/* ============ pomocné ============ */

function swapCell(cell, node) { clear(cell); cell.appendChild(node); }
function focusInput(input) { setTimeout(() => { input.focus(); input.select && input.select(); }, 0); }
function bindInput(input, commit, cancel) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}
function openPopup(cell, menu, onCancelEsc) {
  document.body.appendChild(menu);
  positionUnder(menu, cell);
  const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); onCancelEsc(); menu.remove(); } };
  document.addEventListener('keydown', onKey);
}

function str(v) { return v == null ? '' : String(v); }
function num(v) { if (v == null || v === '') return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
function norm(v) { return String(v ?? '').toLowerCase().trim(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampI(v, hi) { return clamp(Math.round(Number(v) || 0), 0, hi); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const pad = (n) => String(n).padStart(2, '0');

/* datum */
function parseDate(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function addMonth(v, delta) { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; }
function monthMatrix(y, m) { const first = new Date(y, m, 1); const off = (first.getDay() + 6) % 7; const out = []; for (let i = 0; i < 42; i++) { const date = new Date(y, m, 1 - off + i); out.push({ date, inMonth: date.getMonth() === m }); } return out; }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function isoDateTime(d) { return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/* barva */
function parseColor(s) {
  s = String(s || '').trim();
  let m = s.match(/^#?([0-9a-f]{6})$/i); if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  m = s.match(/^#?([0-9a-f]{3})$/i); if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
  m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i); if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}
function rgbToHex({ r, g, b }) { return '#' + [r, g, b].map((x) => pad(clamp(Math.round(x), 0, 255).toString(16))).join(''); }
function rgbToCmyk({ r, g, b }) {
  r /= 255; g /= 255; b /= 255; const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: Math.round((1 - r - k) / (1 - k) * 100), m: Math.round((1 - g - k) / (1 - k) * 100), y: Math.round((1 - b - k) / (1 - k) * 100), k: Math.round(k * 100) };
}
function cmykToRgb({ c, m, y, k }) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return { r: Math.round(255 * (1 - c) * (1 - k)), g: Math.round(255 * (1 - m) * (1 - k)), b: Math.round(255 * (1 - y) * (1 - k)) };
}
