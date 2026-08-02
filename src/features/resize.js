/**
 * Resize sloupců — chování jako v Excelu:
 *  - Tažení oddělovače (pravý okraj hlavičky) mění JEN šířku daného sloupce;
 *    ostatní se nemění, tabulka se celkově rozšíří/zúží (žádné „ubrat sousedovi").
 *  - Dvojklik na oddělovač → auto-fit na nejširší buňku (obsah + hlavička).
 *  - Šířka se persistuje (grid.saveState).
 */
import { debounce } from '../util/dom.js';

export function attachResize(handle, col, grid) {
  let startX = 0, startWidth = 0, dragging = false, pending = 0, guide = null, tableLeft = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(col.minWidth, Math.round(startWidth + (e.clientX - startX)));
    pending = w;
    if (guide) {
      // Guide režim: jen posuň vodicí čáru; šířka se aplikuje až v mouseup.
      moveGuide(guide, startX + (w - startWidth) - tableLeft);
    } else {
      col.width = w;
      grid.renderer.applyLayout(); // živě: přepočítá/přestyluje, žádný re-build
    }
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('lattice-resizing');
    if (guide) { col.width = pending; grid.renderer.applyLayout(); removeGuide(guide); guide = null; }
    grid.saveState(); // persist až po dotažení, ne při každém pixelu
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // ať se nespustí drag pořadí ani sort
    startX = e.clientX;
    startWidth = grid.renderer.layout?.widths.get(col.field) ?? col.width;
    pending = startWidth;
    dragging = true;
    document.body.classList.add('lattice-resizing');
    if (grid.instance.resizeGuide) { tableLeft = grid.renderer.nodes.table.getBoundingClientRect().left; guide = createGuide(grid, startX - tableLeft); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const w = measureColumnWidth(col, grid);
    if (w) {
      col.width = w;
      grid.renderer.applyLayout();
      grid.saveState();
    }
  });
}

/**
 * Resize číslovacího (#) sloupce — je syntetický, tak se šířka ukládá do
 * instance (grid.instance.rowNumberWidth). Dvojklik vrátí automatickou šířku.
 */
export function attachRowNumberResize(handle, grid) {
  let startX = 0, startWidth = 0, dragging = false, pending = 0, guide = null, tableLeft = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(36, Math.round(startWidth + (e.clientX - startX)));
    pending = w;
    if (guide) moveGuide(guide, startX + (w - startWidth) - tableLeft);
    else { grid.instance.rowNumberWidth = w; grid.renderer.applyLayout(); }
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('lattice-resizing');
    if (guide) { grid.instance.rowNumberWidth = pending; grid.renderer.applyLayout(); removeGuide(guide); guide = null; }
    grid.saveState();
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = grid.renderer.layout?.widths.get('__rownum__') ?? 50;
    pending = startWidth;
    dragging = true;
    document.body.classList.add('lattice-resizing');
    if (grid.instance.resizeGuide) { tableLeft = grid.renderer.nodes.table.getBoundingClientRect().left; guide = createGuide(grid, startX - tableLeft); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grid.instance.rowNumberWidth = null; // zpět na automatickou šířku
    grid.saveState();
    grid.renderer.applyLayout();
  });
}

/* ---- vodicí čára (resize guide) — svislá linka přes tabulku, aplikuje se v mouseup ---- */

function createGuide(grid, x) {
  const table = grid.renderer.nodes.table;
  const g = document.createElement('div');
  g.className = 'lattice-resize-guide';
  g.style.height = table.offsetHeight + 'px';
  g.style.left = x + 'px';
  table.appendChild(g);
  return g;
}
function moveGuide(guide, x) { guide.style.left = x + 'px'; }
function removeGuide(guide) { guide.remove(); }

/**
 * Cílová šířka sloupce = maximum REÁLNĚ vykreslené šířky obsahu přes hlavičku
 * a všechny viditelné buňky. Měří se skutečný DOM (klon → getBoundingClientRect,
 * border-box), ne odhad z textu — proto se správně započítají ikony (včetně
 * trailing ikony `linkNewTab`), tlačítka/badge z formatterů, jejich padding/
 * border, mezery i horizontální padding buňky. Respektuje minWidth/maxWidth.
 */
export function measureColumnWidth(col, grid) {
  const table = grid.renderer.nodes.table;
  const hcell = table.querySelector(`.lattice-hcell[data-field="${cssEscape(col.field)}"]`);
  const cells = table.querySelectorAll(`.lattice-cell[data-field="${cssEscape(col.field)}"]`);

  // Off-screen měřicí kontejner uvnitř kořene gridu → dědí lattice i aplikační
  // CSS (třídy formatterů, ikony), ale nezasahuje do viditelného layoutu.
  const host = grid.renderer.nodes.root || table;
  const meas = document.createElement('div');
  meas.setAttribute('aria-hidden', 'true');
  meas.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;';
  host.appendChild(meas);

  const cellH = cells[0]?.clientHeight || 0;
  const rot = col.headerRotate != null ? col.headerRotate : grid.instance.headerRotate;
  const rotated = rot === '90' || rot === '270';
  const wrapHeader = grid.instance.wrapHeader === true && !rotated;
  let max = 0;
  try {
    if (hcell) {
      // Hlavička: při zapnutém zalamování názvů počítáme se šířkou, na kterou se
      // název složí do (max.) 2 řádků — jinak s plnou šířkou na 1 řádek. Datové
      // buňky se měří vždy nezalomené (nowrap), takže výsledná šířka je nikdy
      // menší než nejširší nezalomená hodnota na stránce.
      const one = measureRendered(meas, hcell, cellH);
      max = Math.max(max, wrapHeader ? measureWrappedHeaderWidth(meas, hcell, one) : one);
    }
    for (const cell of cells) max = Math.max(max, measureRendered(meas, cell, cellH));
  } finally {
    meas.remove();
  }

  const RESERVE = 4; // ať obsah nedosedá na hranu
  let w = Math.ceil(max) + RESERVE;
  if (col.minWidth) w = Math.max(w, col.minWidth);
  if (col.maxWidth) w = Math.min(w, col.maxWidth);
  return w;
}

/**
 * Reálná vykreslená šířka obsahu buňky/hlavičky — klon do měřicího kontejneru,
 * zúžený na obsah (shrink-to-fit, nowrap). getBoundingClientRect vrací border-box
 * (padding + border + obsah), takže sedí i s paddingem buňky a s ikonami/tlačítky.
 */
function measureRendered(meas, srcNode, cellH) {
  const clone = srcNode.cloneNode(true);
  // Resize handle je absolutně pozicovaný a přesahuje mimo buňku — do měření nepatří.
  clone.querySelectorAll?.('.lattice-resize-handle').forEach((h) => h.remove());
  const s = clone.style;
  s.width = 'auto'; s.maxWidth = 'none'; s.minWidth = '0'; s.flex = '0 0 auto';
  s.display = 'inline-flex'; s.alignItems = 'center';
  s.whiteSpace = 'nowrap'; s.overflow = 'visible'; s.textOverflow = 'clip';
  if (cellH) s.height = cellH + 'px';
  // Odkaz s ikonou nové karty má v layoutu width:100% (kvůli zarovnání ikony
  // vpravo). Pro měření ho zúžíme na obsah → započítá se text + gap + ikona.
  clone.querySelectorAll?.('.lattice-link').forEach((a) => { a.style.width = 'auto'; a.style.display = 'inline-flex'; });
  meas.appendChild(clone);
  const w = clone.getBoundingClientRect().width;
  meas.removeChild(clone);
  return w;
}

/**
 * Cílová šířka zalamované hlavičky = nejmenší šířka, při níž se název složí do
 * (maximálně) 2 řádků. Dolní mez je nejdelší slovo + ikony (nechceme lámat slova),
 * horní mez je šířka na 1 řádek. Binárně hledáme přes reálně změřenou výšku klonu.
 */
function measureWrappedHeaderWidth(meas, hcell, oneLineWidth) {
  const clone = hcell.cloneNode(true);
  clone.querySelectorAll?.('.lattice-resize-handle').forEach((h) => h.remove());
  const title = clone.querySelector('.lattice-hcell-title');
  const s = clone.style;
  s.maxWidth = 'none'; s.minWidth = '0'; s.flex = '0 0 auto';
  s.display = 'flex'; s.alignItems = 'center'; s.overflow = 'visible'; s.height = 'auto';
  if (title) { title.style.whiteSpace = 'normal'; title.style.overflowWrap = 'break-word'; title.style.overflow = 'visible'; }
  meas.appendChild(clone);
  try {
    // Výška na jednom řádku (referenční) + práh pro „≤ 2 řádky".
    clone.style.width = Math.ceil(oneLineWidth) + 'px';
    const oneLineH = clone.getBoundingClientRect().height;
    if (!oneLineH) return Math.ceil(oneLineWidth);
    const limit = oneLineH * 2 - 1; // dvouřádková výška ≤ 2× jednořádková (padding je společný)

    // Dolní mez = min-content (nejdelší slovo + ikony), bez lámání slov.
    let lo = 24;
    if (title) {
      const saved = title.style.overflowWrap;
      title.style.overflowWrap = 'normal';
      clone.style.width = 'min-content';
      lo = Math.ceil(clone.getBoundingClientRect().width);
      title.style.overflowWrap = saved;
    }
    let hi = Math.ceil(oneLineWidth);
    if (lo >= hi) return hi;

    // Nejmenší šířka, při níž výška nepřeroste 2 řádky.
    for (let i = 0; i < 14 && lo < hi; i++) {
      const mid = (lo + hi) >> 1;
      clone.style.width = mid + 'px';
      if (clone.getBoundingClientRect().height <= limit) hi = mid; else lo = mid + 1;
    }
    return hi;
  } finally {
    meas.removeChild(clone);
  }
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
