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
export function openMenu(anchor, items, onPick) {
  const menu = buildMenu(items, () => close(), onPick);
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
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

/** Sestaví menu element z položek (podpora separator/disabled/danger/active). */
function buildMenu(items, close, onPick) {
  const menu = el('div.lattice-menu');
  for (const it of items) {
    if (it.separator) { menu.appendChild(el('div.lattice-menu-sep')); continue; }
    const cls = [it.active ? 'is-active' : '', it.disabled ? 'is-disabled' : '', it.danger ? 'is-danger' : ''].filter(Boolean).join(' ');
    const row = el('div.lattice-menu-item', { class: cls, text: it.label });
    if (!it.disabled) row.addEventListener('click', () => { close(); onPick(it.value, it); });
    menu.appendChild(row);
  }
  return menu;
}
