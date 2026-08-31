/**
 * Skupiny uložených položek (filtrů a pohledů). Každá uložená položka může nést
 * volitelný štítek `group` — třeba „Prodeje" nebo „Faktury". Podle něj se položky
 * v rozbalovacích výběrech sdruží do `<optgroup>` a v panelech pod nadpis skupiny.
 *
 * Položka bez skupiny stojí samostatně **nahoře** (jako „Všechny…" nad skupinami),
 * skupiny následují v pořadí prvního výskytu — knihovna je nepřerovnává, pořadí
 * určuje aplikace (resp. pořadí ukládání).
 */
import { el } from './dom.js';

/** Ořízne štítek skupiny; nevyplněná / neplatná → `''` (= bez skupiny). */
export function normalizeGroup(group) {
  return String(group == null ? '' : group).trim();
}

/** Použité skupiny v pořadí prvního výskytu (bez prázdné) — nabídka do datalistu. */
export function listGroups(items) {
  const out = [];
  for (const it of items || []) {
    const g = normalizeGroup(it && it.group);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Rozdělí položky do bloků `{ group, items }`: nejdřív nezařazené (`group: ''`),
 * pak skupiny v pořadí prvního výskytu. Pořadí položek uvnitř bloku zůstává.
 * Prázdné bloky se nevrací.
 */
export function groupItems(items) {
  const plain = { group: '', items: [] };
  const buckets = [plain];
  const byName = new Map([['', plain]]);
  for (const it of items || []) {
    const g = normalizeGroup(it && it.group);
    let bucket = byName.get(g);
    if (!bucket) { bucket = { group: g, items: [] }; byName.set(g, bucket); buckets.push(bucket); }
    bucket.items.push(it);
  }
  return buckets.filter((b) => b.items.length);
}

/**
 * Naplní `<select>` položkami; co má skupinu, zabalí do `<optgroup label="…">`.
 * `optionOf(item)` vyrábí jednu `<option>`.
 */
export function fillGroupedSelect(sel, items, optionOf) {
  for (const bucket of groupItems(items)) {
    const target = bucket.group ? el('optgroup', { label: bucket.group }) : sel;
    for (const item of bucket.items) target.appendChild(optionOf(item));
    if (bucket.group) sel.appendChild(target);
  }
  return sel;
}

let dlSeq = 0;

/**
 * Políčko pro zadání skupiny + `<datalist>` s už použitými skupinami (napovídání,
 * ale zapsat jde cokoli). `existing` = seznam položek, ze kterých se nabídka sestaví.
 * Vrací `{ el, input }` — `el` patří do řádku, `input` na čtení/zápis hodnoty.
 */
export function groupField(existing, { value = '', placeholder = '', title = '' } = {}) {
  const id = 'lattice-groups-' + (++dlSeq);
  const input = el('input.lattice-group-input', { type: 'text', value, placeholder, title });
  input.setAttribute('list', id); // input.list je jen ke čtení → přes atribut
  const dl = el('datalist', { id });
  for (const g of listGroups(existing)) dl.appendChild(el('option', { value: g }));
  return { el: el('span.lattice-group-field', {}, [input, dl]), input };
}
