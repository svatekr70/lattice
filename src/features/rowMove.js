/**
 * rowMove — přetahování řádků myší (HTML5 drag & drop). Tažení se spouští jen
 * z úchytu (grip) v prvním sloupci. Cílová zóna se počítá z pozice kurzoru nad
 * řádkem: horní/spodní část = vložit před/za (mezi sourozence), střed = dovnitř
 * (jako potomek — jen ve stromu). Vlastní přesun dat řeší grid.moveRow().
 */

// MIME typ pro přenos řádku mezi tabulkami / na cizí prvky.
export const ROW_MIME = 'application/x-lattice-row';

/** Zprovozní úchyt pro zahájení tažení řádku. */
export function attachMoveHandle(handle, renderer, getIndex) {
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    const idx = getIndex();
    renderer._dragFrom = idx;
    e.dataTransfer.effectAllowed = 'move';
    // Payload i do dataTransferu → přečte ho jiná tabulka nebo libovolný drop cíl.
    const grid = renderer.grid;
    const row = grid.rows[idx];
    const payload = JSON.stringify({ src: grid.options.id, key: grid.rowKey(row), row });
    try { e.dataTransfer.setData(ROW_MIME, payload); e.dataTransfer.setData('text/plain', payload); } catch { /* IE */ }
  });
  handle.addEventListener('dragend', () => { renderer._dragFrom = null; clearAll(renderer); });
}

/**
 * Zprovozní prvek (obvykle viewport tabulky) jako cíl pro řádky přetažené z JINÉ
 * tabulky. Interní přesuny (renderer._dragFrom) ignoruje.
 */
export function attachExternalDrop(target, renderer) {
  const grid = renderer.grid;
  target.addEventListener('dragover', (e) => {
    if (renderer._dragFrom != null) return; // interní přesun v této tabulce
    if (!Array.from(e.dataTransfer.types || []).includes(ROW_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    target.classList.add('is-drop-target');
  });
  target.addEventListener('dragleave', (e) => { if (!target.contains(e.relatedTarget)) target.classList.remove('is-drop-target'); });
  target.addEventListener('drop', (e) => {
    target.classList.remove('is-drop-target');
    if (renderer._dragFrom != null) return;
    const raw = e.dataTransfer.getData(ROW_MIME) || e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let payload; try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || !payload.row || payload.src === grid.options.id) return; // ne z téže tabulky
    e.preventDefault();
    grid.receiveExternalRow(payload);
  });
}

/** Zprovozní řádek jako cíl přetažení (indikátor + drop). */
export function attachDropZone(rowEl, renderer, getIndex, allowInside) {
  rowEl.addEventListener('dragover', (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    mark(rowEl, computeZone(e, rowEl, allowInside));
  });
  rowEl.addEventListener('dragleave', (e) => { if (!rowEl.contains(e.relatedTarget)) clearMark(rowEl); });
  rowEl.addEventListener('drop', (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    const zone = computeZone(e, rowEl, allowInside);
    const from = renderer._dragFrom;
    const to = getIndex();
    renderer._dragFrom = null;
    clearAll(renderer);
    renderer.grid.moveRow(from, to, zone);
  });
}

/** Hlavička skupiny jako cíl přetažení — puštění změní skupinu řádku. */
export function attachGroupDropZone(headerEl, renderer, node) {
  headerEl.addEventListener('dragover', (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    headerEl.classList.add('drop-group');
  });
  headerEl.addEventListener('dragleave', (e) => { if (!headerEl.contains(e.relatedTarget)) headerEl.classList.remove('drop-group'); });
  headerEl.addEventListener('drop', (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    const from = renderer._dragFrom;
    renderer._dragFrom = null;
    clearAll(renderer);
    headerEl.classList.remove('drop-group');
    renderer.grid.moveRowToGroupHeader(from, node);
  });
}

function computeZone(e, rowEl, allowInside) {
  const r = rowEl.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (allowInside) {
    if (y < r.height / 3) return 'before';
    if (y > (r.height * 2) / 3) return 'after';
    return 'inside';
  }
  return y < r.height / 2 ? 'before' : 'after';
}

function mark(rowEl, zone) { clearMark(rowEl); rowEl.classList.add('drop-' + zone); }
function clearMark(rowEl) { rowEl.classList.remove('drop-before', 'drop-after', 'drop-inside'); }
function clearAll(renderer) {
  for (const el of renderer.nodes.body.querySelectorAll('.drop-before, .drop-after, .drop-inside, .drop-group')) {
    el.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-group');
  }
}
