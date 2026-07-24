/**
 * Formátování hodnot (Excel-like) pro číselné a datumové typy.
 *
 * Formát je objekt podle „druhu" (kind):
 *   number   → { decimals, thousands, negative, suffix, prefix, locale }
 *   money    → number + { currency }
 *   date/datetime/time → { pattern }
 *
 * Efektivní formát sloupce = výchozí < globální (instance) < def.formatterParams
 * < uživatelská výjimka sloupce (col.format). Řeší se v Lattice.effectiveFormat.
 */

export const DEFAULT_FORMATS = {
  number:   { decimals: null, thousands: true, negative: 'minus' },
  money:    { decimals: null, thousands: true, currency: 'CZK', negative: 'minus' },
  date:     { pattern: 'dd.mm.yyyy' },
  datetime: { pattern: 'dd.mm.yyyy HH:nn' },
  time:     { pattern: 'HH:nn' },
};

/** Vrátí „druh" formátu podle typu sloupce (nebo null, když se neformátuje). */
export function formatKind(type) {
  if (type === 'number') return 'number';
  if (type === 'money') return 'money';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  if (type === 'time') return 'time';
  return null;
}

/** Klíče formátu relevantní pro daný druh (pro slučování jen správných polí). */
export function formatKeys(kind) {
  return (kind === 'date' || kind === 'datetime' || kind === 'time')
    ? ['pattern']
    : ['decimals', 'thousands', 'currency', 'negative', 'suffix', 'prefix', 'locale'];
}

export const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'CHF', 'JPY'];
export const NEGATIVE_STYLES = ['minus', 'red', 'paren', 'redparen'];
export const DATE_PRESETS = ['dd.mm.yyyy', 'd.m.yyyy', 'yyyy-mm-dd', 'dd/mm/yyyy', 'd. mmmm yyyy', 'd. mmm yyyy', 'ddd d.m.yyyy'];
export const DATETIME_PRESETS = ['dd.mm.yyyy HH:nn', 'd.m.yyyy H:nn', 'yyyy-mm-dd HH:nn', 'dd.mm.yyyy HH:nn:ss', 'd. mmmm yyyy H:nn'];
export const TIME_PRESETS = ['HH:nn', 'H:nn', 'HH:nn:ss', 'h:nn a'];

const pad2 = (x) => String(x).padStart(2, '0');

/** Aplikuje styl záporného čísla na text absolutní hodnoty → { text, red }. */
function applyNegative(absText, neg, style) {
  if (!neg) return { text: absText, red: false };
  switch (style) {
    case 'paren':    return { text: '(' + absText + ')', red: false };
    case 'red':      return { text: '-' + absText, red: true };
    case 'redparen': return { text: '(' + absText + ')', red: true };
    default:         return { text: '-' + absText, red: false }; // 'minus'
  }
}

/** Číslo → { text, red }. fmt: { decimals, thousands, negative, suffix, prefix, locale }. */
export function formatNumber(n, fmt = {}) {
  if (n == null || !Number.isFinite(n)) return { text: '', red: false };
  const abs = Math.abs(n);
  const opts = { useGrouping: fmt.thousands !== false };
  if (fmt.decimals == null) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 3; }
  else { opts.minimumFractionDigits = fmt.decimals; opts.maximumFractionDigits = fmt.decimals; }
  let s = abs.toLocaleString(fmt.locale || undefined, opts);
  if (fmt.prefix) s = fmt.prefix + s;
  if (fmt.suffix) s = s + fmt.suffix;
  return applyNegative(s, n < 0, fmt.negative);
}

/** Měna → { text, red }. fmt: number + { currency }. */
export function formatMoney(n, fmt = {}) {
  if (n == null || !Number.isFinite(n)) return { text: '', red: false };
  const abs = Math.abs(n);
  const opts = { style: 'currency', currency: fmt.currency || 'CZK', useGrouping: fmt.thousands !== false };
  if (fmt.decimals == null) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 2; }
  else { opts.minimumFractionDigits = fmt.decimals; opts.maximumFractionDigits = fmt.decimals; }
  let s;
  try { s = abs.toLocaleString(fmt.locale || 'cs-CZ', opts); }
  catch { s = abs.toLocaleString(fmt.locale || 'cs-CZ', { ...opts, style: 'decimal' }) + ' ' + (fmt.currency || ''); }
  return applyNegative(s, n < 0, fmt.negative);
}

const DATE_TOKEN_RE = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|nn|n|ss|s|A|a/g;

/**
 * Datum dle vzoru. Tokeny: yyyy yy · mmmm mmm mm m (měsíc) · dddd ddd (den v týdnu)
 * · dd d (den) · HH H (24h) hh h (12h) · nn n (minuty) · ss s (sekundy) · A a (AM/PM).
 * Názvy měsíců/dnů z i18n (i18n.list). Ostatní znaky (. / : mezera) projdou.
 */
export function formatDate(d, pattern, i18n) {
  if (!d) return '';
  const months = i18n ? i18n.list('dateRange.months') : [];
  const monthsShort = i18n ? i18n.list('dateRange.monthsShort') : [];
  const weekdays = i18n ? i18n.list('dateRange.weekdays') : [];
  const weekdaysLong = i18n ? i18n.list('dateRange.weekdaysLong') : [];
  const mo = d.getMonth(), wd = (d.getDay() + 6) % 7; // pondělí = 0
  const h24 = d.getHours(), h12 = h24 % 12 || 12;
  const map = {
    yyyy: d.getFullYear(), yy: String(d.getFullYear()).slice(-2),
    mmmm: months[mo], mmm: monthsShort[mo] || (months[mo] || '').slice(0, 3),
    mm: pad2(mo + 1), m: mo + 1,
    dddd: weekdaysLong[wd], ddd: weekdays[wd],
    dd: pad2(d.getDate()), d: d.getDate(),
    HH: pad2(h24), H: h24, hh: pad2(h12), h: h12,
    nn: pad2(d.getMinutes()), n: d.getMinutes(),
    ss: pad2(d.getSeconds()), s: d.getSeconds(),
    A: h24 < 12 ? 'AM' : 'PM', a: h24 < 12 ? 'am' : 'pm',
  };
  return String(pattern || '').replace(DATE_TOKEN_RE, (tok) => {
    const v = map[tok];
    return v == null ? tok : String(v);
  });
}
