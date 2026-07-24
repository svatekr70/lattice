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
 * Změří nejširší obsah sloupce (hlavička + všechny viditelné buňky) přes
 * sdílený canvas 2D kontext — rychlé a bez zásahu do DOM.
 */
export function measureColumnWidth(col, grid) {
  const table = grid.renderer.nodes.table;
  const hcell = table.querySelector(`.lattice-hcell[data-field="${cssEscape(col.field)}"]`);
  const cells = table.querySelectorAll(`.lattice-cell[data-field="${cssEscape(col.field)}"]`);

  let max = 0;
  // Hlavička (může být tučná).
  if (hcell) {
    const title = hcell.querySelector('.lattice-hcell-title');
    max = Math.max(max, textWidth(title?.textContent ?? col.title, fontOf(title || hcell)));
  }
  // Buňky.
  for (const cell of cells) {
    max = Math.max(max, textWidth(cell.textContent, fontOf(cell)));
  }
  const PAD = 28; // padding buňky + rezerva na sort/resize
  return Math.max(col.minWidth, Math.ceil(max) + PAD);
}

let _ctx = null;
function textWidth(text, font) {
  if (!text) return 0;
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  _ctx.font = font;
  return _ctx.measureText(text).width;
}

function fontOf(node) {
  if (!node) return '14px sans-serif';
  const s = getComputedStyle(node);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
