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
  if (!isGroup(group) || group.rules.length === 0) return true;
  const results = group.rules.map((r) => (isGroup(r) ? evalGroup(r, row) : evalCondition(r, row)));
  return group.combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

export function evalCondition(c, row) {
  if (!c || !c.op) return true;
  const raw = row[c.field];
  const s = norm(raw);
  const v = c.value;
  switch (c.op) {
    case 'empty': return raw == null || raw === '';
    case 'nempty': return !(raw == null || raw === '');
    case 'eq': return s === norm(v);
    case 'neq': return s !== norm(v);
    case 'contains': return s.includes(norm(v));
    case 'ncontains': return !s.includes(norm(v));
    case 'starts': return s.startsWith(norm(v));
    case 'ends': return s.endsWith(norm(v));
    case 'gt': return cmp(raw, v) > 0;
    case 'gte': return cmp(raw, v) >= 0;
    case 'lt': return cmp(raw, v) < 0;
    case 'lte': return cmp(raw, v) <= 0;
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
  if (Array.isArray(v)) return v;
  return String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}
