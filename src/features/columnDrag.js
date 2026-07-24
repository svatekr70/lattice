/**
 * Drag & drop pořadí sloupců taháním za hlavičku.
 *
 * Používá nativní HTML5 DnD: prostý klik (bez pohybu) pořád spustí řazení,
 * teprve tažení přeuspořádá. Resize handle si mousedown zastavuje sám, takže
 * se tažení za okraj neplete s resize.
 *
 * Reorder se provádí nad grid.columns (skutečné uživatelské pořadí). Vizuální
 * seskupení frozen sloupců je čistě věc renderu — logické pořadí zůstává jedno.
 */
export function attachHeaderDrag(cell, col, grid) {
  cell.draggable = true;

  cell.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.field);
    grid._dragField = col.field;
    cell.classList.add('is-dragging');
  });

  cell.addEventListener('dragend', () => {
    cell.classList.remove('is-dragging');
    grid._dragField = null;
    clearIndicators(grid);
  });

  cell.addEventListener('dragover', (e) => {
    if (!grid._dragField || grid._dragField === col.field) return;
    if (!dropAllowed(grid, col)) return; // mimo skupinu → žádný indikátor ani drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = isBefore(e, cell);
    clearIndicators(grid);
    cell.classList.add(before ? 'drop-before' : 'drop-after');
  });

  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = grid._dragField || e.dataTransfer.getData('text/plain');
    if (!from || from === col.field || !dropAllowed(grid, col)) return;
    grid.moveColumn(from, col.field, isBefore(e, cell) ? 'before' : 'after');
    clearIndicators(grid);
  });
}

/**
 * Smí tažený sloupec přistát na `targetCol`?
 *  - seskupený sloupec jen v rámci stejné skupiny,
 *  - neseskupený sloupec kamkoli (top-level přesun).
 */
function dropAllowed(grid, targetCol) {
  const dragged = grid.columns.find((c) => c.field === grid._dragField);
  if (!dragged) return false;
  const dg = dragged.group || null;
  return dg === null || dg === (targetCol.group || null);
}

/**
 * Tažení celé skupiny za titulek (v řádku skupin). Přesouvá skupinu jako
 * top-level blok před/za jinou skupinu nebo neseskupený sloupec.
 */
export function attachGroupDrag(cell, groupTitle, grid) {
  const fields = () => (cell.dataset.fields || '').split(',').filter(Boolean);
  if (groupTitle) cell.draggable = true; // jen pojmenované skupiny jsou zdrojem tažení

  cell.addEventListener('dragstart', (e) => {
    if (!groupTitle) { e.preventDefault(); return; }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    grid._dragGroup = groupTitle;
    cell.classList.add('is-dragging');
  });
  cell.addEventListener('dragend', () => {
    cell.classList.remove('is-dragging');
    grid._dragGroup = null;
    clearGroupIndicators(grid);
  });
  cell.addEventListener('dragover', (e) => {
    if (!grid._dragGroup || grid._dragGroup === groupTitle) return;
    const f = fields();
    if (!f.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = isBefore(e, cell);
    clearGroupIndicators(grid);
    cell.classList.add(before ? 'drop-before' : 'drop-after');
  });
  cell.addEventListener('drop', (e) => {
    if (!grid._dragGroup || grid._dragGroup === groupTitle) return;
    e.preventDefault();
    const f = fields();
    clearGroupIndicators(grid);
    if (!f.length) return;
    const before = isBefore(e, cell);
    const targetField = before ? f[0] : f[f.length - 1];
    grid.moveGroup(grid._dragGroup, targetField, before ? 'before' : 'after');
  });
}

function isBefore(e, cell) {
  const r = cell.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2;
}

function clearIndicators(grid) {
  const root = grid.renderer?.nodes?.headerRow;
  if (!root) return;
  for (const c of root.querySelectorAll('.drop-before, .drop-after')) {
    c.classList.remove('drop-before', 'drop-after');
  }
}

function clearGroupIndicators(grid) {
  const root = grid.renderer?.nodes?.groupRow;
  if (!root) return;
  for (const c of root.querySelectorAll('.drop-before, .drop-after')) {
    c.classList.remove('drop-before', 'drop-after');
  }
}
