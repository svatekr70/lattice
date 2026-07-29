// src/core/Store.js
var PREFIX = "lattice:";
function emptyState() {
  return {
    columns: [],
    // [{ field, visible, width, frozen }] v uživatelském pořadí
    sort: [],
    // [{ field, dir }]
    filters: {},
    // { field: value }  (tvar value závisí na typu filtru)
    universal: null,
    // univerzální filtr { field, op, value }
    instance: {},
    // { pagination, layout, density, fontSize }
    presets: [],
    // [{ id, name, state:{columns,sort,filters} }] lokální presety (per-uživatel)
    advanced: null,
    // aktivní rozšířený filtr (strom pravidel) nebo null
    advancedFilters: [],
    // [{ id, name, tree }] uložené rozšířené filtry
    groups: [],
    // hodnoty sbalených skupin řádků (row grouping)
    tree: [],
    // klíče rozbalených uzlů (tree data)
    _gdVersion: null
    // naposledy aplikovaná verze globálních výchozích nastavení
  };
}
var Store = class {
  /**
   * @param {string} id  Identifikátor gridu (klíč do localStorage).
   * @param {object} [opts]
   * @param {Storage} [opts.storage]  Vlastní storage (default window.localStorage).
   *        Když storage není dostupná (SSR, privátní režim), Store degraduje
   *        na in-memory objekt — grid funguje, jen se stav nepřežije reload.
   */
  constructor(id, opts = {}) {
    if (!id) throw new Error("Lattice Store: chyb\xED `id` (kl\xED\u010D pro persistenci).");
    this.id = id;
    this.key = PREFIX + id;
    this.storage = opts.storage || resolveStorage();
  }
  /** Načte celý blob (deep-merge nad emptyState). Nikdy nevyhodí výjimku. */
  load() {
    const base = emptyState();
    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return base;
    }
    if (!raw) return base;
    try {
      const parsed = JSON.parse(raw);
      return {
        columns: Array.isArray(parsed.columns) ? parsed.columns : base.columns,
        sort: Array.isArray(parsed.sort) ? parsed.sort : base.sort,
        filters: isObject(parsed.filters) ? parsed.filters : base.filters,
        universal: isObject(parsed.universal) ? parsed.universal : base.universal,
        instance: isObject(parsed.instance) ? parsed.instance : base.instance,
        presets: Array.isArray(parsed.presets) ? parsed.presets : base.presets,
        advanced: parsed.advanced || base.advanced,
        advancedFilters: Array.isArray(parsed.advancedFilters) ? parsed.advancedFilters : base.advancedFilters,
        groups: Array.isArray(parsed.groups) ? parsed.groups : base.groups,
        tree: Array.isArray(parsed.tree) ? parsed.tree : base.tree,
        _gdVersion: parsed._gdVersion != null ? parsed._gdVersion : base._gdVersion
      };
    } catch {
      return base;
    }
  }
  /** Existuje uložený stav (rozlišení „úplně nový uživatel" vs. „má nastaveno")? */
  has() {
    try {
      return this.storage.getItem(this.key) != null;
    } catch {
      return false;
    }
  }
  /** Uloží celý blob. Tichý no-op při chybě (např. plná/nedostupná storage). */
  save(state) {
    try {
      this.storage.setItem(this.key, JSON.stringify(state));
    } catch {
    }
  }
  /** Smaže persistovaný stav tohoto gridu. */
  clear() {
    try {
      this.storage.removeItem(this.key);
    } catch {
    }
  }
};
function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function resolveStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = PREFIX + "__probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}
function memoryStorage() {
  const map = /* @__PURE__ */ new Map();
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k)
  };
}

// src/core/ColumnModel.js
var DEFAULT_WIDTH = 150;
var DEFAULT_MIN_WIDTH = 40;
function buildColumns(defs, savedColumns = []) {
  defs = flattenGroups(defs);
  const byField = /* @__PURE__ */ new Map();
  for (const def of defs) {
    if (!def || def.field == null) {
      throw new Error("Lattice: ka\u017Ed\xFD sloupec mus\xED m\xEDt `field`.");
    }
    if (byField.has(def.field)) {
      throw new Error(`Lattice: duplicitn\xED field "${def.field}" v definici sloupc\u016F.`);
    }
    byField.set(def.field, def);
  }
  const result = [];
  const used = /* @__PURE__ */ new Set();
  for (const saved of savedColumns) {
    if (!saved || !byField.has(saved.field)) continue;
    if (used.has(saved.field)) continue;
    result.push(resolveColumn(byField.get(saved.field), saved));
    used.add(saved.field);
  }
  for (const def of defs) {
    if (used.has(def.field)) continue;
    result.push(resolveColumn(def, null));
    used.add(def.field);
  }
  return result;
}
function flattenGroups(defs) {
  const out = [];
  for (const def of defs) {
    if (def && Array.isArray(def.columns) && def.field == null) {
      const groupTitle = def.title != null ? String(def.title) : "";
      for (const child of def.columns) {
        out.push({ ...child, group: groupTitle, groupDef: def });
      }
    } else {
      out.push(def);
    }
  }
  return out;
}
function resolveColumn(def, saved) {
  const s = saved || {};
  const availableFilters = deriveAvailableFilters(def);
  const filterExplicit = !!(def.filter || Array.isArray(def.filterTypes));
  const defaultFilter = def.filter || availableFilters[0] || null;
  const defaultFilterEnabled = def.filterEnabled !== void 0 ? def.filterEnabled !== false : filterExplicit;
  const filter = s.filterType != null ? s.filterType : defaultFilter;
  return {
    // --- z definice (živé, nepersistuje se) ---
    field: def.field,
    title: def.title != null ? def.title : def.field,
    type: def.type || "text",
    defaultFilter,
    // původní/odvozený filtr (pro reset/labely)
    availableFilters,
    // mezi čím lze přepínat
    filterValues: def.filterValues || null,
    filterUrl: def.filterUrl || null,
    // pro select/multiselect z API
    formatter: def.formatter || null,
    // vlastní formátor buňky
    value: typeof def.value === "function" ? def.value : null,
    // odvozená (computed) hodnota z celého řádku
    validator: def.validator != null ? def.validator : null,
    // deklarativní validace editace
    cellClass: typeof def.cellClass === "function" ? def.cellClass : null,
    // podmíněné třídy buňky
    cellStyle: typeof def.cellStyle === "function" ? def.cellStyle : null,
    // podmíněný inline styl buňky
    editor: def.editor || null,
    headerSort: def.headerSort !== false,
    // řadit klikem na hlavičku (default true)
    minWidth: def.minWidth != null ? def.minWidth : DEFAULT_MIN_WIDTH,
    // Výchozí zarovnání dle datového typu (přepsatelné explicitním def.align):
    // čísla a datumy vpravo, boolean na střed, ostatní vlevo.
    align: def.align || defaultAlign(def.type || "text"),
    defaultGroup: def.group || null,
    // skupina z konfigurace (výchozí)
    group: s.group !== void 0 ? s.group : def.group || null,
    // skupina (uživatel může přepsat)
    frozenAllowed: def.frozen !== "never",
    // lze ukotvit? (def.frozen: 'never' zakáže)
    editable: def.type === "id" ? false : def.editable === true,
    // typ 'id' se nikdy needituje
    editorParams: def.editorParams || null,
    formatterParams: def.formatterParams || null,
    cellPopup: typeof def.cellPopup === "function" ? def.cellPopup : null,
    // popup na klik do buňky
    headerPopup: typeof def.headerPopup === "function" ? def.headerPopup : null,
    // popup z ⓘ v hlavičce
    headerMenu: def.headerMenu != null ? def.headerMenu : null,
    // menu hlavičky (true | pole | funkce)
    def,
    // reference na původní definici (pro rozšíření/vlastní typy)
    // --- uživatelský stav (persistuje se; priorita: saved → definice → default) ---
    visible: pick(s.visible, def.visible, true) !== false,
    width: numberOr(s.width, def.width, DEFAULT_WIDTH),
    frozen: def.frozen === "never" ? false : normalizeFrozen(pick(s.frozen, def.frozen, false)),
    filter,
    // aktivní typ header filtru (persistuje se jako filterType)
    defaultFilterEnabled,
    // výchozí stav (pro serializaci jen odchylek)
    filterEnabled: pick(s.filterEnabled, def.filterEnabled, defaultFilterEnabled) !== false,
    // zobrazit filtr sloupce?
    // Otočení hlavičky: null = podle nastavení tabulky | 'none' | '90' | '270'
    defaultHeaderRotate: def.headerRotate != null ? String(def.headerRotate) : null,
    headerRotate: s.headerRotate !== void 0 ? s.headerRotate : def.headerRotate != null ? String(def.headerRotate) : null,
    // Souhrnné funkce sloupce (pole; jedna či více z 'min'|'max'|'sum'|'avg'|'count').
    defaultSummary: normSummary(def.summary),
    summary: s.summary !== void 0 ? normSummary(s.summary) : normSummary(def.summary),
    // Zapojení sloupce do souhrnu ŘÁDKŮ (pravý sloupec); pole funkcí jako summary.
    defaultRowSummary: normSummary(def.rowSummary),
    rowSummary: s.rowSummary !== void 0 ? normSummary(s.rowSummary) : normSummary(def.rowSummary),
    // Formát zobrazení (číslo/měna/datum) — výjimka sloupce vůči globálnímu formátu.
    // null = řídit se globálním nastavením tabulky.
    defaultColFormat: def.format || null,
    format: s.format !== void 0 ? s.format : def.format || null,
    // Podmíněná barevná škála (semafor) — { on, levels, reverse, thresholds }.
    defaultCondFormat: def.condFormat || null,
    condFormat: s.condFormat !== void 0 ? s.condFormat : def.condFormat || null
  };
}
function normSummary(v) {
  if (Array.isArray(v)) return v.slice();
  return v ? [v] : [];
}
var FILTERS_BY_TYPE = {
  number: ["number", "number-range"],
  money: ["number", "number-range"],
  progress: ["number", "number-range"],
  rating: ["number", "number-range"],
  date: ["date-range", "date-two"],
  datetime: ["date-range", "date-two"],
  boolean: ["boolean"],
  text: ["text"]
};
function deriveAvailableFilters(def) {
  let list;
  if (Array.isArray(def.filterTypes)) {
    list = def.filterTypes.slice();
  } else {
    const type = def.type || "text";
    list = (FILTERS_BY_TYPE[type] || []).slice();
    if (type === "text") list.push("select", "multiselect");
  }
  if (def.filter && !list.includes(def.filter)) list.unshift(def.filter);
  return [...new Set(list)];
}
function defaultAlign(type) {
  if (type === "id" || type === "number" || type === "money" || type === "date" || type === "datetime") return "right";
  if (type === "boolean" || type === "tick" || type === "icon" || type === "color") return "center";
  return null;
}
function normalizeFrozen(v) {
  if (v === "right") return "right";
  return v ? true : false;
}
function serializeColumns(columns) {
  return columns.map((c) => ({
    field: c.field,
    visible: c.visible,
    width: c.width,
    frozen: c.frozen,
    // Zvolený typ filtru se ukládá jen když se liší od defaultu z definice
    // (jinak by ho persistovaný stav „zamrazil" a změna v kódu by se neprojevila).
    ...c.filter !== c.defaultFilter ? { filterType: c.filter } : {},
    // filterEnabled se ukládá jen když se liší od výchozího stavu sloupce.
    ...c.filterEnabled !== c.defaultFilterEnabled ? { filterEnabled: c.filterEnabled } : {},
    // skupina se ukládá jen když se liší od konfigurace (uživatel ji změnil).
    ...c.group !== c.defaultGroup ? { group: c.group } : {},
    // otočení hlavičky se ukládá jen když se liší od výchozího (uživatel ho změnil).
    ...c.headerRotate !== c.defaultHeaderRotate ? { headerRotate: c.headerRotate } : {},
    // souhrnné funkce se ukládají, jen když se liší od výchozích.
    ...JSON.stringify(c.summary) !== JSON.stringify(c.defaultSummary) ? { summary: c.summary } : {},
    ...JSON.stringify(c.rowSummary) !== JSON.stringify(c.defaultRowSummary) ? { rowSummary: c.rowSummary } : {},
    // formát se ukládá jen když se liší od výchozího (uživatel udělal výjimku).
    ...JSON.stringify(c.format) !== JSON.stringify(c.defaultColFormat) ? { format: c.format } : {},
    ...JSON.stringify(c.condFormat) !== JSON.stringify(c.defaultCondFormat) ? { condFormat: c.condFormat } : {}
  }));
}
function pick(...vals) {
  for (const v of vals) if (v !== void 0) return v;
  return void 0;
}
function numberOr(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (v !== void 0 && v !== null && Number.isFinite(n)) return n;
  }
  return DEFAULT_WIDTH;
}

// src/core/autoColumns.js
var DEFAULT_FILTER = { text: "text", number: "number", date: "date-range", boolean: "boolean" };
function deriveColumns(rows, opts = {}) {
  const sampleSize = opts.sample || 50;
  const sample = (Array.isArray(rows) ? rows : []).slice(0, sampleSize);
  const fields = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of sample) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!seen.has(k)) {
        seen.add(k);
        fields.push(k);
      }
    }
  }
  return columnsFor(fields, sample, opts.titles);
}
function columnsFor(fields, rows, titles = null) {
  const sample = (Array.isArray(rows) ? rows : []).slice(0, 50);
  return fields.map((field2) => {
    const values = sample.map((r) => r && r[field2]).filter((v) => v != null && v !== "");
    const type = inferType(values);
    const title = titles && titles[field2] != null ? titles[field2] : humanize(field2);
    return { field: field2, title, type, filter: DEFAULT_FILTER[type] || "text" };
  });
}
function inferType(values) {
  if (!values.length) return "text";
  if (values.every(isBool)) return "boolean";
  if (values.every(isNumeric)) return "number";
  if (values.every(isDate)) return "date";
  return "text";
}
function isBool(v) {
  return typeof v === "boolean" || /^(true|false|ano|ne|yes|no)$/i.test(String(v));
}
function isNumeric(v) {
  if (typeof v === "boolean") return false;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  return s !== "" && Number.isFinite(Number(s));
}
function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(v);
}
function humanize(field2) {
  return String(field2).replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
}

// src/core/fileImport.js
function parseCSV(text, opts = {}) {
  const delim = opts.delimiter || sniffDelimiter(text);
  const grid = parseGrid(String(text), delim);
  if (!grid.length) return [];
  const header = grid[0].map((h, i) => String(h).trim() || "col" + (i + 1));
  const out = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.length === 1 && cells[0] === "") continue;
    const obj = {};
    header.forEach((h, j) => {
      obj[h] = coerce(cells[j]);
    });
    out.push(obj);
  }
  return out;
}
function parseJSON(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && typeof data === "object") return [data];
  return [];
}
function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const name = (file.name || "").toLowerCase();
        if (name.endsWith(".xml") || !name.endsWith(".csv") && !name.endsWith(".json") && /^\s*<(\?xml|feed|rss|[a-z])/i.test(text)) {
          resolve({ rows: parseXML(text).rows, format: "xml" });
        } else if (name.endsWith(".json") || !name.endsWith(".csv") && /^\s*[[{]/.test(text)) {
          resolve({ rows: parseJSON(text), format: "json" });
        } else {
          resolve({ rows: parseCSV(text), format: "csv" });
        }
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
function tableToRows(table) {
  const trs = Array.from(table.rows || []);
  if (!trs.length) return { rows: [], fields: [], titles: {} };
  let headerIdx = trs.findIndex((r) => r.querySelector && r.querySelector("th"));
  if (headerIdx === -1) headerIdx = 0;
  const headCells = Array.from(trs[headerIdx].cells);
  const fields = [];
  const titles = {};
  const used = /* @__PURE__ */ new Set();
  headCells.forEach((c, i) => {
    const text = (c.textContent || "").trim();
    let f = slug(text) || "col" + (i + 1);
    while (used.has(f)) f += "_" + i;
    used.add(f);
    fields.push(f);
    titles[f] = text || "Sloupec " + (i + 1);
  });
  const rows = [];
  for (let i = headerIdx + 1; i < trs.length; i++) {
    const cells = Array.from(trs[i].cells);
    if (!cells.length) continue;
    const obj = {};
    fields.forEach((f, j) => {
      obj[f] = coerce(cells[j] ? (cells[j].textContent || "").trim() : "");
    });
    rows.push(obj);
  }
  return { rows, fields, titles };
}
function parseHTMLTable(html, index = 0) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const tables = doc.querySelectorAll("table");
  const table = tables[index];
  if (!table) throw new Error(`Tabulka #${index} nenalezena (na str\xE1nce je ${tables.length}).`);
  return tableToRows(table);
}
function parseXML(text, opts = {}) {
  const doc = new DOMParser().parseFromString(String(text), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Neplatn\xE9 XML.");
  const records = pickRecords(doc, opts.record);
  if (!records.length) return { rows: [], fields: [], titles: {} };
  const fields = [];
  const titles = {};
  const seen = /* @__PURE__ */ new Set();
  const addField = (f, title) => {
    if (!seen.has(f)) {
      seen.add(f);
      fields.push(f);
      titles[f] = title;
    }
  };
  const rows = records.map((rec) => {
    const obj = {};
    for (const a of Array.from(rec.attributes || [])) {
      const f = "@" + a.name;
      addField(f, a.name);
      obj[f] = coerce(a.value);
    }
    for (const c of Array.from(rec.children || [])) {
      const f = c.localName || c.nodeName;
      const val = c.childElementCount > 0 ? (c.textContent || "").trim() : (c.textContent || "").trim() || attrValue(c);
      if (f in obj) obj[f] = obj[f] + "; " + val;
      else {
        addField(f, humanizeTag(f));
        obj[f] = coerce(val);
      }
    }
    return obj;
  });
  return { rows, fields, titles };
}
function pickRecords(doc, override) {
  const all = Array.from(doc.getElementsByTagName("*"));
  if (override) return all.filter((el2) => (el2.localName || el2.nodeName) === override);
  const tally = /* @__PURE__ */ new Map();
  for (const el2 of all) {
    if (el2.childElementCount > 0) {
      const n = el2.localName || el2.nodeName;
      tally.set(n, (tally.get(n) || 0) + 1);
    }
  }
  let best = null, bestCount = 1;
  for (const [n, c] of tally) if (c > bestCount) {
    bestCount = c;
    best = n;
  }
  if (best) return all.filter((el2) => (el2.localName || el2.nodeName) === best);
  const root = doc.documentElement;
  return root ? Array.from(root.children) : [];
}
function attrValue(el2) {
  return el2.getAttribute("href") || el2.getAttribute("value") || el2.attributes[0] && el2.attributes[0].value || "";
}
function humanizeTag(n) {
  return String(n).replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().replace(/^./, (c) => c.toUpperCase());
}
function slug(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function parseGrid(text, delim) {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [], field2 = "", inQuotes = false, started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    started = true;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field2 += '"';
          i++;
        } else inQuotes = false;
      } else field2 += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field2);
      field2 = "";
    } else if (c === "\n") {
      row.push(field2);
      rows.push(row);
      row = [];
      field2 = "";
    } else {
      field2 += c;
    }
  }
  if (started && (field2 !== "" || row.length)) {
    row.push(field2);
    rows.push(row);
  }
  return rows;
}
function sniffDelimiter(text) {
  const nl = text.indexOf("\n");
  const line = nl >= 0 ? text.slice(0, nl) : text;
  const counts = { ",": 0, ";": 0, "	": 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ",";
}
function coerce(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (s === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(s) && String(Number(s)) === s) return Number(s);
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  return s;
}

// src/core/cellValue.js
function cellValue(row, col) {
  if (row == null || col == null) return void 0;
  if (typeof col.value === "function") {
    try {
      return col.value(row);
    } catch {
      return void 0;
    }
  }
  return row[col.field];
}
function isComputed(col) {
  return !!(col && typeof col.value === "function");
}

// src/core/exporter.js
function esc(value, delim) {
  const s = value == null ? "" : String(value);
  if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function toDelimited(rows, cols, opts = {}) {
  const delim = opts.delimiter || ",";
  const lines = [];
  if (opts.header !== false) lines.push(cols.map((c) => esc(c.title, delim)).join(delim));
  for (const r of rows) lines.push(cols.map((c) => esc(cellValue(r, c), delim)).join(delim));
  return lines.join("\n");
}
function toJSON(rows, cols) {
  return JSON.stringify(rows.map((r) => {
    const o = {};
    for (const c of cols) o[c.field] = cellValue(r, c);
    return o;
  }), null, 2);
}
function toXML(rows, cols) {
  const xe = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tag = (f) => String(f).replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^[^a-zA-Z_]/, "_");
  const body = rows.map(
    (r) => "  <row>" + cols.map((c) => {
      const t = tag(c.field);
      return `<${t}>${xe(cellValue(r, c))}</${t}>`;
    }).join("") + "</row>"
  ).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<data>\n' + body + "\n</data>";
}
function toExcelXML(rows, cols, opts = {}) {
  const xe = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const isNum = (c) => c.type === "number" || c.type === "money" || c.type === "progress" || c.type === "rating";
  const cell = (v, numeric) => {
    if (numeric && v != null && v !== "" && Number.isFinite(Number(v))) {
      return `<Cell><Data ss:Type="Number">${Number(v)}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  };
  const head = "<Row>" + cols.map((c) => `<Cell><Data ss:Type="String">${xe(c.title)}</Data></Cell>`).join("") + "</Row>";
  const body = rows.map(
    (r) => "<Row>" + cols.map((c) => cell(cellValue(r, c), isNum(c))).join("") + "</Row>"
  ).join("");
  const name = xe(opts.sheetName || "List1");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${name}"><Table>${head}${body}</Table></Worksheet>
</Workbook>`;
}
function buildExport(format, rows, cols, opts = {}) {
  const f = String(format || "csv").toLowerCase();
  if (f === "json") return toJSON(rows, cols);
  if (f === "xml") return toXML(rows, cols);
  if (f === "excel" || f === "xls") return toExcelXML(rows, cols, opts);
  const delimiter = opts.delimiter || (f === "tsv" ? "	" : ",");
  return toDelimited(rows, cols, { delimiter, header: opts.header });
}
var EXPORT_META = {
  csv: { ext: "csv", mime: "text/csv;charset=utf-8" },
  tsv: { ext: "tsv", mime: "text/tab-separated-values;charset=utf-8" },
  json: { ext: "json", mime: "application/json;charset=utf-8" },
  xml: { ext: "xml", mime: "application/xml;charset=utf-8" },
  excel: { ext: "xls", mime: "application/vnd.ms-excel;charset=utf-8" }
};
function downloadFile(content, filename, mime) {
  const blob = new Blob(["\uFEFF" + content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// src/features/print.js
function printTable(title, cols, rows, opts = {}) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const thead = "<thead><tr>" + cols.map((c) => `<th>${esc2(c.title)}</th>`).join("") + "</tr></thead>";
  const tbody = "<tbody>" + rows.map(
    (r) => "<tr>" + cols.map((c) => `<td>${esc2(cellValue(r, c))}</td>`).join("") + "</tr>"
  ).join("") + "</tbody>";
  const style = opts.style || `
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
    th { background: #eee; }
    @media print { body { margin: 0; } }`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc2(title || "tisk")}</title><style>${style}</style></head><body>${title ? `<h1>${esc2(title)}</h1>` : ""}<table>${thead}${tbody}</table></body></html>`;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const w = iframe.contentWindow;
  const cleanup = () => setTimeout(() => iframe.remove(), 1e3);
  w.onafterprint = cleanup;
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
    }
    if (!("onafterprint" in w)) cleanup();
  }, 200);
}

// src/util/dom.js
function el(tag, props = {}, children) {
  let tagName = tag;
  let classes = [];
  const dotIdx = tag.indexOf(".");
  if (dotIdx !== -1) {
    tagName = tag.slice(0, dotIdx) || "div";
    classes = tag.slice(dotIdx + 1).split(".").filter(Boolean);
  }
  const node = document.createElement(tagName);
  if (classes.length) node.classList.add(...classes);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class" || k === "className") node.className = [node.className, v].filter(Boolean).join(" ");
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v);
    else if (k === "on" && typeof v === "object") {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    } else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k in node) {
      try {
        node[k] = v;
      } catch {
        node.setAttribute(k, v);
      }
    } else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}
function append(node, children) {
  if (children == null) return node;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}
function onOutside(node, cb) {
  const onDown = (e) => {
    if (!node.contains(e.target)) cb(e);
  };
  const onKey = (e) => {
    if (e.key === "Escape") cb(e);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}
function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// src/filters/dateRangePicker.js
function buildDateRangePicker(column, ctx) {
  const t = (k) => ctx.i18n.t("dateRange." + k);
  const monthName = (m) => dictArr("months")[m];
  const weekdayNames = () => dictArr("weekdays");
  function dictArr(key) {
    const d = ctx.i18n.dict && ctx.i18n.dict.dateRange && ctx.i18n.dict.dateRange[key];
    if (Array.isArray(d)) return d;
    return key === "months" ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  }
  let applied = { from: parseISO(ctx.value?.from), to: parseISO(ctx.value?.to) };
  let draft = cloneRange(applied);
  let leftView = viewOf(draft.from) || viewOf(/* @__PURE__ */ new Date());
  let rightView = viewOf(draft.to) || nextMonth(leftView);
  if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
  let panel = null;
  let closeFn = null;
  const control = el("div.lattice-dr", { tabindex: "0" });
  const text = el("span.lattice-dr-text");
  const clearBtn = el("button.lattice-dr-clear", { type: "button", html: "\xD7", title: t("clear") });
  clearBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearFilter();
  });
  control.append(text, clearBtn, el("span.lattice-dr-icon", { html: CAL_SVG }));
  updateControl();
  control.addEventListener("mousedown", (e) => {
    e.preventDefault();
    panel ? close() : open();
  });
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      panel ? close() : open();
    }
    if (e.key === "Escape") close();
  });
  function updateControl() {
    const { from, to } = applied;
    if (!from && !to) {
      text.textContent = t("placeholder");
      text.classList.add("is-placeholder");
      clearBtn.style.display = "none";
    } else {
      text.classList.remove("is-placeholder");
      text.textContent = rangeText(from, to);
      clearBtn.style.display = "";
    }
  }
  function clearFilter() {
    applied = { from: null, to: null };
    draft = { from: null, to: null };
    ctx.onChange(null);
    updateControl();
    close();
  }
  function rangeText(from, to) {
    if (from && to) return disp(from) + " \u2013 " + disp(to);
    if (from) return disp(from) + " \u2013";
    if (to) return "\u2013 " + disp(to);
    return "";
  }
  function open() {
    if (panel) return;
    draft = cloneRange(applied);
    leftView = viewOf(draft.from) || viewOf(/* @__PURE__ */ new Date());
    rightView = viewOf(draft.to) || nextMonth(leftView);
    if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
    panel = el("div.lattice-dr-panel");
    const body = el("div.lattice-dr-body");
    const presets = el("div.lattice-dr-presets");
    const cals = el("div.lattice-dr-cals");
    const leftCal = el("div.lattice-dr-cal");
    const rightCal = el("div.lattice-dr-cal");
    cals.append(leftCal, rightCal);
    body.append(presets, cals);
    const footer = el("div.lattice-dr-footer");
    const rangeLabel = el("span.lattice-dr-range");
    const cancelBtn = el("button.lattice-dr-btn", { type: "button", text: t("cancel") });
    const applyBtn = el("button.lattice-dr-btn.is-primary", { type: "button", text: t("apply") });
    cancelBtn.addEventListener("click", () => close());
    applyBtn.addEventListener("click", () => apply());
    footer.append(rangeLabel, el("div.lattice-dr-footer-btns", {}, [cancelBtn, applyBtn]));
    panel.append(body, footer);
    document.body.appendChild(panel);
    panel._nodes = { presets, leftCal, rightCal, rangeLabel };
    renderPresets();
    renderAll();
    position();
    control.classList.add("is-open");
    closeFn = onOutside(panel, (e) => {
      if (!control.contains(e.target)) close();
    });
  }
  function close() {
    closeFn?.();
    panel?.remove();
    panel = null;
    closeFn = null;
    control.classList.remove("is-open");
  }
  function apply() {
    applied = cloneRange(draft);
    const { from, to } = applied;
    if (!from && !to) ctx.onChange(null);
    else ctx.onChange({ from: from ? toISO(from) : null, to: to ? toISO(to) : from ? toISO(from) : null });
    updateControl();
    close();
  }
  function position() {
    const r = control.getBoundingClientRect();
    panel.style.position = "absolute";
    panel.style.top = window.scrollY + r.bottom + 2 + "px";
    const w = panel.offsetWidth;
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 8;
    panel.style.left = Math.max(8, Math.min(left, maxLeft)) + "px";
  }
  function renderPresets() {
    const { presets } = panel._nodes;
    clear(presets);
    for (const p of PRESETS) {
      const row = el("div.lattice-dr-preset", { text: ctx.i18n.t("dateRange.presets." + p.key) });
      row.addEventListener("click", () => setRange(p.range()));
      presets.appendChild(row);
    }
    const clearRow = el("div.lattice-dr-preset.is-clear", { text: "\u2715 " + t("clear") });
    clearRow.addEventListener("click", () => clearFilter());
    presets.appendChild(clearRow);
  }
  function setRange({ from, to }) {
    draft = { from: from || null, to: to || null };
    if (draft.from) leftView = viewOf(draft.from);
    if (draft.to) rightView = viewOf(draft.to);
    else rightView = nextMonth(leftView);
    if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
    renderAll();
  }
  function renderAll() {
    renderMonth("left", leftView);
    renderMonth("right", rightView);
    panel._nodes.rangeLabel.textContent = rangeText(draft.from, draft.to);
  }
  function renderMonth(side, view) {
    const container = side === "left" ? panel._nodes.leftCal : panel._nodes.rightCal;
    clear(container);
    const head = el("div.lattice-dr-cal-head");
    const prev = el("button.lattice-dr-nav", { type: "button", html: "\u2039" });
    const next = el("button.lattice-dr-nav", { type: "button", html: "\u203A" });
    prev.addEventListener("click", () => shift(side, -1));
    next.addEventListener("click", () => shift(side, 1));
    head.append(prev, el("span.lattice-dr-cal-title", { text: monthName(view.m) + " " + view.y }), next);
    container.appendChild(head);
    const wd = el("div.lattice-dr-weekdays");
    for (const w of weekdayNames()) wd.appendChild(el("span", { text: w }));
    container.appendChild(wd);
    const grid = el("div.lattice-dr-grid");
    for (const cell of monthMatrix(view.y, view.m)) {
      const btn = el("button.lattice-dr-day", { type: "button", text: String(cell.date.getDate()) });
      if (!cell.inMonth) btn.classList.add("is-out");
      markDay(btn, cell.date);
      btn.addEventListener("click", () => pickDay(cell.date));
      grid.appendChild(btn);
    }
    container.appendChild(grid);
  }
  function markDay(btn, date) {
    const { from, to } = draft;
    const ts = date.getTime();
    if (from && ts === from.getTime()) btn.classList.add("is-selected", "is-from");
    if (to && ts === to.getTime()) btn.classList.add("is-selected", "is-to");
    if (from && to && ts > from.getTime() && ts < to.getTime()) btn.classList.add("is-in-range");
  }
  function pickDay(date) {
    if (!draft.from || draft.from && draft.to) {
      draft = { from: date, to: null };
    } else if (date.getTime() < draft.from.getTime()) {
      draft = { from: date, to: draft.from };
    } else {
      draft.to = date;
    }
    renderAll();
  }
  function shift(side, delta) {
    if (side === "left") leftView = addMonths(leftView, delta);
    else rightView = addMonths(rightView, delta);
    renderMonth(side, side === "left" ? leftView : rightView);
  }
  function disp(d) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  return control;
}
function parseISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
var pad = (n) => String(n).padStart(2, "0");
function cloneRange(r) {
  return { from: r.from ? new Date(r.from) : null, to: r.to ? new Date(r.to) : null };
}
function viewOf(d) {
  return d ? { y: d.getFullYear(), m: d.getMonth() } : null;
}
function sameView(a, b) {
  return a && b && a.y === b.y && a.m === b.m;
}
function nextMonth(v) {
  return addMonths(v, 1);
}
function addMonths(v, delta) {
  const d = new Date(v.y, v.m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}
function monthMatrix(y, m) {
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(y, m, 1 - offset + i);
    cells.push({ date, inMonth: date.getMonth() === m });
  }
  return cells;
}
function today() {
  const d = /* @__PURE__ */ new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function startOfWeek(d) {
  return addDays(d, -((d.getDay() + 6) % 7));
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
var PRESETS = [
  { key: "today", range: () => ({ from: today(), to: today() }) },
  { key: "yesterday", range: () => ({ from: addDays(today(), -1), to: addDays(today(), -1) }) },
  { key: "weekToDate", range: () => ({ from: startOfWeek(today()), to: today() }) },
  { key: "thisWeek", range: () => ({ from: startOfWeek(today()), to: addDays(startOfWeek(today()), 6) }) },
  { key: "lastWeek", range: () => ({ from: addDays(startOfWeek(today()), -7), to: addDays(startOfWeek(today()), -1) }) },
  { key: "last7", range: () => ({ from: addDays(today(), -6), to: today() }) },
  { key: "last30", range: () => ({ from: addDays(today(), -29), to: today() }) },
  { key: "monthToDate", range: () => ({ from: startOfMonth(today()), to: today() }) },
  { key: "thisMonth", range: () => ({ from: startOfMonth(today()), to: endOfMonth(today()) }) },
  { key: "lastMonth", range: () => {
    const d = new Date(today().getFullYear(), today().getMonth() - 1, 1);
    return { from: startOfMonth(d), to: endOfMonth(d) };
  } },
  { key: "thisQuarter", range: () => {
    const t = today();
    const qs = Math.floor(t.getMonth() / 3) * 3;
    return { from: new Date(t.getFullYear(), qs, 1), to: new Date(t.getFullYear(), qs + 3, 0) };
  } },
  { key: "nextMonth", range: () => {
    const d = new Date(today().getFullYear(), today().getMonth() + 1, 1);
    return { from: startOfMonth(d), to: endOfMonth(d) };
  } },
  { key: "next3Months", range: () => {
    const s = new Date(today().getFullYear(), today().getMonth() + 1, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 3, 0);
    return { from: s, to: e };
  } }
];
var CAL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 7v10H5V9h14z"/></svg>';

// src/filters/index.js
var registry = /* @__PURE__ */ new Map();
function registerFilter(name, def) {
  registry.set(name, def);
}
function getFilter(name) {
  return registry.get(name) || null;
}
function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function toTime(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}
function dayTime(v) {
  const t = toTime(v);
  if (t == null) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function norm(s) {
  return String(s ?? "").toLowerCase();
}
function normOption(o) {
  if (o != null && typeof o === "object") return { value: String(o.value), label: String(o.label != null ? o.label : o.value) };
  return { value: String(o), label: String(o) };
}
function sortOptions(opts, column, ctx) {
  if (column.filterSort === false) return opts;
  const locale = ctx.i18n && ctx.i18n.locale;
  return opts.slice().sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true }));
}
function fetchOptions(column, ctx) {
  if (Array.isArray(column.filterValues)) return Promise.resolve(sortOptions(column.filterValues.map(normOption), column, ctx));
  if (column.filterUrl && ctx.fetchJson) {
    return ctx.fetchJson(column.filterUrl).then((d) => sortOptions((Array.isArray(d) ? d : d && d.data ? d.data : []).map(normOption), column, ctx)).catch(() => []);
  }
  if (typeof ctx.distinctValues === "function") return Promise.resolve(sortOptions(ctx.distinctValues().map(normOption), column, ctx));
  return Promise.resolve([]);
}
registerFilter("text", {
  build(column, ctx) {
    const input = el("input.lattice-filter-input", {
      type: "text",
      placeholder: ctx.i18n.t("filters.search"),
      title: ctx.i18n.t("filters.negateHint"),
      value: ctx.value ?? ""
    });
    const clear2 = el("button.lattice-filter-clear", { type: "button", tabindex: "-1", title: ctx.i18n.t("filters.clearOne"), text: "\xD7" });
    const sync = () => {
      clear2.style.display = input.value ? "" : "none";
    };
    sync();
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener("input", () => {
      sync();
      fire(input.value);
    });
    clear2.addEventListener("mousedown", (e) => e.preventDefault());
    clear2.addEventListener("click", () => {
      input.value = "";
      sync();
      ctx.onChange("");
      input.focus();
    });
    return el("div.lattice-filter-clearable", {}, [input, clear2]);
  },
  isEmpty: (v) => !v || String(v).trim() === "",
  match(value, cell) {
    const raw = String(value).trim();
    const negate = raw.startsWith("!");
    const needle = norm(negate ? raw.slice(1) : raw);
    if (needle === "") return true;
    const has = norm(cell).includes(needle);
    return negate ? !has : has;
  },
  toServer: (field2, value) => [{ field: field2, type: "like", value }]
});
registerFilter("number", {
  build(column, ctx) {
    const input = el("input.lattice-filter-input", {
      type: "text",
      placeholder: "=, >, <\u2026",
      value: ctx.value ?? ""
    });
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener("input", () => fire(input.value));
    return input;
  },
  isEmpty: (v) => !v || String(v).trim() === "",
  match(value, cell) {
    const m = String(value).trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    if (!m) return true;
    const op = m[1] || "=";
    const target = toNumber(m[2]);
    const n = toNumber(cell);
    if (target == null || n == null) return false;
    switch (op) {
      case ">":
        return n > target;
      case "<":
        return n < target;
      case ">=":
        return n >= target;
      case "<=":
        return n <= target;
      default:
        return n === target;
    }
  },
  toServer(field2, value) {
    const m = String(value).trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    const op = m && m[1] || "=";
    const val = m ? m[2] : value;
    return [{ field: field2, type: op, value: val }];
  }
});
registerFilter("number-range", {
  build(column, ctx) {
    const v = ctx.value || {};
    const min = el("input.lattice-filter-input", { type: "number", placeholder: ctx.i18n.t("filters.from"), value: v.min ?? "" });
    const max = el("input.lattice-filter-input", { type: "number", placeholder: ctx.i18n.t("filters.to"), value: v.max ?? "" });
    const fire = debounce(() => ctx.onChange({ min: min.value || null, max: max.value || null }), ctx.debounceMs);
    min.addEventListener("input", fire);
    max.addEventListener("input", fire);
    return stackedPair(ctx, min, max);
  },
  isEmpty: (v) => !v || v.min == null && v.max == null,
  match(value, cell) {
    const n = toNumber(cell);
    if (n == null) return false;
    const lo = toNumber(value.min);
    const hi = toNumber(value.max);
    if (lo != null && n < lo) return false;
    if (hi != null && n > hi) return false;
    return true;
  },
  toServer(field2, value) {
    const out = [];
    if (value.min != null && value.min !== "") out.push({ field: field2, type: ">=", value: value.min });
    if (value.max != null && value.max !== "") out.push({ field: field2, type: "<=", value: value.max });
    return out;
  }
});
function stackedPair(ctx, fromInput, toInput) {
  const row = (label, input) => el("label.lattice-stacked-row", {}, [el("span.lattice-stacked-lbl", { text: label }), input]);
  return el("div.lattice-filter-stacked", {}, [row(ctx.i18n.t("filters.from"), fromInput), row(ctx.i18n.t("filters.to"), toInput)]);
}
function buildDatePair(ctx) {
  const v = ctx.value || {};
  const from = el("input.lattice-filter-input", { type: "date", value: v.from ?? "" });
  const to = el("input.lattice-filter-input", { type: "date", value: v.to ?? "" });
  return { from, to, wrap: stackedPair(ctx, from, to) };
}
registerFilter("date-range", {
  build(column, ctx) {
    return buildDateRangePicker(column, ctx);
  },
  isEmpty: (v) => !v || !v.from && !v.to,
  match(value, cell) {
    const t = dayTime(cell);
    if (t == null) return false;
    const lo = dayTime(value.from);
    const hi = dayTime(value.to);
    if (lo != null && t < lo) return false;
    if (hi != null && t > hi) return false;
    return true;
  },
  // JEDNO pole: rozsah pošleme jako jednu hodnotu "from|to"
  toServer: (field2, value) => [{ field: field2, type: "dateRange", value: `${value.from || ""}|${value.to || ""}` }]
});
registerFilter("date-two", {
  build(column, ctx) {
    const { from, to, wrap } = buildDatePair(ctx);
    const fire = () => ctx.onChange({ from: from.value || null, to: to.value || null });
    from.addEventListener("change", fire);
    to.addEventListener("change", fire);
    return wrap;
  },
  isEmpty: (v) => !v || !v.from && !v.to,
  match(value, cell) {
    const t = dayTime(cell);
    if (t == null) return false;
    const lo = dayTime(value.from);
    const hi = dayTime(value.to);
    if (lo != null && t < lo) return false;
    if (hi != null && t > hi) return false;
    return true;
  },
  // DVĚ samostatná pole → dva parametry (jedno může chybět)
  toServer(field2, value) {
    const out = [];
    if (value.from) out.push({ field: field2, type: ">=", value: value.from });
    if (value.to) out.push({ field: field2, type: "<=", value: value.to });
    return out;
  }
});
registerFilter("select", {
  build(column, ctx) {
    return buildSelect(column, ctx);
  },
  isEmpty: (v) => v == null || v === "",
  match: (value, cell) => norm(cell) === norm(value),
  toServer: (field2, value) => [{ field: field2, type: "=", value }]
});
function buildSelect(column, ctx) {
  let value = ctx.value != null && ctx.value !== "" ? String(ctx.value) : null;
  let options = [];
  let panel = null;
  let closePanel = null;
  const control = el("div.lattice-ms.lattice-ms-single", { tabindex: "0" });
  const text = el("span.lattice-ms-text");
  const caret = el("span.lattice-ms-caret", { html: CARET_SVG });
  control.append(text, caret);
  const labelFor = (v) => {
    const o = options.find((o2) => o2.value === v);
    return o ? o.label : v;
  };
  function renderText() {
    clear(text);
    if (value == null) {
      text.appendChild(el("span.lattice-ms-placeholder", { text: ctx.i18n.t("filters.all") }));
    } else {
      text.appendChild(el("span.lattice-ms-single-label", { text: labelFor(value) }));
    }
  }
  function pick2(v) {
    value = v;
    renderText();
    close();
    ctx.onChange(value != null ? value : null);
  }
  function open() {
    if (panel) return;
    panel = el("div.lattice-ms-panel");
    const search = el("input.lattice-ms-search", { type: "text", placeholder: ctx.i18n.t("filters.search") });
    const list = el("div.lattice-ms-list");
    panel._search = search;
    panel._list = list;
    search.addEventListener("input", () => renderPanelList(list, search.value));
    panel.append(search, list);
    document.body.appendChild(panel);
    positionPanel(panel, control);
    renderPanelList(list, "");
    control.classList.add("is-open");
    closePanel = onOutside(panel, (e) => {
      if (!control.contains(e.target)) close();
    });
    search.focus();
  }
  function close() {
    closePanel?.();
    panel?.remove();
    panel = null;
    closePanel = null;
    control.classList.remove("is-open");
  }
  function renderPanelList(list, q) {
    clear(list);
    const needle = (q || "").trim().toLowerCase();
    const allRow = el("div.lattice-ms-option", { class: value == null ? "is-selected" : "" }, [
      el("span.lattice-ms-check", { text: value == null ? "\u2713" : "" }),
      el("span.lattice-ms-muted", { text: ctx.i18n.t("filters.all") })
    ]);
    allRow.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pick2(null);
    });
    list.appendChild(allRow);
    const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
    for (const o of shown) {
      const on = value === o.value;
      const row = el("div.lattice-ms-option", { class: on ? "is-selected" : "" }, [
        el("span.lattice-ms-check", { text: on ? "\u2713" : "" }),
        el("span", { text: o.label })
      ]);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick2(o.value);
      });
      list.appendChild(row);
    }
  }
  control.addEventListener("mousedown", (e) => {
    e.preventDefault();
    panel ? close() : open();
  });
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      panel ? close() : open();
    }
    if (e.key === "Escape") close();
  });
  fetchOptions(column, ctx).then((opts) => {
    options = opts;
    renderText();
    if (panel) renderPanelList(panel._list, panel._search.value);
  });
  renderText();
  return control;
}
registerFilter("multiselect", {
  build(column, ctx) {
    return buildMultiselect(column, ctx);
  },
  isEmpty: (v) => !Array.isArray(v) || v.length === 0,
  match(value, cell) {
    const set = value.map(norm);
    return set.includes(norm(cell));
  },
  toServer: (field2, value) => [{ field: field2, type: "in", value }]
});
function buildMultiselect(column, ctx) {
  let selected = Array.isArray(ctx.value) ? ctx.value.map(String) : [];
  let options = [];
  let panel = null;
  let closePanel = null;
  const control = el("div.lattice-ms", { tabindex: "0" });
  const chips = el("div.lattice-ms-chips");
  const caret = el("span.lattice-ms-caret", { html: CARET_SVG });
  control.append(chips, caret);
  const labelFor = (v) => {
    const o = options.find((o2) => o2.value === v);
    return o ? o.label : v;
  };
  function fire() {
    ctx.onChange(selected.length ? selected.slice() : null);
  }
  function renderChips() {
    clear(chips);
    if (selected.length === 0) {
      chips.appendChild(el("span.lattice-ms-placeholder", { text: ctx.i18n.t("filters.all") }));
      return;
    }
    for (const v of selected) {
      const chip = el("span.lattice-ms-chip", {}, [
        el("span.lattice-ms-chip-label", { text: labelFor(v) }),
        el("span.lattice-ms-chip-x", {
          text: "\xD7",
          on: { mousedown: (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(v);
          } }
        })
      ]);
      chips.appendChild(chip);
    }
    scheduleFit();
  }
  let fitScheduled = false;
  function scheduleFit() {
    if (fitScheduled) return;
    fitScheduled = true;
    requestAnimationFrame(() => {
      fitScheduled = false;
      if (chips.isConnected) fitChipsToTwoRows();
    });
  }
  function fitChipsToTwoRows() {
    const old = chips.querySelector(".lattice-ms-more");
    if (old) old.remove();
    const chipEls = [...chips.querySelectorAll(".lattice-ms-chip")];
    for (const c of chipEls) c.style.display = "";
    if (chipEls.length === 0) return;
    const rowH = chipEls[0].offsetHeight || 18;
    const twoRowsBottom = chipEls[0].offsetTop + rowH + rowH * 0.5;
    const hiddenLabels = [];
    for (const c of chipEls) {
      if (c.offsetTop > twoRowsBottom) {
        c.style.display = "none";
        hiddenLabels.push(c.textContent.replace(/×$/, ""));
      }
    }
    if (hiddenLabels.length === 0) return;
    const more = el("span.lattice-ms-chip.lattice-ms-more");
    chips.appendChild(more);
    const setMore = () => {
      more.textContent = "+" + hiddenLabels.length;
      more.title = hiddenLabels.join(", ");
    };
    setMore();
    let guard = 0;
    while (more.offsetTop > twoRowsBottom && guard < chipEls.length) {
      const visible = chipEls.filter((c) => c.style.display !== "none");
      if (!visible.length) break;
      const last = visible[visible.length - 1];
      last.style.display = "none";
      hiddenLabels.push(last.textContent.replace(/×$/, ""));
      setMore();
      guard++;
    }
  }
  function toggle(v) {
    v = String(v);
    if (selected.includes(v)) selected = selected.filter((x) => x !== v);
    else selected = [...selected, v];
    renderChips();
    if (panel) renderPanelList(panel._list, panel._search.value);
    fire();
  }
  function open() {
    if (panel) return;
    panel = el("div.lattice-ms-panel");
    const search = el("input.lattice-ms-search", { type: "text", placeholder: ctx.i18n.t("filters.search") });
    const list = el("div.lattice-ms-list");
    panel._search = search;
    panel._list = list;
    search.addEventListener("input", () => renderPanelList(list, search.value));
    panel.append(search, list);
    document.body.appendChild(panel);
    positionPanel(panel, control);
    renderPanelList(list, "");
    control.classList.add("is-open");
    closePanel = onOutside(panel, (e) => {
      if (!control.contains(e.target)) close();
    });
    search.focus();
  }
  function close() {
    closePanel?.();
    panel?.remove();
    panel = null;
    closePanel = null;
    control.classList.remove("is-open");
  }
  function renderPanelList(list, q) {
    clear(list);
    const needle = (q || "").trim().toLowerCase();
    const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
    if (shown.length === 0) {
      list.appendChild(el("div.lattice-ms-empty", { text: ctx.i18n.t("empty") }));
      return;
    }
    for (const o of shown) {
      const on = selected.includes(o.value);
      const row = el("div.lattice-ms-option", { class: on ? "is-selected" : "" }, [
        el("span.lattice-ms-check", { text: on ? "\u2713" : "" }),
        el("span", { text: o.label })
      ]);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        toggle(o.value);
      });
      list.appendChild(row);
    }
  }
  control.addEventListener("mousedown", (e) => {
    if (e.target.closest(".lattice-ms-chip-x")) return;
    e.preventDefault();
    panel ? close() : open();
  });
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      panel ? close() : open();
    }
    if (e.key === "Escape") close();
  });
  fetchOptions(column, ctx).then((opts) => {
    options = opts;
    renderChips();
    if (panel) renderPanelList(panel._list, panel._search.value);
  });
  renderChips();
  return control;
}
function positionPanel(panel, control) {
  const r = control.getBoundingClientRect();
  panel.style.position = "absolute";
  panel.style.top = window.scrollY + r.bottom + 2 + "px";
  panel.style.left = window.scrollX + r.left + "px";
  panel.style.minWidth = r.width + "px";
}
var CARET_SVG = '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path fill="currentColor" d="M0 0l5 6 5-6z"/></svg>';
registerFilter("boolean", {
  build(column, ctx) {
    const select = el("select.lattice-filter-input", {}, [
      el("option", { value: "", text: ctx.i18n.t("filters.all") }),
      el("option", { value: "true", text: ctx.i18n.t("filters.yes") }),
      el("option", { value: "false", text: ctx.i18n.t("filters.no") })
    ]);
    if (ctx.value != null) select.value = ctx.value;
    select.addEventListener("change", () => ctx.onChange(select.value || null));
    return select;
  },
  isEmpty: (v) => v == null || v === "",
  match(value, cell) {
    const truthy = cell === true || cell === 1 || cell === "1" || cell === "true";
    return value === "true" ? truthy : !truthy;
  },
  toServer: (field2, value) => [{ field: field2, type: "=", value: value === "true" }]
});

// src/filters/advancedEval.js
var ADV_OPS = ["eq", "neq", "contains", "ncontains", "starts", "ends", "gt", "gte", "lt", "lte", "in", "nin", "empty", "nempty"];
function isGroup(r) {
  return r != null && Array.isArray(r.rules);
}
function isEmptyTree(group) {
  if (!isGroup(group)) return true;
  return group.rules.every((r) => isGroup(r) ? isEmptyTree(r) : !r || !r.op);
}
function evalGroup(group, row) {
  if (!isGroup(group) || group.rules.length === 0) return true;
  const results = group.rules.map((r) => isGroup(r) ? evalGroup(r, row) : evalCondition(r, row));
  return group.combinator === "OR" ? results.some(Boolean) : results.every(Boolean);
}
function evalCondition(c, row) {
  if (!c || !c.op) return true;
  const raw = row[c.field];
  const s = norm2(raw);
  const v = c.value;
  switch (c.op) {
    case "empty":
      return raw == null || raw === "";
    case "nempty":
      return !(raw == null || raw === "");
    case "eq":
      return s === norm2(v);
    case "neq":
      return s !== norm2(v);
    case "contains":
      return s.includes(norm2(v));
    case "ncontains":
      return !s.includes(norm2(v));
    case "starts":
      return s.startsWith(norm2(v));
    case "ends":
      return s.endsWith(norm2(v));
    case "gt":
      return cmp(raw, v) > 0;
    case "gte":
      return cmp(raw, v) >= 0;
    case "lt":
      return cmp(raw, v) < 0;
    case "lte":
      return cmp(raw, v) <= 0;
    case "in":
      return splitList(v).map(norm2).includes(s);
    case "nin":
      return !splitList(v).map(norm2).includes(s);
    default:
      return true;
  }
}
function norm2(v) {
  return String(v ?? "").toLowerCase().trim();
}
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function day(v) {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  if (typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}
function cmp(a, b) {
  const na = num(a), nb = num(b);
  if (na != null && nb != null) return na - nb;
  const da = day(a), db = day(b);
  if (da != null && db != null) return da - db;
  return norm2(a).localeCompare(norm2(b), void 0, { numeric: true });
}
function splitList(v) {
  if (Array.isArray(v)) return v;
  return String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

// src/core/DataSource.js
var COLLATOR = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
var ClientData = class {
  constructor(data = []) {
    this.data = Array.isArray(data) ? data.slice() : [];
    this._searchCache = /* @__PURE__ */ new WeakMap();
    this._searchSig = "";
  }
  setData(data) {
    this.data = Array.isArray(data) ? data.slice() : [];
    this._filtered = null;
    this._searchCache = /* @__PURE__ */ new WeakMap();
  }
  /** Celá filtrovaná+seřazená sada (pro souhrn nad všemi řádky). */
  allRows() {
    return this._filtered || this.data;
  }
  /* ---- granulární mutace (pro grid.addRow/updateRow/deleteRow/updateData) ---- */
  addRow(row, atStart = false) {
    if (atStart) this.data.unshift(row);
    else this.data.push(row);
    this._filtered = null;
    return row;
  }
  /** Najde řádek dle keyField (porovnání odolné na number vs string) a sloučí patch. */
  updateRow(keyField, key, patch) {
    const k = String(key);
    const r = this.data.find((x) => x && String(x[keyField]) === k);
    if (r) {
      Object.assign(r, patch);
      this._filtered = null;
      this._searchCache.delete(r);
    }
    return r || null;
  }
  deleteRow(keyField, key) {
    const k = String(key);
    const i = this.data.findIndex((x) => x && String(x[keyField]) === k);
    if (i >= 0) {
      this.data.splice(i, 1);
      this._filtered = null;
      return true;
    }
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
    if (to < 0) {
      this.data.splice(from, 0, moved);
      return null;
    }
    this.data.splice(zone === "after" ? to + 1 : to, 0, moved);
    this._filtered = null;
    if (orderField) {
      const changed = [];
      this.data.forEach((r, i) => {
        if (r[orderField] !== i + 1) {
          r[orderField] = i + 1;
          changed.push(r);
        }
      });
      return changed;
    }
    return [moved];
  }
  /** Hromadný upsert dle keyField: existující sloučí, nové přidá. Vrací dotčené řádky. */
  upsertMany(keyField, rows) {
    const index = /* @__PURE__ */ new Map();
    this.data.forEach((r, i) => {
      if (r) index.set(String(r[keyField]), i);
    });
    const affected = [];
    for (const row of rows) {
      const k = row != null ? String(row[keyField]) : null;
      if (k != null && index.has(k)) {
        const t = this.data[index.get(k)];
        Object.assign(t, row);
        affected.push(t);
      } else if (row != null) {
        index.set(k, this.data.push(row) - 1);
        affected.push(row);
      }
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
    this._filtered = rows;
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
    this._searchSig = cols.map((c) => c.field).join(",");
    this._searchCache = /* @__PURE__ */ new WeakMap();
    for (const row of this.data) {
      this._searchCache.set(row, cols.map((c) => norm3(cellValue(row, c))).join(""));
    }
  }
  _quickSearch(rows, search, columns) {
    const needle = norm3(search).trim();
    if (!needle) return rows;
    const cols = (columns || []).filter(searchableCol);
    const sig = cols.map((c) => c.field).join(",");
    if (sig !== this._searchSig) {
      this._searchCache = /* @__PURE__ */ new WeakMap();
      this._searchSig = sig;
    }
    const cache = this._searchCache;
    return rows.filter((row) => {
      let text = cache.get(row);
      if (text === void 0) {
        text = cols.map((c) => norm3(cellValue(row, c))).join("");
        cache.set(row, text);
      }
      return text.includes(needle);
    });
  }
};
function searchableCol(c) {
  return c && c.field && c.visible !== false && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._rowsum;
}
function rowMatches(row, { filters, search, columns, universal, advanced } = {}) {
  const colByField = indexColumns(columns);
  for (const [field2, value] of Object.entries(filters || {})) {
    const col = colByField.get(field2);
    if (!col || !col.filter) continue;
    const def = getFilter(col.filter);
    if (!def || def.isEmpty(value)) continue;
    if (!def.match(value, cellValue(row, col), row, col)) return false;
  }
  if (universal && universal.field && !evalCondition(universal, row)) return false;
  if (advanced && !isEmptyTree(advanced) && !evalGroup(advanced, row)) return false;
  if (search && String(search).trim()) {
    const needle = norm3(search).trim();
    const text = (columns || []).filter(searchableCol).map((c) => norm3(cellValue(row, c))).join("");
    if (!text.includes(needle)) return false;
  }
  return true;
}
function indexColumns(columns) {
  const m = /* @__PURE__ */ new Map();
  for (const c of columns || []) m.set(c.field, c);
  return m;
}
function norm3(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function applyFilters(rows, filters, colByField) {
  const active = [];
  for (const [field2, value] of Object.entries(filters || {})) {
    const col = colByField.get(field2);
    if (!col || !col.filter) continue;
    const def = getFilter(col.filter);
    if (!def || def.isEmpty(value)) continue;
    active.push({ field: field2, value, def, col });
  }
  if (!active.length) return rows;
  return rows.filter(
    (row) => active.every(({ value, def, col }) => def.match(value, cellValue(row, col), row, col))
  );
}
function sortKind(type) {
  if (type === "number" || type === "money" || type === "progress" || type === "rating") return "num";
  if (type === "date" || type === "datetime" || type === "time") return "date";
  if (type === "boolean") return "bool";
  return "text";
}
function applySort(rows, sort, colByField) {
  if (!sort || !sort.length) return rows;
  const specs = sort.map(({ field: field2, dir }) => {
    const col = colByField.get(field2) || { field: field2 };
    return { col, sign: dir === "desc" ? -1 : 1, kind: sortKind(col.type) };
  });
  const decorated = rows.map((row, i) => {
    const keys = specs.map((s) => {
      const v = cellValue(row, s.col);
      if (v == null || v === "") return null;
      if (s.kind === "num") return num2(v);
      if (s.kind === "date") return time(v);
      if (s.kind === "bool") return bool(v) ? 1 : 0;
      return String(v);
    });
    return { row, keys, i };
  });
  decorated.sort((A, B) => {
    for (let s = 0; s < specs.length; s++) {
      const a = A.keys[s], b = B.keys[s];
      let cmp2;
      if (a == null && b == null) cmp2 = 0;
      else if (a == null) cmp2 = -1;
      else if (b == null) cmp2 = 1;
      else if (typeof a === "number") cmp2 = a - b;
      else cmp2 = COLLATOR.compare(a, b);
      if (cmp2 !== 0) return specs[s].sign * cmp2;
    }
    return A.i - B.i;
  });
  return decorated.map((d) => d.row);
}
var num2 = (v) => Number(String(v).replace(/\s/g, "").replace(",", ".")) || 0;
var time = (v) => {
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
};
var bool = (v) => v === true || v === 1 || v === "1" || v === "true";
var ServerData = class {
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
    if (!ajax.url) throw new Error("Lattice ServerData: chyb\xED `ajax.url`.");
    this.ajax = ajax;
    this.names = Object.assign({ page: "page", size: "size", sort: "sort", filter: "filter" }, ajax.paramNames);
  }
  async query({ page, pageSize, paginate, sort, filters, universal, search, columns }) {
    const state = { page, pageSize, paginate, sort, filters, universal, search, columns };
    const params = this.ajax.requestBuilder ? this.ajax.requestBuilder(state) : this.buildParams(state);
    const method = (this.ajax.method || "GET").toUpperCase();
    let url = this.ajax.url;
    const init = { method, headers: Object.assign({}, this.ajax.headers) };
    if (method === "GET") {
      const qs = encodeParams(params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params);
    }
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Lattice: server vr\xE1til ${res.status}`);
    const json = await res.json();
    if (this.ajax.responseParser) return this.ajax.responseParser(json);
    return this.parseResponse(json, pageSize);
  }
  buildParams({ page, pageSize, paginate, sort, filters, universal, search, columns }) {
    const n = this.names;
    const params = Object.assign({}, this.ajax.params);
    if (search && String(search).trim()) params[n.search || "search"] = String(search).trim();
    if (paginate) {
      params[n.page] = page;
      params[n.size] = pageSize;
    }
    if (sort && sort.length) {
      params[n.sort] = sort.map((s) => ({ field: s.field, dir: s.dir }));
    }
    const flat = flattenFilters(filters, columns);
    if (universal && universal.field && String(universal.value ?? "") !== "") {
      flat.push({ field: universal.field, type: UNIVERSAL_SERVER_TYPE[universal.op] || universal.op, value: universal.value });
    }
    if (flat.length) params[n.filter] = flat;
    return params;
  }
  parseResponse(json, pageSize) {
    const data = Array.isArray(json) ? json : json.data || [];
    const total = json.total != null ? json.total : json.last_row != null ? json.last_row : data.length;
    const lastPage = json.last_page != null ? json.last_page : Math.max(1, Math.ceil(total / pageSize));
    return { rows: data, total, lastPage, lastRow: json.last_row != null ? json.last_row : total };
  }
};
var UNIVERSAL_SERVER_TYPE = { eq: "=", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=", contains: "like", ncontains: "!like" };
function flattenFilters(filters, columns) {
  const colByField = indexColumns(columns);
  const out = [];
  for (const [field2, value] of Object.entries(filters || {})) {
    const col = colByField.get(field2);
    if (!col || !col.filter) continue;
    const def = getFilter(col.filter);
    if (!def || def.isEmpty(value)) continue;
    out.push(...def.toServer(field2, value, col));
  }
  return out;
}
function encodeParams(obj) {
  const sp = new URLSearchParams();
  const add = (key, val) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => add(`${key}[${i}]`, v));
    } else if (typeof val === "object") {
      for (const [k, v] of Object.entries(val)) add(`${key}[${k}]`, v);
    } else {
      sp.append(key, val);
    }
  };
  for (const [k, v] of Object.entries(obj)) add(k, v);
  return sp;
}

// src/i18n/cs.js
var cs_default = {
  columns: {
    manage: "Sloupce",
    reset: "Obnovit v\xFDchoz\xED",
    filterToggle: "Zobrazit / skr\xFDt filtr",
    groupSet: "Skupina sloupce",
    noGroup: "Bez skupiny",
    newGroup: "Nov\xE1 skupina\u2026",
    ungroup: "Zru\u0161it skupinu",
    fitWidth: "P\u0159izp\u016Fsobit \u0161\xED\u0159ku sloupc\u016F obsahu",
    clearFilters: "Zru\u0161it v\u0161echny filtry",
    headerRotate: "Oto\u010Den\xED hlavi\u010Dky",
    rotateInherit: "Podle nastaven\xED tabulky",
    rotateNone: "Vodorovn\u011B",
    rotate90: "90\xB0",
    rotate270: "270\xB0",
    rowGroupToggle: "Seskupovat \u0159\xE1dky podle tohoto sloupce",
    summary: "Souhrn sloupce",
    summaryForColumns: "Pro sloupce (\u0159\xE1dek dole)",
    summaryForRows: "Pro \u0159\xE1dky (sloupec vpravo)",
    summaryMin: "Minimum",
    summaryMax: "Maximum",
    summarySum: "Sou\u010Det",
    summaryAvg: "Pr\u016Fm\u011Br",
    summaryCount: "Po\u010Det (nepr\xE1zdn\xFDch)"
  },
  summary: {
    scopePage: "Str\xE1nka",
    scopeAll: "V\u0161e",
    scopePageLong: "Zobrazen\xE1 str\xE1nka",
    scopeAllLong: "V\u0161echny z\xE1znamy",
    scopeToggle: "P\u0159epnout rozsah souhrnu (zobrazen\xE1 str\xE1nka / v\u0161echny z\xE1znamy)",
    barLabel: "Souhrn po\u010D\xEDt\xE1 z:",
    name: { sum: "Sou\u010Det", avg: "Pr\u016Fm\u011Br", min: "Minimum", max: "Maximum", count: "Po\u010Det" }
  },
  presets: {
    none: "(\u017E\xE1dn\xE9 ulo\u017Een\xE9 presety)",
    namePlaceholder: "N\xE1zev presetu\u2026",
    saveLocal: "Ulo\u017Eit preset (jen pro m\u011B)",
    saveGlobal: "Ulo\u017Eit glob\xE1ln\u011B (pro v\u0161echny)",
    searchColumn: "Hledat sloupec\u2026",
    global: "Glob\xE1ln\xED preset"
  },
  instance: {
    title: "Nastaven\xED tabulky",
    done: "Hotovo",
    saveGlobalDefaults: "Ulo\u017Eit jako v\xFDchoz\xED pro v\u0161echny",
    saveGlobalHint: "Ode\u0161le aktu\xE1ln\xED nastaven\xED tabulky aplikaci jako v\xFDchoz\xED pro v\u0161echny u\u017Eivatele (p\u0159ep\xED\u0161e i jejich ulo\u017Een\xE9 nastaven\xED).",
    saveGlobalDone: "Ulo\u017Eeno \u2713",
    gdAvailable: "Spr\xE1vce nastavil nov\xE9 v\xFDchoz\xED nastaven\xED tabulky.",
    gdReset: "P\u0159epsat moje \xFApravy v\xFDchoz\xEDm nastaven\xEDm od spr\xE1vce.",
    gdApply: "Pou\u017E\xEDt",
    gdKeepMine: "Ponechat moje",
    groupAppearance: "Vzhled",
    groupLayout: "Rozvr\u017Een\xED",
    groupPagination: "Str\xE1nkov\xE1n\xED a filtry",
    groupColumns: "Sloupce a \u0159\xE1dky",
    groupFormat: "Form\xE1t hodnot",
    groupCustom: "Vlastn\xED \xFApravy",
    cssHint: "P\u0159ep\xED\u0161\xED zvolen\xFD motiv jen pro tuto tabulku. Pr\xE1zdn\xE9 = dle motivu.",
    cssFontTable: "P\xEDsmo tabulky",
    cssFontHeader: "P\xEDsmo z\xE1hlav\xED",
    cssAccent: "Barva akcentu",
    cssLink: "Barva odkaz\u016F",
    cssText: "Barva textu",
    cssBorder: "Barva okraj\u016F",
    cssHeaderBg: "Pozad\xED z\xE1hlav\xED",
    cssRowEven: "Barva sud\xFDch \u0159\xE1dk\u016F",
    cssRowOdd: "Barva lich\xFDch \u0159\xE1dk\u016F",
    cssRowHover: "\u0158\xE1dek p\u0159i najet\xED",
    cssHeaderWeight: "Tu\u010Dnost z\xE1hlav\xED",
    cssRadius: "Zaoblen\xED (px)",
    cssCellPadY: "Padding bu\u0148ky \u2013 svisle (px)",
    cssCellPadX: "Padding bu\u0148ky \u2013 vodorovn\u011B (px)",
    cssReset: "Obnovit vlastn\xED \xFApravy",
    fontFamily: "P\xEDsmo",
    fontDefault: "Dle motivu",
    zebra: "Pruhovan\xE9 \u0159\xE1dky",
    scaleColors: "Barvy \u0161k\xE1ly (semafor)",
    wrapText: "Zalamovat text",
    linkNewTab: "Odkazy otev\xEDrat v nov\xE9 kart\u011B",
    emptyText: "N\xE1hrada pr\xE1zdn\xE9 bu\u0148ky",
    emptyTextPlaceholder: "nap\u0159. \u2014",
    pageSizeDefault: "V\xFDchoz\xED velikost str\xE1nky",
    fmtNumber: "\u010C\xEDsla",
    fmtMoney: "M\u011Bna",
    fmtDate: "Datum",
    fmtDatetime: "Datum a \u010Das",
    fmtTime: "\u010Cas",
    fmtDecimals: "Desetinn\xE1 m\xEDsta",
    fmtDecimalsAuto: "Automaticky",
    fmtThousands: "Odd\u011Blova\u010D tis\xEDc\u016F",
    fmtCurrency: "M\u011Bna (symbol)",
    fmtNegative: "Z\xE1porn\xE1 \u010D\xEDsla",
    fmtPattern: "Form\xE1t",
    fmtCustom: "Vlastn\xED vzor",
    locale: "Jazyk form\xE1tu (locale)",
    localeDefault: "Dle prohl\xED\u017Ee\u010De",
    defaultSort: "V\xFDchoz\xED \u0159azen\xED",
    sortNone: "Bez \u0159azen\xED",
    sortAscSuffix: "\u2191",
    sortDescSuffix: "\u2193",
    negMinus: "Se znam\xE9nkem \u2212",
    negRed: "\u010Cerven\u011B",
    negParen: "V z\xE1vork\xE1ch",
    negRedParen: "\u010Cerven\u011B v z\xE1vork\xE1ch",
    colFormatTitle: "Form\xE1t sloupce",
    colFormatGlobal: "Podle tabulky (glob\xE1ln\xED)",
    colFormatCustom: "Vlastn\xED form\xE1t",
    condScale: "Barevn\xE1 \u0161k\xE1la (semafor)",
    condScaleOn: "Zapnout",
    condLevels: "Po\u010Det hladin",
    condReverse: "Obr\xE1cen\u011B (n\xEDzk\xE9 = zelen\xE9)",
    condApply: "Obarvit",
    condApplyBg: "Pozad\xED (semafor)",
    condApplyText: "Text (\u010D\xEDsla)",
    condThresholds: "Prahy",
    theme: "Vzhled",
    themeDefault: "V\xFDchoz\xED",
    themeAuto: "Automaticky (dle syst\xE9mu)",
    themeMinimal: "Minimalistick\xFD",
    themeCompact: "Kompaktn\xED",
    themeSlate: "Tmav\xFD",
    themeOcean: "Oce\xE1n",
    themeWarm: "Tepl\xFD",
    themeContrast: "Vysok\xFD kontrast",
    themeBootstrap5: "Bootstrap 5",
    themeTailwind: "Tailwind",
    themeMaterial: "Material",
    pagination: "Str\xE1nkov\xE1n\xED",
    paginationHeader: "V z\xE1hlav\xED",
    paginationFooter: "V z\xE1pat\xED",
    paginationBoth: "Na obou m\xEDstech",
    paginationNone: "Bez str\xE1nkov\xE1n\xED",
    density: "Hustota \u0159\xE1dk\u016F",
    comfortable: "Pohodln\xE1",
    compact: "Kompaktn\xED",
    layout: "Rozlo\u017Een\xED",
    fit: "Rozt\xE1hnout do \u0161\xED\u0159ky",
    fitData: "Dle obsahu",
    fitDataFill: "Dle obsahu (vyplnit \u0161\xED\u0159ku)",
    fitDataStretch: "Dle obsahu (posledn\xED rozt\xE1hnout)",
    fitColumns: "Rozt\xE1hnout do \u0161\xED\u0159ky (propor\u010Dn\u011B)",
    resizeMode: "Zm\u011Bna \u0161\xED\u0159ky sloupc\u016F",
    resizeNative: "\u017Div\u011B (nativn\u011B)",
    resizeGuide: "S vodic\xED \u010D\xE1rou",
    fontSize: "Velikost p\xEDsma",
    filterLayout: "Um\xEDst\u011Bn\xED filtr\u016F",
    filterInHeader: "V z\xE1hlav\xED sloupc\u016F",
    filterExternal: "Nad tabulkou",
    filterUniversal: "Univerz\xE1ln\xED (jeden filtr)",
    filterOff: "Vypnut\xE9",
    rowNumbers: "\u010C\xEDslov\xE1n\xED \u0159\xE1dk\u016F",
    rowNumbersNone: "Vypnut\xE9",
    rowNumbersContinuous: "Pr\u016Fb\u011B\u017En\xE9 (p\u0159es str\xE1nky)",
    rowNumbersPerPage: "Od 1 na ka\u017Ed\xE9 str\xE1nce",
    headerRotate: "Oto\u010Den\xED hlavi\u010Dek",
    headerRotateNone: "Vodorovn\u011B",
    headerRotate90: "90\xB0",
    headerRotate270: "270\xB0",
    summaryRow: "Souhrnn\xFD \u0159\xE1dek",
    summaryNone: "Vypnut\xFD",
    summaryPage: "Zobrazen\xE1 str\xE1nka",
    summaryAll: "V\u0161echny z\xE1znamy",
    groupSubtotals: "Mezisou\u010Dty skupin",
    rowGroup: "Seskupen\xED \u0159\xE1dk\u016F",
    rowGroupNone: "Bez seskupen\xED",
    selectColumn: "Sloupec s v\xFDb\u011Brem",
    selectTrigger: "Vyb\xEDrat",
    selectByCheckbox: "Kliknut\xEDm na checkbox",
    selectByRow: "Kliknut\xEDm na \u0159\xE1dek",
    actionsLayout: "Sloupec akc\xED",
    actionsAsColumn: "Posledn\xED sloupec (ikony)",
    actionsAsMenu: "Menu \u22EE v \u010D\xEDslov\xE1n\xED"
  },
  filterTypes: {
    change: "Zm\u011Bnit typ filtru",
    text: "Text",
    number: "\u010C\xEDslo (=, >, <)",
    "number-range": "Rozsah (Od\u2013Do)",
    "date-range": "Datum (rozsah)",
    "date-two": "Datum (Od / Do)",
    select: "V\xFDb\u011Br",
    multiselect: "V\xEDce hodnot",
    boolean: "Ano / Ne"
  },
  filters: {
    all: "V\u0161e",
    yes: "Ano",
    no: "Ne",
    from: "Od",
    to: "Do",
    search: "Hledat\u2026",
    quickSearch: "Hledat ve v\u0161em\u2026",
    clear: "Zru\u0161it filtry",
    clearOne: "Vy\u010Distit filtr",
    negateHint: "Prefix ! = neobsahuje",
    panelTitle: "Filtry",
    hidePanel: "Skr\xFDt filtry",
    showPanel: "Zobrazit filtry",
    activeCount: "{n} aktivn\xEDch"
  },
  dateRange: {
    placeholder: "Obdob\xED\u2026",
    apply: "Pou\u017E\xEDt",
    cancel: "Zru\u0161it",
    clear: "Zru\u0161it filtr",
    custom: "Vlastn\xED obdob\xED",
    presets: {
      today: "Dnes",
      yesterday: "V\u010Dera",
      weekToDate: "Tento t\xFDden do dne\u0161ka",
      thisWeek: "Tento t\xFDden",
      lastWeek: "Minul\xFD t\xFDden",
      last7: "Posledn\xEDch 7 dn\xED",
      last30: "Posledn\xEDch 30 dn\xED",
      monthToDate: "Tento m\u011Bs\xEDc do dne\u0161ka",
      thisMonth: "Tento m\u011Bs\xEDc",
      lastMonth: "Minul\xFD m\u011Bs\xEDc",
      thisQuarter: "Tento kvart\xE1l",
      nextMonth: "P\u0159\xED\u0161t\xED m\u011Bs\xEDc",
      next3Months: "P\u0159\xED\u0161t\xED 3 m\u011Bs\xEDce"
    },
    months: ["Leden", "\xDAnor", "B\u0159ezen", "Duben", "Kv\u011Bten", "\u010Cerven", "\u010Cervenec", "Srpen", "Z\xE1\u0159\xED", "\u0158\xEDjen", "Listopad", "Prosinec"],
    monthsShort: ["led", "\xFAno", "b\u0159e", "dub", "kv\u011B", "\u010Dvn", "\u010Dvc", "srp", "z\xE1\u0159", "\u0159\xEDj", "lis", "pro"],
    weekdays: ["Po", "\xDAt", "St", "\u010Ct", "P\xE1", "So", "Ne"],
    weekdaysLong: ["pond\u011Bl\xED", "\xFAter\xFD", "st\u0159eda", "\u010Dtvrtek", "p\xE1tek", "sobota", "ned\u011Ble"]
  },
  pagination: {
    first: "\xAB",
    prev: "\u2039",
    next: "\u203A",
    last: "\xBB",
    firstTitle: "Prvn\xED",
    prevTitle: "P\u0159edchoz\xED",
    nextTitle: "Dal\u0161\xED",
    lastTitle: "Posledn\xED",
    pageSize: "Velikost str\xE1nky",
    all: "V\u0161e",
    showing: "Zobrazeno {from}-{to} z {total} \u0159\xE1dk\u016F",
    empty: "\u017D\xE1dn\xE9 z\xE1znamy",
    pageLabel: "Strana",
    gotoTitle: "P\u0159ej\xEDt na str\xE1nku"
  },
  advanced: {
    title: "Roz\u0161\xED\u0159en\xFD filtr",
    savedPlaceholder: "\u2014 ulo\u017Een\xE9 filtry \u2014",
    namePlaceholder: "N\xE1zev filtru\u2026",
    valuePlaceholder: "hodnota",
    addCondition: "Podm\xEDnka",
    addGroup: "Skupina",
    and: "A z\xE1rove\u0148 (v\u0161e)",
    or: "Nebo (aspo\u0148 jedno)",
    apply: "Pou\u017E\xEDt",
    clear: "Vymazat filtr",
    save: "Ulo\u017Eit",
    remove: "Odebrat",
    delete: "Smazat ulo\u017Een\xFD filtr",
    ops: {
      eq: "rovn\xE1 se",
      neq: "nerovn\xE1 se",
      contains: "obsahuje",
      ncontains: "neobsahuje",
      starts: "za\u010D\xEDn\xE1 na",
      ends: "kon\u010D\xED na",
      gt: "> v\u011Bt\u0161\xED ne\u017E",
      gte: "\u2265 v\u011Bt\u0161\xED nebo rovno",
      lt: "< men\u0161\xED ne\u017E",
      lte: "\u2264 men\u0161\xED nebo rovno",
      in: "je jeden z (a, b, c)",
      nin: "nen\xED \u017E\xE1dn\xFD z (a, b, c)",
      empty: "je pr\xE1zdn\xE9",
      nempty: "nen\xED pr\xE1zdn\xE9"
    }
  },
  universal: { field: "Pole", type: "Typ", valueLabel: "Hodnota", value: "hodnota k filtrov\xE1n\xED\u2026", clear: "Zru\u0161it filtr" },
  group: { empty: "(pr\xE1zdn\xE9)" },
  select: { scopePage: "Str\xE1nka", scopeAll: "V\u0161echny z\xE1znamy ({n})", invert: "Invertovat v\xFDb\u011Br", none: "Zru\u0161it v\xFDb\u011Br", menu: "Rozsah a mo\u017Enosti v\xFDb\u011Bru" },
  move: { drag: "P\u0159et\xE1hnout \u0159\xE1dek" },
  actions: { title: "Akce", view: "Zobrazit", edit: "Upravit", delete: "Smazat" },
  tree: { collapseAll: "Sbalit v\u0161e", expandAll: "Rozbalit v\u0161e", level: "\xDArove\u0148", levelUp: "Rozbalit dal\u0161\xED \xFArove\u0148", levelDown: "Sbalit o \xFArove\u0148" },
  popup: { info: "Zobrazit info" },
  history: { undo: "Zp\u011Bt", redo: "Znovu", clear: "Vymazat historii" },
  menu: {
    column: "Menu sloupce",
    sortAsc: "Se\u0159adit vzestupn\u011B",
    sortDesc: "Se\u0159adit sestupn\u011B",
    sortClear: "Zru\u0161it \u0159azen\xED",
    hide: "Skr\xFDt sloupec",
    pinLeft: "Ukotvit vlevo",
    pinRight: "Ukotvit vpravo",
    unpin: "Zru\u0161it ukotven\xED",
    groupBy: "Seskupit podle tohoto",
    ungroup: "Zru\u0161it seskupen\xED",
    fitWidth: "P\u0159izp\u016Fsobit \u0161\xED\u0159ku",
    row: "Menu \u0159\xE1dku",
    sortMulti: "Klik = \u0159adit \xB7 Shift+klik = v\xEDce\xFArov\u0148ov\xE9"
  },
  progressive: { loaded: "Na\u010Dteno {loaded} z {total}", loadMore: "Na\u010D\xEDst dal\u0161\xED ({n})", loading: "Na\u010D\xEDt\xE1m\u2026", allLoaded: "V\u0161e na\u010Dteno" },
  edit: { hint: "Dvojklik pro \xFApravu" },
  detail: { toggle: "Zobrazit / skr\xFDt detail" },
  selection: { count: "Vybr\xE1no: {n}", clear: "Zru\u0161it v\xFDb\u011Br" },
  range: { cells: "{n} bun\u011Bk", sum: "Sou\u010Det", avg: "Pr\u016Fm\u011Br", min: "Min", max: "Max", fill: "T\xE1hni pro vypln\u011Bn\xED" },
  validate: { required: "Povinn\xE9 pole", invalid: "Neplatn\xE1 hodnota", pattern: "Nespr\xE1vn\xFD form\xE1t", min: "Mus\xED b\xFDt \u2265 {n}", max: "Mus\xED b\xFDt \u2264 {n}", minLen: "Nejm\xE9n\u011B {n} znak\u016F", maxLen: "Nejv\xEDce {n} znak\u016F" },
  empty: "\u017D\xE1dn\xE1 data",
  loading: "Na\u010D\xEDt\xE1n\xED\u2026",
  error: "Chyba na\u010Dten\xED dat"
};

// src/i18n/en.js
var en_default = {
  columns: {
    manage: "Columns",
    reset: "Reset to default",
    filterToggle: "Show / hide filter",
    groupSet: "Column group",
    noGroup: "No group",
    newGroup: "New group\u2026",
    ungroup: "Dissolve group",
    fitWidth: "Fit column widths to content",
    clearFilters: "Clear all filters",
    headerRotate: "Header rotation",
    rotateInherit: "Follow table setting",
    rotateNone: "Horizontal",
    rotate90: "90\xB0",
    rotate270: "270\xB0",
    rowGroupToggle: "Group rows by this column",
    summary: "Column summary",
    summaryForColumns: "For columns (bottom row)",
    summaryForRows: "For rows (right column)",
    summaryMin: "Minimum",
    summaryMax: "Maximum",
    summarySum: "Sum",
    summaryAvg: "Average",
    summaryCount: "Count (non-empty)"
  },
  summary: {
    scopePage: "Page",
    scopeAll: "All",
    scopePageLong: "Displayed page",
    scopeAllLong: "All records",
    scopeToggle: "Toggle summary scope (displayed page / all records)",
    barLabel: "Summary from:",
    name: { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum", count: "Count" }
  },
  presets: {
    none: "(no saved presets)",
    namePlaceholder: "Preset name\u2026",
    saveLocal: "Save preset (only me)",
    saveGlobal: "Save globally (everyone)",
    searchColumn: "Search column\u2026",
    global: "Global preset"
  },
  instance: {
    title: "Table settings",
    done: "Done",
    saveGlobalDefaults: "Set as default for everyone",
    saveGlobalHint: "Sends the current table settings to the app as the default for all users (overrides their saved settings too).",
    saveGlobalDone: "Saved \u2713",
    gdAvailable: "Your admin set new default table settings.",
    gdReset: "Reset your changes to the admin default settings.",
    gdApply: "Apply",
    gdKeepMine: "Keep mine",
    groupAppearance: "Appearance",
    groupLayout: "Layout",
    groupPagination: "Pagination & filters",
    groupColumns: "Columns & rows",
    groupFormat: "Value format",
    groupCustom: "Custom tweaks",
    cssHint: "Override the chosen theme for this table only. Empty = follow theme.",
    cssFontTable: "Table font",
    cssFontHeader: "Header font",
    cssAccent: "Accent color",
    cssLink: "Link color",
    cssText: "Text color",
    cssBorder: "Border color",
    cssHeaderBg: "Header background",
    cssRowEven: "Even row color",
    cssRowOdd: "Odd row color",
    cssRowHover: "Row hover",
    cssHeaderWeight: "Header weight",
    cssRadius: "Corner radius (px)",
    cssCellPadY: "Cell padding \u2013 vertical (px)",
    cssCellPadX: "Cell padding \u2013 horizontal (px)",
    cssReset: "Reset custom tweaks",
    fontFamily: "Font",
    fontDefault: "Theme default",
    zebra: "Zebra rows",
    scaleColors: "Scale colors (traffic light)",
    wrapText: "Wrap text",
    linkNewTab: "Open links in new tab",
    emptyText: "Empty cell placeholder",
    emptyTextPlaceholder: "e.g. \u2014",
    pageSizeDefault: "Default page size",
    fmtNumber: "Numbers",
    fmtMoney: "Currency",
    fmtDate: "Date",
    fmtDatetime: "Date & time",
    fmtTime: "Time",
    fmtDecimals: "Decimal places",
    fmtDecimalsAuto: "Automatic",
    fmtThousands: "Thousands separator",
    fmtCurrency: "Currency (symbol)",
    fmtNegative: "Negative numbers",
    fmtPattern: "Format",
    fmtCustom: "Custom pattern",
    locale: "Format language (locale)",
    localeDefault: "Browser default",
    defaultSort: "Default sort",
    sortNone: "No sorting",
    sortAscSuffix: "\u2191",
    sortDescSuffix: "\u2193",
    negMinus: "With \u2212 sign",
    negRed: "Red",
    negParen: "In parentheses",
    negRedParen: "Red in parentheses",
    colFormatTitle: "Column format",
    colFormatGlobal: "Follow table (global)",
    colFormatCustom: "Custom format",
    condScale: "Color scale (traffic light)",
    condScaleOn: "Enable",
    condLevels: "Levels",
    condReverse: "Reversed (low = green)",
    condApply: "Apply to",
    condApplyBg: "Background (traffic light)",
    condApplyText: "Text (numbers)",
    condThresholds: "Thresholds",
    theme: "Theme",
    themeDefault: "Default",
    themeAuto: "Automatic (system)",
    themeMinimal: "Minimal",
    themeCompact: "Compact",
    themeSlate: "Dark",
    themeOcean: "Ocean",
    themeWarm: "Warm",
    themeContrast: "High contrast",
    themeBootstrap5: "Bootstrap 5",
    themeTailwind: "Tailwind",
    themeMaterial: "Material",
    pagination: "Pagination",
    paginationHeader: "In header",
    paginationFooter: "In footer",
    paginationBoth: "Both places",
    paginationNone: "No pagination",
    density: "Row density",
    comfortable: "Comfortable",
    compact: "Compact",
    layout: "Layout",
    fit: "Stretch to width",
    fitData: "Fit to data",
    fitDataFill: "Fit to data (fill width)",
    fitDataStretch: "Fit to data (stretch last)",
    fitColumns: "Fit columns (stretch proportionally)",
    resizeMode: "Column resize",
    resizeNative: "Live (native)",
    resizeGuide: "With guide line",
    fontSize: "Font size",
    filterLayout: "Filters position",
    filterInHeader: "In column headers",
    filterExternal: "Above the table",
    filterUniversal: "Universal (single filter)",
    filterOff: "Off",
    rowNumbers: "Row numbers",
    rowNumbersNone: "Off",
    rowNumbersContinuous: "Continuous (across pages)",
    rowNumbersPerPage: "From 1 on each page",
    headerRotate: "Header rotation",
    headerRotateNone: "Horizontal",
    headerRotate90: "90\xB0",
    headerRotate270: "270\xB0",
    summaryRow: "Summary row",
    summaryNone: "Off",
    summaryPage: "Displayed page",
    summaryAll: "All records",
    groupSubtotals: "Group subtotals",
    rowGroup: "Row grouping",
    rowGroupNone: "No grouping",
    selectColumn: "Selection column",
    selectTrigger: "Select by",
    selectByCheckbox: "Clicking the checkbox",
    selectByRow: "Clicking the row",
    actionsLayout: "Actions column",
    actionsAsColumn: "Last column (icons)",
    actionsAsMenu: "Menu \u22EE in row numbers"
  },
  filterTypes: {
    change: "Change filter type",
    text: "Text",
    number: "Number (=, >, <)",
    "number-range": "Range (from\u2013to)",
    "date-range": "Date (range)",
    "date-two": "Date (from / to)",
    select: "Select",
    multiselect: "Multi-select",
    boolean: "Yes / No"
  },
  filters: {
    all: "All",
    yes: "Yes",
    no: "No",
    from: "From",
    to: "To",
    search: "Search\u2026",
    quickSearch: "Search all\u2026",
    clear: "Clear filters",
    clearOne: "Clear filter",
    negateHint: "Prefix ! = does not contain",
    panelTitle: "Filters",
    hidePanel: "Hide filters",
    showPanel: "Show filters",
    activeCount: "{n} active"
  },
  dateRange: {
    placeholder: "Period\u2026",
    apply: "Apply",
    cancel: "Cancel",
    clear: "Clear filter",
    custom: "Custom range",
    presets: {
      today: "Today",
      yesterday: "Yesterday",
      weekToDate: "Week to date",
      thisWeek: "This week",
      lastWeek: "Last week",
      last7: "Last 7 days",
      last30: "Last 30 days",
      monthToDate: "Month to date",
      thisMonth: "This month",
      lastMonth: "Last month",
      thisQuarter: "This quarter",
      nextMonth: "Next month",
      next3Months: "Next 3 months"
    },
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    weekdaysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  },
  pagination: {
    first: "\xAB",
    prev: "\u2039",
    next: "\u203A",
    last: "\xBB",
    firstTitle: "First",
    prevTitle: "Previous",
    nextTitle: "Next",
    lastTitle: "Last",
    pageSize: "Page size",
    all: "All",
    showing: "Showing {from}-{to} of {total} rows",
    empty: "No rows",
    pageLabel: "Page",
    gotoTitle: "Go to page"
  },
  advanced: {
    title: "Advanced filter",
    savedPlaceholder: "\u2014 saved filters \u2014",
    namePlaceholder: "Filter name\u2026",
    valuePlaceholder: "value",
    addCondition: "Condition",
    addGroup: "Group",
    and: "And (all)",
    or: "Or (any)",
    apply: "Apply",
    clear: "Clear filter",
    save: "Save",
    remove: "Remove",
    delete: "Delete saved filter",
    ops: {
      eq: "equals",
      neq: "not equals",
      contains: "contains",
      ncontains: "does not contain",
      starts: "starts with",
      ends: "ends with",
      gt: "> greater than",
      gte: "\u2265 greater or equal",
      lt: "< less than",
      lte: "\u2264 less or equal",
      in: "is one of (a, b, c)",
      nin: "is none of (a, b, c)",
      empty: "is empty",
      nempty: "is not empty"
    }
  },
  universal: { field: "Field", type: "Type", valueLabel: "Value", value: "value to filter\u2026", clear: "Clear filter" },
  group: { empty: "(empty)" },
  select: { scopePage: "Page", scopeAll: "All records ({n})", invert: "Invert selection", none: "Clear selection", menu: "Selection scope & options" },
  move: { drag: "Drag to reorder" },
  actions: { title: "Actions", view: "View", edit: "Edit", delete: "Delete" },
  tree: { collapseAll: "Collapse all", expandAll: "Expand all", level: "Level", levelUp: "Expand one more level", levelDown: "Collapse one level" },
  popup: { info: "Show info" },
  history: { undo: "Undo", redo: "Redo", clear: "Clear history" },
  menu: {
    column: "Column menu",
    sortAsc: "Sort ascending",
    sortDesc: "Sort descending",
    sortClear: "Clear sort",
    hide: "Hide column",
    pinLeft: "Pin left",
    pinRight: "Pin right",
    unpin: "Unpin",
    groupBy: "Group by this",
    ungroup: "Ungroup",
    fitWidth: "Fit width",
    row: "Row menu",
    sortMulti: "Click = sort \xB7 Shift+click = multi-level"
  },
  progressive: { loaded: "Loaded {loaded} of {total}", loadMore: "Load more ({n})", loading: "Loading\u2026", allLoaded: "All loaded" },
  edit: { hint: "Double-click to edit" },
  detail: { toggle: "Show / hide detail" },
  selection: { count: "Selected: {n}", clear: "Clear selection" },
  range: { cells: "{n} cells", sum: "Sum", avg: "Avg", min: "Min", max: "Max", fill: "Drag to fill" },
  validate: { required: "Required", invalid: "Invalid value", pattern: "Wrong format", min: "Must be \u2265 {n}", max: "Must be \u2264 {n}", minLen: "At least {n} characters", maxLen: "At most {n} characters" },
  empty: "No data",
  loading: "Loading\u2026",
  error: "Failed to load data"
};

// src/i18n/index.js
var BUILTIN = { cs: cs_default, en: en_default };
var DEFAULT = en_default;
function registerLanguage(code, dict) {
  if (code && dict && typeof dict === "object") BUILTIN[code] = dict;
  return BUILTIN;
}
function availableLanguages() {
  return Object.keys(BUILTIN);
}
var I18n = class {
  /**
   * @param {string|object} lang  Kód vestavěného jazyka nebo vlastní slovník.
   */
  constructor(lang) {
    this.setLang(lang);
  }
  setLang(lang) {
    if (typeof lang === "string") {
      this.lang = lang;
      this.dict = BUILTIN[lang] || DEFAULT;
    } else if (lang && typeof lang === "object") {
      this.lang = lang.locale || lang.lang || void 0;
      this.dict = lang;
    } else {
      this.lang = void 0;
      this.dict = DEFAULT;
    }
  }
  /** BCP-47 kód pro locale-aware řazení (localeCompare). Může být undefined. */
  get locale() {
    return this.lang || void 0;
  }
  /** Vrátí pole ze slovníku (měsíce, dny…) — t() vrací jen stringy. Fallback na default. */
  list(path) {
    const walk = (obj) => {
      let cur = obj;
      for (const key of path.split(".")) {
        if (cur == null) return void 0;
        cur = cur[key];
      }
      return Array.isArray(cur) ? cur : void 0;
    };
    return walk(this.dict) || walk(DEFAULT) || [];
  }
  /**
   * Přeloží tečkovou cestu. Volitelné `vars` nahradí {placeholder}y.
   * @param {string} path e.g. 'pagination.of'
   * @param {object} [vars]
   */
  t(path, vars) {
    let s = lookup(this.dict, path);
    if (s === void 0) s = lookup(DEFAULT, path);
    if (s === void 0) return path;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);
    }
    return s;
  }
};
function lookup(obj, path) {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[key];
  }
  return typeof cur === "string" ? cur : void 0;
}

// src/features/lightbox.js
function openLightbox(src, alt) {
  const img = el("img.lattice-lightbox-img", { src, alt: alt || "" });
  img.addEventListener("click", (e) => e.stopPropagation());
  const closeBtn = el("button.lattice-lightbox-close", { type: "button", text: "\xD7", title: "Zav\u0159\xEDt" });
  const overlay = el("div.lattice-lightbox", {}, [img, closeBtn]);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  return close;
}

// src/core/format.js
var DEFAULT_FORMATS = {
  number: { decimals: null, thousands: true, negative: "minus" },
  money: { decimals: null, thousands: true, currency: "CZK", negative: "minus" },
  date: { pattern: "dd.mm.yyyy" },
  datetime: { pattern: "dd.mm.yyyy HH:nn" },
  time: { pattern: "HH:nn" }
};
function formatKind(type) {
  if (type === "number") return "number";
  if (type === "money") return "money";
  if (type === "date") return "date";
  if (type === "datetime") return "datetime";
  if (type === "time") return "time";
  return null;
}
function formatKeys(kind) {
  return kind === "date" || kind === "datetime" || kind === "time" ? ["pattern"] : ["decimals", "thousands", "currency", "negative", "suffix", "prefix", "locale"];
}
var CURRENCIES = ["CZK", "EUR", "USD", "GBP", "PLN", "CHF", "JPY"];
var DATE_PRESETS = ["dd.mm.yyyy", "d.m.yyyy", "yyyy-mm-dd", "dd/mm/yyyy", "d. mmmm yyyy", "d. mmm yyyy", "ddd d.m.yyyy"];
var DATETIME_PRESETS = ["dd.mm.yyyy HH:nn", "d.m.yyyy H:nn", "yyyy-mm-dd HH:nn", "dd.mm.yyyy HH:nn:ss", "d. mmmm yyyy H:nn"];
var TIME_PRESETS = ["HH:nn", "H:nn", "HH:nn:ss", "h:nn a"];
var pad2 = (x) => String(x).padStart(2, "0");
function applyNegative(absText, neg, style) {
  if (!neg) return { text: absText, red: false };
  switch (style) {
    case "paren":
      return { text: "(" + absText + ")", red: false };
    case "red":
      return { text: "-" + absText, red: true };
    case "redparen":
      return { text: "(" + absText + ")", red: true };
    default:
      return { text: "-" + absText, red: false };
  }
}
function formatNumber(n, fmt = {}) {
  if (n == null || !Number.isFinite(n)) return { text: "", red: false };
  const abs = Math.abs(n);
  const opts = { useGrouping: fmt.thousands !== false };
  if (fmt.decimals == null) {
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 3;
  } else {
    opts.minimumFractionDigits = fmt.decimals;
    opts.maximumFractionDigits = fmt.decimals;
  }
  let s = abs.toLocaleString(fmt.locale || void 0, opts);
  if (fmt.prefix) s = fmt.prefix + s;
  if (fmt.suffix) s = s + fmt.suffix;
  return applyNegative(s, n < 0, fmt.negative);
}
function formatMoney(n, fmt = {}) {
  if (n == null || !Number.isFinite(n)) return { text: "", red: false };
  const abs = Math.abs(n);
  const opts = { style: "currency", currency: fmt.currency || "CZK", useGrouping: fmt.thousands !== false };
  if (fmt.decimals == null) {
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 2;
  } else {
    opts.minimumFractionDigits = fmt.decimals;
    opts.maximumFractionDigits = fmt.decimals;
  }
  let s;
  try {
    s = abs.toLocaleString(fmt.locale || "cs-CZ", opts);
  } catch {
    s = abs.toLocaleString(fmt.locale || "cs-CZ", { ...opts, style: "decimal" }) + " " + (fmt.currency || "");
  }
  return applyNegative(s, n < 0, fmt.negative);
}
var DATE_TOKEN_RE = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|nn|n|ss|s|A|a/g;
function formatDate(d, pattern, i18n) {
  if (!d) return "";
  const months = i18n ? i18n.list("dateRange.months") : [];
  const monthsShort = i18n ? i18n.list("dateRange.monthsShort") : [];
  const weekdays = i18n ? i18n.list("dateRange.weekdays") : [];
  const weekdaysLong = i18n ? i18n.list("dateRange.weekdaysLong") : [];
  const mo = d.getMonth(), wd = (d.getDay() + 6) % 7;
  const h24 = d.getHours(), h12 = h24 % 12 || 12;
  const map = {
    yyyy: d.getFullYear(),
    yy: String(d.getFullYear()).slice(-2),
    mmmm: months[mo],
    mmm: monthsShort[mo] || (months[mo] || "").slice(0, 3),
    mm: pad2(mo + 1),
    m: mo + 1,
    dddd: weekdaysLong[wd],
    ddd: weekdays[wd],
    dd: pad2(d.getDate()),
    d: d.getDate(),
    HH: pad2(h24),
    H: h24,
    hh: pad2(h12),
    h: h12,
    nn: pad2(d.getMinutes()),
    n: d.getMinutes(),
    ss: pad2(d.getSeconds()),
    s: d.getSeconds(),
    A: h24 < 12 ? "AM" : "PM",
    a: h24 < 12 ? "am" : "pm"
  };
  return String(pattern || "").replace(DATE_TOKEN_RE, (tok) => {
    const v = map[tok];
    return v == null ? tok : String(v);
  });
}

// src/types/columnTypes.js
function effFmt(col, kind) {
  if (col._fmt) return col._fmt;
  return { ...DEFAULT_FORMATS[kind], ...col.formatterParams || {} };
}
function negText(r) {
  if (!r.red) return r.text;
  const span = document.createElement("span");
  span.className = "lattice-num-neg";
  span.textContent = r.text;
  return span;
}
var registry2 = /* @__PURE__ */ new Map();
function registerType(name, formatter) {
  registry2.set(name, formatter);
}
function getFormatter(column) {
  if (typeof column.formatter === "function") return column.formatter;
  return registry2.get(column.type) || registry2.get("text");
}
function toNumber2(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
registerType("text", (v) => v == null ? "" : String(v));
registerType("id", (v) => v == null ? "" : String(v));
registerType("number", (v, col) => {
  const n = toNumber2(v);
  if (n == null) return "";
  return negText(formatNumber(n, effFmt(col, "number")));
});
registerType("money", (v, col) => {
  const n = toNumber2(v);
  if (n == null) return "";
  return negText(formatMoney(n, effFmt(col, "money")));
});
registerType("date", (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, "date").pattern, col._i18n) : "";
});
registerType("datetime", (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, "datetime").pattern, col._i18n) : "";
});
registerType("time", (v, col) => {
  const d = toDate(v);
  return d ? formatDate(d, effFmt(col, "time").pattern, col._i18n) : "";
});
registerType("boolean", (v) => {
  const truthy = v === true || v === 1 || v === "1" || v === "true";
  const span = document.createElement("span");
  span.className = "lattice-bool " + (truthy ? "is-true" : "is-false");
  span.textContent = truthy ? "\u2713" : "\u2715";
  return span;
});
registerType("progress", (v, col) => {
  const p = col.formatterParams || {};
  const max = p.max != null ? p.max : 100;
  const n = toNumber2(v) ?? 0;
  const pct = Math.max(0, Math.min(100, n / max * 100));
  const wrap = document.createElement("div");
  wrap.className = "lattice-progress";
  wrap.title = max === 100 ? `${Math.round(pct)} %` : `${Math.round(n)} / ${max}`;
  const bar = document.createElement("div");
  bar.className = "lattice-progress-bar";
  bar.style.width = pct + "%";
  if (p.color) bar.style.background = p.color;
  wrap.appendChild(bar);
  if (p.showValue) {
    const label = document.createElement("span");
    label.className = "lattice-progress-label";
    label.textContent = Math.round(pct) + " %";
    wrap.appendChild(label);
  }
  return wrap;
});
registerType("sparkline", (v, col) => {
  const p = col.formatterParams || {};
  let nums = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [];
  nums = nums.map(toNumber2).filter((x) => x != null);
  if (!nums.length) return "";
  const NS = "http://www.w3.org/2000/svg";
  const w = p.width || 80, h = p.height || 22, pad4 = 2;
  const iw = w - pad4 * 2, ih = h - pad4 * 2;
  const min = p.min != null ? p.min : Math.min(...nums);
  const max = p.max != null ? p.max : Math.max(...nums);
  const span = max - min || 1;
  const X = (i) => pad4 + (nums.length === 1 ? iw / 2 : i / (nums.length - 1) * iw);
  const Y = (val) => pad4 + ih - (val - min) / span * ih;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "lattice-sparkline");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  if (p.color) svg.style.color = p.color;
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  if (p.type === "bar") {
    const bw = iw / nums.length;
    nums.forEach((val, i) => {
      const bh = Math.max(0.5, (val - min) / span * ih);
      svg.appendChild(mk("rect", { x: (pad4 + i * bw + bw * 0.1).toFixed(1), y: (pad4 + ih - bh).toFixed(1), width: (bw * 0.8).toFixed(1), height: bh.toFixed(1), fill: "currentColor" }));
    });
  } else {
    const d = nums.map((val, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(val).toFixed(1)).join(" ");
    if (p.fill) svg.appendChild(mk("path", { d: `${d} L${X(nums.length - 1).toFixed(1)} ${(pad4 + ih).toFixed(1)} L${X(0).toFixed(1)} ${(pad4 + ih).toFixed(1)} Z`, fill: "currentColor", opacity: "0.15" }));
    svg.appendChild(mk("path", { d, fill: "none", stroke: "currentColor", "stroke-width": p.strokeWidth || 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (p.dot !== false) svg.appendChild(mk("circle", { cx: X(nums.length - 1).toFixed(1), cy: Y(nums[nums.length - 1]).toFixed(1), r: "1.6", fill: "currentColor" }));
  }
  const wrap = document.createElement("span");
  wrap.className = "lattice-sparkline-wrap";
  wrap.title = nums.join(", ");
  wrap.appendChild(svg);
  return wrap;
});
registerType("link", (v, col, row) => {
  if (v == null || v === "") return "";
  const p = col.formatterParams || {};
  const a = document.createElement("a");
  a.className = "lattice-link";
  if (typeof p.url === "function") {
    a.href = String(p.url(v, row, col) ?? "");
  } else {
    const base = p.urlField != null && row ? row[p.urlField] : v;
    a.href = (p.urlPrefix || "") + String(base ?? "") + (p.urlSuffix || "");
  }
  a.textContent = p.label != null ? p.label : String(v);
  let target = p.target;
  if (target == null) target = col._linkNewTab ? "_blank" : "_self";
  if (target === "_blank") {
    a.target = "_blank";
    a.rel = p.rel || "noopener noreferrer";
    a.appendChild(extLinkIcon());
  } else if (target && target !== "_self") {
    a.target = target;
  }
  return a;
});
function extLinkIcon() {
  const s = document.createElement("span");
  s.className = "lattice-link-ext";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5"/></svg>';
  return s;
}
registerType("image", (v, col) => {
  if (v == null || v === "") return "";
  const p = col.formatterParams || {};
  const img = document.createElement("img");
  img.className = "lattice-img";
  img.src = String(v);
  img.loading = "lazy";
  img.alt = p.alt || "";
  const dim = (x) => typeof x === "number" ? x + "px" : x;
  if (p.height) img.style.height = dim(p.height);
  if (p.width) img.style.width = dim(p.width);
  if (p.lightbox !== false) {
    img.classList.add("is-zoomable");
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(String(v), p.alt);
    });
  }
  return img;
});
registerType("icon", (v, col) => {
  const p = col.formatterParams || {};
  let g = v;
  if (p.icons && v != null && Object.prototype.hasOwnProperty.call(p.icons, v)) g = p.icons[v];
  if (g == null || g === "") return "";
  g = String(g);
  const span = document.createElement("span");
  span.className = "lattice-icon";
  if (/^(https?:|data:)/.test(g)) {
    const img = document.createElement("img");
    img.className = "lattice-icon-img";
    img.src = g;
    img.alt = p.alt || "";
    span.appendChild(img);
  } else {
    span.textContent = g;
  }
  if (p.size) span.style.fontSize = typeof p.size === "number" ? p.size + "px" : p.size;
  if (p.title != null) span.title = String(p.title);
  return span;
});
registerType("color", (v) => {
  const div = document.createElement("div");
  div.className = "lattice-color-fill";
  if (v != null && v !== "") div.style.background = String(v);
  div.title = v != null ? String(v) : "";
  return div;
});
registerType("tick", (v) => {
  const truthy = v === true || v === 1 || v === "1" || v === "true" || v === "True";
  if (!truthy) return "";
  const span = document.createElement("span");
  span.className = "lattice-bool is-true";
  span.textContent = "\u2713";
  return span;
});
registerType("html", (v) => {
  const span = document.createElement("span");
  span.innerHTML = v == null ? "" : String(v);
  return span;
});
registerType("rating", (v, col) => {
  const p = col.formatterParams || {};
  const max = p.max != null ? p.max : 5;
  const n = Math.round(toNumber2(v) ?? 0);
  const wrap = document.createElement("span");
  wrap.className = "lattice-rating";
  wrap.title = `${n} / ${max}`;
  for (let i = 1; i <= max; i++) {
    const star = document.createElement("span");
    star.className = "lattice-star " + (i <= n ? "is-on" : "is-off");
    star.textContent = "\u2605";
    wrap.appendChild(star);
  }
  return wrap;
});

// src/features/resize.js
function attachResize(handle, col, grid) {
  let startX = 0, startWidth = 0, dragging = false, pending = 0, guide = null, tableLeft = 0;
  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(col.minWidth, Math.round(startWidth + (e.clientX - startX)));
    pending = w;
    if (guide) {
      moveGuide(guide, startX + (w - startWidth) - tableLeft);
    } else {
      col.width = w;
      grid.renderer.applyLayout();
    }
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("lattice-resizing");
    if (guide) {
      col.width = pending;
      grid.renderer.applyLayout();
      removeGuide(guide);
      guide = null;
    }
    grid.saveState();
  };
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = grid.renderer.layout?.widths.get(col.field) ?? col.width;
    pending = startWidth;
    dragging = true;
    document.body.classList.add("lattice-resizing");
    if (grid.instance.resizeGuide) {
      tableLeft = grid.renderer.nodes.table.getBoundingClientRect().left;
      guide = createGuide(grid, startX - tableLeft);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const w = measureColumnWidth(col, grid);
    if (w) {
      col.width = w;
      grid.renderer.applyLayout();
      grid.saveState();
    }
  });
}
function attachRowNumberResize(handle, grid) {
  let startX = 0, startWidth = 0, dragging = false, pending = 0, guide = null, tableLeft = 0;
  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(36, Math.round(startWidth + (e.clientX - startX)));
    pending = w;
    if (guide) moveGuide(guide, startX + (w - startWidth) - tableLeft);
    else {
      grid.instance.rowNumberWidth = w;
      grid.renderer.applyLayout();
    }
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("lattice-resizing");
    if (guide) {
      grid.instance.rowNumberWidth = pending;
      grid.renderer.applyLayout();
      removeGuide(guide);
      guide = null;
    }
    grid.saveState();
  };
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = grid.renderer.layout?.widths.get("__rownum__") ?? 50;
    pending = startWidth;
    dragging = true;
    document.body.classList.add("lattice-resizing");
    if (grid.instance.resizeGuide) {
      tableLeft = grid.renderer.nodes.table.getBoundingClientRect().left;
      guide = createGuide(grid, startX - tableLeft);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    grid.instance.rowNumberWidth = null;
    grid.saveState();
    grid.renderer.applyLayout();
  });
}
function createGuide(grid, x) {
  const table = grid.renderer.nodes.table;
  const g = document.createElement("div");
  g.className = "lattice-resize-guide";
  g.style.height = table.offsetHeight + "px";
  g.style.left = x + "px";
  table.appendChild(g);
  return g;
}
function moveGuide(guide, x) {
  guide.style.left = x + "px";
}
function removeGuide(guide) {
  guide.remove();
}
function measureColumnWidth(col, grid) {
  const table = grid.renderer.nodes.table;
  const hcell = table.querySelector(`.lattice-hcell[data-field="${cssEscape(col.field)}"]`);
  const cells = table.querySelectorAll(`.lattice-cell[data-field="${cssEscape(col.field)}"]`);
  let max = 0;
  if (hcell) {
    const title = hcell.querySelector(".lattice-hcell-title");
    max = Math.max(max, textWidth(title?.textContent ?? col.title, fontOf(title || hcell)));
  }
  for (const cell of cells) {
    max = Math.max(max, textWidth(cell.textContent, fontOf(cell)));
  }
  const PAD = 28;
  return Math.max(col.minWidth, Math.ceil(max) + PAD);
}
var _ctx = null;
function textWidth(text, font) {
  if (!text) return 0;
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = font;
  return _ctx.measureText(text).width;
}
function fontOf(node) {
  if (!node) return "14px sans-serif";
  const s = getComputedStyle(node);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}
function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

// src/features/columnDrag.js
function attachHeaderDrag(cell, col, grid) {
  cell.draggable = true;
  cell.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", col.field);
    grid._dragField = col.field;
    cell.classList.add("is-dragging");
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("is-dragging");
    grid._dragField = null;
    clearIndicators(grid);
  });
  cell.addEventListener("dragover", (e) => {
    if (!grid._dragField || grid._dragField === col.field) return;
    if (!dropAllowed(grid, col)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const before = isBefore(e, cell);
    clearIndicators(grid);
    cell.classList.add(before ? "drop-before" : "drop-after");
  });
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = grid._dragField || e.dataTransfer.getData("text/plain");
    if (!from || from === col.field || !dropAllowed(grid, col)) return;
    grid.moveColumn(from, col.field, isBefore(e, cell) ? "before" : "after");
    clearIndicators(grid);
  });
}
function dropAllowed(grid, targetCol) {
  const dragged = grid.columns.find((c) => c.field === grid._dragField);
  if (!dragged) return false;
  const dg = dragged.group || null;
  return dg === null || dg === (targetCol.group || null);
}
function attachGroupDrag(cell, groupTitle, grid) {
  const fields = () => (cell.dataset.fields || "").split(",").filter(Boolean);
  if (groupTitle) cell.draggable = true;
  cell.addEventListener("dragstart", (e) => {
    if (!groupTitle) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    grid._dragGroup = groupTitle;
    cell.classList.add("is-dragging");
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("is-dragging");
    grid._dragGroup = null;
    clearGroupIndicators(grid);
  });
  cell.addEventListener("dragover", (e) => {
    if (!grid._dragGroup || grid._dragGroup === groupTitle) return;
    const f = fields();
    if (!f.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const before = isBefore(e, cell);
    clearGroupIndicators(grid);
    cell.classList.add(before ? "drop-before" : "drop-after");
  });
  cell.addEventListener("drop", (e) => {
    if (!grid._dragGroup || grid._dragGroup === groupTitle) return;
    e.preventDefault();
    const f = fields();
    clearGroupIndicators(grid);
    if (!f.length) return;
    const before = isBefore(e, cell);
    const targetField = before ? f[0] : f[f.length - 1];
    grid.moveGroup(grid._dragGroup, targetField, before ? "before" : "after");
  });
}
function isBefore(e, cell) {
  const r = cell.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2;
}
function clearIndicators(grid) {
  const root = grid.renderer?.nodes?.headerRow;
  if (!root) return;
  for (const c of root.querySelectorAll(".drop-before, .drop-after")) {
    c.classList.remove("drop-before", "drop-after");
  }
}
function clearGroupIndicators(grid) {
  const root = grid.renderer?.nodes?.groupRow;
  if (!root) return;
  for (const c of root.querySelectorAll(".drop-before, .drop-after")) {
    c.classList.remove("drop-before", "drop-after");
  }
}

// src/features/summary.js
var NUMERIC_TYPES = ["number", "money", "progress", "rating"];
function isNumericType(type) {
  return NUMERIC_TYPES.includes(type);
}
var SUMMARY_ORDER = ["sum", "avg", "min", "max", "count"];
function availableSummaries(col) {
  return isNumericType(col.type) ? SUMMARY_ORDER.slice() : ["count"];
}
function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function nonNull(v) {
  return v != null && v !== "";
}
function computeSummary(fn, col, rows) {
  if (fn === "count") return rows.reduce((a, r) => a + (nonNull(cellValue(r, col)) ? 1 : 0), 0);
  const nums = [];
  for (const r of rows) {
    const n = toNum(cellValue(r, col));
    if (n != null) nums.push(n);
  }
  if (!nums.length) return null;
  switch (fn) {
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    default:
      return null;
  }
}
function computeRowSummary(fn, cols, row) {
  if (fn === "count") return cols.reduce((a, c) => a + (nonNull(cellValue(row, c)) ? 1 : 0), 0);
  const nums = [];
  for (const c of cols) {
    const n = toNum(cellValue(row, c));
    if (n != null) nums.push(n);
  }
  if (!nums.length) return null;
  switch (fn) {
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    default:
      return null;
  }
}
var SUMMARY_SYMBOL = { sum: "\u03A3", avg: "\u2300", min: "min", max: "max", count: "#" };

// src/core/colorScale.js
var DEFAULT_SCALE_COLORS = ["#e5534b", "#f2c037", "#42a05a"];
function hex2rgb(h) {
  let s = String(h || "").replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? [n >> 16 & 255, n >> 8 & 255, n & 255] : [128, 128, 128];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function lum(r) {
  return (0.299 * r[0] + 0.587 * r[1] + 0.114 * r[2]) / 255;
}
function css(r) {
  return `rgb(${Math.round(r[0])}, ${Math.round(r[1])}, ${Math.round(r[2])})`;
}
function anchorAt(anchors, f) {
  if (f <= 0.5) return mix(anchors[0], anchors[1], f / 0.5);
  return mix(anchors[1], anchors[2], (f - 0.5) / 0.5);
}
function levelIndex(value, thresholds) {
  let idx = 0;
  for (const t of thresholds) if (value >= t) idx++;
  return idx;
}
function levelColor(colors, i, levels, reverse, mode) {
  const anchors = (Array.isArray(colors) && colors.length === 3 ? colors : DEFAULT_SCALE_COLORS).map(hex2rgb);
  let f = levels > 1 ? i / (levels - 1) : 0;
  if (reverse) f = 1 - f;
  const c = anchorAt(anchors, f);
  const color = css(c);
  if (mode === "text") return { text: color };
  return { bg: color, fg: lum(c) < 0.55 ? "#ffffff" : "#1f2733" };
}

// src/features/instanceSettings.js
var SAMPLE_DATE = new Date(2026, 2, 5, 9, 7, 3);
var InstanceSettings = class {
  constructor(grid) {
    this.grid = grid;
    this.overlay = null;
  }
  toggle() {
    if (this.overlay) return this.close();
    this.open();
  }
  open() {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const overlay = el("div.lattice-modal-overlay");
    const modal = el("div.lattice-modal");
    const head = el("div.lattice-modal-head", {}, [
      el("span.lattice-modal-title", { text: t("instance.title") }),
      el("button.lattice-modal-x", { type: "button", title: t("instance.done"), text: "\xD7" })
    ]);
    const bodyEl = el("div.lattice-modal-body");
    this.render(bodyEl);
    const footChildren = [];
    if (this.grid.canSaveGlobalDefaults()) {
      const gBtn = el("button.lattice-modal-global", { type: "button", title: t("instance.saveGlobalHint"), text: t("instance.saveGlobalDefaults") });
      gBtn.addEventListener("click", () => {
        this.grid.setGlobalDefaults();
        const old = gBtn.textContent;
        gBtn.textContent = t("instance.saveGlobalDone");
        gBtn.disabled = true;
        setTimeout(() => {
          gBtn.textContent = old;
          gBtn.disabled = false;
        }, 1400);
      });
      footChildren.push(gBtn);
    }
    footChildren.push(el("button.lattice-modal-done", { type: "button", text: t("instance.done") }));
    const foot = el("div.lattice-modal-foot", {}, footChildren);
    modal.append(head, bodyEl, foot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    head.querySelector(".lattice-modal-x").addEventListener("click", () => this.close());
    foot.querySelector(".lattice-modal-done").addEventListener("click", () => this.close());
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });
    this._esc = (e) => {
      if (e.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this._esc);
    this.overlay = overlay;
    this._body = bodyEl;
  }
  close() {
    if (this._esc) document.removeEventListener("keydown", this._esc);
    this.overlay?.remove();
    this.overlay = null;
    this._esc = null;
  }
  /** Překreslí tělo (po změně, která ovlivní dostupnost dalších voleb). */
  refreshBody() {
    if (this._body) this.render(this._body);
  }
  render(body) {
    clear(body);
    const grid = this.grid;
    const inst = grid.instance;
    const t = grid.i18n.t.bind(grid.i18n);
    const set = (patch) => {
      grid.setInstance(patch);
    };
    if (grid.hasGlobalDefaults()) {
      const isNew = grid.globalDefaultsAvailable();
      const banner = el("div.lattice-set-gdnote", { class: isNew ? "is-new" : "" });
      banner.appendChild(el("span.lattice-set-gdnote-txt", { text: t(isNew ? "instance.gdAvailable" : "instance.gdReset") }));
      const apply = el("button.lattice-set-gdnote-apply", { type: "button", text: t("instance.gdApply") });
      apply.addEventListener("click", () => {
        grid.applyGlobalDefaults();
        this.render(body);
      });
      banner.appendChild(apply);
      if (isNew) {
        const keep = el("button.lattice-set-gdnote-keep", { type: "button", text: t("instance.gdKeepMine") });
        keep.addEventListener("click", () => {
          grid.dismissGlobalDefaults();
          this.render(body);
        });
        banner.appendChild(keep);
      }
      body.appendChild(banner);
    }
    const tabBar = el("div.lattice-set-tabs");
    const panels = el("div.lattice-set-panels");
    body.append(tabBar, panels);
    const tabs = [];
    const activate = (i) => {
      this._tab = i;
      tabs.forEach((tb, j) => {
        tb.btn.classList.toggle("is-active", j === i);
        tb.panel.hidden = j !== i;
      });
    };
    const makeTab = (title) => {
      const panel = el("div.lattice-set-panel");
      const btn = el("button.lattice-set-tab", { type: "button", text: title });
      const idx = tabs.length;
      btn.addEventListener("click", () => activate(idx));
      tabs.push({ btn, panel });
      tabBar.appendChild(btn);
      panels.appendChild(panel);
      return panel;
    };
    const gA = makeTab(t("instance.groupAppearance"));
    gA.appendChild(rowSelect(t("instance.theme"), inst.theme || "default", [
      ["default", t("instance.themeDefault")],
      ["auto", t("instance.themeAuto")],
      ["minimal", t("instance.themeMinimal")],
      ["compact", t("instance.themeCompact")],
      ["slate", t("instance.themeSlate")],
      ["ocean", t("instance.themeOcean")],
      ["warm", t("instance.themeWarm")],
      ["contrast", t("instance.themeContrast")],
      ["bootstrap5", t("instance.themeBootstrap5")],
      ["tailwind", t("instance.themeTailwind")],
      ["material", t("instance.themeMaterial")]
    ], (v) => set({ theme: v })));
    gA.appendChild(rowRange(t("instance.fontSize"), inst.fontSize || 14, 11, 20, (v) => set({ fontSize: v })));
    gA.appendChild(rowSelect(t("instance.density"), inst.density || "comfortable", [
      ["comfortable", t("instance.comfortable")],
      ["compact", t("instance.compact")]
    ], (v) => set({ density: v })));
    gA.appendChild(rowSelect(t("instance.headerRotate"), inst.headerRotate || "none", [
      ["none", t("instance.headerRotateNone")],
      ["90", t("instance.headerRotate90")],
      ["270", t("instance.headerRotate270")]
    ], (v) => set({ headerRotate: v })));
    gA.appendChild(rowToggle(t("instance.zebra"), inst.zebra !== false, (v) => set({ zebra: v })));
    gA.appendChild(rowScaleColors(t("instance.scaleColors"), inst.scaleColors || DEFAULT_SCALE_COLORS, (arr) => set({ scaleColors: arr })));
    const gL = makeTab(t("instance.groupLayout"));
    const layoutVal = inst.layout === "fit" ? "fitColumns" : inst.layout || "fitData";
    gL.appendChild(rowSelect(t("instance.layout"), layoutVal, [
      ["fitData", t("instance.fitData")],
      ["fitDataFill", t("instance.fitDataFill")],
      ["fitDataStretch", t("instance.fitDataStretch")],
      ["fitColumns", t("instance.fitColumns")]
    ], (v) => set({ layout: v })));
    gL.appendChild(rowSelect(t("instance.resizeMode"), inst.resizeGuide ? "guide" : "native", [
      ["native", t("instance.resizeNative")],
      ["guide", t("instance.resizeGuide")]
    ], (v) => set({ resizeGuide: v === "guide" })));
    gL.appendChild(rowToggle(t("instance.wrapText"), inst.wrapText === true, (v) => set({ wrapText: v })));
    gL.appendChild(rowToggle(t("instance.linkNewTab"), inst.linkNewTab === true, (v) => set({ linkNewTab: v })));
    gL.appendChild(rowText(t("instance.emptyText"), inst.emptyText || "", t("instance.emptyTextPlaceholder"), (v) => set({ emptyText: v })));
    const gP = makeTab(t("instance.groupPagination"));
    gP.appendChild(rowSelect(t("instance.pagination"), inst.paginationPosition || "footer", [
      ["header", t("instance.paginationHeader")],
      ["footer", t("instance.paginationFooter")],
      ["both", t("instance.paginationBoth")],
      ["none", t("instance.paginationNone")]
    ], (v) => set({ paginationPosition: v })));
    gP.appendChild(rowSelect(
      t("instance.pageSizeDefault"),
      String(inst.pageSize || 50),
      [["10", "10"], ["25", "25"], ["50", "50"], ["100", "100"], ["200", "200"]],
      (v) => set({ pageSize: Number(v) })
    ));
    gP.appendChild(rowSelect(t("instance.filterLayout"), inst.filterLayout || "header", [
      ["header", t("instance.filterInHeader")],
      ["external", t("instance.filterExternal")],
      ["universal", t("instance.filterUniversal")],
      ["none", t("instance.filterOff")]
    ], (v) => set({ filterLayout: v })));
    const gC = makeTab(t("instance.groupColumns"));
    const sortable = grid.columns.filter((c) => c.headerSort !== false && c.title && !c._rownum && !c._select);
    const sortOpts = [["", t("instance.sortNone")]];
    for (const c of sortable) {
      sortOpts.push([c.field + "\0asc", c.title + " " + t("instance.sortAscSuffix")]);
      sortOpts.push([c.field + "\0desc", c.title + " " + t("instance.sortDescSuffix")]);
    }
    const curSort = grid.sort && grid.sort[0];
    gC.appendChild(rowSelect(t("instance.defaultSort"), curSort ? curSort.field + "\0" + curSort.dir : "", sortOpts, (v) => {
      if (!v) grid.sortColumn("", null);
      else {
        const [f, d] = v.split("\0");
        grid.sortColumn(f, d);
      }
    }));
    gC.appendChild(rowSelect(t("instance.rowNumbers"), inst.rowNumbers || "none", [
      ["none", t("instance.rowNumbersNone")],
      ["continuous", t("instance.rowNumbersContinuous")],
      ["perPage", t("instance.rowNumbersPerPage")]
    ], (v) => set({ rowNumbers: v })));
    gC.appendChild(rowSelect(t("instance.summaryRow"), inst.summaryRow || "none", [
      ["none", t("instance.summaryNone")],
      ["page", t("instance.summaryPage")],
      ["all", t("instance.summaryAll")]
    ], (v) => set({ summaryRow: v })));
    gC.appendChild(rowToggle(t("instance.groupSubtotals"), inst.groupSubtotals === true, (v) => set({ groupSubtotals: v })));
    if (grid.isSelectable()) {
      gC.appendChild(rowToggle(t("instance.selectColumn"), inst.selectColumn !== false, (v) => set({ selectColumn: v })));
      gC.appendChild(rowSelect(t("instance.selectTrigger"), inst.selectRowClick ? "row" : "checkbox", [
        ["checkbox", t("instance.selectByCheckbox")],
        ["row", t("instance.selectByRow")]
      ], (v) => set({ selectRowClick: v === "row" })));
    }
    if (grid.hasActions()) {
      gC.appendChild(rowSelect(t("instance.actionsLayout"), inst.actionsLayout || "column", [
        ["column", t("instance.actionsAsColumn")],
        ["menu", t("instance.actionsAsMenu")]
      ], (v) => set({ actionsLayout: v })));
    }
    const gF = makeTab(t("instance.groupFormat"));
    gF.appendChild(rowSelect(t("instance.locale"), inst.locale || "", [
      ["", t("instance.localeDefault")],
      ["cs-CZ", "\u010Ce\u0161tina (cs-CZ)"],
      ["sk-SK", "Sloven\u010Dina (sk-SK)"],
      ["en-US", "English (en-US)"],
      ["en-GB", "English (en-GB)"],
      ["de-DE", "Deutsch (de-DE)"],
      ["pl-PL", "Polski (pl-PL)"],
      ["fr-FR", "Fran\xE7ais (fr-FR)"]
    ], (v) => set({ locale: v })));
    for (const kind of ["number", "money", "date", "datetime", "time"]) {
      const label = { number: "fmtNumber", money: "fmtMoney", date: "fmtDate", datetime: "fmtDatetime", time: "fmtTime" }[kind];
      const cur = grid.effectiveFormatFor(kind);
      gF.appendChild(el("div.lattice-set-subhead", { text: t("instance." + label) }));
      for (const f of formatFields(kind, cur, grid, (patch) => grid.setFormat(kind, patch))) gF.appendChild(f);
    }
    const gX = makeTab(t("instance.groupCustom"));
    gX.appendChild(el("div.lattice-set-hint", { text: t("instance.cssHint") }));
    const cv = inst.cssVars || {};
    const merge = (name, value) => {
      const next = Object.assign({}, grid.instance.cssVars);
      if (value == null || value === "") delete next[name];
      else next[name] = value;
      set({ cssVars: next });
    };
    gX.appendChild(fontSelectRow(t("instance.cssFontTable"), inst.fontFamily || "", (v) => set({ fontFamily: v })));
    gX.appendChild(fontSelectRow(t("instance.cssFontHeader"), cv["--lattice-header-font"] || "", (v) => merge("--lattice-header-font", v || null)));
    gX.appendChild(colorGrid([
      [t("instance.cssAccent"), "--lattice-accent"],
      [t("instance.cssLink"), "--lattice-link"],
      [t("instance.cssText"), "--lattice-text"],
      [t("instance.cssBorder"), "--lattice-border"],
      [t("instance.cssHeaderBg"), "--lattice-header-bg"],
      [t("instance.cssRowEven"), "--lattice-bg"],
      [t("instance.cssRowOdd"), "--lattice-row-odd"],
      [t("instance.cssRowHover"), "--lattice-row-hover"]
    ], grid, cv, merge));
    gX.appendChild(cssSelectRow(
      t("instance.cssHeaderWeight"),
      "--lattice-header-weight",
      cv,
      [["", "\u2014"], ["400", "400"], ["500", "500"], ["600", "600"], ["700", "700"]],
      merge
    ));
    gX.appendChild(cssPxRow(t("instance.cssRadius"), "--lattice-radius", grid, cv, merge));
    gX.appendChild(cssPxRow(t("instance.cssCellPadY"), "--lattice-cell-pad-y", grid, cv, merge));
    gX.appendChild(cssPxRow(t("instance.cssCellPadX"), "--lattice-cell-pad-x", grid, cv, merge));
    const resetBtn = el("button.lattice-modal-global", { type: "button", text: t("instance.cssReset") });
    resetBtn.addEventListener("click", () => {
      set({ cssVars: {} });
      this.render(body);
    });
    gX.appendChild(field("", resetBtn));
    activate(Math.min(this._tab || 0, tabs.length - 1));
  }
};
function formatFields(kind, cur, grid, onChange) {
  const t = grid.i18n.t.bind(grid.i18n);
  const rows = [];
  if (kind === "number" || kind === "money") {
    if (kind === "money") {
      rows.push(rowSelect(t("instance.fmtCurrency"), cur.currency || "CZK", CURRENCIES.map((c) => [c, c]), (v) => onChange({ currency: v })));
    }
    rows.push(rowSelect(
      t("instance.fmtDecimals"),
      cur.decimals == null ? "auto" : String(cur.decimals),
      [["auto", t("instance.fmtDecimalsAuto")], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]],
      (v) => onChange({ decimals: v === "auto" ? null : Number(v) })
    ));
    rows.push(rowToggle(t("instance.fmtThousands"), cur.thousands !== false, (v) => onChange({ thousands: v })));
    rows.push(rowSelect(t("instance.fmtNegative"), cur.negative || "minus", [
      ["minus", t("instance.negMinus")],
      ["red", t("instance.negRed")],
      ["paren", t("instance.negParen")],
      ["redparen", t("instance.negRedParen")]
    ], (v) => onChange({ negative: v })));
  } else {
    const presets = kind === "date" ? DATE_PRESETS : kind === "datetime" ? DATETIME_PRESETS : TIME_PRESETS;
    const opts = presets.map((p) => [p, formatDate(SAMPLE_DATE, p, grid.i18n) + "  (" + p + ")"]);
    opts.push(["__custom__", t("instance.fmtCustom")]);
    const isCustom = !presets.includes(cur.pattern);
    const preview = el("span.lattice-fmt-preview", { text: formatDate(SAMPLE_DATE, cur.pattern, grid.i18n) });
    const patInput = el("input.lattice-set-input", { type: "text", value: cur.pattern || "", title: "dd mm yyyy \xB7 d m \xB7 mmmm mmm \xB7 ddd dddd \xB7 HH H \xB7 nn \xB7 ss" });
    const setPattern = (pattern) => {
      preview.textContent = formatDate(SAMPLE_DATE, pattern, grid.i18n);
      onChange({ pattern });
    };
    patInput.addEventListener("input", () => setPattern(patInput.value));
    rows.push(rowSelect(t("instance.fmtPattern"), isCustom ? "__custom__" : cur.pattern, opts, (v) => {
      if (v === "__custom__") {
        patInput.focus();
        return;
      }
      patInput.value = v;
      setPattern(v);
    }));
    rows.push(field(t("instance.fmtCustom"), patInput));
    rows.push(field("", preview));
  }
  return rows;
}
function field(labelText, control) {
  return el("label.lattice-set-row", {}, [el("span.lattice-set-label", { text: labelText }), control]);
}
function rowToggle(labelText, value, onChange) {
  const cb = el("input", { type: "checkbox", checked: !!value });
  cb.addEventListener("change", () => onChange(cb.checked));
  return field(labelText, cb);
}
function rowSelect(labelText, value, options, onChange) {
  const sel = el("select.lattice-set-input");
  for (const [val, lab] of options) sel.appendChild(el("option", { value: val, text: lab }));
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return field(labelText, sel);
}
function rowText(labelText, value, placeholder, onChange) {
  const inp = el("input.lattice-set-input", { type: "text", value: value || "", placeholder: placeholder || "" });
  inp.addEventListener("input", () => onChange(inp.value));
  return field(labelText, inp);
}
function rowRange(labelText, value, min, max, onChange) {
  const wrap = el("span.lattice-set-range");
  const range = el("input", { type: "range", min, max, step: 1, value });
  const out = el("span.lattice-set-range-val", { text: value + "px" });
  range.addEventListener("input", () => {
    out.textContent = range.value + "px";
    onChange(Number(range.value));
  });
  wrap.append(range, out);
  return field(labelText, wrap);
}
function rgb2hex(s) {
  if (!s) return null;
  s = s.trim();
  if (s[0] === "#") return s.length === 4 ? "#" + [...s.slice(1)].map((c) => c + c).join("") : s.slice(0, 7);
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseInt(x, 10));
  return "#" + p.slice(0, 3).map((n) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, "0")).join("");
}
function effVar(grid, name) {
  return getComputedStyle(grid.el).getPropertyValue(name).trim();
}
function colorGrid(items, grid, cv, merge) {
  const wrap = el("div.lattice-color-grid");
  for (const [label, name] of items) {
    const inp = el("input.lattice-scale-color", { type: "color", value: cv[name] || rgb2hex(effVar(grid, name)) || "#000000" });
    inp.addEventListener("input", () => merge(name, inp.value));
    wrap.appendChild(el("label.lattice-color-cell", {}, [inp, el("span.lattice-color-lbl", { text: label })]));
  }
  return wrap;
}
var FONTS = [
  { label: "\u2014 dle motivu / tabulky \u2014", value: "" },
  { label: "Syst\xE9mov\xE9", value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: "Sans (Arial)", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif (Georgia)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { label: "Inter", value: '"Inter", sans-serif', google: "Inter:wght@400;600;700" },
  { label: "Roboto", value: '"Roboto", sans-serif', google: "Roboto:wght@400;500;700" },
  { label: "Open Sans", value: '"Open Sans", sans-serif', google: "Open+Sans:wght@400;600;700" },
  { label: "Lato", value: '"Lato", sans-serif', google: "Lato:wght@400;700" },
  { label: "Montserrat", value: '"Montserrat", sans-serif', google: "Montserrat:wght@400;600;700" },
  { label: "Poppins", value: '"Poppins", sans-serif', google: "Poppins:wght@400;600;700" },
  { label: "Nunito", value: '"Nunito", sans-serif', google: "Nunito:wght@400;600;700" },
  { label: "Merriweather (serif)", value: '"Merriweather", serif', google: "Merriweather:wght@400;700" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace', google: "JetBrains+Mono:wght@400;600" }
];
var _gfLoaded = false;
function ensureGoogleFonts() {
  if (_gfLoaded || typeof document === "undefined") return;
  _gfLoaded = true;
  const fams = FONTS.filter((f) => f.google).map((f) => "family=" + f.google);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + fams.join("&") + "&display=swap";
  document.head.appendChild(link);
}
function fontSelectRow(label, value, onChange) {
  ensureGoogleFonts();
  const sel = el("select.lattice-set-input.lattice-font-select");
  const known = FONTS.some((f) => f.value === value);
  if (value && !known) {
    const o = el("option", { value, text: "Vlastn\xED", style: { fontFamily: value } });
    sel.appendChild(o);
  }
  for (const f of FONTS) {
    const o = el("option", { value: f.value, text: f.label });
    if (f.value) o.style.fontFamily = f.value;
    sel.appendChild(o);
  }
  sel.value = value || "";
  sel.style.fontFamily = value || "";
  sel.addEventListener("change", () => {
    sel.style.fontFamily = sel.value;
    onChange(sel.value);
  });
  return field(label, sel);
}
function cssPxRow(label, name, grid, cv, merge) {
  const inp = el("input.lattice-set-input", {
    type: "number",
    min: 0,
    max: 40,
    step: 1,
    value: cv[name] ? parseInt(cv[name], 10) : "",
    placeholder: effVar(grid, name) || "px"
  });
  inp.addEventListener("change", () => merge(name, inp.value !== "" ? inp.value + "px" : null));
  return field(label, inp);
}
function cssSelectRow(label, name, cv, options, merge) {
  const sel = el("select.lattice-set-input");
  for (const [v, l] of options) sel.appendChild(el("option", { value: v, text: l }));
  sel.value = cv[name] || "";
  sel.addEventListener("change", () => merge(name, sel.value || null));
  return field(label, sel);
}
function rowScaleColors(labelText, colors, onChange) {
  const wrap = el("span.lattice-scale-colors");
  const inputs = [0, 1, 2].map((i) => {
    const inp = el("input.lattice-scale-color", { type: "color", value: colors[i] || "#888888" });
    inp.addEventListener("input", () => onChange(inputs.map((x) => x.value)));
    return inp;
  });
  wrap.append(...inputs);
  return field(labelText, wrap);
}

// src/features/gear.js
var Gear = class {
  constructor(grid) {
    this.grid = grid;
    this.panel = null;
    this.off = null;
    this._search = "";
  }
  toggle(anchor) {
    if (this.panel) return this.close();
    this.open(anchor);
  }
  open(anchor) {
    const panel = el("div.lattice-panel.lattice-gear-panel");
    this.anchor = anchor;
    this.renderList(panel);
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.panel = panel;
    this.off = onOutside(panel, (e) => {
      if (anchor.contains(e.target)) return;
      this.close();
    });
  }
  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }
  refresh() {
    if (this.panel) {
      this.renderList(this.panel);
      if (this.anchor) positionUnder(this.panel, this.anchor);
    }
  }
  renderList(panel) {
    clear(panel);
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const tools = el("div.lattice-panel-tools");
    const fitBtn = el("button.lattice-icon-btn", { type: "button", title: t("columns.fitWidth"), html: FIT_SVG });
    fitBtn.addEventListener("click", () => grid.autoFitColumns());
    tools.appendChild(fitBtn);
    const clearBtn = el("button.lattice-icon-btn", { type: "button", title: t("columns.clearFilters"), html: CLEAR_FILTER_SVG });
    clearBtn.addEventListener("click", () => grid.clearAllFilters());
    tools.appendChild(clearBtn);
    const resetBtn = el("button.lattice-icon-btn.is-danger", { type: "button", title: t("columns.reset"), html: RESET_SVG });
    resetBtn.addEventListener("click", () => {
      grid.resetColumns();
    });
    tools.appendChild(resetBtn);
    panel.appendChild(el("div.lattice-panel-head", {}, [
      el("span.lattice-panel-title", { text: t("columns.manage") }),
      tools
    ]));
    panel.appendChild(this.buildPresets());
    const search = el("input.lattice-col-search", { type: "text", placeholder: t("presets.searchColumn"), value: this._search });
    search.addEventListener("input", () => {
      this._search = search.value;
      this.filterColumnRows();
    });
    panel.appendChild(search);
    const list = el("div.lattice-gear-list");
    grid.columns.forEach((col) => list.appendChild(this.buildRow(col)));
    panel.appendChild(list);
    this._listEl = list;
    this.filterColumnRows();
  }
  /* ---------------- presety ---------------- */
  buildPresets() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const wrap = el("div.lattice-preset-box");
    const presets = grid.presets.all();
    if (presets.length === 0) {
      wrap.appendChild(el("div.lattice-preset-empty", { text: t("presets.none") }));
    } else {
      const list = el("div.lattice-preset-list");
      for (const p of presets) list.appendChild(this.buildPresetRow(p));
      wrap.appendChild(list);
    }
    const input = el("input.lattice-preset-input", { type: "text", placeholder: t("presets.namePlaceholder") });
    this._nameInput = input;
    const saveBtn = el("button.lattice-icon-btn", { type: "button", title: t("presets.saveLocal"), html: BOOKMARK_SVG });
    const doSaveLocal = () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      grid.presets.saveLocal(name);
      input.value = "";
      this.refresh();
    };
    saveBtn.addEventListener("click", doSaveLocal);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSaveLocal();
    });
    const rowEls = [input, saveBtn];
    if (grid.presets.canSaveGlobal()) {
      const globeBtn = el("button.lattice-icon-btn.is-success", { type: "button", title: t("presets.saveGlobal"), html: GLOBE_SVG });
      globeBtn.addEventListener("click", () => {
        const name = input.value.trim();
        if (!name) {
          input.focus();
          return;
        }
        grid.presets.saveGlobal(name);
        input.value = "";
        this.refresh();
      });
      rowEls.push(globeBtn);
    }
    wrap.appendChild(el("div.lattice-preset-save", {}, rowEls));
    return wrap;
  }
  buildPresetRow(preset) {
    const grid = this.grid;
    const active = grid._activePresetId === preset.id;
    const row = el("div.lattice-preset-row", { class: active ? "is-active" : "", title: preset.name });
    const name = el("span.lattice-preset-name", { text: preset.name });
    name.addEventListener("click", () => grid.applyPreset(preset));
    row.appendChild(name);
    if (preset.scope === "global") {
      row.appendChild(el("span.lattice-preset-badge", { title: grid.i18n.t("presets.global"), html: GLOBE_SVG }));
    }
    const del = el("button.lattice-preset-del", { type: "button", title: "\xD7", text: "\xD7" });
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await grid.presets.remove(preset);
      this.refresh();
    });
    row.appendChild(del);
    return row;
  }
  /* ---------------- sloupce ---------------- */
  filterColumnRows() {
    if (!this._listEl) return;
    const q = this._search.trim().toLowerCase();
    for (const row of this._listEl.children) {
      const title = row.dataset.title || "";
      row.style.display = !q || title.includes(q) ? "" : "none";
    }
  }
  buildRow(col) {
    const grid = this.grid;
    const row = el("div.lattice-gear-row", { draggable: true, dataset: { field: col.field, title: String(col.title).toLowerCase() } });
    const grip = el("span.lattice-grip", { text: "\u22EE\u22EE", title: "P\u0159et\xE1hnout" });
    const cb = el("input", { type: "checkbox", checked: col.visible });
    cb.addEventListener("change", () => grid.setColumnVisible(col.field, cb.checked));
    const label = el("label.lattice-gear-label", {}, [cb, el("span", { text: col.title })]);
    const tools = el("div.lattice-gear-tools");
    const pin = el("button.lattice-pin", {
      type: "button",
      title: "Ukotvit (vlevo/vpravo)",
      class: [col.frozen ? "is-active" : "", col.frozen === "right" ? "is-right" : ""].filter(Boolean).join(" "),
      text: "\u{1F4CC}"
    });
    if (col.frozenAllowed === false) pin.disabled = true;
    pin.addEventListener("click", () => {
      const next = col.frozen === true || col.frozen === "left" ? "right" : col.frozen === "right" ? false : true;
      grid.setColumnFrozen(col.field, next);
    });
    tools.appendChild(pin);
    if (col.filter) {
      const ftog = el("button.lattice-fbtn", {
        type: "button",
        title: grid.i18n.t("columns.filterToggle"),
        class: col.filterEnabled ? "is-active" : "",
        html: FUNNEL_SVG
      });
      ftog.addEventListener("click", () => grid.setColumnFilterEnabled(col.field, !col.filterEnabled));
      tools.appendChild(ftog);
    } else {
      tools.appendChild(el("span.lattice-gslot-empty"));
    }
    const grpBtn = el("button.lattice-gbtn", {
      type: "button",
      title: col.group ? grid.i18n.t("columns.groupSet") + ": " + col.group : grid.i18n.t("columns.groupSet"),
      class: col.group ? "is-active" : "",
      html: GROUP_SVG
    });
    grpBtn.addEventListener("click", () => openGroupPicker(grpBtn, grid, col, () => this.refresh()));
    tools.appendChild(grpBtn);
    const t = grid.i18n.t.bind(grid.i18n);
    const rotBtn = el("button.lattice-gbtn", {
      type: "button",
      title: t("columns.headerRotate"),
      class: col.headerRotate != null ? "is-active" : "",
      html: ROTATE_SVG
    });
    rotBtn.addEventListener("click", () => {
      const cur = col.headerRotate == null ? "inherit" : col.headerRotate;
      openMenu(rotBtn, [
        { value: "inherit", label: t("columns.rotateInherit"), active: cur === "inherit" },
        { value: "none", label: t("columns.rotateNone"), active: cur === "none" },
        { value: "90", label: t("columns.rotate90"), active: cur === "90" },
        { value: "270", label: t("columns.rotate270"), active: cur === "270" }
      ], (v) => grid.setColumnHeaderRotate(col.field, v === "inherit" ? null : v));
    });
    tools.appendChild(rotBtn);
    const sumBtn = el("button.lattice-gbtn", {
      type: "button",
      title: t("columns.summary"),
      class: col.summary && col.summary.length || col.rowSummary && col.rowSummary.length ? "is-active" : "",
      text: "\u03A3"
    });
    sumBtn.addEventListener("click", () => openSummaryPicker(sumBtn, grid, col));
    tools.appendChild(sumBtn);
    if (formatKind(col.type)) {
      const fmtBtn = el("button.lattice-gbtn.lattice-fmtbtn", {
        type: "button",
        title: t("instance.colFormatTitle"),
        class: col.format ? "is-active" : "",
        text: "0.0"
      });
      fmtBtn.addEventListener("click", () => openFormatPicker(fmtBtn, grid, col));
      tools.appendChild(fmtBtn);
    } else {
      tools.appendChild(el("span.lattice-gslot-empty"));
    }
    if (!ROWGROUP_EXCLUDE.has(col.type)) {
      const level = grid.rowGroupLevel(col.field);
      const rgBtn = el("button.lattice-gbtn.lattice-rgbtn", {
        type: "button",
        title: t("columns.rowGroupToggle"),
        class: level ? "is-active" : "",
        html: ROWGROUP_SVG + (level ? '<span class="lattice-rg-badge">' + level + "</span>" : "")
      });
      rgBtn.addEventListener("click", () => grid.toggleRowGroup(col.field));
      tools.appendChild(rgBtn);
    } else {
      tools.appendChild(el("span.lattice-gslot-empty"));
    }
    row.append(grip, label, tools);
    this.wireRowDrag(row, col);
    return row;
  }
  wireRowDrag(row, col) {
    const grid = this.grid;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      grid._gearDrag = col.field;
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      grid._gearDrag = null;
    });
    row.addEventListener("dragover", (e) => {
      if (!grid._gearDrag || grid._gearDrag === col.field) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      row.classList.toggle("drop-before", before);
      row.classList.toggle("drop-after", !before);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = grid._gearDrag;
      row.classList.remove("drop-before", "drop-after");
      if (!from || from === col.field) return;
      const r = row.getBoundingClientRect();
      grid.moveColumn(from, col.field, e.clientY < r.top + r.height / 2 ? "before" : "after");
    });
  }
};
function positionUnder(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  panel.style.position = "absolute";
  panel.style.top = window.scrollY + r.bottom + 4 + "px";
  const left = window.scrollX + r.right - panel.offsetWidth;
  panel.style.left = Math.max(8, left) + "px";
}
function openGroupPicker(anchor, grid, col, onDone) {
  document.querySelectorAll(".lattice-group-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const cur = col.group || null;
  const menu = el("div.lattice-menu.lattice-group-menu");
  const pick2 = (g) => {
    close();
    grid.setColumnGroup(col.field, g);
    onDone && onDone();
  };
  const none = el("div.lattice-menu-item", { class: cur === null ? "is-active" : "", text: t("columns.noGroup") });
  none.addEventListener("click", () => pick2(null));
  menu.appendChild(none);
  for (const g of grid.groupNames()) {
    const item = el("div.lattice-menu-item", { class: g === cur ? "is-active" : "", text: g });
    item.addEventListener("click", () => pick2(g));
    menu.appendChild(item);
  }
  const input = el("input.lattice-group-new", { type: "text", placeholder: t("columns.newGroup") });
  const add = () => {
    const v = input.value.trim();
    if (v) pick2(v);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });
  const addBtn = el("button.lattice-icon-btn", { type: "button", text: "+" });
  addBtn.addEventListener("click", add);
  menu.appendChild(el("div.lattice-group-newrow", {}, [input, addBtn]));
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  setTimeout(() => input.focus(), 0);
  return close;
}
function openSummaryPicker(anchor, grid, col) {
  document.querySelectorAll(".lattice-summary-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const labelKey = { min: "columns.summaryMin", max: "columns.summaryMax", sum: "columns.summarySum", avg: "columns.summaryAvg", count: "columns.summaryCount" };
  const menu = el("div.lattice-menu.lattice-summary-menu");
  const section = (titleKey, getArr, setArr) => {
    const current = new Set(getArr() || []);
    menu.appendChild(el("div.lattice-summary-menu-head", { text: t(titleKey) }));
    for (const fn of availableSummaries(col)) {
      const item = el("div.lattice-menu-item", { class: current.has(fn) ? "is-selected" : "" }, [
        el("span.lattice-ms-check", { text: current.has(fn) ? "\u2713" : "" }),
        el("span.lattice-summary-menu-sym", { text: SUMMARY_SYMBOL[fn] }),
        el("span", { text: t(labelKey[fn]) })
      ]);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (current.has(fn)) current.delete(fn);
        else current.add(fn);
        item.classList.toggle("is-selected", current.has(fn));
        item.querySelector(".lattice-ms-check").textContent = current.has(fn) ? "\u2713" : "";
        setArr(SUMMARY_ORDER.filter((f) => current.has(f)));
      });
      menu.appendChild(item);
    }
  };
  section("columns.summaryForColumns", () => col.summary, (v) => grid.setColumnSummary(col.field, v));
  menu.appendChild(el("div.lattice-summary-menu-sep"));
  section("columns.summaryForRows", () => col.rowSummary, (v) => grid.setColumnRowSummary(col.field, v));
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function openFormatPicker(anchor, grid, col) {
  document.querySelectorAll(".lattice-format-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const kind = formatKind(col.type);
  const menu = el("div.lattice-menu.lattice-format-menu");
  function render() {
    clear(menu);
    const isCustom = !!col.format;
    menu.appendChild(el("div.lattice-summary-menu-head", { text: t("instance.colFormatTitle") }));
    menu.appendChild(radioRow(t("instance.colFormatGlobal"), !isCustom, () => {
      grid.setColumnFormat(col.field, null);
      render();
    }));
    menu.appendChild(radioRow(t("instance.colFormatCustom"), isCustom, () => {
      grid.setColumnFormat(col.field, Object.assign({}, grid.effectiveFormat(col)));
      render();
    }));
    if (isCustom) {
      const fields = el("div.lattice-fmt-fields");
      for (const f of formatFields(kind, grid.effectiveFormat(col), grid, (patch) => grid.setColumnFormat(col.field, patch))) fields.appendChild(f);
      menu.appendChild(fields);
    }
    if (kind === "number" || kind === "money") menu.appendChild(buildCondScale(grid, col, render));
  }
  render();
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function radioRow(label, checked, onPick) {
  const row = el("label.lattice-menu-item.lattice-fmt-radio", {}, [
    el("input", { type: "radio", checked: !!checked }),
    el("span", { text: label })
  ]);
  row.querySelector("input").addEventListener("change", () => onPick());
  return row;
}
function buildCondScale(grid, col, rerender) {
  const t = grid.i18n.t.bind(grid.i18n);
  const cf = col.condFormat || {};
  const frag = document.createDocumentFragment();
  frag.appendChild(el("div.lattice-summary-menu-sep"));
  frag.appendChild(el("div.lattice-summary-menu-head", { text: t("instance.condScale") }));
  frag.appendChild(csToggle(t("instance.condScaleOn"), !!cf.on, (v) => {
    grid.setColumnCondFormat(col.field, { on: v });
    rerender();
  }));
  if (!cf.on) return frag;
  const levels = cf.levels || 3;
  frag.appendChild(csField(t("instance.condLevels"), csSelect(String(levels), [["3", "3"], ["5", "5"], ["7", "7"]], (v) => {
    grid.setColumnCondFormat(col.field, { levels: Number(v), thresholds: null });
    rerender();
  })));
  frag.appendChild(csField(t("instance.condApply"), csSelect(cf.mode || "bg", [["bg", t("instance.condApplyBg")], ["text", t("instance.condApplyText")]], (v) => {
    grid.setColumnCondFormat(col.field, { mode: v });
    rerender();
  })));
  frag.appendChild(csToggle(t("instance.condReverse"), !!cf.reverse, (v) => {
    grid.setColumnCondFormat(col.field, { reverse: v });
    rerender();
  }));
  const th = Array.isArray(cf.thresholds) && cf.thresholds.length === levels - 1 ? cf.thresholds.slice() : grid.autoThresholds(col.field, levels);
  const row = el("div.lattice-cond-thresholds");
  const inputs = [];
  for (let i = 0; i < levels - 1; i++) {
    const inp = el("input.lattice-set-input.lattice-cond-th", { type: "number", value: th[i] != null ? th[i] : "" });
    inp.addEventListener("change", () => {
      const vals = inputs.map((x) => Number(x.value)).filter((n) => Number.isFinite(n));
      if (vals.length === levels - 1) {
        grid.setColumnCondFormat(col.field, { thresholds: vals.sort((a, b) => a - b) });
        rerender();
      }
    });
    inputs.push(inp);
    row.appendChild(inp);
  }
  frag.appendChild(csField(t("instance.condThresholds"), row));
  const prev = el("div.lattice-cond-preview");
  const colors = grid.instance.scaleColors || DEFAULT_SCALE_COLORS;
  for (let i = 0; i < levels; i++) {
    const c = levelColor(colors, i, levels, cf.reverse, cf.mode);
    if (c.text) prev.appendChild(el("span.lattice-cond-swatch.is-text", { style: { color: c.text }, text: String(i + 1) }));
    else prev.appendChild(el("span.lattice-cond-swatch", { style: { background: c.bg, color: c.fg } }));
  }
  frag.appendChild(prev);
  return frag;
}
function csField(label, control) {
  return el("label.lattice-set-row", {}, [el("span.lattice-set-label", { text: label }), control]);
}
function csToggle(label, value, onChange) {
  const cb = el("input", { type: "checkbox", checked: !!value });
  cb.addEventListener("change", () => onChange(cb.checked));
  return csField(label, cb);
}
function csSelect(value, options, onChange) {
  const sel = el("select.lattice-set-input");
  for (const [v, lab] of options) sel.appendChild(el("option", { value: v, text: lab }));
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
var GROUP_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h8v6H3V5zm10 0h8v2h-8V5zm0 4h8v2h-8V9zM3 13h18v2H3v-2zm0 4h18v2H3v-2z"/></svg>';
var ROWGROUP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 4h18v2H3V4zm4 4h14v2H7V8zm0 4h14v2H7v-2zM3 8h2v10H3V8zm4 8h14v2H7v-2z"/></svg>';
var ROWGROUP_EXCLUDE = /* @__PURE__ */ new Set(["image", "html", "progress", "rating", "color"]);
var ROTATE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.5 4l4.5 12h-2l-1-3H5l-1 3H2L6.5 4h1zM6 5.9L4.6 11h2.8L6 5.9zM20 13l-4 4-4-4h3V4h2v9h3z"/></svg>';
var FUNNEL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
var FIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7v10H2V7h2zm18 0v10h-2V7h2zM8 11l-3 1 3 1v-2zm8 0v2l3-1-3-1zM6 11h12v2H6v-2z"/></svg>';
var CLEAR_FILTER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
var RESET_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5V2L8 6l4 4V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg>';
var GLOBE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.9 6h-2.5a15.7 15.7 0 00-1.3-3.4A8 8 0 0118.9 8zM12 4c.8 1.1 1.4 2.4 1.8 4h-3.6c.4-1.6 1-2.9 1.8-4zM4.3 14a7.8 7.8 0 010-4h2.9a17 17 0 000 4zm.8 2h2.5c.3 1.2.8 2.4 1.3 3.4A8 8 0 015.1 16zm2.5-8H5.1a8 8 0 013.8-3.4C8.4 5.6 7.9 6.8 7.6 8zM12 20c-.8-1.1-1.4-2.4-1.8-4h3.6c-.4 1.6-1 2.9-1.8 4zm2.2-6H9.8a15 15 0 010-4h4.4a15 15 0 010 4zm.6 5.4c.5-1 1-2.2 1.3-3.4h2.5a8 8 0 01-3.8 3.4zm2.1-5.4a17 17 0 000-4h2.9a7.8 7.8 0 010 4z"/></svg>';
var BOOKMARK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 011 1v18l-7-4-7 4V3a1 1 0 011-1z"/></svg>';

// src/features/menu.js
function openMenu(anchor, items, onPick) {
  const menu = buildMenu(items, () => close(), onPick);
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function openMenuAt(x, y, items, onPick) {
  document.querySelectorAll(".lattice-menu").forEach((m) => m.remove());
  const menu = buildMenu(items, () => close(), onPick);
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const left = Math.min(x, window.scrollX + vw - menu.offsetWidth - 8);
  const top = Math.min(y, window.scrollY + vh - menu.offsetHeight - 8);
  menu.style.position = "absolute";
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";
  menu.style.visibility = "";
  const off = onOutside(menu, () => close());
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function buildMenu(items, close, onPick) {
  const menu = el("div.lattice-menu");
  for (const it of items) {
    if (it.separator) {
      menu.appendChild(el("div.lattice-menu-sep"));
      continue;
    }
    const cls = [it.active ? "is-active" : "", it.disabled ? "is-disabled" : "", it.danger ? "is-danger" : ""].filter(Boolean).join(" ");
    const row = el("div.lattice-menu-item", { class: cls, text: it.label });
    if (!it.disabled) row.addEventListener("click", () => {
      close();
      onPick(it.value, it);
    });
    menu.appendChild(row);
  }
  return menu;
}

// src/features/popup.js
function openPopup(anchor, builder, opts = {}) {
  document.querySelectorAll(".lattice-popup").forEach((p) => p._close ? p._close() : p.remove());
  const popup = el("div.lattice-popup" + (opts.className ? "." + opts.className : ""));
  let off;
  const close = () => {
    off?.();
    popup.remove();
  };
  popup._close = close;
  const content = builder(close);
  if (content instanceof Node) popup.appendChild(content);
  else popup.innerHTML = String(content == null ? "" : content);
  document.body.appendChild(popup);
  place(popup, anchor, opts.align);
  off = onOutside(popup, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  return close;
}
function place(popup, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  popup.style.position = "absolute";
  popup.style.top = window.scrollY + r.bottom + 4 + "px";
  let left = align === "right" ? window.scrollX + r.right - popup.offsetWidth : window.scrollX + r.left;
  const maxLeft = window.scrollX + vw - popup.offsetWidth - 8;
  popup.style.left = Math.max(8, Math.min(left, maxLeft)) + "px";
}

// src/features/rowMove.js
var ROW_MIME = "application/x-lattice-row";
function attachMoveHandle(handle, renderer, getIndex) {
  handle.draggable = true;
  handle.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    const idx = getIndex();
    renderer._dragFrom = idx;
    e.dataTransfer.effectAllowed = "move";
    const grid = renderer.grid;
    const row = grid.rows[idx];
    const payload = JSON.stringify({ src: grid.options.id, key: grid.rowKey(row), row });
    try {
      e.dataTransfer.setData(ROW_MIME, payload);
      e.dataTransfer.setData("text/plain", payload);
    } catch {
    }
  });
  handle.addEventListener("dragend", () => {
    renderer._dragFrom = null;
    clearAll(renderer);
  });
}
function attachExternalDrop(target, renderer) {
  const grid = renderer.grid;
  target.addEventListener("dragover", (e) => {
    if (renderer._dragFrom != null) return;
    if (!Array.from(e.dataTransfer.types || []).includes(ROW_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    target.classList.add("is-drop-target");
  });
  target.addEventListener("dragleave", (e) => {
    if (!target.contains(e.relatedTarget)) target.classList.remove("is-drop-target");
  });
  target.addEventListener("drop", (e) => {
    target.classList.remove("is-drop-target");
    if (renderer._dragFrom != null) return;
    const raw = e.dataTransfer.getData(ROW_MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || !payload.row || payload.src === grid.options.id) return;
    e.preventDefault();
    grid.receiveExternalRow(payload);
  });
}
function attachDropZone(rowEl, renderer, getIndex, allowInside) {
  rowEl.addEventListener("dragover", (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    mark(rowEl, computeZone(e, rowEl, allowInside));
  });
  rowEl.addEventListener("dragleave", (e) => {
    if (!rowEl.contains(e.relatedTarget)) clearMark(rowEl);
  });
  rowEl.addEventListener("drop", (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    const zone = computeZone(e, rowEl, allowInside);
    const from = renderer._dragFrom;
    const to = getIndex();
    renderer._dragFrom = null;
    clearAll(renderer);
    renderer.grid.moveRow(from, to, zone);
  });
}
function attachGroupDropZone(headerEl, renderer, node) {
  headerEl.addEventListener("dragover", (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    headerEl.classList.add("drop-group");
  });
  headerEl.addEventListener("dragleave", (e) => {
    if (!headerEl.contains(e.relatedTarget)) headerEl.classList.remove("drop-group");
  });
  headerEl.addEventListener("drop", (e) => {
    if (renderer._dragFrom == null) return;
    e.preventDefault();
    const from = renderer._dragFrom;
    renderer._dragFrom = null;
    clearAll(renderer);
    headerEl.classList.remove("drop-group");
    renderer.grid.moveRowToGroupHeader(from, node);
  });
}
function computeZone(e, rowEl, allowInside) {
  const r = rowEl.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (allowInside) {
    if (y < r.height / 3) return "before";
    if (y > r.height * 2 / 3) return "after";
    return "inside";
  }
  return y < r.height / 2 ? "before" : "after";
}
function mark(rowEl, zone) {
  clearMark(rowEl);
  rowEl.classList.add("drop-" + zone);
}
function clearMark(rowEl) {
  rowEl.classList.remove("drop-before", "drop-after", "drop-inside");
}
function clearAll(renderer) {
  for (const el2 of renderer.nodes.body.querySelectorAll(".drop-before, .drop-after, .drop-inside, .drop-group")) {
    el2.classList.remove("drop-before", "drop-after", "drop-inside", "drop-group");
  }
}

// src/render/Renderer.js
var Renderer = class {
  constructor(grid) {
    this.grid = grid;
    this.nodes = {};
  }
  /** Postaví neměnný skelet a připojí ho do mount elementu. */
  mount() {
    const root = this.grid.el;
    root.classList.add("lattice");
    root.setAttribute("role", "grid");
    clear(root);
    const toolbar = el("div.lattice-toolbar");
    const selectionBar = el("div.lattice-selection-bar");
    const topPager = el("div.lattice-footer.lattice-top-pager");
    const universalBar = el("div.lattice-universal-bar");
    const externalFilters = el("div.lattice-external-filters");
    const topScroll = el("div.lattice-top-scroll");
    const topScrollInner = el("div.lattice-top-scroll-inner");
    topScroll.appendChild(topScrollInner);
    const viewport = el("div.lattice-viewport");
    const table = el("div.lattice-table");
    const header = el("div.lattice-header");
    const groupRow = el("div.lattice-group-row");
    const headerRow = el("div.lattice-header-row");
    const filterRow = el("div.lattice-filter-row");
    const pinnedTop = el("div.lattice-pinned.lattice-pinned-top");
    const pinnedBottom = el("div.lattice-pinned.lattice-pinned-bottom");
    const body = el("div.lattice-body");
    const summaryBar = el("div.lattice-summary-bar");
    const footer = el("div.lattice-footer");
    const overlay = el("div.lattice-overlay");
    header.append(groupRow, headerRow, filterRow, pinnedTop);
    table.append(header, body, pinnedBottom);
    viewport.append(table);
    const rangeStatus = el("div.lattice-range-status");
    root.append(toolbar, selectionBar, topPager, universalBar, externalFilters, topScroll, viewport, summaryBar, footer, rangeStatus, overlay);
    this.nodes = { root, toolbar, selectionBar, topPager, universalBar, externalFilters, topScroll, topScrollInner, viewport, table, header, groupRow, headerRow, filterRow, pinnedTop, pinnedBottom, body, summaryBar, footer, rangeStatus, overlay };
    let syncing = false;
    topScroll.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      viewport.scrollLeft = topScroll.scrollLeft;
      syncing = false;
    });
    viewport.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      topScroll.scrollLeft = viewport.scrollLeft;
      syncing = false;
    });
    this._onResize = () => {
      if (this.grid.responsive) this._reflowResponsive();
      this.applyLayout();
    };
    window.addEventListener("resize", this._onResize);
    if (this.grid.responsive) {
      this._computeResponsive();
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => this._reflowResponsive());
        this._ro.observe(viewport);
      }
    }
    this.renderToolbar();
    this.applyInstanceStyles();
    if (this.grid.range) this.grid.range.attach(root, body);
    if (this.grid.acceptExternalRows) attachExternalDrop(viewport, this);
    if (this.grid.history) {
      if (root.tabIndex < 0) root.tabIndex = 0;
      root.addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.target.closest("input, textarea, select")) return;
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          this.grid.undo();
        } else if (k === "y" || k === "z" && e.shiftKey) {
          e.preventDefault();
          this.grid.redo();
        }
      });
    }
    if (this.grid.progressive) {
      viewport.addEventListener("scroll", () => {
        if (this.grid.progressive === "scroll" && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 80) this.grid.loadMore();
      });
    }
  }
  destroy() {
    window.removeEventListener("resize", this._onResize);
    this._ro?.disconnect();
    this.grid.range?.destroy();
    clear(this.grid.el);
    this.grid.el.classList.remove("lattice");
  }
  /* -------- pořadí sloupců pro render (frozen seskupené) -------- */
  /** Viditelné sloupce rozdělené na left-frozen / normal / right-frozen. */
  renderColumns() {
    const left = [], mid = [], right = [];
    const mv = this.moveColumn();
    if (mv) left.push(mv);
    const sc = this.selectionColumn();
    if (sc) left.push(sc);
    const rn = this.rowNumberColumn();
    if (rn) left.push(rn);
    const grid = this.grid;
    const grouped = new Set(grid.groupFields());
    this._menuIdField = null;
    if (grid.hasActions() && grid.instance.actionsLayout === "menu" && !rn) {
      const idCol = grid.columns.find((c) => c.visible && c.type === "id" && !grouped.has(c.field));
      if (idCol) this._menuIdField = idCol.field;
      else left.push(this.rowNumberColumn(true));
    }
    const collapsed = grid.responsive && this._collapsed ? this._collapsed : null;
    this._collapsedCols = [];
    for (const c of grid.columns) {
      if (!c.visible) continue;
      if (grouped.has(c.field)) continue;
      if (c.frozen === "right") right.push(c);
      else if (c.frozen) left.push(c);
      else if (collapsed && collapsed.has(c.field)) this._collapsedCols.push(c);
      else mid.push(c);
    }
    if (grid.hasActions() && grid.instance.actionsLayout === "column") right.push(this.actionsColumn());
    for (const rs of this.rowSummaryColumns()) right.push(rs);
    return { list: [...left, ...mid, ...right], left, mid, right };
  }
  /** Syntetický sloupec s úchytem pro přetahování řádků (nebo null). */
  moveColumn() {
    if (!this.grid.isMovable()) return null;
    return {
      field: "__move__",
      title: "",
      type: "text",
      filter: null,
      group: null,
      frozen: true,
      frozenAllowed: false,
      visible: true,
      align: "center",
      minWidth: 28,
      width: 30,
      availableFilters: [],
      filterEnabled: false,
      _move: true
    };
  }
  /** Syntetický výběrový sloupec s checkboxy (nebo null když výběr není zapnutý). */
  selectionColumn() {
    if (!this.grid.isSelectable() || this.grid.instance.selectColumn === false) return null;
    return {
      field: "__select__",
      title: "",
      type: "text",
      filter: null,
      group: null,
      frozen: true,
      frozenAllowed: false,
      visible: true,
      align: "center",
      minWidth: 40,
      width: this.grid.selectable.mode === "single" ? 40 : 54,
      availableFilters: [],
      filterEnabled: false,
      _select: true
    };
  }
  /** Syntetický sloupec „Akce" (poslední, ukotvený vpravo) s inline ikonami. */
  actionsColumn() {
    const n = this.grid.options.actions.length;
    return {
      field: "__actions__",
      title: this.grid.i18n.t("actions.title"),
      type: "text",
      filter: null,
      group: null,
      frozen: "right",
      frozenAllowed: false,
      visible: true,
      align: "center",
      minWidth: 54,
      width: Math.max(54, n * 30 + 14),
      availableFilters: [],
      filterEnabled: false,
      _actions: true
    };
  }
  /**
   * Aktivní funkce souhrnu řádků (sjednocení col.rowSummary napříč viditelnými
   * sloupci, v pevném pořadí) + pro každou seznam zapojených sloupců.
   */
  rowSummaryModel() {
    const cols = this.grid.columns.filter((c) => c.visible && (c.rowSummary || []).length);
    const fns = SUMMARY_ORDER.filter((fn) => cols.some((c) => c.rowSummary.includes(fn)));
    return fns.map((fn) => ({
      fn,
      cols: cols.filter((c) => c.rowSummary.includes(fn) && (fn === "count" || isNumericType(c.type)))
    }));
  }
  /** Syntetické pravé sloupce se souhrnem přes řádek (jeden na funkci). */
  rowSummaryColumns() {
    return this.rowSummaryModel().map(({ fn, cols }) => ({
      field: "__rowsum_" + fn + "__",
      title: SUMMARY_SYMBOL[fn],
      type: "number",
      filter: null,
      group: null,
      frozen: "right",
      frozenAllowed: false,
      visible: true,
      align: "right",
      minWidth: 90,
      width: 130,
      availableFilters: [],
      filterEnabled: false,
      _rowsum: true,
      _fn: fn,
      _cols: cols
    }));
  }
  /** Syntetický úzký gutter s ⋮ menu akcí (když není číslování řádků). */
  actionsMenuColumn() {
    return {
      field: "__actions_menu__",
      title: "",
      type: "text",
      filter: null,
      group: null,
      frozen: true,
      frozenAllowed: false,
      visible: true,
      align: "center",
      minWidth: 30,
      width: 34,
      availableFilters: [],
      filterEnabled: false,
      _actionsMenu: true
    };
  }
  /**
   * Syntetický sloupec s čísly řádků (nebo null když je vypnutý).
   * `force` = vynutí sloupec i při rowNumbers 'none' (režim ⋮ menu bez ID sloupce).
   */
  rowNumberColumn(force = false) {
    const set = this.grid.instance.rowNumbers;
    const mode = set && set !== "none" ? set : force ? "continuous" : null;
    if (!mode) return null;
    const maxNum = mode === "perPage" ? Math.min(this.grid.pageSize, this.grid.total || this.grid.pageSize) : this.grid.total || 0;
    const digits = Math.max(2, String(Math.max(1, maxNum)).length);
    const menuActions = this.grid.hasActions() && this.grid.instance.actionsLayout === "menu";
    const width = this.grid.instance.rowNumberWidth || 22 + digits * 9 + (menuActions ? 22 : 0);
    return {
      field: "__rownum__",
      title: "#",
      type: "text",
      filter: null,
      group: null,
      frozen: true,
      frozenAllowed: false,
      visible: true,
      align: "right",
      minWidth: 36,
      width,
      availableFilters: [],
      filterEnabled: false,
      _rownum: true,
      _mode: mode,
      _menuActions: menuActions
    };
  }
  /* -------- layout: šířky + frozen offsety -------- */
  applyLayout() {
    const { list, left, right } = this.renderColumns();
    const widths = this.computeWidths(list);
    const totalWidth = list.reduce((s, c) => s + widths.get(c.field), 0);
    const noFill = this.grid.instance.layout === "fitData" || this.grid.instance.layout === "fitDataTable";
    this.nodes.table.style.width = totalWidth + "px";
    this.nodes.table.style.minWidth = noFill ? "0px" : "100%";
    this.nodes.topScrollInner.style.width = totalWidth + "px";
    const overflows = totalWidth > this.nodes.viewport.clientWidth + 1;
    this.nodes.topScroll.style.display = overflows ? "block" : "none";
    const leftOff = /* @__PURE__ */ new Map();
    let acc = 0;
    for (const c of left) {
      leftOff.set(c.field, acc);
      acc += widths.get(c.field);
    }
    const rightOff = /* @__PURE__ */ new Map();
    acc = 0;
    for (let i = right.length - 1; i >= 0; i--) {
      const c = right[i];
      rightOff.set(c.field, acc);
      acc += widths.get(c.field);
    }
    const groupEdges = /* @__PURE__ */ new Set();
    for (let k = 0; k < list.length - 1; k++) {
      if ((list[k].group || null) !== (list[k + 1].group || null)) groupEdges.add(list[k].field);
    }
    const frozenEdges = /* @__PURE__ */ new Set();
    if (left.length) frozenEdges.add(left[left.length - 1].field);
    if (right.length) frozenEdges.add(right[0].field);
    this.layout = { widths, leftOff, rightOff, list, groupEdges, frozenEdges };
    this.styleCells();
  }
  /**
   * Efektivní šířky sloupců podle layout režimu instance:
   *  - fitData / fitDataFill / fitDataTable: šířky dle obsahu (beze změny),
   *  - fitColumns ('fit'): proporčně vyplní šířku viewportu,
   *  - fitDataStretch: poslední sloupec pohltí zbývající šířku.
   */
  computeWidths(list) {
    const widths = /* @__PURE__ */ new Map();
    for (const c of list) widths.set(c.field, Math.max(c.minWidth, c.width));
    const mode = this.grid.instance.layout;
    const vpWidth = this.nodes.viewport.clientWidth;
    const total = list.reduce((s, c) => s + widths.get(c.field), 0);
    if (!vpWidth || !list.length || total >= vpWidth) return widths;
    if (mode === "fit" || mode === "fitColumns") {
      const targets = list.filter((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu);
      const flex = targets.length ? targets : list;
      const extra = vpWidth - total;
      const base = flex.reduce((s, c) => s + widths.get(c.field), 0) || 1;
      for (const c of flex) widths.set(c.field, widths.get(c.field) + extra * (widths.get(c.field) / base));
    } else if (mode === "fitDataStretch") {
      const last = [...list].reverse().find((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu);
      if (last) widths.set(last.field, widths.get(last.field) + (vpWidth - total));
    }
    return widths;
  }
  /** Aplikuje šířky + sticky offsety na už vykreslené buňky (bez re-buildu). */
  styleCells() {
    if (!this.layout) return;
    const { widths, leftOff, rightOff, groupEdges, frozenEdges } = this.layout;
    const cells = this.nodes.table.querySelectorAll("[data-field]");
    for (const cell of cells) {
      const field2 = cell.dataset.field;
      const w = widths.get(field2);
      if (w == null) continue;
      cell.style.width = w + "px";
      cell.style.left = "";
      cell.style.right = "";
      cell.classList.remove("is-frozen", "is-frozen-left", "is-frozen-right", "is-frozen-edge");
      cell.classList.toggle("is-gedge", groupEdges.has(field2) && !frozenEdges.has(field2));
      if (leftOff.has(field2)) {
        cell.classList.add("is-frozen", "is-frozen-left");
        cell.style.left = leftOff.get(field2) + "px";
      } else if (rightOff.has(field2)) {
        cell.classList.add("is-frozen", "is-frozen-right");
        cell.style.right = rightOff.get(field2) + "px";
      }
    }
    this.markFrozenEdges();
    this.sizeGroupRow();
  }
  markFrozenEdges() {
    const { left, right } = this.renderColumns();
    const edgeLeft = left[left.length - 1];
    const edgeRight = right[0];
    for (const cell of this.nodes.table.querySelectorAll("[data-field]")) {
      cell.classList.remove("is-frozen-edge-left", "is-frozen-edge-right");
      if (edgeLeft && cell.dataset.field === edgeLeft.field) cell.classList.add("is-frozen-edge-left");
      if (edgeRight && cell.dataset.field === edgeRight.field) cell.classList.add("is-frozen-edge-right");
    }
  }
  /* -------- render částí -------- */
  renderAll() {
    this.renderHeader();
    this.renderBody();
    this.renderFooter();
    this.applyLayout();
  }
  renderHeader() {
    const { headerRow, filterRow } = this.nodes;
    clear(headerRow);
    clear(filterRow);
    const { list } = this.renderColumns();
    this.buildGroupRow(list);
    const mode = this.grid.instance.filterLayout;
    const showHeaderFilters = mode === "header";
    const anyFilter = showHeaderFilters && list.some((c) => c.filter && c.filterEnabled);
    for (const col of list) {
      headerRow.appendChild(this.buildHeaderCell(col));
      if (anyFilter) filterRow.appendChild(this.buildFilterCell(col));
    }
    filterRow.style.display = anyFilter ? "" : "none";
    const anyRot = list.some((c) => !c._rownum && this.effectiveRotate(c) !== "none");
    this.nodes.header.classList.toggle("has-rot", anyRot);
    this.renderExternalFilters();
    this.renderUniversalBar();
  }
  /** Univerzální filtr: Pole / Typ / Hodnota / Zrušit. */
  renderUniversalBar() {
    const bar = this.nodes.universalBar;
    clear(bar);
    if (this.grid.instance.filterLayout !== "universal") {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const u = grid.universal || {};
    const cols = grid.columns;
    const fieldSel = el("select.lattice-uni-field");
    for (const c of cols) fieldSel.appendChild(el("option", { value: c.field, text: c.title }));
    fieldSel.value = u.field || cols[0] && cols[0].field || "";
    const typeSel = el("select.lattice-uni-type");
    for (const o of UNIVERSAL_OPS) typeSel.appendChild(el("option", { value: o.op, text: o.label }));
    typeSel.value = u.op || "contains";
    const value = el("input.lattice-uni-value", { type: "text", placeholder: t("universal.value"), value: u.value ?? "" });
    const apply = () => grid.setUniversal({ field: fieldSel.value, op: typeSel.value, value: value.value });
    const applyDebounced = debounce(apply, grid.options.filterDebounce ?? 300);
    fieldSel.addEventListener("change", apply);
    typeSel.addEventListener("change", apply);
    value.addEventListener("input", applyDebounced);
    const clearBtn = el("button.lattice-uni-clear", { type: "button", text: t("universal.clear") });
    clearBtn.addEventListener("click", () => {
      value.value = "";
      grid.clearUniversal();
    });
    bar.append(
      el("span.lattice-uni-label", { text: t("universal.field") }),
      fieldSel,
      el("span.lattice-uni-label", { text: t("universal.type") }),
      typeSel,
      el("span.lattice-uni-label", { text: t("universal.valueLabel") }),
      value,
      clearBtn
    );
  }
  /** Efektivní otočení hlavičky sloupce (per sloupec přepíše hromadné nastavení). */
  effectiveRotate(col) {
    const r = col.headerRotate != null ? col.headerRotate : this.grid.instance.headerRotate;
    return r === "90" || r === "270" ? r : "none";
  }
  /** Externí filtry nad tabulkou (responzivní mřížka: label + ovládací prvek). */
  renderExternalFilters() {
    const box = this.nodes.externalFilters;
    clear(box);
    if (this.grid.instance.filterLayout !== "external") {
      box.style.display = "none";
      return;
    }
    const cols = this.grid.columns.filter((c) => c.visible && c.filter && c.filterEnabled);
    if (cols.length === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    const t = (k, v) => this.grid.i18n.t(k, v);
    const collapsed = this.grid.instance.externalFiltersCollapsed === true;
    const active = Object.keys(this.grid.filters || {}).length;
    const head = el("div.lattice-ext-head");
    const btn = el("button.lattice-ext-toggle", {
      type: "button",
      title: collapsed ? t("filters.showPanel") : t("filters.hidePanel")
    }, [
      el("span.lattice-ext-chevron", { html: CHEVRON_SVG, class: collapsed ? "is-collapsed" : "" }),
      el("span.lattice-ext-title", { text: t("filters.panelTitle") })
    ]);
    if (active > 0) btn.appendChild(el("span.lattice-ext-badge", { text: t("filters.activeCount", { n: active }) }));
    btn.addEventListener("click", () => {
      this.grid.setInstance({ externalFiltersCollapsed: !collapsed });
    });
    head.appendChild(btn);
    box.appendChild(head);
    const grid = el("div.lattice-ext-grid");
    grid.style.display = collapsed ? "none" : "grid";
    for (const col of cols) {
      const field2 = el("div.lattice-ext-field");
      field2.appendChild(el("label.lattice-ext-label", { text: col.title }));
      const wrap = this.buildFilterControl(col);
      if (wrap) field2.appendChild(wrap);
      grid.appendChild(field2);
    }
    box.appendChild(grid);
  }
  /**
   * Řádek skupin nad hlavičkami. Cely spanů se tvoří z běhů sousedních sloupců
   * se stejnou skupinou v rámci stejné frozen-strany. Sloupce bez skupiny mají
   * prázdný spanující cell (drží zarovnání). Zobrazí se jen když skupiny existují.
   */
  buildGroupRow(list) {
    const { groupRow } = this.nodes;
    clear(groupRow);
    const hasGroups = list.some((c) => c.group);
    if (!hasGroups) {
      groupRow.style.display = "none";
      return;
    }
    groupRow.style.display = "";
    const side = (c) => c.frozen === "right" ? "right" : c.frozen ? "left" : "mid";
    let i = 0;
    while (i < list.length) {
      const g = list[i].group || null;
      const s = side(list[i]);
      let j = i;
      while (j < list.length && (list[j].group || null) === g && side(list[j]) === s) j++;
      const members = list.slice(i, j);
      const cell = el("div.lattice-gcell", { dataset: { fields: members.map((m) => m.field).join(",") } }, [
        g ? el("span.lattice-gcell-title", { text: g }) : null
      ]);
      if (g) {
        const x = el("button.lattice-gcell-x", { type: "button", title: this.grid.i18n.t("columns.ungroup"), text: "\xD7", draggable: false });
        x.addEventListener("mousedown", (e) => e.stopPropagation());
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          this.grid.ungroup(g);
        });
        cell.appendChild(x);
      } else {
        cell.classList.add("is-empty");
      }
      attachGroupDrag(cell, g, this.grid);
      groupRow.appendChild(cell);
      i = j;
    }
  }
  /** Nastaví šířky a sticky offsety cell skupinového řádku (dle layoutu). */
  sizeGroupRow() {
    if (!this.layout) return;
    const { widths, leftOff, rightOff, groupEdges, frozenEdges } = this.layout;
    for (const cell of this.nodes.groupRow.children) {
      const fields = (cell.dataset.fields || "").split(",").filter(Boolean);
      if (!fields.length) continue;
      const last = fields[fields.length - 1];
      const w = fields.reduce((s, f) => s + (widths.get(f) || 0), 0);
      cell.style.width = w + "px";
      cell.style.left = "";
      cell.style.right = "";
      cell.classList.remove("is-frozen", "is-frozen-left", "is-frozen-right", "is-frozen-edge-left", "is-frozen-edge-right");
      cell.classList.toggle("is-gedge", groupEdges.has(last) && !frozenEdges.has(last));
      if (frozenEdges.has(last) && leftOff.has(last)) cell.classList.add("is-frozen-edge-left");
      if (leftOff.has(fields[0])) {
        cell.classList.add("is-frozen", "is-frozen-left");
        cell.style.left = leftOff.get(fields[0]) + "px";
      } else if (rightOff.has(fields[fields.length - 1])) {
        cell.classList.add("is-frozen", "is-frozen-right");
        cell.style.right = rightOff.get(fields[fields.length - 1]) + "px";
      }
    }
  }
  buildHeaderCell(col) {
    const grid = this.grid;
    if (col._rowsum) {
      return el("div.lattice-hcell.lattice-rowsum-cell", {
        dataset: { field: col.field },
        class: "is-right",
        title: grid.i18n.t("summary.name." + col._fn)
      }, [el("span.lattice-hcell-title", { text: col.title })]);
    }
    if (col._actions) {
      return el(
        "div.lattice-hcell.lattice-actions-cell",
        { dataset: { field: col.field }, class: "is-center" },
        [el("span.lattice-hcell-title", { text: col.title })]
      );
    }
    if (col._actionsMenu) {
      return el("div.lattice-hcell.lattice-actions-cell", { dataset: { field: col.field }, class: "is-center" });
    }
    if (col._move) {
      return el("div.lattice-hcell.lattice-move-cell", { dataset: { field: col.field }, class: "is-center" });
    }
    if (col._select) {
      const cell2 = el("div.lattice-hcell.lattice-select-cell", { dataset: { field: col.field }, class: "is-center" });
      if (grid.selectable.mode !== "single") {
        const scopeLabel = grid.selectScope === "all" ? grid.i18n.t("select.scopeAll", { n: grid.filteredCount() }) : grid.i18n.t("select.scopePage");
        const cb = el("input.lattice-select-all", { type: "checkbox", title: scopeLabel });
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          grid.toggleScopeSelection();
        });
        cell2.appendChild(cb);
        const caret = el("button.lattice-select-menu", { type: "button", title: grid.i18n.t("select.menu"), text: "\u25BE" });
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openSelectMenu(caret);
        });
        cell2.appendChild(caret);
      }
      return cell2;
    }
    if (col._rownum) {
      const cell2 = el("div.lattice-hcell.lattice-rownum-cell", {
        dataset: { field: col.field },
        class: "is-" + (col.align || "right")
      }, [el("span.lattice-hcell-title", { text: col.title })]);
      const handle2 = el("div.lattice-resize-handle");
      attachRowNumberResize(handle2, grid);
      cell2.appendChild(handle2);
      return cell2;
    }
    const sortState = grid.sort.find((s) => s.field === col.field);
    const rot = this.effectiveRotate(col);
    const cell = el("div.lattice-hcell", {
      dataset: { field: col.field },
      role: "columnheader",
      class: [col.align ? "is-" + col.align : "", rot !== "none" ? "is-rot-" + rot : ""].filter(Boolean).join(" ")
    });
    if (col.headerSort && grid.options.headerSort !== false) {
      cell.setAttribute("aria-sort", sortState ? sortState.dir === "asc" ? "ascending" : "descending" : "none");
    }
    if (col.headerMenu) {
      const mbtn = el("button.lattice-hcell-menu", { type: "button", title: this.grid.i18n.t("menu.column"), text: "\u22EE" });
      mbtn.addEventListener("mousedown", (e) => e.stopPropagation());
      mbtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenu(mbtn, this.headerMenuItems(col), (v, it) => it && it.action && it.action(mbtn, col));
      });
      cell.appendChild(mbtn);
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenuAt(e.pageX, e.pageY, this.headerMenuItems(col), (v, it) => it && it.action && it.action(cell, col));
      });
    }
    const label = el("span.lattice-hcell-title", { text: col.title });
    cell.appendChild(label);
    if (col.headerSort && grid.options.headerSort !== false) {
      cell.classList.add("is-sortable");
      const arrow = el("span.lattice-sort", { text: sortState ? sortState.dir === "asc" ? "\u25B2" : "\u25BC" : "" });
      if (sortState && grid.sort.length > 1) {
        arrow.appendChild(el("sup.lattice-sort-order", { text: String(grid.sort.indexOf(sortState) + 1) }));
      }
      cell.appendChild(arrow);
      label.addEventListener("click", (e) => grid.toggleSort(col.field, e.shiftKey));
      label.title = grid.i18n.t("menu.sortMulti");
    }
    if (typeof col.headerPopup === "function") {
      const info = el("button.lattice-hcell-popup", { type: "button", title: this.grid.i18n.t("popup.info"), text: "\u24D8" });
      info.addEventListener("mousedown", (e) => e.stopPropagation());
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopup(info, (close) => col.headerPopup({ col, grid, close }));
      });
      cell.appendChild(info);
    }
    attachHeaderDrag(cell, col, grid);
    const handle = el("div.lattice-resize-handle");
    attachResize(handle, col, grid);
    cell.appendChild(handle);
    return cell;
  }
  buildFilterCell(col) {
    const cell = el("div.lattice-fcell", { dataset: { field: col.field } });
    const wrap = this.buildFilterControl(col);
    if (wrap) cell.appendChild(wrap);
    return cell;
  }
  /** Ovládací prvek filtru + přepínač typu (sdílené pro záhlaví i externí panel). */
  buildFilterControl(col) {
    if (!col.filter || !col.filterEnabled) return null;
    const def = getFilter(col.filter);
    if (!def) return null;
    const ctx = {
      i18n: this.grid.i18n,
      value: this.grid.filters[col.field],
      debounceMs: this.grid.options.filterDebounce ?? 300,
      fetchJson: (url) => fetch(url).then((r) => r.json()),
      onChange: (value) => this.grid.setFilter(col.field, value),
      // Distinktní hodnoty sloupce z dat — fallback pro select/multiselect bez filterValues.
      distinctValues: () => {
        const src = this.grid.dataSource.allRows && this.grid.dataSource.allRows() || this.grid.rows || [];
        const seen = /* @__PURE__ */ new Set(), out = [];
        for (const r of src) {
          const v = cellValue(r, col);
          if (v != null && v !== "" && !seen.has(v)) {
            seen.add(v);
            out.push(v);
          }
        }
        return out;
      }
    };
    const control = def.build(col, ctx);
    control.classList.add("lattice-fcell-control");
    const wrap = el("div.lattice-filter-wrap", {}, [control]);
    if (Array.isArray(col.availableFilters) && col.availableFilters.length > 1) {
      wrap.appendChild(this.buildFilterTypeSwitcher(col));
    }
    return wrap;
  }
  buildFilterTypeSwitcher(col) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const btn = el("button.lattice-ftype-btn", {
      type: "button",
      title: t("filterTypes.change"),
      html: FILTER_SVG
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const items = col.availableFilters.map((f) => ({
        value: f,
        label: t("filterTypes." + f),
        active: f === col.filter
      }));
      openMenu(btn, items, (value) => grid.setColumnFilterType(col.field, value));
    });
    return btn;
  }
  renderBody() {
    const { body } = this.nodes;
    clear(body);
    for (const c of this.grid.columns) {
      c._fmt = this.grid.effectiveFormat(c);
      c._i18n = this.grid.i18n;
      c._linkNewTab = this.grid.instance.linkNewTab;
    }
    const { list } = this.renderColumns();
    const rows = this.grid.rows || [];
    this.renderPinned(list);
    this._treeColField = this.grid.tree ? (list.find((c) => !c._rownum && !c._move && !c._select && !c._actions && !c._actionsMenu && !c._rowsum) || {}).field : null;
    this._detailColField = this._hasDetail() && !this.grid.tree ? (list.find((c) => !c._rownum && !c._move && !c._select && !c._actions && !c._actionsMenu && !c._rowsum) || {}).field : null;
    if (this.grid.virtual && !this.grid.groupActive() && rows.length) {
      this._vList = list;
      this._vRows = rows;
      this._rowH = this._measureRowHeight(list, rows);
      this._bindVirtualScroll();
      this._virtualPaint();
      this.renderSummaryBar();
      this.updateOverlay();
      this.updateSelectAllCheckbox();
      this.renderSelectionBar();
      this.grid.range?.apply();
      return;
    }
    const frag = document.createDocumentFragment();
    if (this.grid.groupActive()) {
      this.renderGroupNodes(this.grid.buildGroups(rows), list, frag, { n: 0 });
    } else {
      rows.forEach((rowData, i) => this._appendRow(frag, rowData, i, i, list));
    }
    body.appendChild(frag);
    const scope = this.grid.instance.summaryRow;
    if (scope === "page" || scope === "all") {
      const summary = this.buildSummary(list, scope);
      if (summary) body.appendChild(summary);
    }
    this.renderSummaryBar();
    this.updateOverlay();
    this.updateSelectAllCheckbox();
    this.renderSelectionBar();
    this.grid.range?.apply();
    if (this.layout) this.styleCells();
    this.attachKeyNav();
  }
  /* -------- virtuální scrollování (jen client-side ploché řádky) -------- */
  /** Změří výšku řádku (jedna sonda) — pro výpočet virtuálního okna. */
  _measureRowHeight(list, rows) {
    const probe = this.buildDataRow(rows[0], 0, 0, list);
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    this.nodes.body.appendChild(probe);
    if (this.layout) this.styleCells();
    const h = probe.offsetHeight || 34;
    probe.remove();
    return h;
  }
  _bindVirtualScroll() {
    if (this._vScrollBound) return;
    this._vScrollBound = true;
    this.nodes.viewport.addEventListener("scroll", () => {
      if (!this.grid.virtual || this.grid.groupActive()) return;
      if (this._vRaf) return;
      this._vRaf = requestAnimationFrame(() => {
        this._vRaf = null;
        this._virtualPaint();
      });
    });
  }
  /** Překreslí jen viditelné okno řádků + rozpěrky (nad/pod) reprezentující celek. */
  _virtualPaint() {
    const body = this.nodes.body, vp = this.nodes.viewport;
    const rows = this._vRows, list = this._vList, rowH = this._rowH || 34;
    const total = rows.length;
    const buffer = 8;
    const start = Math.max(0, Math.floor(vp.scrollTop / rowH) - buffer);
    const per = Math.ceil((vp.clientHeight || 400) / rowH) + buffer * 2;
    const end = Math.min(total, start + per);
    clear(body);
    if (start > 0) body.appendChild(el("div.lattice-vspacer", { style: { height: start * rowH + "px" } }));
    for (let i = start; i < end; i++) body.appendChild(this.buildDataRow(rows[i], i, i, list));
    if (end < total) body.appendChild(el("div.lattice-vspacer", { style: { height: (total - end) * rowH + "px" } }));
    const scope = this.grid.instance.summaryRow;
    if (scope === "page" || scope === "all") {
      const summary = this.buildSummary(list, scope);
      if (summary) body.appendChild(summary);
    }
    if (this.layout) this.styleCells();
    this.attachKeyNav();
  }
  /* -------- přístupnost: klávesová navigace buněk (šipky, Home/End, Enter) -------- */
  /** Datové řádky pro navigaci (bez souhrnných / skupinových hlaviček). */
  _navRows() {
    return [...this.nodes.body.querySelectorAll(".lattice-row")].filter((r) => !r.classList.contains("lattice-summary-row"));
  }
  attachKeyNav() {
    const body = this.nodes.body;
    if (!this._keyNavBound) {
      this._keyNavBound = true;
      body.addEventListener("keydown", (e) => this._onGridKey(e));
      body.addEventListener("focusin", (e) => {
        const cell2 = e.target.closest && e.target.closest(".lattice-cell");
        if (cell2 && cell2.parentElement && cell2.parentElement.classList.contains("lattice-row")) {
          const rows2 = this._navRows();
          const r = rows2.indexOf(cell2.parentElement);
          const c = [...cell2.parentElement.children].indexOf(cell2);
          if (r >= 0) this._focusPos = { r, c };
        }
      });
    }
    const rows = this._navRows();
    for (const row2 of rows) for (const cell2 of row2.children) cell2.tabIndex = -1;
    if (!rows.length) return;
    const pos = this._focusPos || { r: 0, c: 0 };
    const row = rows[Math.min(pos.r, rows.length - 1)] || rows[0];
    const cell = row.children[Math.min(pos.c, row.children.length - 1)] || row.children[0];
    if (cell) cell.tabIndex = 0;
  }
  _onGridKey(e) {
    const cell = e.target.closest && e.target.closest(".lattice-cell");
    if (!cell || !cell.parentElement || !cell.parentElement.classList.contains("lattice-row")) return;
    if (e.target !== cell && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const rows = this._navRows();
    const rowEl = cell.parentElement;
    let r = rows.indexOf(rowEl);
    let c = [...rowEl.children].indexOf(cell);
    if (r < 0) return;
    const lastR = rows.length - 1;
    const lastC = rowEl.children.length - 1;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        r = Math.min(lastR, r + 1);
        break;
      case "ArrowUp":
        r = Math.max(0, r - 1);
        break;
      case "ArrowRight":
        c = Math.min(lastC, c + 1);
        break;
      case "ArrowLeft":
        c = Math.max(0, c - 1);
        break;
      case "Home":
        c = e.ctrlKey || e.metaKey ? (r = 0, 0) : 0;
        break;
      case "End":
        c = lastC;
        if (e.ctrlKey || e.metaKey) r = lastR;
        break;
      case "PageDown":
        r = Math.min(lastR, r + 10);
        break;
      case "PageUp":
        r = Math.max(0, r - 10);
        break;
      case "Enter":
      case "F2": {
        const idx = Number(rowEl.dataset.index);
        const field2 = cell.dataset.field;
        if (!Number.isNaN(idx) && field2 && this.grid.editManager) this.grid.editCell(idx, field2);
        e.preventDefault();
        return;
      }
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    this._focusCell(rows, r, c);
  }
  _focusCell(rows, r, c) {
    const row = rows[r];
    if (!row) return;
    const cell = row.children[Math.min(c, row.children.length - 1)];
    if (!cell) return;
    for (const rw of rows) for (const cc of rw.children) cc.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
    this._focusPos = { r, c };
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  /** Po změně výběru: přepni třídy řádků a stav checkboxů (bez plného re-renderu). */
  updateSelectionUI() {
    const grid = this.grid;
    if (!grid.isSelectable()) return;
    for (const rowEl of this.nodes.body.querySelectorAll(".lattice-row")) {
      const idx = Number(rowEl.dataset.index);
      const data = grid.rows[idx];
      if (!data) continue;
      const sel = grid.isSelected(data);
      rowEl.classList.toggle("is-selected", sel);
      const cb = rowEl.querySelector(".lattice-select-cb");
      if (cb) cb.checked = sel;
    }
    this.updateSelectAllCheckbox();
    this.renderSelectionBar();
  }
  /**
   * Lišta hromadných akcí nad výběrem. Aktivní jen když jsou zadané
   * `options.selectionActions` a je něco vybráno. Akce dostane vybrané řádky,
   * klíče a grid; aplikace si persistenci/refresh řeší sama.
   */
  renderSelectionBar() {
    const bar = this.nodes.selectionBar;
    if (!bar) return;
    const grid = this.grid;
    const actions = grid.options.selectionActions;
    const n = grid.selected.size;
    clear(bar);
    if (!grid.isSelectable() || !Array.isArray(actions) || !actions.length || n === 0) {
      bar.classList.remove("is-active");
      return;
    }
    const t = grid.i18n.t.bind(grid.i18n);
    bar.appendChild(el("span.lattice-selbar-count", { text: t("selection.count").replace("{n}", n) }));
    for (const a of actions) {
      const b = el("button.lattice-selbar-action" + (a.danger ? ".is-danger" : ""), { type: "button", title: a.title || "" });
      if (a.icon) b.appendChild(el("span.lattice-selbar-ico", { html: a.icon }));
      b.appendChild(el("span", { text: a.label || "" }));
      b.addEventListener("click", () => {
        if (typeof a.onClick === "function") a.onClick(grid.getSelectedRows(), grid.getSelectedKeys(), grid);
      });
      bar.appendChild(b);
    }
    bar.appendChild(el("span.lattice-selbar-spacer"));
    const clearBtn = el("button.lattice-selbar-clear", { type: "button", text: t("selection.clear") });
    clearBtn.addEventListener("click", () => grid.clearSelection());
    bar.appendChild(clearBtn);
    bar.classList.add("is-active");
  }
  /** Status bar se souhrnem označeného rozsahu buněk (počet, součet, průměr…). */
  updateRangeStatus(text) {
    const bar = this.nodes.rangeStatus;
    if (!bar) return;
    bar.textContent = text || "";
    bar.classList.toggle("is-active", !!text);
  }
  /**
   * Připnuté řádky (pinnedTop/pinnedBottom) — vždy viditelné bez ohledu na scroll
   * a stránku (souhrnný řádek, „nový záznam", zvýrazněný záznam). Vykreslí se jako
   * datové řádky s třídou is-pinned a nečíselným indexem (nezasahují do editace/výběru).
   */
  renderPinned(list) {
    list = list || this.renderColumns().list;
    const fill = (container, rows, tag) => {
      if (!container) return;
      clear(container);
      const arr = Array.isArray(rows) ? rows : [];
      container.style.display = arr.length ? "" : "none";
      arr.forEach((rowData, i) => {
        const row = this.buildDataRow(rowData, tag + i, 0, list);
        row.classList.add("is-pinned");
        container.appendChild(row);
      });
    };
    fill(this.nodes.pinnedTop, this.grid.pinnedTop, "pt");
    fill(this.nodes.pinnedBottom, this.grid.pinnedBottom, "pb");
    if (this.layout) this.styleCells();
  }
  /** Stav hlavičkového checkboxu (checked / indeterminate dle AKTUÁLNÍHO ROZSAHU). */
  updateSelectAllCheckbox() {
    const grid = this.grid;
    if (!grid.isSelectable()) return;
    const cb = this.nodes.headerRow.querySelector(".lattice-select-all");
    if (!cb) return;
    const rows = grid.scopeRows();
    let sel = 0;
    for (const r of rows) if (grid.selected.has(grid.rowKey(r))) sel++;
    cb.checked = rows.length > 0 && sel === rows.length;
    cb.indeterminate = sel > 0 && sel < rows.length;
    cb.title = grid.selectScope === "all" ? grid.i18n.t("select.scopeAll", { n: grid.filteredCount() }) : grid.i18n.t("select.scopePage");
  }
  /**
   * Menu výběru: přepínač rozsahu (Stránka / Všechny záznamy) + invertovat + zrušit.
   * Rozsah určuje, na co se vztahuje horní checkbox i invertování.
   */
  openSelectMenu(anchor) {
    const g = this.grid;
    const t = g.i18n.t.bind(g.i18n);
    openMenu(anchor, [
      { value: "scope-page", label: t("select.scopePage"), active: g.selectScope === "page" },
      { value: "scope-all", label: t("select.scopeAll", { n: g.filteredCount() }), active: g.selectScope === "all" },
      { value: "invert", label: t("select.invert") },
      { value: "none", label: t("select.none") }
    ], (v) => {
      if (v === "scope-page") g.setSelectScope("page");
      else if (v === "scope-all") g.setSelectScope("all");
      else if (v === "invert") g.invertSelection();
      else g.clearSelection();
    });
  }
  /**
   * Datový řádek. `index` = původní index v grid.rows (editace / rowClick /
   * číslování), `stripe` = pořadí pro zebra pruhování (odlišné při seskupení).
   */
  buildDataRow(rowData, index, stripe, list) {
    const row = el("div.lattice-row", { dataset: { index: String(index) }, role: "row" });
    if (stripe % 2) row.classList.add("is-odd");
    const grid = this.grid;
    if (grid.isSelectable()) {
      const sel = grid.isSelected(rowData);
      if (sel) row.classList.add("is-selected");
      row.setAttribute("aria-selected", sel ? "true" : "false");
    }
    applyCond(row, grid.options.rowClass, grid.options.rowStyle, [rowData, index]);
    for (const col of list) row.appendChild(this.buildBodyCell(col, rowData, index));
    if (grid.isMovable()) attachDropZone(row, this, () => index, !!grid.tree);
    const rowClickCb = grid.options.onRowClick || grid.options.rowClick;
    const rowClickSelect = grid.isSelectable() && grid.instance.selectRowClick;
    if (rowClickSelect || rowClickCb) {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".lattice-resize-handle")) return;
        if (rowClickSelect && !e.target.closest("a, button, input, select, textarea, label, .lattice-select-cell")) {
          if (e.shiftKey && this._lastSelIdx != null) {
            const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
            grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), true);
          } else {
            grid.toggleRow(grid.rowKey(rowData));
          }
          this._lastSelIdx = index;
        }
        if (rowClickCb) rowClickCb(rowData, index, e);
      });
      row.classList.add("is-clickable");
    }
    if (typeof grid.options.onRowContext === "function") {
      row.addEventListener("contextmenu", (e) => grid.options.onRowContext(rowData, index, e), true);
    }
    return row;
  }
  /** Je pro řádky aktivní rozbalovací detail (uživatelský nebo responsivní kolaps)? */
  _hasDetail() {
    return !!this.grid.detailFn || this.grid.responsive && this._collapsedCols && this._collapsedCols.length > 0;
  }
  /** Vloží datový řádek a hned za něj (je-li rozbalený) jeho detail panel. */
  _appendRow(frag, rowData, index, stripe, list) {
    frag.appendChild(this.buildDataRow(rowData, index, stripe, list));
    if (this._hasDetail() && this.grid.isDetailExpanded(this.grid.rowKey(rowData))) {
      const d = this.buildDetailRow(rowData, index);
      if (d) frag.appendChild(d);
    }
  }
  /**
   * Full-width řádek s detailem. Obsah = (1) schované sloupce z responsivního
   * kolapsu jako „popisek: hodnota" + (2) volitelný `options.rowDetail`.
   * Vnitřek je sticky-left (vidět i při horizontálním scrollu); šířka = viewport.
   */
  buildDetailRow(rowData, index) {
    const inner = el("div.lattice-detail-inner");
    const w = this.nodes.viewport ? this.nodes.viewport.clientWidth : 0;
    if (w) inner.style.width = w + "px";
    const collapsed = this.grid.responsive && this._collapsedCols ? this._collapsedCols : [];
    if (collapsed.length) {
      const grid = el("div.lattice-detail-fields");
      for (const col of collapsed) {
        const formatter = getFormatter(col);
        const out = formatter(cellValue(rowData, col), col, rowData);
        const valEl = el("span.lattice-detail-val");
        if (out instanceof Node) valEl.appendChild(out);
        else valEl.textContent = out == null ? "" : String(out);
        grid.appendChild(el("div.lattice-detail-field", {}, [
          el("span.lattice-detail-label", { text: col.title }),
          valEl
        ]));
      }
      inner.appendChild(grid);
    }
    if (this.grid.detailFn) {
      let content;
      try {
        content = this.grid.detailFn(rowData, index);
      } catch {
        content = null;
      }
      if (content instanceof Node) inner.appendChild(content);
      else if (content != null) {
        const box = el("div.lattice-detail-custom");
        box.innerHTML = String(content);
        inner.appendChild(box);
      }
    }
    if (!inner.childNodes.length) return null;
    return el("div.lattice-detail-row", { role: "row", dataset: { detailFor: String(index) } }, [inner]);
  }
  /**
   * Přepočítá, které (nefixované) sloupce se při aktuální šířce viewportu schovají
   * do detailu. Vrací true, když se množina schovaných změnila (→ překreslit).
   * Heuristika: fixní šířka (frozen + syntetické + „responsive:false") se rezervuje,
   * zbytek se plní zleva; přetečené sloupce se schovávají v pořadí priority
   * (col.responsive číslo, vyšší dřív) a pak zprava.
   */
  _computeResponsive() {
    const grid = this.grid;
    if (!grid.responsive) {
      const had = this._collapsedSig;
      this._collapsed = null;
      this._collapsedSig = "";
      return !!had;
    }
    const avail = this.nodes.viewport ? this.nodes.viewport.clientWidth : 0;
    if (!avail) return false;
    const grouped = new Set(grid.groupFields());
    let reserve = 8 + 24;
    if (grid.isMovable()) reserve += 32;
    if (grid.isSelectable()) reserve += 36;
    if (grid.instance.rowNumbers) reserve += 44;
    let fixed = 0;
    const collapsible = [];
    let idx = 0;
    for (const c of grid.columns) {
      if (!c.visible || grouped.has(c.field)) continue;
      const w = colWidth(c);
      if (c.frozen || c.responsive === false) {
        fixed += w;
        continue;
      }
      collapsible.push({ c, w, prio: typeof c.responsive === "number" ? c.responsive : 0, i: idx++ });
    }
    const budget = avail - fixed - reserve;
    let sum = collapsible.reduce((a, x) => a + x.w, 0);
    const hideOrder = collapsible.slice().sort((a, b) => b.prio - a.prio || b.i - a.i);
    const collapsedSet = /* @__PURE__ */ new Set();
    let k = 0;
    while (sum > budget && k < hideOrder.length && collapsedSet.size < collapsible.length - 1) {
      const h = hideOrder[k++];
      collapsedSet.add(h.c.field);
      sum -= h.w;
    }
    const sig = [...collapsedSet].sort().join(",");
    const changed = sig !== (this._collapsedSig || "");
    this._collapsed = collapsedSet.size ? collapsedSet : null;
    this._collapsedSig = sig;
    return changed;
  }
  /** Přepočítá responsivní kolaps a při změně přerenderuje hlavičku i tělo. */
  _reflowResponsive() {
    if (!this.grid.responsive) return;
    if (this._computeResponsive()) {
      this.renderHeader();
      this.applyLayout();
      this.renderBody();
    }
  }
  /**
   * Rekurzivně vykreslí uzly stromu skupin do fragmentu. Sbalený uzel skryje
   * celý svůj podstrom. Zebra pruhování (stripe.n) běží průběžně přes vše.
   */
  renderGroupNodes(nodes, list, frag, stripe) {
    for (const node of nodes) {
      const collapsed = this.grid.isGroupCollapsed(node.key);
      frag.appendChild(this.buildGroupHeader(node, collapsed));
      if (collapsed) continue;
      if (node.rows) {
        for (const { row, index } of node.rows) this._appendRow(frag, row, index, stripe.n++, list);
      } else {
        this.renderGroupNodes(node.groups, list, frag, stripe);
      }
      const sub = this.buildGroupSubtotal(node, list);
      if (sub) frag.appendChild(sub);
    }
  }
  /** Mezisoučet za skupinu řádků — jeden řádek na aktivní souhrnnou funkci. */
  buildGroupSubtotal(node, list) {
    if (!this.grid.instance.groupSubtotals) return null;
    const activeFns = SUMMARY_ORDER.filter((fn) => list.some((c) => (c.summary || []).includes(fn)));
    if (!activeFns.length) return null;
    const rows = collectGroupRows(node);
    const frag = document.createDocumentFragment();
    for (const fn of activeFns) frag.appendChild(this._summaryFnRow(list, fn, rows, { rowClass: "lattice-group-subtotal" }));
    return frag;
  }
  /**
   * Klikatelná hlavička skupiny řádků. Roztažená přes celou šířku tabulky,
   * popisek přilepený vlevo (sticky), takže je čitelný i při horizontálním scrollu.
   * Odsazení dle úrovně (node.level); ukazuje hodnotu skupiny a počet řádků.
   */
  buildGroupHeader(node, collapsed) {
    const grid = this.grid;
    const col = grid.columns.find((c) => c.field === node.field);
    const label = this.groupLabel(node.value, col);
    const row = el("div.lattice-rowgroup" + (collapsed ? ".is-collapsed" : ""), {
      dataset: { key: node.key },
      role: "button",
      tabindex: "0",
      class: "is-level-" + node.level,
      title: (col ? col.title + ": " : "") + label
    });
    const inner = el("div.lattice-rowgroup-inner", {
      style: { paddingLeft: 10 + node.level * 20 + "px" }
    }, [
      el("span.lattice-rowgroup-toggle", { html: CHEVRON_SVG }),
      col ? el("span.lattice-rowgroup-field", { text: col.title + ":" }) : null,
      el("span.lattice-rowgroup-title", { text: label }),
      el("span.lattice-rowgroup-count", { text: String(node.count) })
    ]);
    row.appendChild(inner);
    const toggle = () => grid.toggleGroup(node.key);
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    if (grid.isMovable()) attachGroupDropZone(row, this, node);
    return row;
  }
  /** Čitelný popisek hodnoty skupiny (prázdné → placeholder, boolean → Ano/Ne). */
  groupLabel(value, col) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    if (value == null || value === "") return t("group.empty");
    if (col && (col.type === "boolean" || col.type === "tick")) return value ? t("filters.yes") : t("filters.no");
    return String(value);
  }
  /* -------- řádkové akce -------- */
  /**
   * Vyhodnotí akce pro daný řádek: skryje `visible(row)===false` (řízení
   * přístupu), doplní výchozí ikonu/titulek/danger u známých názvů (edit/view/
   * delete) a spočítá `disabled(row)`.
   */
  resolveActions(row) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    return (this.grid.options.actions || []).filter((a) => typeof a.visible !== "function" || a.visible(row)).map((a) => {
      const def = ACTION_DEFAULTS[a.name] || {};
      const key = "actions." + a.name;
      const tr = t(key);
      return {
        name: a.name,
        icon: a.icon != null ? a.icon : def.icon || "\u2022",
        title: a.title != null ? a.title : tr === key ? a.name : tr,
        danger: a.danger != null ? a.danger : !!def.danger,
        disabled: typeof a.disabled === "function" ? a.disabled(row) : !!a.disabled,
        onClick: a.onClick
      };
    });
  }
  /** Inline ikony akcí (režim 'column'). */
  buildActionButtons(row, index) {
    const wrap = el("span.lattice-actions");
    for (const a of this.resolveActions(row)) {
      const btn = el("button.lattice-action-btn" + (a.danger ? ".is-danger" : ""), {
        type: "button",
        title: a.title,
        html: a.icon
      });
      if (a.disabled) btn.disabled = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!a.disabled && a.onClick) a.onClick(row, index, e);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }
  /** ⋮ tlačítko otevírající menu akcí (režim 'menu'); null když řádek nemá akce. */
  buildActionsMenuButton(row, index) {
    if (!this.resolveActions(row).length) return null;
    const btn = el("button.lattice-actions-menu-btn", { type: "button", title: this.grid.i18n.t("actions.title"), text: "\u22EE" });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openActionsMenu(btn, row, index);
    });
    return btn;
  }
  openActionsMenu(anchor, row, index) {
    const actions = this.resolveActions(row);
    const items = actions.map((a) => ({ value: a.name, label: a.title, disabled: a.disabled, danger: a.danger }));
    openMenu(anchor, items, (name) => {
      const a = actions.find((x) => x.name === name);
      if (a && !a.disabled && a.onClick) a.onClick(row, index);
    });
  }
  /** Označí buňku (# nebo ID) jako spouštěč menu řádku — jen PRAVÝ klik. */
  _attachRowMenuTrigger(cell, rowData, index) {
    cell.classList.add("is-row-menu");
    cell.title = this.grid.i18n.t("menu.row");
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openRowMenu(e.pageX, e.pageY, rowData, index);
    });
  }
  /** Otevře kontextové menu řádku na souřadnicích. Vrátí true, když se otevřelo. */
  openRowMenu(x, y, row, index) {
    const build = this.grid.options.rowContextMenu;
    if (typeof build !== "function") return false;
    const items = build(row, index);
    if (!items || !items.length) return false;
    openMenuAt(x, y, items, (v, it) => it && it.action && it.action(row, index));
    return true;
  }
  /** Položky menu hlavičky sloupce: vestavěné příkazy + vlastní (col.headerMenu). */
  headerMenuItems(col) {
    const g = this.grid;
    const t = g.i18n.t.bind(g.i18n);
    const sortState = g.sort.find((s) => s.field === col.field);
    const items = [
      { label: t("menu.sortAsc"), active: sortState && sortState.dir === "asc", action: () => g.sortColumn(col.field, "asc") },
      { label: t("menu.sortDesc"), active: sortState && sortState.dir === "desc", action: () => g.sortColumn(col.field, "desc") }
    ];
    if (sortState) items.push({ label: t("menu.sortClear"), action: () => g.sortColumn(col.field, null) });
    items.push({ separator: true }, { label: t("menu.hide"), action: () => g.setColumnVisible(col.field, false) });
    if (col.frozenAllowed !== false) {
      items.push(
        { label: t("menu.pinLeft"), active: col.frozen === true || col.frozen === "left", action: () => g.setColumnFrozen(col.field, true) },
        { label: t("menu.pinRight"), active: col.frozen === "right", action: () => g.setColumnFrozen(col.field, "right") }
      );
      if (col.frozen) items.push({ label: t("menu.unpin"), action: () => g.setColumnFrozen(col.field, false) });
    }
    items.push(
      { separator: true },
      { label: g.isRowGrouped(col.field) ? t("menu.ungroup") : t("menu.groupBy"), action: () => g.toggleRowGroup(col.field) },
      { label: t("menu.fitWidth"), action: () => g.autoFitColumn(col.field) }
    );
    const custom = typeof col.headerMenu === "function" ? col.headerMenu(col) : Array.isArray(col.headerMenu) ? col.headerMenu : null;
    if (custom && custom.length) items.push({ separator: true }, ...custom);
    return items;
  }
  /**
   * Souhrnný blok — jeden řádek na každou vybranou funkci (v pevném pořadí
   * SUMMARY_ORDER), napříč všemi sloupci. Popisek funkce v číslovacím sloupci;
   * když číslování není zobrazeno, ukáže se symbol u každé hodnoty.
   * Přepínač rozsahu (Stránka ↔ Vše) je v prvním řádku.
   */
  buildSummary(list, scope) {
    const grid = this.grid;
    const activeFns = SUMMARY_ORDER.filter((fn) => list.some((c) => (c.summary || []).includes(fn)));
    if (!activeFns.length) return null;
    const srcRows = grid.summarySource(scope);
    const wrap = el("div.lattice-summary");
    activeFns.forEach((fn, idx) => wrap.appendChild(this._summaryFnRow(list, fn, srcRows, { first: idx === 0, floatLabel: true })));
    return wrap;
  }
  /** Jeden souhrnný řádek pro danou funkci nad `srcRows` (sdílené: pata i skupiny). */
  _summaryFnRow(list, fn, srcRows, opts = {}) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const row = el("div.lattice-row.lattice-summary-row" + (opts.rowClass ? "." + opts.rowClass : "") + (opts.first ? ".is-first" : ""));
    for (const col of list) {
      const cell = el("div.lattice-cell.lattice-summary-cell", {
        dataset: { field: col.field },
        class: col.align ? "is-" + col.align : ""
      });
      if (!col._rownum && (col.summary || []).includes(fn) && (fn === "count" || isNumericType(col.type))) {
        const val = computeSummary(fn, col, srcRows);
        cell.appendChild(el("span.lattice-summary-sym", { text: SUMMARY_SYMBOL[fn], title: t("summary.name." + fn) }));
        cell.appendChild(el("span.lattice-summary-val", { text: this.formatSummaryValue(fn, val, col) }));
      }
      row.appendChild(cell);
    }
    if (opts.floatLabel) {
      const lbl = el("span.lattice-summary-rowlabel", { text: t("summary.name." + fn), title: t("summary.name." + fn) });
      row.appendChild(el("div.lattice-summary-label-wrap", {}, [lbl]));
    }
    return row;
  }
  /** Pruh nad dolní paticí s přepínačem rozsahu souhrnu (Stránka / Vše). */
  renderSummaryBar() {
    const bar = this.nodes.summaryBar;
    clear(bar);
    const grid = this.grid;
    const scope = grid.instance.summaryRow;
    const anySummary = grid.columns.some((c) => (c.summary || []).length);
    if (scope === "none" || !anySummary) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "";
    const t = grid.i18n.t.bind(grid.i18n);
    const label = el("span.lattice-summary-bar-label", { text: t("summary.barLabel") });
    const toggle = el("button.lattice-summary-bar-toggle", {
      type: "button",
      title: t("summary.scopeToggle"),
      text: scope === "all" ? t("summary.scopeAllLong") : t("summary.scopePageLong")
    });
    toggle.addEventListener("click", () => grid.toggleSummaryScope());
    bar.append(label, toggle);
  }
  formatSummaryValue(fn, val, col) {
    if (val == null) return "";
    if (fn === "count") return String(val);
    if (col.type === "money") return getFormatter(col)(val, col, {});
    return Number(val).toLocaleString(void 0, { maximumFractionDigits: fn === "avg" ? 2 : 0 });
  }
  buildBodyCell(col, rowData, index) {
    if (col._actions) {
      const cell2 = el("div.lattice-cell.lattice-actions-cell", { dataset: { field: col.field }, class: "is-center" });
      cell2.appendChild(this.buildActionButtons(rowData, index));
      return cell2;
    }
    if (col._actionsMenu) {
      const cell2 = el("div.lattice-cell.lattice-actions-cell", { dataset: { field: col.field }, class: "is-center" });
      const btn = this.buildActionsMenuButton(rowData, index);
      if (btn) cell2.appendChild(btn);
      return cell2;
    }
    if (col._move) {
      const cell2 = el("div.lattice-cell.lattice-move-cell", { dataset: { field: col.field }, class: "is-center" });
      const grip = el("span.lattice-move-grip", { title: this.grid.i18n.t("move.drag"), text: "\u283F" });
      attachMoveHandle(grip, this, () => index);
      cell2.appendChild(grip);
      return cell2;
    }
    if (col._select) {
      const grid = this.grid;
      const cell2 = el("div.lattice-cell.lattice-select-cell", { dataset: { field: col.field }, class: "is-center" });
      const cb = el("input.lattice-select-cb", { type: "checkbox", checked: grid.isSelected(rowData) });
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.shiftKey && this._lastSelIdx != null) {
          const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
          grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), cb.checked);
        } else {
          grid.setRowSelected(grid.rowKey(rowData), cb.checked);
        }
        this._lastSelIdx = index;
      });
      cell2.appendChild(cb);
      return cell2;
    }
    if (col._rownum) {
      const num4 = col._mode === "perPage" ? index + 1 : (this.grid.page - 1) * this.grid.pageSize + index + 1;
      const cell2 = el("div.lattice-cell.lattice-rownum", {
        dataset: { field: col.field },
        class: "is-" + (col.align || "right")
      });
      if (col._menuActions) {
        cell2.classList.add("has-actions-menu");
        cell2.appendChild(el("span.lattice-rownum-num", { text: String(num4) }));
        const btn = this.buildActionsMenuButton(rowData, index);
        if (btn) cell2.appendChild(btn);
      } else {
        cell2.textContent = String(num4);
        if (typeof this.grid.options.rowContextMenu === "function") this._attachRowMenuTrigger(cell2, rowData, index);
      }
      return cell2;
    }
    if (col._rowsum) {
      const val = computeRowSummary(col._fn, col._cols, rowData);
      const cell2 = el("div.lattice-cell.lattice-rowsum-cell", { dataset: { field: col.field }, class: "is-right" });
      cell2.appendChild(el("span.lattice-summary-val", {
        text: this.formatSummaryValue(col._fn, val, col._cols[0] || col)
      }));
      return cell2;
    }
    const value = cellValue(rowData, col);
    const editable = col.type !== "id" && !isComputed(col) && (col.editable === true || this.grid.options.editable === true);
    const cell = el("div.lattice-cell", {
      dataset: { field: col.field },
      role: "gridcell",
      class: [col.align ? "is-" + col.align : "", editable ? "is-editable" : ""].filter(Boolean).join(" "),
      title: editable ? this.grid.i18n.t("edit.hint") : void 0
    });
    const formatter = getFormatter(col);
    const out = formatter(value, col, rowData);
    if (out instanceof Node) cell.appendChild(out);
    else if (out == null || out === "") {
      const ph = this.grid.instance.emptyText;
      if (ph) cell.appendChild(el("span.lattice-empty-cell", { text: ph }));
    } else cell.textContent = String(out);
    const scale = condScaleColor(col, value, this.grid);
    if (scale) {
      if (scale.bg) {
        cell.style.backgroundColor = scale.bg;
        if (scale.fg) cell.style.color = scale.fg;
        cell.classList.add("is-condscale");
      }
      if (scale.text) {
        cell.style.color = scale.text;
        cell.style.fontWeight = "600";
      }
    }
    applyCond(cell, col.cellClass, col.cellStyle, [value, rowData, col]);
    if (this._menuIdField && col.field === this._menuIdField) {
      const txt = cell.textContent;
      cell.textContent = "";
      cell.classList.add("has-actions-menu");
      cell.appendChild(el("span.lattice-rownum-num", { text: txt }));
      const btn = this.buildActionsMenuButton(rowData, index);
      if (btn) cell.appendChild(btn);
    }
    if (col.type === "id" && typeof this.grid.options.rowContextMenu === "function") {
      this._attachRowMenuTrigger(cell, rowData, index);
    } else if (typeof this.grid.options.cellContextMenu === "function") {
      cell.addEventListener("contextmenu", (e) => {
        const ctx = { row: rowData, value, field: col.field, index, col, cell, grid: this.grid };
        const items = this.grid.options.cellContextMenu(ctx);
        if (!items || !items.length) return;
        e.preventDefault();
        e.stopPropagation();
        openMenuAt(e.pageX, e.pageY, items, (v, it) => it && it.action && it.action(ctx));
      });
    }
    if (this._treeColField && col.field === this._treeColField && this.grid.treeView) {
      const meta = this.grid.treeView[index];
      if (meta) this.decorateTreeCell(cell, meta);
    }
    if (this._detailColField && col.field === this._detailColField) {
      const key = this.grid.rowKey(rowData);
      const expanded = this.grid.isDetailExpanded(key);
      const toggle = el("button.lattice-detail-toggle" + (expanded ? ".is-expanded" : ""), {
        type: "button",
        html: CHEVRON_SVG,
        title: this.grid.i18n.t("detail.toggle"),
        "aria-expanded": expanded ? "true" : "false"
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.grid.toggleDetail(key);
      });
      cell.classList.add("is-detail-cell");
      cell.prepend(toggle);
    }
    if (typeof col.cellPopup === "function") {
      cell.classList.add("is-popup");
      cell.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, select, textarea")) return;
        e.stopPropagation();
        openPopup(cell, (close) => col.cellPopup({ row: rowData, value, field: col.field, index, cell, grid: this.grid, close }));
      });
    }
    if (typeof this.grid.options.onCellClick === "function") {
      cell.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, select, textarea, label")) return;
        this.grid.options.onCellClick({ row: rowData, value, field: col.field, index, col, cell, grid: this.grid }, e);
      });
    }
    return cell;
  }
  /** Vloží do buňky odsazení podle hloubky a rozbalovací šipku (nebo prázdné místo u listů). */
  decorateTreeCell(cell, meta) {
    cell.classList.add("is-tree-cell");
    const indent = el("span.lattice-tree-indent", { style: { width: meta.depth * 20 + "px" } });
    let toggle;
    if (meta.hasChildren) {
      toggle = el("span.lattice-tree-toggle" + (meta.expanded ? ".is-expanded" : ""), { html: CHEVRON_SVG });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.grid.tree.toggle(meta.key);
      });
    } else {
      toggle = el("span.lattice-tree-toggle.is-leaf");
    }
    cell.prepend(toggle);
    cell.prepend(indent);
  }
  renderFooter() {
    if (this.grid.progressive) {
      this._renderProgressiveFooter();
      return;
    }
    const pos = this.grid.instance.paginationPosition;
    this._renderPager(this.nodes.footer, pos === "footer" || pos === "both");
    this._renderPager(this.nodes.topPager, pos === "header" || pos === "both");
  }
  _renderProgressiveFooter() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    clear(this.nodes.topPager);
    this.nodes.topPager.style.display = "none";
    const footer = this.nodes.footer;
    clear(footer);
    footer.style.display = "";
    const info = el("div.lattice-page-info", {
      text: t("progressive.loaded", { loaded: grid.rows.length, total: grid.total })
    });
    footer.appendChild(info);
    if (grid.progressiveDone()) {
      footer.appendChild(el("span.lattice-progressive-done", { text: t("progressive.allLoaded") }));
    } else if (grid.progressive === "load") {
      const btn = el("button.lattice-load-more", {
        type: "button",
        text: grid._loadingMore ? t("progressive.loading") : t("progressive.loadMore", { n: grid.total - grid.rows.length })
      });
      btn.disabled = !!grid._loadingMore;
      btn.addEventListener("click", () => grid.loadMore());
      footer.appendChild(btn);
    } else if (grid._loadingMore) {
      footer.appendChild(el("span.lattice-progressive-done", { text: t("progressive.loading") }));
    }
  }
  /** Vizuální stav „dobírám další stránku" (jen aktualizuje patičku). */
  setProgressiveLoading() {
    if (this.grid.progressive) this.renderFooter();
  }
  _renderPager(container, show) {
    if (show) {
      container.style.display = "";
      this.grid.pagination.render(container);
    } else {
      clear(container);
      container.style.display = "none";
    }
  }
  /**
   * Ikona toolbaru — knihovna dodává bezzávislostní SVG default, hostitelská
   * aplikace ho může přepsat přes options.icons (např. Bootstrap Icons v EverFLOW:
   *   icons: { settings: '<i class="bi bi-gear"></i>', columns: '<i class="bi bi-layout-three-columns"></i>' }).
   * Klíče: 'settings', 'columns', 'advancedFilter'.
   */
  icon(name, fallback) {
    const custom = this.grid.options.icons && this.grid.options.icons[name];
    return custom != null && custom !== "" ? custom : fallback;
  }
  /** Ovládání historie: undo · redo · vymazat historii. */
  buildHistoryControls() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const h = grid.history;
    const wrap = el("div.lattice-hist-controls");
    const btn = (html, title, on, disabled) => {
      const b = el("button.lattice-hist-btn", { type: "button", title, html });
      b.disabled = disabled;
      if (!disabled) b.addEventListener("click", on);
      return b;
    };
    wrap.append(
      btn(UNDO_SVG, t("history.undo") + (h.undoSize() ? " (" + h.undoSize() + ")" : ""), () => grid.undo(), !h.canUndo()),
      btn(REDO_SVG, t("history.redo") + (h.redoSize() ? " (" + h.redoSize() + ")" : ""), () => grid.redo(), !h.canRedo()),
      btn(CLEAR_HIST_SVG, t("history.clear"), () => grid.clearHistory(), !h.canUndo() && !h.canRedo())
    );
    return wrap;
  }
  /** Ovládání úrovní stromu: sbalit vše · − úroveň · N/M · + úroveň · rozbalit vše. */
  buildTreeControls() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const tree = grid.tree;
    const wrap = el("div.lattice-tree-controls");
    const readout = el("span.lattice-tree-level", { text: (tree.level ?? 0) + " / " + (tree.depthMax || 0) });
    const sync = () => {
      readout.textContent = (tree.level ?? 0) + " / " + (tree.depthMax || 0);
    };
    const btn = (label, title, on) => {
      const b = el("button.lattice-tree-btn", { type: "button", title, text: label });
      b.addEventListener("click", () => {
        on();
        sync();
      });
      return b;
    };
    wrap.append(
      btn(t("tree.collapseAll"), t("tree.collapseAll"), () => tree.collapseAll()),
      btn("\u2212", t("tree.levelDown"), () => tree.stepLevel(-1)),
      el("span.lattice-tree-level-wrap", {}, [el("span.lattice-tree-level-cap", { text: t("tree.level") }), readout]),
      btn("+", t("tree.levelUp"), () => tree.stepLevel(1)),
      btn(t("tree.expandAll"), t("tree.expandAll"), () => tree.expandAll())
    );
    return wrap;
  }
  renderToolbar() {
    const { toolbar } = this.nodes;
    clear(toolbar);
    const f = this.grid.options.features || {};
    const leftGroup = el("div.lattice-toolbar-left");
    if (this.grid.history) leftGroup.appendChild(this.buildHistoryControls());
    if (this.grid.tree) leftGroup.appendChild(this.buildTreeControls());
    if (this.grid.options.quickSearch) {
      const search = el("input.lattice-quicksearch", {
        type: "search",
        placeholder: this.grid.i18n.t("filters.quickSearch"),
        value: this.grid.quickSearch || ""
      });
      let deb;
      search.addEventListener("input", () => {
        clearTimeout(deb);
        deb = setTimeout(() => this.grid.setQuickSearch(search.value), 200);
      });
      leftGroup.appendChild(search);
    }
    if (leftGroup.children.length) toolbar.appendChild(leftGroup);
    const clearBtn = el("button.lattice-tool-btn.lattice-clear-filters" + (this.grid.hasActiveFilters() ? ".is-visible" : ""), {
      type: "button",
      title: this.grid.i18n.t("columns.clearFilters"),
      html: CLEAR_FILTER_SVG2
    });
    clearBtn.addEventListener("click", () => this.grid.clearAllFilters());
    toolbar.appendChild(clearBtn);
    if (f.advancedFilter !== false) {
      const grid = this.grid;
      const t = grid.i18n.t.bind(grid.i18n);
      const advBtn = el("button.lattice-tool-btn", {
        type: "button",
        title: t("advanced.title"),
        class: grid.advancedActive() ? "is-active" : "",
        html: this.icon("advancedFilter", ADV_SVG)
      });
      advBtn.addEventListener("click", () => grid.advancedFilter.toggle(advBtn));
      toolbar.appendChild(advBtn);
      const saved = grid.listAdvanced();
      if (saved.length) {
        const sel = el("select.lattice-adv-quick", { title: t("advanced.title") });
        sel.appendChild(el("option", { value: "", text: t("advanced.savedPlaceholder") }));
        for (const s of saved) sel.appendChild(el("option", { value: s.id, text: s.name }));
        sel.value = grid.activeSavedId();
        sel.addEventListener("change", () => {
          if (!sel.value) {
            grid.clearAdvanced();
            return;
          }
          const item = saved.find((x) => x.id === sel.value);
          if (item) grid.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
        });
        toolbar.appendChild(sel);
      }
    }
    if (f.gear !== false) {
      const gearBtn = el("button.lattice-tool-btn", { type: "button", title: this.grid.i18n.t("columns.manage"), html: this.icon("columns", GEAR_SVG) });
      gearBtn.addEventListener("click", () => this.grid.gear.toggle(gearBtn));
      toolbar.appendChild(gearBtn);
    }
    if (f.instanceSettings !== false) {
      const setBtn = el("button.lattice-tool-btn", { type: "button", title: this.grid.i18n.t("instance.title"), html: this.icon("settings", COG_SVG) });
      if (this.grid.globalDefaultsAvailable()) setBtn.classList.add("has-gd-note");
      setBtn.addEventListener("click", () => this.grid.instanceSettings.toggle(setBtn));
      toolbar.appendChild(setBtn);
    }
  }
  /** Ukáže/skryje mazací ikonu filtrů v záhlaví podle toho, zda je nějaký aplikován. */
  updateFilterClearBtn() {
    const btn = this.nodes.toolbar && this.nodes.toolbar.querySelector(".lattice-clear-filters");
    if (btn) btn.classList.toggle("is-visible", this.grid.hasActiveFilters());
  }
  /* -------- overlay stavy -------- */
  setLoading(on) {
    this.nodes.root.classList.toggle("is-loading", !!on);
    if (on) this.showOverlay(this.grid.i18n.t("loading"), "loading");
    else this.updateOverlay();
  }
  setError(msg) {
    this.showOverlay(msg || this.grid.i18n.t("error"), "error");
  }
  updateOverlay() {
    const empty = !this.grid.rows || this.grid.rows.length === 0;
    if (empty && !this.nodes.root.classList.contains("is-loading")) {
      this.showOverlay(this.grid.i18n.t("empty"), "empty");
    } else {
      this.hideOverlay();
    }
  }
  showOverlay(text, kind) {
    const o = this.nodes.overlay;
    o.className = "lattice-overlay is-" + kind;
    o.textContent = text;
    o.style.display = "flex";
  }
  hideOverlay() {
    this.nodes.overlay.style.display = "none";
  }
  /* -------- vzhled instance (density/font/layout) -------- */
  applyInstanceStyles() {
    const { root } = this.nodes;
    const inst = this.grid.instance;
    root.classList.toggle("is-compact", inst.density === "compact");
    root.classList.toggle("is-comfortable", inst.density !== "compact");
    root.classList.toggle("layout-fit", inst.layout === "fit");
    root.classList.toggle("layout-fitData", inst.layout !== "fit");
    root.classList.toggle("no-zebra", inst.zebra === false);
    root.classList.toggle("wrap-text", inst.wrapText === true);
    const theme = inst.theme && inst.theme !== "default" ? inst.theme : null;
    if (theme) document.documentElement.setAttribute("data-lattice-theme", theme);
    else document.documentElement.removeAttribute("data-lattice-theme");
    for (const name of this._cssVarNames || []) root.style.removeProperty(name);
    const applied = [];
    const cv = inst.cssVars || {};
    for (const name in cv) {
      if (String(name).startsWith("--lattice-") && cv[name] != null && cv[name] !== "") {
        root.style.setProperty(name, cv[name]);
        applied.push(name);
      }
    }
    this._cssVarNames = applied;
    root.style.setProperty("--lattice-font-size", (inst.fontSize || 14) + "px");
    if (inst.fontFamily) root.style.setProperty("--lattice-font", inst.fontFamily);
    else if (!("--lattice-font" in cv)) root.style.removeProperty("--lattice-font");
    const sc = Array.isArray(inst.scaleColors) && inst.scaleColors.length === 3 ? inst.scaleColors : DEFAULT_SCALE_COLORS;
    if (!("--lattice-bool-true" in cv)) root.style.setProperty("--lattice-bool-true", sc[2]);
    if (!("--lattice-bool-false" in cv)) root.style.setProperty("--lattice-bool-false", sc[0]);
  }
};
function applyCond(node, classFn, styleFn, args) {
  if (typeof classFn === "function") {
    try {
      const c = classFn(...args);
      const cls = Array.isArray(c) ? c : c ? String(c).split(/\s+/) : [];
      for (const x of cls) if (x) node.classList.add(x);
    } catch {
    }
  }
  if (typeof styleFn === "function") {
    try {
      const s = styleFn(...args);
      if (s && typeof s === "object") for (const k in s) node.style[k] = s[k];
    } catch {
    }
  }
}
function condScaleColor(col, value, grid) {
  const cf = col.condFormat;
  if (!cf || !cf.on) return null;
  const v = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(v)) return null;
  const levels = cf.levels || 3;
  const th = Array.isArray(cf.thresholds) && cf.thresholds.length === levels - 1 ? cf.thresholds : grid.autoThresholds(col.field, levels);
  if (!th || !th.length) return null;
  const idx = levelIndex(v, th);
  const colors = Array.isArray(cf.colors) && cf.colors.length === 3 ? cf.colors : grid.instance.scaleColors || DEFAULT_SCALE_COLORS;
  return levelColor(colors, idx, levels, cf.reverse, cf.mode);
}
function collectGroupRows(node) {
  if (node.rows) return node.rows.map((r) => r.row);
  const out = [];
  for (const g of node.groups || []) out.push(...collectGroupRows(g));
  return out;
}
var UNIVERSAL_OPS = [
  { op: "eq", label: "=" },
  { op: "lt", label: "<" },
  { op: "lte", label: "<=" },
  { op: "gt", label: ">" },
  { op: "gte", label: ">=" },
  { op: "neq", label: "!=" },
  { op: "contains", label: "like" },
  { op: "ncontains", label: "!like" }
];
var FILTER_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
var ADV_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h14l-5 6.5v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-star-on, #f5b301)" stroke-width="3" stroke-linecap="round" d="M18 11.5v7m-3.5-3.5h7"/></svg>';
var GEAR_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 4h12v1.5H2zM2 7.25h12v1.5H2zM2 10.5h12V12H2z"/></svg>';
var CLEAR_FILTER_SVG2 = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
var UNDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></svg>';
var REDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h2"/></svg>';
var CLEAR_HIST_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
var CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>';
function colWidth(c) {
  const w = Number(c.width) || Number(c.minWidth) || 0;
  return w > 0 ? w : 120;
}
var EYE_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 3C4.5 3 1.7 5.1.5 8c1.2 2.9 4 5 7.5 5s6.3-2.1 7.5-5C14.3 5.1 11.5 3 8 3zm0 8.3A3.3 3.3 0 118 4.7a3.3 3.3 0 010 6.6zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z"/></svg>';
var PENCIL_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12.1 1.6a1.4 1.4 0 012 2l-.9.9-2-2 .9-.9zM10 3.2l2 2-6.7 6.7-2.6.6.6-2.6L10 3.2z"/></svg>';
var TRASH_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2zm-2.5 4h9l-.7 8.3a1 1 0 01-1 .9H5.2a1 1 0 01-1-.9L3.5 6zm2.7 1.5.3 6h1l-.3-6h-1zm3.6 0-.3 6h1l.3-6h-1z"/></svg>';
var ACTION_DEFAULTS = {
  view: { icon: EYE_SVG },
  edit: { icon: PENCIL_SVG },
  delete: { icon: TRASH_SVG, danger: true }
};
var COG_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/></svg>';

// src/features/pagination.js
var ALL_PAGE_SIZE = 1e9;
var Pagination = class {
  constructor(grid) {
    this.grid = grid;
  }
  render(footer) {
    clear(footer);
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const page = grid.page;
    const last = grid.lastPage || 1;
    const total = grid.total ?? 0;
    const from = total === 0 ? 0 : (page - 1) * grid.pageSize + 1;
    const to = Math.min(page * grid.pageSize, total);
    const info = el("div.lattice-page-info", {
      text: total === 0 ? t("pagination.empty") : t("pagination.showing", { from, to, total })
    });
    const sizes = grid.options.pageSizes || [10, 25, 50, 100];
    const isAll = grid.pageSize >= ALL_PAGE_SIZE;
    const sizeSel = el("select.lattice-page-size");
    for (const s of sizes) sizeSel.appendChild(el("option", { value: s, text: String(s) }));
    if (grid.options.pageSizeAll !== false) sizeSel.appendChild(el("option", { value: "all", text: t("pagination.all") }));
    sizeSel.value = isAll ? "all" : String(grid.pageSize);
    sizeSel.addEventListener("change", () => grid.setPageSize(sizeSel.value === "all" ? ALL_PAGE_SIZE : Number(sizeSel.value)));
    const nav = el("div.lattice-page-nav");
    const btn = (label, targetPage, { disabled = false, active = false, title } = {}) => {
      const b = el("button.lattice-page-btn", { type: "button", text: label });
      if (title) b.title = title;
      if (active) b.classList.add("is-active");
      b.disabled = disabled;
      if (!disabled && !active) b.addEventListener("click", () => grid.setPage(targetPage));
      return b;
    };
    nav.appendChild(btn(t("pagination.first"), 1, { disabled: page <= 1, title: t("pagination.firstTitle") }));
    nav.appendChild(btn(t("pagination.prev"), page - 1, { disabled: page <= 1, title: t("pagination.prevTitle") }));
    for (const p of this.pageWindow(page, last)) {
      nav.appendChild(btn(String(p), p, { active: p === page }));
    }
    nav.appendChild(btn(t("pagination.next"), page + 1, { disabled: page >= last, title: t("pagination.nextTitle") }));
    nav.appendChild(btn(t("pagination.last"), last, { disabled: page >= last, title: t("pagination.lastTitle") }));
    const jump = el("input.lattice-page-jump", { type: "number", min: 1, max: last, value: String(page), title: t("pagination.gotoTitle") });
    const go = () => {
      const v = parseInt(jump.value, 10);
      if (Number.isFinite(v) && v !== page) grid.setPage(Math.min(Math.max(1, v), last));
    };
    jump.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
    jump.addEventListener("change", go);
    const jumpWrap = el("div.lattice-page-jump-wrap", {}, [
      el("span", { text: t("pagination.pageLabel") }),
      jump,
      el("span.lattice-page-size-label", { text: "/ " + last })
    ]);
    const controls = el("div.lattice-page-controls", {}, [
      el("span.lattice-page-size-label", { text: t("pagination.pageSize") }),
      sizeSel,
      nav,
      jumpWrap
    ]);
    footer.append(info, controls);
  }
  /** Vrátí okno čísel stránek kolem aktuální (count tlačítek, klampováno). */
  pageWindow(page, last) {
    const count = this.grid.options.paginationButtons ?? 5;
    let start = Math.max(1, page - Math.floor(count / 2));
    let end = Math.min(last, start + count - 1);
    start = Math.max(1, end - count + 1);
    const out = [];
    for (let p = start; p <= end; p++) out.push(p);
    return out;
  }
};

// src/features/presets.js
var PresetStore = class {
  constructor(grid) {
    this.grid = grid;
    const o = grid.options;
    this.adapter = o.presets && o.presets.global ? o.presets.global : null;
    this.globals = (Array.isArray(o.globalPresets) ? o.globalPresets : []).map((p) => ({ ...p, scope: "global" }));
    this.globalsLoaded = !this.adapter;
  }
  /** Lze uložit globální preset? (callback nebo legacy adaptér) */
  canSaveGlobal() {
    return typeof this.grid.options.onSaveGlobalPreset === "function" || !!(this.adapter && this.adapter.save);
  }
  /** Má legacy adaptér, který je potřeba asynchronně načíst? */
  hasAdapter() {
    return !!this.adapter;
  }
  /** Lokální presety žijí v blobu (jeden zdroj pravdy). */
  local() {
    return this.grid.state.presets || [];
  }
  /** Legacy: načte globální presety z adaptéru (async). U init pole je no-op. */
  async loadGlobals() {
    if (this.adapter && this.adapter.load) {
      try {
        const list = await this.adapter.load();
        this.globals = (Array.isArray(list) ? list : []).map((p) => ({ ...p, scope: "global" }));
      } catch {
      }
    }
    this.globalsLoaded = true;
    return this.globals;
  }
  /** Sjednocený seznam pro UI (lokální + globální), každý se `scope`. */
  all() {
    const loc = this.local().map((p) => ({ ...p, scope: "local" }));
    return [...loc, ...this.globals];
  }
  /** Uloží aktuální stav jako lokální preset (stejný název přepíše). */
  saveLocal(name) {
    const preset = { id: uid(), name: String(name).trim(), state: this.grid.captureState() };
    if (!preset.name) return null;
    const list = this.local().filter((p) => p.name !== preset.name);
    list.push(preset);
    this.grid.state.presets = list;
    this.grid.saveState();
    return preset;
  }
  /**
   * Uloží aktuální stav jako globální preset. Knihovna preset jen sestaví, ukáže
   * v seznamu a předá aplikaci přes callback onSaveGlobalPreset(preset) — ta si
   * poradí s perzistencí (DB, sdílení mezi uživateli). Vrací sestavený preset.
   */
  saveGlobal(name) {
    const preset = { id: uid(), name: String(name).trim(), state: this.grid.captureState() };
    if (!preset.name) return null;
    this.globals = this.globals.filter((p) => p.name !== preset.name);
    const norm5 = { ...preset, scope: "global" };
    this.globals.push(norm5);
    const cb = this.grid.options.onSaveGlobalPreset;
    if (typeof cb === "function") cb({ id: preset.id, name: preset.name, state: preset.state });
    else if (this.adapter && this.adapter.save) Promise.resolve(this.adapter.save(preset)).catch(() => {
    });
    return norm5;
  }
  /** Smaže preset (lokální z blobu; globální z UI + callback / adaptér aplikace). */
  async remove(preset) {
    if (preset.scope === "global") {
      this.globals = this.globals.filter((p) => p.id !== preset.id);
      const cb = this.grid.options.onDeleteGlobalPreset;
      if (typeof cb === "function") cb({ id: preset.id, name: preset.name });
      else if (this.adapter && this.adapter.remove) await this.adapter.remove(preset.id);
    } else {
      this.grid.state.presets = this.local().filter((p) => p.id !== preset.id);
      this.grid.saveState();
    }
  }
};
function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// src/features/advancedFilter.js
var AdvancedFilter = class {
  constructor(grid) {
    this.grid = grid;
    this.panel = null;
    this.off = null;
    this.tree = null;
    this.selectedId = "";
  }
  toggle(anchor) {
    if (this.panel) return this.close();
    this.open(anchor);
  }
  open(anchor) {
    this.anchor = anchor;
    this.tree = this.grid.advanced ? clone(this.grid.advanced) : freshGroup(this.grid);
    this.selectedId = this.matchSavedId(this.grid.advanced);
    const panel = el("div.lattice-panel.lattice-adv-panel");
    this.panel = panel;
    this.renderPanel();
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.off = onOutside(panel, (e) => {
      if (!anchor.contains(e.target)) this.close();
    });
  }
  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }
  /** Vrátí id uloženého filtru, jehož strom odpovídá `tree` (nebo ''). */
  matchSavedId(tree) {
    if (!tree) return "";
    const s = JSON.stringify(tree);
    const f = this.grid.listAdvanced().find((x) => JSON.stringify(x.tree) === s);
    return f ? f.id : "";
  }
  renderPanel() {
    const panel = this.panel;
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    clear(panel);
    panel.appendChild(el("div.lattice-panel-head", {}, [
      el("span.lattice-panel-title", { text: t("advanced.title") })
    ]));
    this.savedRow = this.buildSavedRow();
    panel.appendChild(this.savedRow);
    this.builderEl = el("div.lattice-adv-builder");
    this.renderBuilder();
    panel.appendChild(this.builderEl);
    const nameInput = el("input.lattice-adv-name", { type: "text", placeholder: t("advanced.namePlaceholder") });
    const saveBtn = el("button.lattice-dr-btn", { type: "button", text: t("advanced.save") });
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const item = this.grid.saveAdvanced(name, this.tree);
      nameInput.value = "";
      this.selectedId = item ? item.id : this.selectedId;
      this.refreshSavedRow();
    });
    const clearBtn = el("button.lattice-dr-btn", { type: "button", text: t("advanced.clear") });
    clearBtn.addEventListener("click", () => {
      this.grid.clearAdvanced();
      this.close();
    });
    const applyBtn = el("button.lattice-dr-btn.is-primary", { type: "button", text: t("advanced.apply") });
    applyBtn.addEventListener("click", () => {
      this.grid.applyAdvanced(this.tree);
      this.close();
    });
    panel.appendChild(el("div.lattice-adv-footer", {}, [
      el("div.lattice-adv-saverow", {}, [nameInput, saveBtn]),
      el("div.lattice-adv-footer-btns", {}, [clearBtn, applyBtn])
    ]));
  }
  buildSavedRow() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const saved = grid.listAdvanced();
    const sel = el("select.lattice-adv-saved");
    sel.appendChild(el("option", { value: "", text: t("advanced.savedPlaceholder") }));
    for (const f of saved) sel.appendChild(el("option", { value: f.id, text: f.name }));
    sel.value = this.selectedId || "";
    sel.addEventListener("change", () => {
      this.selectedId = sel.value;
      const f = saved.find((x) => x.id === sel.value);
      if (!f) return;
      this.tree = clone(f.tree);
      this.renderBuilder();
      grid.applyAdvanced(this.tree);
    });
    const del = el("button.lattice-icon-btn.is-danger", { type: "button", title: t("advanced.delete"), text: "\xD7" });
    del.addEventListener("click", () => {
      const id = sel.value;
      if (!id) return;
      grid.deleteAdvanced(id);
      this.selectedId = "";
      this.refreshSavedRow();
    });
    return el("div.lattice-adv-saved-row", {}, [sel, del]);
  }
  refreshSavedRow() {
    const fresh = this.buildSavedRow();
    this.savedRow.replaceWith(fresh);
    this.savedRow = fresh;
    if (this.panel) positionUnder(this.panel, this.anchor);
  }
  /* ---------------- builder ---------------- */
  renderBuilder() {
    clear(this.builderEl);
    this.builderEl.appendChild(this.renderGroup(this.tree, null));
    if (this.panel) positionUnder(this.panel, this.anchor);
  }
  rerender() {
    this.selectedId = "";
    if (this.savedRow) {
      const s = this.savedRow.querySelector("select");
      if (s) s.value = "";
    }
    this.renderBuilder();
  }
  renderGroup(group, parent) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const grid = this.grid;
    const box = el("div.lattice-adv-group");
    const combSel = el("select.lattice-adv-comb");
    combSel.appendChild(el("option", { value: "AND", text: t("advanced.and") }));
    combSel.appendChild(el("option", { value: "OR", text: t("advanced.or") }));
    combSel.value = group.combinator || "AND";
    combSel.addEventListener("change", () => {
      group.combinator = combSel.value;
    });
    const addCond = el("button.lattice-adv-add", { type: "button", text: "+ " + t("advanced.addCondition") });
    addCond.addEventListener("click", () => {
      group.rules.push(newCondition(grid));
      this.rerender();
    });
    const addGroup = el("button.lattice-adv-add", { type: "button", text: "+ " + t("advanced.addGroup") });
    addGroup.addEventListener("click", () => {
      group.rules.push({ combinator: "AND", rules: [newCondition(grid)] });
      this.rerender();
    });
    const head = el("div.lattice-adv-group-head", {}, [combSel, addCond, addGroup]);
    if (parent) {
      const rm = el("button.lattice-adv-rm", { type: "button", title: t("advanced.remove"), text: "\xD7" });
      rm.addEventListener("click", () => {
        parent.rules.splice(parent.rules.indexOf(group), 1);
        this.rerender();
      });
      head.appendChild(rm);
    }
    box.appendChild(head);
    const rules = el("div.lattice-adv-rules");
    for (const r of group.rules) {
      rules.appendChild(isGroup(r) ? this.renderGroup(r, group) : this.renderCondition(r, group));
    }
    box.appendChild(rules);
    return box;
  }
  renderCondition(cond, parent) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const row = el("div.lattice-adv-cond");
    const fieldSel = el("select.lattice-adv-field");
    for (const c of this.grid.columns) fieldSel.appendChild(el("option", { value: c.field, text: c.title }));
    fieldSel.value = cond.field;
    fieldSel.addEventListener("change", () => {
      cond.field = fieldSel.value;
    });
    const opSel = el("select.lattice-adv-op");
    for (const op of ADV_OPS) opSel.appendChild(el("option", { value: op, text: t("advanced.ops." + op) }));
    opSel.value = cond.op;
    const valInput = el("input.lattice-adv-value", { type: "text", value: cond.value ?? "", placeholder: t("advanced.valuePlaceholder") });
    valInput.addEventListener("input", () => {
      cond.value = valInput.value;
    });
    const syncVal = () => {
      valInput.style.display = cond.op === "empty" || cond.op === "nempty" ? "none" : "";
    };
    opSel.addEventListener("change", () => {
      cond.op = opSel.value;
      syncVal();
    });
    syncVal();
    const rm = el("button.lattice-adv-rm", { type: "button", title: t("advanced.remove"), text: "\xD7" });
    rm.addEventListener("click", () => {
      parent.rules.splice(parent.rules.indexOf(cond), 1);
      this.rerender();
    });
    row.append(fieldSel, opSel, valInput, rm);
    return row;
  }
};
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
function newCondition(grid) {
  const first = grid.columns[0];
  return { field: first ? first.field : "", op: "contains", value: "" };
}
function freshGroup(grid) {
  return { combinator: "AND", rules: [newCondition(grid)] };
}

// src/features/editing.js
var EditManager = class {
  constructor(grid) {
    this.grid = grid;
    this.active = null;
  }
  /** Napojí delegovaný dvojklik na tělo tabulky (voláno po mount). */
  attach() {
    const body = this.grid.renderer.nodes.body;
    body.addEventListener("dblclick", (e) => this.onDblClick(e));
    body.addEventListener("click", (e) => {
      const cell = e.target.closest(".lattice-cell.is-editable");
      if (cell && !cell.classList.contains("is-editing") && (e.target.closest("a") || e.target.closest("img"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  editable(col) {
    if (col.type === "id") return false;
    if (typeof col.value === "function") return false;
    return col.editable === true || this.grid.options.editable === true;
  }
  onDblClick(e) {
    if (this.active) return;
    const cell = e.target.closest(".lattice-cell[data-field]");
    if (!cell || cell.classList.contains("lattice-summary-cell") || cell.classList.contains("lattice-rownum")) return;
    const rowEl = cell.closest(".lattice-row[data-index]");
    if (!rowEl) return;
    const col = this.grid.columns.find((c) => c.field === cell.dataset.field);
    if (!col || col._rownum || !this.editable(col)) return;
    const idx = Number(rowEl.dataset.index);
    const rowData = this.grid.rows[idx];
    if (!rowData) return;
    this.start(cell, col, rowData, idx);
  }
  start(cell, col, rowData, idx) {
    const editor = resolveEditor(col);
    if (!editor) return;
    this.active = { cell, col, rowData, idx };
    cell.classList.add("is-editing");
    editor(cell, col, rowData, (val) => this.finish(val));
  }
  finish(val) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.cell.classList.remove("is-editing");
    if (val !== void 0 && !equal(val, a.rowData[a.col.field])) {
      const oldValue = a.rowData[a.col.field];
      const vErr = runValidator(a.col, val, a.rowData, this.grid.i18n);
      if (vErr) {
        this.grid.renderer.renderBody();
        this._flashInvalid(a.idx, a.col.field, vErr);
        const inv = this.grid.options.onCellInvalid;
        if (typeof inv === "function") {
          try {
            inv({ field: a.col.field, row: a.rowData, rowIndex: a.idx, value: val, error: vErr });
          } catch {
          }
        }
        return;
      }
      const validate = this.grid.options.onCellValidate;
      if (typeof validate === "function") {
        let ok = true;
        try {
          ok = validate({ field: a.col.field, row: a.rowData, rowIndex: a.idx, oldValue, newValue: val, col: a.col });
        } catch (err) {
          console.error("[Lattice] onCellValidate selhal:", err);
          ok = false;
        }
        if (ok === false) {
          this.grid.renderer.renderBody();
          return;
        }
      }
      a.rowData[a.col.field] = val;
      this.grid.recordEdit(a.rowData, a.col.field, oldValue, val);
      const cb = this.grid.options.onCellEdit;
      if (typeof cb === "function") {
        try {
          cb({ field: a.col.field, row: a.rowData, rowIndex: a.idx, oldValue, newValue: val });
        } catch (err) {
          console.error("[Lattice] onCellEdit selhal:", err);
        }
      }
    }
    this.grid.renderer.renderBody();
  }
  /** Krátce zvýrazní buňku jako neplatnou (červený rámeček + tooltip s chybou). */
  _flashInvalid(idx, field2, err) {
    const cell = this.grid.renderer.nodes.body.querySelector('.lattice-row[data-index="' + idx + '"] .lattice-cell[data-field="' + field2 + '"]');
    if (!cell) return;
    cell.classList.add("is-invalid");
    cell.title = err;
    setTimeout(() => {
      cell.classList.remove("is-invalid");
      if (cell.title === err) cell.removeAttribute("title");
    }, 1800);
  }
};
function runValidator(col, value, row, i18n) {
  const v = col.validator;
  if (!v) return null;
  const rules = Array.isArray(v) ? v : [v];
  for (const rule of rules) {
    const err = checkRule(rule, value, row, col, i18n);
    if (err) return err;
  }
  return null;
}
function checkRule(rule, value, row, col, i18n) {
  const t = (k) => i18n ? i18n.t("validate." + k) : k;
  const empty = value == null || value === "";
  if (rule === "required") return empty ? t("required") : null;
  if (typeof rule === "function") {
    let r;
    try {
      r = rule(value, row, col);
    } catch {
      return t("invalid");
    }
    if (r === true || r == null) return null;
    return typeof r === "string" ? r : t("invalid");
  }
  if (rule instanceof RegExp) return !empty && !rule.test(String(value)) ? t("pattern") : null;
  if (rule && typeof rule === "object") {
    if (rule.required && empty) return rule.message || t("required");
    if (!empty) {
      const s = String(value);
      const num4 = Number(s.replace(/\s/g, "").replace(",", "."));
      if (rule.min != null && !(num4 >= rule.min)) return rule.message || t("min").replace("{n}", rule.min);
      if (rule.max != null && !(num4 <= rule.max)) return rule.message || t("max").replace("{n}", rule.max);
      if (rule.minLen != null && s.length < rule.minLen) return rule.message || t("minLen").replace("{n}", rule.minLen);
      if (rule.maxLen != null && s.length > rule.maxLen) return rule.message || t("maxLen").replace("{n}", rule.maxLen);
      if (rule.pattern) {
        const re = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern);
        if (!re.test(s)) return rule.message || t("pattern");
      }
    }
  }
  return null;
}
function resolveEditor(col) {
  if (col.editor === "multiselect") return multiselectEditor;
  if (col.editor === "select") return selectEditor;
  if (col.filter === "select" || col.filter === "multiselect") return selectEditor;
  switch (col.type) {
    case "number":
    case "money":
      return numberEditor;
    case "boolean":
      return booleanEditor;
    case "tick":
      return tickEditor;
    case "progress":
      return progressEditor;
    case "rating":
      return ratingEditor;
    case "color":
      return colorEditor;
    case "date":
      return dateEditor(false);
    case "datetime":
      return dateEditor(true);
    case "link":
      return linkEditor;
    case "image":
    case "icon":
      return urlEditor;
    default:
      return textEditor;
  }
}
function textEditor(cell, col, rowData, done) {
  const input = el("input.lattice-edit-input", { type: "text", value: str(rowData[col.field]) });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => done(input.value), () => done(void 0));
}
function numberEditor(cell, col, rowData, done) {
  const input = el("input.lattice-edit-input.is-number", { type: "text", inputMode: "decimal", value: str(rowData[col.field]) });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^\d.,\-]/g, "");
  });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => {
    const t = input.value.trim();
    if (t === "") return done(null);
    const n = Number(t.replace(/\s/g, "").replace(",", "."));
    done(Number.isFinite(n) ? n : void 0);
  }, () => done(void 0));
}
function urlEditor(cell, col, rowData, done) {
  const input = el("input.lattice-edit-input", { type: "text", value: str(rowData[col.field]) });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => done(input.value), () => done(void 0));
}
function booleanEditor(cell, col, rowData, done) {
  const cur = rowData[col.field];
  done(!(cur === true || cur === 1 || cur === "1" || cur === "true"));
}
function tickEditor(cell, col, rowData, done) {
  booleanEditor(cell, col, rowData, done);
}
function ratingEditor(cell, col, rowData, done) {
  const max = col.formatterParams && col.formatterParams.max != null ? col.formatterParams.max : 5;
  const cur = Math.round(num3(rowData[col.field]) || 0);
  const wrap = el("span.lattice-edit-rating");
  const render = (val) => {
    clear(wrap);
    for (let i = 1; i <= max; i++) {
      const s = el("span.lattice-star " + (i <= val ? "is-on" : "is-off"), { text: "\u2605" });
      s.dataset.v = String(i);
      wrap.appendChild(s);
    }
  };
  render(cur);
  wrap.addEventListener("mousemove", (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (v) render(Number(v));
  });
  wrap.addEventListener("mouseleave", () => render(cur));
  wrap.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const v = e.target.dataset && e.target.dataset.v;
    if (v) done(Number(v));
  });
  swapCell(cell, wrap);
  const off = onOutside(wrap, () => {
    off();
    done(void 0);
  });
}
function progressEditor(cell, col, rowData, done) {
  const max = col.formatterParams && col.formatterParams.max != null ? col.formatterParams.max : 100;
  let val = clamp(num3(rowData[col.field]) || 0, 0, max);
  const bar = el("div.lattice-edit-progress-bar");
  const track = el("div.lattice-edit-progress", {}, [bar]);
  const label = el("span.lattice-edit-progress-label");
  const apply = (pct) => {
    pct = clamp(pct, 0, 1);
    val = Math.round(pct * max);
    bar.style.width = pct * 100 + "%";
    label.textContent = Math.round(pct * 100) + " %";
  };
  apply(val / max);
  const fromX = (clientX) => {
    const r = track.getBoundingClientRect();
    apply((clientX - r.left) / r.width);
  };
  track.addEventListener("mousedown", (e) => {
    e.preventDefault();
    fromX(e.clientX);
    const mv = (ev) => fromX(ev.clientX);
    const up = () => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      done(val);
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  });
  swapCell(cell, el("div.lattice-edit-progress-wrap", {}, [track, label]));
  const off = onOutside(track, () => {
    off();
    done(void 0);
  });
}
function linkEditor(cell, col, rowData, done) {
  const cur = rowData[col.field];
  const isObj = cur != null && typeof cur === "object";
  const menu = el("div.lattice-menu.lattice-edit-popup");
  const t = (k) => k;
  let inputs;
  if (isObj) {
    const label = el("input.lattice-edit-input", { type: "text", value: str(cur.label != null ? cur.label : cur.text != null ? cur.text : "") });
    const url = el("input.lattice-edit-input", { type: "text", value: str(cur.url != null ? cur.url : cur.href != null ? cur.href : "") });
    const target = el("input.lattice-edit-input", { type: "text", value: str(cur.target || "") });
    menu.append(row("Text", label), row("URL", url), row("Target", target));
    inputs = () => {
      const out = { ...cur };
      if ("label" in cur || cur.label != null) out.label = label.value;
      else out.text = label.value;
      if ("url" in cur || cur.url != null) out.url = url.value;
      else out.href = url.value;
      out.target = target.value || void 0;
      return out;
    };
  } else {
    const url = el("input.lattice-edit-input", { type: "text", value: str(cur) });
    menu.append(row("URL", url));
    inputs = () => url.value;
  }
  const okBtn = el("button.lattice-dr-btn.is-primary", { type: "button", text: "\u2713" });
  okBtn.addEventListener("click", () => {
    close();
    done(inputs());
  });
  menu.appendChild(el("div.lattice-edit-popup-foot", {}, [okBtn]));
  openPopup2(cell, menu, () => done(void 0));
  const off = onOutside(menu, (e) => {
    if (!menu.contains(e.target)) {
      close();
      done(void 0);
    }
  });
  function close() {
    off();
    menu.remove();
  }
  function row(lbl, input) {
    return el("label.lattice-edit-row", {}, [el("span", { text: lbl }), input]);
  }
}
function colorEditor(cell, col, rowData, done) {
  let rgb = parseColor(str(rowData[col.field])) || { r: 0, g: 0, b: 0 };
  const menu = el("div.lattice-menu.lattice-edit-popup.lattice-edit-color");
  const preview = el("input", { type: "color", value: rgbToHex(rgb) });
  const hex = el("input.lattice-edit-input", { type: "text", value: rgbToHex(rgb) });
  const r = numIn(rgb.r), g = numIn(rgb.g), b = numIn(rgb.b);
  const cmyk = rgbToCmyk(rgb);
  const c = numIn(cmyk.c), m = numIn(cmyk.m, 100), y = numIn(cmyk.y, 100), k = numIn(cmyk.k, 100);
  const syncFrom = (src) => {
    if (src === "picker") rgb = parseColor(preview.value);
    else if (src === "hex") {
      const p = parseColor(hex.value);
      if (p) rgb = p;
    } else if (src === "rgb") rgb = { r: clampI(r.value, 255), g: clampI(g.value, 255), b: clampI(b.value, 255) };
    else if (src === "cmyk") rgb = cmykToRgb({ c: clampI(c.value, 100), m: clampI(m.value, 100), y: clampI(y.value, 100), k: clampI(k.value, 100) });
    const hx = rgbToHex(rgb);
    preview.value = hx;
    hex.value = hx;
    r.value = rgb.r;
    g.value = rgb.g;
    b.value = rgb.b;
    const ck = rgbToCmyk(rgb);
    c.value = ck.c;
    m.value = ck.m;
    y.value = ck.y;
    k.value = ck.k;
  };
  preview.addEventListener("input", () => syncFrom("picker"));
  hex.addEventListener("change", () => syncFrom("hex"));
  [r, g, b].forEach((i) => i.addEventListener("input", () => syncFrom("rgb")));
  [c, m, y, k].forEach((i) => i.addEventListener("input", () => syncFrom("cmyk")));
  menu.append(
    el("div.lattice-edit-color-top", {}, [preview, el("label", {}, [el("span", { text: "HEX" }), hex])]),
    el("div.lattice-edit-color-grp", {}, [el("span.lattice-edit-color-lbl", { text: "RGB" }), r, g, b]),
    el("div.lattice-edit-color-grp", {}, [el("span.lattice-edit-color-lbl", { text: "CMYK" }), c, m, y, k])
  );
  const okBtn = el("button.lattice-dr-btn.is-primary", { type: "button", text: "\u2713" });
  okBtn.addEventListener("click", () => {
    close();
    done(rgbToHex(rgb));
  });
  menu.appendChild(el("div.lattice-edit-popup-foot", {}, [okBtn]));
  openPopup2(cell, menu, () => done(void 0));
  const off = onOutside(menu, (e) => {
    if (!menu.contains(e.target)) {
      close();
      done(void 0);
    }
  });
  function close() {
    off();
    menu.remove();
  }
  function numIn(v, maxAttr = 255) {
    return el("input.lattice-edit-num", { type: "number", min: 0, max: maxAttr, value: v });
  }
}
function dateEditor(withTime) {
  return (cell, col, rowData, done) => {
    const cur = parseDate(rowData[col.field]) || /* @__PURE__ */ new Date();
    let view = { y: cur.getFullYear(), m: cur.getMonth() };
    let picked = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const menu = el("div.lattice-menu.lattice-edit-popup.lattice-edit-date");
    const cal = el("div.lattice-edit-cal");
    const time2 = withTime ? el("div.lattice-edit-time") : null;
    let hh = cur.getHours(), mm = cur.getMinutes();
    const monthsCs = ["Leden", "\xDAnor", "B\u0159ezen", "Duben", "Kv\u011Bten", "\u010Cerven", "\u010Cervenec", "Srpen", "Z\xE1\u0159\xED", "\u0158\xEDjen", "Listopad", "Prosinec"];
    const renderCal = () => {
      clear(cal);
      const head = el("div.lattice-edit-cal-head");
      const prev = el("button.lattice-dr-nav", { type: "button", html: "\u2039" });
      const next = el("button.lattice-dr-nav", { type: "button", html: "\u203A" });
      prev.addEventListener("click", () => {
        view = addMonth(view, -1);
        renderCal();
      });
      next.addEventListener("click", () => {
        view = addMonth(view, 1);
        renderCal();
      });
      head.append(prev, el("span.lattice-dr-cal-title", { text: monthsCs[view.m] + " " + view.y }), next);
      cal.appendChild(head);
      const wd = el("div.lattice-dr-weekdays");
      for (const d of ["Po", "\xDAt", "St", "\u010Ct", "P\xE1", "So", "Ne"]) wd.appendChild(el("span", { text: d }));
      cal.appendChild(wd);
      const grid = el("div.lattice-dr-grid");
      for (const c of monthMatrix2(view.y, view.m)) {
        const btn = el("button.lattice-dr-day", { type: "button", text: String(c.date.getDate()) });
        if (!c.inMonth) btn.classList.add("is-out");
        if (sameDay(c.date, picked)) btn.classList.add("is-selected");
        btn.addEventListener("click", () => {
          picked = c.date;
          if (!withTime) commit();
          else renderCal();
        });
        grid.appendChild(btn);
      }
      cal.appendChild(grid);
    };
    renderCal();
    menu.appendChild(cal);
    if (withTime) {
      const h = el("input.lattice-edit-num", { type: "number", min: 0, max: 23, value: pad3(hh) });
      const mi = el("input.lattice-edit-num", { type: "number", min: 0, max: 59, value: pad3(mm) });
      h.addEventListener("input", () => {
        hh = clampI(h.value, 23);
      });
      mi.addEventListener("input", () => {
        mm = clampI(mi.value, 59);
      });
      const ok = el("button.lattice-dr-btn.is-primary", { type: "button", text: "\u2713" });
      ok.addEventListener("click", () => commit());
      time2.append(el("span", { text: "\u23F1" }), h, el("span", { text: ":" }), mi, ok);
      menu.appendChild(time2);
    }
    openPopup2(cell, menu, () => done(void 0));
    const off = onOutside(menu, (e) => {
      if (!menu.contains(e.target)) {
        close();
        done(void 0);
      }
    });
    function close() {
      off();
      menu.remove();
    }
    function commit() {
      close();
      const d = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), withTime ? hh : 0, withTime ? mm : 0);
      done(withTime ? isoDateTime(d) : isoDate(d));
    }
  };
}
function selectEditor(cell, col, rowData, done) {
  loadOptions(col).then((opts) => {
    const menu = el("div.lattice-menu.lattice-edit-popup.lattice-edit-select");
    const cur = str(rowData[col.field]);
    for (const o of opts) {
      const item = el("div.lattice-menu-item" + (norm4(o.value) === norm4(cur) ? ".is-active" : ""), { text: o.label });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        close();
        done(o.value);
      });
      menu.appendChild(item);
    }
    openPopup2(cell, menu, () => done(void 0));
    const off = onOutside(menu, (e) => {
      if (!menu.contains(e.target)) {
        close();
        done(void 0);
      }
    });
    function close() {
      off();
      menu.remove();
    }
  });
}
function multiselectEditor(cell, col, rowData, done) {
  loadOptions(col).then((opts) => {
    const cur = Array.isArray(rowData[col.field]) ? rowData[col.field].map(String) : rowData[col.field] != null && rowData[col.field] !== "" ? [String(rowData[col.field])] : [];
    const sel = new Set(cur.map(norm4));
    const menu = el("div.lattice-menu.lattice-edit-popup.lattice-edit-select");
    const list = el("div.lattice-ms-list");
    const render = () => {
      clear(list);
      for (const o of opts) {
        const on = sel.has(norm4(o.value));
        const item = el("div.lattice-menu-item" + (on ? ".is-selected" : ""), {}, [
          el("span.lattice-ms-check", { text: on ? "\u2713" : "" }),
          el("span", { text: o.label })
        ]);
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (sel.has(norm4(o.value))) sel.delete(norm4(o.value));
          else sel.add(norm4(o.value));
          render();
        });
        list.appendChild(item);
      }
    };
    render();
    const ok = el("button.lattice-dr-btn.is-primary", { type: "button", text: "\u2713" });
    ok.addEventListener("click", () => {
      close();
      done(opts.filter((o) => sel.has(norm4(o.value))).map((o) => o.value));
    });
    menu.append(list, el("div.lattice-edit-popup-foot", {}, [ok]));
    openPopup2(cell, menu, () => done(void 0));
    const off = onOutside(menu, (e) => {
      if (!menu.contains(e.target)) {
        close();
        done(void 0);
      }
    });
    function close() {
      off();
      menu.remove();
    }
  });
}
function loadOptions(col) {
  const norm5 = (o) => o != null && typeof o === "object" ? { value: String(o.value), label: String(o.label != null ? o.label : o.value) } : { value: String(o), label: String(o) };
  if (Array.isArray(col.filterValues)) return Promise.resolve(col.filterValues.map(norm5));
  if (col.filterUrl) return fetch(col.filterUrl).then((r) => r.json()).then((d) => (Array.isArray(d) ? d : d.data || []).map(norm5)).catch(() => []);
  return Promise.resolve([]);
}
function swapCell(cell, node) {
  clear(cell);
  cell.appendChild(node);
}
function focusInput(input) {
  setTimeout(() => {
    input.focus();
    input.select && input.select();
  }, 0);
}
function bindInput(input, commit, cancel) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);
}
function openPopup2(cell, menu, onCancelEsc) {
  document.body.appendChild(menu);
  positionUnder(menu, cell);
  const onKey = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      onCancelEsc();
      menu.remove();
    }
  };
  document.addEventListener("keydown", onKey);
}
function str(v) {
  return v == null ? "" : String(v);
}
function num3(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function norm4(v) {
  return String(v ?? "").toLowerCase().trim();
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clampI(v, hi) {
  return clamp(Math.round(Number(v) || 0), 0, hi);
}
function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
var pad3 = (n) => String(n).padStart(2, "0");
function parseDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addMonth(v, delta) {
  const d = new Date(v.y, v.m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}
function monthMatrix2(y, m) {
  const first = new Date(y, m, 1);
  const off = (first.getDay() + 6) % 7;
  const out = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(y, m, 1 - off + i);
    out.push({ date, inMonth: date.getMonth() === m });
  }
  return out;
}
function isoDate(d) {
  return `${d.getFullYear()}-${pad3(d.getMonth() + 1)}-${pad3(d.getDate())}`;
}
function isoDateTime(d) {
  return `${isoDate(d)} ${pad3(d.getHours())}:${pad3(d.getMinutes())}`;
}
function parseColor(s) {
  s = String(s || "").trim();
  let m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
  }
  m = s.match(/^#?([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((x) => pad3(clamp(Math.round(x), 0, 255).toString(16))).join("");
}
function rgbToCmyk({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: Math.round((1 - r - k) / (1 - k) * 100), m: Math.round((1 - g - k) / (1 - k) * 100), y: Math.round((1 - b - k) / (1 - k) * 100), k: Math.round(k * 100) };
}
function cmykToRgb({ c, m, y, k }) {
  c /= 100;
  m /= 100;
  y /= 100;
  k /= 100;
  return { r: Math.round(255 * (1 - c) * (1 - k)), g: Math.round(255 * (1 - m) * (1 - k)), b: Math.round(255 * (1 - y) * (1 - k)) };
}

// src/features/tree.js
var TreeManager = class {
  constructor(grid, options) {
    this.grid = grid;
    this.childField = options.treeChildField || "_children";
    this.idField = options.treeIdField || null;
    this.parentField = options.treeParentField || null;
    this.leftField = options.treeLeftField || null;
    this.rightField = options.treeRightField || null;
    this.orderField = options.orderField || null;
    this.format = "nested";
    this.startExpanded = options.treeStartExpanded != null ? options.treeStartExpanded : false;
    this.expanded = new Set(grid.state.tree || []);
    this._seeded = (grid.state.tree || []).length > 0;
    this.setData(options.data || []);
  }
  /** Přenačte data a přestaví strom (zachová stav rozbalení dle klíčů). */
  setData(data) {
    const arr = Array.isArray(data) ? data : [];
    const nested = arr.some((r) => Array.isArray(r[this.childField]));
    if (nested) {
      this.format = "nested";
      this.roots = this.buildNested(arr, "", 0);
    } else if (this.leftField && this.rightField) {
      this.format = "nested-set";
      this.roots = this.buildNestedSet(arr);
    } else if (this.idField && this.parentField) {
      this.format = "flat";
      this.roots = this.buildFlat(arr);
    } else {
      this.format = "nested";
      this.roots = this.buildNested(arr, "", 0);
    }
    this.computeDepthMax();
    if (!this._seeded) {
      this.seedExpanded(this.roots);
      this._seeded = true;
    }
    this.level = this.startExpanded === true ? this.depthMax : typeof this.startExpanded === "number" ? Math.min(this.startExpanded, this.depthMax) : 0;
  }
  /** Klíč uzlu — stabilní `id` když je k dispozici, jinak cesta parent/index. */
  nodeKey(row, parentKey, index) {
    if (this.idField && row[this.idField] != null) return String(row[this.idField]);
    return parentKey ? parentKey + "/" + index : "#" + index;
  }
  buildNested(arr, parentKey, depth) {
    return arr.map((row, i) => {
      const key = this.nodeKey(row, parentKey, i);
      const kids = Array.isArray(row[this.childField]) ? row[this.childField] : [];
      return { row, key, depth, children: this.buildNested(kids, key, depth + 1) };
    });
  }
  buildFlat(arr) {
    const byId = /* @__PURE__ */ new Map();
    const nodes = arr.map((row) => ({ row, key: String(row[this.idField]), depth: 0, children: [] }));
    for (const n of nodes) byId.set(n.key, n);
    const roots = [];
    for (const n of nodes) {
      const pid = n.row[this.parentField];
      const parent = pid != null && pid !== "" ? byId.get(String(pid)) : null;
      if (parent && parent !== n) parent.children.push(n);
      else roots.push(n);
    }
    const setDepth = (n, d) => {
      n.depth = d;
      for (const c of n.children) setDepth(c, d + 1);
    };
    for (const r of roots) setDepth(r, 0);
    return roots;
  }
  /**
   * Nested set (MPTT): uzly seřadí dle `lft` a zásobníkem předků sestaví strom.
   * Rodič uzlu je poslední otevřený předek (rgt > rgt uzlu). Hloubka = velikost
   * zásobníku předků. Klíč = id (když je), jinak lft (unikátní).
   */
  buildNestedSet(arr) {
    const L = this.leftField, R = this.rightField;
    const nodes = arr.filter((row) => row && row[L] != null && row[R] != null).map((row) => ({
      row,
      key: this.idField && row[this.idField] != null ? String(row[this.idField]) : String(row[L]),
      depth: 0,
      children: []
    }));
    nodes.sort((a, b) => a.row[L] - b.row[L]);
    const roots = [];
    const stack = [];
    for (const n of nodes) {
      while (stack.length && stack[stack.length - 1].row[R] < n.row[R]) stack.pop();
      n.depth = stack.length;
      if (stack.length) stack[stack.length - 1].children.push(n);
      else roots.push(n);
      stack.push(n);
    }
    return roots;
  }
  /** Prvotní naplnění rozbalených uzlů dle startExpanded (jen bez persistence). */
  seedExpanded(nodes) {
    const limit = this.startExpanded === true ? Infinity : typeof this.startExpanded === "number" ? this.startExpanded : 0;
    const walk = (list) => {
      for (const n of list) {
        if (n.depth < limit && n.children.length) this.expanded.add(n.key);
        walk(n.children);
      }
    };
    walk(nodes);
  }
  /** Ploché pořadí viditelných řádků (preorder; potomci jen u rozbalených uzlů). */
  visibleRows() {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        const hasChildren = n.children.length > 0;
        const expanded = this.expanded.has(n.key);
        out.push({ row: n.row, depth: n.depth, hasChildren, expanded, key: n.key });
        if (hasChildren && expanded) walk(n.children);
      }
    };
    walk(this.roots);
    return out;
  }
  /**
   * Viditelné řádky s aplikovaným filtrem. Uzel se zobrazí, pokud sám vyhovuje
   * `predicate`, nebo má vyhovujícího potomka (zachová cestu k shodě). Větve se
   * shodou se automaticky rozbalí, ať jsou nálezy vidět. Bez shody → prázdno.
   */
  filteredRows(predicate) {
    const rec = (nodes) => {
      const rows = [];
      let anyKept = false;
      for (const n of nodes) {
        const child = rec(n.children);
        if (predicate(n.row) || child.kept) {
          anyKept = true;
          rows.push({ row: n.row, depth: n.depth, hasChildren: child.kept, expanded: true, key: n.key });
          if (child.kept) rows.push(...child.rows);
        }
      }
      return { kept: anyKept, rows };
    };
    return rec(this.roots).rows;
  }
  isExpanded(key) {
    return this.expanded.has(key);
  }
  /* ---- přesun uzlů (drag & drop) ---- */
  /** Najde uzel + jeho rodičovské pole a rodičovský uzel. */
  findNode(key) {
    let res = { node: null, parentArr: null, parentNode: null };
    const walk = (nodes, pNode) => {
      for (const n of nodes) {
        if (n.key === key) {
          res = { node: n, parentArr: pNode ? pNode.children : this.roots, parentNode: pNode };
          return true;
        }
        if (walk(n.children, n)) return true;
      }
      return false;
    };
    walk(this.roots, null);
    return res;
  }
  /** Je `node` uvnitř podstromu `anc` (včetně anc)? (ochrana proti přesunu do sebe) */
  contains(anc, node) {
    if (anc === node) return true;
    return anc.children.some((c) => this.contains(c, node));
  }
  /**
   * Přesune uzel (s celým podstromem) k cíli. zone: 'before' | 'after' (mezi
   * sourozence cíle) nebo 'inside' (jako potomek cíle). Vrací pole změněných
   * řádků (s aktualizovanými pořadovými poli) nebo null, když přesun není platný.
   */
  moveNode(dragKey, targetKey, zone) {
    if (dragKey === targetKey) return null;
    const d = this.findNode(dragKey);
    const t = this.findNode(targetKey);
    if (!d.node || !t.node) return null;
    if (this.contains(d.node, t.node)) return null;
    d.parentArr.splice(d.parentArr.indexOf(d.node), 1);
    let destParent, destArr, index;
    if (zone === "inside") {
      destParent = t.node;
      destArr = t.node.children;
      index = destArr.length;
    } else {
      const tp = this.findNode(targetKey);
      destParent = tp.parentNode;
      destArr = tp.parentArr;
      index = destArr.indexOf(tp.node) + (zone === "after" ? 1 : 0);
    }
    destArr.splice(index, 0, d.node);
    this.recomputeDepth();
    const changed = this.persistMove();
    return { row: d.node.row, toParentId: destParent ? destParent.row[this.idField] : null, toIndex: index, changed, format: this.format };
  }
  recomputeDepth() {
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        n.depth = depth;
        walk(n.children, depth + 1);
      }
    };
    walk(this.roots, 0);
  }
  /** Zapíše přesun zpět do řádků dle formátu; vrací změněné řádky. */
  persistMove() {
    if (this.format === "flat") return this.persistFlat();
    if (this.format === "nested-set") return this.persistNestedSet();
    return this.persistNested();
  }
  /** parentId: přepíše parentField + (volitelně) přečísluje orderField sourozenců. */
  persistFlat() {
    const changed = /* @__PURE__ */ new Set();
    const walk = (nodes, parentNode) => {
      nodes.forEach((n, i) => {
        const pid = parentNode ? parentNode.row[this.idField] : null;
        if (n.row[this.parentField] !== pid) {
          n.row[this.parentField] = pid;
          changed.add(n.row);
        }
        if (this.orderField && n.row[this.orderField] !== i + 1) {
          n.row[this.orderField] = i + 1;
          changed.add(n.row);
        }
        walk(n.children, n);
      });
    };
    walk(this.roots, null);
    return [...changed];
  }
  /** _children: přepíše childField pole u všech uzlů (řádky = jejich potomci). */
  persistNested() {
    const changed = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        const kids = n.children.map((c) => c.row);
        n.row[this.childField] = kids;
        changed.push(n.row);
        walk(n.children);
      }
    };
    walk(this.roots);
    return changed;
  }
  /** nested set: přečísluje lft/rgt celého stromu (preorder) a vrátí změněné. */
  persistNestedSet() {
    const changed = [];
    let c = 1;
    const walk = (n) => {
      const lft = c++;
      for (const kid of n.children) walk(kid);
      const rgt = c++;
      if (n.row[this.leftField] !== lft || n.row[this.rightField] !== rgt) {
        n.row[this.leftField] = lft;
        n.row[this.rightField] = rgt;
        changed.push(n.row);
      }
    };
    for (const r of this.roots) walk(r);
    return changed;
  }
  /**
   * Rozbalí / sbalí uzel (persistováno) a překreslí. Při SBALENÍ zapomene i celý
   * podstrom — po opětovném rozbalení jsou vnořené větve sbalené.
   */
  toggle(key) {
    if (this.expanded.has(key)) {
      const { node } = this.findNode(key);
      if (node) this.forgetSubtree(node);
      else this.expanded.delete(key);
    } else {
      this.expanded.add(key);
    }
    this.grid.saveState();
    this.grid.refresh();
  }
  /** Odebere z rozbalených uzel i celý jeho podstrom. */
  forgetSubtree(node) {
    this.expanded.delete(node.key);
    for (const c of node.children) this.forgetSubtree(c);
  }
  /** Nejhlubší úroveň uzlu s potomky (kolik úrovní lze rozbalit). */
  computeDepthMax() {
    let max = 0;
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children.length) {
          max = Math.max(max, n.depth + 1);
          walk(n.children);
        }
      }
    };
    walk(this.roots);
    this.depthMax = max;
    return max;
  }
  /**
   * Rozbalí strom rovnoměrně do úrovně `n`: rozbalí všechny uzly s hloubkou < n
   * (takže je vidět úroveň n), hlubší sbalí. Nahrazuje celý stav rozbalení.
   */
  expandToLevel(n) {
    n = Math.max(0, Math.min(n, this.depthMax || 0));
    this.expanded.clear();
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.children.length && node.depth < n) this.expanded.add(node.key);
        walk(node.children);
      }
    };
    walk(this.roots);
    this.level = n;
    this.grid.saveState();
    this.grid.refresh();
  }
  /** Posune rovnoměrnou úroveň rozbalení o delta (±1). */
  stepLevel(delta) {
    this.expandToLevel((this.level || 0) + delta);
  }
  /** Rozbalí úplně vše. */
  expandAll() {
    this.expandToLevel(this.depthMax || 0);
  }
  /** Sbalí úplně vše (zůstanou jen kořeny). */
  collapseAll() {
    this.expandToLevel(0);
  }
};

// src/features/rangeSelection.js
var RangeManager = class {
  constructor(grid) {
    this.grid = grid;
    this.anchor = null;
    this.focus = null;
    this.dragging = false;
  }
  /** Reálné datové sloupce v render pořadí (bez přesun/výběr/číslování/akce). */
  cols() {
    return this.grid.renderer.renderColumns().list.filter((c) => !c._move && !c._select && !c._rownum && !c._actions && !c._actionsMenu);
  }
  attach(root, body) {
    this.root = root;
    this.body = body;
    root.tabIndex = 0;
    body.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const coord = this.coordOf(e.target);
      if (!coord) return;
      root.focus();
      if (e.shiftKey && this.anchor) this.setFocus(coord);
      else {
        this.anchor = coord;
        this.setFocus(coord);
      }
      this.dragging = true;
      root.classList.add("is-range-mode");
      e.preventDefault();
    });
    body.addEventListener("mouseover", (e) => {
      if (!this.dragging) return;
      const coord = this.coordOf(e.target);
      if (coord) this.setFocus(coord);
    });
    this._onUp = () => {
      this.dragging = false;
    };
    window.addEventListener("mouseup", this._onUp);
    root.addEventListener("keydown", (e) => this.onKey(e));
  }
  destroy() {
    if (this._onUp) window.removeEventListener("mouseup", this._onUp);
    this.grid.renderer.updateRangeStatus("");
  }
  /** Souřadnice { r, c } z DOM cíle (buňky), nebo null. */
  coordOf(target) {
    const cell = target.closest && target.closest(".lattice-cell[data-field]");
    if (!cell) return null;
    const rowEl = cell.closest(".lattice-row");
    if (!rowEl || rowEl.dataset.index == null) return null;
    const r = Number(rowEl.dataset.index);
    const c = this.cols().findIndex((col) => col.field === cell.dataset.field);
    if (c < 0 || Number.isNaN(r)) return null;
    return { r, c };
  }
  setFocus(coord) {
    this.focus = coord;
    this.apply();
  }
  /** Normalizovaný obdélník rozsahu, nebo null. */
  rect() {
    if (!this.anchor || !this.focus) return null;
    return {
      r1: Math.min(this.anchor.r, this.focus.r),
      r2: Math.max(this.anchor.r, this.focus.r),
      c1: Math.min(this.anchor.c, this.focus.c),
      c2: Math.max(this.anchor.c, this.focus.c)
    };
  }
  /** Nastaví CSS třídy (is-range / is-range-active) na buňky v rozsahu. */
  apply() {
    const body = this.grid.renderer.nodes.body;
    for (const el2 of body.querySelectorAll(".is-range, .is-range-active")) el2.classList.remove("is-range", "is-range-active");
    const rc = this.rect();
    if (!rc) return;
    const cols = this.cols();
    for (const rowEl of body.querySelectorAll(".lattice-row")) {
      const r = Number(rowEl.dataset.index);
      if (Number.isNaN(r) || r < rc.r1 || r > rc.r2) continue;
      for (let c = rc.c1; c <= rc.c2; c++) {
        const cell = this.cellIn(rowEl, cols[c]);
        if (cell) cell.classList.add("is-range");
      }
    }
    const active = this.cellAt(this.focus);
    if (active) active.classList.add("is-range-active");
    this.grid.renderer.updateRangeStatus(this.summaryText());
    this._placeFillHandle(rc);
  }
  /** Souhrn označeného rozsahu (počet buněk + agregace čísel) pro status bar. */
  summaryText() {
    const rc = this.rect();
    if (!rc) return "";
    const cellCount = (rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1);
    if (cellCount <= 1) return "";
    const cols = this.cols();
    const nums = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const row = this.grid.rows[r];
      if (!row) continue;
      for (let c = rc.c1; c <= rc.c2; c++) {
        const n = rangeNum(row[cols[c].field]);
        if (n != null) nums.push(n);
      }
    }
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const loc = this.grid.i18n.locale || void 0;
    const fmt = (x) => new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(x);
    const parts = [t("range.cells").replace("{n}", cellCount)];
    if (nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      parts.push(
        `${t("range.sum")}: ${fmt(sum)}`,
        `${t("range.avg")}: ${fmt(sum / nums.length)}`,
        `${t("range.min")}: ${fmt(Math.min(...nums))}`,
        `${t("range.max")}: ${fmt(Math.max(...nums))}`
      );
    }
    return parts.join("   \xB7   ");
  }
  cellIn(rowEl, col) {
    return col ? rowEl.querySelector('.lattice-cell[data-field="' + col.field + '"]') : null;
  }
  cellAt(coord) {
    if (!coord) return null;
    const rowEl = [...this.grid.renderer.nodes.body.querySelectorAll(".lattice-row")].find((r) => Number(r.dataset.index) === coord.r);
    return rowEl ? this.cellIn(rowEl, this.cols()[coord.c]) : null;
  }
  onKey(e) {
    if (!this.anchor || !this.focus) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === "c" || e.key === "C")) {
      this.copy();
      e.preventDefault();
      return;
    }
    if (meta && (e.key === "v" || e.key === "V")) {
      this.paste();
      e.preventDefault();
      return;
    }
    if (meta && (e.key === "a" || e.key === "A")) {
      this.selectAll();
      e.preventDefault();
      return;
    }
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const maxR = (this.grid.rows.length || 1) - 1;
    const maxC = this.cols().length - 1;
    const nr = Math.max(0, Math.min(maxR, this.focus.r + delta[0]));
    const nc = Math.max(0, Math.min(maxC, this.focus.c + delta[1]));
    if (e.shiftKey) this.setFocus({ r: nr, c: nc });
    else {
      this.anchor = { r: nr, c: nc };
      this.setFocus({ r: nr, c: nc });
    }
    this.cellAt(this.focus)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  selectAll() {
    this.anchor = { r: 0, c: 0 };
    this.setFocus({ r: (this.grid.rows.length || 1) - 1, c: this.cols().length - 1 });
  }
  /** 2D pole hodnot rozsahu (řádky × sloupce). */
  values() {
    const rc = this.rect();
    if (!rc) return [];
    const cols = this.cols();
    const out = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const row = this.grid.rows[r];
      const line = [];
      for (let c = rc.c1; c <= rc.c2; c++) line.push(row ? row[cols[c].field] : "");
      out.push(line);
    }
    return out;
  }
  /** Zkopíruje rozsah do schránky jako TSV (kompatibilní se Sheets/Excel). */
  copy() {
    const data = this.values();
    const tsv = data.map((row) => row.map((v) => v == null ? "" : String(v)).join("	")).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).catch(() => {
    });
    if (this.grid.options.onRangeCopy) this.grid.options.onRangeCopy(data, tsv);
    return tsv;
  }
  /** Vloží TSV ze schránky od aktivní buňky do editovatelných buněk. */
  async paste() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    this.pasteText(text);
  }
  pasteText(text) {
    const grid = this.grid;
    const rc = this.rect();
    if (!rc || !text) return;
    const cols = this.cols();
    const matrix = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("	"));
    const changed = [], hist = [];
    matrix.forEach((cells, ri) => cells.forEach((val, ci) => {
      const r = rc.r1 + ri, c = rc.c1 + ci;
      const row = grid.rows[r], col = cols[c];
      if (!row || !col) return;
      const editable = col.editable === true || grid.options.editable === true;
      if (!editable) return;
      const oldValue = row[col.field];
      const newValue = typeof oldValue === "number" && val !== "" && !Number.isNaN(Number(val)) ? Number(val) : val;
      if (newValue === oldValue) return;
      row[col.field] = newValue;
      changed.push(row);
      hist.push({ type: "edit", row, before: { [col.field]: oldValue }, after: { [col.field]: newValue } });
      if (grid.options.onCellEdit) grid.options.onCellEdit({ field: col.field, row, oldValue, newValue });
    }));
    if (hist.length) grid.history?.record({ type: "batch", entries: hist });
    if (changed.length) {
      grid.renderer.renderBody();
      this.apply();
    }
    if (grid.options.onRangePaste) grid.options.onRangePaste(changed);
    return changed;
  }
  /* ---- fill handle (táhni roh výběru → vyplň/kopíruj s posloupností) ---- */
  fillEnabled() {
    const g = this.grid;
    if (g.options.fillHandle === false) return false;
    return g.options.editable === true || g.columns.some((c) => c.editable === true);
  }
  _placeFillHandle(rc) {
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll(".lattice-fill-handle").forEach((h2) => h2.remove());
    body.querySelectorAll(".has-fill-handle").forEach((c) => c.classList.remove("has-fill-handle"));
    if (!rc || !this.fillEnabled()) return;
    const cols = this.cols();
    const cornerRow = [...body.querySelectorAll(".lattice-row")].find((r) => Number(r.dataset.index) === rc.r2);
    const cell = cornerRow && this.cellIn(cornerRow, cols[rc.c2]);
    if (!cell) return;
    cell.classList.add("has-fill-handle");
    const h = document.createElement("div");
    h.className = "lattice-fill-handle";
    h.title = this.grid.i18n.t("range.fill");
    h.addEventListener("mousedown", (e) => this._startFill(e, rc));
    cell.appendChild(h);
  }
  _startFill(e, src) {
    e.stopPropagation();
    e.preventDefault();
    this._fillSrc = src;
    this._fillTarget = null;
    const onMove = (ev) => {
      const coord = this.coordOf(ev.target);
      if (coord) this._previewFill(coord);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      this._commitFill();
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }
  _previewFill(coord) {
    const s = this._fillSrc;
    if (!s) return;
    let t = null;
    if (coord.r > s.r2) t = { r1: s.r2 + 1, r2: coord.r, c1: s.c1, c2: s.c2, axis: "v" };
    else if (coord.r < s.r1) t = { r1: coord.r, r2: s.r1 - 1, c1: s.c1, c2: s.c2, axis: "v" };
    else if (coord.c > s.c2) t = { r1: s.r1, r2: s.r2, c1: s.c2 + 1, c2: coord.c, axis: "h" };
    else if (coord.c < s.c1) t = { r1: s.r1, r2: s.r2, c1: coord.c, c2: s.c1 - 1, axis: "h" };
    this._fillTarget = t;
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll(".is-fill-preview").forEach((c) => c.classList.remove("is-fill-preview"));
    if (!t) return;
    const cols = this.cols();
    for (const rowEl of body.querySelectorAll(".lattice-row")) {
      const r = Number(rowEl.dataset.index);
      if (Number.isNaN(r) || r < t.r1 || r > t.r2) continue;
      for (let c = t.c1; c <= t.c2; c++) {
        const cell = this.cellIn(rowEl, cols[c]);
        if (cell) cell.classList.add("is-fill-preview");
      }
    }
  }
  _commitFill() {
    const s = this._fillSrc, t = this._fillTarget;
    const body = this.grid.renderer.nodes.body;
    body.querySelectorAll(".is-fill-preview").forEach((c) => c.classList.remove("is-fill-preview"));
    this._fillSrc = null;
    this._fillTarget = null;
    if (!t) {
      this.apply();
      return;
    }
    const grid = this.grid, cols = this.cols();
    const editableCol = (col) => col && (col.editable === true || grid.options.editable === true);
    const changed = [], hist = [];
    if (t.axis === "v") {
      for (let c = s.c1; c <= s.c2; c++) {
        const col = cols[c];
        if (!editableCol(col)) continue;
        const sVals = [];
        for (let r = s.r1; r <= s.r2; r++) sVals.push(grid.rows[r] ? grid.rows[r][col.field] : "");
        for (let r = t.r1; r <= t.r2; r++) {
          const row = grid.rows[r];
          if (row) this._writeFill(row, col, fillSequence(sVals, r - s.r1), changed, hist);
        }
      }
    } else {
      for (let r = s.r1; r <= s.r2; r++) {
        const row = grid.rows[r];
        if (!row) continue;
        const sVals = [];
        for (let c = s.c1; c <= s.c2; c++) sVals.push(row[cols[c].field]);
        for (let c = t.c1; c <= t.c2; c++) {
          const col = cols[c];
          if (editableCol(col)) this._writeFill(row, col, fillSequence(sVals, c - s.c1), changed, hist);
        }
      }
    }
    if (hist.length) grid.history?.record({ type: "batch", entries: hist });
    if (changed.length) {
      grid.renderer.renderBody();
      this.anchor = { r: Math.min(s.r1, t.r1), c: Math.min(s.c1, t.c1) };
      this.setFocus({ r: Math.max(s.r2, t.r2), c: Math.max(s.c2, t.c2) });
    } else this.apply();
    if (grid.options.onFill) grid.options.onFill(changed);
  }
  _writeFill(row, col, newValue, changed, hist) {
    const oldValue = row[col.field];
    let nv = newValue;
    if (typeof oldValue === "number" && nv != null && nv !== "" && !Number.isNaN(Number(nv))) nv = Number(nv);
    if (nv === oldValue) return;
    row[col.field] = nv;
    changed.push(row);
    hist.push({ type: "edit", row, before: { [col.field]: oldValue }, after: { [col.field]: nv } });
    if (this.grid.options.onCellEdit) this.grid.options.onCellEdit({ field: col.field, row, oldValue, newValue: nv });
  }
};
function rangeNum(v) {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fillSequence(sVals, offset) {
  const n = sVals.length;
  if (!n) return "";
  const nums = sVals.map(rangeNum);
  if (nums.every((x) => x != null)) {
    const step = n >= 2 ? avgStep(nums) : 0;
    const v = nums[0] + step * offset;
    return Number.isInteger(step) && Number.isInteger(nums[0]) ? Math.round(v) : v;
  }
  const dates = sVals.map(fillDate);
  if (dates.every((d) => d != null)) {
    const ms = dates.map((d) => d.getTime());
    const step = n >= 2 ? avgStep(ms) : 0;
    return isoDate2(new Date(ms[0] + step * offset));
  }
  return sVals[(offset % n + n) % n];
}
function avgStep(arr) {
  let s = 0;
  for (let i = 1; i < arr.length; i++) s += arr[i] - arr[i - 1];
  return s / (arr.length - 1);
}
function fillDate(v) {
  if (v == null || v === "" || typeof v === "boolean" || typeof v === "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoDate2(d) {
  const p = (x) => String(x).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

// src/features/history.js
var History = class {
  constructor(grid, size) {
    this.grid = grid;
    this.max = Math.max(1, size || 50);
    this.undoStack = [];
    this.redoStack = [];
  }
  /** Zaznamená krok (ignoruje se během přehrávání undo/redo). */
  record(entry) {
    if (this.grid._replayingHistory || !entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack.length = 0;
    this.grid.renderer.renderToolbar();
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  undoSize() {
    return this.undoStack.length;
  }
  redoSize() {
    return this.redoStack.length;
  }
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.grid.renderer.renderToolbar();
  }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this._apply(e, "undo");
    this.redoStack.push(e);
    this.grid.renderer.renderToolbar();
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this._apply(e, "redo");
    this.undoStack.push(e);
    this.grid.renderer.renderToolbar();
  }
  _apply(e, dir) {
    const grid = this.grid;
    grid._replayingHistory = true;
    try {
      if (e.type === "batch") {
        const list = dir === "undo" ? [...e.entries].reverse() : e.entries;
        for (const sub of list) this._atom(sub, dir);
      } else {
        this._atom(e, dir);
      }
      grid.refresh();
    } finally {
      grid._replayingHistory = false;
    }
  }
  /** Provede jednu atomickou změnu (bez refreshe). */
  _atom(e, dir) {
    const grid = this.grid;
    const src = grid.dataSource;
    if (e.type === "edit") {
      Object.assign(e.row, dir === "undo" ? e.before : e.after);
    } else if (e.type === "add") {
      if (dir === "undo") src.deleteRow(grid.keyField, grid.rowKey(e.row));
      else src.addRow(e.row, e.atStart);
    } else if (e.type === "delete") {
      if (dir === "undo") src.addRow(e.row);
      else src.deleteRow(grid.keyField, grid.rowKey(e.row));
    }
  }
};

// src/Lattice.js
var INSTANCE_DEFAULTS = {
  paginationPosition: "footer",
  // 'footer' | 'header' | 'both' | 'none'
  layout: "fitData",
  // 'fit' = roztáhnout do šířky | 'fitData' = dle obsahu
  density: "comfortable",
  fontSize: 14,
  pageSize: 50,
  filterLayout: "header",
  // 'header' = filtry v záhlaví | 'external' = panel nad tabulkou
  externalFiltersCollapsed: false,
  // sbalení externího filtračního panelu (šetří místo na malých monitorech)
  rowNumbers: "none",
  // 'none' | 'continuous' (průběžné) | 'perPage' (od 1 na každé stránce)
  headerRotate: "none",
  // otočení hlaviček (hromadně): 'none' | '90' | '270'
  summaryRow: "none",
  // souhrnný řádek: 'none' | 'page' (zobrazená stránka) | 'all' (všechny záznamy)
  groupSubtotals: false,
  // mezisoučty za každou skupinu řádků (dle col.summary)
  rowNumberWidth: null,
  // uživatelská šířka číslovacího sloupce (null = auto)
  groupBy: null,
  // seskupení řádků podle pole (field) nebo null (row grouping)
  selectColumn: true,
  // zobrazit sloupec s checkboxy (jen když je selectable)
  selectRowClick: false,
  // klik na řádek = výběr (false = vybírá jen checkbox)
  actionsLayout: "column",
  // sloupec akcí: 'column' (poslední sloupec) | 'menu' (⋮ v číslování řádků)
  resizeGuide: false,
  // změna šířky sloupce: false = živě | true = s vodicí čárou (aplikuje se v mouseup)
  theme: "default",
  // vzhled: 'default' | 'auto' (dle systému) | 'minimal' | 'compact' | 'slate' (tmavý) | 'ocean' | 'warm' | 'contrast' | 'bootstrap5' | 'tailwind' | 'material'
  fontFamily: "",
  // '' = dle motivu | jinak CSS font-family override
  zebra: true,
  // pruhované řádky
  wrapText: false,
  // zalamovat text v buňkách (jinak … ořez)
  emptyText: "",
  // placeholder pro prázdné buňky (např. '—')
  linkNewTab: false,
  // odkazy (typ 'link') otevírat v nové kartě (+ ikona); per-sloupec přebije formatterParams.target
  locale: "",
  // BCP-47 locale pro formát čísel/měny ('' = dle prohlížeče)
  scaleColors: null,
  // kotevní barvy podmíněné škály [low, mid, high]; null = výchozí (červená/žlutá/zelená)
  cssVars: {},
  // vlastní CSS proměnné (přepíšou motiv): { '--lattice-accent': '#e91e63', … }
  format: {}
  // globální formát zobrazení po druzích: { number, money, date, datetime, time }
};
var Lattice = class {
  constructor(mount, options = {}) {
    this.el = typeof mount === "string" ? document.querySelector(mount) : mount;
    if (!this.el) throw new Error(`Lattice: mount element nenalezen (${mount}).`);
    if (!options.id) throw new Error("Lattice: chyb\xED `id` (kl\xED\u010D pro persistenci).");
    this.options = options;
    this.i18n = new I18n(options.i18n);
    this.store = new Store(options.id, { storage: options.storage });
    this._freshUser = !this.store.has();
    this.state = this.store.load();
    this._applyGlobalDefaults();
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, options.instance, this.state.instance);
    if (options.pageSize != null && this.state.instance.pageSize == null) {
      this.instance.pageSize = options.pageSize;
    }
    if (this.state.instance.paginationPosition == null && typeof this.state.instance.pagination === "boolean") {
      this.instance.paginationPosition = this.state.instance.pagination ? "footer" : "none";
    }
    this.pageSize = this.instance.pageSize;
    this.autoColumns = options.autoColumns === true || !(options.columns && options.columns.length);
    let defs = options.columns || [];
    if (this.autoColumns && !defs.length && Array.isArray(options.data) && options.data.length) {
      defs = deriveColumns(options.data);
    }
    this.columnDefs = defs;
    this.columns = buildColumns(defs, this.state.columns);
    this.sort = Array.isArray(this.state.sort) ? this.state.sort.slice() : [];
    this.filters = Object.assign({}, this.state.filters);
    this.quickSearch = "";
    this.advanced = this.state.advanced || null;
    this.universal = this.state.universal || null;
    this.urlState = options.urlState ? { key: typeof options.urlState === "object" && options.urlState.key || options.id } : null;
    this.groupsCollapsed = new Set(this.state.groups || []);
    this.tree = options.treeData ? new TreeManager(this, options) : null;
    this.treeView = null;
    this.range = options.rangeSelection ? new RangeManager(this) : null;
    this.history = options.history && !options.serverSide ? new History(this, options.historySize) : null;
    const idCol = flattenGroups(defs).find((c) => c && c.type === "id");
    this.keyField = options.keyField || idCol && idCol.field || "id";
    this.progressive = options.serverSide && (options.progressiveLoad === "scroll" || options.progressiveLoad === "load") ? options.progressiveLoad : null;
    this.virtual = options.virtualScroll === true && !options.serverSide && !options.treeData;
    this.detailFn = typeof options.rowDetail === "function" && !options.treeData && !this.virtual ? options.rowDetail : null;
    this.expandedDetails = /* @__PURE__ */ new Set();
    this.pinnedTop = Array.isArray(options.pinnedTop) ? options.pinnedTop.slice() : [];
    this.pinnedBottom = Array.isArray(options.pinnedBottom) ? options.pinnedBottom.slice() : [];
    this.responsive = options.responsive === true && !options.treeData && !this.virtual;
    this.loadedRows = [];
    this.loadedPage = 0;
    this.movable = options.movableRows === true;
    this.orderField = options.orderField || null;
    this.acceptExternalRows = options.acceptExternalRows || false;
    INSTANCES.set(options.id, this);
    this.selectable = normSelectable(options.selectable);
    this.selected = /* @__PURE__ */ new Set();
    this.selectScope = "page";
    this.serverSide = !!options.serverSide;
    this.dataSource = this.serverSide ? new ServerData(resolveAjax(options)) : new ClientData(options.data || []);
    this.page = 1;
    this.rows = [];
    this.total = 0;
    this.lastPage = 1;
    this._readUrl();
    this._activePresetId = null;
    this.presets = new PresetStore(this);
    this.gear = new Gear(this);
    this.instanceSettings = new InstanceSettings(this);
    this.advancedFilter = new AdvancedFilter(this);
    this.pagination = new Pagination(this);
    this.renderer = new Renderer(this);
    this.renderer.mount();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.editManager = new EditManager(this);
    this.editManager.attach();
    this.refresh();
    this._scheduleSearchIndex();
    if (this.presets.hasAdapter()) {
      this.presets.loadGlobals().then(() => this.gear?.refresh());
    }
    if (this._gdJustApplied) {
      this.saveState();
      this._gdJustApplied = false;
    }
  }
  /* =================== URL sync (sdílitelné pohledy) =================== */
  /** Kompaktní payload stavu pro URL (jen neprázdné části). */
  _urlPayload() {
    const p = {};
    if (this.sort && this.sort.length) p.s = this.sort.map((x) => [x.field, x.dir === "desc" ? "d" : "a"]);
    if (this.filters && Object.keys(this.filters).length) p.f = this.filters;
    if (this.quickSearch) p.q = this.quickSearch;
    if (this.page > 1) p.p = this.page;
    if (this.universal && this.universal.field) p.u = this.universal;
    if (this.advanced) p.a = this.advanced;
    return p;
  }
  /** Zapíše stav do URL query stringu (replaceState — nezaplní historii). */
  _writeUrl() {
    if (!this.urlState || typeof window === "undefined" || !window.history) return;
    try {
      const url = new URL(window.location.href);
      const payload = this._urlPayload();
      if (Object.keys(payload).length) url.searchParams.set(this.urlState.key, JSON.stringify(payload));
      else url.searchParams.delete(this.urlState.key);
      window.history.replaceState(null, "", url);
    } catch {
    }
  }
  /** Načte stav z URL query stringu (při initu) — přepíše řazení/filtry/hledání/stránku. */
  _readUrl() {
    if (!this.urlState || typeof window === "undefined") return;
    let raw;
    try {
      raw = new URL(window.location.href).searchParams.get(this.urlState.key);
    } catch {
      return;
    }
    if (!raw) return;
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    if (Array.isArray(p.s)) this.sort = p.s.map(([field2, d]) => ({ field: field2, dir: d === "d" ? "desc" : "asc" }));
    if (p.f && typeof p.f === "object") this.filters = { ...p.f };
    if (typeof p.q === "string") this.quickSearch = p.q;
    if (p.p) this.page = Number(p.p) || 1;
    if (p.u) this.universal = p.u;
    if (p.a) this.advanced = p.a;
  }
  /* =================== persistence =================== */
  /** Sestaví blob z živého stavu a uloží (jeden zdroj pravdy). */
  saveState() {
    this.state.columns = serializeColumns(this.columns);
    this.state.sort = this.sort;
    this.state.filters = this.filters;
    this.state.advanced = this.advanced;
    this.state.universal = this.universal;
    this.state.instance = { ...this.instance };
    this.state.groups = [...this.groupsCollapsed];
    if (this.tree) this.state.tree = [...this.tree.expanded];
    this.store.save(this.state);
  }
  /* =================== globální výchozí nastavení (admin → všem) =================== */
  /**
   * Při startu: globální defaulty se automaticky použijí JEN pro úplně nového
   * uživatele (seed do jeho stavu). Existující uživatel se nepřepisuje — nová
   * verze se mu jen nabídne v nastavení (globalDefaultsAvailable → tlačítko).
   */
  _applyGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || gd.version == null || !gd.state) return;
    if (this.state._gdVersion === gd.version) return;
    if (!this._freshUser) return;
    this._writeGdIntoState(gd);
    this._gdJustApplied = true;
  }
  /** Zapíše snapshot globálních defaultů do persistovaného stavu (před sestavením). */
  _writeGdIntoState(gd) {
    const s = gd.state;
    if (s.instance) this.state.instance = { ...s.instance };
    if (Array.isArray(s.columns)) this.state.columns = s.columns;
    if ("sort" in s) this.state.sort = s.sort;
    if ("filters" in s) this.state.filters = s.filters;
    this.state._gdVersion = gd.version;
  }
  /** Existuje vůbec nějaké globální výchozí nastavení od správce? */
  hasGlobalDefaults() {
    const gd = this.options.globalDefaults;
    return !!(gd && gd.state);
  }
  /** Je k dispozici NOVÁ verze globálního nastavení, kterou uživatel ještě neviděl? */
  globalDefaultsAvailable() {
    const gd = this.options.globalDefaults;
    return !!(gd && gd.version != null && gd.state && this.state._gdVersion !== gd.version);
  }
  /** Použije globální výchozí nastavení TEĎ (na pokyn uživatele) a uloží lokálně. */
  applyGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || !gd.state) return;
    const s = gd.state;
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance, s.instance);
    this.pageSize = this.instance.pageSize;
    if (Array.isArray(s.columns)) this.columns = buildColumns(this.columnDefs || [], s.columns);
    this.sort = Array.isArray(s.sort) ? s.sort.slice() : [];
    this.filters = Object.assign({}, s.filters);
    this.state._gdVersion = gd.version;
    this._activePresetId = null;
    this.saveState();
    this.renderer.applyInstanceStyles();
    this.renderer.renderToolbar();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this.refresh();
  }
  /** „Ponechat moje nastavení" — jen potvrdí verzi, ať se nabídka znovu neukazuje. */
  dismissGlobalDefaults() {
    const gd = this.options.globalDefaults;
    if (!gd || gd.version == null) return;
    this.state._gdVersion = gd.version;
    this.saveState();
    this.renderer.renderToolbar();
  }
  /** Lze uložit globální výchozí nastavení? (aplikace dodala callback) */
  canSaveGlobalDefaults() {
    return typeof this.options.onSaveGlobalDefaults === "function";
  }
  /**
   * Uloží aktuální nastavení tabulky jako globální výchozí pro všechny. Knihovna
   * jen sestaví snapshot (instance + sloupce + řazení + filtry) s novou verzí a
   * předá aplikaci přes callback onSaveGlobalDefaults({version, state}); ta ho
   * uloží a bude servírovat ostatním uživatelům (přepíše jim i localStorage).
   */
  setGlobalDefaults() {
    const cb = this.options.onSaveGlobalDefaults;
    if (typeof cb !== "function") return null;
    const version = Date.now();
    const payload = {
      version,
      state: {
        instance: { ...this.instance },
        columns: serializeColumns(this.columns),
        sort: JSON.parse(JSON.stringify(this.sort)),
        filters: JSON.parse(JSON.stringify(this.filters))
      }
    };
    cb(payload);
    this.state._gdVersion = version;
    this.saveState();
    return payload;
  }
  /* =================== data =================== */
  /** Znovu načte data dle aktuálního stavu a vykreslí tělo + patičku. */
  async refresh() {
    this._writeUrl();
    if (this.tree) return this.renderTree();
    if (this.progressive) {
      this.page = 1;
      this.loadedRows = [];
      this.loadedPage = 0;
    }
    const reqId = this._reqId = (this._reqId || 0) + 1;
    this.renderer.setLoading(true);
    try {
      const res = await this.dataSource.query({
        page: this.page,
        pageSize: this.pageSize,
        paginate: this.virtual ? false : this.progressive ? true : this.paginationEnabled(),
        sort: this.sort,
        filters: this.filters,
        advanced: this.advanced,
        universal: this.universalActive() ? this.universal : null,
        search: this.quickSearch || "",
        columns: this.columns
      });
      if (reqId !== this._reqId) return;
      this.total = res.total ?? (res.rows || []).length;
      this.lastPage = res.lastPage || 1;
      if (this.progressive) {
        this.loadedRows = (res.rows || []).slice();
        this.loadedPage = 1;
        this.rows = this.loadedRows;
      } else {
        this.rows = res.rows || [];
        if (this.paginationEnabled() && this.page > this.lastPage && this.lastPage >= 1 && this.page > 1) {
          this.page = this.lastPage;
          return this.refresh();
        }
      }
      this.renderer.setLoading(false);
      this.renderer.renderBody();
      this.renderer.renderFooter();
      if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.page, sort: this.sort });
    } catch (err) {
      if (reqId !== this._reqId) return;
      this.renderer.setLoading(false);
      this.renderer.setError();
      if (this.options.onError) this.options.onError(err);
      else console.error("[Lattice] chyba na\u010Dten\xED dat:", err);
    }
  }
  /** Tree režim: sestaví ploché pořadí viditelných uzlů a vykreslí (bez stránkování). */
  renderTree() {
    const anyFilter = Object.keys(this.filters).length > 0 || !!(this.quickSearch && this.quickSearch.trim()) || this.universalActive() || this.advancedActive();
    let view;
    if (anyFilter) {
      const predicate = (row) => rowMatches(row, {
        filters: this.filters,
        search: this.quickSearch || "",
        columns: this.columns,
        universal: this.universalActive() ? this.universal : null,
        advanced: this.advancedActive() ? this.advanced : null
      });
      view = this.tree.filteredRows(predicate);
    } else {
      view = this.tree.visibleRows();
    }
    this.treeView = view;
    this.rows = view.map((v) => v.row);
    this.total = this.rows.length;
    this.lastPage = 1;
    this.renderer.setLoading(false);
    this.renderer.renderBody();
    this.renderer.renderFooter();
    if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.page, sort: this.sort, tree: true });
  }
  /** Je stránkování (klasický paginátor) zapnuté? V tree i progresivním režimu ne. */
  paginationEnabled() {
    return !this.tree && !this.progressive && this.instance.paginationPosition !== "none";
  }
  /** Jsou v progresivním režimu načtené všechny stránky? */
  progressiveDone() {
    return this.loadedPage >= this.lastPage;
  }
  /**
   * Progresivní režim: dotáhne DALŠÍ stránku a PŘIPOJÍ řádky (nemění sort/filtr).
   * Používá se u nekonečného scrollu i tlačítka „Načíst další".
   */
  async loadMore() {
    if (!this.progressive || this._loadingMore || this.progressiveDone()) return;
    this._loadingMore = true;
    this.renderer.setProgressiveLoading(true);
    const next = this.loadedPage + 1;
    try {
      const res = await this.dataSource.query({
        page: next,
        pageSize: this.pageSize,
        paginate: true,
        sort: this.sort,
        filters: this.filters,
        advanced: this.advanced,
        universal: this.universalActive() ? this.universal : null,
        columns: this.columns
      });
      this.loadedRows.push(...res.rows || []);
      this.loadedPage = next;
      this.total = res.total ?? this.total;
      this.lastPage = res.lastPage || this.lastPage;
      this.rows = this.loadedRows;
      this.renderer.renderBody();
      this.renderer.renderFooter();
      if (this.options.onDataLoad) this.options.onDataLoad({ rows: this.rows, total: this.total, page: this.loadedPage, sort: this.sort });
    } catch (err) {
      if (this.options.onError) this.options.onError(err);
      else console.error("[Lattice] progresivn\xED na\u010Dten\xED selhalo:", err);
    } finally {
      this._loadingMore = false;
      this.renderer.setProgressiveLoading(false);
    }
  }
  /** Nastaví client-side data za běhu (nebo tree data v tree režimu). */
  setData(data) {
    if (this.selected.size) this.selected.clear();
    if (this.tree) {
      this.tree.setData(data);
      this.refresh();
    } else if (this.dataSource instanceof ClientData) {
      this.dataSource.setData(data);
      this.page = 1;
      this.refresh();
      this._scheduleSearchIndex();
    }
  }
  /**
   * Předpočítá vyhledávací index na pozadí (idle), aby i první hledání bylo
   * rychlé. Jen client-side a jen když je quickSearch zapnutý — jinak zbytečná
   * práce. Bezpečné volat opakovaně (poslední naplánování vyhraje).
   */
  _scheduleSearchIndex() {
    if (!this.options.quickSearch || this.serverSide) return;
    if (!this.dataSource || typeof this.dataSource.buildSearchIndex !== "function") return;
    if (this._searchIdle != null) return;
    const build = () => {
      this._searchIdle = null;
      try {
        this.dataSource.buildSearchIndex(this.columns);
      } catch {
      }
    };
    if (typeof requestIdleCallback === "function") this._searchIdle = requestIdleCallback(build, { timeout: 800 });
    else this._searchIdle = setTimeout(build, 0);
  }
  /* =================== řazení =================== */
  /** Cyklí řazení sloupce (asc → desc → zrušit). `append` (Shift) = víceúrovňové. */
  toggleSort(field2, append2) {
    this._clearActivePreset();
    const cur = this.sort.find((s) => s.field === field2);
    let dir;
    if (!cur) dir = "asc";
    else if (cur.dir === "asc") dir = "desc";
    else dir = null;
    if (append2) {
      const next = this.sort.map((s) => ({ ...s }));
      const i = next.findIndex((s) => s.field === field2);
      if (dir == null) {
        if (i >= 0) next.splice(i, 1);
      } else if (i >= 0) next[i].dir = dir;
      else next.push({ field: field2, dir });
      this._setSort(next);
    } else {
      this._setSort(dir ? [{ field: field2, dir }] : []);
    }
  }
  /** Interní: nastaví pole řazení a překreslí. */
  _setSort(arr) {
    this.sort = arr;
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.refresh();
    this._emitSort();
  }
  /** Explicitně seřadí sloupec ('asc'|'desc'|null = zrušit). */
  sortColumn(field2, dir) {
    this._clearActivePreset();
    this._setSort(dir ? [{ field: field2, dir }] : []);
  }
  /** Přizpůsobí šířku jednoho sloupce obsahu. */
  autoFitColumn(field2) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    const w = measureColumnWidth(col, this);
    if (w) {
      col.width = w;
      this.saveState();
      this.renderer.applyLayout();
    }
  }
  /* =================== filtry =================== */
  setFilter(field2, value) {
    this._clearActivePreset();
    if (value == null || value === "" || Array.isArray(value) && value.length === 0) {
      delete this.filters[field2];
    } else {
      this.filters[field2] = value;
    }
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitFilter();
  }
  /** Rychlé hledání přes všechny viditelné sloupce (transientní). */
  setQuickSearch(term) {
    this.quickSearch = term || "";
    this.page = 1;
    this.refresh();
    this._emitFilter();
  }
  clearFilters() {
    this.clearAllFilters();
  }
  /** Je aplikovaný nějaký filtr (sloupcový / univerzální / rozšířený)? Ne quickSearch. */
  hasActiveFilters() {
    return Object.keys(this.filters).length > 0 || this.universalActive() || this.advancedActive();
  }
  /**
   * Zruší všechny APLIKOVANÉ filtry — sloupcové, univerzální i aktivní rozšířený
   * (a rychlé hledání). ULOŽENÉ rozšířené filtry zůstávají (jen se deaktivují).
   */
  clearAllFilters() {
    this.filters = {};
    this.quickSearch = "";
    this.universal = null;
    this.advanced = null;
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
  }
  /* =================== univerzální filtr =================== */
  /** Je univerzální filtr aktivní (má pole i hodnotu)? */
  universalActive() {
    const u = this.universal;
    return !!(u && u.field && u.op && u.value != null && String(u.value) !== "");
  }
  /** Nastaví univerzální filtr { field, op, value } (nebo null = zrušit). */
  setUniversal(u) {
    this.universal = u && u.field ? { field: u.field, op: u.op || "contains", value: u.value ?? "" } : null;
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitFilter();
  }
  clearUniversal() {
    this.setUniversal(null);
  }
  /* =================== seskupení řádků (row grouping) =================== */
  /**
   * Pořadí polí, podle kterých seskupujeme (víceúrovňově). Normalizuje
   * instance.groupBy (string kvůli zpětné kompatibilitě nebo pole) a vyfiltruje
   * jen platná, neopakující se pole odpovídající existujícímu sloupci.
   */
  groupFields() {
    const g = this.instance.groupBy;
    const arr = Array.isArray(g) ? g : g ? [g] : [];
    return arr.filter((f, i) => arr.indexOf(f) === i && this.columns.some((c) => c.field === f));
  }
  /** Je seskupení řádků aktivní (aspoň jedno platné pole)? */
  groupActive() {
    return this.groupFields().length > 0;
  }
  /** Je sloupec použit jako řádkové seskupení? */
  isRowGrouped(field2) {
    return this.groupFields().includes(field2);
  }
  /** Úroveň (1-based) seskupení pro sloupec, nebo 0 když se podle něj neseskupuje. */
  rowGroupLevel(field2) {
    return this.groupFields().indexOf(field2) + 1;
  }
  /** Přepne, zda se podle sloupce seskupuje (přidá na konec pořadí / odebere). */
  toggleRowGroup(field2) {
    const arr = this.groupFields();
    const i = arr.indexOf(field2);
    if (i === -1) arr.push(field2);
    else arr.splice(i, 1);
    this.setInstance({ groupBy: arr.length ? arr : null });
  }
  /**
   * Rozdělí řádky do (případně vnořeného) stromu skupin dle groupFields().
   * Všechny řádky stejné hodnoty se sesbírají dohromady (v pořadí prvního
   * výskytu), takže skupina je souvislá i bez řazení. Vrací pole uzlů:
   *   { field, value, key, level, count, rows?:[{row,index}], groups?:[...] }.
   * `key` je celá cesta (unikátní pro stav sbalení), `index` původní index
   * v grid.rows (editace / rowClick / číslování).
   */
  buildGroups(rows) {
    const fields = this.groupFields();
    const indexed = rows.map((row, index) => ({ row, index }));
    return this._groupLevel(indexed, fields, 0, "", []);
  }
  _groupLevel(items, fields, level, parentKey, parentPath) {
    const field2 = fields[level];
    const last = level === fields.length - 1;
    const map = /* @__PURE__ */ new Map();
    for (const it of items) {
      const value = it.row[field2];
      const vkey = value == null || value === "" ? "\0empty" : String(value);
      let g = map.get(vkey);
      if (!g) {
        g = { value, vkey, items: [] };
        map.set(vkey, g);
      }
      g.items.push(it);
    }
    return [...map.values()].map((g) => {
      const key = parentKey ? parentKey + "\0" + g.vkey : g.vkey;
      const path = [...parentPath, { field: field2, value: g.value }];
      const base = { field: field2, value: g.value, key, level, count: g.items.length, path };
      return last ? { ...base, rows: g.items } : { ...base, groups: this._groupLevel(g.items, fields, level + 1, key, path) };
    });
  }
  isGroupCollapsed(key) {
    return this.groupsCollapsed.has(key);
  }
  /** Přepne sbalení / rozbalení skupiny (persistováno) a překreslí tělo. */
  toggleGroup(key) {
    if (this.groupsCollapsed.has(key)) this.groupsCollapsed.delete(key);
    else this.groupsCollapsed.add(key);
    this.saveState();
    this.renderer.renderBody();
  }
  /** Nastaví připnuté řádky (nahoře/dole) a překreslí. `{ top?, bottom? }`. */
  setPinnedRows(patch = {}) {
    if ("top" in patch) this.pinnedTop = Array.isArray(patch.top) ? patch.top.slice() : [];
    if ("bottom" in patch) this.pinnedBottom = Array.isArray(patch.bottom) ? patch.bottom.slice() : [];
    this.renderer.renderPinned();
  }
  /* =================== rozbalovací detail řádku (master-detail) =================== */
  /** Je pod řádkem (dle klíče) rozbalený detail? */
  isDetailExpanded(key) {
    return this.expandedDetails.has(String(key));
  }
  /** Přepne rozbalení detailu řádku (transientní — nepersistuje se) a překreslí tělo. */
  toggleDetail(key) {
    const k = String(key);
    if (this.expandedDetails.has(k)) this.expandedDetails.delete(k);
    else this.expandedDetails.add(k);
    this.renderer.renderBody();
  }
  /* =================== rozšířený filtr =================== */
  /** Aplikuje rozšířený filtr (strom pravidel) nebo ho zruší (null). */
  applyAdvanced(tree) {
    this._clearActivePreset();
    this.advanced = tree && tree.rules && tree.rules.length ? tree : null;
    this.page = 1;
    this.saveState();
    this.refresh();
    this.renderer.renderToolbar();
  }
  clearAdvanced() {
    this.applyAdvanced(null);
  }
  /** Je rozšířený filtr aktivní? */
  advancedActive() {
    return !!(this.advanced && this.advanced.rules && this.advanced.rules.length);
  }
  /** Uloží pojmenovaný rozšířený filtr (stejný název přepíše). */
  saveAdvanced(name, tree) {
    name = String(name || "").trim();
    if (!name) return null;
    const item = { id: uid2(), name, tree: JSON.parse(JSON.stringify(tree)) };
    const list = (this.state.advancedFilters || []).filter((f) => f.name !== name);
    list.push(item);
    this.state.advancedFilters = list;
    this.store.save(this.state);
    this.renderer.renderToolbar();
    return item;
  }
  deleteAdvanced(id) {
    this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.id !== id);
    this.store.save(this.state);
    this.renderer.renderToolbar();
  }
  listAdvanced() {
    return this.state.advancedFilters || [];
  }
  /** Id uloženého filtru odpovídajícího aktivnímu (nebo ''). */
  activeSavedId() {
    if (!this.advanced) return "";
    const s = JSON.stringify(this.advanced);
    const f = this.listAdvanced().find((x) => JSON.stringify(x.tree) === s);
    return f ? f.id : "";
  }
  /* =================== stránkování =================== */
  setPage(page) {
    const p = Math.min(Math.max(1, page), this.lastPage || 1);
    if (p === this.page) return;
    this.page = p;
    this.refresh();
    this._emitPageChange();
  }
  setPageSize(size) {
    this.pageSize = size;
    this.instance.pageSize = size;
    this.page = 1;
    this.saveState();
    this.refresh();
    this._emitPageChange();
  }
  /* =================== sloupce =================== */
  /**
   * Přesune sloupec `field` před/za `targetField`. Při seskupení platí omezení:
   * sloupec ve skupině se smí přesouvat JEN v rámci téže skupiny; neseskupený
   * sloupec se přesouvá na úrovni top-level položek (před/za celou skupinu nebo
   * jiný neseskupený sloupec) — skupiny se tak nikdy nerozpadnou.
   */
  moveColumn(field2, targetField, position = "before") {
    this._clearActivePreset();
    const moved = this.columns.find((c) => c.field === field2);
    const toCol = this.columns.find((c) => c.field === targetField);
    if (!moved || !toCol || field2 === targetField) return;
    const gMoved = moved.group || null;
    const gTarget = toCol.group || null;
    if (gMoved) {
      if (gTarget !== gMoved) return;
      this._spliceMove(field2, targetField, position);
    } else {
      this._moveTopLevel([field2], targetField, position);
    }
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("move", { field: field2, targetField, position });
  }
  /** Přesune celou skupinu `groupTitle` před/za top-level položku s `targetField`. */
  moveGroup(groupTitle, targetField, position = "before") {
    this._clearActivePreset();
    const fields = this.columns.filter((c) => c.group === groupTitle).map((c) => c.field);
    const target = this.columns.find((c) => c.field === targetField);
    if (!fields.length || !target || target.group === groupTitle) return;
    this._moveTopLevel(fields, targetField, position);
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("moveGroup", { group: groupTitle, targetField, position });
  }
  /** Přesune sloupec v ploché řadě (v rámci skupiny). */
  _spliceMove(field2, targetField, position) {
    const cols = this.columns;
    const from = cols.findIndex((c) => c.field === field2);
    const [m] = cols.splice(from, 1);
    let to = cols.findIndex((c) => c.field === targetField);
    if (to === -1) {
      cols.splice(from, 0, m);
      return;
    }
    if (position === "after") to += 1;
    cols.splice(to, 0, m);
  }
  /** Přesune blok sloupců (skupinu / neseskupený sloupec) před/za top-level položku cíle. */
  _moveTopLevel(fields, targetField, position) {
    const set = new Set(fields);
    const block = this.columns.filter((c) => set.has(c.field));
    const rest = this.columns.filter((c) => !set.has(c.field));
    const target = rest.find((c) => c.field === targetField);
    if (!target) return;
    const gTarget = target.group || null;
    let idx;
    if (gTarget) {
      const first = rest.findIndex((c) => c.group === gTarget);
      let last = first;
      while (last + 1 < rest.length && rest[last + 1].group === gTarget) last++;
      idx = position === "after" ? last + 1 : first;
    } else {
      const tIdx = rest.findIndex((c) => c.field === targetField);
      idx = position === "after" ? tIdx + 1 : tIdx;
    }
    rest.splice(idx, 0, ...block);
    this.columns = rest;
  }
  setColumnVisible(field2, visible) {
    this._clearActivePreset();
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.visible = !!visible;
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("visibility", { field: field2, visible: col.visible });
  }
  setColumnWidth(field2, width) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.width = Math.max(col.minWidth, width);
    this.saveState();
    this.renderer.applyLayout();
    this._emitColumnLayout("resize", { field: field2, width: col.width });
  }
  /** frozen: true|'left' = vlevo, 'right' = vpravo, false = neukotveno. */
  setColumnFrozen(field2, frozen) {
    this._clearActivePreset();
    const col = this.columns.find((c) => c.field === field2);
    if (!col || col.frozenAllowed === false) return;
    col.frozen = frozen === "left" ? true : frozen;
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("frozen", { field: field2, frozen: col.frozen });
  }
  /**
   * Přepne typ filtru sloupce (např. number ↔ number-range). Hodnota filtru se
   * vyčistí (tvary se mezi typy liší) a přepočítají se data.
   */
  setColumnFilterType(field2, filterType) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col || !col.availableFilters.includes(filterType)) return;
    if (col.filter === filterType) return;
    this._clearActivePreset();
    col.filter = filterType;
    const had = field2 in this.filters;
    delete this.filters[field2];
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.refresh();
    if (had) this._emitFilter();
  }
  /** Nastaví souhrnné funkce sloupce (pole, např. ['sum','avg']). */
  setColumnSummary(field2, summary) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.summary = Array.isArray(summary) ? summary : [];
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /* =================== formát zobrazení (číslo/měna/datum) =================== */
  /**
   * Efektivní formát sloupce: výchozí < globální (instance) < def.formatterParams
   * < výjimka sloupce (col.format). Vrací null pro typy bez formátování.
   */
  effectiveFormat(col) {
    const kind = formatKind(col.type);
    if (!kind) return null;
    const keys = formatKeys(kind);
    const pick2 = (o) => {
      const r = {};
      if (o) {
        for (const k of keys) if (o[k] !== void 0) r[k] = o[k];
      }
      return r;
    };
    const global = this.instance.format && this.instance.format[kind];
    const localeBase = (kind === "number" || kind === "money") && this.instance.locale ? { locale: this.instance.locale } : {};
    return { kind, ...DEFAULT_FORMATS[kind], ...localeBase, ...pick2(col.formatterParams), ...pick2(global), ...pick2(col.format) };
  }
  /** Efektivní globální formát druhu (výchozí + instance override) — pro UI nastavení. */
  effectiveFormatFor(kind) {
    const keys = formatKeys(kind);
    const pick2 = (o) => {
      const r = {};
      if (o) {
        for (const k of keys) if (o[k] !== void 0) r[k] = o[k];
      }
      return r;
    };
    return { ...DEFAULT_FORMATS[kind], ...pick2(this.instance.format && this.instance.format[kind]) };
  }
  /** Globální formát pro druh (number/money/date/datetime/time) — sloučí patch. */
  setFormat(kind, patch) {
    const fmt = Object.assign({}, this.instance.format);
    fmt[kind] = Object.assign({}, fmt[kind], patch);
    this.instance.format = fmt;
    this.saveState();
    this.renderer.renderBody();
  }
  /**
   * Automatické prahy pro barevnou škálu (levels-1 hodnot rovnoměrně mezi min/max
   * sloupce nad aktuálně filtrovanou sadou).
   */
  autoThresholds(field2, levels) {
    const rows = this.dataSource && this.dataSource.allRows ? this.dataSource.allRows() : this.rows || [];
    let min = Infinity, max = -Infinity;
    for (const r of rows) {
      const n = Number(String(r[field2] ?? "").replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
    if (!Number.isFinite(min) || min === max) return [];
    const th = [];
    for (let k = 1; k < levels; k++) th.push(Math.round(min + (max - min) * k / levels));
    return th;
  }
  /** Podmíněná barevná škála sloupce (semafor); patch=null ji zruší. */
  setColumnCondFormat(field2, patch) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    if (patch === null) col.condFormat = null;
    else {
      const cur = col.condFormat || { on: false, levels: 3, reverse: false, thresholds: null };
      const next = Object.assign({}, cur, patch);
      if (next.on && (!Array.isArray(next.thresholds) || next.thresholds.length !== next.levels - 1)) {
        next.thresholds = this.autoThresholds(field2, next.levels);
      }
      col.condFormat = next;
    }
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /** Výjimka formátu jednoho sloupce; patch=null zruší výjimku (řídí se globálem). */
  setColumnFormat(field2, patch) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.format = patch === null ? null : Object.assign({}, col.format, patch);
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /** Zapojení sloupce do souhrnu ŘÁDKŮ (pravý sloupec) — pole funkcí. */
  setColumnRowSummary(field2, fns) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.rowSummary = Array.isArray(fns) ? fns : [];
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /** Zdroj řádků pro souhrn dle rozsahu: 'all' = celá filtrovaná sada, jinak stránka. */
  summarySource(scope) {
    if (scope === "all" && typeof this.dataSource.allRows === "function") return this.dataSource.allRows();
    return this.rows;
  }
  /** Přepne rozsah souhrnu přímo z řádku (stránka ↔ všechny záznamy). */
  toggleSummaryScope() {
    this.instance.summaryRow = this.instance.summaryRow === "all" ? "page" : "all";
    this.saveState();
    this.renderer.renderBody();
  }
  /** Otočení hlavičky sloupce: null = podle tabulky | 'none' | '90' | '270'. */
  setColumnHeaderRotate(field2, rotate) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.headerRotate = rotate || null;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /** Zapne/vypne zobrazení filtru u konkrétního sloupce. */
  setColumnFilterEnabled(field2, enabled) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.filterEnabled = !!enabled;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /**
   * Přiřadí sloupec do skupiny (nebo ho ze skupiny vyjme, group=null).
   * Po změně srovná pořadí tak, aby skupiny zůstaly celistvé (souvislé).
   */
  setColumnGroup(field2, group) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    this._clearActivePreset();
    col.group = group || null;
    this._normalizeGroups();
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("group", { field: field2, group: col.group });
  }
  /** Rozpustí celou skupinu — všechny její sloupce se vrátí na neseskupenou úroveň. */
  ungroup(groupTitle) {
    if (!groupTitle) return;
    let changed = false;
    for (const c of this.columns) if (c.group === groupTitle) {
      c.group = null;
      changed = true;
    }
    if (!changed) return;
    this._clearActivePreset();
    this._normalizeGroups();
    this.saveState();
    this.rerenderColumns();
    this._emitColumnLayout("ungroup", { group: groupTitle });
  }
  /** Seznam existujících skupin v pořadí prvního výskytu. */
  groupNames() {
    const out = [];
    for (const c of this.columns) {
      if (c.group && !out.includes(c.group)) out.push(c.group);
    }
    return out;
  }
  /** Srovná sloupce tak, aby členové každé skupiny byli souvislí (u prvního výskytu). */
  _normalizeGroups() {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const col of this.columns) {
      const g = col.group || null;
      if (g === null) {
        out.push(col);
        continue;
      }
      if (seen.has(g)) continue;
      seen.add(g);
      for (const c of this.columns) if ((c.group || null) === g) out.push(c);
    }
    this.columns = out;
  }
  /** Přizpůsobí šířku všech viditelných sloupců nejširšímu obsahu (auto-fit). */
  autoFitColumns() {
    for (const col of this.columns) {
      if (!col.visible) continue;
      const w = measureColumnWidth(col, this);
      if (w) col.width = w;
    }
    this.saveState();
    this.renderer.applyLayout();
  }
  /** Zahodí uživatelské úpravy sloupců a vrátí výchozí (z definice). */
  resetColumns() {
    this._clearActivePreset();
    this.columns = buildColumns(this.columnDefs || [], []);
    this.state.columns = [];
    this.saveState();
    this.rerenderColumns();
  }
  /**
   * Vymění definici sloupců za běhu (např. po importu s autoColumns). Ve výchozím
   * stavu zahodí persistovaný stav sloupců (nová struktura = nová sada).
   */
  setColumns(defs, { keepState = false } = {}) {
    this._clearActivePreset();
    this.columnDefs = Array.isArray(defs) ? defs : [];
    this.columns = buildColumns(this.columnDefs, keepState ? this.state.columns : []);
    if (!keepState) this.state.columns = [];
    this.saveState();
    this.rerenderColumns();
  }
  /* =================== import dat / souboru =================== */
  /**
   * Nahraje řádky za běhu. Když je zapnuté autoColumns, přegeneruje sloupce
   * podle nové struktury dat. Zdrojově agnostické (data odkudkoli).
   */
  importRows(rows) {
    rows = Array.isArray(rows) ? rows : [];
    if (this.autoColumns) this.setColumns(deriveColumns(rows));
    this.setData(rows);
    return rows.length;
  }
  /** Načte a rozparsuje lokální soubor (CSV/JSON) a nahraje ho do gridu. */
  async importFile(file) {
    const { rows, format } = await parseFile(file);
    this.importRows(rows);
    return { count: rows.length, format };
  }
  /**
   * Nahraje data z HTML `<table>`. Zdroj může být přímo table element, nebo
   * HTML string + index tabulky na stránce. Sloupce se odvodí z hlaviček
   * (název sloupce = text `<th>`), typy ze vzorku hodnot.
   */
  importHTMLTable(source, index = 0) {
    const parsed = source && source.tagName === "TABLE" ? tableToRows(source) : parseHTMLTable(source, index);
    const { rows, fields, titles } = parsed;
    this.autoColumns = true;
    this.setColumns(columnsFor(fields, rows, titles));
    this.setData(rows);
    return rows.length;
  }
  /** Nahraje data z XML (ATOM/RSS/obecné) — automaticky najde záznamový element. */
  importXML(text, opts = {}) {
    const { rows, fields, titles } = parseXML(text, opts);
    this.autoColumns = true;
    this.setColumns(columnsFor(fields, rows, titles));
    this.setData(rows);
    return rows.length;
  }
  /**
   * Načte stránku/feed z URL a zobrazí ji: HTML → N-tá `<table>`, XML/ATOM/RSS
   * → záznamy. Formát se rozpozná z obsahu (nebo vynuť `format: 'html'|'xml'`).
   * Kvůli CORS je v prohlížeči třeba stejný origin nebo proxy — předej
   * `proxy(url)→url` (v EverFLOW by to byl backend endpoint).
   * @returns {Promise<{count:number, format:'html'|'xml'}>}
   */
  async importFromUrl(url, index = 0, { proxy, format } = {}) {
    const res = await fetch(proxy ? proxy(url) : url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const ct = res.headers.get("content-type") || "";
    const isXML = format === "xml" || format !== "html" && (/xml|atom|rss/i.test(ct) || /^\s*<(\?xml|feed|rss)\b/i.test(text));
    const count = isXML ? this.importXML(text) : this.importHTMLTable(text, index);
    return { count, format: isXML ? "xml" : "html" };
  }
  /* =================== export / stažení =================== */
  /** Sloupce pro export (viditelné, s field+title). Přepsatelné opts.columns. */
  exportColumns() {
    return this.columns.filter((c) => c.visible).map((c) => ({ field: c.field, title: c.title }));
  }
  /**
   * Řádky pro export — client: celá filtrovaná+seřazená sada (i mimo stránku);
   * server: aktuálně načtená stránka (server nemá všechna data v paměti).
   */
  exportRows() {
    return this.dataSource.allRows && this.dataSource.allRows() || this.rows || [];
  }
  /**
   * Sestaví obsah exportu jako string. `format`: 'csv'|'tsv'|'json'|'xml'.
   * `opts`: { delimiter, header, columns, rows }.
   */
  exportData(format = "csv", opts = {}) {
    const rows = opts.rows || this.exportRows();
    const cols = opts.columns || this.exportColumns();
    return buildExport(format, rows, cols, opts);
  }
  /** Vytiskne tabulku (viditelné sloupce + aktuální filtrovaná data). */
  print(opts = {}) {
    const cols = opts.columns || this.exportColumns();
    const rows = opts.rows || this.exportRows();
    printTable(opts.title != null ? opts.title : this.options.printTitle || "", cols, rows, opts);
  }
  /** Stáhne data jako soubor. Vrací i obsah (string). */
  download(format = "csv", opts = {}) {
    const content = this.exportData(format, opts);
    const meta = EXPORT_META[String(format).toLowerCase()] || EXPORT_META.csv;
    const name = (opts.filename || this.options.id || "export") + "." + meta.ext;
    downloadFile(content, name, meta.mime);
    return content;
  }
  /* =================== granulární změny řádků =================== */
  /** Zdroj dat pro mutace — jen client-side (ne server, ne tree). */
  _mutableSource() {
    if (this.tree) {
      console.warn("[Lattice] addRow/updateRow/deleteRow nejsou v tree re\u017Eimu podporovan\xE9.");
      return null;
    }
    if (!(this.dataSource instanceof ClientData)) {
      console.warn("[Lattice] granul\xE1rn\xED zm\u011Bny \u0159\xE1dk\u016F funguj\xED jen v client-side re\u017Eimu.");
      return null;
    }
    return this.dataSource;
  }
  /** Sjednocený event „knihovna změnila data" (add|update|delete). */
  _emitDataChange(action, rows) {
    if (this.options.onDataChange) this.options.onDataChange(action, rows);
  }
  /** Zaznamená úpravu buňky do historie (volá inline editace i vložení rozsahu). */
  recordEdit(row, field2, oldValue, newValue) {
    this.history?.record({ type: "edit", row, before: { [field2]: oldValue }, after: { [field2]: newValue } });
  }
  undo() {
    this.history?.undo();
  }
  redo() {
    this.history?.redo();
  }
  clearHistory() {
    this.history?.clear();
  }
  /** Spustí inline editaci konkrétní buňky (např. z cell menu „Editovat zde"). */
  editCell(rowIndex, field2) {
    const col = this.columns.find((c) => c.field === field2);
    const rowData = this.rows[rowIndex];
    if (!col || !rowData || !this.editManager.editable(col)) return false;
    const cell = this.renderer.nodes.body.querySelector('.lattice-row[data-index="' + rowIndex + '"] .lattice-cell[data-field="' + field2 + '"]');
    if (!cell) return false;
    this.editManager.start(cell, col, rowData, rowIndex);
    return true;
  }
  /** Přidá řádek (na konec, nebo na začátek při atStart=true) a překreslí. */
  addRow(row, atStart = false) {
    const src = this._mutableSource();
    if (!src) return null;
    src.addRow(row, atStart);
    this.refresh();
    this.history?.record({ type: "add", row, atStart });
    this._emitDataChange("add", [row]);
    return row;
  }
  /** Upraví řádek podle klíče (keyField) sloučením patch. Vrátí řádek nebo null. */
  updateRow(key, patch) {
    const src = this._mutableSource();
    if (!src) return null;
    const existing = src.data.find((r) => this.rowKey(r) === String(key));
    const before = {}, after = {};
    if (existing) {
      for (const f in patch) if (f !== this.keyField) {
        before[f] = existing[f];
        after[f] = patch[f];
      }
    }
    const row = src.updateRow(this.keyField, key, patch);
    this.refresh();
    if (row) {
      this.history?.record({ type: "edit", row, before, after });
      this._emitDataChange("update", [row]);
    }
    return row;
  }
  /** Smaže řádek podle klíče. Vrátí true, když se něco smazalo. */
  deleteRow(key) {
    const src = this._mutableSource();
    if (!src) return false;
    const row = src.data.find((r) => this.rowKey(r) === String(key));
    const ok = src.deleteRow(this.keyField, key);
    this.refresh();
    if (ok) {
      if (row) this.history?.record({ type: "delete", row });
      this._emitDataChange("delete", [{ [this.keyField]: key }]);
    }
    return ok;
  }
  /** Hromadně smaže řádky dle klíčů (jeden onDataChange). Vrátí počet smazaných. */
  deleteRows(keys) {
    const src = this._mutableSource();
    if (!src) return 0;
    const removed = [], entries = [];
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const row = src.data.find((r) => this.rowKey(r) === String(k));
      if (src.deleteRow(this.keyField, k)) {
        removed.push({ [this.keyField]: k });
        if (row) entries.push({ type: "delete", row });
      }
    }
    this.refresh();
    if (removed.length) {
      if (entries.length) this.history?.record({ type: "batch", entries });
      this._emitDataChange("delete", removed);
    }
    return removed.length;
  }
  /** Hromadná změna: upsert řádků dle keyField. Vrátí dotčené řádky. */
  updateData(rows) {
    const src = this._mutableSource();
    if (!src) return [];
    const incoming = Array.isArray(rows) ? rows : [rows];
    let entries = null;
    if (this.history && !this._replayingHistory) {
      entries = incoming.map((inc) => {
        const existing = src.data.find((r) => this.rowKey(r) === String(inc[this.keyField]));
        if (!existing) return { type: "add", row: inc };
        const before = {}, after = {};
        for (const f in inc) if (f !== this.keyField) {
          before[f] = existing[f];
          after[f] = inc[f];
        }
        return { type: "edit", row: existing, before, after };
      });
    }
    const changed = src.upsertMany(this.keyField, incoming);
    this.refresh();
    if (entries && entries.length) this.history?.record({ type: "batch", entries });
    this._emitDataChange("update", changed);
    return changed;
  }
  /* =================== přesouvání řádků (drag reorder) =================== */
  isMovable() {
    return this.movable;
  }
  /** Má grid definované řádkové akce (options.actions)? */
  hasActions() {
    return Array.isArray(this.options.actions) && this.options.actions.length > 0;
  }
  /**
   * Přesune řádek (index v aktuálně zobrazených this.rows) k cílovému řádku.
   * zone: 'before' | 'after' | 'inside' (inside = jako potomek; jen ve stromu).
   * Ve stromu deleguje na TreeManager, jinak na plochý reorder. Po přesunu
   * překreslí a zavolá options.onRowMove(result) s tím, co má aplikace uložit.
   */
  moveRow(fromIndex, toIndex, zone) {
    const dragRow = this.rows[fromIndex];
    const targetRow = this.rows[toIndex];
    if (!dragRow || !targetRow || dragRow === targetRow) return;
    let result = null;
    if (this.tree) {
      result = this.tree.moveNode(this.rowKey(dragRow), this.rowKey(targetRow), zone);
    } else if (this.groupActive()) {
      result = this._moveRowGrouped(dragRow, targetRow, zone);
    } else {
      const flatZone = zone === "inside" ? "after" : zone;
      const changed = this.dataSource.moveRow ? this.dataSource.moveRow(this.keyField, this.rowKey(dragRow), this.rowKey(targetRow), flatZone, this.orderField) : null;
      if (changed) result = { row: dragRow, format: "flat", toIndex, changed };
    }
    if (!result) return;
    this.refresh();
    if (this.options.onRowMove) this.options.onRowMove(result);
  }
  /**
   * Přesun v seskupeném zobrazení: řádek přebere skupinové hodnoty cílového
   * řádku (přesune se do jeho skupiny) a přeuspořádá se vedle něj.
   */
  _moveRowGrouped(dragRow, targetRow, zone) {
    const fields = this.groupFields();
    const groupChanged = fields.some((f) => dragRow[f] !== targetRow[f]);
    for (const f of fields) dragRow[f] = targetRow[f];
    const flatZone = zone === "inside" ? "after" : zone;
    const changed = this.dataSource.moveRow ? this.dataSource.moveRow(this.keyField, this.rowKey(dragRow), this.rowKey(targetRow), flatZone, this.orderField) : [dragRow];
    const set = new Set(changed || []);
    set.add(dragRow);
    return { row: dragRow, format: "group", groupBy: fields.slice(), groupChanged, changed: [...set] };
  }
  /**
   * Přesun řádku na HLAVIČKU skupiny → řádek přebere skupinové hodnoty té
   * skupiny (node.path). Volá se z drop handleru hlavičky skupiny.
   */
  moveRowToGroupHeader(fromIndex, node) {
    const dragRow = this.rows[fromIndex];
    if (!dragRow || !node || !Array.isArray(node.path)) return;
    let groupChanged = false;
    for (const { field: field2, value } of node.path) {
      if (dragRow[field2] !== value) {
        dragRow[field2] = value;
        groupChanged = true;
      }
    }
    this.refresh();
    if (this.options.onRowMove) {
      this.options.onRowMove({ row: dragRow, format: "group", groupBy: this.groupFields(), groupChanged, changed: [dragRow] });
    }
  }
  /**
   * Přijme řádek přetažený z JINÉ tabulky (payload = { src, key, row }). Default
   * 'move' přidá řádek sem a odebere ho ze zdroje; 'copy' zdroj nechá. Aplikace
   * může reagovat přes onRowReceive(row, { fromId, key, mode }).
   */
  receiveExternalRow(payload) {
    if (!this.acceptExternalRows || !payload || !payload.row) return;
    const mode = this.acceptExternalRows === "copy" ? "copy" : "move";
    const source = INSTANCES.get(payload.src);
    this.addRow(payload.row);
    if (mode === "move" && source && source !== this) source.deleteRow(payload.key);
    if (this.options.onRowReceive) this.options.onRowReceive(payload.row, { fromId: payload.src, key: payload.key, mode });
  }
  /* =================== výběr řádků (selection) =================== */
  isSelectable() {
    return this.selectable.enabled;
  }
  /** Klíč řádku (keyField, jako string) — používá se pro výběr i mutace. */
  rowKey(row) {
    return row == null ? "" : String(row[this.keyField]);
  }
  /** Je řádek (objekt nebo klíč) vybraný? */
  isSelected(row) {
    return this.selected.has(typeof row === "object" && row !== null ? this.rowKey(row) : String(row));
  }
  /** Nastaví výběr jednoho řádku (respektuje single/max). */
  setRowSelected(key, on) {
    key = String(key);
    if (on) {
      if (this.selectable.mode === "single") this.selected.clear();
      if (this.selectable.max && !this.selected.has(key) && this.selected.size >= this.selectable.max) {
        this.selected.delete(this.selected.values().next().value);
      }
      this.selected.add(key);
    } else {
      this.selected.delete(key);
    }
    this._afterSelectionChange();
  }
  toggleRow(key) {
    this.setRowSelected(key, !this.selected.has(String(key)));
  }
  /** Hromadně nastaví výběr sady klíčů (pro shift-výběr rozsahu). */
  selectKeys(keys, on) {
    for (const k of keys) {
      if (on) this.selected.add(String(k));
      else this.selected.delete(String(k));
    }
    this._afterSelectionChange();
  }
  /**
   * Rozsah výběru — 'page' (aktuální stránka) nebo 'all' (všechny filtrované
   * záznamy). Horní checkbox i invertování se vztahují právě na tento rozsah.
   */
  setSelectScope(scope) {
    this.selectScope = scope === "all" ? "all" : "page";
    this.renderer.updateSelectAllCheckbox();
  }
  /** Řádky aktuálního rozsahu (stránka nebo všechny filtrované). */
  scopeRows() {
    if (this.selectScope === "all") return this.dataSource.allRows && this.dataSource.allRows() || this.rows;
    return this.rows || [];
  }
  /** Počet řádků odpovídajících filtru (pro popisek „všechny záznamy (N)"). */
  filteredCount() {
    const rows = this.dataSource.allRows && this.dataSource.allRows() || this.rows;
    return rows.length;
  }
  /** Jsou vybrané všechny řádky aktuálního rozsahu? */
  isScopeAllSelected() {
    const rows = this.scopeRows();
    return rows.length > 0 && rows.every((r) => this.selected.has(this.rowKey(r)));
  }
  /** Vybere / odznačí celý aktuální rozsah (dle isScopeAllSelected). */
  toggleScopeSelection() {
    const rows = this.scopeRows();
    const on = !this.isScopeAllSelected();
    for (const r of rows) {
      const k = this.rowKey(r);
      if (on) this.selected.add(k);
      else this.selected.delete(k);
    }
    this._afterSelectionChange();
  }
  /** Invertuje výběr v rámci aktuálního rozsahu (stránka nebo vše). */
  invertSelection() {
    for (const r of this.scopeRows()) {
      const k = this.rowKey(r);
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.add(k);
    }
    this._afterSelectionChange();
  }
  clearSelection() {
    this.selected.clear();
    this._afterSelectionChange();
  }
  /** Vybere všechny filtrované záznamy (bez ohledu na rozsah) — convenience API. */
  selectAll() {
    for (const r of this.dataSource.allRows && this.dataSource.allRows() || this.rows) this.selected.add(this.rowKey(r));
    this._afterSelectionChange();
  }
  getSelectedKeys() {
    return [...this.selected];
  }
  /** Vybrané řádky jako objekty (z client dat, jinak z aktuální stránky). */
  getSelectedRows() {
    const src = this.dataSource.data || this.rows || [];
    return src.filter((r) => this.selected.has(this.rowKey(r)));
  }
  _afterSelectionChange() {
    this.renderer.updateSelectionUI();
    if (this.options.onSelectionChange) this.options.onSelectionChange(this.getSelectedRows(), this.getSelectedKeys());
  }
  /** Re-render po změně sady/pořadí sloupců (data se nemění, nenačítá se znovu). */
  rerenderColumns() {
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this._scheduleSearchIndex();
  }
  /* =================== presety =================== */
  /** Snapshot persistovatelného stavu (pro uložení do presetu). */
  captureState() {
    return {
      columns: serializeColumns(this.columns),
      sort: JSON.parse(JSON.stringify(this.sort)),
      filters: JSON.parse(JSON.stringify(this.filters))
    };
  }
  /** Aplikuje preset — sestaví sloupce/řazení/filtry ze snapshotu a překreslí. */
  applyPreset(preset) {
    const st = preset && preset.state ? preset.state : {};
    this.columns = buildColumns(this.columnDefs || [], st.columns || []);
    this.sort = Array.isArray(st.sort) ? JSON.parse(JSON.stringify(st.sort)) : [];
    this.filters = st.filters ? JSON.parse(JSON.stringify(st.filters)) : {};
    this.page = 1;
    this._activePresetId = preset.id;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this.refresh();
  }
  /** Zruší označení aktivního presetu (uživatel začal měnit ručně). */
  _clearActivePreset() {
    this._activePresetId = null;
  }
  /* =================== callbacky stavu (pro aplikaci) =================== */
  /** Řazení se změnilo → options.onSort([{field,dir}, …]). */
  _emitSort() {
    if (this.options.onSort) this.options.onSort(this.sort.map((s) => ({ ...s })));
  }
  /** Filtry se změnily → options.onFilter({filters, universal, advanced}). */
  _emitFilter() {
    this.renderer.updateFilterClearBtn();
    if (this.options.onFilter) this.options.onFilter({
      filters: JSON.parse(JSON.stringify(this.filters)),
      universal: this.universal ? { ...this.universal } : null,
      advanced: this.advanced ? JSON.parse(JSON.stringify(this.advanced)) : null
    });
  }
  /** Stránka/velikost stránky se změnily → options.onPageChange({page,pageSize,lastPage,total}). */
  _emitPageChange() {
    if (this.options.onPageChange) this.options.onPageChange({
      page: this.page,
      pageSize: this.pageSize,
      lastPage: this.lastPage,
      total: this.total
    });
  }
  /**
   * Snímek uspořádání sloupců (pro persistenci layoutu na backend). Jen reálné
   * datové sloupce (bez synthetických _move/_select/_rownum/_actions).
   */
  getColumnLayout() {
    return this.columns.filter((c) => !c._move && !c._select && !c._rownum && !c._actions && !c._actionsMenu).map((c, i) => ({
      field: c.field,
      order: i,
      visible: c.visible !== false,
      width: c.width ?? null,
      frozen: c.frozen || false,
      group: c.group || null
    }));
  }
  /** Layout sloupců se změnil → options.onColumnLayoutChange({kind, detail, columns}). */
  _emitColumnLayout(kind, detail) {
    if (this.options.onColumnLayoutChange) {
      this.options.onColumnLayoutChange({ kind, detail: detail || null, columns: this.getColumnLayout() });
    }
  }
  /* =================== instance =================== */
  setInstance(patch) {
    Object.assign(this.instance, patch);
    this.renderer.applyInstanceStyles();
    this.saveState();
    if ("filterLayout" in patch) this.renderer.renderHeader();
    else if ("externalFiltersCollapsed" in patch) this.renderer.renderExternalFilters();
    if ("rowNumbers" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
    }
    if ("headerRotate" in patch) {
      this.renderer.renderHeader();
      this.renderer.applyLayout();
    }
    if ("summaryRow" in patch || "groupSubtotals" in patch) {
      this.renderer.renderBody();
    }
    if ("emptyText" in patch || "wrapText" in patch || "locale" in patch || "scaleColors" in patch || "linkNewTab" in patch) {
      this.renderer.renderBody();
    }
    if ("groupBy" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
      this.gear?.refresh();
    }
    if ("selectColumn" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
    }
    if ("selectRowClick" in patch) {
      this.renderer.renderBody();
    }
    if ("actionsLayout" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
    }
    if ("paginationPosition" in patch || "pageSize" in patch) {
      this.page = 1;
      this.refresh();
    } else {
      this.renderer.applyLayout();
    }
  }
  /* =================== ostatní =================== */
  setLanguage(lang) {
    this.i18n.setLang(lang);
    this.renderer.renderToolbar();
    this.renderer.renderHeader();
    this.renderer.renderFooter();
    this.renderer.applyLayout();
  }
  destroy() {
    this.gear?.close();
    this.instanceSettings?.close();
    this.renderer.destroy();
    if (INSTANCES.get(this.options.id) === this) INSTANCES.delete(this.options.id);
  }
};
var INSTANCES = /* @__PURE__ */ new Map();
function normSelectable(v) {
  if (v === true) return { enabled: true, mode: "multi", max: 0 };
  if (v === "single") return { enabled: true, mode: "single", max: 1 };
  if (typeof v === "number" && v > 0) return { enabled: true, mode: "multi", max: v };
  return { enabled: false, mode: "multi", max: 0 };
}
function uid2() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function resolveAjax(options) {
  if (options.ajax && typeof options.ajax === "object") return options.ajax;
  if (options.ajaxUrl) return { url: options.ajaxUrl };
  throw new Error("Lattice: serverSide=true vy\u017Eaduje `ajax` nebo `ajaxUrl`.");
}

// src/index.js
var VERSION = "0.4.0";
export {
  ClientData,
  I18n,
  Lattice,
  ServerData,
  Store,
  VERSION,
  availableLanguages,
  buildColumns,
  encodeParams,
  getFilter,
  getFormatter,
  registerFilter,
  registerLanguage,
  registerType,
  serializeColumns
};
