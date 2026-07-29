/**
 * Datumové seskupování — odvození „kbelíku" z data podle zvolené úrovně
 * (rok, kvartál, měsíc, týden, den v týdnu, den v měsíci, hodina, minuta).
 *
 * Knihovna počítá: z hodnoty data spočítá klíč (pro seřazení skupin) a
 * čitelný popisek (přes i18n). Aplikace nic neřeší.
 */

/** Podporované úrovně (pořadí = od nejhrubší po nejjemnější — pro UI). */
export const DATE_PARTS = ['year', 'quarter', 'month', 'week', 'weekday', 'day', 'hour', 'minute'];

/** Bezpečný převod na Date (podpora Date, timestampu i ISO/řetězce). */
function toDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** ISO číslo týdne (pondělí = první den, týden s prvním čtvrtkem = 1). */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;           // pondělí = 0
  t.setUTCDate(t.getUTCDate() - day + 3);        // posun na čtvrtek daného týdne
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  return 1 + Math.round(((t - firstThu) / 86400000 - 3 + firstDay) / 7);
}

/**
 * Kbelík pro hodnotu `value` na úrovni `part`.
 * Vrací { sort, label } (sort = číslo pro chronologické seřazení skupin),
 * nebo null když hodnota není platné datum nebo part není podporovaný.
 */
export function dateBucket(value, part, i18n) {
  const d = toDate(value);
  if (!d) return null;
  const months = (i18n && i18n.list('dateRange.months')) || [];
  const weekdays = (i18n && i18n.list('dateRange.weekdaysLong')) || [];
  const wk = (i18n && i18n.t('group.weekLabel')) || 'Týden';

  switch (part) {
    case 'year': {
      const y = d.getFullYear();
      return { sort: y, label: String(y) };
    }
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return { sort: q, label: 'Q' + q };
    }
    case 'month': {
      const m = d.getMonth();
      return { sort: m, label: months[m] || String(m + 1) };
    }
    case 'week': {
      const w = isoWeek(d);
      return { sort: w, label: wk + ' ' + w };
    }
    case 'weekday': {
      const wd = (d.getDay() + 6) % 7;             // pondělí = 0
      return { sort: wd, label: weekdays[wd] || String(wd) };
    }
    case 'day': {
      const dm = d.getDate();
      return { sort: dm, label: dm + '.' };
    }
    case 'hour': {
      const h = d.getHours();
      return { sort: h, label: pad2(h) + ':00' };
    }
    case 'minute': {
      const mi = d.getMinutes();
      return { sort: mi, label: pad2(d.getHours()) + ':' + pad2(mi) };
    }
    default:
      return null;
  }
}
