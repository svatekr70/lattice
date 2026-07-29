/**
 * Datové typy sloupců → formátování buňky.
 *
 * `type` v definici sloupce určuje, jak se hodnota zobrazí (a nepřímo i
 * defaultní typ filtru — mapování je ve filters/). Registr je otevřený:
 * `registerType()` umožní přidat vlastní typ bez zásahu do jádra.
 *
 * Formatter: (value, column, rowData) => string | Node
 */

import { openLightbox } from '../features/lightbox.js';
import { DEFAULT_FORMATS, formatKind, formatNumber, formatMoney, formatDate } from '../core/format.js';

/** Efektivní formát sloupce (renderer ho stashne na col._fmt), s bezpečným fallbackem. */
function effFmt(col, kind) {
  if (col._fmt) return col._fmt;
  return { ...DEFAULT_FORMATS[kind], ...(col.formatterParams || {}) };
}
/** Span pro záporné číslo (obarvení dle formátu negative: red/redparen). */
function negText(r) {
  if (!r.red) return r.text;
  const span = document.createElement('span');
  span.className = 'lattice-num-neg';
  span.textContent = r.text;
  return span;
}

const registry = new Map();

export function registerType(name, formatter) {
  registry.set(name, formatter);
}

export function getFormatter(column) {
  // Vlastní formatter na sloupci má přednost.
  if (typeof column.formatter === 'function') return column.formatter;
  return registry.get(column.type) || registry.get('text');
}

/** Bezpečné číslo z hodnoty (podporuje čárku i tečku). */
function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ---- vestavěné typy ---------------------------------------------------- */

registerType('text', (v) => (v == null ? '' : String(v)));

// Identifikátor záznamu — vždy jen text, nikdy se needituje (viz ColumnModel).
registerType('id', (v) => (v == null ? '' : String(v)));

registerType('number', (v, col) => {
  const n = toNumber(v);
  if (n == null) return '';
  return negText(formatNumber(n, effFmt(col, 'number')));
});

registerType('money', (v, col) => {
  const n = toNumber(v);
  if (n == null) return '';
  return negText(formatMoney(n, effFmt(col, 'money')));
});

registerType('date', (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, 'date').pattern, col._i18n) : '';
});

registerType('datetime', (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, 'datetime').pattern, col._i18n) : '';
});

registerType('time', (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, 'time').pattern, col._i18n) : '';
});

registerType('boolean', (v) => {
  const truthy = v === true || v === 1 || v === '1' || v === 'true';
  const span = document.createElement('span');
  span.className = 'lattice-bool ' + (truthy ? 'is-true' : 'is-false');
  span.textContent = truthy ? '✓' : '✕';
  return span;
});

/**
 * Progress — vodorovný pruh (číselná hodnota jako podíl z max).
 * formatterParams: { max=100, color, showValue }
 */
registerType('progress', (v, col) => {
  const p = col.formatterParams || {};
  const max = p.max != null ? p.max : 100;
  const n = toNumber(v) ?? 0;
  const pct = Math.max(0, Math.min(100, (n / max) * 100));

  const wrap = document.createElement('div');
  wrap.className = 'lattice-progress';
  wrap.title = max === 100 ? `${Math.round(pct)} %` : `${Math.round(n)} / ${max}`;

  const bar = document.createElement('div');
  bar.className = 'lattice-progress-bar';
  bar.style.width = pct + '%';
  if (p.color) bar.style.background = p.color;
  wrap.appendChild(bar);

  if (p.showValue) {
    const label = document.createElement('span');
    label.className = 'lattice-progress-label';
    label.textContent = Math.round(pct) + ' %';
    wrap.appendChild(label);
  }
  return wrap;
});

/**
 * Sparkline — mini graf z pole hodnot (nebo CSV/mezerami odděleného řetězce).
 * Čisté SVG, bez závislosti. Barva se dědí z motivu (currentColor), přepíše `color`.
 * formatterParams: { type:'line'|'bar', color, width=80, height=22, min, max, fill, dot }
 */
registerType('sparkline', (v, col) => {
  const p = col.formatterParams || {};
  let nums = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,;\s]+/) : []);
  nums = nums.map(toNumber).filter((x) => x != null);
  if (!nums.length) return '';
  const NS = 'http://www.w3.org/2000/svg';
  const w = p.width || 80, h = p.height || 22, pad = 2;
  const iw = w - pad * 2, ih = h - pad * 2;
  const min = p.min != null ? p.min : Math.min(...nums);
  const max = p.max != null ? p.max : Math.max(...nums);
  const span = (max - min) || 1;
  const X = (i) => pad + (nums.length === 1 ? iw / 2 : (i / (nums.length - 1)) * iw);
  const Y = (val) => pad + ih - ((val - min) / span) * ih;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'lattice-sparkline');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (p.color) svg.style.color = p.color;
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  if (p.type === 'bar') {
    const bw = iw / nums.length;
    nums.forEach((val, i) => {
      const bh = Math.max(0.5, ((val - min) / span) * ih);
      svg.appendChild(mk('rect', { x: (pad + i * bw + bw * 0.1).toFixed(1), y: (pad + ih - bh).toFixed(1), width: (bw * 0.8).toFixed(1), height: bh.toFixed(1), fill: 'currentColor' }));
    });
  } else {
    const d = nums.map((val, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(val).toFixed(1)).join(' ');
    if (p.fill) svg.appendChild(mk('path', { d: `${d} L${X(nums.length - 1).toFixed(1)} ${(pad + ih).toFixed(1)} L${X(0).toFixed(1)} ${(pad + ih).toFixed(1)} Z`, fill: 'currentColor', opacity: '0.15' }));
    svg.appendChild(mk('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': p.strokeWidth || 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (p.dot !== false) svg.appendChild(mk('circle', { cx: X(nums.length - 1).toFixed(1), cy: Y(nums[nums.length - 1]).toFixed(1), r: '1.6', fill: 'currentColor' }));
  }
  const wrap = document.createElement('span');
  wrap.className = 'lattice-sparkline-wrap';
  wrap.title = nums.join(', ');
  wrap.appendChild(svg);
  return wrap;
});

/**
 * Odkaz (anchor). formatterParams: { urlPrefix, urlSuffix, urlField, url, target, label, rel }
 * Zobrazený text = hodnota sloupce (nebo statický `label`).
 * URL se skládá takto (první, co je definované):
 *   - `url(value, row, col)` — builder funkce vracející celé href,
 *   - jinak `urlPrefix + (row[urlField] ?? value) + urlSuffix` — `urlField` umožní
 *     odkazovat přes jiné pole (např. ID), než které se zobrazuje (např. název).
 * Cíl: explicitní `formatterParams.target` vyhrává; jinak globální `instance.linkNewTab`.
 * Při otevírání v nové kartě se vpravo přidá ikona externího odkazu.
 */
registerType('link', (v, col, row) => {
  if (v == null || v === '') return '';
  const p = col.formatterParams || {};
  const a = document.createElement('a');
  a.className = 'lattice-link';
  if (typeof p.url === 'function') {
    a.href = String(p.url(v, row, col) ?? '');
  } else {
    const base = p.urlField != null && row ? row[p.urlField] : v;
    a.href = (p.urlPrefix || '') + String(base ?? '') + (p.urlSuffix || '');
  }
  a.textContent = p.label != null ? p.label : String(v);
  let target = p.target;
  if (target == null) target = col._linkNewTab ? '_blank' : '_self';
  if (target === '_blank') {
    a.target = '_blank';
    a.rel = p.rel || 'noopener noreferrer';
    a.appendChild(extLinkIcon());
  } else if (target && target !== '_self') {
    a.target = target;
  }
  return a;
});

/** Malá ikona „externí odkaz" (šipka z rámečku) — vpravo za textem odkazu. */
function extLinkIcon() {
  const s = document.createElement('span');
  s.className = 'lattice-link-ext';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5"/></svg>';
  return s;
}

/**
 * Obrázek z URL nebo data: URI. formatterParams: { height, width, alt, lightbox }
 * Ve výchozím stavu klik otevře náhled ve větším (lightbox: false vypne).
 */
registerType('image', (v, col) => {
  if (v == null || v === '') return '';
  const p = col.formatterParams || {};
  const img = document.createElement('img');
  img.className = 'lattice-img';
  img.src = String(v); // funguje pro http(s) URL i data: URI
  img.loading = 'lazy';
  img.alt = p.alt || '';
  const dim = (x) => (typeof x === 'number' ? x + 'px' : x);
  if (p.height) img.style.height = dim(p.height);
  if (p.width) img.style.width = dim(p.width);
  if (p.lightbox !== false) {
    img.classList.add('is-zoomable');
    img.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(String(v), p.alt); });
  }
  return img;
});

/**
 * Ikona — malá ikona/emoji. formatterParams: { icons, size, title, alt }
 *  - icons: mapa hodnota→ikona (emoji / URL / data: URI); jinak se použije
 *    přímo hodnota jako emoji/glyf. URL/data: se vykreslí jako malý obrázek.
 */
registerType('icon', (v, col) => {
  const p = col.formatterParams || {};
  let g = v;
  if (p.icons && v != null && Object.prototype.hasOwnProperty.call(p.icons, v)) g = p.icons[v];
  if (g == null || g === '') return '';
  g = String(g);
  const span = document.createElement('span');
  span.className = 'lattice-icon';
  if (/^(https?:|data:)/.test(g)) {
    const img = document.createElement('img');
    img.className = 'lattice-icon-img';
    img.src = g;
    img.alt = p.alt || '';
    span.appendChild(img);
  } else {
    span.textContent = g; // emoji / glyf
  }
  if (p.size) span.style.fontSize = typeof p.size === 'number' ? p.size + 'px' : p.size;
  if (p.title != null) span.title = String(p.title);
  return span;
});

/** Barva — buňka s výplní zadané CSS barvy (hex/rgb/název). */
registerType('color', (v) => {
  const div = document.createElement('div');
  div.className = 'lattice-color-fill';
  if (v != null && v !== '') div.style.background = String(v);
  div.title = v != null ? String(v) : '';
  return div;
});

/** Tick — zelené ✓ když pravda, jinak prázdno (bez křížku). */
registerType('tick', (v) => {
  const truthy = v === true || v === 1 || v === '1' || v === 'true' || v === 'True';
  if (!truthy) return '';
  const span = document.createElement('span');
  span.className = 'lattice-bool is-true';
  span.textContent = '✓';
  return span;
});

/** HTML — vykreslí hodnotu jako HTML. POZOR: jen pro důvěryhodná data (XSS). */
registerType('html', (v) => {
  const span = document.createElement('span');
  span.innerHTML = v == null ? '' : String(v);
  return span;
});

/**
 * Rating — hvězdičkové hodnocení (číselná hodnota 0..max).
 * formatterParams: { max=5 }
 */
registerType('rating', (v, col) => {
  const p = col.formatterParams || {};
  const max = p.max != null ? p.max : 5;
  const n = Math.round(toNumber(v) ?? 0);

  const wrap = document.createElement('span');
  wrap.className = 'lattice-rating';
  wrap.title = `${n} / ${max}`;
  for (let i = 1; i <= max; i++) {
    const star = document.createElement('span');
    star.className = 'lattice-star ' + (i <= n ? 'is-on' : 'is-off');
    star.textContent = '★';
    wrap.appendChild(star);
  }
  return wrap;
});
