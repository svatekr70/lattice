/**
 * openPopup — plovoucí panel s libovolným obsahem, ukotvený k prvku (buňka,
 * hlavička…). Obsah dodá `builder(close)` jako string (innerHTML) nebo Node;
 * dostane `close()`, takže interaktivní popup (mini-formulář) se umí sám zavřít.
 * Zavírá se klikem mimo / Escape. Vždy je otevřený jen jeden popup.
 */
import { el, onOutside } from '../util/dom.js';

export function openPopup(anchor, builder, opts = {}) {
  document.querySelectorAll('.lattice-popup').forEach((p) => p._close ? p._close() : p.remove());
  const popup = el('div.lattice-popup' + (opts.className ? '.' + opts.className : ''));
  let off;
  const close = () => { off?.(); popup.remove(); };
  popup._close = close;

  const content = builder(close);
  if (content instanceof Node) popup.appendChild(content);
  else popup.innerHTML = String(content == null ? '' : content);

  document.body.appendChild(popup);
  place(popup, anchor, opts.align);
  off = onOutside(popup, (e) => { if (!anchor.contains(e.target)) close(); });
  return close;
}

/** Umístí popup pod kotvu, zarovná vlevo (nebo vpravo) a udrží ve viewportu. */
function place(popup, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  popup.style.position = 'absolute';
  popup.style.top = window.scrollY + r.bottom + 4 + 'px';
  let left = align === 'right' ? window.scrollX + r.right - popup.offsetWidth : window.scrollX + r.left;
  const maxLeft = window.scrollX + vw - popup.offsetWidth - 8;
  popup.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
}
