/**
 * Picker barvy záhlaví (sloupce i skupiny). Nabízí přednastavené kombinace
 * (pozadí + písmo) ve stylu Bootstrap, možnost „bez barvy" a vlastní volbu
 * dvěma nativními color inputy. Sdílí ho dialog Sloupce (barva sloupce) i
 * záhlaví skupiny (barva skupiny).
 */
import { el, onOutside } from '../util/dom.js';

/** Přednastavené kombinace pozadí/písmo (à la Bootstrap theme colors). */
export const HEADER_COLOR_PRESETS = [
  { key: 'primary', label: 'Primary', bg: '#0d6efd', fg: '#ffffff' },
  { key: 'secondary', label: 'Secondary', bg: '#6c757d', fg: '#ffffff' },
  { key: 'success', label: 'Success', bg: '#198754', fg: '#ffffff' },
  { key: 'danger', label: 'Danger', bg: '#dc3545', fg: '#ffffff' },
  { key: 'warning', label: 'Warning', bg: '#ffc107', fg: '#000000' },
  { key: 'info', label: 'Info', bg: '#0dcaf0', fg: '#000000' },
  { key: 'light', label: 'Light', bg: '#f8f9fa', fg: '#212529' },
  { key: 'dark', label: 'Dark', bg: '#212529', fg: '#ffffff' },
];

/** Umístí popover pod kotvu (jednoduché, bez závislosti na gear.js). */
function placeUnder(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = window.scrollY + r.bottom + 4 + 'px';
  const left = window.scrollX + Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = Math.max(8, left) + 'px';
}

/**
 * Otevře picker barvy záhlaví.
 * @param {Element} anchor  kotva
 * @param {object}  opts    { t, current:{background,color}, onPick(bg,fg), onClear() }
 * @returns {function} close
 */
export function openHeaderColorPicker(anchor, opts) {
  const t = opts.t || ((k) => k);
  document.querySelectorAll('.lattice-hcolor-menu').forEach((m) => m.remove());
  const menu = el('div.lattice-menu.lattice-hcolor-menu');
  menu.appendChild(el('div.lattice-summary-menu-head', { text: t('headerColor.title') }));

  // Přednastavené kombinace.
  const grid = el('div.lattice-hcolor-grid');
  for (const p of HEADER_COLOR_PRESETS) {
    const sw = el('button.lattice-hcolor-swatch', {
      type: 'button', title: p.label,
      style: { background: p.bg, color: p.fg },
      text: 'Aa',
    });
    sw.addEventListener('click', () => { opts.onPick(p.bg, p.fg); close(); });
    grid.appendChild(sw);
  }
  menu.appendChild(grid);

  // Bez barvy.
  const clearBtn = el('button.lattice-hcolor-clear', { type: 'button', text: t('headerColor.none') });
  clearBtn.addEventListener('click', () => { opts.onClear(); close(); });
  menu.appendChild(clearBtn);

  // Vlastní barvy (nativní color inputy) + použít.
  const cur = opts.current || {};
  const bgIn = el('input.lattice-hcolor-input', { type: 'color', value: normHex(cur.background) || '#0d6efd' });
  const fgIn = el('input.lattice-hcolor-input', { type: 'color', value: normHex(cur.color) || '#ffffff' });
  const applyBtn = el('button.lattice-hcolor-apply', { type: 'button', text: t('headerColor.apply') });
  applyBtn.addEventListener('click', () => { opts.onPick(bgIn.value, fgIn.value); close(); });
  menu.appendChild(el('div.lattice-hcolor-custom', {}, [
    el('span.lattice-hcolor-lbl', { text: t('headerColor.custom') }),
    el('label.lattice-hcolor-field', {}, [el('span', { text: t('headerColor.bg') }), bgIn]),
    el('label.lattice-hcolor-field', {}, [el('span', { text: t('headerColor.text') }), fgIn]),
    applyBtn,
  ]));

  document.body.appendChild(menu);
  placeUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

/**
 * Picker JEDNÉ barvy (písmo NEBO pozadí buňky). Swatche = barvy z palety +
 * vlastní color input + „bez barvy".
 * @param {Element} anchor
 * @param {object} opts { t, current, onPick(color), onClear() }
 */
export function openColorPicker(anchor, opts) {
  const t = opts.t || ((k) => k);
  document.querySelectorAll('.lattice-hcolor-menu').forEach((m) => m.remove());
  const menu = el('div.lattice-menu.lattice-hcolor-menu');
  menu.appendChild(el('div.lattice-summary-menu-head', { text: opts.title || t('headerColor.title') }));

  const grid = el('div.lattice-hcolor-grid');
  for (const p of HEADER_COLOR_PRESETS) {
    const sw = el('button.lattice-hcolor-swatch', { type: 'button', title: p.label, style: { background: p.bg, color: p.bg } });
    sw.addEventListener('click', () => { opts.onPick(p.bg); close(); });
    grid.appendChild(sw);
  }
  menu.appendChild(grid);

  const clearBtn = el('button.lattice-hcolor-clear', { type: 'button', text: t('headerColor.none') });
  clearBtn.addEventListener('click', () => { opts.onClear(); close(); });
  menu.appendChild(clearBtn);

  const inp = el('input.lattice-hcolor-input', { type: 'color', value: normHex(opts.current) || '#0d6efd' });
  const applyBtn = el('button.lattice-hcolor-apply', { type: 'button', text: t('headerColor.apply') });
  applyBtn.addEventListener('click', () => { opts.onPick(inp.value); close(); });
  menu.appendChild(el('div.lattice-hcolor-custom', {}, [
    el('span.lattice-hcolor-lbl', { text: t('headerColor.custom') }),
    el('label.lattice-hcolor-field', {}, [inp]),
    applyBtn,
  ]));

  document.body.appendChild(menu);
  placeUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

/** #rgb / #rrggbb → #rrggbb (pro value color inputu); jinak null. */
function normHex(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.toLowerCase();
}
