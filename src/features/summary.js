/**
 * Souhrnné funkce sloupců (pro souhrnný řádek).
 *  - MIN, MAX, SUMA (sum), PRŮMĚR (avg) — jen číselné sloupce.
 *  - POČET (count) — jakýkoli sloupec; počet buněk s hodnotou ≠ NULL/prázdno.
 * Sloupec může mít vybraných funkcí víc (naskládají se pod sebe).
 */

import { cellValue } from '../core/cellValue.js';
import { getFormatter } from '../types/columnTypes.js';

export const NUMERIC_TYPES = ['number', 'money', 'progress', 'rating'];
export function isNumericType(type) {
  return NUMERIC_TYPES.includes(type);
}

/** Pevné pořadí funkcí (řádky souhrnu i volby v dialogu jsou v tomto pořadí). */
export const SUMMARY_ORDER = ['sum', 'avg', 'min', 'max', 'count'];

/** Dostupné funkce pro sloupec (count vždy; početní jen u čísel), v pevném pořadí. */
export function availableSummaries(col) {
  return isNumericType(col.type) ? SUMMARY_ORDER.slice() : ['count'];
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function nonNull(v) {
  return v != null && v !== '';
}

/** Spočítá jednu souhrnnou funkci nad řádky. Vrací číslo nebo null. */
export function computeSummary(fn, col, rows) {
  if (fn === 'count') return rows.reduce((a, r) => a + (nonNull(cellValue(r, col)) ? 1 : 0), 0);
  const nums = [];
  for (const r of rows) { const n = toNum(cellValue(r, col)); if (n != null) nums.push(n); }
  if (!nums.length) return null;
  switch (fn) {
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    default: return null;
  }
}

/**
 * Spočítá souhrnnou funkci PŘES jeden řádek nad zadanými sloupci (souhrn řádků
 * do pravého sloupce). `cols` = sloupce zapojené do daného souhrnu. Vrací číslo
 * nebo null.
 */
export function computeRowSummary(fn, cols, row) {
  if (fn === 'count') return cols.reduce((a, c) => a + (nonNull(cellValue(row, c)) ? 1 : 0), 0);
  const nums = [];
  for (const c of cols) { const n = toNum(cellValue(row, c)); if (n != null) nums.push(n); }
  if (!nums.length) return null;
  switch (fn) {
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    default: return null;
  }
}

/** Krátký symbol funkce (u hodnot, když není zobrazen číslovací sloupec). */
export const SUMMARY_SYMBOL = { sum: 'Σ', avg: '⌀', min: 'min', max: 'max', count: '#' };

/* ---- formátování hodnoty souhrnu -------------------------------------- */

/**
 * „Řádek“, který formátovač dostane při formátování souhrnu. Souhrn žádný řádek
 * nemá — dřív sem chodil prázdný objekt, takže formátovač, který si z řádku něco
 * bere (a to je u obarvování běžné), tiše spadl do jiné větve a nešlo poznat proč.
 * `null` poslat nejde: `row.cokoli` by na něm rovnou vyhodilo výjimku. Zmrazený
 * objekt s příznakem se čte stejně bezpečně jako prázdný a souhrn jde poznat
 * schválně — `isSummaryRow(row)`, nebo `row.__latticeSummary`. `@v1.22.0`
 */
export const SUMMARY_ROW = Object.freeze({ __latticeSummary: true });

/** Je tohle „řádek“ souhrnu? Pro formátovače, které se v souhrnu chovají jinak. */
export function isSummaryRow(row) {
  return !!(row && row.__latticeSummary === true);
}

/**
 * Text z toho, co vrátil formátovač. Smlouva formátovače je `string | Node`
 * (viz types/columnTypes.js) — a Node vrací i vestavěný `money`/`number`, když
 * má formát `negative: 'red'` a hodnota je záporná. Souhrn se vkládá jako text,
 * takže z uzlu vezmeme jeho `textContent`; bez toho by v buňce svítilo
 * „[object HTMLSpanElement]“. `instanceof Node` použít nejde — mimo prohlížeč
 * ten globál není, kdežto `nodeType` je spolehlivý a levný.
 */
export function formatterText(out) {
  if (out == null) return '';
  if (typeof out === 'object' && typeof out.nodeType === 'number') return String(out.textContent ?? '');
  return String(out);
}

/**
 * Má souhrn sloupce projít formátovačem buňky?
 *
 *  - `col.summaryFormatted` (true/false) rozhoduje, když je zadané.
 *  - jinak ano, má-li sloupec VLASTNÍ `formatter`: dřív se pouštěl jen u
 *    `type: 'money'`, takže časový sloupec (sekundy zobrazené jako `h:mm:ss`)
 *    měl v patičce `2 419 200` místo `672:00:00` — a jediné obejití bylo lhát
 *    sloupci `type: 'money'`. Vlastní formátovač na sloupci je dost jasný
 *    signál, že syrové číslo v souhrnu není to, co chce autor vidět.
 *  - jinak jen u `money`, ať peníze v souhrnu dál nesou měnu i počet desetin.
 *
 * `@v1.23.0`
 */
function useFormatter(col) {
  if (col.summaryFormatted === true) return true;
  if (col.summaryFormatted === false) return false;
  return typeof col.formatter === 'function' || col.type === 'money';
}

/**
 * Agregovaná hodnota → text do buňky souhrnu. Sloupec s vlastním formátovačem
 * (a peníze vždy) projde TÝMŽ formátovačem jako buňky; zbytek se naformátuje jen
 * podle locale — průměr a vzorec s desetinami (jsou to poměry), ostatní celé.
 * `col.summaryFormatted` to vynutí (`true`) i u vestavěných typů, nebo potlačí
 * (`false`).
 *
 * POČET (`count`) formátovačem nikdy neprojde: není to hodnota sloupce, ale počet
 * buněk — `h:mm:ss` ani měna k němu nepatří.
 *
 * Formátovač je cizí kód: může spadnout (sáhne do řádku, který souhrn nemá) nebo
 * vrátit uzel bez textu (třeba jen ikonu). V obou případech spadneme na obyčejné
 * číslo — správná částka je v souhrnu podstatnější než věrnost formátu.
 */
export function formatSummaryValue(fn, val, col) {
  if (val == null || (typeof val === 'number' && !Number.isFinite(val))) return '';
  if (fn === 'count') return String(val);
  if (useFormatter(col)) {
    let text = '';
    try { text = formatterText(getFormatter(col)(val, col, SUMMARY_ROW)); } catch { text = ''; }
    if (text.trim() !== '') return text;
  }
  const maxdec = (fn === 'avg' || fn === 'formula') ? 2 : 0;
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: maxdec });
}
