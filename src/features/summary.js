/**
 * Souhrnné funkce sloupců (pro souhrnný řádek).
 *  - MIN, MAX, SUMA (sum), PRŮMĚR (avg) — jen číselné sloupce.
 *  - POČET (count) — jakýkoli sloupec; počet buněk s hodnotou ≠ NULL/prázdno.
 * Sloupec může mít vybraných funkcí víc (naskládají se pod sebe).
 */

import { cellValue } from '../core/cellValue.js';

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
