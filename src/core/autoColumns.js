/**
 * autoColumns — odvození definice sloupců z dat (když se sloupce nezadají).
 *
 * Když se sloupce nezadají (typicky po importu souboru), sestaví se z klíčů
 * prvních řádků: název (humanizovaný field), odhadnutý datový typ a výchozí
 * filtr. Čistá funkce nad daty (žádný DOM) → snadno testovatelné.
 */

const DEFAULT_FILTER = { text: 'text', number: 'number', date: 'date-range', boolean: 'boolean' };

/**
 * @param {Array<object>} rows  Řádky dat.
 * @param {object} [opts]  { sample = 50 } — kolik řádků vzorkovat pro odhad typu.
 * @returns {Array<object>}  Definice sloupců pro buildColumns.
 */
export function deriveColumns(rows, opts = {}) {
  const sampleSize = opts.sample || 50;
  const sample = (Array.isArray(rows) ? rows : []).slice(0, sampleSize);

  // Sjednocení klíčů v pořadí prvního výskytu (řádky nemusí mít stejná pole).
  const fields = [];
  const seen = new Set();
  for (const r of sample) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); fields.push(k); }
    }
  }
  return columnsFor(fields, sample, opts.titles);
}

/**
 * Sestaví sloupce pro zadaná pole (typ odhadnut ze vzorku). `titles` je volitelná
 * mapa field→název (např. z hlaviček HTML tabulky); jinak se název humanizuje.
 */
export function columnsFor(fields, rows, titles = null) {
  const sample = (Array.isArray(rows) ? rows : []).slice(0, 50);
  return fields.map((field) => {
    const values = sample.map((r) => r && r[field]).filter((v) => v != null && v !== '');
    const type = inferType(values);
    const title = titles && titles[field] != null ? titles[field] : humanize(field);
    return { field, title, type, filter: DEFAULT_FILTER[type] || 'text' };
  });
}

/** Odhad typu sloupce ze vzorku nenulových hodnot. */
export function inferType(values) {
  if (!values.length) return 'text';
  if (values.every(isBool)) return 'boolean';
  if (values.every(isNumeric)) return 'number';
  if (values.every(isDate)) return 'date';
  return 'text';
}

function isBool(v) {
  return typeof v === 'boolean' || /^(true|false|ano|ne|yes|no)$/i.test(String(v));
}
function isNumeric(v) {
  if (typeof v === 'boolean') return false;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  return s !== '' && Number.isFinite(Number(s));
}
function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(v);
}

/** field → čitelný název: snake_case / kebab / camelCase → „Věty s velkým začátkem". */
export function humanize(field) {
  return String(field)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
