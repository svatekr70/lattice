/**
 * cellValue — JEDINÉ místo, kde se zjišťuje hodnota buňky.
 *
 * Běžný sloupec čte `row[col.field]`. „Computed" sloupec (odvozený) místo toho
 * dodá `col.value(row)` — funkci, která hodnotu spočítá z celého řádku
 * (marže = obrat − náklad, celé jméno, stav odvozený z víc polí…).
 *
 * `field` u computed sloupce zůstává jako identita (klíč pro pořadí/šířku/
 * persistenci), jen se z něj nečte hodnota. Computed sloupce jsou jen ke čtení
 * (render, řazení, filtr, hledání, export) — needitují se.
 *
 * Vše, co potřebuje hodnotu buňky, MUSÍ jít přes tuhle funkci, ať se odvozené
 * sloupce chovají všude stejně.
 */
export function cellValue(row, col) {
  if (row == null || col == null) return undefined;
  if (typeof col.value === 'function') {
    try { return col.value(row); } catch { return undefined; }
  }
  return row[col.field];
}

/** Je sloupec odvozený (computed)? Takový se needituje. */
export function isComputed(col) {
  return !!(col && typeof col.value === 'function');
}
