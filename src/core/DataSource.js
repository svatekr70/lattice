/**
 * Datové zdroje — oddělená vrstva mezi gridem a daty.
 *
 *  - ClientData: celý dataset v paměti; filtr/řazení/stránkování se počítá
 *    client-side. Vhodné pro malé datasety.
 *  - ServerData: pošle na backend page/size/sort/filter dle kontraktu a
 *    zobrazí jen vrácenou stránku. Vhodné pro velké datasety.
 *
 * Obě mají stejné rozhraní:
 *   query(request) -> Promise<{ rows, total, lastPage, lastRow }>
 * kde request = { page, pageSize, paginate, sort, filters, columns }.
 * Grid tak neřeší, odkud data jsou.
 */
import { getFilter } from '../filters/index.js';
import { evalGroup, isEmptyTree, evalCondition } from '../filters/advancedEval.js';
import { cellValue } from './cellValue.js';

/** Jeden sdílený collator — řádově rychlejší než String.localeCompare (ten si
 *  collator staví při každém volání). Klíč pro rychlé řazení velkých datasetů. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ====================== CLIENT-SIDE ====================== */

export class ClientData {
  constructor(data = []) {
    this.data = Array.isArray(data) ? data.slice() : [];
    this._searchCache = new WeakMap(); // row -> normalizovaný text (pro rychlé hledání za běhu psaní)
    this._searchSig = '';              // podpis množiny prohledávaných sloupců (invalidace cache)
  }

  setData(data) {
    this.data = Array.isArray(data) ? data.slice() : [];
    this._filtered = null;
    this._searchCache = new WeakMap();
  }

  /** Celá filtrovaná+seřazená sada (pro souhrn nad všemi řádky). */
  allRows() {
    return this._filtered || this.data;
  }

  /* ---- granulární mutace (pro grid.addRow/updateRow/deleteRow/updateData) ---- */

  addRow(row, atStart = false) {
    if (atStart) this.data.unshift(row); else this.data.push(row);
    this._filtered = null;
    return row;
  }

  /** Najde řádek dle keyField (porovnání odolné na number vs string) a sloučí patch. */
  updateRow(keyField, key, patch) {
    const k = String(key);
    const r = this.data.find((x) => x && String(x[keyField]) === k);
    if (r) { Object.assign(r, patch); this._filtered = null; this._searchCache.delete(r); }
    return r || null;
  }

  deleteRow(keyField, key) {
    const k = String(key);
    const i = this.data.findIndex((x) => x && String(x[keyField]) === k);
    if (i >= 0) { this.data.splice(i, 1); this._filtered = null; return true; }
    return false;
  }

  /**
   * Přeuspořádá plochá data: přesune řádek dragKey před/za targetKey. Když je
   * daný orderField, přečísluje ho (1..n) a vrátí změněné řádky; jinak vrací
   * jen přesunutý řádek. Vrací null, když přesun není platný.
   */
  moveRow(keyField, dragKey, targetKey, zone, orderField) {
    const from = this.data.findIndex((r) => r && String(r[keyField]) === String(dragKey));
    if (from < 0) return null;
    const [moved] = this.data.splice(from, 1);
    let to = this.data.findIndex((r) => r && String(r[keyField]) === String(targetKey));
    if (to < 0) { this.data.splice(from, 0, moved); return null; } // vrať zpět
    this.data.splice(zone === 'after' ? to + 1 : to, 0, moved);
    this._filtered = null;
    if (orderField) {
      const changed = [];
      this.data.forEach((r, i) => { if (r[orderField] !== i + 1) { r[orderField] = i + 1; changed.push(r); } });
      return changed;
    }
    return [moved];
  }

  /** Hromadný upsert dle keyField: existující sloučí, nové přidá. Vrací dotčené řádky. */
  upsertMany(keyField, rows) {
    const index = new Map();
    this.data.forEach((r, i) => { if (r) index.set(String(r[keyField]), i); });
    const affected = [];
    for (const row of rows) {
      const k = row != null ? String(row[keyField]) : null;
      if (k != null && index.has(k)) { const t = this.data[index.get(k)]; Object.assign(t, row); affected.push(t); }
      else if (row != null) { index.set(k, this.data.push(row) - 1); affected.push(row); }
    }
    this._filtered = null;
    for (const r of affected) this._searchCache.delete(r);
    return affected;
  }

  async query({ page, pageSize, paginate, sort, filters, advanced, universal, search, columns }) {
    const colByField = indexColumns(columns);

    let rows = this.data;
    rows = applyFilters(rows, filters, colByField);
    if (universal && universal.field) rows = rows.filter((r) => evalCondition(universal, r));
    if (advanced && !isEmptyTree(advanced)) rows = rows.filter((r) => evalGroup(advanced, r));
    if (search && String(search).trim()) rows = this._quickSearch(rows, search, columns);
    rows = applySort(rows, sort, colByField);
    this._filtered = rows; // celá filtrovaná sada (pro souhrnný řádek nad všemi řádky)

    const total = rows.length;
    const lastPage = paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    if (paginate) {
      const start = (page - 1) * pageSize;
      rows = rows.slice(start, start + pageSize);
    }
    return { rows, total, lastPage, lastRow: total };
  }

  /**
   * Rychlé hledání s cache: pro každý řádek se normalizovaný text (přes všechny
   * prohledávané sloupce) spočítá jen jednou a uloží. Při psaní do vyhledávání
   * se pak jen volá `.includes` — čtvrtý úhoz do klávesnice už netahá NFD/regex
   * přes celý dataset. Cache se invaliduje při změně dat i množiny sloupců.
   */
  buildSearchIndex(columns) {
    const cols = (columns || []).filter(searchableCol);
    this._searchSig = cols.map((c) => c.field).join(',');
    this._searchCache = new WeakMap();
    for (const row of this.data) {
      this._searchCache.set(row, cols.map((c) => norm(cellValue(row, c))).join(''));
    }
  }

  _quickSearch(rows, search, columns) {
    const needle = norm(search).trim();
    if (!needle) return rows;
    const cols = (columns || []).filter(searchableCol);
    const sig = cols.map((c) => c.field).join(',');
    if (sig !== this._searchSig) { this._searchCache = new WeakMap(); this._searchSig = sig; }
    const cache = this._searchCache;
    return rows.filter((row) => {
      let text = cache.get(row);
      if (text === undefined) {
        text = cols.map((c) => norm(cellValue(row, c))).join('');
        cache.set(row, text);
      }
      return text.includes(needle);
    });
  }
}

function searchableCol(c) {
  return c && c.field && c.visible !== false
    && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._rowsum;
}

function indexColumns(columns) {
  const m = new Map();
  for (const c of columns || []) m.set(c.field, c);
  return m;
}

/** Odstraní diakritiku a zmenší — pro hledání „nezáleží na háčcích/velikosti". */
function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function applyFilters(rows, filters, colByField) {
  const active = [];
  for (const [field, value] of Object.entries(filters || {})) {
    const col = colByField.get(field);
    if (!col || !col.filter) continue;
    const def = getFilter(col.filter);
    if (!def || def.isEmpty(value)) continue;
    active.push({ field, value, def, col });
  }
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(({ value, def, col }) => def.match(value, cellValue(row, col), row, col)),
  );
}

/** Kategorie řazení podle typu sloupce (jednou spočítaná, ne per porovnání). */
function sortKind(type) {
  if (type === 'number' || type === 'money' || type === 'progress' || type === 'rating') return 'num';
  if (type === 'date' || type === 'datetime' || type === 'time') return 'date';
  if (type === 'boolean') return 'bool';
  return 'text';
}

/**
 * Řazení metodou „decorate–sort–undecorate": klíče (číslo/čas/text) se z každého
 * řádku vytáhnou JEDNOU dopředu (ne O(n·log n)×), řetězce se porovnávají sdíleným
 * collatorem. Na velkých datasetech násobně rychlejší než localeCompare v cyklu.
 * Řazení je stabilní (fallback na původní index).
 */
function applySort(rows, sort, colByField) {
  if (!sort || !sort.length) return rows;
  const specs = sort.map(({ field, dir }) => {
    const col = colByField.get(field) || { field };
    return { col, sign: dir === 'desc' ? -1 : 1, kind: sortKind(col.type) };
  });
  const decorated = rows.map((row, i) => {
    const keys = specs.map((s) => {
      const v = cellValue(row, s.col);
      if (v == null || v === '') return null;
      if (s.kind === 'num') return num(v);
      if (s.kind === 'date') return time(v);
      if (s.kind === 'bool') return bool(v) ? 1 : 0;
      return String(v);
    });
    return { row, keys, i };
  });
  decorated.sort((A, B) => {
    for (let s = 0; s < specs.length; s++) {
      const a = A.keys[s], b = B.keys[s];
      let cmp;
      if (a == null && b == null) cmp = 0;
      else if (a == null) cmp = -1;
      else if (b == null) cmp = 1;
      else if (typeof a === 'number') cmp = a - b;
      else cmp = COLLATOR.compare(a, b);
      if (cmp !== 0) return specs[s].sign * cmp;
    }
    return A.i - B.i; // stabilita
  });
  return decorated.map((d) => d.row);
}

const num = (v) => Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
const time = (v) => { const d = new Date(v); const t = d.getTime(); return Number.isNaN(t) ? 0 : t; };
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

/* ====================== SERVER-SIDE ====================== */

export class ServerData {
  /**
   * @param {object} ajax
   *   url: string (povinné)
   *   method: 'GET'|'POST'  (default GET)
   *   headers: object
   *   params: object                 statické extra parametry
   *   paramNames: { page,size,sort,filter }  přejmenování klíčů (default dle kontraktu)
   *   requestBuilder(state) -> object        plný override skladby parametrů
   *   responseParser(json) -> { rows,total,lastPage,lastRow }  plný override parsování
   */
  constructor(ajax = {}) {
    if (!ajax.url) throw new Error('Lattice ServerData: chybí `ajax.url`.');
    this.ajax = ajax;
    this.names = Object.assign({ page: 'page', size: 'size', sort: 'sort', filter: 'filter' }, ajax.paramNames);
  }

  async query({ page, pageSize, paginate, sort, filters, universal, search, columns }) {
    const state = { page, pageSize, paginate, sort, filters, universal, search, columns };
    const params = this.ajax.requestBuilder
      ? this.ajax.requestBuilder(state)
      : this.buildParams(state);

    const method = (this.ajax.method || 'GET').toUpperCase();
    let url = this.ajax.url;
    const init = { method, headers: Object.assign({}, this.ajax.headers) };

    if (method === 'GET') {
      const qs = encodeParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(params);
    }

    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Lattice: server vrátil ${res.status}`);
    const json = await res.json();

    if (this.ajax.responseParser) return this.ajax.responseParser(json);
    return this.parseResponse(json, pageSize);
  }

  buildParams({ page, pageSize, paginate, sort, filters, universal, search, columns }) {
    const n = this.names;
    const params = Object.assign({}, this.ajax.params);
    if (search && String(search).trim()) params[n.search || 'search'] = String(search).trim();

    if (paginate) {
      params[n.page] = page;
      params[n.size] = pageSize;
    }
    if (sort && sort.length) {
      params[n.sort] = sort.map((s) => ({ field: s.field, dir: s.dir }));
    }
    const flat = flattenFilters(filters, columns);
    // univerzální filtr → přidá se do filtrů (op se mapuje na serverový typ)
    if (universal && universal.field && String(universal.value ?? '') !== '') {
      flat.push({ field: universal.field, type: UNIVERSAL_SERVER_TYPE[universal.op] || universal.op, value: universal.value });
    }
    if (flat.length) params[n.filter] = flat;
    return params;
  }

  parseResponse(json, pageSize) {
    const data = Array.isArray(json) ? json : json.data || [];
    const total = json.total != null ? json.total
      : json.last_row != null ? json.last_row
      : data.length;
    const lastPage = json.last_page != null ? json.last_page
      : Math.max(1, Math.ceil(total / pageSize));
    return { rows: data, total, lastPage, lastRow: json.last_row != null ? json.last_row : total };
  }
}

/** Mapování op univerzálního filtru na serverový typ. */
const UNIVERSAL_SERVER_TYPE = { eq: '=', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=', contains: 'like', ncontains: '!like' };

/** Filtry → plochý seznam {field,type,value} podle toServer() daného filtru. */
function flattenFilters(filters, columns) {
  const colByField = indexColumns(columns);
  const out = [];
  for (const [field, value] of Object.entries(filters || {})) {
    const col = colByField.get(field);
    if (!col || !col.filter) continue;
    const def = getFilter(col.filter);
    if (!def || def.isEmpty(value)) continue;
    out.push(...def.toServer(field, value, col));
  }
  return out;
}

/**
 * Serializace do bracket-formátu kontraktu:
 *   page, size, sort[0][field], sort[0][dir], filter[0][field], …
 */
export function encodeParams(obj) {
  const sp = new URLSearchParams();
  const add = (key, val) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => add(`${key}[${i}]`, v));
    } else if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) add(`${key}[${k}]`, v);
    } else {
      sp.append(key, val);
    }
  };
  for (const [k, v] of Object.entries(obj)) add(k, v);
  return sp;
}
