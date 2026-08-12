/**
 * Vyhodnocení rozšířeného (query-builder) filtru nad řádkem.
 *
 * Strom pravidel:
 *   group     = { combinator: 'AND'|'OR', rules: [group|condition, ...] }
 *   condition = { field, op, value }
 *
 * Podporované operátory (op):
 *   eq, neq, contains, ncontains, starts, ends,
 *   gt, gte, lt, lte, in, nin, empty, nempty
 *
 * Porovnání je „chytré": u </<=/>/>= zkusí číslo, pak datum (YYYY-MM-DD),
 * jinak řetězec. Textové operátory jsou case-insensitive.
 *
 * Relativní datové tokeny v hodnotě:
 *   today                dnešek (YYYY-MM-DD, lokální půlnoc)
 *   today+14 / today-7   ± N dní (jednotka d je výchozí)
 *   today+2w / -1m / +1y  jednotky: d (den), w (týden), m (měsíc), y (rok)
 *   now                  aktuální okamžik včetně času (YYYY-MM-DDThh:mm:ss)
 *   now+3d ...           posun po dnech/týdnech/měsících/rocích (d/w/m/y)
 * Token je běžný řetězec (JSON-safe), rozvine se až při vyhodnocení — proto je
 * bezpečný i pro globálně sdílené filtry (žádný spustitelný kód).
 */

export const ADV_OPS = ['eq', 'neq', 'contains', 'ncontains', 'starts', 'ends', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'empty', 'nempty'];

export function isGroup(r) {
  return r != null && Array.isArray(r.rules);
}

/** Je strom prázdný (nemá žádné pravidlo)? */
export function isEmptyTree(group) {
  if (!isGroup(group)) return true;
  return group.rules.every((r) => (isGroup(r) ? isEmptyTree(r) : !r || !r.op));
}

export function evalGroup(group, row) {
  if (!isGroup(group)) return true;
  // Prázdné podskupiny a nedokončené podmínky (bez `op`) se ignorují — jinak by
  // prázdná podskupina vrátila true a pod `OR` rodičem by propustila VŠECHNY řádky.
  const active = group.rules.filter((r) => (isGroup(r) ? !isEmptyTree(r) : r && r.op));
  if (active.length === 0) return true; // nic aktivního → skupina nefiltruje
  const results = active.map((r) => (isGroup(r) ? evalGroup(r, row) : evalCondition(r, row)));
  return group.combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

export function evalCondition(c, row) {
  if (!c || !c.op) return true;
  const raw = row[c.field];
  const s = norm(raw);
  const v = resolveToken(c.value);
  switch (c.op) {
    case 'empty': return raw == null || raw === '';
    case 'nempty': return !(raw == null || raw === '');
    case 'eq': return s === norm(v);
    case 'neq': return s !== norm(v);
    case 'contains': return s.includes(norm(v));
    case 'ncontains': return !s.includes(norm(v));
    case 'starts': return s.startsWith(norm(v));
    case 'ends': return s.endsWith(norm(v));
    // Prázdné/chybějící pole není porovnatelné → nesmí splnit ordering (jinak by
    // se prázdná hodnota chovala jako „menší než cokoli" a splnila lt/lte).
    case 'gt': return raw != null && raw !== '' && cmp(raw, v) > 0;
    case 'gte': return raw != null && raw !== '' && cmp(raw, v) >= 0;
    case 'lt': return raw != null && raw !== '' && cmp(raw, v) < 0;
    case 'lte': return raw != null && raw !== '' && cmp(raw, v) <= 0;
    case 'in': return splitList(v).map(norm).includes(s);
    case 'nin': return !splitList(v).map(norm).includes(s);
    default: return true;
  }
}

/* ---- porovnání ---- */

function norm(v) { return String(v ?? '').toLowerCase().trim(); }

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function day(v) {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  if (typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Vrátí <0, 0, >0. Zkusí číslo → datum → řetězec. */
function cmp(a, b) {
  const na = num(a), nb = num(b);
  if (na != null && nb != null) return na - nb;
  const da = day(a), db = day(b);
  if (da != null && db != null) return da - db;
  return norm(a).localeCompare(norm(b), undefined, { numeric: true });
}

function splitList(v) {
  if (Array.isArray(v)) return v.map(resolveToken);
  return String(v ?? '').split(',').map((x) => resolveToken(x.trim())).filter(Boolean);
}

/* ---- relativní datové tokeny ---- */

// today/now = dnešek; sow/eow = začátek(Po)/konec(Ne) týdne; som/eom = měsíc; soq/eoq =
// kvartál; soy/eoy = rok. Vše s volitelným offsetem ±N[d|w|m|y].
const TOKEN_RE = /^\s*(today|now|sow|eow|som|eom|soq|eoq|soy|eoy)\s*(?:([+-])\s*(\d+)\s*([dwmy])?)?\s*$/i;

/**
 * Přičte `n` měsíců s ošetřením přetečení: 31.1. + 1m → 28./29.2. (ne 3.3.).
 * Den se ořízne na poslední den cílového měsíce. Roky se řeší jako n*12 měsíců.
 */
function addMonths(d, n) {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
}

/** Posune datum na pondělí jeho týdne (začátek týdne = pondělí). */
function startOfWeekMonday(d) {
  const off = (d.getDay() + 6) % 7; // Po=0 … Ne=6
  d.setDate(d.getDate() - off);
}

/**
 * Rozvine relativní token na konkrétní datum. Podporuje `today`/`now`, hranice období
 * `sow|eow|som|eom|soy|eoy` a offset `±N[d|w|m|y]`. Offset se aplikuje NEJDŘÍV (posune
 * referenční den), pak se teprve zarovná na hranici — tak `eom-1m` = poslední den minulého
 * měsíce sedí i u kratších měsíců (např. z února na leden dá 31.1., ne 28.1.).
 * Cokoli jiného (běžnou hodnotu) vrátí beze změny.
 */
export function resolveToken(v) {
  if (typeof v !== 'string') return v;
  const m = TOKEN_RE.exec(v);
  if (!m) return v;
  const base = m[1].toLowerCase();
  const d = new Date();
  if (base !== 'now') d.setHours(0, 0, 0, 0);
  // 1) offset posune referenční den
  if (m[2]) {
    const n = (m[2] === '-' ? -1 : 1) * parseInt(m[3], 10);
    switch ((m[4] || 'd').toLowerCase()) {
      case 'w': d.setDate(d.getDate() + n * 7); break;
      case 'm': addMonths(d, n); break;
      case 'y': addMonths(d, n * 12); break;
      default: d.setDate(d.getDate() + n);
    }
  }
  // 2) zarovnání na hranici období (today/now bez zarovnání)
  switch (base) {
    case 'sow': startOfWeekMonday(d); break;
    case 'eow': startOfWeekMonday(d); d.setDate(d.getDate() + 6); break;
    case 'som': d.setDate(1); break;
    case 'eom': d.setMonth(d.getMonth() + 1, 0); break;
    case 'soq': d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1); break;
    case 'eoq': d.setMonth(Math.floor(d.getMonth() / 3) * 3 + 3, 0); break;
    case 'soy': d.setMonth(0, 1); break;
    case 'eoy': d.setMonth(11, 31); break;
    default: break;
  }
  return base === 'now' ? fmtDateTime(d) : fmtDate(d);
}

/**
 * Vrátí hlubokou kopii stromu s hodnotami podmínek rozvinutými přes `resolveToken`
 * (relativní datové tokeny → konkrétní datum). Určeno pro odeslání server-side, aby
 * backend dostal konkrétní hodnoty a nemusel tokeny umět parsovat. Client-side se
 * tokeny rozvíjejí za běhu v `evalCondition`, tudíž pro ně tohle není potřeba.
 */
export function resolveTreeTokens(group) {
  if (!isGroup(group)) return group;
  return { ...group, rules: group.rules.map((r) => (isGroup(r) ? resolveTreeTokens(r) : resolveConditionTokens(r))) };
}

function resolveConditionTokens(c) {
  if (!c || !c.op) return { ...c };
  const v = c.value;
  // in/nin: hodnota je seznam (pole nebo CSV) — rozvinout každý prvek zvlášť (viz splitList)
  if (c.op === 'in' || c.op === 'nin') {
    if (Array.isArray(v)) return { ...c, value: v.map(resolveToken) };
    return { ...c, value: String(v ?? '').split(',').map((x) => resolveToken(x.trim())).join(',') };
  }
  return { ...c, value: Array.isArray(v) ? v.map(resolveToken) : resolveToken(v) };
}

function pad2(x) { return String(x).padStart(2, '0'); }
function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
