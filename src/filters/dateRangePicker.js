/**
 * Date-range picker — jedno pole „Období…", které otevře dialog s presety
 * (Dnes, Tento týden, Posledních 30 dní, …) a dvěma kalendáři pro vlastní
 * rozsah. Bez závislosti.
 *
 * Hodnota filtru zůstává { from: 'YYYY-MM-DD'|null, to: 'YYYY-MM-DD'|null },
 * takže match/toServer/persistence date-range filtru se nemění.
 */
import { el, clear, onOutside } from '../util/dom.js';

export function buildDateRangePicker(column, ctx) {
  const t = (k) => ctx.i18n.t('dateRange.' + k);
  const monthName = (m) => dictArr('months')[m];
  const weekdayNames = () => dictArr('weekdays');
  function dictArr(key) {
    // i18n.t vrací jen stringy; pole (měsíce/dny) čteme přímo ze slovníku.
    const d = ctx.i18n.dict && ctx.i18n.dict.dateRange && ctx.i18n.dict.dateRange[key];
    if (Array.isArray(d)) return d;
    return key === 'months'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  }

  // `applied` = aktuálně použitý filtr (co vidí pole); `draft` = rozpracovaný
  // výběr v dialogu (Zrušit ho zahodí, Použít ho promítne do applied).
  let applied = { from: parseISO(ctx.value?.from), to: parseISO(ctx.value?.to) };
  let draft = cloneRange(applied);
  let leftView = viewOf(draft.from) || viewOf(new Date());
  let rightView = viewOf(draft.to) || nextMonth(leftView);
  if (sameView(leftView, rightView)) rightView = nextMonth(leftView);

  let panel = null;
  let closeFn = null;

  const control = el('div.lattice-dr', { tabindex: '0' });
  const text = el('span.lattice-dr-text');
  const clearBtn = el('button.lattice-dr-clear', { type: 'button', html: '×', title: t('clear') });
  clearBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); clearFilter(); });
  control.append(text, clearBtn, el('span.lattice-dr-icon', { html: CAL_SVG }));
  updateControl();

  control.addEventListener('mousedown', (e) => { e.preventDefault(); panel ? close() : open(); });
  control.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel ? close() : open(); }
    if (e.key === 'Escape') close();
  });

  function updateControl() {
    const { from, to } = applied;
    if (!from && !to) {
      text.textContent = t('placeholder');
      text.classList.add('is-placeholder');
      clearBtn.style.display = 'none';
    } else {
      text.classList.remove('is-placeholder');
      text.textContent = rangeText(from, to);
      clearBtn.style.display = '';
    }
  }

  function clearFilter() {
    applied = { from: null, to: null };
    draft = { from: null, to: null };
    ctx.onChange(null);
    updateControl();
    close();
  }

  function rangeText(from, to) {
    if (from && to) return disp(from) + ' – ' + disp(to);
    if (from) return disp(from) + ' –';
    if (to) return '– ' + disp(to);
    return '';
  }

  /* ---------------- dialog ---------------- */

  function open() {
    if (panel) return;
    // vždy začít od aktuálně použité hodnoty (Zrušit pak zahodí rozdělané změny)
    draft = cloneRange(applied);
    leftView = viewOf(draft.from) || viewOf(new Date());
    rightView = viewOf(draft.to) || nextMonth(leftView);
    if (sameView(leftView, rightView)) rightView = nextMonth(leftView);

    panel = el('div.lattice-dr-panel');

    const body = el('div.lattice-dr-body');
    const presets = el('div.lattice-dr-presets');
    const cals = el('div.lattice-dr-cals');
    const leftCal = el('div.lattice-dr-cal');
    const rightCal = el('div.lattice-dr-cal');
    cals.append(leftCal, rightCal);
    body.append(presets, cals);

    const footer = el('div.lattice-dr-footer');
    const rangeLabel = el('span.lattice-dr-range');
    const cancelBtn = el('button.lattice-dr-btn', { type: 'button', text: t('cancel') });
    const applyBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: t('apply') });
    cancelBtn.addEventListener('click', () => close());
    applyBtn.addEventListener('click', () => apply());
    footer.append(rangeLabel, el('div.lattice-dr-footer-btns', {}, [cancelBtn, applyBtn]));

    panel.append(body, footer);
    document.body.appendChild(panel);

    panel._nodes = { presets, leftCal, rightCal, rangeLabel };
    renderPresets();
    renderAll();
    position();

    control.classList.add('is-open');
    closeFn = onOutside(panel, (e) => { if (!control.contains(e.target)) close(); });
  }

  function close() {
    closeFn?.();
    panel?.remove();
    panel = null;
    closeFn = null;
    control.classList.remove('is-open');
  }

  function apply() {
    applied = cloneRange(draft);
    const { from, to } = applied;
    if (!from && !to) ctx.onChange(null);
    else ctx.onChange({ from: from ? toISO(from) : null, to: to ? toISO(to) : from ? toISO(from) : null });
    updateControl();
    close();
  }

  function position() {
    const r = control.getBoundingClientRect();
    panel.style.position = 'absolute';
    panel.style.top = window.scrollY + r.bottom + 2 + 'px';
    const w = panel.offsetWidth;
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 8;
    panel.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
  }

  /* ---------------- presety ---------------- */

  function renderPresets() {
    const { presets } = panel._nodes;
    clear(presets);
    for (const p of PRESETS) {
      const row = el('div.lattice-dr-preset', { text: ctx.i18n.t('dateRange.presets.' + p.key) });
      row.addEventListener('click', () => setRange(p.range()));
      presets.appendChild(row);
    }
    const clearRow = el('div.lattice-dr-preset.is-clear', { text: '✕ ' + t('clear') });
    clearRow.addEventListener('click', () => clearFilter()); // vypne filtr hned
    presets.appendChild(clearRow);
  }

  function setRange({ from, to }) {
    draft = { from: from || null, to: to || null };
    if (draft.from) leftView = viewOf(draft.from);
    if (draft.to) rightView = viewOf(draft.to);
    else rightView = nextMonth(leftView);
    if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
    renderAll();
  }

  /* ---------------- kalendáře ---------------- */

  function renderAll() {
    renderMonth('left', leftView);
    renderMonth('right', rightView);
    panel._nodes.rangeLabel.textContent = rangeText(draft.from, draft.to);
  }

  function renderMonth(side, view) {
    const container = side === 'left' ? panel._nodes.leftCal : panel._nodes.rightCal;
    clear(container);

    const head = el('div.lattice-dr-cal-head');
    const prev = el('button.lattice-dr-nav', { type: 'button', html: '‹' });
    const next = el('button.lattice-dr-nav', { type: 'button', html: '›' });
    prev.addEventListener('click', () => shift(side, -1));
    next.addEventListener('click', () => shift(side, +1));
    head.append(prev, el('span.lattice-dr-cal-title', { text: monthName(view.m) + ' ' + view.y }), next);
    container.appendChild(head);

    const wd = el('div.lattice-dr-weekdays');
    for (const w of weekdayNames()) wd.appendChild(el('span', { text: w }));
    container.appendChild(wd);

    const grid = el('div.lattice-dr-grid');
    for (const cell of monthMatrix(view.y, view.m)) {
      const btn = el('button.lattice-dr-day', { type: 'button', text: String(cell.date.getDate()) });
      if (!cell.inMonth) btn.classList.add('is-out');
      markDay(btn, cell.date);
      btn.addEventListener('click', () => pickDay(cell.date));
      grid.appendChild(btn);
    }
    container.appendChild(grid);
  }

  function markDay(btn, date) {
    const { from, to } = draft;
    const ts = date.getTime();
    if (from && ts === from.getTime()) btn.classList.add('is-selected', 'is-from');
    if (to && ts === to.getTime()) btn.classList.add('is-selected', 'is-to');
    if (from && to && ts > from.getTime() && ts < to.getTime()) btn.classList.add('is-in-range');
  }

  function pickDay(date) {
    if (!draft.from || (draft.from && draft.to)) {
      draft = { from: date, to: null };
    } else if (date.getTime() < draft.from.getTime()) {
      draft = { from: date, to: draft.from };
    } else {
      draft.to = date;
    }
    renderAll();
  }

  function shift(side, delta) {
    if (side === 'left') leftView = addMonths(leftView, delta);
    else rightView = addMonths(rightView, delta);
    renderMonth(side, side === 'left' ? leftView : rightView);
  }

  function disp(d) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  return control;
}

/* ================= datum utils ================= */

function parseISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const pad = (n) => String(n).padStart(2, '0');

function cloneRange(r) { return { from: r.from ? new Date(r.from) : null, to: r.to ? new Date(r.to) : null }; }
function viewOf(d) { return d ? { y: d.getFullYear(), m: d.getMonth() } : null; }
function sameView(a, b) { return a && b && a.y === b.y && a.m === b.m; }
function nextMonth(v) { return addMonths(v, 1); }
function addMonths(v, delta) {
  const d = new Date(v.y, v.m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

/** 6týdenní matice (pondělí první); {date, inMonth}. */
function monthMatrix(y, m) {
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // 0 = pondělí
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(y, m, 1 - offset + i);
    cells.push({ date, inMonth: date.getMonth() === m });
  }
  return cells;
}

/* ================= presety ================= */

function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function startOfWeek(d) { return addDays(d, -((d.getDay() + 6) % 7)); } // pondělí
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

const PRESETS = [
  { key: 'today', range: () => ({ from: today(), to: today() }) },
  { key: 'yesterday', range: () => ({ from: addDays(today(), -1), to: addDays(today(), -1) }) },
  { key: 'weekToDate', range: () => ({ from: startOfWeek(today()), to: today() }) },
  { key: 'thisWeek', range: () => ({ from: startOfWeek(today()), to: addDays(startOfWeek(today()), 6) }) },
  { key: 'lastWeek', range: () => ({ from: addDays(startOfWeek(today()), -7), to: addDays(startOfWeek(today()), -1) }) },
  { key: 'last7', range: () => ({ from: addDays(today(), -6), to: today() }) },
  { key: 'last30', range: () => ({ from: addDays(today(), -29), to: today() }) },
  { key: 'monthToDate', range: () => ({ from: startOfMonth(today()), to: today() }) },
  { key: 'thisMonth', range: () => ({ from: startOfMonth(today()), to: endOfMonth(today()) }) },
  { key: 'lastMonth', range: () => { const d = new Date(today().getFullYear(), today().getMonth() - 1, 1); return { from: startOfMonth(d), to: endOfMonth(d) }; } },
  { key: 'thisQuarter', range: () => { const t = today(); const qs = Math.floor(t.getMonth() / 3) * 3; return { from: new Date(t.getFullYear(), qs, 1), to: new Date(t.getFullYear(), qs + 3, 0) }; } },
  { key: 'nextMonth', range: () => { const d = new Date(today().getFullYear(), today().getMonth() + 1, 1); return { from: startOfMonth(d), to: endOfMonth(d) }; } },
  { key: 'next3Months', range: () => { const s = new Date(today().getFullYear(), today().getMonth() + 1, 1); const e = new Date(s.getFullYear(), s.getMonth() + 3, 0); return { from: s, to: e }; } },
];

const CAL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 7v10H5V9h14z"/></svg>';
