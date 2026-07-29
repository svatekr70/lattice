/**
 * Malé rozbalovací menu (dropdown) — použité pro výběr typu filtru u sloupce.
 * Zavírá se klikem mimo / Escape.
 */
import { el, onOutside } from '../util/dom.js';
import { positionUnder } from './gear.js';

/**
 * @param {HTMLElement} anchor  prvek, pod kterým se menu zobrazí
 * @param {Array<{value:string,label:string,active?:boolean}>} items
 * @param {(value:string)=>void} onPick
 * @returns {() => void} funkce pro zavření
 */
export function openMenu(anchor, items, onPick, opts = {}) {
  const menu = buildMenu(items, () => close(), onPick, opts);
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  // V multi režimu (checkboxy) zůstává otevřené — zavře až klik mimo menu / Escape.
  const off = onOutside(menu, (e) => { if (opts.multi || !anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

/**
 * Menu na konkrétních souřadnicích (kontextové menu, pravý klik). Udrží se ve
 * viewportu. `items` mohou mít `separator:true`.
 */
export function openMenuAt(x, y, items, onPick) {
  document.querySelectorAll('.lattice-menu').forEach((m) => m.remove());
  const menu = buildMenu(items, () => close(), onPick);
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const left = Math.min(x, window.scrollX + vw - menu.offsetWidth - 8);
  const top = Math.min(y, window.scrollY + vh - menu.offsetHeight - 8);
  menu.style.position = 'absolute';
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.visibility = '';
  const off = onOutside(menu, () => close());
  function close() { off(); menu.remove(); }
  return close;
}

/**
 * Sestaví menu element z položek (podpora separator/disabled/danger/active).
 * `opts.multi` = checkboxový režim: klik NEzavře menu (lze zapnout víc položek),
 * zaškrtnutí se po každém kliku přepočítá přes `opts.isActive(value)`.
 */
function buildMenu(items, close, onPick, opts = {}) {
  const multi = !!opts.multi;
  const menu = el('div.lattice-menu' + (multi ? '.lattice-menu-multi' : ''));
  for (const it of items) {
    if (it.separator) { menu.appendChild(el('div.lattice-menu-sep')); continue; }
    const cls = [it.active ? 'is-active' : '', it.disabled ? 'is-disabled' : '', it.danger ? 'is-danger' : ''].filter(Boolean).join(' ');
    const row = el('div.lattice-menu-item' + (multi ? '.is-checkable' : ''), { class: cls });
    if (multi) row.appendChild(el('span.lattice-menu-check', { 'aria-hidden': 'true' }));
    row.appendChild(el('span.lattice-menu-label', { text: it.label }));
    if (!it.disabled) {
      row.addEventListener('click', (e) => {
        if (multi) {
          e.stopPropagation();
          onPick(it.value, it);
          const now = opts.isActive ? opts.isActive(it.value) : !row.classList.contains('is-active');
          row.classList.toggle('is-active', now);
        } else {
          close(); onPick(it.value, it);
        }
      });
    }
    menu.appendChild(row);
  }
  return menu;
}
