/**
 * Uživatelské pořadí uložených položek (filtrů a pohledů). Pořadí se drží jako
 * seznam `id` v lokálním blobu — per-uživatel, takže si každý může srovnat i globální
 * položky po svém, bez zásahu do aplikace. Položka, kterou seznam nezná (nově
 * uložená, nově přidaná globální), jde na konec v přirozeném pořadí.
 */
import { normalizeGroup } from './groups.js';

/** Seřadí položky podle seznamu `ids`; neznámé zůstanou za nimi v původním pořadí. */
export function applyOrder(items, ids) {
  if (!Array.isArray(ids) || !ids.length) return items;
  const pos = new Map(ids.map((id, i) => [id, i]));
  const rank = (it) => (pos.has(it.id) ? pos.get(it.id) : Infinity);
  // stabilní řazení → neznámé (Infinity) drží vzájemné pořadí
  return items.map((it, i) => [it, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

/**
 * Nové pořadí id po přesunu `fromId` před / za `toId` (`where` = 'before' | 'after').
 * `items` je aktuálně seřazený seznam. Neznámé id → `null` (nic se nemění).
 */
export function moveId(items, fromId, toId, where = 'before') {
  const ids = items.map((it) => it.id);
  if (fromId === toId || !ids.includes(fromId) || !ids.includes(toId)) return null;
  const out = ids.filter((id) => id !== fromId);
  const at = out.indexOf(toId) + (where === 'after' ? 1 : 0);
  out.splice(at, 0, fromId);
  return out;
}

/**
 * Tažení řádku seznamu za úchyt (⋮⋮). Řádek je `draggable` jen během stisku úchytu,
 * ať tlačítka a inline přejmenování uvnitř řádku fungují normálně. Pustit jde jen
 * na řádek **stejné skupiny** — přetažením se skupina nemění, jen pořadí v ní.
 * `ctx` je sdílený objekt pro celý seznam (drží, co se právě táhne).
 */
export function wireReorder(row, grip, item, ctx, onMove) {
  const group = normalizeGroup(item.group);
  grip.addEventListener('mousedown', () => { row.draggable = true; });
  grip.addEventListener('mouseup', () => { row.draggable = false; });
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.id); } catch { /* Firefox bez dat drag nespustí */ }
    ctx.drag = { id: item.id, group };
    row.classList.add('is-dragging');
  });
  row.addEventListener('dragend', () => {
    row.draggable = false;
    row.classList.remove('is-dragging');
    ctx.drag = null;
  });
  const half = (e) => {
    const r = row.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  row.addEventListener('dragover', (e) => {
    const d = ctx.drag;
    if (!d || d.id === item.id || d.group !== group) return;
    e.preventDefault();
    const where = half(e);
    row.classList.toggle('drop-before', where === 'before');
    row.classList.toggle('drop-after', where === 'after');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    const d = ctx.drag;
    row.classList.remove('drop-before', 'drop-after');
    if (!d || d.id === item.id || d.group !== group) return;
    e.preventDefault();
    onMove(d.id, item.id, half(e));
  });
}
