/**
 * Picker barvy (záhlaví sloupce/skupiny i barvy buňky). Dva taby:
 *  - „Kolo" (výchozí) — hexagonální barevné kolo (hue × sytost) + jezdec jasu,
 *  - „Palety" — přednastavené kombinace à la Bootstrap + vlastní color input.
 * Režim 'pair' vrací dvojici pozadí+písmo (záhlaví), 'single' jednu barvu (buňka).
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

/** Záhlaví (pozadí + písmo). */
export function openHeaderColorPicker(anchor, opts) { return colorPickerMenu(anchor, { ...opts, mode: 'pair' }); }
/** Jedna barva (písmo NEBO pozadí buňky). */
export function openColorPicker(anchor, opts) { return colorPickerMenu(anchor, { ...opts, mode: 'single' }); }

function colorPickerMenu(anchor, opts) {
  const t = opts.t || ((k) => k);
  const pair = opts.mode === 'pair';
  document.querySelectorAll('.lattice-hcolor-menu').forEach((m) => m.remove());
  const menu = el('div.lattice-menu.lattice-hcolor-menu');
  menu.appendChild(el('div.lattice-summary-menu-head', { text: opts.title || t('headerColor.title') }));

  // v 'pair' režimu vybraná barva z kola = pozadí, písmo se dopočítá kontrastně
  const emit = (color) => { if (pair) opts.onPick(color, contrastFg(color)); else opts.onPick(color); close(); };

  /* --- taby --- */
  const tabWheel = el('button.lattice-hcolor-tab.is-active', { type: 'button', text: t('headerColor.tabWheel') });
  const tabPal = el('button.lattice-hcolor-tab', { type: 'button', text: t('headerColor.tabPalette') });
  menu.appendChild(el('div.lattice-hcolor-tabs', {}, [tabWheel, tabPal]));

  /* --- tab KOLO --- */
  const wheelPane = el('div.lattice-hcolor-pane');
  const wheel = buildWheel(196, (hex) => emit(hex));
  const bright = el('input.lattice-hcolor-bright', { type: 'range', min: '20', max: '100', value: '100' });
  bright.addEventListener('input', () => wheel.setValue(+bright.value / 100));
  wheelPane.append(wheel.el, el('label.lattice-hcolor-brightrow', {}, [
    el('span', { text: t('headerColor.brightness') }), bright,
  ]));
  menu.appendChild(wheelPane);

  /* --- tab PALETY --- */
  const palPane = el('div.lattice-hcolor-pane', { style: { display: 'none' } });
  const grid = el('div.lattice-hcolor-grid');
  for (const p of HEADER_COLOR_PRESETS) {
    const sw = el('button.lattice-hcolor-swatch', { type: 'button', title: p.label, style: { background: p.bg, color: pair ? p.fg : p.bg }, text: pair ? 'Aa' : '' });
    sw.addEventListener('click', () => { pair ? opts.onPick(p.bg, p.fg) : opts.onPick(p.bg); close(); });
    grid.appendChild(sw);
  }
  palPane.appendChild(grid);
  const cur = opts.current || {};
  if (pair) {
    const bgIn = el('input.lattice-hcolor-input', { type: 'color', value: normHex(cur.background) || '#0d6efd' });
    const fgIn = el('input.lattice-hcolor-input', { type: 'color', value: normHex(cur.color) || '#ffffff' });
    const apply = el('button.lattice-hcolor-apply', { type: 'button', text: t('headerColor.apply') });
    apply.addEventListener('click', () => { opts.onPick(bgIn.value, fgIn.value); close(); });
    palPane.appendChild(el('div.lattice-hcolor-custom', {}, [
      el('span.lattice-hcolor-lbl', { text: t('headerColor.custom') }),
      el('label.lattice-hcolor-field', {}, [el('span', { text: t('headerColor.bg') }), bgIn]),
      el('label.lattice-hcolor-field', {}, [el('span', { text: t('headerColor.text') }), fgIn]),
      apply,
    ]));
  } else {
    const inp = el('input.lattice-hcolor-input', { type: 'color', value: normHex(typeof cur === 'string' ? cur : cur.background) || '#0d6efd' });
    const apply = el('button.lattice-hcolor-apply', { type: 'button', text: t('headerColor.apply') });
    apply.addEventListener('click', () => { opts.onPick(inp.value); close(); });
    palPane.appendChild(el('div.lattice-hcolor-custom', {}, [
      el('span.lattice-hcolor-lbl', { text: t('headerColor.custom') }),
      el('label.lattice-hcolor-field', {}, [inp]), apply,
    ]));
  }
  menu.appendChild(palPane);

  const swap = (toPal) => {
    tabPal.classList.toggle('is-active', toPal);
    tabWheel.classList.toggle('is-active', !toPal);
    palPane.style.display = toPal ? '' : 'none';
    wheelPane.style.display = toPal ? 'none' : '';
  };
  tabWheel.addEventListener('click', () => swap(false));
  tabPal.addEventListener('click', () => swap(true));

  /* --- bez barvy (společné) --- */
  const clearBtn = el('button.lattice-hcolor-clear', { type: 'button', text: t('headerColor.none') });
  clearBtn.addEventListener('click', () => { opts.onClear(); close(); });
  menu.appendChild(clearBtn);

  document.body.appendChild(menu);
  placeUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

/* --------------------------- barevné kolo (SVG) --------------------------- */

/** Hexagonální kolo: úhel = odstín, vzdálenost od středu = sytost, jezdec = jas. */
function buildWheel(size, onPick) {
  const R = 6;                                    // počet prstenců
  const hexR = size / (2 * (1.5 * R + 1));
  const cx = size / 2, cy = size / 2;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  svg.setAttribute('class', 'lattice-hcolor-wheel');
  svg.style.width = size + 'px'; svg.style.height = size + 'px';
  let value = 1;
  const cells = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const px = cx + hexR * 1.5 * q;
      const py = cy + hexR * Math.sqrt(3) * (r + q / 2);
      const sat = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 / R;
      const hue = (Math.atan2(py - cy, px - cx) * 180 / Math.PI + 360) % 360;
      const poly = document.createElementNS(NS, 'polygon');
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 180 * (60 * k);
        pts.push((px + hexR * Math.cos(a)).toFixed(1) + ',' + (py + hexR * Math.sin(a)).toFixed(1));
      }
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('class', 'lattice-hcolor-hex');
      poly.addEventListener('click', () => onPick(colorOf(hue, sat, value)));
      svg.appendChild(poly);
      cells.push({ poly, hue, sat });
    }
  }
  const paint = () => { for (const c of cells) c.poly.setAttribute('fill', colorOf(c.hue, c.sat, value)); };
  paint();
  return { el: svg, setValue(v) { value = v; paint(); } };
}

function colorOf(hue, sat, val) { const [r, g, b] = hsvToRgb(hue, sat, val); return rgbToHex(r, g, b); }

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function hexToRgb(hex) { const h = normHex(hex) || '#000000'; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
/** Kontrastní barva písma (černá/bílá) k danému pozadí. */
function contrastFg(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000000' : '#ffffff'; }

/** Umístí popover pod kotvu. */
function placeUnder(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = window.scrollY + r.bottom + 4 + 'px';
  const left = window.scrollX + Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = Math.max(8, left) + 'px';
}

/** #rgb / #rrggbb → #rrggbb; jinak null. */
function normHex(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.toLowerCase();
}
