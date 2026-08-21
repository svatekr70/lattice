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
    colGroups: [],
    // názvy sbalených skupin sloupců (column grouping)
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
        colGroups: Array.isArray(parsed.colGroups) ? parsed.colGroups : base.colGroups,
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

// src/core/formula.js
var FormulaError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaError";
  }
};
var ID_START = /[A-Za-z_À-ɏ]/;
var ID_PART = /[A-Za-z0-9_À-ɏ]/;
function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9" || c === "." && src[i + 1] >= "0" && src[i + 1] <= "9") {
      let j = i + 1;
      while (j < n && (src[j] >= "0" && src[j] <= "9" || src[j] === ".")) j++;
      const num5 = parseFloat(src.slice(i, j));
      if (!Number.isFinite(num5)) throw new FormulaError("Neplatn\xE9 \u010D\xEDslo: " + src.slice(i, j));
      toks.push({ t: "num", v: num5 });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let s = "";
      while (j < n) {
        if (src[j] === q) {
          if (src[j + 1] === q) {
            s += q;
            j += 2;
            continue;
          }
          break;
        }
        s += src[j];
        j++;
      }
      if (j >= n) throw new FormulaError("Neuzav\u0159en\xFD \u0159et\u011Bzec");
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== "]") {
        s += src[j];
        j++;
      }
      if (j >= n) throw new FormulaError("Neuzav\u0159en\xE1 [z\xE1vorka] pole");
      toks.push({ t: "field", v: s.trim() });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j++;
      toks.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "<>" || two === "&&" || two === "||") {
      toks.push({ t: "op", v: two === "<>" ? "!=" : two });
      i += 2;
      continue;
    }
    if ("+-*/%<>".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "=") {
      toks.push({ t: "op", v: "==" });
      i++;
      continue;
    }
    if (c === "!") {
      toks.push({ t: "op", v: "!" });
      i++;
      continue;
    }
    if ("(),?:".includes(c)) {
      toks.push({ t: "punct", v: c });
      i++;
      continue;
    }
    throw new FormulaError("Nezn\xE1m\xFD znak: \u201E" + c + '"');
  }
  toks.push({ t: "eof" });
  return toks;
}
function parse(toks) {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const expect = (t, v) => {
    const tk = next();
    if (tk.t !== t || v != null && tk.v !== v) throw new FormulaError("O\u010Dek\xE1v\xE1no \u201E" + (v || t) + '"');
    return tk;
  };
  const isOp = (v) => {
    const tk = peek();
    return tk.t === "op" && v.includes(tk.v);
  };
  const isPunct = (v) => {
    const tk = peek();
    return tk.t === "punct" && tk.v === v;
  };
  function binLevel(sub, ops) {
    let left = sub();
    while (isOp(ops)) {
      const op = next().v;
      left = { k: "bin", op, l: left, r: sub() };
    }
    return left;
  }
  const parseExpr = () => parseTernary();
  function parseTernary() {
    const cond = parseOr();
    if (isPunct("?")) {
      next();
      const a = parseExpr();
      expect("punct", ":");
      const b = parseExpr();
      return { k: "if", args: [cond, a, b] };
    }
    return cond;
  }
  const parseOr = () => binLevel(parseAnd, ["||"]);
  const parseAnd = () => binLevel(parseCmp, ["&&"]);
  const parseCmp = () => binLevel(parseAdd, ["==", "!=", "<", "<=", ">", ">="]);
  const parseAdd = () => binLevel(parseMul, ["+", "-"]);
  const parseMul = () => binLevel(parseUnary, ["*", "/", "%"]);
  function parseUnary() {
    if (isOp(["-", "+", "!"])) {
      const op = next().v;
      return { k: "un", op, x: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (tk.t === "num") {
      next();
      return { k: "num", v: tk.v };
    }
    if (tk.t === "str") {
      next();
      return { k: "str", v: tk.v };
    }
    if (tk.t === "field") {
      next();
      return { k: "field", v: tk.v };
    }
    if (isPunct("(")) {
      next();
      const e = parseExpr();
      expect("punct", ")");
      return e;
    }
    if (tk.t === "ident") {
      next();
      const name = tk.v;
      const low = name.toLowerCase();
      if (low === "true") return { k: "lit", v: true };
      if (low === "false") return { k: "lit", v: false };
      if (low === "null") return { k: "lit", v: null };
      if (isPunct("(")) {
        next();
        const args = [];
        if (!isPunct(")")) {
          args.push(parseExpr());
          while (isPunct(",")) {
            next();
            args.push(parseExpr());
          }
        }
        expect("punct", ")");
        return { k: "call", name: low, args };
      }
      return { k: "field", v: name };
    }
    throw new FormulaError("Neo\u010Dek\xE1van\xFD vstup ve v\xFDrazu");
  }
  const ast = parseExpr();
  if (peek().t !== "eof") throw new FormulaError("P\u0159eb\xFDvaj\xEDc\xED vstup za v\xFDrazem");
  return ast;
}
function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
function isNum(v) {
  return Number.isFinite(num(v));
}
function str(v) {
  if (v == null) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v);
}
function bool(v) {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  const s = String(v).trim().toLowerCase();
  return !(s === "" || s === "0" || s === "false" || s === "ne" || s === "no");
}
function toDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d2 = new Date(v);
    return isNaN(d2.getTime()) ? null : d2;
  }
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function midnight(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}
var FUNCS = {
  // matematika
  abs: (a) => Math.abs(num(a)),
  round: (a, d) => {
    const p = Math.pow(10, d == null ? 0 : Math.trunc(num(d)));
    return Math.round(num(a) * p) / p;
  },
  floor: (a) => Math.floor(num(a)),
  ceil: (a) => Math.ceil(num(a)),
  sqrt: (a) => Math.sqrt(num(a)),
  pow: (a, b) => Math.pow(num(a), num(b)),
  mod: (a, b) => num(a) % num(b),
  min: (...xs) => Math.min(...xs.map(num)),
  max: (...xs) => Math.max(...xs.map(num)),
  number: (a) => num(a),
  // text
  concat: (...xs) => xs.map(str).join(""),
  upper: (a) => str(a).toUpperCase(),
  lower: (a) => str(a).toLowerCase(),
  trim: (a) => str(a).trim(),
  len: (a) => str(a).length,
  left: (a, n) => {
    const k = Math.trunc(num(n));
    return k <= 0 ? "" : str(a).slice(0, k);
  },
  right: (a, n) => {
    const s = str(a), k = Math.trunc(num(n));
    return k <= 0 ? "" : s.slice(Math.max(0, s.length - k));
  },
  substr: (a, start, len) => {
    const s = str(a), st = Math.trunc(num(start));
    return len == null ? s.slice(st) : s.slice(st, st + Math.trunc(num(len)));
  },
  replace: (a, from, to) => str(a).split(str(from)).join(str(to)),
  contains: (a, sub) => str(a).toLowerCase().includes(str(sub).toLowerCase()),
  // logika
  coalesce: (...xs) => {
    for (const x of xs) if (x != null && x !== "" && !(typeof x === "number" && Number.isNaN(x))) return x;
    return xs.length ? xs[xs.length - 1] : null;
  },
  isblank: (a) => a == null || str(a).trim() === "",
  not: (a) => !bool(a),
  text: (a) => str(a),
  // datum (dnešní datum se bere z reálného času prohlížeče)
  today: () => midnight(/* @__PURE__ */ new Date()),
  now: () => /* @__PURE__ */ new Date(),
  date: (a) => toDate(a),
  year: (a) => {
    const d = toDate(a);
    return d ? d.getFullYear() : NaN;
  },
  month: (a) => {
    const d = toDate(a);
    return d ? d.getMonth() + 1 : NaN;
  },
  day: (a) => {
    const d = toDate(a);
    return d ? d.getDate() : NaN;
  },
  weekday: (a) => {
    const d = toDate(a);
    return d ? (d.getDay() + 6) % 7 + 1 : NaN;
  },
  // 1=Po … 7=Ne
  days: (a, b) => {
    const da = toDate(a), db = toDate(b);
    if (!da || !db) return NaN;
    return Math.round((midnight(db) - midnight(da)) / 864e5);
  },
  age: (a) => {
    const d = toDate(a);
    if (!d) return NaN;
    const t = /* @__PURE__ */ new Date();
    let y = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || m === 0 && t.getDate() < d.getDate()) y--;
    return y;
  }
};
var FORMULA_FUNCTIONS = Object.keys(FUNCS).concat(["if"]);
var FORMULA_CATALOG = [
  { cat: "num", fns: ["round", "floor", "ceil", "abs", "sqrt", "pow", "mod", "min", "max", "number"] },
  { cat: "text", fns: ["concat", "upper", "lower", "trim", "len", "left", "right", "substr", "replace", "contains", "text"] },
  { cat: "logic", fns: ["if", "coalesce", "isblank", "not"] },
  { cat: "date", fns: ["today", "now", "date", "year", "month", "day", "weekday", "days", "age"] }
];
var hasOwn = Object.prototype.hasOwnProperty;
function evalNode(node, row) {
  switch (node.k) {
    case "num":
    case "str":
    case "lit":
      return node.v;
    // Jen VLASTNÍ vlastnosti řádku — nikdy zděděné z prototypu (constructor,
    // __proto__, toString…), aby vzorec nemohl sáhnout mimo data.
    case "field":
      return row != null && hasOwn.call(row, node.v) ? row[node.v] : void 0;
    case "un": {
      const x = evalNode(node.x, row);
      if (node.op === "-") return -num(x);
      if (node.op === "+") return num(x);
      return !bool(x);
    }
    case "bin":
      return evalBin(node, row);
    case "if":
      return bool(evalNode(node.args[0], row)) ? evalNode(node.args[1], row) : node.args[2] !== void 0 ? evalNode(node.args[2], row) : null;
    case "call": {
      if (node.name === "if") {
        return bool(evalNode(node.args[0], row)) ? evalNode(node.args[1], row) : node.args[2] !== void 0 ? evalNode(node.args[2], row) : null;
      }
      const fn = FUNCS[node.name];
      return fn(...node.args.map((a) => evalNode(a, row)));
    }
  }
  return void 0;
}
function evalBin(node, row) {
  const op = node.op;
  if (op === "&&") return bool(evalNode(node.l, row)) && bool(evalNode(node.r, row));
  if (op === "||") return bool(evalNode(node.l, row)) || bool(evalNode(node.r, row));
  const a = evalNode(node.l, row), b = evalNode(node.r, row);
  switch (op) {
    // '+' sčítá jen když jsou obě strany číselné, jinak spojuje text
    case "+":
      return isNum(a) && isNum(b) ? num(a) + num(b) : str(a) + str(b);
    case "-":
      return num(a) - num(b);
    case "*":
      return num(a) * num(b);
    case "/": {
      const d = num(b);
      return d === 0 ? NaN : num(a) / d;
    }
    case "%": {
      const d = num(b);
      return d === 0 ? NaN : num(a) % d;
    }
    case "==":
      return eq(a, b);
    case "!=":
      return !eq(a, b);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return cmp(op, a, b);
  }
  return void 0;
}
function dateLike(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  return null;
}
function eq(a, b) {
  const da = dateLike(a), db = dateLike(b);
  if (da != null && db != null) return da === db;
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  return str(a) === str(b);
}
function cmp(op, a, b) {
  let x, y;
  const da = dateLike(a), db = dateLike(b);
  if (da != null && db != null) {
    x = da;
    y = db;
  } else if (isNum(a) && isNum(b)) {
    x = num(a);
    y = num(b);
  } else {
    x = str(a);
    y = str(b);
  }
  switch (op) {
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
  }
}
function validate(node) {
  if (!node || typeof node !== "object") return;
  if (node.k === "call") {
    if (node.name === "if") {
      if (node.args.length < 2) throw new FormulaError("if() pot\u0159ebuje aspo\u0148 podm\xEDnku a hodnotu: if(podm\xEDnka, kdy\u017E ano, kdy\u017E ne)");
    } else if (!FUNCS[node.name]) {
      throw new FormulaError("Nezn\xE1m\xE1 funkce: " + node.name + "()");
    }
  }
  for (const key of ["x", "l", "r"]) if (node[key]) validate(node[key]);
  if (node.args) node.args.forEach(validate);
}
function parseFormula(src) {
  return parse(tokenize(String(src == null ? "" : src)));
}
function compileFormula(src) {
  const ast = parseFormula(src);
  validate(ast);
  return (row) => evalNode(ast, row);
}
function validateFormula(src) {
  try {
    const ast = parseFormula(src);
    validate(ast);
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
var AGG_FNS = {
  sum: (vs) => vs.reduce((a, b) => a + b, 0),
  avg: (vs) => vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN,
  min: (vs) => vs.length ? Math.min(...vs) : NaN,
  max: (vs) => vs.length ? Math.max(...vs) : NaN,
  median: (vs) => {
    if (!vs.length) return NaN;
    const s = [...vs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
};
function aggNums(argNode, rows) {
  const out = [];
  for (const r of rows) {
    const n = num(evalNode(argNode, r));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
function aggCount(argNode, rows) {
  let c = 0;
  for (const r of rows) {
    const v = argNode ? evalNode(argNode, r) : 1;
    if (v != null && v !== "" && !(typeof v === "number" && Number.isNaN(v))) c++;
  }
  return c;
}
function evalAgg(node, rows) {
  switch (node.k) {
    case "num":
    case "str":
    case "lit":
      return node.v;
    case "field":
      return void 0;
    // pole mimo agregaci (validace to nepustí)
    case "un": {
      const x = evalAgg(node.x, rows);
      if (node.op === "-") return -num(x);
      if (node.op === "+") return num(x);
      return !bool(x);
    }
    case "bin":
      return evalAggBin(node, rows);
    case "if":
      return bool(evalAgg(node.args[0], rows)) ? evalAgg(node.args[1], rows) : node.args[2] !== void 0 ? evalAgg(node.args[2], rows) : null;
    case "call": {
      const n = node.name;
      if (n === "count") return aggCount(node.args[0], rows);
      if (AGG_FNS[n]) return AGG_FNS[n](aggNums(node.args[0], rows));
      if (n === "if") {
        return bool(evalAgg(node.args[0], rows)) ? evalAgg(node.args[1], rows) : node.args[2] !== void 0 ? evalAgg(node.args[2], rows) : null;
      }
      return FUNCS[n](...node.args.map((a) => evalAgg(a, rows)));
    }
  }
  return void 0;
}
function evalAggBin(node, rows) {
  const op = node.op;
  if (op === "&&") return bool(evalAgg(node.l, rows)) && bool(evalAgg(node.r, rows));
  if (op === "||") return bool(evalAgg(node.l, rows)) || bool(evalAgg(node.r, rows));
  const a = evalAgg(node.l, rows), b = evalAgg(node.r, rows);
  switch (op) {
    case "+":
      return isNum(a) && isNum(b) ? num(a) + num(b) : str(a) + str(b);
    case "-":
      return num(a) - num(b);
    case "*":
      return num(a) * num(b);
    case "/": {
      const d = num(b);
      return d === 0 ? NaN : num(a) / d;
    }
    case "%": {
      const d = num(b);
      return d === 0 ? NaN : num(a) % d;
    }
    case "==":
      return eq(a, b);
    case "!=":
      return !eq(a, b);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return cmp(op, a, b);
  }
  return void 0;
}
var AGG_NAMES = /* @__PURE__ */ new Set(["sum", "avg", "count", "min", "max", "median"]);
function validateAgg(node, insideAgg) {
  if (!node || typeof node !== "object") return;
  if (node.k === "field" && !insideAgg) {
    throw new FormulaError("Pole \u201E" + node.v + '" mus\xED b\xFDt uvnit\u0159 agregace \u2014 nap\u0159. sum(' + node.v + ")");
  }
  if (node.k === "call") {
    const isAgg = AGG_NAMES.has(node.name);
    if (isAgg && insideAgg) throw new FormulaError("Agregaci nelze vno\u0159it do jin\xE9 agregace: " + node.name + "()");
    if (!isAgg && node.name !== "if" && !FUNCS[node.name]) throw new FormulaError("Nezn\xE1m\xE1 funkce: " + node.name + "()");
    const inner = insideAgg || isAgg;
    node.args.forEach((a) => validateAgg(a, inner));
    return;
  }
  for (const key of ["x", "l", "r"]) if (node[key]) validateAgg(node[key], insideAgg);
  if (node.args) node.args.forEach((a) => validateAgg(a, insideAgg));
}
function compileAggregate(src) {
  const ast = parseFormula(src);
  validateAgg(ast, false);
  return (rows) => evalAgg(ast, rows || []);
}
function validateAggregate(src) {
  try {
    const ast = parseFormula(src);
    validateAgg(ast, false);
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
var AGGREGATE_CATALOG = [
  { cat: "agg", fns: ["sum", "avg", "count", "min", "max", "median"] },
  { cat: "num", fns: ["round", "abs", "floor", "ceil"] }
];

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
    if (!saved) continue;
    let def = byField.get(saved.field);
    if (!def) {
      if (saved.computed && typeof saved.formula === "string") {
        def = { field: saved.field, title: saved.title != null ? saved.title : saved.field, type: saved.type || "text", computed: true, formula: saved.formula };
      } else continue;
    }
    if (used.has(saved.field)) continue;
    result.push(resolveColumn(def, saved));
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
  const formula = typeof def.formula === "string" ? def.formula : null;
  let value = typeof def.value === "function" ? def.value : null;
  if (!value && formula) {
    try {
      value = compileFormula(formula);
    } catch {
      value = () => void 0;
    }
  }
  const filterExplicit = !!(def.filter || Array.isArray(def.filterTypes));
  const defaultFilter = def.filter || availableFilters[0] || null;
  const defaultFilterEnabled = def.filterEnabled !== void 0 ? def.filterEnabled !== false : filterExplicit;
  const filter = s.filterType != null ? s.filterType : defaultFilter;
  return {
    // --- z definice (živé, nepersistuje se) ---
    field: def.field,
    // Titulek lze přejmenovat v UI → persistuje se odchylka od configu.
    defaultTitle: def.title != null ? String(def.title) : def.field,
    title: s.title !== void 0 ? s.title : def.title != null ? String(def.title) : def.field,
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
    value,
    // odvozená (computed) hodnota z celého řádku (funkce nebo null)
    formula,
    // vzorec počítaného sloupce (řetězec) — jen u sloupců z UI; jinak null
    validator: def.validator != null ? def.validator : null,
    // deklarativní validace editace
    cellClass: typeof def.cellClass === "function" ? def.cellClass : null,
    // podmíněné třídy buňky
    cellStyle: typeof def.cellStyle === "function" ? def.cellStyle : null,
    // podmíněný inline styl buňky
    editor: def.editor || null,
    headerSort: def.headerSort !== false,
    // řadit klikem na hlavičku (default true)
    wrap: def.wrap,
    // per-sloupcové zalamování (true/false přebije globální wrapText; undefined = dle globálu)
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
    // Vlastní barvy záhlaví SLOUPCE (pozadí + písmo). null = výchozí motiv.
    // Persistuje se jen odchylka od configu (uživatel je mění v UI).
    defaultHeaderBackground: def.headerBackground || null,
    headerBackground: s.headerBackground !== void 0 ? s.headerBackground : def.headerBackground || null,
    defaultHeaderColor: def.headerColor || null,
    headerColor: s.headerColor !== void 0 ? s.headerColor : def.headerColor || null,
    // Vlastní barvy záhlaví SKUPINY — z nested definice skupiny
    // (`{ title, headerBackground, columns }`) nebo per-sloupec (`groupHeaderBackground`).
    defaultGroupHeaderBackground: def.groupHeaderBackground || def.groupDef && def.groupDef.headerBackground || null,
    groupHeaderBackground: s.groupHeaderBackground !== void 0 ? s.groupHeaderBackground : def.groupHeaderBackground || def.groupDef && def.groupDef.headerBackground || null,
    defaultGroupHeaderColor: def.groupHeaderColor || def.groupDef && def.groupDef.headerColor || null,
    groupHeaderColor: s.groupHeaderColor !== void 0 ? s.groupHeaderColor : def.groupHeaderColor || def.groupDef && def.groupDef.headerColor || null,
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
    // Vzorec pro souhrnný ŘÁDEK dole (vážený/poolovaný souhrn z agregací jiných
    // sloupců, viz core/formula.js). null = žádný, jinak řetězec.
    defaultSummaryFormula: def.summaryFormula || null,
    summaryFormula: s.summaryFormula !== void 0 ? s.summaryFormula : def.summaryFormula || null,
    // Volitelný název řádku souhrnného vzorce (vlevo místo generického „Vzorec").
    // Sloupce se stejným názvem sdílejí jeden řádek; různé názvy = víc řádků.
    defaultSummaryFormulaLabel: def.summaryFormulaLabel || null,
    summaryFormulaLabel: s.summaryFormulaLabel !== void 0 ? s.summaryFormulaLabel : def.summaryFormulaLabel || null,
    // Formát zobrazení (číslo/měna/datum) — výjimka sloupce vůči globálnímu formátu.
    // null = řídit se globálním nastavením tabulky.
    defaultColFormat: def.format || null,
    format: s.format !== void 0 ? s.format : def.format || null,
    // Podmíněná barevná škála (semafor) — { on, levels, reverse, thresholds }.
    defaultCondFormat: def.condFormat || null,
    condFormat: s.condFormat !== void 0 ? s.condFormat : def.condFormat || null,
    // Formát BUŇKY (vzhled těla sloupce): { align, bold, italic, underline,
    // strike, color, background }. Nastavuje se v UI; persistuje se odchylka.
    defaultCellFormat: def.cellFormat || null,
    cellFormat: s.cellFormat !== void 0 ? s.cellFormat : def.cellFormat || null
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
  date: ["date-range", "date-two", "dynamic"],
  datetime: ["date-range", "date-two", "dynamic"],
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
    // přejmenovaný titulek se ukládá jen při odchylce od configu.
    ...c.title !== c.defaultTitle ? { title: c.title } : {},
    // Počítaný sloupec (definovaný v UI) se persistuje celý — bez configu ho
    // po reloadu nelze zrekonstruovat, tak uložíme i jeho titulek, typ a vzorec.
    ...c.formula != null ? { computed: true, formula: c.formula, title: c.title, type: c.type } : {},
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
    // vzorec souhrnu (+ jeho název řádku) se ukládá jen když se liší od výchozího.
    ...c.summaryFormula !== c.defaultSummaryFormula ? { summaryFormula: c.summaryFormula } : {},
    ...c.summaryFormulaLabel !== c.defaultSummaryFormulaLabel ? { summaryFormulaLabel: c.summaryFormulaLabel } : {},
    // barvy záhlaví (sloupce i skupiny) se ukládají jen při odchylce od configu.
    ...c.headerBackground !== c.defaultHeaderBackground ? { headerBackground: c.headerBackground } : {},
    ...c.headerColor !== c.defaultHeaderColor ? { headerColor: c.headerColor } : {},
    ...c.groupHeaderBackground !== c.defaultGroupHeaderBackground ? { groupHeaderBackground: c.groupHeaderBackground } : {},
    ...c.groupHeaderColor !== c.defaultGroupHeaderColor ? { groupHeaderColor: c.groupHeaderColor } : {},
    // formát buňky (vzhled těla) — jen při odchylce od configu.
    ...JSON.stringify(c.cellFormat) !== JSON.stringify(c.defaultCellFormat) ? { cellFormat: c.cellFormat } : {},
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

// src/core/dateParts.js
var DATE_PARTS = ["year", "quarter", "month", "week", "weekday", "day", "hour", "minute"];
function toDate2(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
var pad2 = (n) => String(n).padStart(2, "0");
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day2 = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day2 + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  return 1 + Math.round(((t - firstThu) / 864e5 - 3 + firstDay) / 7);
}
function dateBucket(value, part, i18n) {
  const d = toDate2(value);
  if (!d) return null;
  const months = i18n && i18n.list("dateRange.months") || [];
  const weekdays = i18n && i18n.list("dateRange.weekdaysLong") || [];
  const wk = i18n && i18n.t("group.weekLabel") || "T\xFDden";
  switch (part) {
    case "year": {
      const y = d.getFullYear();
      return { sort: y, label: String(y) };
    }
    case "quarter": {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return { sort: q, label: "Q" + q };
    }
    case "month": {
      const m = d.getMonth();
      return { sort: m, label: months[m] || String(m + 1) };
    }
    case "week": {
      const w = isoWeek(d);
      return { sort: w, label: wk + " " + w };
    }
    case "weekday": {
      const wd = (d.getDay() + 6) % 7;
      return { sort: wd, label: weekdays[wd] || String(wd) };
    }
    case "day": {
      const dm = d.getDate();
      return { sort: dm, label: dm + "." };
    }
    case "hour": {
      const h = d.getHours();
      return { sort: h, label: pad2(h) + ":00" };
    }
    case "minute": {
      const mi = d.getMinutes();
      return { sort: mi, label: pad2(d.getHours()) + ":" + pad2(mi) };
    }
    default:
      return null;
  }
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
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s) && !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) s = "'" + s;
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
  const isNum2 = (c) => c.type === "number" || c.type === "money" || c.type === "progress" || c.type === "rating";
  const cell = (v, numeric) => {
    if (numeric && v != null && v !== "" && Number.isFinite(Number(v))) {
      return `<Cell><Data ss:Type="Number">${Number(v)}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  };
  const head = "<Row>" + cols.map((c) => `<Cell><Data ss:Type="String">${xe(c.title)}</Data></Cell>`).join("") + "</Row>";
  const body = rows.map(
    (r) => "<Row>" + cols.map((c) => cell(cellValue(r, c), isNum2(c))).join("") + "</Row>"
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
  let armed = false;
  const id = setTimeout(() => {
    armed = true;
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return () => {
    clearTimeout(id);
    if (!armed) return;
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
function cssEscape(s) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

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
  if (!isGroup(group)) return true;
  const active = group.rules.filter((r) => isGroup(r) ? !isEmptyTree(r) : r && r.op);
  if (active.length === 0) return true;
  const results = active.map((r) => isGroup(r) ? evalGroup(r, row) : evalCondition(r, row));
  return group.combinator === "OR" ? results.some(Boolean) : results.every(Boolean);
}
function evalCondition(c, row) {
  if (!c || !c.op) return true;
  const raw = row[c.field];
  const s = norm(raw);
  const v = resolveToken(c.value);
  switch (c.op) {
    case "empty":
      return raw == null || raw === "";
    case "nempty":
      return !(raw == null || raw === "");
    case "eq":
      return s === norm(v);
    case "neq":
      return s !== norm(v);
    case "contains":
      return s.includes(norm(v));
    case "ncontains":
      return !s.includes(norm(v));
    case "starts":
      return s.startsWith(norm(v));
    case "ends":
      return s.endsWith(norm(v));
    // Prázdné/chybějící pole není porovnatelné → nesmí splnit ordering (jinak by
    // se prázdná hodnota chovala jako „menší než cokoli" a splnila lt/lte).
    case "gt":
      return raw != null && raw !== "" && cmp2(raw, v) > 0;
    case "gte":
      return raw != null && raw !== "" && cmp2(raw, v) >= 0;
    case "lt":
      return raw != null && raw !== "" && cmp2(raw, v) < 0;
    case "lte":
      return raw != null && raw !== "" && cmp2(raw, v) <= 0;
    case "in":
      return splitList(v).map(norm).includes(s);
    case "nin":
      return !splitList(v).map(norm).includes(s);
    default:
      return true;
  }
}
function norm(v) {
  return String(v ?? "").toLowerCase().trim();
}
function num2(v) {
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
function cmp2(a, b) {
  const na = num2(a), nb = num2(b);
  if (na != null && nb != null) return na - nb;
  const da = day(a), db = day(b);
  if (da != null && db != null) return da - db;
  return norm(a).localeCompare(norm(b), void 0, { numeric: true });
}
function splitList(v) {
  if (Array.isArray(v)) return v.map(resolveToken);
  return String(v ?? "").split(",").map((x) => resolveToken(x.trim())).filter(Boolean);
}
var TOKEN_RE = /^\s*(today|now|sow|eow|som|eom|soq|eoq|soy|eoy)\s*(?:([+-])\s*(\d+)\s*([dwmy])?)?\s*$/i;
function addMonths(d, n) {
  const day2 = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day2, lastDay));
}
function startOfWeekMonday(d) {
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
}
function resolveToken(v) {
  if (typeof v !== "string") return v;
  const m = TOKEN_RE.exec(v);
  if (!m) return v;
  const base = m[1].toLowerCase();
  const d = /* @__PURE__ */ new Date();
  if (base !== "now") d.setHours(0, 0, 0, 0);
  if (m[2]) {
    const n = (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10);
    switch ((m[4] || "d").toLowerCase()) {
      case "w":
        d.setDate(d.getDate() + n * 7);
        break;
      case "m":
        addMonths(d, n);
        break;
      case "y":
        addMonths(d, n * 12);
        break;
      default:
        d.setDate(d.getDate() + n);
    }
  }
  switch (base) {
    case "sow":
      startOfWeekMonday(d);
      break;
    case "eow":
      startOfWeekMonday(d);
      d.setDate(d.getDate() + 6);
      break;
    case "som":
      d.setDate(1);
      break;
    case "eom":
      d.setMonth(d.getMonth() + 1, 0);
      break;
    case "soq":
      d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
      break;
    case "eoq":
      d.setMonth(Math.floor(d.getMonth() / 3) * 3 + 3, 0);
      break;
    case "soy":
      d.setMonth(0, 1);
      break;
    case "eoy":
      d.setMonth(11, 31);
      break;
    default:
      break;
  }
  return base === "now" ? fmtDateTime(d) : fmtDate(d);
}
function resolveTreeTokens(group) {
  if (!isGroup(group)) return group;
  return { ...group, rules: group.rules.map((r) => isGroup(r) ? resolveTreeTokens(r) : resolveConditionTokens(r)) };
}
function resolveConditionTokens(c) {
  if (!c || !c.op) return { ...c };
  const v = c.value;
  if (c.op === "in" || c.op === "nin") {
    if (Array.isArray(v)) return { ...c, value: v.map(resolveToken) };
    return { ...c, value: String(v ?? "").split(",").map((x) => resolveToken(x.trim())).join(",") };
  }
  return { ...c, value: Array.isArray(v) ? v.map(resolveToken) : resolveToken(v) };
}
function pad22(x) {
  return String(x).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad22(d.getMonth() + 1)}-${pad22(d.getDate())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)}T${pad22(d.getHours())}:${pad22(d.getMinutes())}:${pad22(d.getSeconds())}`;
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
  let appliedRaw = { from: ctx.value?.from ?? null, to: ctx.value?.to ?? null };
  let applied = resolveRange(appliedRaw);
  let dynamic = isToken(appliedRaw.from) || isToken(appliedRaw.to);
  let presetTokens = matchPresetTokens(appliedRaw);
  let draft = cloneRange(applied);
  let leftView = viewOf(draft.from) || viewOf(/* @__PURE__ */ new Date());
  let rightView = viewOf(draft.to) || nextMonth(leftView);
  if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
  function presetLabel(raw) {
    if (!raw) return null;
    const p = PRESETS.find((x) => x.tokens && x.tokens.from === raw.from && x.tokens.to === raw.to);
    return p ? ctx.i18n.t("dateRange.presets." + p.key) : null;
  }
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
    if (!appliedRaw.from && !appliedRaw.to) {
      text.textContent = t("placeholder");
      text.classList.add("is-placeholder");
      clearBtn.style.display = "none";
    } else {
      text.classList.remove("is-placeholder");
      const dyn = isToken(appliedRaw.from) || isToken(appliedRaw.to);
      const lbl = presetLabel(appliedRaw);
      text.textContent = (dyn ? "\u21BB " : "") + (lbl || rangeText(applied.from, applied.to));
      clearBtn.style.display = "";
    }
  }
  function clearFilter() {
    applied = { from: null, to: null };
    appliedRaw = { from: null, to: null };
    draft = { from: null, to: null };
    presetTokens = null;
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
    presetTokens = matchPresetTokens(appliedRaw);
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
    if (!from && !to) {
      appliedRaw = { from: null, to: null };
      ctx.onChange(null);
    } else if (dynamic && presetTokens) {
      appliedRaw = { from: presetTokens.from, to: presetTokens.to };
      ctx.onChange({ from: presetTokens.from, to: presetTokens.to });
    } else {
      appliedRaw = { from: from ? toISO(from) : null, to: to ? toISO(to) : null };
      ctx.onChange({ from: appliedRaw.from, to: appliedRaw.to });
    }
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
    const dyn = el("label.lattice-dr-dyn", { title: t("dynamicHint") });
    const cb = el("input", { type: "checkbox" });
    cb.checked = dynamic;
    cb.addEventListener("change", () => {
      dynamic = cb.checked;
      renderAll();
    });
    dyn.append(cb, el("span", { text: t("dynamic") }));
    presets.appendChild(dyn);
    for (const p of PRESETS) {
      const row = el("div.lattice-dr-preset", { text: ctx.i18n.t("dateRange.presets." + p.key) });
      row.addEventListener("click", () => setRange(p.range(), p.tokens));
      presets.appendChild(row);
    }
    const clearRow = el("div.lattice-dr-preset.is-clear", { text: "\u2715 " + t("clear") });
    clearRow.addEventListener("click", () => clearFilter());
    presets.appendChild(clearRow);
  }
  function setRange({ from, to }, tokens) {
    draft = { from: from || null, to: to || null };
    presetTokens = tokens || null;
    if (draft.from) leftView = viewOf(draft.from);
    if (draft.to) rightView = viewOf(draft.to);
    else rightView = nextMonth(leftView);
    if (sameView(leftView, rightView)) rightView = nextMonth(leftView);
    renderAll();
  }
  function renderAll() {
    renderMonth("left", leftView);
    renderMonth("right", rightView);
    const dyn = dynamic && presetTokens;
    const lbl = dyn ? presetLabel(presetTokens) : null;
    panel._nodes.rangeLabel.textContent = (dyn ? "\u21BB " : "") + (lbl || rangeText(draft.from, draft.to));
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
    presetTokens = null;
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
    if (side === "left") leftView = addMonths2(leftView, delta);
    else rightView = addMonths2(rightView, delta);
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
function isToken(s) {
  return typeof s === "string" && s !== "" && String(resolveToken(s)) !== s;
}
function resolveRange(raw) {
  return { from: parseISO(resolveToken(raw && raw.from)), to: parseISO(resolveToken(raw && raw.to)) };
}
function matchPresetTokens(raw) {
  if (!raw) return null;
  const p = PRESETS.find((x) => x.tokens && x.tokens.from === raw.from && x.tokens.to === raw.to);
  return p ? p.tokens : null;
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
  return addMonths2(v, 1);
}
function addMonths2(v, delta) {
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
  { key: "today", tokens: { from: "today", to: "today" }, range: () => ({ from: today(), to: today() }) },
  { key: "yesterday", tokens: { from: "today-1", to: "today-1" }, range: () => ({ from: addDays(today(), -1), to: addDays(today(), -1) }) },
  { key: "weekToDate", tokens: { from: "sow", to: "today" }, range: () => ({ from: startOfWeek(today()), to: today() }) },
  { key: "thisWeek", tokens: { from: "sow", to: "eow" }, range: () => ({ from: startOfWeek(today()), to: addDays(startOfWeek(today()), 6) }) },
  { key: "lastWeek", tokens: { from: "sow-1w", to: "eow-1w" }, range: () => ({ from: addDays(startOfWeek(today()), -7), to: addDays(startOfWeek(today()), -1) }) },
  { key: "last7", tokens: { from: "today-6", to: "today" }, range: () => ({ from: addDays(today(), -6), to: today() }) },
  { key: "last30", tokens: { from: "today-29", to: "today" }, range: () => ({ from: addDays(today(), -29), to: today() }) },
  { key: "monthToDate", tokens: { from: "som", to: "today" }, range: () => ({ from: startOfMonth(today()), to: today() }) },
  { key: "thisMonth", tokens: { from: "som", to: "eom" }, range: () => ({ from: startOfMonth(today()), to: endOfMonth(today()) }) },
  { key: "lastMonth", tokens: { from: "som-1m", to: "eom-1m" }, range: () => {
    const d = new Date(today().getFullYear(), today().getMonth() - 1, 1);
    return { from: startOfMonth(d), to: endOfMonth(d) };
  } },
  { key: "thisQuarter", tokens: { from: "soq", to: "eoq" }, range: () => {
    const t = today();
    const qs = Math.floor(t.getMonth() / 3) * 3;
    return { from: new Date(t.getFullYear(), qs, 1), to: new Date(t.getFullYear(), qs + 3, 0) };
  } },
  { key: "nextMonth", tokens: { from: "som+1m", to: "eom+1m" }, range: () => {
    const d = new Date(today().getFullYear(), today().getMonth() + 1, 1);
    return { from: startOfMonth(d), to: endOfMonth(d) };
  } },
  { key: "next3Months", tokens: { from: "som+1m", to: "eom+3m" }, range: () => {
    const s = new Date(today().getFullYear(), today().getMonth() + 1, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 3, 0);
    return { from: s, to: e };
  } }
];
var CAL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 7v10H5V9h14z"/></svg>';

// src/features/menu.js
function openMenu(anchor, items, onPick, opts = {}) {
  document.querySelectorAll(".lattice-menu").forEach((m) => m.remove());
  const menu = buildMenu(items, () => close(), onPick, opts);
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (opts.multi || !anchor.contains(e.target)) close();
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
function buildMenu(items, close, onPick, opts = {}) {
  const multi = !!opts.multi;
  const menu = el("div.lattice-menu" + (multi ? ".lattice-menu-multi" : ""));
  for (const it of items) {
    if (it.separator) {
      menu.appendChild(el("div.lattice-menu-sep"));
      continue;
    }
    const cls = [it.active ? "is-active" : "", it.disabled ? "is-disabled" : "", it.danger ? "is-danger" : ""].filter(Boolean).join(" ");
    const row = el("div.lattice-menu-item" + (multi ? ".is-checkable" : ""), { class: cls });
    if (multi) row.appendChild(el("span.lattice-menu-check", { "aria-hidden": "true" }));
    row.appendChild(el("span.lattice-menu-label", { text: it.label }));
    if (!it.disabled) {
      row.addEventListener("click", (e) => {
        if (multi) {
          e.stopPropagation();
          onPick(it.value, it);
          const now = opts.isActive ? opts.isActive(it.value) : !row.classList.contains("is-active");
          row.classList.toggle("is-active", now);
        } else {
          close();
          onPick(it.value, it);
        }
      });
    }
    menu.appendChild(row);
  }
  return menu;
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
var pad23 = (x) => String(x).padStart(2, "0");
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
    mm: pad23(mo + 1),
    m: mo + 1,
    dddd: weekdaysLong[wd],
    ddd: weekdays[wd],
    dd: pad23(d.getDate()),
    d: d.getDate(),
    HH: pad23(h24),
    H: h24,
    hh: pad23(h12),
    h: h12,
    nn: pad23(d.getMinutes()),
    n: d.getMinutes(),
    ss: pad23(d.getSeconds()),
    s: d.getSeconds(),
    A: h24 < 12 ? "AM" : "PM",
    a: h24 < 12 ? "am" : "pm"
  };
  return String(pattern || "").replace(DATE_TOKEN_RE, (tok) => {
    const v = map[tok];
    return v == null ? tok : String(v);
  });
}

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

// src/features/headerColor.js
var HEADER_COLOR_PRESETS = [
  // plné
  { key: "primary", label: "Primary", bg: "#0d6efd", fg: "#ffffff" },
  { key: "secondary", label: "Secondary", bg: "#6c757d", fg: "#ffffff" },
  { key: "success", label: "Success", bg: "#198754", fg: "#ffffff" },
  { key: "danger", label: "Danger", bg: "#dc3545", fg: "#ffffff" },
  { key: "warning", label: "Warning", bg: "#ffc107", fg: "#000000" },
  { key: "info", label: "Info", bg: "#0dcaf0", fg: "#000000" },
  { key: "light", label: "Light", bg: "#f8f9fa", fg: "#212529" },
  { key: "dark", label: "Dark", bg: "#212529", fg: "#ffffff" },
  // jemné (alert)
  { key: "primary-soft", label: "Primary \u2014 jemn\xE9", bg: "#cfe2ff", fg: "#084298" },
  { key: "secondary-soft", label: "Secondary \u2014 jemn\xE9", bg: "#e2e3e5", fg: "#41464b" },
  { key: "success-soft", label: "Success \u2014 jemn\xE9", bg: "#d1e7dd", fg: "#0f5132" },
  { key: "danger-soft", label: "Danger \u2014 jemn\xE9", bg: "#f8d7da", fg: "#842029" },
  { key: "warning-soft", label: "Warning \u2014 jemn\xE9", bg: "#fff3cd", fg: "#664d03" },
  { key: "info-soft", label: "Info \u2014 jemn\xE9", bg: "#cff4fc", fg: "#055160" },
  { key: "light-soft", label: "Light \u2014 jemn\xE9", bg: "#fefefe", fg: "#636464" },
  { key: "dark-soft", label: "Dark \u2014 jemn\xE9", bg: "#d3d3d4", fg: "#141619" }
];
function openHeaderColorPicker(anchor, opts) {
  return colorPickerMenu(anchor, { ...opts, mode: "pair" });
}
function openColorPicker(anchor, opts) {
  return colorPickerMenu(anchor, { ...opts, mode: "single" });
}
function colorPickerMenu(anchor, opts) {
  const t = opts.t || ((k) => k);
  const pair = opts.mode === "pair";
  const alphaOn = opts.alpha === true && !pair;
  let alpha = parseAlpha(typeof opts.current === "string" ? opts.current : opts.current && opts.current.background);
  document.querySelectorAll(".lattice-hcolor-menu").forEach((m) => m.remove());
  const menu = el("div.lattice-menu.lattice-hcolor-menu");
  menu.appendChild(el("div.lattice-summary-menu-head", { text: opts.title || t("headerColor.title") }));
  const fin = (color) => alphaOn && alpha < 1 ? toRgba(color, alpha) : color;
  const finalize = (color, fg, record) => {
    if (record !== false) rememberColor(color);
    if (pair) opts.onPick(color, fg);
    else opts.onPick(color);
    close();
  };
  const emit = (color) => {
    if (pair) finalize(color, contrastFg(color));
    else finalize(fin(color));
  };
  const tabWheel = el("button.lattice-hcolor-tab.is-active", { type: "button", text: t("headerColor.tabWheel") });
  const tabPal = el("button.lattice-hcolor-tab", { type: "button", text: t("headerColor.tabPalette") });
  menu.appendChild(el("div.lattice-hcolor-tabs", {}, [tabWheel, tabPal]));
  const wheelPane = el("div.lattice-hcolor-pane");
  const wheel = buildWheel(196, (hex) => emit(hex));
  const bright = el("input.lattice-hcolor-bright", { type: "range", min: "20", max: "100", value: "100" });
  bright.addEventListener("input", () => wheel.setValue(+bright.value / 100));
  wheelPane.append(wheel.el, el("label.lattice-hcolor-brightrow", {}, [
    el("span", { text: t("headerColor.brightness") }),
    bright
  ]));
  menu.appendChild(wheelPane);
  const palPane = el("div.lattice-hcolor-pane", { style: { display: "none" } });
  const grid = el("div.lattice-hcolor-grid");
  for (const p of HEADER_COLOR_PRESETS) {
    const sw = el("button.lattice-hcolor-swatch", { type: "button", title: p.label, style: { background: p.bg, color: pair ? p.fg : p.bg }, text: pair ? "Aa" : "" });
    sw.addEventListener("click", () => {
      pair ? finalize(p.bg, p.fg, false) : finalize(fin(p.bg), null, false);
    });
    grid.appendChild(sw);
  }
  palPane.appendChild(grid);
  const cur = opts.current || {};
  if (pair) {
    const bgIn = el("input.lattice-hcolor-input", { type: "color", value: normHex(cur.background) || "#0d6efd" });
    const fgIn = el("input.lattice-hcolor-input", { type: "color", value: normHex(cur.color) || "#ffffff" });
    const apply = el("button.lattice-hcolor-apply", { type: "button", text: t("headerColor.apply") });
    apply.addEventListener("click", () => finalize(bgIn.value, fgIn.value));
    palPane.appendChild(el("div.lattice-hcolor-custom", {}, [
      el("span.lattice-hcolor-lbl", { text: t("headerColor.custom") }),
      el("label.lattice-hcolor-field", {}, [el("span", { text: t("headerColor.bg") }), bgIn]),
      el("label.lattice-hcolor-field", {}, [el("span", { text: t("headerColor.text") }), fgIn]),
      apply
    ]));
  } else {
    const inp = el("input.lattice-hcolor-input", { type: "color", value: normHex(typeof cur === "string" ? cur : cur.background) || "#0d6efd" });
    const apply = el("button.lattice-hcolor-apply", { type: "button", text: t("headerColor.apply") });
    apply.addEventListener("click", () => finalize(fin(inp.value)));
    palPane.appendChild(el("div.lattice-hcolor-custom", {}, [
      el("span.lattice-hcolor-lbl", { text: t("headerColor.custom") }),
      el("label.lattice-hcolor-field", {}, [inp]),
      apply
    ]));
  }
  menu.appendChild(palPane);
  if (alphaOn) {
    const av = el("input.lattice-hcolor-bright", { type: "range", min: "0", max: "100", value: String(Math.round(alpha * 100)) });
    av.addEventListener("input", () => {
      alpha = +av.value / 100;
    });
    menu.appendChild(el("label.lattice-hcolor-brightrow", {}, [
      el("span", { text: t("headerColor.alpha") }),
      av
    ]));
  }
  const swap = (toPal) => {
    tabPal.classList.toggle("is-active", toPal);
    tabWheel.classList.toggle("is-active", !toPal);
    palPane.style.display = toPal ? "" : "none";
    wheelPane.style.display = toPal ? "none" : "";
  };
  tabWheel.addEventListener("click", () => swap(false));
  tabPal.addEventListener("click", () => swap(true));
  const recents = loadRecents();
  if (recents.length) {
    menu.appendChild(el("div.lattice-hcolor-recents-lbl", { text: t("headerColor.recent") }));
    const rWrap = el("div.lattice-hcolor-recents");
    for (const c of recents) {
      const sw = el("button.lattice-hcolor-recent", { type: "button", title: c, style: { background: c } });
      sw.addEventListener("click", () => {
        if (pair) finalize(c, contrastFg(c));
        else finalize(c);
      });
      rWrap.appendChild(sw);
    }
    menu.appendChild(rWrap);
  }
  const clearBtn = el("button.lattice-hcolor-clear", { type: "button", text: t("headerColor.none") });
  clearBtn.addEventListener("click", () => {
    opts.onClear();
    close();
  });
  menu.appendChild(clearBtn);
  document.body.appendChild(menu);
  placeUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function buildWheel(size, onPick) {
  const R = 6;
  const hexR = size / (2 * (1.5 * R + 1));
  const cx = size / 2, cy = size / 2;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + size + " " + size);
  svg.setAttribute("class", "lattice-hcolor-wheel");
  svg.style.width = size + "px";
  svg.style.height = size + "px";
  let value = 1;
  const cells = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const px = cx + hexR * 1.5 * q;
      const py = cy + hexR * Math.sqrt(3) * (r + q / 2);
      const sat = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 / R;
      const hue = (Math.atan2(py - cy, px - cx) * 180 / Math.PI + 360) % 360;
      const poly = document.createElementNS(NS, "polygon");
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 180 * (60 * k);
        pts.push((px + hexR * Math.cos(a)).toFixed(1) + "," + (py + hexR * Math.sin(a)).toFixed(1));
      }
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("class", "lattice-hcolor-hex");
      poly.addEventListener("click", () => onPick(colorOf(hue, sat, value)));
      svg.appendChild(poly);
      cells.push({ poly, hue, sat });
    }
  }
  const paint = () => {
    for (const c of cells) c.poly.setAttribute("fill", colorOf(c.hue, c.sat, value));
  };
  paint();
  return { el: svg, setValue(v) {
    value = v;
    paint();
  } };
}
function colorOf(hue, sat, val) {
  const [r, g, b] = hsvToRgb(hue, sat, val);
  return rgbToHex(r, g, b);
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function toRgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(2)})`;
}
function parseAlpha(v) {
  if (typeof v !== "string") return 1;
  const m = v.match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/i);
  return m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 1;
}
function hexToRgb(hex) {
  const h = normHex(hex) || "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function rgbFromAny(c) {
  if (typeof c === "string") {
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const p = m[1].split(",").map((x) => parseFloat(x));
      return [p[0] || 0, p[1] || 0, p[2] || 0];
    }
  }
  return hexToRgb(c);
}
function contrastFg(color) {
  const [r, g, b] = rgbFromAny(color);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
}
var RECENT_KEY = "lattice:recent-colors";
var RECENT_MAX = 12;
function loadRecents() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(a) ? a.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function rememberColor(c) {
  if (!c || typeof c !== "string") return;
  try {
    const a = loadRecents().filter((x) => x.toLowerCase() !== c.toLowerCase());
    a.unshift(c);
    localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX)));
  } catch {
  }
}
function placeUnder(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.top = window.scrollY + r.bottom + 4 + "px";
  const left = window.scrollX + Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = Math.max(8, left) + "px";
}
function normHex(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h.toLowerCase();
}

// src/version.js
var VERSION = "1.16.1";
var HOMEPAGE = "https://lattice.rudolfsvatek.cz/";
var HELP_URL = HOMEPAGE + "prirucka/";
var DEMO_URL = HOMEPAGE + "demo/";
var GITHUB_URL = "https://github.com/svatekr70/lattice";
var AUTHOR = "Rudolf Sv\xE1tek";
var LICENSE = "MIT";

// src/releases.js
var RELEASES = [
  {
    "version": "1.16.1",
    "date": "2026-08-21",
    "text": "Oprava \u0161\xED\u0159ky vedouc\xEDch sloupc\u016F seskupen\xED. Beze zm\u011Bny chov\xE1n\xED zbytku knihovny.",
    "items": [
      "Sloupci, podle kter\xE9ho jsou seskupen\xE9 \u0159\xE1dky, ne\u0161la m\u011Bnit \u0161\xED\u0159ka. Vedouc\xED sloupec seskupen\xED je syntetick\xFD a vznik\xE1 znovu p\u0159i ka\u017Ed\xE9m p\u0159ekreslen\xED, tak\u017Ee \u0161\xED\u0159ka zapsan\xE1 na objekt sloupce se okam\u017Eit\u011B\u2026"
    ]
  },
  {
    "version": "1.16.0",
    "date": "2026-08-21",
    "text": 'V\xFDb\u011Br \u0159\xE1dk\u016F d\u011Bl\xE1 to, co slibuje: volby v menu rovnou vyb\xEDraj\xED, \u201EV\u0161echny z\xE1znamy" berou opravdu v\u0161echny filtrovan\xE9 z\xE1znamy (i nezobrazen\xE9 str\xE1nky) a po\u010Dty v popisc\xEDch sed\xED. Bez breaking changes.',
    "items": [
      'Volby \u201EStr\xE1nka" a \u201EV\u0161echny z\xE1znamy" nic nevybraly. Jen p\u0159ep\xEDnaly rozsah pro hlavi\u010Dkov\xFD checkbox, tak\u017Ee po kliknut\xED se navenek nestalo nic. Nov\u011B rovnou vyb\xEDraj\xED (selectPage() / selectAllRecords()) a\u2026',
      '\u201EV\u0161echny z\xE1znamy" vyb\xEDraly jen na\u010Dtenou str\xE1nku. Server-side grid nezn\xE1 kl\xED\u010De nezobrazen\xFDch str\xE1nek, tak\u017Ee volba vybrala 50 \u0159\xE1dk\u016F a v popisku ukazovala \u201E(50)", i kdy\u017E filtru odpov\xEDdalo 365 z\xE1znam\u016F.\u2026',
      'Popisek \u201EV\u0161echny z\xE1znamy (N)" ukazoval po\u010Det na\u010Dten\xFDch \u0159\xE1dk\u016F. Server-side bere N z total \u2014 tedy po\u010Det v\u0161ech filtrovan\xFDch z\xE1znam\u016F (365), ne velikost str\xE1nky.',
      'Popisek \u201EStr\xE1nka (N)" \u2014 kolik \u0159\xE1dk\u016F je opravdu na aktu\xE1ln\xED str\xE1nce (na posledn\xED jich b\xFDv\xE1 m\xED\u0148 ne\u017E pageSize). Nov\xE9 metody pageCount(), selectedCount(), getSelection().',
      '\u0160ipka \u201Erozsah a mo\u017Enosti v\xFDb\u011Bru" u hlavi\u010Dkov\xE9ho checkboxu je vid\u011Bt \u2014 m\xEDsto nen\xE1padn\xE9 te\u010Dky je to chevron 12 px s hover stavem (podbarven\xED + r\xE1me\u010Dek), tak\u017Ee je poznat, \u017Ee se tam n\u011Bco rozbaluje.'
    ]
  },
  {
    "version": "1.15.0",
    "date": "2026-08-21",
    "text": 'Verze knihovny na o\u010D\xEDch: v pati\u010Dce gridu a v nov\xE9 z\xE1lo\u017Ece \u201EO Lattice" v nastaven\xED, kde je i changelog \u2014 co kter\xE9 vyd\xE1n\xED p\u0159ineslo. Bez breaking changes.',
    "items": [
      'Verze knihovny v pati\u010Dce gridu \u2014 Lattice x.y.z pod \u201EZobrazeno X-Y z N" (schv\xE1ln\u011B tam, aby neodsunula str\xE1nkov\xE1n\xED z m\xEDsta, na kter\xE9 jsou u\u017Eivatel\xE9 zvykl\xED). A\u0165 je hned vid\u011Bt, s jakou verz\xED u\u017Eivatel\u2026',
      'Nastaven\xED tabulky \u2192 z\xE1lo\u017Eka \u201EO Lattice" \u2014 co Lattice je, autor a licence, odkazy (u\u017Eivatelsk\xE1 p\u0159\xEDru\u010Dka podle options.helpUrl, uk\xE1zky a dokumentace, GitHub) a changelog p\u0159\xEDmo v tabulce: seznam vyd\xE1n\xED\u2026',
      'instance.showVersion (v\xFDchoz\xED true) \u2014 p\u0159ep\xEDna\u010D \u201EVerze knihovny v pati\u010Dce" v *Nastaven\xED tabulky \u2192 Vzhled*; persistuje se a nese se i v presetu. Aplikace m\u016F\u017Ee verzi zak\xE1zat natvrdo p\u0159es features: {\u2026',
      'npm run releases \u2014 vygeneruje src/releases.js (seznam vyd\xE1n\xED pro z\xE1lo\u017Eku \u201EO Lattice") z CHANGELOG.md; test hl\xEDd\xE1, \u017Ee nejnov\u011Bj\u0161\xED polo\u017Eka odpov\xEDd\xE1 VERSION.',
      "Export metadat \u2014 VERSION, HOMEPAGE, HELP_URL, DEMO_URL, GITHUB_URL, AUTHOR, LICENSE z src/version.js (jedin\xFD zdroj pravdy; test hl\xEDd\xE1 shodu VERSION s package.json).",
      'Dialog \u201ENastaven\xED tabulky" je \u0161ir\u0161\xED (880 px), a\u0165 se \u0159ada z\xE1lo\u017Eek v\u010Detn\u011B \u201EO Lattice" vejde na jeden \u0159\xE1dek.'
    ]
  },
  {
    "version": "1.14.0",
    "date": "2026-08-21",
    "text": "Ulo\u017Een\xE9 pohledy pod jednou st\u0159echou: preset se d\xE1 vystavit jako tla\u010D\xEDtko stejn\u011B jako ulo\u017Een\xFD filtr a nov\u011B si u oboj\xEDho vyb\xEDr\xE1\u0161, jestli m\xE1 b\xFDt tla\u010D\xEDtko, v\xFDb\u011Br, nebo oboj\xED. V z\xE1hlav\xED je poznat, co je co, bez popisk\u016F. Bez breaking changes.",
    "items": [
      'Preset jako tla\u010D\xEDtko / ve v\xFDb\u011Bru. V panelu preset\u016F (\u201ESloupce") jsou vedle pole s n\xE1zvem za\u0161krt\xE1v\xE1tka tla\u010D\xEDtko a v\xFDb\u011Br; u ka\u017Ed\xE9ho u\u017E ulo\u017Een\xE9ho presetu jsou tyt\xE9\u017E dva p\u0159ep\xEDna\u010De p\u0159\xEDmo v jeho \u0159\xE1dku,\u2026',
      "Tla\u010D\xEDtka rozli\u0161uj\xED \u010Dty\u0159i druhy polo\u017Eek \u2014 glob\xE1ln\xED/lok\xE1ln\xED preset a glob\xE1ln\xED/lok\xE1ln\xED filtr \u2014 a nezaberou kv\u016Fli tomu v\xEDc m\xEDsta: ikona = druh (z\xE1lo\u017Eka = preset, trycht\xFD\u0159 = filtr), barva = rozsah (\u0161ed\xE1\u2026",
      "Rozm\xEDst\u011Bn\xED v z\xE1hlav\xED: tla\u010D\xEDtka ulo\u017Een\xFDch filtr\u016F jsou v \u0159ad\u011B ikon hned vlevo od filtra\u010Dn\xEDch ikon, tla\u010D\xEDtka preset\u016F o \u0159\xE1dek v\xFD\u0161 \u2014 bez presetu jako tla\u010D\xEDtka se ten \u0159\xE1dek v\u016Fbec nevykresl\xED a z\xE1hlav\xED\u2026",
      'Volba \u201Ejako v\xFDb\u011Br" u ulo\u017Een\xFDch filtr\u016F (panel roz\u0161\xED\u0159en\xE9ho filtru i \u201EUlo\u017Eit sloupcov\xE9 filtry"). V toolbaru jsou vedle sebe dva v\xFDb\u011Bry: vlevo \u201E\u2014 ulo\u017Een\xE9 filtry \u2014", vpravo \u201E\u2014 pohledy \u2014" (ka\u017Ed\xFD jen kdy\u017E\u2026',
      'Druh\xFD klik na tla\u010D\xEDtko presetu vr\xE1t\xED v\xFDchoz\xED zobrazen\xED. Preset se tak p\u0159ep\xEDn\xE1 stejn\u011B jako ulo\u017Een\xFD filtr. \u201EV\xFDchoz\xED zobrazen\xED" = sloupce a nastaven\xED tabulky jako po startu bez presetu; filtry, \u0159azen\xED\u2026',
      'Spr\xE1va ulo\u017Een\xFDch polo\u017Eek rovnou z rychl\xE9 \u0159ady. Prav\xFD klik na pilulku otev\u0159e menu: pou\u017E\xEDt / vypnout, Upravit\u2026 (otev\u0159e p\u0159\xEDslu\u0161n\xFD panel s na\u010Dten\xFDm filtrem, resp. panel \u201ESloupce" u presetu), Zobrazit\u2026',
      'Panel \u201EUlo\u017Een\xE9 filtry" (ikona trycht\xFD\u0159 + disketa) je te\u010F i spr\xE1vcem: v seznamu jsou v\u0161echny ulo\u017Een\xE9 filtry (sn\xEDmky sloupcov\xFDch filtr\u016F i stromy z roz\u0161\xED\u0159en\xE9ho filtru). U ka\u017Ed\xE9ho: klik na n\xE1zev ho\u2026',
      "API: grid.overwriteSavedFilter(id) a grid.renameSavedFilter(id, name).",
      "API: grid.togglePreset(preset), grid.resetView(), grid.setAdvancedDisplay(id, key, on), grid.buttonPresets() / grid.selectPresets() / grid.selectAdvanced(), presets.saveLocal(name, parts, display) /\u2026",
      'Preset\u016Fm se v UI \u0159\xEDk\xE1 \u201Epohledy". V\u0161echny u\u017Eivatelsk\xE9 texty (panel v dialogu \u201ESloupce", tooltipy, placeholder v\xFDb\u011Bru \u2014 pohledy \u2014) mluv\xED o pohledech; v API a dokumentaci pro v\xFDvoj\xE1\u0159e z\u016Fst\xE1v\xE1 preset\u2026',
      "saveAdvanced(name, tree, scope, display) a saveFilterSnapshot(name, scope, display) berou m\xEDsto booleanu asButton objekt { button, select }. Legacy boolean funguje d\xE1l se stejn\xFDm v\xFDznamem jako dosud\u2026",
      "Ulo\u017Een\xED preset se stejn\xFDm n\xE1zvem zachov\xE1 id (jako u filtr\u016F), tak\u017Ee downstream upsert v aplikaci p\u0159ep\xED\u0161e tent\xFD\u017E \u0159\xE1dek m\xEDsto zakl\xE1d\xE1n\xED nov\xE9ho."
    ]
  },
  {
    "version": "1.13.1",
    "date": "2026-08-20",
    "text": "Oprava instala\u010Dn\xEDch instrukc\xED. Beze zm\u011Bny k\xF3du knihovny.",
    "items": [
      "npm i lattice instaloval ciz\xED bal\xED\u010Dek. Jm\xE9no lattice na npmjs.com pat\u0159\xED jin\xE9mu projektu (openlattice/lattice-js) \u2014 kdo se \u0159\xEDdil dokumentac\xED, st\xE1hl si n\u011Bco \xFApln\u011B jin\xE9ho. Nap\u0159\xED\u010D README, API\u2026",
      "Zastaral\xFD p\u0159\xEDklad tagu. README i dokumentace v demu radily p\u0159ipnout @v0.1.0.",
      "package.json m\xE1 private: true \u2014 pojistka proti publikaci pod ciz\xEDm jm\xE9nem. Na instalaci z GitHubu to nem\xE1 vliv."
    ]
  },
  {
    "version": "1.13.0",
    "date": "2026-08-20",
    "text": "Presety si pamatuj\xED i nastaven\xED tabulky \u2014 seskupen\xED \u0159\xE1dk\u016F, souhrnn\xFD \u0159\xE1dek a mezisou\u010Dty skupin \u2014 a u ukl\xE1d\xE1n\xED se d\xE1 za\u0161krtnout, kter\xE9 \u010D\xE1sti preset ponese. Bez breaking changes.",
    "items": [
      "Preset nese nastaven\xED tabulky. captureState() nov\u011B ukl\xE1d\xE1 i celou instance, tak\u017Ee lok\xE1ln\xED i glob\xE1ln\xED preset obnov\xED seskupen\xED \u0159\xE1dk\u016F (groupBy, groupDisplay, groupRepeat), souhrnn\xFD \u0159\xE1dek (summaryRow),\u2026",
      'Volba, co se do presetu ulo\u017E\xED. V panelu preset\u016F jsou nad polem s n\xE1zvem t\u0159i za\u0161krt\xE1v\xE1tka \u2014 Sloupce, Filtry a \u0159azen\xED, Nastaven\xED tabulky. U\u017Eivatel si tak ulo\u017E\xED t\u0159eba preset \u201Ejen filtry" nebo \u201Ejen\u2026',
      "captureState(parts) \u2014 {columns, filters, instance} vyb\xEDr\xE1, co sn\xEDmek zachyt\xED (bez argumentu v\u0161e). Props\xE1no i do presets.saveLocal(name, parts) / saveGlobal(name, parts).",
      "captureInstance() \u2014 ve\u0159ejn\xFD sn\xEDmek nastaven\xED tabulky (pou\u017E\xEDv\xE1 ho preset i glob\xE1ln\xED v\xFDchoz\xED nastaven\xED).",
      "presetContents(preset) \u2014 kter\xE9 \u010D\xE1sti preset nese (pro UI a aplikaci).",
      "applyPreset() m\u011Bn\xED jen to, co sn\xEDmek obsahuje. Chyb\u011Bj\xEDc\xED \u010D\xE1st z\u016Fstane, jak ji u\u017Eivatel m\xE1 \u2014 d\xEDky tomu funguj\xED \u010D\xE1ste\u010Dn\xE9 presety i star\xE9 presety bez instance.",
      "Snapshot je hlubok\xE1 kopie. instance v presetu i v glob\xE1ln\xEDch v\xFDchoz\xEDch se kop\xEDruje do hloubky \u2014 pozd\u011Bj\u0161\xED zm\u011Bna cssVars / format / groupBy u\u017E ulo\u017Een\xFD sn\xEDmek nep\u0159ep\xED\u0161e.",
      "Sbalen\xED extern\xEDho filtra\u010Dn\xEDho panelu se nesd\xEDl\xED. externalFiltersCollapsed je p\u0159echodn\xFD stav UI, ne nastaven\xED: do presetu ani do glob\xE1ln\xEDch v\xFDchoz\xEDch nepat\u0159\xED a p\u0159i jejich pou\u017Eit\xED z\u016Fstane u\u017Eivateli\u2026",
      '\u201EObnovit v\xFDchoz\xED" v dialogu \u201ESloupce" ru\u0161\xED i seskupen\xED \u0159\xE1dk\u016F. Seskupen\xED se zap\xEDn\xE1 v tomt\xE9\u017E dialogu u sloupce a sloupce p\u0159eskupuje (seskupen\xFD sloupec se st\u011Bhuje dop\u0159edu a ukotv\xED se), tak\u017Ee reset,\u2026',
      'Dialog \u201ESloupce" neute\u010De pod spodn\xED hranu okna. Panel se otev\xEDral v\u017Edycky pod kotv\xEDc\xEDm tla\u010D\xEDtkem bez ohledu na to, kolik m\xEDsta pod n\xEDm zb\xFDv\xE1 \u2014 u dlouh\xE9ho seznamu sloupc\u016F, n\xEDzko posazen\xE9ho toolbaru\u2026',
      'Dialog \u201ESloupce" u\u017E neodskakuje. Preset s nastaven\xEDm tabulky p\u0159ekresl\xED toolbar, tak\u017Ee kotv\xEDc\xED tla\u010D\xEDtko dialogu zmiz\xED \u2014 panel se d\u0159\xEDv p\u0159epo\u010D\xEDtal z nulov\xE9ho rectu a skon\u010Dil v lev\xE9m horn\xEDm rohu. Te\u010F se\u2026',
      "Star\xFD preset (bez state.instance) nastaven\xED tabulky nem\u011Bn\xED. Pou\u017Eije se z n\u011Bj jen po\u0159ad\xED/viditelnost sloupc\u016F, \u0159azen\xED a filtry \u2014 seskupen\xED, souhrny ani motiv u\u017Eivateli nezmiz\xED. instance za\u010Dne n\xE9st po\u2026"
    ]
  },
  {
    "version": "1.12.0",
    "date": "2026-08-12",
    "text": "Dynamick\xE9 obdob\xED nap\u0159\xED\u010D filtry \u2014 hranice t\xFDdne/m\u011Bs\xEDce/kvart\xE1lu/roku, na\u0161ept\xE1va\u010D a \u017Eiv\xE9 presety v kalend\xE1\u0159i. Bez breaking changes.",
    "items": [
      "Tokeny pro hranice obdob\xED. K today/now p\u0159ibyly sow/eow (za\u010D\xE1tek/konec t\xFDdne, Po\u2013Ne), som/eom (m\u011Bs\xEDc), soq/eoq (kvart\xE1l), soy/eoy (rok) \u2014 s voliteln\xFDm offsetem (sow-1w, eom-1m, \u2026). Offset se aplikuje\u2026",
      'Na\u0161ept\xE1va\u010D u dynamick\xE9ho filtru. U pole je tla\u010D\xEDtko \u201E?" s hotov\xFDmi obdob\xEDmi (Dnes, Minul\xFD t\xFDden, Tento m\u011Bs\xEDc\u2026) \u2014 klik v\xFDraz vypln\xED a rovnou aplikuje; plus stru\u010Dn\xE1 reference z\xE1pisu.',
      `Dynamick\xE1 obdob\xED v date-range pickeru. P\u0159ep\xEDna\u010D \u201Edynamick\xE9 obdob\xED" v dialogu: zapnut\xFD \u2192 klik na preset ulo\u017E\xED token ({from:'sow-1w', to:'eow-1w'}) m\xEDsto pevn\xFDch dat, tak\u017Ee ulo\u017Een\xFD filtr/preset/sn\xEDmek\u2026`,
      "Demo, p\u0159\xEDru\u010Dka a API dokumentace dopln\u011Bny o hranice obdob\xED, na\u0161ept\xE1va\u010D a dynamick\xE9 date-range presety."
    ]
  },
  {
    "version": "1.11.0",
    "date": "2026-08-12",
    "text": 'Dynamick\xFD datumov\xFD filtr a ukl\xE1d\xE1n\xED \u201Enaklikan\xFDch" sloupcov\xFDch filtr\u016F. Bez breaking changes.',
    "items": [
      'Filtr sloupce \u2013 \u201EDynamick\xE9" (u datumov\xFDch sloupc\u016F). T\u0159et\xED typ vedle \u201EDatum (rozsah)" a \u201EDatum (Od / Do)": do jednoho pole se nap\xED\u0161e vlastn\xED v\xFDraz s oper\xE1tory > < >= <= =, spojkami AND/OR (AND v\xE1\u017Ee\u2026',
      'Ulo\u017Een\xED \u201Enaklikan\xFDch" sloupcov\xFDch filtr\u016F (sn\xEDmek). Nov\xE1 ikona v toolbaru (trycht\xFD\u0159 + disketa, viditeln\xE1 jen kdy\u017E n\u011Bjak\xFD sloupcov\xFD filtr plat\xED) ulo\u017E\xED aktu\xE1ln\xED filtry z hlavi\u010Dky pod n\xE1zvem \u2014 lok\xE1ln\u011B\u2026',
      'Sjednocen\xED velikosti filtr ikon. Trycht\xFD\u0159e \u201Eulo\u017Eit filtry" a \u201Eroz\u0161\xED\u0159en\xFD filtr" m\u011Bly men\u0161\xED tvar; srovn\xE1ny na stejn\xFD jako \u201Ezru\u0161it filtry".',
      "Demo + p\u0159\xEDru\u010Dka + API dokumentace dopln\u011Bny o ob\u011B novinky (dynamick\xFD filtr, sn\xEDmky) a o u\u017Eivatelsk\xE9 glob\xE1ln\xED presety."
    ]
  },
  {
    "version": "1.10.0",
    "date": "2026-08-12",
    "text": "Ulo\u017Een\xE9 roz\u0161\xED\u0159en\xE9 filtry lze zobrazit jako tla\u010D\xEDtka. Bez breaking changes.",
    "items": [
      'Roz\u0161\xED\u0159en\xFD filtr \u2013 \u201Ejako tla\u010D\xEDtko". U ulo\u017Een\xE9ho filtru (lok\xE1ln\xEDho i glob\xE1ln\xEDho) lze za\u0161krtnout, \u017Ee se m\xE1 vykreslit jako tla\u010D\xEDtko v \u0159ad\u011B nad ikonami v prav\xE9m z\xE1hlav\xED tabulky, m\xEDsto polo\u017Eky v\u2026'
    ]
  },
  {
    "version": "1.9.0",
    "date": "2026-08-08",
    "text": "Opravn\xFD release z hloubkov\xE9ho auditu \u2014 spr\xE1vnost nap\u0159\xED\u010D vzorci, filtry, v\xFDb\u011Brem, \u0159azen\xEDm a exportem. Bez breaking changes.",
    "items": [
      'Vzorce \u2013 porovn\xE1n\xED datum\u016F. num() parsovalo "2024-03-15" p\u0159es parseFloat na 2024 (rok) a today()/now() vrac\xED epoch ms \u2192 [termin] < today() bylo v\u017Edy pravda a [start] < [konec] porovn\xE1valo jen roky.\u2026',
      "Roz\u0161\xED\u0159en\xFD filtr \u2013 pr\xE1zdn\xE1 podskupina pod OR. Pr\xE1zdn\xE1/nedokon\u010Den\xE1 podskupina vracela true a pod OR rodi\u010Dem propustila v\u0161echny \u0159\xE1dky. Nyn\xED se ne\xFA\u010Dinn\xE9 podskupiny a podm\xEDnky bez oper\xE1toru ignoruj\xED\u2026",
      'Roz\u0161\xED\u0159en\xFD filtr \u2013 pr\xE1zdn\xE9 pole a lt/lte/gt/gte. Pr\xE1zdn\xE9/chyb\u011Bj\xEDc\xED pole se \u0159adilo jako \u201Emen\u0161\xED ne\u017E cokoli" a splnilo lt/lte. Nov\u011B pr\xE1zdn\xE9 pole \u017E\xE1dn\xE9 ordering nespln\xED.',
      "Roz\u0161\xED\u0159en\xFD filtr \u2013 relativn\xED tokeny today\xB1Nm/y. P\u0159et\xE9kaly na konci m\u011Bs\xEDce (31.1 + 1m \u2192 3.3. m\xEDsto 28.2.). Nov\u011B se den o\u0159\xEDzne na posledn\xED den c\xEDlov\xE9ho m\u011Bs\xEDce.",
      "Progresivn\xED na\u010D\xEDt\xE1n\xED \u2013 race. loadMore() nem\u011Bl request-id guard; opo\u017Ed\u011Bn\xE1 odpov\u011B\u010F mohla p\u0159isypat star\xE9 \u0159\xE1dky na akumul\xE1tor resetovan\xFD soub\u011B\u017En\xFDm refresh(). Dopln\u011Bn stejn\xFD token jako v refresh().",
      "Nastaven\xED \u2013 pageSize p\u0159es setInstance(). setInstance({ pageSize }) nesynchronizoval this.pageSize (\u010Dte ho refresh()/pager) \u2192 zm\u011Bna se projevila a\u017E po reloadu. Nyn\xED synchronizuje.",
      "V\xFDb\u011Br rozsahu vs. p\u0159ipnut\xE9 \u0159\xE1dky. P\u0159ipnut\xE9 \u0159\xE1dky maj\xED string index ('pt0'); klik na n\u011B ukl\xE1dal do _lastSelIdx string a rozbil n\xE1sledn\xFD shift-v\xFDb\u011Br na norm\xE1ln\xEDch \u0159\xE1dc\xEDch. O\u0161et\u0159eno (mimo v\xFDb\u011Br\u2026",
      "Fulltext hled\xE1n\xED. Pole se spojovala bez odd\u011Blova\u010De (join('')) \u2192 hledan\xFD v\xFDraz p\u0159es hranici dvou pol\xED fale\u0161n\u011B matchoval. Vlo\u017Eeno odd\u011Blen\xED pol\xED.",
      "Datumov\xE9 seskupen\xED / date-only. YYYY-MM-DD se parsovalo jako UTC a lok\xE1ln\xED getter posunul den v z\xE1porn\xE9m UTC p\xE1smu; nov\u011B se parsuje lok\xE1ln\u011B.",
      'Preset marker. Sloupcov\xE9 settery (\u0161\xED\u0159ka, barva, form\xE1t, titulek, souhrn, oto\u010Den\xED, filtr\u2026) i autoFit neru\u0161ily \u201Eaktivn\xED preset" \u2192 marker visel i po odchylce. Dopln\u011Bno ru\u0161en\xED presetu.',
      "Nastaven\xED sloupc\u016F (\u2699). Klik na n\xE1zev sloupce skryl/zobrazil sloupec, ale checkbox v panelu se neobnovil (setColumnVisible te\u010F vol\xE1 gear.refresh()).",
      "Responsive. Vypnut\xE9 \u010D\xEDslov\xE1n\xED \u0159\xE1dk\u016F (rowNumbers: 'none', truthy) rezervovalo 44 px nav\xEDc."
    ]
  },
  {
    "version": "1.8.1",
    "date": "2026-08-05",
    "text": 'P\u0159ep\xEDna\u010D \u201EZv\xFDrazn\u011Bn\xED \u0159\xE1dku klikem" v UI (Nastaven\xED tabulky \u2699 \u2192 *Sloupce a \u0159\xE1dky*) \u2014 instance.rowHighlight (z v1.8.0) \u0161el dote\u010F zapnout jen k\xF3dem',
    "items": [
      'P\u0159ep\xEDna\u010D \u201EZv\xFDrazn\u011Bn\xED \u0159\xE1dku klikem" v UI (Nastaven\xED tabulky \u2699 \u2192 *Sloupce a \u0159\xE1dky*) \u2014 instance.rowHighlight (z v1.8.0) \u0161el dote\u010F zapnout jen k\xF3dem. Nov\u011B ho u\u017Eivatel zapne/vypne p\u0159\xEDmo z dialogu\u2026'
    ]
  },
  {
    "version": "1.8.0",
    "date": "2026-08-05",
    "text": "Per-sloupcov\xE9 zalamov\xE1n\xED textu \u2014 column.wrap \xB7 Zv\xFDrazn\u011Bn\xED (podbarven\xED) \u0159\xE1dk\u016F \u2014 nativn\xED feature + API \xB7 Server-side: expozice aktu\xE1ln\xEDch serverov\xFDch parametr\u016F \u2014 grid.getServerParams({ paginate? }) a grid.getServerQuery({ paginate? }) \xB7 docs/API.md \u2014 col.wrap,\u2026",
    "items": [
      "Per-sloupcov\xE9 zalamov\xE1n\xED textu \u2014 column.wrap. Dote\u010F \u0161lo zalamovat jen glob\xE1ln\u011B (instance.wrapText). Nov\u011B col.wrap: true zalom\xED jen dan\xFD sloupec (i p\u0159i vypnut\xE9m glob\xE1lu), col.wrap: false naopak\u2026",
      "Zv\xFDrazn\u011Bn\xED (podbarven\xED) \u0159\xE1dk\u016F \u2014 nativn\xED feature + API. \u017Dlut\xE9 (themeovateln\xE9) podbarven\xED \u0159\xE1dk\u016F nez\xE1visl\xE9 na v\xFDb\u011Bru checkboxy: - API: grid.highlightRow(id, on?), grid.toggleRowHighlight(id),\u2026",
      "Server-side: expozice aktu\xE1ln\xEDch serverov\xFDch parametr\u016F \u2014 grid.getServerParams({ paginate? }) a grid.getServerQuery({ paginate? }). Vr\xE1t\xED filtr/sort/search/advanced (dle paramNames, tokeny\u2026",
      'docs/API.md \u2014 col.wrap, sekce *Zv\xFDrazn\u011Bn\xED \u0159\xE1dk\u016F* (API, instance.rowHighlight, CSS prom\u011Bnn\xE9, UI picker), metody getServerParams/getServerQuery + p\u0159\xEDklad \u201Ev\u0161e filtrovan\xE9" / export.'
    ]
  },
  {
    "version": "1.7.0",
    "date": "2026-08-05",
    "text": 'Server-side re\u017Eim pos\xEDl\xE1 roz\u0161\xED\u0159en\xFD filtr (advanced) na backend nativn\u011B \u2014 stejn\u011B jako u\u017E pos\xEDl\xE1 sort/filter/search \xB7 D\u016Fsledek: glob\xE1ln\xED ulo\u017Een\xE9 roz\u0161\xED\u0159en\xE9 filtry na server-side gridech \u201Eprost\u011B funguj\xED" \u2014 jejich v\xFDb\u011Br jen nastav\xED grid.advanced a spust\xED refetch,\u2026',
    "items": [
      "Server-side re\u017Eim pos\xEDl\xE1 roz\u0161\xED\u0159en\xFD filtr (advanced) na backend nativn\u011B \u2014 stejn\u011B jako u\u017E pos\xEDl\xE1 sort/filter/search. Dote\u010F se advanced (strom AND/OR pravidel) v server-side nepos\xEDlal a aplikace to\u2026",
      'D\u016Fsledek: glob\xE1ln\xED ulo\u017Een\xE9 roz\u0161\xED\u0159en\xE9 filtry na server-side gridech \u201Eprost\u011B funguj\xED" \u2014 jejich v\xFDb\u011Br jen nastav\xED grid.advanced a spust\xED refetch, kter\xFD te\u010F nese parametr advanced.',
      "docs/API.md \u2014 sekce *Server-side re\u017Eim* dopln\u011Bna o parametr advanced (form\xE1t JSON, GET/POST, rozvinut\xE9 tokeny, resolveTokens, p\u0159\xEDklad payloadu a doporu\u010Den\xE9 zpracov\xE1n\xED na serveru); opravena d\u0159\xEDv\u011Bj\u0161\xED\u2026"
    ]
  },
  {
    "version": "1.6.2",
    "date": "2026-08-05",
    "text": "Rychl\xFD select ulo\u017Een\xFDch filtr\u016F v toolbaru (.lattice-adv-quick) o\u0159ez\xE1val n\xE1zev a nativn\xED chevron p\u0159ekr\xFDval posledn\xED znaky",
    "items": [
      "Rychl\xFD select ulo\u017Een\xFDch filtr\u016F v toolbaru (.lattice-adv-quick) o\u0159ez\xE1val n\xE1zev a nativn\xED chevron p\u0159ekr\xFDval posledn\xED znaky. Prav\xFD padding byl jen 6px, co\u017E je m\xE9n\u011B ne\u017E \u0161\xED\u0159ka chevronu \u2192 text se plazil\u2026"
    ]
  },
  {
    "version": "1.6.1",
    "date": "2026-08-05",
    "text": 'Panel roz\u0161\xED\u0159en\xE9ho filtru odskakoval do lev\xE9ho horn\xEDho rohu \xB7 \xDAnik \u201Eklik mimo" listeneru (onOutside) \xB7 P\u0159epis glob\xE1ln\xEDho filtru pod stejn\xFDm n\xE1zvem generoval nov\xE9 id p\u0159i ka\u017Ed\xE9m ulo\u017Een\xED \u2192 aplikace (perzistence kl\xED\u010Dovan\xE1 na id/ext_id) zakl\xE1dala nov\xFD DB \u0159\xE1dek a po\u2026',
    "items": [
      "Panel roz\u0161\xED\u0159en\xE9ho filtru odskakoval do lev\xE9ho horn\xEDho rohu. Po v\xFDb\u011Bru ulo\u017Een\xE9ho filtru (nebo jak\xE9koli akci p\u0159ekresluj\xEDc\xED toolbar) se toggle tla\u010D\xEDtko vytvo\u0159ilo znovu a panel se p\u0159epo\u010D\xEDtal proti\u2026",
      '\xDAnik \u201Eklik mimo" listeneru (onOutside). Listener se navazuje p\u0159es setTimeout(\u2026,0); kdy\u017E se panel zav\u0159el d\u0159\xEDv, ne\u017E timer stihl nav\xE1zat, disposer odebral je\u0161t\u011B neexistuj\xEDc\xED listener a timer ho pak\u2026',
      "P\u0159epis glob\xE1ln\xEDho filtru pod stejn\xFDm n\xE1zvem generoval nov\xE9 id p\u0159i ka\u017Ed\xE9m ulo\u017Een\xED \u2192 aplikace (perzistence kl\xED\u010Dovan\xE1 na id/ext_id) zakl\xE1dala nov\xFD DB \u0159\xE1dek a po reloadu vznikla duplicita. saveAdvanced\u2026",
      'P\u0159edvypln\u011Bn\xED n\xE1zvu v panelu roz\u0161\xED\u0159en\xE9ho filtru. Po v\xFDb\u011Bru ulo\u017Een\xE9ho filtru se jeho n\xE1zev zkop\xEDruje do pole \u201EN\xE1zev filtru"; p\u0159i otev\u0159en\xED panelu s aktivn\xEDm ulo\u017Een\xFDm filtrem se n\xE1zev p\u0159edvypln\xED hned.\u2026'
    ]
  },
  {
    "version": "1.6.0",
    "date": "2026-08-05",
    "text": 'Relativn\xED datov\xE9 tokeny v roz\u0161\xED\u0159en\xE9m filtru \u2014 v hodnot\u011B podm\xEDnky lze m\xEDsto pevn\xE9ho data napsat token, kter\xFD se dopo\u010D\xEDt\xE1 a\u017E p\u0159i ka\u017Ed\xE9m vyhodnocen\xED filtru (ulo\u017Een\xFD filtr tak \u201Eposouv\xE1 okno" s \u010Dasem, ide\xE1ln\xED pro glob\xE1ln\u011B sd\xEDlen\xE9 filtry): - today, today+14,\u2026',
    "items": [
      'Relativn\xED datov\xE9 tokeny v roz\u0161\xED\u0159en\xE9m filtru \u2014 v hodnot\u011B podm\xEDnky lze m\xEDsto pevn\xE9ho data napsat token, kter\xFD se dopo\u010D\xEDt\xE1 a\u017E p\u0159i ka\u017Ed\xE9m vyhodnocen\xED filtru (ulo\u017Een\xFD filtr tak \u201Eposouv\xE1 okno" s \u010Dasem,\u2026',
      'Dokumentace (docs/API.md), u\u017Eivatelsk\xE1 p\u0159\xEDru\u010Dka a demo uk\xE1zka \u201ERoz\u0161\xED\u0159en\xFD filtr" dopln\u011Bny o relativn\xED datum.'
    ]
  },
  {
    "version": "1.5.1",
    "date": "2026-08-03",
    "text": "docs/API.md \u2014 rozs\xE1hl\xE9 dopln\u011Bn\xED a opravy (jen dokumentace, chov\xE1n\xED knihovny beze zm\u011Bny): - Nov\xE1 sekce Server-side re\u017Eim (serverSide / ajax): pln\xFD objekt ajax (url, method, params, headers, paramNames, requestBuilder, responseParser), skl\xE1d\xE1n\xED ajax.params p\u0159i\u2026",
    "items": [
      "docs/API.md \u2014 rozs\xE1hl\xE9 dopln\u011Bn\xED a opravy (jen dokumentace, chov\xE1n\xED knihovny beze zm\u011Bny): - Nov\xE1 sekce Server-side re\u017Eim (serverSide / ajax): pln\xFD objekt ajax (url, method, params, headers,\u2026"
    ]
  },
  {
    "version": "1.5.0",
    "date": "2026-08-03",
    "text": "Glob\xE1ln\xED (sd\xEDlen\xE9) roz\u0161\xED\u0159en\xE9 filtry \u2014 ulo\u017Een\xE9 roz\u0161\xED\u0159en\xE9 filtry (strom pravidel) lze te\u010F ukl\xE1dat nejen lok\xE1ln\u011B (per-u\u017Eivatel, localStorage), ale i glob\xE1ln\u011B pro v\u0161echny",
    "items": [
      "Glob\xE1ln\xED (sd\xEDlen\xE9) roz\u0161\xED\u0159en\xE9 filtry \u2014 ulo\u017Een\xE9 roz\u0161\xED\u0159en\xE9 filtry (strom pravidel) lze te\u010F ukl\xE1dat nejen lok\xE1ln\u011B (per-u\u017Eivatel, localStorage), ale i glob\xE1ln\u011B pro v\u0161echny. Stejn\xFD vzor jako glob\xE1ln\xED\u2026"
    ]
  },
  {
    "version": "1.4.0",
    "date": "2026-08-02",
    "text": "Zalamov\xE1n\xED n\xE1zv\u016F sloupc\u016F (wrapHeader) \u2014 nez\xE1visl\xE9 na zalamov\xE1n\xED dat v bu\u0148k\xE1ch (wrapText)",
    "items": [
      "Zalamov\xE1n\xED n\xE1zv\u016F sloupc\u016F (wrapHeader) \u2014 nez\xE1visl\xE9 na zalamov\xE1n\xED dat v bu\u0148k\xE1ch (wrapText). Kdy\u017E je zapnut\xE9, auto-fit (dvojklik na odd\u011Blova\u010D) zm\u011B\u0159\xED \u0161\xED\u0159ku podle n\xE1zvu slo\u017Een\xE9ho do 2 \u0159\xE1dk\u016F (nikdy neu\u017E\u0161\xED\u2026"
    ]
  },
  {
    "version": "1.3.0",
    "date": "2026-08-01",
    "text": "Gener\xE1tor styl\u016F (demo/styler.html) \u2014 naklikateln\xFD vzhled: v\u0161echny theming prom\u011Bnn\xE9 --lattice-* (barvy s alfa kan\xE1lem, p\xEDsmo, tvary, rozestupy, okraje), \u017Eiv\xFD n\xE1hled a export hotov\xE9ho lattice-custom.css (ke sta\u017Een\xED i kop\xEDrov\xE1n\xED) v\u010D \xB7 Alfa kan\xE1l v color pickeru\u2026",
    "items": [
      "Gener\xE1tor styl\u016F (demo/styler.html) \u2014 naklikateln\xFD vzhled: v\u0161echny theming prom\u011Bnn\xE9 --lattice-* (barvy s alfa kan\xE1lem, p\xEDsmo, tvary, rozestupy, okraje), \u017Eiv\xFD n\xE1hled a export hotov\xE9ho\u2026",
      "Alfa kan\xE1l v color pickeru \u2014 openColorPicker m\xE1 nov\u011B voliteln\xFD jezdec pr\u016Fhlednosti (opts.alpha); vrac\xED pak rgba(...).",
      "Pam\u011B\u0165 naposledy pou\u017Eit\xFDch barev \u2014 picker si pamatuje posledn\xEDch 12 vlastn\xEDch barev (kolo/vlastn\xED vstup) a nab\xEDz\xED je k v\xFDb\u011Bru (persistov\xE1no v localStorage).",
      "Okraje sloupc\u016F v gener\xE1toru styl\u016F \u2014 barva i \u0161\xED\u0159ka pro oby\u010Dejn\xE9 svisl\xE9 linky (--lattice-cell-vborder-color/-width), hrany skupin (--lattice-group-border-width) a d\u011Bl\xEDc\xED linku ukotven\xFDch sloupc\u016F\u2026",
      "Spodn\xED okraje z\xE1hlav\xED \u2014 samostatn\xE1 barva i \u0161\xED\u0159ka pod \u0159\xE1dkem skupin (--lattice-group-border-bottom-*), pod \u0159\xE1dkem z\xE1hlav\xED (--lattice-header-border-*) a pod \u0159\xE1dkem filtr\u016F (--lattice-filter-border-*).",
      "Sidebar gener\xE1toru styl\u016F skl\xE1d\xE1 volby do 2 sloupc\u016F (dle \u0161\xED\u0159ky) \u2014 m\xE9n\u011B rolov\xE1n\xED.",
      'Palety v color pickeru nab\xEDzej\xED ob\u011B varianty Bootstrapu 5 \u2014 pln\xE9 (syt\xE1 barva + kontrastn\xED p\xEDsmo) i jemn\xE9 \u201Ealert" t\xF3ny (sv\u011Btl\xE9 pozad\xED + tmav\xFD text). 16 kombinac\xED.',
      'Nastaven\xED tabulky \u2014 \u201EBarvy \u0161k\xE1ly (semafor)" i barvy ve \u201EVlastn\xEDch \xFAprav\xE1ch" otev\xEDraj\xED \u0161esti\xFAheln\xEDkov\xFD picker (kolo + palety) m\xEDsto nativn\xEDho v\xFDb\u011Bru barvy.',
      "\u0160\xED\u0159ka/barva svisl\xFDch linek bun\u011Bk jde p\u0159epsat na \xFArovni gridu \u2014 --lattice-cell-vborder se u\u017E nedefinuje napevno v :root (vno\u0159en\xFD var() se vyhodnocoval moc brzy a p\u0159epis na potomkovi se neprojevil);\u2026",
      "Color picker se zobrazuje nad mod\xE1lem Nastaven\xED tabulky (d\u0159\xEDv se schoval pod n\u011Bj).",
      "Sbalen\xED skupin sloupc\u016F se persistuje i po reloadu \u2014 Store nov\u011B na\u010D\xEDt\xE1 kl\xED\u010D colGroups (dosud se ukl\xE1dal, ale p\u0159i na\u010Dten\xED se zahazoval, tak\u017Ee skupiny byly po obnoven\xED str\xE1nky zase rozbalen\xE9)."
    ]
  }
];

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
    const footChildren = [el("span.lattice-modal-version", { text: "Lattice " + VERSION, title: t("versionTitle") })];
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
    if ((grid.options.features || {}).version !== false) {
      gA.appendChild(rowToggle(t("instance.showVersion"), inst.showVersion !== false, (v) => set({ showVersion: v })));
    }
    gA.appendChild(rowScaleColors(t("instance.scaleColors"), inst.scaleColors || DEFAULT_SCALE_COLORS, (arr) => set({ scaleColors: arr }), t));
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
    gL.appendChild(rowToggle(t("instance.wrapHeader"), inst.wrapHeader === true, (v) => set({ wrapHeader: v })));
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
    gC.appendChild(rowSelect(t("group.display"), inst.groupDisplay || "headers", [
      ["headers", t("group.displayHeaders")],
      ["columns", t("group.displayColumns")]
    ], (v) => set({ groupDisplay: v })));
    if ((inst.groupDisplay || "headers") !== "columns") {
      gC.appendChild(rowToggle(t("group.repeat"), inst.groupRepeat !== false, (v) => set({ groupRepeat: v })));
    }
    if (grid.isSelectable()) {
      gC.appendChild(rowToggle(t("instance.selectColumn"), inst.selectColumn !== false, (v) => set({ selectColumn: v })));
      gC.appendChild(rowSelect(t("instance.selectTrigger"), inst.selectRowClick ? "row" : "checkbox", [
        ["checkbox", t("instance.selectByCheckbox")],
        ["row", t("instance.selectByRow")]
      ], (v) => set({ selectRowClick: v === "row" })));
    }
    gC.appendChild(rowToggle(t("instance.rowHighlight"), inst.rowHighlight === true || inst.rowHighlight === "click", (v) => set({ rowHighlight: v })));
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
      [t("instance.cssRowHover"), "--lattice-row-hover"],
      [t("instance.cssRowHighlight"), "--lattice-row-highlight-bg"],
      [t("instance.cssRowHighlightHover"), "--lattice-row-highlight-hover"]
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
    makeTab(t("about.title")).appendChild(this.buildAbout());
    activate(Math.min(this._tab || 0, tabs.length - 1));
  }
  /**
   * Záložka „O Lattice" — co to je, kdo za tím stojí, odkazy (příručka, demo, GitHub)
   * a přehled vydání. Seznam vydání se generuje z CHANGELOG.md (`npm run releases`),
   * takže se nemusí udržovat ručně.
   */
  buildAbout() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const box = el("div.lattice-about");
    box.appendChild(el("div.lattice-about-head", {}, [
      el("span.lattice-about-name", { text: "Lattice" }),
      el("span.lattice-about-ver", { text: VERSION })
    ]));
    box.appendChild(el("p.lattice-about-lead", { text: t("about.lead") }));
    box.appendChild(el("p.lattice-about-meta", {
      text: t("about.author") + ": " + AUTHOR + " \xB7 " + t("about.license") + ": " + LICENSE
    }));
    const help = grid.options.helpUrl === void 0 ? HELP_URL : grid.options.helpUrl;
    const links = el("div.lattice-about-links");
    for (const [url, label] of [[help, t("about.manual")], [DEMO_URL, t("about.demo")], [GITHUB_URL, t("about.github")]]) {
      if (!url) continue;
      links.appendChild(el("a.lattice-about-link", { href: url, target: "_blank", rel: "noopener noreferrer", text: label }));
    }
    box.appendChild(links);
    box.appendChild(el("div.lattice-about-relhead", {}, [
      el("span.lattice-about-reltitle", { text: t("about.releases") }),
      el("span.lattice-about-relhint", { text: t("about.releasesHint") })
    ]));
    const list = el("div.lattice-about-releases");
    const loc = grid.instance.locale || void 0;
    for (const r of RELEASES) {
      const current = r.version === VERSION;
      const row = el("div.lattice-about-rel" + (current ? ".is-current" : ""));
      const items = el("ul.lattice-about-relitems");
      for (const it of r.items || []) items.appendChild(el("li", { text: it }));
      const head = el("button.lattice-about-relmeta", { type: "button", title: t("about.toggleDetails") }, [
        el("span.lattice-about-relcaret", { text: "\u25B8" }),
        el("b.lattice-about-relver", { text: r.version }),
        el("span.lattice-about-reldate", { text: formatRelDate(r.date, loc) }),
        ...current ? [el("span.lattice-about-relnow", { text: t("about.current") })] : []
      ]);
      const open = (on) => {
        row.classList.toggle("is-open", on);
        head.querySelector(".lattice-about-relcaret").textContent = on ? "\u25BE" : "\u25B8";
      };
      head.addEventListener("click", () => open(!row.classList.contains("is-open")));
      row.append(head, el("div.lattice-about-reltext", { text: r.text }), items);
      if (current) open(true);
      list.appendChild(row);
    }
    box.appendChild(list);
    box.appendChild(el("p.lattice-about-meta", {}, [
      el("a.lattice-about-link", {
        href: GITHUB_URL + "/blob/main/CHANGELOG.md",
        target: "_blank",
        rel: "noopener noreferrer",
        text: t("about.fullChangelog")
      })
    ]));
    return box;
  }
};
function formatRelDate(iso, locale) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale, { day: "numeric", month: "numeric", year: "numeric" });
}
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
  const t = grid.i18n.t.bind(grid.i18n);
  const wrap = el("div.lattice-color-grid");
  for (const [label, name] of items) {
    const def = () => rgb2hex(effVar(grid, name)) || "#000000";
    const btn = el("button.lattice-scale-color", { type: "button", style: { background: cv[name] || def() } });
    btn.addEventListener("click", () => openColorPicker(btn, {
      t,
      current: cv[name] || def(),
      onPick: (color) => {
        btn.style.background = color;
        merge(name, color);
      },
      onClear: () => {
        btn.style.background = def();
        merge(name, null);
      }
    }));
    wrap.appendChild(el("span.lattice-color-cell", {}, [btn, el("span.lattice-color-lbl", { text: label })]));
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
function rowScaleColors(labelText, colors, onChange, t) {
  const wrap = el("span.lattice-scale-colors");
  const vals = [colors[0], colors[1], colors[2]];
  const btns = [0, 1, 2].map((i) => {
    const btn = el("button.lattice-scale-color", { type: "button", style: { background: vals[i] || "#888888" } });
    btn.addEventListener("click", () => openColorPicker(btn, {
      t,
      current: vals[i],
      onPick: (color) => {
        vals[i] = color;
        btn.style.background = color;
        onChange(vals.slice());
      },
      onClear: () => {
        vals[i] = DEFAULT_SCALE_COLORS[i];
        btn.style.background = vals[i];
        onChange(vals.slice());
      }
    }));
    return btn;
  });
  wrap.append(...btns);
  return field(labelText, wrap);
}

// src/features/gear.js
var PRESET_PARTS = ["columns", "filters", "instance"];
var cap = (k) => k.charAt(0).toUpperCase() + k.slice(1);
function partsSummary(parts, t) {
  const names = PRESET_PARTS.filter((k) => parts[k]).map((k) => t("presets.part" + cap(k)).toLowerCase());
  return names.length ? names.join(", ") : t("presets.partsNone");
}
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
  /** `prefill` = uložený preset k úpravě: předvyplní název, části i volby zobrazení. */
  open(anchor, prefill = null) {
    const panel = el("div.lattice-panel.lattice-gear-panel");
    this.anchor = anchor;
    this._prefill = prefill;
    this.renderList(panel);
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.panel = panel;
    this.off = onOutside(panel, (e) => {
      if (anchor.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".lattice-menu")) return;
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
    if (!this.panel) return;
    if (!this.anchor || !this.anchor.isConnected) return this.close();
    this.renderList(this.panel);
    positionUnder(this.panel, this.anchor);
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
    const addBtn = el("button.lattice-addcalc-btn", {
      type: "button",
      html: FX_SVG + "<span>" + t("calc.add") + "</span>"
    });
    addBtn.addEventListener("click", () => openFormulaEditor(addBtn, grid, null, this));
    panel.appendChild(el("div.lattice-gear-addcalc", {}, [addBtn]));
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
    const parts = this._presetParts || (this._presetParts = { columns: true, filters: true, instance: true });
    const prefill = this._prefill;
    if (prefill) Object.assign(parts, grid.presetContents(prefill));
    const partsRow = el("div.lattice-preset-parts");
    partsRow.appendChild(el("span.lattice-preset-parts-label", { text: t("presets.partsLabel") }));
    const boxes = [];
    for (const key of PRESET_PARTS) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = parts[key] !== false;
      cb.addEventListener("change", () => {
        parts[key] = cb.checked;
        if (!PRESET_PARTS.some((k) => parts[k])) {
          parts[key] = true;
          cb.checked = true;
        }
        syncSaveBtns();
      });
      boxes.push(cb);
      partsRow.appendChild(el("label.lattice-preset-part", { title: t("presets.part" + cap(key) + "Hint") }, [
        cb,
        el("span", { text: t("presets.part" + cap(key)) })
      ]));
    }
    wrap.appendChild(partsRow);
    const input = el("input.lattice-preset-input", { type: "text", placeholder: t("presets.namePlaceholder"), value: prefill ? prefill.name : "" });
    this._nameInput = input;
    const asBtnInput = el("input", { type: "checkbox" });
    asBtnInput.checked = !!(prefill && prefill.asButton);
    const asBtnLabel = el("label.lattice-adv-asbtn", { title: t("presets.asButtonHint") }, [
      asBtnInput,
      el("span", { text: t("presets.asButton") })
    ]);
    const asSelInput = el("input", { type: "checkbox" });
    asSelInput.checked = !!(prefill && prefill.asSelect);
    const asSelLabel = el("label.lattice-adv-asbtn", { title: t("presets.asSelectHint") }, [
      asSelInput,
      el("span", { text: t("presets.asSelect") })
    ]);
    const saveBtn = el("button.lattice-icon-btn", { type: "button", title: t("presets.saveLocal"), html: BOOKMARK_SVG });
    const doSaveLocal = () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      grid.presets.saveLocal(name, parts, { button: asBtnInput.checked, select: asSelInput.checked });
      input.value = "";
      this._prefill = null;
      this.refresh();
    };
    saveBtn.addEventListener("click", doSaveLocal);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSaveLocal();
    });
    const rowEls = [input, asBtnLabel, asSelLabel, saveBtn];
    let globeBtn = null;
    if (grid.presets.canSaveGlobal()) {
      globeBtn = el("button.lattice-icon-btn.is-success", { type: "button", title: t("presets.saveGlobal"), html: GLOBE_SVG });
      globeBtn.addEventListener("click", () => {
        const name = input.value.trim();
        if (!name) {
          input.focus();
          return;
        }
        grid.presets.saveGlobal(name, parts, { button: asBtnInput.checked, select: asSelInput.checked });
        input.value = "";
        this._prefill = null;
        this.refresh();
      });
      rowEls.push(globeBtn);
    }
    const syncSaveBtns = () => {
      const suffix = " \u2014 " + partsSummary(parts, t);
      saveBtn.title = t("presets.saveLocal") + suffix;
      if (globeBtn) globeBtn.title = t("presets.saveGlobal") + suffix;
    };
    syncSaveBtns();
    wrap.appendChild(el("div.lattice-preset-save", {}, rowEls));
    return wrap;
  }
  buildPresetRow(preset) {
    const grid = this.grid;
    const active = grid._activePresetId === preset.id;
    const t = grid.i18n.t.bind(grid.i18n);
    const contents = grid.presetContents(preset);
    const row = el("div.lattice-preset-row", {
      class: active ? "is-active" : "",
      // Tooltip říká, co preset obnoví — u částečného presetu je to podstatné.
      title: preset.name + " \u2014 " + partsSummary(contents, t)
    });
    const name = el("span.lattice-preset-name", { text: preset.name });
    name.addEventListener("click", () => grid.applyPreset(preset));
    row.appendChild(name);
    if (preset.scope === "global") {
      row.appendChild(el("span.lattice-preset-badge", { title: grid.i18n.t("presets.global"), html: GLOBE_SVG }));
    }
    for (const [key, icon, hint] of [["asButton", PIN_SVG, "presets.asButtonHint"], ["asSelect", SELECT_SVG, "presets.asSelectHint"]]) {
      const tog = el("button.lattice-preset-pin" + (preset[key] ? ".is-on" : ""), {
        type: "button",
        title: t(hint),
        html: icon
      });
      tog.addEventListener("click", (e) => {
        e.stopPropagation();
        grid.presets.setDisplay(preset, key, !preset[key]);
        this.refresh();
      });
      row.appendChild(tog);
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
  /** Inline přejmenování sloupce (dvojklik na název v seznamu). */
  _startRename(col, nameSpan) {
    const grid = this.grid;
    const input = el("input.lattice-gear-rename", { type: "text", value: col.title });
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      grid.setColumnTitle(col.field, input.value);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        done = true;
        this.refresh();
      }
    });
    input.addEventListener("blur", commit);
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
  }
  buildRow(col) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const row = el("div.lattice-gear-row", { draggable: true, dataset: { field: col.field, title: String(col.title).toLowerCase() } });
    const grip = el("span.lattice-grip", { text: "\u22EE\u22EE", title: "P\u0159et\xE1hnout" });
    const cb = el("input", { type: "checkbox", checked: col.visible });
    cb.addEventListener("change", () => grid.setColumnVisible(col.field, cb.checked));
    const nameSpan = el("span.lattice-gear-name", { text: col.title, title: col.title + " \u2014 " + t("columns.renameHint") });
    let clickT = null;
    nameSpan.addEventListener("click", (e) => {
      e.preventDefault();
      if (clickT) {
        clearTimeout(clickT);
        clickT = null;
        return;
      }
      clickT = setTimeout(() => {
        clickT = null;
        grid.setColumnVisible(col.field, !col.visible);
      }, 220);
    });
    nameSpan.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (clickT) {
        clearTimeout(clickT);
        clickT = null;
      }
      this._startRename(col, nameSpan);
    });
    const label = el("div.lattice-gear-label", {}, [cb, nameSpan]);
    if (col.formula != null) {
      const fx = el("button.lattice-calc-badge", { type: "button", title: t("calc.edit"), html: FX_SVG });
      fx.addEventListener("click", (e) => {
        e.preventDefault();
        openFormulaEditor(fx, grid, col, this);
      });
      label.appendChild(fx);
    }
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
    const colorBtn = el("button.lattice-gbtn.lattice-hcolor-btn", {
      type: "button",
      title: grid.i18n.t("columns.headerColor"),
      class: col.headerBackground || col.headerColor ? "is-active" : "",
      style: col.headerBackground || col.headerColor ? { background: col.headerBackground || "transparent", color: col.headerColor || "inherit" } : {},
      text: "A"
    });
    colorBtn.addEventListener("click", () => openHeaderColorPicker(colorBtn, {
      t: grid.i18n.t.bind(grid.i18n),
      current: { background: col.headerBackground, color: col.headerColor },
      onPick: (bg, fg) => grid.setColumnHeaderColor(col.field, { background: bg, color: fg }),
      onClear: () => grid.setColumnHeaderColor(col.field, {})
    }));
    tools.appendChild(colorBtn);
    const cf = col.cellFormat || {};
    const cfActive = !!(cf.align || cf.bold || cf.italic || cf.underline || cf.strike || cf.color || cf.background);
    const cellFmtBtn = el("button.lattice-gbtn.lattice-cellfmt-btn", {
      type: "button",
      title: grid.i18n.t("columns.cellFormat"),
      class: cfActive ? "is-active" : "",
      text: "\xB6"
    });
    cellFmtBtn.addEventListener("click", () => openCellFormatPicker(cellFmtBtn, grid, col));
    tools.appendChild(cellFmtBtn);
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
      class: col.summary && col.summary.length || col.rowSummary && col.rowSummary.length || col.summaryFormula ? "is-active" : "",
      text: "\u03A3"
    });
    sumBtn.addEventListener("click", () => openSummaryPicker(sumBtn, grid, col));
    tools.appendChild(sumBtn);
    const isBool2 = col.type === "boolean" || col.type === "tick";
    if (formatKind(col.type) || isBool2) {
      const fmtBtn = el("button.lattice-gbtn.lattice-fmtbtn", {
        type: "button",
        title: t("instance.colFormatTitle"),
        class: col.format ? "is-active" : "",
        text: isBool2 ? "\u2713" : "0.0"
      });
      fmtBtn.addEventListener("click", () => isBool2 ? openBoolFormatPicker(fmtBtn, grid, col) : openFormatPicker(fmtBtn, grid, col));
      tools.appendChild(fmtBtn);
    } else {
      tools.appendChild(el("span.lattice-gslot-empty"));
    }
    if (!ROWGROUP_EXCLUDE.has(col.type)) {
      const isDate2 = DATE_TYPES.has(col.type);
      const activeParts = isDate2 ? DATE_PARTS.filter((p) => grid.isRowGrouped(col.field, p)) : [];
      const level = isDate2 ? activeParts.length : grid.rowGroupLevel(col.field);
      const rgBtn = el("button.lattice-gbtn.lattice-rgbtn", {
        type: "button",
        title: isDate2 ? t("group.by") : t("columns.rowGroupToggle"),
        class: level ? "is-active" : "",
        html: ROWGROUP_SVG + (level ? '<span class="lattice-rg-badge">' + level + "</span>" : "")
      });
      if (isDate2) {
        rgBtn.addEventListener("click", () => {
          const items = DATE_PARTS.map((p) => ({
            value: p,
            label: t("group.parts." + p),
            active: grid.isRowGrouped(col.field, p)
          }));
          openMenu(rgBtn, items, (part) => grid.toggleRowGroup(col.field, part), {
            multi: true,
            isActive: (part) => grid.isRowGrouped(col.field, part)
          });
        });
      } else {
        rgBtn.addEventListener("click", () => grid.toggleRowGroup(col.field));
      }
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
  const MARGIN = 8;
  const r = anchor.getBoundingClientRect();
  panel.style.position = "absolute";
  const left = window.scrollX + r.right - panel.offsetWidth;
  panel.style.left = Math.max(MARGIN, left) + "px";
  const fits = window.innerHeight - MARGIN - panel.offsetHeight;
  const top = Math.max(MARGIN, Math.min(r.bottom + 4, fits));
  panel.style.top = window.scrollY + top + "px";
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
    const item = el("div.lattice-menu-item.lattice-group-item", { class: g === cur ? "is-active" : "" });
    const name = el("span.lattice-group-item-name", { text: g });
    name.addEventListener("click", () => pick2(g));
    const member = grid.columns.find((c) => c.group === g) || {};
    const cbtn = el("button.lattice-group-color", {
      type: "button",
      title: t("columns.groupHeaderColor"),
      style: member.groupHeaderBackground || member.groupHeaderColor ? { background: member.groupHeaderBackground || "var(--lattice-bg)", color: member.groupHeaderColor || "inherit" } : {},
      text: "A"
    });
    cbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHeaderColorPicker(cbtn, {
        t,
        current: { background: member.groupHeaderBackground, color: member.groupHeaderColor },
        onPick: (bg, fg) => {
          grid.setColGroupHeaderColor(g, { background: bg, color: fg });
          onDone && onDone();
        },
        onClear: () => {
          grid.setColGroupHeaderColor(g, {});
          onDone && onDone();
        }
      });
    });
    const del = el("button.lattice-group-del", { type: "button", title: t("columns.ungroup"), text: "\xD7" });
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
      grid.ungroup(g);
      onDone && onDone();
    });
    item.append(name, cbtn, del);
    menu.appendChild(item);
  }
  let newInput = null;
  if (!cur) {
    newInput = el("input.lattice-group-new", { type: "text", placeholder: t("columns.newGroup") });
    const add = () => {
      const v = newInput.value.trim();
      if (v) pick2(v);
    };
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    });
    const addBtn = el("button.lattice-icon-btn", { type: "button", text: "+" });
    addBtn.addEventListener("click", add);
    menu.appendChild(el("div.lattice-group-newrow", {}, [newInput, addBtn]));
  }
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  if (newInput) setTimeout(() => newInput.focus(), 0);
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
  const fx = el("div.lattice-menu-item.lattice-summary-fxitem", { class: col.summaryFormula ? "is-selected" : "" }, [
    el("span.lattice-ms-check", { text: col.summaryFormula ? "\u2713" : "" }),
    el("span.lattice-summary-menu-sym", { text: "\u0192" }),
    el("span", { text: t("calc.sumFormulaOption") })
  ]);
  fx.addEventListener("mousedown", (e) => {
    e.preventDefault();
    close();
    openSummaryFormulaEditor(anchor, grid, col);
  });
  menu.appendChild(fx);
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
function openSummaryFormulaEditor(anchor, grid, col) {
  document.querySelectorAll(".lattice-formula-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const menu = el("div.lattice-menu.lattice-formula-menu");
  menu.appendChild(el("div.lattice-summary-menu-head", { text: t("calc.sumFormulaTitle") + " \u2014 " + col.title }));
  menu.appendChild(el("div.lattice-formula-hint", { text: t("calc.sumFormulaHint") }));
  const nameInp = el("input.lattice-set-input", { type: "text", value: col.summaryFormulaLabel || "", placeholder: t("calc.sumFormulaLabelPlaceholder") });
  menu.appendChild(csField(t("calc.sumFormulaLabel"), nameInp));
  const ta = el("textarea.lattice-formula-input", { rows: 2, spellcheck: false, placeholder: t("calc.sumFormulaPlaceholder") });
  ta.value = col.summaryFormula || "";
  menu.appendChild(el("div.lattice-formula-row", {}, [el("span.lattice-set-label", { text: t("calc.formula") }), ta]));
  const chips = el("div.lattice-formula-fields");
  for (const c of grid.columns) {
    if (c._rownum) continue;
    const token = /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.field) ? c.field : "[" + c.field + "]";
    const chip = el("button.lattice-formula-chip", { type: "button", text: c.title, title: c.field });
    chip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      insertAtCursor(ta, token);
      updatePreview();
    });
    chips.appendChild(chip);
  }
  menu.appendChild(el("div.lattice-formula-fieldswrap", {}, [
    el("div.lattice-formula-hint", { text: t("calc.insertField") }),
    chips
  ]));
  menu.appendChild(buildFnReference(t, AGGREGATE_CATALOG, ta, () => updatePreview(), () => fit()));
  const preview = el("div.lattice-formula-preview");
  menu.appendChild(preview);
  function scopeRows() {
    return grid.summarySource(grid.instance.summaryRow === "page" ? "page" : "all");
  }
  function updatePreview() {
    const src = ta.value.trim();
    if (!src) {
      preview.className = "lattice-formula-preview";
      preview.textContent = "";
      return;
    }
    const chk = validateAggregate(src);
    if (!chk.ok) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + chk.error;
      return;
    }
    try {
      const val = compileAggregate(src)(scopeRows());
      preview.className = "lattice-formula-preview is-ok";
      preview.textContent = t("calc.previewLabel") + " " + formatPreview(val);
    } catch (e) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + (e && e.message ? e.message : String(e));
    }
  }
  ta.addEventListener("input", updatePreview);
  const save = () => {
    const src = ta.value.trim();
    const chk = src ? validateAggregate(src) : { ok: true };
    if (!chk.ok) {
      updatePreview();
      return;
    }
    try {
      grid.setColumnSummaryFormula(col.field, src, nameInp.value);
    } catch (e) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + (e && e.message ? e.message : String(e));
      return;
    }
    close();
  };
  const saveBtn = el("button.lattice-formula-btn.is-primary", { type: "button", text: t("calc.save") });
  saveBtn.addEventListener("click", save);
  const actions = [saveBtn];
  if (col.summaryFormula) {
    const clr = el("button.lattice-formula-btn.is-danger", { type: "button", text: t("calc.sumFormulaClear") });
    clr.addEventListener("click", () => {
      grid.setColumnSummaryFormula(col.field, null);
      close();
    });
    actions.push(clr);
  }
  const cancelBtn = el("button.lattice-formula-btn", { type: "button", text: t("calc.cancel") });
  cancelBtn.addEventListener("click", () => close());
  actions.push(cancelBtn);
  menu.appendChild(el("div.lattice-formula-actions", {}, actions));
  function fit() {
    const a = anchor && anchor.isConnected ? anchor : grid.gear && grid.gear.panel || anchor;
    positionUnder(menu, a);
    const vh = window.innerHeight;
    if (menu.getBoundingClientRect().bottom > vh - 8) {
      menu.style.top = Math.max(window.scrollY + 8, window.scrollY + vh - menu.offsetHeight - 8) + "px";
    }
  }
  updatePreview();
  document.body.appendChild(menu);
  fit();
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  setTimeout(() => ta.focus(), 0);
  return close;
}
function openCellFormatPicker(anchor, grid, col) {
  document.querySelectorAll(".lattice-cellfmt-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const menu = el("div.lattice-menu.lattice-cellfmt-menu");
  const cf = () => col.cellFormat || {};
  const set = (patch) => {
    grid.setColumnCellFormat(col.field, patch);
    render();
  };
  const alignBtn = (val, svg) => {
    const b = el("button.lattice-cellfmt-tgl", { type: "button", class: cf().align === val ? "is-active" : "", html: svg });
    b.addEventListener("click", () => set({ align: cf().align === val ? null : val }));
    return b;
  };
  const styleBtn = (key, label, cls, titleKey) => {
    const b = el("button.lattice-cellfmt-tgl." + cls, { type: "button", title: t("cellFormat." + titleKey), class: cf()[key] ? "is-active" : "", text: label });
    b.addEventListener("click", () => set({ [key]: !cf()[key] }));
    return b;
  };
  const colorField = (key, labelKey) => {
    const val = cf()[key];
    const b = el("button.lattice-cellfmt-color", {
      type: "button",
      title: t("cellFormat." + labelKey),
      style: val ? { background: key === "background" ? val : "var(--lattice-bg)", color: key === "color" ? val : val || "inherit" } : {},
      text: "A"
    });
    b.addEventListener("click", () => openColorPicker(b, {
      t,
      title: t("cellFormat." + labelKey),
      current: val,
      onPick: (c) => set({ [key]: c }),
      onClear: () => set({ [key]: null })
    }));
    return b;
  };
  function render() {
    clear(menu);
    menu.appendChild(el("div.lattice-summary-menu-head", { text: t("cellFormat.title") }));
    menu.appendChild(csField(t("cellFormat.align"), el("div.lattice-cellfmt-row", {}, [
      alignBtn("left", AL_LEFT_SVG),
      alignBtn("center", AL_CENTER_SVG),
      alignBtn("right", AL_RIGHT_SVG)
    ])));
    menu.appendChild(csField(t("cellFormat.style"), el("div.lattice-cellfmt-row", {}, [
      styleBtn("bold", "B", "is-b", "bold"),
      styleBtn("italic", "I", "is-i", "italic"),
      styleBtn("underline", "U", "is-u", "underline"),
      styleBtn("strike", "S", "is-s", "strike")
    ])));
    menu.appendChild(csField(t("cellFormat.textColor"), colorField("color", "textColor")));
    menu.appendChild(csField(t("cellFormat.bgColor"), colorField("background", "bgColor")));
    const clr = el("button.lattice-formula-btn.is-danger", { type: "button", text: t("cellFormat.clear") });
    clr.addEventListener("click", () => {
      grid.setColumnCellFormat(col.field, null);
      render();
    });
    menu.appendChild(el("div.lattice-cellfmt-actions", {}, [clr]));
  }
  render();
  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => {
    if (anchor.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".lattice-hcolor-menu")) return;
    close();
  });
  function close() {
    off();
    menu.remove();
  }
  return close;
}
function openBoolFormatPicker(anchor, grid, col) {
  document.querySelectorAll(".lattice-bool-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const menu = el("div.lattice-menu.lattice-bool-menu");
  const PRESETS2 = [
    { tt: "\u2713", ft: "\u2715" },
    { tt: t("bool.yes"), ft: t("bool.no") },
    { tt: "1", ft: "0" },
    { tt: "\u2705", ft: "\u274C" },
    { tt: "\u{1F44D}", ft: "\u{1F44E}" }
  ];
  const apply = (patch) => {
    const next = Object.assign({}, col.format, patch);
    const isDefault = (next.trueText == null || next.trueText === "\u2713") && (next.falseText == null || next.falseText === "\u2715") && !next.plain;
    grid.setColumnFormat(col.field, isDefault ? null : next);
    render();
  };
  function render() {
    clear(menu);
    const cur = col.format || {};
    menu.appendChild(el("div.lattice-summary-menu-head", { text: t("bool.title") }));
    for (const p of PRESETS2) {
      const active = (cur.trueText || "\u2713") === p.tt && (cur.falseText || "\u2715") === p.ft;
      const item = el("div.lattice-menu-item", { class: active ? "is-selected" : "" }, [
        el("span.lattice-ms-check", { text: active ? "\u2713" : "" }),
        el("span", { text: p.tt + "  /  " + p.ft })
      ]);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        apply({ trueText: p.tt, falseText: p.ft });
      });
      menu.appendChild(item);
    }
    menu.appendChild(el("div.lattice-summary-menu-sep"));
    const tIn = el("input.lattice-set-input", { type: "text", value: cur.trueText || "", placeholder: "\u2713" });
    const fIn = el("input.lattice-set-input", { type: "text", value: cur.falseText || "", placeholder: "\u2715" });
    const applyCustom = () => apply({ trueText: tIn.value || void 0, falseText: fIn.value || void 0 });
    tIn.addEventListener("change", applyCustom);
    fIn.addEventListener("change", applyCustom);
    menu.appendChild(csField(t("bool.customTrue"), tIn));
    menu.appendChild(csField(t("bool.customFalse"), fIn));
    const colorCb = el("input", { type: "checkbox", checked: !cur.plain });
    colorCb.addEventListener("change", () => apply({ plain: !colorCb.checked }));
    menu.appendChild(csField(t("bool.colored"), colorCb));
    const reset = el("button.lattice-formula-btn", { type: "button", text: t("bool.reset") });
    reset.addEventListener("click", () => {
      grid.setColumnFormat(col.field, null);
      render();
    });
    menu.appendChild(el("div.lattice-cellfmt-actions", {}, [reset]));
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
function openFormulaEditor(anchor, grid, col, gear) {
  document.querySelectorAll(".lattice-formula-menu").forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const editing = !!col;
  const menu = el("div.lattice-menu.lattice-formula-menu");
  menu.appendChild(el("div.lattice-summary-menu-head", { text: t(editing ? "calc.editTitle" : "calc.newTitle") }));
  const nameInp = el("input.lattice-set-input", { type: "text", value: editing ? col.title : "", placeholder: t("calc.namePlaceholder") });
  menu.appendChild(csField(t("calc.name"), nameInp));
  let userPickedType = editing;
  const typeSel = csSelect(editing ? col.type : "number", [
    ["number", t("calc.typeNumber")],
    ["text", t("calc.typeText")],
    ["date", t("calc.typeDate")]
  ], () => {
    userPickedType = true;
    updatePreview();
  });
  menu.appendChild(csField(t("calc.type"), typeSel));
  const ta = el("textarea.lattice-formula-input", { rows: 2, spellcheck: false, placeholder: t("calc.formulaPlaceholder") });
  ta.value = editing ? col.formula || "" : "";
  menu.appendChild(el("div.lattice-formula-row", {}, [el("span.lattice-set-label", { text: t("calc.formula") }), ta]));
  const chips = el("div.lattice-formula-fields");
  for (const c of grid.columns) {
    if (editing && c.field === col.field) continue;
    if (c.formula != null) continue;
    const token = /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.field) ? c.field : "[" + c.field + "]";
    const chip = el("button.lattice-formula-chip", { type: "button", text: c.title, title: c.field });
    chip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      insertAtCursor(ta, token);
      updatePreview();
    });
    chips.appendChild(chip);
  }
  menu.appendChild(el("div.lattice-formula-fieldswrap", {}, [
    el("div.lattice-formula-hint", { text: t("calc.insertField") }),
    chips
  ]));
  menu.appendChild(buildFnReference(t, FORMULA_CATALOG, ta, () => updatePreview(), () => fit()));
  const preview = el("div.lattice-formula-preview");
  menu.appendChild(preview);
  function sampleRow() {
    const rows = grid.dataSource && grid.dataSource.allRows ? grid.dataSource.allRows() : grid.rows || [];
    return rows && rows.length ? rows[0] : {};
  }
  function updatePreview() {
    const src = ta.value.trim();
    if (!src) {
      preview.className = "lattice-formula-preview";
      preview.textContent = "";
      return;
    }
    const chk = validateFormula(src);
    if (!chk.ok) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + chk.error;
      return;
    }
    let val;
    try {
      val = compileFormula(src)(sampleRow());
    } catch (e) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + (e && e.message ? e.message : String(e));
      return;
    }
    if (!userPickedType && val != null) {
      const guessed = inferFormulaType(val);
      if (typeSel.value !== guessed) typeSel.value = guessed;
    }
    const numericType = typeSel.value === "number" || typeSel.value === "money";
    const isTextVal = typeof val === "string" && val.trim() !== "" && !isNumericStr(val);
    if (numericType && isTextVal) {
      preview.className = "lattice-formula-preview is-warn";
      preview.textContent = t("calc.previewLabel") + " " + formatPreview(val) + " \u2014 " + t("calc.textHint");
    } else {
      preview.className = "lattice-formula-preview is-ok";
      preview.textContent = t("calc.previewLabel") + " " + formatPreview(val);
    }
  }
  ta.addEventListener("input", updatePreview);
  const save = () => {
    const src = ta.value.trim();
    const chk = validateFormula(src);
    if (!chk.ok) {
      updatePreview();
      return;
    }
    try {
      if (editing) grid.updateComputedColumn(col.field, { title: nameInp.value, type: typeSel.value, formula: src });
      else grid.addComputedColumn({ title: nameInp.value, type: typeSel.value, formula: src });
    } catch (e) {
      preview.className = "lattice-formula-preview is-error";
      preview.textContent = "\u26A0 " + (e && e.message ? e.message : String(e));
      return;
    }
    close();
    gear.refresh();
  };
  const saveBtn = el("button.lattice-formula-btn.is-primary", { type: "button", text: t("calc.save") });
  saveBtn.addEventListener("click", save);
  const actions = [saveBtn];
  if (editing) {
    const delBtn = el("button.lattice-formula-btn.is-danger", { type: "button", text: t("calc.delete") });
    delBtn.addEventListener("click", () => {
      grid.removeComputedColumn(col.field);
      close();
      gear.refresh();
    });
    actions.push(delBtn);
  }
  const cancelBtn = el("button.lattice-formula-btn", { type: "button", text: t("calc.cancel") });
  cancelBtn.addEventListener("click", () => close());
  actions.push(cancelBtn);
  menu.appendChild(el("div.lattice-formula-actions", {}, actions));
  function fit() {
    const a = anchor && anchor.isConnected ? anchor : grid.gear && grid.gear.panel || anchor;
    positionUnder(menu, a);
    const vh = window.innerHeight;
    if (menu.getBoundingClientRect().bottom > vh - 8) {
      menu.style.top = Math.max(window.scrollY + 8, window.scrollY + vh - menu.offsetHeight - 8) + "px";
    }
  }
  updatePreview();
  document.body.appendChild(menu);
  fit();
  const off = onOutside(menu, (e) => {
    if (!anchor.contains(e.target)) close();
  });
  function close() {
    off();
    menu.remove();
  }
  setTimeout(() => (editing ? ta : nameInp).focus(), 0);
  return close;
}
function insertFunction(ta, name, sig) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, s);
  const after = ta.value.slice(e);
  const pad4 = before && !/[\s(,]$/.test(before) ? " " : "";
  const insert = name + "()";
  ta.value = before + pad4 + insert + after;
  const base = (before + pad4 + insert).length;
  const zeroArg = /\(\s*\)\s*$/.test(sig);
  const pos = zeroArg ? base : base - 1;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}
function buildFnReference(t, catalog, ta, onInsert, fit) {
  const fnBody = el("div.lattice-formula-fnbody");
  const fnToggle = el("button.lattice-formula-fntoggle", {
    type: "button",
    html: FX_SVG + "<span>" + t("calc.fnTitle") + '</span><span class="lattice-formula-caret">\u25BE</span>'
  });
  const fnSearch = el("input.lattice-set-input.lattice-formula-fnsearch", { type: "text", placeholder: t("calc.fnSearch") });
  const fnList = el("div.lattice-formula-fnlist");
  const fnCats = [];
  for (const group of catalog) {
    const head = el("div.lattice-formula-fncat", { text: t("calc.fnCat." + group.cat) });
    fnList.appendChild(head);
    const cat = { head, items: [] };
    const base = group.cat === "agg" ? "calc.agg." : "calc.fn.";
    for (const name of group.fns) {
      const sig = t(base + name + ".sig");
      const desc = t(base + name + ".desc");
      const item = el("button.lattice-formula-fnitem", { type: "button", title: sig + " \u2014 " + desc }, [
        el("code.lattice-formula-fnsig", { text: sig }),
        el("span.lattice-formula-fndesc", { text: desc })
      ]);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        insertFunction(ta, name, sig);
        onInsert();
      });
      fnList.appendChild(item);
      cat.items.push({ el: item, hay: (name + " " + sig + " " + desc).toLowerCase() });
    }
    fnCats.push(cat);
  }
  fnSearch.addEventListener("input", () => {
    const q = fnSearch.value.trim().toLowerCase();
    for (const cat of fnCats) {
      let any = false;
      for (const it of cat.items) {
        const show = !q || it.hay.includes(q);
        it.el.style.display = show ? "" : "none";
        if (show) any = true;
      }
      cat.head.style.display = any ? "" : "none";
    }
  });
  fnBody.append(fnSearch, fnList);
  fnBody.style.display = "none";
  fnToggle.addEventListener("click", () => {
    const open = fnBody.style.display === "none";
    fnBody.style.display = open ? "" : "none";
    fnToggle.classList.toggle("is-open", open);
    if (open) setTimeout(() => fnSearch.focus(), 0);
    if (fit) fit();
  });
  return el("div.lattice-formula-fnwrap", {}, [fnToggle, fnBody]);
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, s);
  const after = ta.value.slice(e);
  const pad4 = before && !/\s$/.test(before) ? " " : "";
  ta.value = before + pad4 + text + after;
  const pos = (before + pad4 + text).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}
function inferFormulaType(v) {
  if (typeof v === "number") return "number";
  if (v instanceof Date) return "date";
  return "text";
}
function isNumericStr(v) {
  if (typeof v === "number") return Number.isFinite(v);
  return Number.isFinite(Number(String(v).replace(/\s/g, "").replace(",", ".")));
}
function formatPreview(v) {
  if (v == null) return "\u2014";
  if (v instanceof Date) return isNaN(v.getTime()) ? "\u2014" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "\u2014";
  if (typeof v === "boolean") return v ? "\u2713" : "\u2717";
  return String(v);
}
var GROUP_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h8v6H3V5zm10 0h8v2h-8V5zm0 4h8v2h-8V9zM3 13h18v2H3v-2zm0 4h18v2H3v-2z"/></svg>';
var ROWGROUP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 4h18v2H3V4zm4 4h14v2H7V8zm0 4h14v2H7v-2zM3 8h2v10H3V8zm4 8h14v2H7v-2z"/></svg>';
var ROWGROUP_EXCLUDE = /* @__PURE__ */ new Set(["image", "html", "progress", "rating", "color"]);
var DATE_TYPES = /* @__PURE__ */ new Set(["date", "datetime", "time"]);
var ROTATE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.5 4l4.5 12h-2l-1-3H5l-1 3H2L6.5 4h1zM6 5.9L4.6 11h2.8L6 5.9zM20 13l-4 4-4-4h3V4h2v9h3z"/></svg>';
var FUNNEL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
var FIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7v10H2V7h2zm18 0v10h-2V7h2zM8 11l-3 1 3 1v-2zm8 0v2l3-1-3-1zM6 11h12v2H6v-2z"/></svg>';
var CLEAR_FILTER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
var RESET_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5V2L8 6l4 4V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg>';
var GLOBE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.9 6h-2.5a15.7 15.7 0 00-1.3-3.4A8 8 0 0118.9 8zM12 4c.8 1.1 1.4 2.4 1.8 4h-3.6c.4-1.6 1-2.9 1.8-4zM4.3 14a7.8 7.8 0 010-4h2.9a17 17 0 000 4zm.8 2h2.5c.3 1.2.8 2.4 1.3 3.4A8 8 0 015.1 16zm2.5-8H5.1a8 8 0 013.8-3.4C8.4 5.6 7.9 6.8 7.6 8zM12 20c-.8-1.1-1.4-2.4-1.8-4h3.6c-.4 1.6-1 2.9-1.8 4zm2.2-6H9.8a15 15 0 010-4h4.4a15 15 0 010 4zm.6 5.4c.5-1 1-2.2 1.3-3.4h2.5a8 8 0 01-3.8 3.4zm2.1-5.4a17 17 0 000-4h2.9a7.8 7.8 0 010 4z"/></svg>';
var PIN_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><rect class="lattice-pin-fill" x="5" y="9.5" width="14" height="5" rx="2.5" fill="currentColor"/></svg>';
var SELECT_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path class="lattice-pin-fill" fill="currentColor" d="M6 9h8v1.8H6zm0 4h6v1.8H6z"/><path fill="currentColor" d="M16.2 10.2h3.4L17.9 13z"/></svg>';
var BOOKMARK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 011 1v18l-7-4-7 4V3a1 1 0 011-1z"/></svg>';
var AL_LEFT_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3h12v2H2zM2 7h8v2H2zM2 11h12v2H2z"/></svg>';
var AL_CENTER_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3h12v2H2zM4 7h8v2H4zM2 11h12v2H2z"/></svg>';
var AL_RIGHT_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3h12v2H2zM6 7h8v2H6zM2 11h12v2H2z"/></svg>';
var FX_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M14.5 4.2c-1.6-.3-2.8.5-3.1 2.2L11.1 8h2.2l-.3 1.8h-2.2l-1 5.7c-.4 2.4-1.7 3.6-3.8 3.6-.5 0-1-.1-1.4-.2l.3-1.8c.3.1.6.2.9.2.9 0 1.4-.6 1.6-1.9l1-5.6H7l.3-1.8h1.8l.3-1.9C10.1 3.6 11.8 2.1 14 2.4l.5 1.8zM15.9 12.6l1.6 2.2 1.9-2.2h2l-2.9 3.3 1.8 2.5-.1.1h-1.9l-1.6-2.3-2 2.3h-2l3-3.4-1.8-2.5v-.1h2z"/></svg>';

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
function norm2(s) {
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
    const needle = norm2(negate ? raw.slice(1) : raw);
    if (needle === "") return true;
    const has = norm2(cell).includes(needle);
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
    const lo = dayTime(resolveToken(value.from));
    const hi = dayTime(resolveToken(value.to));
    if (lo != null && t < lo) return false;
    if (hi != null && t > hi) return false;
    return true;
  },
  // JEDNO pole: rozsah pošleme jako jednu hodnotu "from|to" (tokeny rozvinuté na konkrétní datum)
  toServer: (field2, value) => [{ field: field2, type: "dateRange", value: `${resolveToken(value.from) || ""}|${resolveToken(value.to) || ""}` }]
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
var DYN_CLAUSE_RE = /^\s*(>=|<=|>|<|=)?\s*(.+)$/;
function dynClause(str3) {
  const m = String(str3).match(DYN_CLAUSE_RE);
  if (!m) return null;
  const target = dayTime(resolveToken(m[2].trim()));
  if (target == null) return null;
  return { op: m[1] || "=", target };
}
function dynParse(value) {
  const groups = [];
  for (const g of String(value).split(/\bOR\b|\|\|/i)) {
    const clauses = g.split(/\bAND\b|&&/i).map(dynClause).filter(Boolean);
    if (clauses.length) groups.push(clauses);
  }
  return groups;
}
function dynTest(t, c) {
  switch (c.op) {
    case ">":
      return t > c.target;
    case "<":
      return t < c.target;
    case ">=":
      return t >= c.target;
    case "<=":
      return t <= c.target;
    default:
      return t === c.target;
  }
}
var DYN_RECIPES = [
  ["today", "=today"],
  ["d7", ">=today-7 AND <=today"],
  ["thisWeek", ">=sow AND <=eow"],
  ["lastWeek", ">=sow-1w AND <=eow-1w"],
  ["thisMonth", ">=som AND <=eom"],
  ["lastMonth", ">=som-1m AND <=eom-1m"],
  ["thisYear", ">=soy AND <=eoy"]
];
function openDynamicHelp(anchor, input, ctx) {
  document.querySelectorAll(".lattice-dyn-pop").forEach((p) => p.remove());
  const t = (k) => ctx.i18n.t(k);
  const pop = el("div.lattice-panel.lattice-dyn-pop");
  let off = null;
  const close = () => {
    off?.();
    pop.remove();
  };
  pop.appendChild(el("div.lattice-dyn-pop-h", { text: t("filters.dynamicHelp.periods") }));
  const chips = el("div.lattice-dyn-recipes");
  for (const [key, expr] of DYN_RECIPES) {
    const b = el("button.lattice-dyn-recipe", { type: "button", text: t("filters.dynamicHelp.r." + key), title: expr });
    b.addEventListener("click", () => {
      input.value = expr;
      ctx.onChange(expr);
      close();
    });
    chips.appendChild(b);
  }
  pop.appendChild(chips);
  pop.appendChild(el("div.lattice-dyn-pop-h", { text: t("filters.dynamicHelp.syntax") }));
  pop.appendChild(el("div.lattice-dyn-tokens", { text: t("filters.dynamicHelp.tokens") }));
  document.body.appendChild(pop);
  positionUnder(pop, anchor);
  off = onOutside(pop, (e) => {
    if (!anchor.contains(e.target)) close();
  });
}
registerFilter("dynamic", {
  build(column, ctx) {
    const input = el("input.lattice-filter-input.lattice-dyn-input", {
      type: "text",
      placeholder: ctx.i18n.t("filters.dynamicPlaceholder"),
      title: ctx.i18n.t("filters.dynamicHint"),
      value: ctx.value ?? ""
    });
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener("input", () => fire(input.value));
    const help = el("button.lattice-dyn-help", { type: "button", title: ctx.i18n.t("filters.dynamicHelp.title"), text: "?" });
    help.addEventListener("click", (e) => {
      e.stopPropagation();
      openDynamicHelp(help, input, ctx);
    });
    return el("div.lattice-dyn-wrap", {}, [input, help]);
  },
  isEmpty: (v) => !v || String(v).trim() === "",
  match(value, cell) {
    const t = dayTime(cell);
    if (t == null) return false;
    const groups = dynParse(value);
    if (!groups.length) return true;
    return groups.some((clauses) => clauses.every((c) => dynTest(t, c)));
  },
  toServer(field2, value) {
    const orGroups = String(value).split(/\bOR\b|\|\|/i);
    const multiOr = orGroups.length > 1;
    const out = [];
    orGroups.forEach((g, gi) => {
      for (const s of g.split(/\bAND\b|&&/i)) {
        const m = String(s).match(DYN_CLAUSE_RE);
        if (!m) continue;
        const operand = resolveToken(m[2].trim());
        if (dayTime(operand) == null) continue;
        const param = { field: field2, type: m[1] || "=", value: operand };
        if (multiOr) {
          param.combinator = "OR";
          param.group = gi;
        }
        out.push(param);
      }
    });
    return out;
  }
});
registerFilter("select", {
  build(column, ctx) {
    return buildSelect(column, ctx);
  },
  isEmpty: (v) => v == null || v === "",
  match: (value, cell) => norm2(cell) === norm2(value),
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
    const set = value.map(norm2);
    return set.includes(norm2(cell));
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
  /** Vloží řádek na konkrétní index (clamp do rozsahu). Pro undo smazání. */
  insertRow(row, index) {
    const i = index == null ? this.data.length : Math.max(0, Math.min(index, this.data.length));
    this.data.splice(i, 0, row);
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
      this._searchCache.set(row, cols.map((c) => norm3(cellValue(row, c))).join(""));
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
    const text = (columns || []).filter(searchableCol).map((c) => norm3(cellValue(row, c))).join("");
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
      if (s.kind === "num") return num3(v);
      if (s.kind === "date") return time(v);
      if (s.kind === "bool") return bool2(v) ? 1 : 0;
      return String(v);
    });
    return { row, keys, i };
  });
  decorated.sort((A, B) => {
    for (let s = 0; s < specs.length; s++) {
      const a = A.keys[s], b = B.keys[s];
      let cmp3;
      if (a == null && b == null) cmp3 = 0;
      else if (a == null) cmp3 = -1;
      else if (b == null) cmp3 = 1;
      else if (typeof a === "number") cmp3 = a - b;
      else cmp3 = COLLATOR.compare(a, b);
      if (cmp3 !== 0) return specs[s].sign * cmp3;
    }
    return A.i - B.i;
  });
  return decorated.map((d) => d.row);
}
var num3 = (v) => Number(String(v).replace(/\s/g, "").replace(",", ".")) || 0;
var time = (v) => {
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
};
var bool2 = (v) => v === true || v === 1 || v === "1" || v === "true";
var ServerData = class {
  /**
   * @param {object} ajax
   *   url: string (povinné)
   *   method: 'GET'|'POST'  (default GET)
   *   headers: object
   *   params: object                 statické extra parametry
   *   paramNames: { page,size,sort,filter,search,advanced }  přejmenování klíčů (default dle kontraktu)
   *   resolveTokens: bool (default true)     rozvinout relativní datové tokeny v `advanced` před odesláním
   *   requestBuilder(state) -> object        plný override skladby parametrů
   *   responseParser(json) -> { rows,total,lastPage,lastRow }  plný override parsování
   */
  constructor(ajax = {}) {
    if (!ajax.url) throw new Error("Lattice ServerData: chyb\xED `ajax.url`.");
    this.ajax = ajax;
    this.names = Object.assign({ page: "page", size: "size", sort: "sort", filter: "filter", search: "search", advanced: "advanced" }, ajax.paramNames);
  }
  async query({ page, pageSize, paginate, sort, filters, advanced, universal, search, columns }) {
    const state = { page, pageSize, paginate, sort, filters, advanced, universal, search, columns };
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
  buildParams({ page, pageSize, paginate, sort, filters, advanced, universal, search, columns }) {
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
    if (advanced && !isEmptyTree(advanced)) {
      const tree = this.ajax.resolveTokens === false ? advanced : resolveTreeTokens(advanced);
      const method = (this.ajax.method || "GET").toUpperCase();
      params[n.advanced || "advanced"] = method === "GET" ? JSON.stringify(tree) : tree;
    }
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
  help: {
    title: "N\xE1pov\u011Bda \u2014 otev\u0159\xEDt u\u017Eivatelskou p\u0159\xEDru\u010Dku"
  },
  cellFormat: {
    title: "Form\xE1t bu\u0148ky",
    align: "Zarovn\xE1n\xED",
    style: "\u0158ez p\xEDsma",
    bold: "Tu\u010Dn\xE9",
    italic: "Kurz\xEDva",
    underline: "Podtr\u017Een\xE9",
    strike: "P\u0159e\u0161krtnut\xE9",
    textColor: "Barva p\xEDsma",
    bgColor: "Barva pozad\xED",
    clear: "Zru\u0161it form\xE1t"
  },
  bool: {
    title: "Zobrazen\xED Ano/Ne",
    yes: "Ano",
    no: "Ne",
    customTrue: 'Vlastn\xED \u201Eano"',
    customFalse: 'Vlastn\xED \u201Ene"',
    colored: "Barevn\u011B (zelen\xE1/\u010Derven\xE1)",
    reset: "V\xFDchoz\xED (\u2713/\u2715)"
  },
  headerColor: {
    title: "Barva z\xE1hlav\xED",
    tabWheel: "Kolo",
    tabPalette: "Palety",
    brightness: "Jas",
    alpha: "Pr\u016Fhlednost",
    recent: "Naposledy pou\u017Eit\xE9",
    none: "Bez barvy",
    custom: "Vlastn\xED:",
    bg: "Pozad\xED",
    text: "P\xEDsmo",
    apply: "Pou\u017E\xEDt"
  },
  calc: {
    add: "P\u0159idat po\u010D\xEDtan\xFD sloupec",
    newTitle: "Nov\xFD po\u010D\xEDtan\xFD sloupec",
    editTitle: "Upravit po\u010D\xEDtan\xFD sloupec",
    name: "N\xE1zev",
    namePlaceholder: "Nap\u0159. Celkem",
    type: "Typ",
    typeNumber: "\u010C\xEDslo",
    typeText: "Text",
    typeDate: "Datum",
    formula: "Vzorec",
    formulaPlaceholder: "Nap\u0159. cena * mnozstvi   nebo   if(stav == 'hotovo', '\u2713', '\u2014')",
    insertField: "Vlo\u017Eit sloupec:",
    previewLabel: "N\xE1hled:",
    textHint: 'v\xFDsledek je text, zvol typ \u201EText"',
    fnTitle: "Funkce",
    fnSearch: "Hledat funkci\u2026",
    sumFormulaOption: "Vzorec (v\xE1\u017Een\xFD souhrn)",
    sumFormulaTitle: "V\xE1\u017Een\xFD souhrn (vzorec)",
    sumFormulaLabel: "N\xE1zev \u0159\xE1dku",
    sumFormulaLabelPlaceholder: 'nepovinn\xE9 (jinak \u201EVzorec")',
    sumFormulaHint: "Souhrn dopo\u010D\xEDtan\xFD z agregac\xED jin\xFDch sloupc\u016F \u2014 poolovan\u011B. Nap\u0159. sum(spojeno) / sum(vytoceno) * 100.",
    sumFormulaPlaceholder: "Nap\u0159. sum(spojeno) / sum(vytoceno) * 100",
    sumFormulaClear: "Zru\u0161it vzorec",
    fnCat: { num: "\u010C\xEDsla", text: "Text", logic: "Logika", date: "Datum", agg: "Agregace" },
    agg: {
      sum: { sig: "sum(v\xFDraz)", desc: "Sou\u010Det v\xFDrazu p\u0159es \u0159\xE1dky" },
      avg: { sig: "avg(v\xFDraz)", desc: "Pr\u016Fm\u011Br v\xFDrazu p\u0159es \u0159\xE1dky" },
      count: { sig: "count(v\xFDraz)", desc: "Po\u010Det nepr\xE1zdn\xFDch" },
      min: { sig: "min(v\xFDraz)", desc: "Nejmen\u0161\xED hodnota" },
      max: { sig: "max(v\xFDraz)", desc: "Nejv\u011Bt\u0161\xED hodnota" },
      median: { sig: "median(v\xFDraz)", desc: "Medi\xE1n (prost\u0159edn\xED hodnota)" }
    },
    fn: {
      round: { sig: "round(\u010D\xEDslo, des?)", desc: "Zaokrouhl\xED (des = po\u010Det desetinn\xFDch m\xEDst)" },
      floor: { sig: "floor(\u010D\xEDslo)", desc: "Zaokrouhl\xED dol\u016F" },
      ceil: { sig: "ceil(\u010D\xEDslo)", desc: "Zaokrouhl\xED nahoru" },
      abs: { sig: "abs(\u010D\xEDslo)", desc: "Absolutn\xED hodnota" },
      sqrt: { sig: "sqrt(\u010D\xEDslo)", desc: "Druh\xE1 odmocnina" },
      pow: { sig: "pow(z\xE1klad, exponent)", desc: "Mocnina" },
      mod: { sig: "mod(a, b)", desc: "Zbytek po d\u011Blen\xED" },
      min: { sig: "min(a, b, \u2026)", desc: "Nejmen\u0161\xED z hodnot" },
      max: { sig: "max(a, b, \u2026)", desc: "Nejv\u011Bt\u0161\xED z hodnot" },
      number: { sig: "number(x)", desc: "P\u0159evede na \u010D\xEDslo" },
      concat: { sig: "concat(a, b, \u2026)", desc: "Spoj\xED hodnoty do textu" },
      upper: { sig: "upper(text)", desc: "Velk\xE1 p\xEDsmena" },
      lower: { sig: "lower(text)", desc: "Mal\xE1 p\xEDsmena" },
      trim: { sig: "trim(text)", desc: "O\u0159\xEDzne mezery na okraj\xEDch" },
      len: { sig: "len(text)", desc: "Po\u010Det znak\u016F" },
      left: { sig: "left(text, n)", desc: "Prvn\xEDch n znak\u016F" },
      right: { sig: "right(text, n)", desc: "Posledn\xEDch n znak\u016F" },
      substr: { sig: "substr(text, od, d\xE9lka?)", desc: "\u010C\xE1st textu od pozice (od 0)" },
      replace: { sig: "replace(text, co, \u010D\xEDm)", desc: "Nahrad\xED v\u0161echny v\xFDskyty" },
      contains: { sig: "contains(text, co)", desc: "Obsahuje text? (ano/ne)" },
      text: { sig: "text(x)", desc: "P\u0159evede na text" },
      if: { sig: "if(podm\xEDnka, ano, ne)", desc: 'Podle podm\xEDnky vr\xE1t\xED \u201Eano", nebo \u201Ene"' },
      coalesce: { sig: "coalesce(a, b, \u2026)", desc: "Prvn\xED nepr\xE1zdn\xE1 hodnota" },
      isblank: { sig: "isblank(x)", desc: "Je pr\xE1zdn\xE9? (ano/ne)" },
      not: { sig: "not(x)", desc: "Logick\xE1 negace" },
      today: { sig: "today()", desc: "Dne\u0161n\xED datum" },
      now: { sig: "now()", desc: "Datum a \u010Das te\u010F" },
      date: { sig: "date(x)", desc: "P\u0159evede na datum" },
      year: { sig: "year(datum)", desc: "Rok z data" },
      month: { sig: "month(datum)", desc: "M\u011Bs\xEDc z data (1\u201312)" },
      day: { sig: "day(datum)", desc: "Den v m\u011Bs\xEDci" },
      weekday: { sig: "weekday(datum)", desc: "Den v t\xFDdnu (1=Po \u2026 7=Ne)" },
      days: { sig: "days(od, do)", desc: "Po\u010Det dn\xED mezi daty" },
      age: { sig: "age(datum)", desc: "V\u011Bk v letech k dne\u0161ku" }
    },
    defaultTitle: "V\xFDpo\u010Det",
    save: "Ulo\u017Eit",
    cancel: "Zru\u0161it",
    delete: "Smazat"
  },
  columns: {
    manage: "Sloupce",
    reset: "Obnovit v\xFDchoz\xED",
    filterToggle: "Zobrazit / skr\xFDt filtr",
    groupSet: "Skupina sloupce",
    collapseGroup: "Sbalit skupinu sloupc\u016F",
    expandGroup: "Rozbalit skupinu sloupc\u016F",
    headerColor: "Barva z\xE1hlav\xED sloupce",
    groupHeaderColor: "Barva z\xE1hlav\xED skupiny",
    cellFormat: "Form\xE1t bu\u0148ky",
    renameHint: "dvojklik p\u0159ejmenuje",
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
    scopePage: "Str\xE1nka ({n})",
    scopeAll: "V\u0161echny z\xE1znamy ({n})",
    scopePageLong: "Zobrazen\xE1 str\xE1nka",
    scopeAllLong: "V\u0161echny z\xE1znamy",
    scopeToggle: "P\u0159epnout rozsah souhrnu (zobrazen\xE1 str\xE1nka / v\u0161echny z\xE1znamy)",
    barLabel: "Souhrn po\u010D\xEDt\xE1 z:",
    formulaLabel: "Vzorec",
    name: { sum: "Sou\u010Det", avg: "Pr\u016Fm\u011Br", min: "Minimum", max: "Maximum", count: "Po\u010Det" }
  },
  versionTitle: "Verze knihovny Lattice",
  about: {
    title: "O Lattice",
    lead: "Lattice je modern\xED, \u0161t\xEDhl\xE1 datov\xE1 tabulka ve vanilla JS \u2014 bez framework\u016F a bez z\xE1vislost\xED. \u0158azen\xED, filtry, seskupen\xED, souhrny, editace, export, presety a sd\xEDlen\xE9 pohledy; v\u0161echno, co si naklik\xE1\u0161, se pamatuje.",
    author: "Autor",
    license: "Licence",
    manual: "U\u017Eivatelsk\xE1 p\u0159\xEDru\u010Dka",
    demo: "Uk\xE1zky a dokumentace",
    github: "GitHub (zdrojov\xFD k\xF3d)",
    releases: "Vyd\xE1n\xED",
    releasesHint: "co kter\xE9 p\u0159ineslo",
    toggleDetails: "Uk\xE1zat/skr\xFDt, co vyd\xE1n\xED p\u0159ineslo",
    current: "pou\u017E\xEDv\xE1\u0161",
    fullChangelog: "\xDApln\xFD seznam zm\u011Bn (CHANGELOG)"
  },
  presets: {
    none: "(\u017E\xE1dn\xE9 ulo\u017Een\xE9 pohledy)",
    namePlaceholder: "N\xE1zev pohledu\u2026",
    saveLocal: "Ulo\u017Eit pohled (jen pro m\u011B)",
    saveGlobal: "Ulo\u017Eit glob\xE1ln\u011B (pro v\u0161echny)",
    searchColumn: "Hledat sloupec\u2026",
    global: "Glob\xE1ln\xED pohled",
    partsLabel: "Ulo\u017Eit do pohledu:",
    partColumns: "Sloupce",
    partColumnsHint: "Po\u0159ad\xED, viditelnost, \u0161\xED\u0159ky, ukotven\xED, souhrny, form\xE1ty a barvy sloupc\u016F.",
    partFilters: "Filtry a \u0159azen\xED",
    partFiltersHint: "Hodnoty filtr\u016F v z\xE1hlav\xED a nastaven\xE9 \u0159azen\xED.",
    partInstance: "Nastaven\xED tabulky",
    partInstanceHint: "Seskupen\xED \u0159\xE1dk\u016F, souhrnn\xFD \u0159\xE1dek, mezisou\u010Dty skupin, str\xE1nkov\xE1n\xED, vzhled a form\xE1t hodnot.",
    partsNone: "nic",
    asButton: "tla\u010D\xEDtko",
    asButtonHint: "Zobrazit tento pohled jako tla\u010D\xEDtko v \u0159ad\u011B nad ikonami (klik = pou\u017E\xEDt).",
    asSelect: "v\xFDb\u011Br",
    asSelectHint: "Nab\xEDdnout tento pohled v rozbalovac\xEDm v\xFDb\u011Bru pohled\u016F v z\xE1hlav\xED tabulky."
  },
  quickbar: {
    presets: "Pohledy",
    filters: "Filtry",
    globalPreset: "Glob\xE1ln\xED pohled",
    myPreset: "M\u016Fj pohled",
    globalFilter: "Glob\xE1ln\xED filtr",
    myFilter: "M\u016Fj filtr",
    presetsPlaceholder: "\u2014 pohledy \u2014",
    presetOn: "Klik = pou\u017E\xEDt pohled",
    presetOff: "Klik = zp\u011Bt na v\xFDchoz\xED zobrazen\xED (filtry z\u016Fstanou)",
    filterToggle: "Klik = zapnout/vypnout",
    applyPreset: "Pou\u017E\xEDt pohled",
    resetView: "Zp\u011Bt na v\xFDchoz\xED zobrazen\xED",
    applyFilter: "Zapnout filtr",
    clearFilter: "Vypnout filtr",
    menuHint: "prav\xFD klik = upravit, smazat, kde zobrazit",
    edit: "Upravit\u2026",
    showButton: "Zobrazit jako tla\u010D\xEDtko",
    showSelect: "Zobrazit ve v\xFDb\u011Bru",
    delete: "Smazat"
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
    cssRowHighlight: "Zv\xFDrazn\u011Bn\xED \u0159\xE1dku",
    cssRowHighlightHover: "Zv\xFDrazn\u011Bn\xED p\u0159i najet\xED",
    cssHeaderWeight: "Tu\u010Dnost z\xE1hlav\xED",
    cssRadius: "Zaoblen\xED (px)",
    cssCellPadY: "Padding bu\u0148ky \u2013 svisle (px)",
    cssCellPadX: "Padding bu\u0148ky \u2013 vodorovn\u011B (px)",
    cssReset: "Obnovit vlastn\xED \xFApravy",
    fontFamily: "P\xEDsmo",
    fontDefault: "Dle motivu",
    zebra: "Pruhovan\xE9 \u0159\xE1dky",
    showVersion: "Verze knihovny v pati\u010Dce",
    scaleColors: "Barvy \u0161k\xE1ly (semafor)",
    wrapText: "Zalamovat text",
    wrapHeader: "Zalamovat n\xE1zvy sloupc\u016F",
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
    rowHighlight: "Zv\xFDrazn\u011Bn\xED \u0159\xE1dku klikem",
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
    dynamic: "Dynamick\xE9",
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
    dynamicPlaceholder: ">today-14 AND <today+14",
    dynamicHint: 'Oper\xE1tory >, <, >=, <=, =. Datum absolutn\u011B (2024-01-31) nebo relativn\u011B: today, today\xB1N (d/w/m/y), now; hranice obdob\xED sow/eow (t\xFDden Po\u2013Ne), som/eom (m\u011Bs\xEDc), soy/eoy (rok) \u2014 i s offsetem (sow-1w). Spojky AND / OR. Klikni na \u201E?" pro rychl\xE1 obdob\xED.',
    dynamicHelp: {
      title: "N\xE1pov\u011Bda a rychl\xE1 obdob\xED",
      periods: "Rychl\xE1 obdob\xED",
      syntax: "Z\xE1pis",
      tokens: "today, today\xB1N (d/w/m/y), now \xB7 sow/eow = za\u010D\xE1tek/konec t\xFDdne (Po\u2013Ne) \xB7 som/eom = m\u011Bs\xEDc \xB7 soy/eoy = rok \xB7 offset: sow-1w, eom-1m \xB7 oper\xE1tory > < >= <= = \xB7 spojky AND / OR",
      r: {
        today: "Dnes",
        d7: "Posledn\xEDch 7 dn\xED",
        thisWeek: "Tento t\xFDden",
        lastWeek: "Minul\xFD t\xFDden",
        thisMonth: "Tento m\u011Bs\xEDc",
        lastMonth: "Minul\xFD m\u011Bs\xEDc",
        thisYear: "Letos"
      }
    },
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
    dynamic: "dynamick\xE9 obdob\xED",
    dynamicHint: 'Zapnuto: preset se ulo\u017E\xED relativn\u011B (nap\u0159. \u201Eminul\xFD t\xFDden") a p\u0159epo\u010D\xEDt\xE1v\xE1 se \u2014 ulo\u017Een\xFD filtr z\u016Fstane platn\xFD i p\u0159\xED\u0161t\u011B. Vypnuto: preset nastav\xED pevn\xE1 data.',
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
    valueHint: "Relativn\xED datum: today, today+14, today-7, today+2w, +1m, -1y, now (jednotky d/w/m/y)",
    addCondition: "Podm\xEDnka",
    addGroup: "Skupina",
    and: "A z\xE1rove\u0148 (v\u0161e)",
    or: "Nebo (aspo\u0148 jedno)",
    apply: "Pou\u017E\xEDt",
    clear: "Vymazat filtr",
    save: "Ulo\u017Eit",
    saveGlobal: "Ulo\u017Eit glob\xE1ln\u011B",
    asButton: "tla\u010D\xEDtko",
    asButtonHint: "Zobrazit tento ulo\u017Een\xFD filtr jako tla\u010D\xEDtko vlevo od filtra\u010Dn\xEDch ikon (klik = zapnout/vypnout).",
    asSelect: "v\xFDb\u011Br",
    asSelectHint: "Nab\xEDdnout tento filtr v rozbalovac\xEDm v\xFDb\u011Bru ulo\u017Een\xFDch filtr\u016F v z\xE1hlav\xED tabulky.",
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
  saveFilters: {
    title: "Ulo\u017Eit sloupcov\xE9 filtry",
    manage: "Ulo\u017Een\xE9 filtry",
    hint: "Nastav filtry v hlavi\u010Dce tabulky a tady je ulo\u017E\xED\u0161 pod n\xE1zvem.",
    edit: "Na\u010D\xEDst do hlavi\u010Dky a upravit",
    overwrite: "P\u0159epsat tento filtr aktu\xE1ln\xEDmi filtry z hlavi\u010Dky",
    overwriteDisabled: "Nejd\u0159\xEDv nastav filtry v hlavi\u010Dce tabulky",
    rename: "P\u0159ejmenovat (jde i dvojklikem na n\xE1zev)",
    namePlaceholder: "N\xE1zev filtru\u2026",
    asButton: "tla\u010D\xEDtko",
    asButtonHint: "Zobrazit tento ulo\u017Een\xFD filtr jako tla\u010D\xEDtko vlevo od filtra\u010Dn\xEDch ikon (klik = zapnout/vypnout).",
    asSelect: "v\xFDb\u011Br",
    asSelectHint: "Nab\xEDdnout tento filtr v rozbalovac\xEDm v\xFDb\u011Bru ulo\u017Een\xFDch filtr\u016F v z\xE1hlav\xED tabulky.",
    save: "Ulo\u017Eit",
    saveGlobal: "Ulo\u017Eit glob\xE1ln\u011B",
    none: "Zat\xEDm \u017E\xE1dn\xE9 ulo\u017Een\xE9",
    apply: "Pou\u017E\xEDt filtr",
    delete: "Smazat ulo\u017Een\xFD filtr"
  },
  universal: { field: "Pole", type: "Typ", valueLabel: "Hodnota", value: "hodnota k filtrov\xE1n\xED\u2026", clear: "Zru\u0161it filtr" },
  group: {
    empty: "(pr\xE1zdn\xE9)",
    weekLabel: "T\xFDden",
    sort: "Se\u0159adit skupiny (vzestupn\u011B/sestupn\u011B)",
    by: "Seskupit podle",
    display: "\xDArovn\u011B seskupen\xED",
    displayHeaders: "Vno\u0159en\xE9 hlavi\u010Dky",
    displayColumns: "Vedouc\xED sloupce",
    repeat: "Opakovat hodnoty skupin v \u0159\xE1dc\xEDch",
    parts: { year: "Rok", quarter: "Kvart\xE1l", month: "M\u011Bs\xEDc", week: "T\xFDden", weekday: "Den v t\xFDdnu", day: "Den v m\u011Bs\xEDci", hour: "Hodina", minute: "Minuta" }
  },
  select: { scopePage: "Str\xE1nka ({n})", scopeAll: "V\u0161echny z\xE1znamy ({n})", invert: "Invertovat v\xFDb\u011Br", none: "Zru\u0161it v\xFDb\u011Br", menu: "Rozsah a mo\u017Enosti v\xFDb\u011Bru" },
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
  help: {
    title: "Help \u2014 open the user guide"
  },
  cellFormat: {
    title: "Cell format",
    align: "Alignment",
    style: "Font style",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    strike: "Strikethrough",
    textColor: "Text color",
    bgColor: "Background color",
    clear: "Clear format"
  },
  bool: {
    title: "Yes/No display",
    yes: "Yes",
    no: "No",
    customTrue: "Custom \u201Cyes\u201D",
    customFalse: "Custom \u201Cno\u201D",
    colored: "Colored (green/red)",
    reset: "Default (\u2713/\u2715)"
  },
  headerColor: {
    title: "Header color",
    tabWheel: "Wheel",
    tabPalette: "Palettes",
    brightness: "Brightness",
    alpha: "Opacity",
    recent: "Recently used",
    none: "No color",
    custom: "Custom:",
    bg: "Background",
    text: "Text",
    apply: "Apply"
  },
  calc: {
    add: "Add computed column",
    newTitle: "New computed column",
    editTitle: "Edit computed column",
    name: "Name",
    namePlaceholder: "e.g. Total",
    type: "Type",
    typeNumber: "Number",
    typeText: "Text",
    typeDate: "Date",
    formula: "Formula",
    formulaPlaceholder: "e.g. price * qty   or   if(status == 'done', '\u2713', '\u2014')",
    insertField: "Insert column:",
    previewLabel: "Preview:",
    textHint: "result is text, pick type \u201CText\u201D",
    fnTitle: "Functions",
    fnSearch: "Search function\u2026",
    sumFormulaOption: "Formula (weighted total)",
    sumFormulaTitle: "Weighted total (formula)",
    sumFormulaLabel: "Row label",
    sumFormulaLabelPlaceholder: "optional (defaults to \u201CFormula\u201D)",
    sumFormulaHint: "Total computed from aggregates of other columns \u2014 pooled. E.g. sum(connected) / sum(dialed) * 100.",
    sumFormulaPlaceholder: "e.g. sum(connected) / sum(dialed) * 100",
    sumFormulaClear: "Clear formula",
    fnCat: { num: "Numbers", text: "Text", logic: "Logic", date: "Date", agg: "Aggregate" },
    agg: {
      sum: { sig: "sum(expr)", desc: "Sum of expression across rows" },
      avg: { sig: "avg(expr)", desc: "Average of expression across rows" },
      count: { sig: "count(expr)", desc: "Count of non-empty" },
      min: { sig: "min(expr)", desc: "Smallest value" },
      max: { sig: "max(expr)", desc: "Largest value" },
      median: { sig: "median(expr)", desc: "Median (middle value)" }
    },
    fn: {
      round: { sig: "round(num, dec?)", desc: "Round (dec = number of decimals)" },
      floor: { sig: "floor(num)", desc: "Round down" },
      ceil: { sig: "ceil(num)", desc: "Round up" },
      abs: { sig: "abs(num)", desc: "Absolute value" },
      sqrt: { sig: "sqrt(num)", desc: "Square root" },
      pow: { sig: "pow(base, exp)", desc: "Power" },
      mod: { sig: "mod(a, b)", desc: "Remainder after division" },
      min: { sig: "min(a, b, \u2026)", desc: "Smallest value" },
      max: { sig: "max(a, b, \u2026)", desc: "Largest value" },
      number: { sig: "number(x)", desc: "Convert to number" },
      concat: { sig: "concat(a, b, \u2026)", desc: "Join values into text" },
      upper: { sig: "upper(text)", desc: "Uppercase" },
      lower: { sig: "lower(text)", desc: "Lowercase" },
      trim: { sig: "trim(text)", desc: "Trim surrounding spaces" },
      len: { sig: "len(text)", desc: "Character count" },
      left: { sig: "left(text, n)", desc: "First n characters" },
      right: { sig: "right(text, n)", desc: "Last n characters" },
      substr: { sig: "substr(text, start, len?)", desc: "Part of text from position (0-based)" },
      replace: { sig: "replace(text, from, to)", desc: "Replace all occurrences" },
      contains: { sig: "contains(text, sub)", desc: "Contains text? (yes/no)" },
      text: { sig: "text(x)", desc: "Convert to text" },
      if: { sig: "if(cond, yes, no)", desc: "Return yes or no by condition" },
      coalesce: { sig: "coalesce(a, b, \u2026)", desc: "First non-empty value" },
      isblank: { sig: "isblank(x)", desc: "Is empty? (yes/no)" },
      not: { sig: "not(x)", desc: "Logical negation" },
      today: { sig: "today()", desc: "Today's date" },
      now: { sig: "now()", desc: "Date and time now" },
      date: { sig: "date(x)", desc: "Convert to date" },
      year: { sig: "year(date)", desc: "Year from date" },
      month: { sig: "month(date)", desc: "Month from date (1\u201312)" },
      day: { sig: "day(date)", desc: "Day of month" },
      weekday: { sig: "weekday(date)", desc: "Weekday (1=Mon \u2026 7=Sun)" },
      days: { sig: "days(from, to)", desc: "Days between dates" },
      age: { sig: "age(date)", desc: "Age in years to today" }
    },
    defaultTitle: "Computed",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete"
  },
  columns: {
    manage: "Columns",
    reset: "Reset to default",
    filterToggle: "Show / hide filter",
    groupSet: "Column group",
    collapseGroup: "Collapse column group",
    expandGroup: "Expand column group",
    headerColor: "Column header color",
    groupHeaderColor: "Group header color",
    cellFormat: "Cell format",
    renameHint: "double-click to rename",
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
    scopePage: "Page ({n})",
    scopeAll: "All records ({n})",
    scopePageLong: "Displayed page",
    scopeAllLong: "All records",
    scopeToggle: "Toggle summary scope (displayed page / all records)",
    barLabel: "Summary from:",
    formulaLabel: "Formula",
    name: { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum", count: "Count" }
  },
  versionTitle: "Lattice library version",
  about: {
    title: "About Lattice",
    lead: "Lattice is a modern, lean data grid in vanilla JS \u2014 no frameworks, no dependencies. Sorting, filters, grouping, summaries, editing, export, presets and shared views; everything you set up is remembered.",
    author: "Author",
    license: "License",
    manual: "User manual",
    demo: "Examples and documentation",
    github: "GitHub (source code)",
    releases: "Releases",
    releasesHint: "what each one brought",
    toggleDetails: "Show/hide what the release brought",
    current: "in use",
    fullChangelog: "Full changelog"
  },
  presets: {
    none: "(no saved views)",
    namePlaceholder: "View name\u2026",
    saveLocal: "Save view (only me)",
    saveGlobal: "Save globally (everyone)",
    searchColumn: "Search column\u2026",
    global: "Global view",
    partsLabel: "Save into view:",
    partColumns: "Columns",
    partColumnsHint: "Order, visibility, widths, freezing, summaries, formats and header colors.",
    partFilters: "Filters & sorting",
    partFiltersHint: "Header filter values and the current sorting.",
    partInstance: "Table settings",
    partInstanceHint: "Row grouping, summary row, group subtotals, pagination, appearance and value formats.",
    partsNone: "nothing",
    asButton: "button",
    asButtonHint: "Show this view as a button in the row above the icons (click to apply).",
    asSelect: "select",
    asSelectHint: "Offer this view in the views dropdown in the table header."
  },
  quickbar: {
    presets: "Views",
    filters: "Filters",
    globalPreset: "Global view",
    myPreset: "My view",
    globalFilter: "Global filter",
    myFilter: "My filter",
    presetsPlaceholder: "\u2014 views \u2014",
    presetOn: "Click to apply the view",
    presetOff: "Click to return to the default view (filters stay)",
    filterToggle: "Click to toggle on/off",
    applyPreset: "Apply view",
    resetView: "Back to the default view",
    applyFilter: "Turn the filter on",
    clearFilter: "Turn the filter off",
    menuHint: "right-click for edit, delete, where to show",
    edit: "Edit\u2026",
    showButton: "Show as button",
    showSelect: "Show in the select",
    delete: "Delete"
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
    cssRowHighlight: "Row highlight",
    cssRowHighlightHover: "Row highlight hover",
    cssHeaderWeight: "Header weight",
    cssRadius: "Corner radius (px)",
    cssCellPadY: "Cell padding \u2013 vertical (px)",
    cssCellPadX: "Cell padding \u2013 horizontal (px)",
    cssReset: "Reset custom tweaks",
    fontFamily: "Font",
    fontDefault: "Theme default",
    zebra: "Zebra rows",
    showVersion: "Library version in the footer",
    scaleColors: "Scale colors (traffic light)",
    wrapText: "Wrap text",
    wrapHeader: "Wrap column titles",
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
    rowHighlight: "Highlight row on click",
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
    dynamic: "Dynamic",
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
    dynamicPlaceholder: ">today-14 AND <today+14",
    dynamicHint: 'Operators >, <, >=, <=, =. Absolute date (2024-01-31) or relative: today, today\xB1N (d/w/m/y), now; period bounds sow/eow (week Mon\u2013Sun), som/eom (month), soy/eoy (year) \u2014 also with offset (sow-1w). Joiners AND / OR. Click "?" for quick periods.',
    dynamicHelp: {
      title: "Help and quick periods",
      periods: "Quick periods",
      syntax: "Syntax",
      tokens: "today, today\xB1N (d/w/m/y), now \xB7 sow/eow = start/end of week (Mon\u2013Sun) \xB7 som/eom = month \xB7 soy/eoy = year \xB7 offset: sow-1w, eom-1m \xB7 operators > < >= <= = \xB7 joiners AND / OR",
      r: {
        today: "Today",
        d7: "Last 7 days",
        thisWeek: "This week",
        lastWeek: "Last week",
        thisMonth: "This month",
        lastMonth: "Last month",
        thisYear: "This year"
      }
    },
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
    dynamic: "dynamic period",
    dynamicHint: "On: the preset is stored relatively (e.g. \u201Clast week\u201D) and recomputed \u2014 a saved filter stays valid over time. Off: the preset sets fixed dates.",
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
    valueHint: "Relative date: today, today+14, today-7, today+2w, +1m, -1y, now (units d/w/m/y)",
    addCondition: "Condition",
    addGroup: "Group",
    and: "And (all)",
    or: "Or (any)",
    apply: "Apply",
    clear: "Clear filter",
    save: "Save",
    saveGlobal: "Save globally",
    asButton: "button",
    asButtonHint: "Show this saved filter as a button left of the filter icons (click to toggle on/off).",
    asSelect: "select",
    asSelectHint: "Offer this filter in the saved-filters dropdown in the table header.",
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
  saveFilters: {
    title: "Save column filters",
    manage: "Saved filters",
    hint: "Set filters in the table header and save them here under a name.",
    edit: "Load into the header and edit",
    overwrite: "Overwrite this filter with the current header filters",
    overwriteDisabled: "Set filters in the table header first",
    rename: "Rename (double-clicking the name works too)",
    namePlaceholder: "Filter name\u2026",
    asButton: "button",
    asButtonHint: "Show this saved filter as a button left of the filter icons (click to toggle on/off).",
    asSelect: "select",
    asSelectHint: "Offer this filter in the saved-filters dropdown in the table header.",
    save: "Save",
    saveGlobal: "Save globally",
    none: "Nothing saved yet",
    apply: "Apply filter",
    delete: "Delete saved filter"
  },
  universal: { field: "Field", type: "Type", valueLabel: "Value", value: "value to filter\u2026", clear: "Clear filter" },
  group: {
    empty: "(empty)",
    weekLabel: "Week",
    sort: "Sort groups (ascending/descending)",
    by: "Group by",
    display: "Grouping levels",
    displayHeaders: "Nested headers",
    displayColumns: "Leading columns",
    repeat: "Repeat group values in rows",
    parts: { year: "Year", quarter: "Quarter", month: "Month", week: "Week", weekday: "Weekday", day: "Day of month", hour: "Hour", minute: "Minute" }
  },
  select: { scopePage: "Page ({n})", scopeAll: "All records ({n})", invert: "Invert selection", none: "Clear selection", menu: "Selection scope & options" },
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
function toDate3(v) {
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
  const d = toDate3(v);
  return d ? formatDate(d, effFmt(col, "date").pattern, col._i18n) : "";
});
registerType("datetime", (v, col) => {
  const d = toDate3(v);
  return d ? formatDate(d, effFmt(col, "datetime").pattern, col._i18n) : "";
});
registerType("time", (v, col) => {
  const d = toDate3(v);
  return d ? formatDate(d, effFmt(col, "time").pattern, col._i18n) : "";
});
function boolDisplay(col) {
  const p = col && col.format || col && col.formatterParams || {};
  return {
    trueText: p.trueText != null ? p.trueText : "\u2713",
    falseText: p.falseText != null ? p.falseText : "\u2715",
    plain: !!p.plain
  };
}
function isTruthy(v) {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "ano" || s === "yes";
  }
  return false;
}
registerType("boolean", (v, col) => {
  const truthy = isTruthy(v);
  const d = boolDisplay(col);
  const span = document.createElement("span");
  span.className = "lattice-bool " + (truthy ? "is-true" : "is-false") + (d.plain ? " is-plain" : "");
  span.textContent = truthy ? d.trueText : d.falseText;
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
registerType("tick", (v, col) => {
  if (!isTruthy(v)) return "";
  const d = boolDisplay(col);
  const span = document.createElement("span");
  span.className = "lattice-bool is-true" + (d.plain ? " is-plain" : "");
  span.textContent = d.trueText;
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
function attachGroupResize(handle, col, grid, id) {
  let startX = 0, startWidth = 0, dragging = false, pending = 0, guide = null, tableLeft = 0;
  const setWidth = (w) => {
    if (!grid.instance.groupColWidths) grid.instance.groupColWidths = {};
    grid.instance.groupColWidths[id] = w;
    grid.renderer.applyLayout();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(col.minWidth, Math.round(startWidth + (e.clientX - startX)));
    pending = w;
    if (guide) moveGuide(guide, startX + (w - startWidth) - tableLeft);
    else setWidth(w);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("lattice-resizing");
    if (guide) {
      setWidth(pending);
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
      setWidth(w);
      grid.saveState();
    }
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
  const host = grid.renderer.nodes.root || table;
  const meas = document.createElement("div");
  meas.setAttribute("aria-hidden", "true");
  meas.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;";
  host.appendChild(meas);
  const cellH = cells[0]?.clientHeight || 0;
  const rot = col.headerRotate != null ? col.headerRotate : grid.instance.headerRotate;
  const rotated = rot === "90" || rot === "270";
  const wrapHeader = grid.instance.wrapHeader === true && !rotated;
  let max = 0;
  try {
    if (hcell) {
      const one = measureRendered(meas, hcell, cellH);
      max = Math.max(max, wrapHeader ? measureWrappedHeaderWidth(meas, hcell, one) : one);
    }
    for (const cell of cells) max = Math.max(max, measureRendered(meas, cell, cellH));
  } finally {
    meas.remove();
  }
  const RESERVE = 4;
  let w = Math.ceil(max) + RESERVE;
  if (col.minWidth) w = Math.max(w, col.minWidth);
  if (col.maxWidth) w = Math.min(w, col.maxWidth);
  return w;
}
function measureRendered(meas, srcNode, cellH) {
  const clone2 = srcNode.cloneNode(true);
  clone2.querySelectorAll?.(".lattice-resize-handle").forEach((h) => h.remove());
  const s = clone2.style;
  s.width = "auto";
  s.maxWidth = "none";
  s.minWidth = "0";
  s.flex = "0 0 auto";
  s.display = "inline-flex";
  s.alignItems = "center";
  s.whiteSpace = "nowrap";
  s.overflow = "visible";
  s.textOverflow = "clip";
  if (cellH) s.height = cellH + "px";
  clone2.querySelectorAll?.(".lattice-link").forEach((a) => {
    a.style.width = "auto";
    a.style.display = "inline-flex";
  });
  meas.appendChild(clone2);
  const w = clone2.getBoundingClientRect().width;
  meas.removeChild(clone2);
  return w;
}
function measureWrappedHeaderWidth(meas, hcell, oneLineWidth) {
  const clone2 = hcell.cloneNode(true);
  clone2.querySelectorAll?.(".lattice-resize-handle").forEach((h) => h.remove());
  const title = clone2.querySelector(".lattice-hcell-title");
  const s = clone2.style;
  s.maxWidth = "none";
  s.minWidth = "0";
  s.flex = "0 0 auto";
  s.display = "flex";
  s.alignItems = "center";
  s.overflow = "visible";
  s.height = "auto";
  if (title) {
    title.style.whiteSpace = "normal";
    title.style.overflowWrap = "break-word";
    title.style.overflow = "visible";
  }
  meas.appendChild(clone2);
  try {
    clone2.style.width = Math.ceil(oneLineWidth) + "px";
    const oneLineH = clone2.getBoundingClientRect().height;
    if (!oneLineH) return Math.ceil(oneLineWidth);
    const limit = oneLineH * 2 - 1;
    let lo = 24;
    if (title) {
      const saved = title.style.overflowWrap;
      title.style.overflowWrap = "normal";
      clone2.style.width = "min-content";
      lo = Math.ceil(clone2.getBoundingClientRect().width);
      title.style.overflowWrap = saved;
    }
    let hi = Math.ceil(oneLineWidth);
    if (lo >= hi) return hi;
    for (let i = 0; i < 14 && lo < hi; i++) {
      const mid = lo + hi >> 1;
      clone2.style.width = mid + "px";
      if (clone2.getBoundingClientRect().height <= limit) hi = mid;
      else lo = mid + 1;
    }
    return hi;
  } finally {
    meas.removeChild(clone2);
  }
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
    const grouped = new Set(grid.groupActive() ? grid.groupedRawFields() : []);
    this._menuIdField = null;
    if (grid.hasActions() && grid.instance.actionsLayout === "menu" && !rn) {
      const idCol = grid.columns.find((c) => c.visible && c.type === "id" && !grouped.has(c.field));
      if (idCol) this._menuIdField = idCol.field;
      else left.push(this.rowNumberColumn(true));
    }
    if (grid.groupActive()) {
      for (const gc of this.groupLevelColumns()) left.push(gc);
    }
    const collapsed = grid.responsive && this._collapsed ? this._collapsed : null;
    const colGroupsCollapsed = grid.colGroupsCollapsed;
    const emittedColGroup = /* @__PURE__ */ new Set();
    this._collapsedCols = [];
    for (const c of grid.columns) {
      if (!c.visible) continue;
      if (grouped.has(c.field)) continue;
      const cg = c.group || null;
      if (cg && colGroupsCollapsed && colGroupsCollapsed.has(cg)) {
        if (emittedColGroup.has(cg)) continue;
        emittedColGroup.add(cg);
        const strip = this.colGroupStrip(c);
        if (strip.frozen === "right") right.push(strip);
        else if (strip.frozen) left.push(strip);
        else mid.push(strip);
        continue;
      }
      if (c.frozen === "right") right.push(c);
      else if (c.frozen) left.push(c);
      else if (collapsed && collapsed.has(c.field)) this._collapsedCols.push(c);
      else mid.push(c);
    }
    if (grid.hasActions() && grid.instance.actionsLayout === "column") right.push(this.actionsColumn());
    for (const rs of this.rowSummaryColumns()) right.push(rs);
    return { list: [...left, ...mid, ...right], left, mid, right };
  }
  /**
   * Vedoucí syntetické sloupce pro režim 'columns' — jeden na každou úroveň
   * seskupení, vlevo a ukotvené, s hodnotou kbelíku (rok/kvartál/…) na řádku.
   */
  groupLevelColumns() {
    const grid = this.grid;
    const i18n = grid.i18n;
    const widths = grid.instance.groupColWidths || {};
    return grid.groupDescriptors().map((desc) => {
      const col = grid.columns.find((c) => c.field === desc.field);
      const title = col ? this.groupLevelTitle({ part: desc.part }, col) : desc.field;
      return {
        // Sloupec je syntetický (vzniká znovu při každém renderColumns), takže šířka
        // nemůže žít na něm — bere se z instance (a tím se i persistuje / nese v pohledu).
        field: "__group__" + desc.id,
        title,
        type: "text",
        filter: null,
        group: null,
        headerSort: false,
        frozen: "left",
        frozenAllowed: false,
        visible: true,
        minWidth: 90,
        width: widths[desc.id] || 130,
        align: "left",
        availableFilters: [],
        filterEnabled: false,
        _groupCol: desc,
        formatter: (_v, _col, row) => {
          if (grid.instance.groupRepeat === false && grid.instance.groupDisplay !== "columns") return "";
          const raw = row ? row[desc.field] : null;
          if (!desc.part) return raw == null ? "" : String(raw);
          const b = dateBucket(raw, desc.part, i18n);
          return b ? b.label : "";
        }
      };
    });
  }
  /**
   * Zástupný (úzký) sloupec pro SBALENOU skupinu sloupců. Drží pozici i frozen
   * stranu podle prvního člena; tělo je prázdné, záhlaví skupiny nad ním nese
   * ikonu pro rozbalení.
   */
  colGroupStrip(member) {
    const g = member.group;
    return {
      field: "\0cg:" + g,
      title: g,
      type: "text",
      group: g,
      defaultGroup: g,
      filter: null,
      filterEnabled: false,
      availableFilters: [],
      headerSort: false,
      frozen: member.frozen || false,
      frozenAllowed: false,
      visible: true,
      align: "center",
      minWidth: COLGROUP_STRIP_W,
      width: COLGROUP_STRIP_W,
      headerRotate: null,
      summary: [],
      rowSummary: [],
      summaryFormula: null,
      formatter: null,
      value: null,
      _colGroupStrip: true,
      _colGroup: g,
      groupHeaderBackground: member.groupHeaderBackground || null,
      groupHeaderColor: member.groupHeaderColor || null
    };
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
      const targets = list.filter((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._colGroupStrip);
      const flex = targets.length ? targets : list;
      const extra = vpWidth - total;
      const base = flex.reduce((s, c) => s + widths.get(c.field), 0) || 1;
      for (const c of flex) widths.set(c.field, widths.get(c.field) + extra * (widths.get(c.field) / base));
    } else if (mode === "fitDataStretch") {
      const last = [...list].reverse().find((c) => !c.frozen && !c._rownum && !c._select && !c._move && !c._actions && !c._actionsMenu && !c._colGroupStrip);
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
    this._groupHeaderStyle = /* @__PURE__ */ new Map();
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
      const cell = el("div.lattice-gcell", { dataset: { fields: members.map((m) => m.field).join(",") } });
      if (g) {
        const t = this.grid.i18n.t.bind(this.grid.i18n);
        const collapsed = this.grid.isColGroupCollapsed(g);
        cell.title = g;
        cell.classList.toggle("is-col-collapsed", collapsed);
        const styled = members.find((m) => m.groupHeaderBackground || m.groupHeaderColor) || members[0];
        if (styled.groupHeaderBackground) cell.style.background = styled.groupHeaderBackground;
        if (styled.groupHeaderColor) cell.style.color = styled.groupHeaderColor;
        if (styled.groupHeaderBackground || styled.groupHeaderColor) {
          this._groupHeaderStyle.set(g, { bg: styled.groupHeaderBackground, color: styled.groupHeaderColor });
        }
        const tgl = el("button.lattice-gcell-toggle", {
          type: "button",
          title: collapsed ? t("columns.expandGroup") : t("columns.collapseGroup"),
          text: collapsed ? "+" : "\u2212",
          class: collapsed ? "is-collapsed" : ""
        });
        tgl.addEventListener("mousedown", (e) => e.stopPropagation());
        tgl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.grid.toggleColGroup(g);
        });
        cell.appendChild(tgl);
        cell.appendChild(el("span.lattice-gcell-title", { text: g }));
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
    if (col._colGroupStrip) {
      return el("div.lattice-hcell.lattice-colgroup-striph", { dataset: { field: col.field }, class: "is-center" });
    }
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
        const scopeLabel = grid.selectScope === "all" ? grid.i18n.t("select.scopeAll", { n: grid.filteredCount() }) : grid.i18n.t("select.scopePage", { n: grid.pageCount() });
        const cb = el("input.lattice-select-all", { type: "checkbox", title: scopeLabel });
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          grid.toggleScopeSelection();
        });
        cell2.appendChild(cb);
        const caret = el("button.lattice-select-menu", { type: "button", title: grid.i18n.t("select.menu"), html: CHEVRON_SVG });
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
    let hbg = col.headerBackground, hcol = col.headerColor;
    if (col.group && this._groupHeaderStyle) {
      const gs = this._groupHeaderStyle.get(col.group);
      if (gs) {
        hbg = hbg || gs.bg;
        hcol = hcol || gs.color;
      }
    }
    if (hbg) cell.style.background = hbg;
    if (hcol) cell.style.color = hcol;
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
    if (col._groupCol) attachGroupResize(handle, col, grid, col._groupCol.id);
    else attachResize(handle, col, grid);
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
    const colsMode = this.grid.instance.groupDisplay === "columns";
    if (this.grid.groupActive() && !colsMode) {
      this.renderGroupNodes(this.grid.buildGroups(rows), list, frag, { n: 0 });
    } else if (this.grid.groupActive()) {
      const items = flattenGroupItems(this.grid.buildGroups(rows));
      items.forEach(({ row, index }, i) => this._appendRow(frag, row, index, i, list));
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
  /** Po změně zvýraznění: přepni třídu `is-highlighted` na řádcích (bez plného re-renderu).
   *  S `key` se dotkne jen odpovídajícího řádku; bez něj (clearHighlights) projde všechny. */
  updateHighlightUI(key) {
    const grid = this.grid;
    for (const rowEl of this.nodes.body.querySelectorAll(".lattice-row")) {
      const idx = Number(rowEl.dataset.index);
      const data = grid.rows[idx];
      if (!data) continue;
      if (key != null && grid.rowKey(data) !== String(key)) continue;
      rowEl.classList.toggle("is-highlighted", grid.isHighlighted(data));
    }
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
    const n = grid.selectedCount();
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
    if (grid.selectAllFiltered) {
      const excluded = grid.selectExcept.size;
      cb.checked = excluded === 0;
      cb.indeterminate = excluded > 0 && grid.selectedCount() > 0;
    } else {
      const rows = grid.scopeRows();
      let sel = 0;
      for (const r of rows) if (grid.isSelected(r)) sel++;
      cb.checked = rows.length > 0 && sel === rows.length;
      cb.indeterminate = sel > 0 && sel < rows.length;
    }
    cb.title = grid.selectScope === "all" ? grid.i18n.t("select.scopeAll", { n: grid.filteredCount() }) : grid.i18n.t("select.scopePage", { n: grid.pageCount() });
  }
  /**
   * Menu výběru: **vybrat stránku / vybrat všechny záznamy** + invertovat + zrušit.
   * První dvě volby rovnou vybírají (a nastaví rozsah, se kterým pak pracuje horní
   * checkbox i invertování); zvýrazněná je ta, jejíž rozsah je právě celý vybraný.
   */
  openSelectMenu(anchor) {
    const g = this.grid;
    const t = g.i18n.t.bind(g.i18n);
    openMenu(anchor, [
      { value: "page", label: t("select.scopePage", { n: g.pageCount() }), active: g.isPageAllSelected() },
      { value: "all", label: t("select.scopeAll", { n: g.filteredCount() }), active: g.isAllRecordsSelected() },
      { value: "invert", label: t("select.invert") },
      { value: "none", label: t("select.none") }
    ], (v) => {
      if (v === "page") g.selectPage();
      else if (v === "all") g.selectAllRecords();
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
    if (grid.isHighlighted(rowData)) row.classList.add("is-highlighted");
    applyCond(row, grid.options.rowClass, grid.options.rowStyle, [rowData, index]);
    for (const col of list) row.appendChild(this.buildBodyCell(col, rowData, index));
    if (grid.isMovable()) attachDropZone(row, this, () => index, !!grid.tree);
    const rowClickCb = grid.options.onRowClick || grid.options.rowClick;
    const rowClickSelect = grid.isSelectable() && grid.instance.selectRowClick;
    const rowHighlightClick = grid.instance.rowHighlight === true || grid.instance.rowHighlight === "click";
    if (rowClickSelect || rowClickCb || rowHighlightClick) {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".lattice-resize-handle")) return;
        if (rowClickSelect && !e.target.closest("a, button, input, select, textarea, label, .lattice-select-cell")) {
          if (e.shiftKey && this._lastSelIdx != null && typeof index === "number") {
            const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
            grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), true);
          } else {
            grid.toggleRow(grid.rowKey(rowData));
          }
          if (typeof index === "number") this._lastSelIdx = index;
        }
        if (rowHighlightClick && !e.target.closest("a, button, input, select, textarea, label, .lattice-select-cell, .lattice-cell.is-editable")) {
          grid.toggleRowHighlight(grid.rowKey(rowData));
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
    if (grid.instance.rowNumbers && grid.instance.rowNumbers !== "none") reserve += 44;
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
    const plan = this._summaryRowPlan(list);
    if (!plan.length) return null;
    const rows = collectGroupRows(node);
    const frag = document.createDocumentFragment();
    for (const r of plan) frag.appendChild(this._summaryRow(list, r, rows, { rowClass: "lattice-group-subtotal" }));
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
    const levelTitle = this.groupLevelTitle(node, col);
    const row = el("div.lattice-rowgroup" + (collapsed ? ".is-collapsed" : ""), {
      dataset: { key: node.key },
      role: "button",
      tabindex: "0",
      class: "is-level-" + node.level,
      title: (levelTitle ? levelTitle + ": " : "") + label
    });
    const dir = grid.sortDir(node.field);
    const sortBtn = el("button.lattice-rowgroup-sort" + (dir ? ".is-" + dir : ""), {
      type: "button",
      title: grid.i18n.t("group.sort"),
      text: dir === "asc" ? "\u25B2" : dir === "desc" ? "\u25BC" : "\u21C5"
    });
    sortBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      grid.cycleGroupSort(node.field);
    });
    const inner = el("div.lattice-rowgroup-inner", {
      style: { paddingLeft: 10 + node.level * 20 + "px" }
    }, [
      el("span.lattice-rowgroup-toggle", { html: CHEVRON_SVG }),
      levelTitle ? el("span.lattice-rowgroup-field", { text: levelTitle + ":" }) : null,
      el("span.lattice-rowgroup-title", { text: label }),
      el("span.lattice-rowgroup-count", { text: String(node.count) }),
      sortBtn
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
  /** Titulek úrovně seskupení: název sloupce, u datumové úrovně + část (např. „Vytvořeno · Kvartál"). */
  groupLevelTitle(node, col) {
    if (!col) return "";
    if (!node.part) return col.title;
    const part = this.grid.i18n.t("group.parts." + node.part);
    return col.title + " \xB7 " + part;
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
    const plan = this._summaryRowPlan(list);
    if (!plan.length) return null;
    const srcRows = grid.summarySource(scope);
    const wrap = el("div.lattice-summary");
    plan.forEach((r, i) => wrap.appendChild(this._summaryRow(list, r, srcRows, { first: i === 0, floatLabel: true })));
    return wrap;
  }
  /**
   * Plán souhrnných řádků: nejdřív standardní funkce (v pořadí SUMMARY_ORDER),
   * pak vzorce s vlastním názvem. Vzorec pojmenovaný STEJNĚ jako standardní řádek
   * (např. „Průměr") se do něj sloučí — nevytvoří vlastní řádek. Každá položka:
   * `{ label, fn }` (fn = klíč standardní funkce, nebo null u čistě vzorcového řádku).
   */
  _summaryRowPlan(list) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const plan = [];
    const labels = /* @__PURE__ */ new Set();
    for (const fn of SUMMARY_ORDER) {
      if (list.some((c) => (c.summary || []).includes(fn))) {
        const label = t("summary.name." + fn);
        plan.push({ label, fn });
        labels.add(label);
      }
    }
    const defLbl = t("summary.formulaLabel");
    for (const c of list) {
      if (!c.summaryFormula) continue;
      const lbl = c.summaryFormulaLabel || defLbl;
      if (!labels.has(lbl)) {
        labels.add(lbl);
        plan.push({ label: lbl, fn: null });
      }
    }
    return plan;
  }
  /**
   * Jeden souhrnný řádek dle plánu (`rowSpec = { label, fn }`) nad `srcRows`.
   * Sdílené pro patu i mezisoučty skupin. V každé buňce má vzorec (ƒ) přednost
   * před standardní funkcí — tak se vážený vzorec zobrazí ve „svém" řádku i když
   * je pojmenovaný jako funkce.
   */
  _summaryRow(list, rowSpec, srcRows, opts = {}) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const defFormulaLbl = t("summary.formulaLabel");
    const row = el("div.lattice-row.lattice-summary-row" + (opts.rowClass ? "." + opts.rowClass : "") + (opts.first ? ".is-first" : ""));
    for (const col of list) {
      const cell = el("div.lattice-cell.lattice-summary-cell", {
        dataset: { field: col.field },
        class: col.align ? "is-" + col.align : ""
      });
      if (!col._rownum) {
        const colFormulaLbl = col.summaryFormula ? col.summaryFormulaLabel || defFormulaLbl : null;
        if (colFormulaLbl === rowSpec.label) {
          let val = null;
          try {
            val = compileAggregate(col.summaryFormula)(srcRows);
          } catch {
            val = null;
          }
          cell.appendChild(el("span.lattice-summary-sym.is-formula", { text: "\u0192", title: col.summaryFormula }));
          cell.appendChild(el("span.lattice-summary-val", { text: this.formatSummaryValue("formula", val, col) }));
        } else if (rowSpec.fn && (col.summary || []).includes(rowSpec.fn) && (rowSpec.fn === "count" || isNumericType(col.type))) {
          const val = computeSummary(rowSpec.fn, col, srcRows);
          cell.appendChild(el("span.lattice-summary-sym", { text: SUMMARY_SYMBOL[rowSpec.fn], title: t("summary.name." + rowSpec.fn) }));
          cell.appendChild(el("span.lattice-summary-val", { text: this.formatSummaryValue(rowSpec.fn, val, col) }));
        }
      }
      row.appendChild(cell);
    }
    if (opts.floatLabel) {
      const lbl = el("span.lattice-summary-rowlabel", { text: rowSpec.label, title: rowSpec.label });
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
    const anySummary = grid.columns.some((c) => (c.summary || []).length || c.summaryFormula);
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
    if (val == null || typeof val === "number" && !Number.isFinite(val)) return "";
    if (fn === "count") return String(val);
    if (col.type === "money") return getFormatter(col)(val, col, {});
    const maxdec = fn === "avg" || fn === "formula" ? 2 : 0;
    return Number(val).toLocaleString(void 0, { maximumFractionDigits: maxdec });
  }
  /** Aplikuje uživatelský „formát buňky" (zarovnání, řez písma, barvy) na buňku. */
  applyCellFormat(cell, col) {
    const cf = col.cellFormat;
    if (!cf) return;
    if (cf.align) {
      cell.classList.remove("is-left", "is-center", "is-right");
      cell.classList.add("is-" + cf.align);
    }
    if (cf.bold) cell.style.fontWeight = "700";
    if (cf.italic) cell.style.fontStyle = "italic";
    const deco = [];
    if (cf.underline) deco.push("underline");
    if (cf.strike) deco.push("line-through");
    if (deco.length) cell.style.textDecoration = deco.join(" ");
    if (cf.color) cell.style.color = cf.color;
    if (cf.background) cell.style.background = cf.background;
  }
  buildBodyCell(col, rowData, index) {
    if (col._colGroupStrip) {
      return el("div.lattice-cell.lattice-colgroup-strip", { dataset: { field: col.field } });
    }
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
        if (e.shiftKey && this._lastSelIdx != null && typeof index === "number") {
          const [a, b] = [this._lastSelIdx, index].sort((x, y) => x - y);
          grid.selectKeys(grid.rows.slice(a, b + 1).map((r) => grid.rowKey(r)), cb.checked);
        } else {
          grid.setRowSelected(grid.rowKey(rowData), cb.checked);
        }
        if (typeof index === "number") this._lastSelIdx = index;
      });
      cell2.appendChild(cb);
      return cell2;
    }
    if (col._rownum) {
      const num5 = typeof index !== "number" ? "" : col._mode === "perPage" ? index + 1 : (this.grid.page - 1) * this.grid.pageSize + index + 1;
      const cell2 = el("div.lattice-cell.lattice-rownum", {
        dataset: { field: col.field },
        class: "is-" + (col.align || "right")
      });
      if (col._menuActions) {
        cell2.classList.add("has-actions-menu");
        cell2.appendChild(el("span.lattice-rownum-num", { text: String(num5) }));
        const btn = this.buildActionsMenuButton(rowData, index);
        if (btn) cell2.appendChild(btn);
      } else {
        cell2.textContent = String(num5);
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
      class: [
        col.align ? "is-" + col.align : "",
        editable ? "is-editable" : "",
        col.wrap === true ? "is-wrap" : col.wrap === false ? "is-nowrap" : ""
      ].filter(Boolean).join(" "),
      title: editable ? this.grid.i18n.t("edit.hint") : void 0
    });
    this.applyCellFormat(cell, col);
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
      this._renderVersion();
      return;
    }
    const pos = this.grid.instance.paginationPosition;
    this._renderPager(this.nodes.footer, pos === "footer" || pos === "both");
    this._renderPager(this.nodes.topPager, pos === "header" || pos === "both");
    this._renderVersion();
  }
  /**
   * Verze knihovny vpravo v patičce — ať je hned vidět, s jakou verzí uživatel pracuje
   * (a v jaké verzi je hlášený problém). Vykresluje se jako poslední prvek patičky
   * (i když je stránkování vypnuté a patička by jinak zůstala prázdná).
   *
   * Vypnout jde dvěma způsoby: uživatel v „Nastavení tabulky" (`instance.showVersion`,
   * persistuje se a nese se i v presetu), aplikace natvrdo přes `features.version = false`
   * (pak se volba v nastavení ani nenabídne).
   */
  _renderVersion() {
    if ((this.grid.options.features || {}).version === false) return;
    if (this.grid.instance.showVersion === false) return;
    const footer = this.nodes.footer;
    if (footer.style.display === "none") footer.style.display = "";
    const host = footer.querySelector(".lattice-page-info") || footer;
    host.appendChild(el("span.lattice-version", {
      text: "Lattice " + VERSION,
      title: this.grid.i18n.t("versionTitle")
    }));
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
  /**
   * Řada tlačítek **presetů** — vlastní řádek NAD řadou ikon (width:100% + flex-wrap),
   * zarovnaný vpravo. Když žádný preset jako tlačítko označený není, řádek se vůbec
   * nevykreslí a záhlaví o něj nenaroste.
   *
   * Druh a rozsah se čtou bez popisků: ikona **záložky** = preset, barva = rozsah
   * (šedá = můj, modrá na světle modré = globální). Aktivní je vyplněný akcentem.
   */
  buildPresetBar() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const presets = grid.buttonPresets();
    if (!presets.length) return;
    const group = el("div.lattice-qb-group.is-presets", { title: t("quickbar.presets") });
    for (const p of presets) {
      const global = p.scope === "global";
      const parts = partsSummary(grid.presetContents(p), t);
      const active = grid._activePresetId === p.id;
      const b = this.quickBtn({
        text: p.name,
        icon: BOOKMARK_MINI_SVG,
        global,
        active,
        title: (global ? t("quickbar.globalPreset") : t("quickbar.myPreset")) + " \u2014 " + p.name + (parts ? " (" + parts + ")" : "") + "\n" + (active ? t("quickbar.presetOff") : t("quickbar.presetOn")) + " \xB7 " + t("quickbar.menuHint")
      });
      b.addEventListener("click", () => grid.togglePreset(p));
      b.addEventListener("contextmenu", (e) => this.quickBarMenu(e, p, "preset"));
      group.appendChild(b);
    }
    this.nodes.toolbar.appendChild(el("div.lattice-quickbar", {}, [group]));
  }
  /**
   * Tlačítka uložených **filtrů** — v řadě ikon, hned **vlevo od filtračních ikon**
   * (uložených filtrů bývá víc než presetů, takže sedí blízko toho, co ovládají).
   * Ikona trychtýře = filtr, barva = rozsah; aktivní je vyplněný akcentem.
   */
  buildFilterButtons(f) {
    const grid = this.grid;
    if (f.advancedFilter === false) return;
    const t = grid.i18n.t.bind(grid.i18n);
    const filters = grid.buttonAdvanced();
    if (!filters.length) return;
    const activeId = grid.activeSavedId();
    const group = el("div.lattice-qb-group.is-filters", { title: t("quickbar.filters") });
    for (const bf of filters) {
      const global = bf.scope === "global";
      const b = this.quickBtn({
        text: bf.name,
        icon: FUNNEL_MINI_SVG,
        global,
        active: bf.id === activeId,
        title: (global ? t("quickbar.globalFilter") : t("quickbar.myFilter")) + " \u2014 " + bf.name + "\n" + t("quickbar.filterToggle") + " \xB7 " + t("quickbar.menuHint")
      });
      b.addEventListener("click", () => grid.toggleSavedAdvanced(bf.id));
      b.addEventListener("contextmenu", (e) => this.quickBarMenu(e, bf, "filter"));
      group.appendChild(b);
    }
    this.nodes.toolbar.appendChild(group);
  }
  /**
   * Kontextové menu pilulky (pravý klik) — správa uložené položky rovnou z místa,
   * kde ji uživatel vidí: použít/vypnout, kde se má zobrazovat (tlačítko / výběr),
   * úprava v příslušném panelu a smazání.
   */
  quickBarMenu(e, item, kind) {
    e.preventDefault();
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const preset = kind === "preset";
    const active = preset ? grid._activePresetId === item.id : grid.activeSavedId() === item.id;
    const asSelect = item.asSelect === void 0 ? preset ? false : !item.asButton : !!item.asSelect;
    const items = [
      { value: "apply", label: preset ? active ? t("quickbar.resetView") : t("quickbar.applyPreset") : active ? t("quickbar.clearFilter") : t("quickbar.applyFilter") },
      { value: "edit", label: preset || item.kind !== "columns" ? t("quickbar.edit") : t("saveFilters.edit") },
      { separator: true },
      { value: "asButton", label: t("quickbar.showButton"), active: !!item.asButton },
      { value: "asSelect", label: t("quickbar.showSelect"), active: asSelect },
      { separator: true },
      { value: "delete", label: t("quickbar.delete"), danger: true }
    ];
    openMenuAt(e.pageX, e.pageY, items, async (value) => {
      if (value === "apply") return preset ? grid.togglePreset(item) : grid.toggleSavedAdvanced(item.id);
      if (value === "edit") return this.editSavedItem(item, kind);
      if (value === "asButton" || value === "asSelect") {
        const on = value === "asButton" ? !item.asButton : !asSelect;
        if (preset) grid.presets.setDisplay(item, value, on);
        else grid.setAdvancedDisplay(item.id, value, on);
        return;
      }
      if (value === "delete") {
        if (preset) await grid.presets.remove(item);
        else grid.deleteAdvanced(item.id);
        grid.gear?.refresh();
      }
    });
  }
  /** Otevře panel, ve kterém se dá uložená položka upravit (a znovu uložit pod stejným názvem). */
  editSavedItem(item, kind) {
    const grid = this.grid;
    const tb = this.nodes.toolbar;
    if (kind === "preset") return grid.gear?.open(tb.querySelector(".lattice-gear-btn"), item);
    if (item.kind === "columns") {
      grid.applyFiltersSnapshot(item);
      return grid.saveFiltersPanel.open(this.nodes.toolbar.querySelector(".lattice-save-filters"));
    }
    grid.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
    return grid.advancedFilter.open(this.nodes.toolbar.querySelector(".lattice-adv-btn"));
  }
  /** Jedna pilulka rychlé řady (druh podle ikony, rozsah podle barvy). */
  quickBtn({ text, icon, global, active, title }) {
    const cls = ".lattice-qb-btn" + (global ? ".is-global" : ".is-mine") + (active ? ".is-active" : "");
    return el("button" + cls, { type: "button", title }, [
      el("span.lattice-qb-ico", { html: icon }),
      el("span.lattice-qb-label", { text })
    ]);
  }
  /**
   * Rozbalovací výběr **uložených filtrů** (těch označených „jako výběr"). Stojí hned
   * za filtračními ikonami; globální položky nesou prefix globusu (v `<option>` nejde
   * SVG ikona).
   */
  buildFilterSelect(f) {
    const grid = this.grid;
    if (f.advancedFilter === false) return;
    const t = grid.i18n.t.bind(grid.i18n);
    const filters = grid.selectAdvanced();
    if (!filters.length) return;
    const sel = el("select.lattice-adv-quick", { title: t("quickbar.filters") });
    sel.appendChild(el("option", { value: "", text: t("advanced.savedPlaceholder") }));
    for (const x of filters) sel.appendChild(el("option", { value: x.id, text: (x.scope === "global" ? "\u{1F310} " : "") + x.name }));
    const activeId = grid.activeSavedId();
    sel.value = filters.some((x) => x.id === activeId) ? activeId : "";
    sel.addEventListener("change", () => {
      if (!sel.value) {
        const cur = grid.listAdvanced().find((x) => x.id === grid.activeSavedId());
        if (cur && cur.kind === "columns") grid.clearColumnFilters();
        else grid.clearAdvanced();
        return;
      }
      const item = filters.find((x) => x.id === sel.value);
      if (!item) return;
      if (item.kind === "columns") grid.applyFiltersSnapshot(item);
      else grid.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
    });
    this.nodes.toolbar.appendChild(sel);
  }
  /**
   * Rozbalovací výběr **presetů** (těch označených „jako výběr") — vpravo vedle výběru
   * filtrů, ať je vidět, že jde o jiný druh. Vyprázdnění vrátí výchozí zobrazení.
   */
  buildPresetSelect() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const presets = grid.selectPresets();
    if (!presets.length) return;
    const sel = el("select.lattice-adv-quick.is-presets", { title: t("quickbar.presets") });
    sel.appendChild(el("option", { value: "", text: t("quickbar.presetsPlaceholder") }));
    for (const p of presets) sel.appendChild(el("option", { value: p.id, text: (p.scope === "global" ? "\u{1F310} " : "") + p.name }));
    sel.value = presets.some((p) => p.id === grid._activePresetId) ? grid._activePresetId : "";
    sel.addEventListener("change", () => {
      if (!sel.value) return grid.resetView();
      const preset = presets.find((p) => p.id === sel.value);
      if (preset) grid.applyPreset(preset);
    });
    this.nodes.toolbar.appendChild(sel);
  }
  renderToolbar() {
    const { toolbar } = this.nodes;
    clear(toolbar);
    const f = this.grid.options.features || {};
    this.buildPresetBar();
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
    this.buildFilterButtons(f);
    const clearBtn = el("button.lattice-tool-btn.lattice-clear-filters" + (this.grid.hasActiveFilters() ? ".is-visible" : ""), {
      type: "button",
      title: this.grid.i18n.t("columns.clearFilters"),
      html: CLEAR_FILTER_SVG2
    });
    clearBtn.addEventListener("click", () => this.grid.clearAllFilters());
    toolbar.appendChild(clearBtn);
    if (f.advancedFilter !== false) {
      const saveFbtn = el("button.lattice-tool-btn.lattice-save-filters" + (this.grid.hasColumnFilters() || this.grid.listAdvanced().length ? ".is-visible" : ""), {
        type: "button",
        title: this.grid.i18n.t("saveFilters.manage"),
        html: SAVE_FILTER_SVG
      });
      saveFbtn.addEventListener("click", () => this.grid.saveFiltersPanel.toggle(saveFbtn));
      if (this.grid.saveFiltersPanel && this.grid.saveFiltersPanel.panel) this.grid.saveFiltersPanel.anchor = saveFbtn;
      toolbar.appendChild(saveFbtn);
    }
    if (f.advancedFilter !== false) {
      const grid = this.grid;
      const t = grid.i18n.t.bind(grid.i18n);
      const advBtn = el("button.lattice-tool-btn.lattice-adv-btn", {
        type: "button",
        title: t("advanced.title"),
        class: grid.advancedActive() ? "is-active" : "",
        html: this.icon("advancedFilter", ADV_SVG)
      });
      advBtn.addEventListener("click", () => grid.advancedFilter.toggle(advBtn));
      toolbar.appendChild(advBtn);
      if (grid.advancedFilter && grid.advancedFilter.panel) grid.advancedFilter.anchor = advBtn;
    }
    this.buildFilterSelect(f);
    this.buildPresetSelect();
    if (f.gear !== false) {
      const gearBtn = el("button.lattice-tool-btn.lattice-gear-btn", { type: "button", title: this.grid.i18n.t("columns.manage"), html: this.icon("columns", GEAR_SVG) });
      gearBtn.addEventListener("click", () => this.grid.gear.toggle(gearBtn));
      toolbar.appendChild(gearBtn);
    }
    if (f.instanceSettings !== false) {
      const setBtn = el("button.lattice-tool-btn", { type: "button", title: this.grid.i18n.t("instance.title"), html: this.icon("settings", COG_SVG) });
      if (this.grid.globalDefaultsAvailable()) setBtn.classList.add("has-gd-note");
      setBtn.addEventListener("click", () => this.grid.instanceSettings.toggle(setBtn));
      toolbar.appendChild(setBtn);
    }
    const helpUrl = this.grid.options.helpUrl === void 0 ? DEFAULT_HELP_URL : this.grid.options.helpUrl;
    if (f.help !== false && helpUrl) {
      toolbar.appendChild(el("a.lattice-tool-btn.lattice-help-btn", {
        href: helpUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        title: this.grid.i18n.t("help.title"),
        html: HELP_SVG
      }));
    }
  }
  /** Ukáže/skryje mazací ikonu filtrů v záhlaví podle toho, zda je nějaký aplikován. */
  updateFilterClearBtn() {
    const tb = this.nodes.toolbar;
    if (!tb) return;
    const btn = tb.querySelector(".lattice-clear-filters");
    if (btn) btn.classList.toggle("is-visible", this.grid.hasActiveFilters());
    const save = tb.querySelector(".lattice-save-filters");
    if (save) save.classList.toggle("is-visible", this.grid.hasColumnFilters() || this.grid.listAdvanced().length > 0);
    for (const b of tb.querySelectorAll(".lattice-savefilters-overwrite")) b.disabled = !this.grid.hasColumnFilters();
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
    root.classList.toggle("wrap-header", inst.wrapHeader === true);
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
function flattenGroupItems(nodes, out = []) {
  for (const node of nodes) {
    if (node.rows) out.push(...node.rows);
    else flattenGroupItems(node.groups || [], out);
  }
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
var BOOKMARK_MINI_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 011 1v18l-7-4-7 4V3a1 1 0 011-1z"/></svg>';
var FUNNEL_MINI_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M2 4h20l-8 9v7l-4 2v-9z"/></svg>';
var FILTER_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
var ADV_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-star-on, #f5b301)" stroke-width="3" stroke-linecap="round" d="M18 11.5v7m-3.5-3.5h7"/></svg>';
var GEAR_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 4h12v1.5H2zM2 7.25h12v1.5H2zM2 10.5h12V12H2z"/></svg>';
var CLEAR_FILTER_SVG2 = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
var SAVE_FILTER_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="var(--lattice-accent)" d="M15 14h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/><path fill="#fff" d="M15.6 14.6h2.8v2.2h-2.8z"/><path fill="#fff" d="M15.5 18h4v2.4h-4z"/></svg>';
var UNDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></svg>';
var REDO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h2"/></svg>';
var CLEAR_HIST_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
var CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>';
var COLGROUP_STRIP_W = 34;
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
var HELP_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/></svg>';
var DEFAULT_HELP_URL = HELP_URL;

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
function normalizeDisplay(display, dflt = { asButton: false, asSelect: true }) {
  if (display && typeof display === "object") {
    return { asButton: !!(display.button ?? display.asButton), asSelect: !!(display.select ?? display.asSelect) };
  }
  if (typeof display === "boolean") return { asButton: display, asSelect: !display };
  return { ...dflt };
}
var PRESET_DISPLAY_DEFAULT = { asButton: false, asSelect: false };
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
  /** Presety označené k zobrazení jako tlačítko (řada nad ikonami v toolbaru). */
  buttons() {
    return this.all().filter((p) => p.asButton);
  }
  /** Presety označené k zobrazení ve výběru (rozbalovací seznam v toolbaru). */
  selects() {
    return this.all().filter((p) => p.asSelect);
  }
  /**
   * Uloží aktuální stav jako lokální preset (stejný název přepíše). `parts`
   * vybírá, co preset ponese (`{columns, filters, instance}`) — nezadáno = vše.
   * `display` = kde se preset ukáže v toolbaru: `{ button, select }` (nebo legacy
   * boolean = jen tlačítko). Nezadáno → nikde, preset žije jen v panelu „Sloupce".
   */
  saveLocal(name, parts, display) {
    const nm = String(name).trim();
    if (!nm) return null;
    const d = normalizeDisplay(display, PRESET_DISPLAY_DEFAULT);
    const prev = this.local().find((p) => p.name === nm);
    const preset = { id: prev ? prev.id : uid(), name: nm, ...d, state: this.grid.captureState(parts) };
    const list = this.local().filter((p) => p.name !== preset.name);
    list.push(preset);
    this.grid.state.presets = list;
    this.grid.saveState();
    this.grid.renderer?.renderToolbar();
    return preset;
  }
  /**
   * Uloží aktuální stav jako globální preset. Knihovna preset jen sestaví, ukáže
   * v seznamu a předá aplikaci přes callback onSaveGlobalPreset(preset) — ta si
   * poradí s perzistencí (DB, sdílení mezi uživateli). Vrací sestavený preset.
   * `parts` vybírá, co preset ponese (viz `saveLocal`), `display` určuje jeho
   * zobrazení v toolbaru (tlačítko / výběr).
   */
  saveGlobal(name, parts, display) {
    const nm = String(name).trim();
    if (!nm) return null;
    const d = normalizeDisplay(display, PRESET_DISPLAY_DEFAULT);
    const prev = this.globals.find((p) => p.name === nm);
    const preset = { id: prev ? prev.id : uid(), name: nm, ...d, state: this.grid.captureState(parts) };
    this.globals = this.globals.filter((p) => p.name !== preset.name);
    const norm5 = { ...preset, scope: "global" };
    this.globals.push(norm5);
    const cb = this.grid.options.onSaveGlobalPreset;
    if (typeof cb === "function") cb({ id: preset.id, name: preset.name, asButton: preset.asButton, asSelect: preset.asSelect, state: preset.state });
    else if (this.adapter && this.adapter.save) Promise.resolve(this.adapter.save(preset)).catch(() => {
    });
    this.grid.renderer?.renderToolbar();
    return norm5;
  }
  /**
   * Přepne u už uloženého presetu jeho zobrazení v toolbaru — `key` je `'asButton'`
   * (rychlá řada tlačítek) nebo `'asSelect'` (rozbalovací výběr). U globálního presetu
   * pošle změnu aplikaci stejným callbackem jako uložení.
   */
  setDisplay(preset, key, on) {
    if (key !== "asButton" && key !== "asSelect") return null;
    if (preset.scope === "global") {
      const p2 = this.globals.find((x) => x.id === preset.id);
      if (!p2) return null;
      p2[key] = !!on;
      const cb = this.grid.options.onSaveGlobalPreset;
      if (typeof cb === "function") cb({ id: p2.id, name: p2.name, asButton: !!p2.asButton, asSelect: !!p2.asSelect, state: p2.state });
      else if (this.adapter && this.adapter.save) Promise.resolve(this.adapter.save(p2)).catch(() => {
      });
      this.grid.renderer?.renderToolbar();
      return p2;
    }
    const list = this.local();
    const p = list.find((x) => x.id === preset.id);
    if (!p) return null;
    p[key] = !!on;
    this.grid.state.presets = list;
    this.grid.saveState();
    this.grid.renderer?.renderToolbar();
    return p;
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
    this.grid.renderer?.renderToolbar();
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
    if (this.panel) this.close();
    this.anchor = anchor;
    this.tree = this.grid.advanced ? clone(this.grid.advanced) : freshGroup(this.grid);
    this.selectedId = this.matchSavedId(this.grid.advanced);
    const panel = el("div.lattice-panel.lattice-adv-panel");
    this.panel = panel;
    this.renderPanel();
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.off = onOutside(panel, (e) => {
      if (!this.anchor?.contains(e.target)) this.close();
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
    this.nameInput = nameInput;
    if (this.selectedId) {
      const cur = this.grid.listAdvanced().find((x) => x.id === this.selectedId);
      if (cur) nameInput.value = cur.name;
    }
    const asBtnInput = el("input", { type: "checkbox" });
    this.asBtnInput = asBtnInput;
    const asSelInput = el("input", { type: "checkbox" });
    asSelInput.checked = true;
    this.asSelInput = asSelInput;
    if (this.selectedId) {
      const cur = this.grid.listAdvanced().find((x) => x.id === this.selectedId);
      if (cur) {
        asBtnInput.checked = !!cur.asButton;
        asSelInput.checked = cur.asSelect === void 0 ? !cur.asButton : !!cur.asSelect;
      }
    }
    const asBtnLabel = el("label.lattice-adv-asbtn", { title: t("advanced.asButtonHint") }, [
      asBtnInput,
      el("span", { text: t("advanced.asButton") })
    ]);
    const asSelLabel = el("label.lattice-adv-asbtn", { title: t("advanced.asSelectHint") }, [
      asSelInput,
      el("span", { text: t("advanced.asSelect") })
    ]);
    const saveBtn = el("button.lattice-dr-btn", { type: "button", text: t("advanced.save") });
    const saveWithScope = (scope) => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const item = this.grid.saveAdvanced(name, this.tree, scope, { button: asBtnInput.checked, select: asSelInput.checked });
      nameInput.value = "";
      asBtnInput.checked = false;
      asSelInput.checked = true;
      this.selectedId = item ? item.id : this.selectedId;
      this.refreshSavedRow();
    };
    saveBtn.addEventListener("click", () => saveWithScope("local"));
    const saveRowEls = [nameInput, asBtnLabel, asSelLabel, saveBtn];
    if (this.grid.canSaveGlobalAdvanced()) {
      const globeBtn = el("button.lattice-dr-btn.is-success", { type: "button", text: t("advanced.saveGlobal") });
      globeBtn.addEventListener("click", () => saveWithScope("global"));
      saveRowEls.push(globeBtn);
    }
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
      el("div.lattice-adv-saverow", {}, saveRowEls),
      el("div.lattice-adv-footer-btns", {}, [clearBtn, applyBtn])
    ]));
  }
  buildSavedRow() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const saved = grid.listAdvanced().filter((f) => f.kind !== "columns");
    const sel = el("select.lattice-adv-saved");
    sel.appendChild(el("option", { value: "", text: t("advanced.savedPlaceholder") }));
    for (const f of saved) sel.appendChild(el("option", { value: f.id, text: (f.scope === "global" ? "\u{1F310} " : "") + f.name }));
    sel.value = this.selectedId || "";
    sel.addEventListener("change", () => {
      this.selectedId = sel.value;
      const f = saved.find((x) => x.id === sel.value);
      if (!f) return;
      this.tree = clone(f.tree);
      if (this.nameInput) this.nameInput.value = f.name;
      if (this.asBtnInput) this.asBtnInput.checked = !!f.asButton;
      if (this.asSelInput) this.asSelInput.checked = f.asSelect === void 0 ? !f.asButton : !!f.asSelect;
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
    const valInput = el("input.lattice-adv-value", { type: "text", value: cond.value ?? "", placeholder: t("advanced.valuePlaceholder"), title: t("advanced.valueHint") });
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

// src/features/saveFilters.js
var SaveFiltersPanel = class {
  constructor(grid) {
    this.grid = grid;
    this.panel = null;
    this.off = null;
    this.anchor = null;
  }
  toggle(anchor) {
    if (this.panel) return this.close();
    this.open(anchor);
  }
  /** `prefillName` předvyplní název (úprava uloženého snímku → uložení pod stejným jménem). */
  open(anchor, prefillName = "") {
    if (this.panel) this.close();
    if (!anchor) return;
    this.anchor = anchor;
    const panel = el("div.lattice-panel.lattice-savefilters-panel");
    this.panel = panel;
    this.render(prefillName);
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.off = onOutside(panel, (e) => {
      if (this.anchor?.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".lattice-menu")) return;
      this.close();
    });
  }
  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }
  render(prefillName = "") {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const panel = this.panel;
    panel.textContent = "";
    panel.appendChild(el("div.lattice-panel-head", {}, [
      el("span.lattice-panel-title", { text: t("saveFilters.manage") })
    ]));
    if (grid.hasColumnFilters()) panel.appendChild(this.buildSaveRow(prefillName));
    else panel.appendChild(el("div.lattice-savefilters-empty", { text: t("saveFilters.hint") }));
    this.listEl = el("div.lattice-savefilters-list");
    panel.appendChild(this.listEl);
    this.renderList();
  }
  buildSaveRow(prefillName) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const nameInput = el("input.lattice-adv-name", { type: "text", placeholder: t("saveFilters.namePlaceholder"), value: prefillName });
    const asBtnInput = el("input", { type: "checkbox" });
    const asBtnLabel = el("label.lattice-adv-asbtn", { title: t("saveFilters.asButtonHint") }, [
      asBtnInput,
      el("span", { text: t("saveFilters.asButton") })
    ]);
    const asSelInput = el("input", { type: "checkbox" });
    asSelInput.checked = true;
    const asSelLabel = el("label.lattice-adv-asbtn", { title: t("saveFilters.asSelectHint") }, [
      asSelInput,
      el("span", { text: t("saveFilters.asSelect") })
    ]);
    if (prefillName) {
      const cur = grid.listAdvanced().find((f) => f.name === prefillName);
      if (cur) {
        asBtnInput.checked = !!cur.asButton;
        asSelInput.checked = cur.asSelect === void 0 ? !cur.asButton : !!cur.asSelect;
      }
    }
    const saveWithScope = (scope) => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const item = grid.saveFilterSnapshot(name, scope, { button: asBtnInput.checked, select: asSelInput.checked });
      if (!item) return;
      nameInput.value = "";
      asBtnInput.checked = false;
      asSelInput.checked = true;
      this.renderList();
    };
    const saveBtn = el("button.lattice-dr-btn.is-primary", { type: "button", text: t("saveFilters.save") });
    saveBtn.addEventListener("click", () => saveWithScope("local"));
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveWithScope("local");
    });
    const rowEls = [nameInput, asBtnLabel, asSelLabel, saveBtn];
    if (grid.canSaveGlobalAdvanced()) {
      const globeBtn = el("button.lattice-dr-btn.is-success", { type: "button", text: t("saveFilters.saveGlobal") });
      globeBtn.addEventListener("click", () => saveWithScope("global"));
      rowEls.push(globeBtn);
    }
    return el("div.lattice-adv-saverow", {}, rowEls);
  }
  renderList() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const list = this.listEl;
    list.textContent = "";
    const saved = grid.listAdvanced();
    if (!saved.length) {
      list.appendChild(el("div.lattice-savefilters-empty", { text: t("saveFilters.none") }));
      if (this.panel) positionUnder(this.panel, this.anchor);
      return;
    }
    const activeId = grid.activeSavedId();
    this._rows = [];
    for (const item of saved) {
      const row = el("div.lattice-savefilters-row");
      const apply = el("button.lattice-savefilters-name" + (item.id === activeId ? ".is-active" : ""), {
        type: "button",
        text: (item.scope === "global" ? "\u{1F310} " : "") + item.name,
        title: (item.id === activeId ? t("quickbar.clearFilter") : t("quickbar.applyFilter")) + " \xB7 " + t("saveFilters.rename")
      });
      apply.addEventListener("click", () => {
        grid.toggleSavedAdvanced(item.id);
        this.syncActive();
      });
      apply.addEventListener("dblclick", () => this.renameInline(row, apply, item));
      row.appendChild(apply);
      this._rows.push({ item, apply });
      const ren = el("button.lattice-preset-pin", { type: "button", title: t("saveFilters.rename"), html: PENCIL_SVG2 });
      ren.addEventListener("click", () => this.renameInline(row, apply, item));
      row.appendChild(ren);
      if (item.kind === "columns") {
        const over = el("button.lattice-preset-pin.lattice-savefilters-overwrite", {
          type: "button",
          html: DISK_SVG,
          title: grid.hasColumnFilters() ? t("saveFilters.overwrite") : t("saveFilters.overwriteDisabled")
        });
        over.disabled = !grid.hasColumnFilters();
        over.addEventListener("click", () => {
          grid.overwriteSavedFilter(item.id);
          this.renderList();
        });
        row.appendChild(over);
      } else {
        const edit = el("button.lattice-preset-pin", { type: "button", title: t("saveFilters.edit"), html: BUILDER_SVG });
        edit.addEventListener("click", () => {
          this.close();
          grid.renderer.editSavedItem(item, "filter");
        });
        row.appendChild(edit);
      }
      const asSelect = item.asSelect === void 0 ? !item.asButton : !!item.asSelect;
      for (const [key, on, icon, hint] of [
        ["asButton", !!item.asButton, PILL_SVG, "saveFilters.asButtonHint"],
        ["asSelect", asSelect, SELECT_SVG2, "saveFilters.asSelectHint"]
      ]) {
        const tog = el("button.lattice-preset-pin" + (on ? ".is-on" : ""), { type: "button", title: t(hint), html: icon });
        tog.addEventListener("click", () => {
          grid.setAdvancedDisplay(item.id, key, !on);
          this.renderList();
        });
        row.appendChild(tog);
      }
      const del = el("button.lattice-icon-btn.is-danger", { type: "button", title: t("saveFilters.delete"), text: "\xD7" });
      del.addEventListener("click", () => {
        grid.deleteAdvanced(item.id);
        this.renderList();
      });
      row.appendChild(del);
      list.appendChild(row);
    }
    if (this.panel) positionUnder(this.panel, this.anchor);
  }
  /** Přebarví zvýraznění aktivní položky bez překreslení seznamu (viz klik na název). */
  syncActive() {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const activeId = this.grid.activeSavedId();
    for (const { item, apply } of this._rows || []) {
      const on = item.id === activeId;
      apply.classList.toggle("is-active", on);
      apply.title = (on ? t("quickbar.clearFilter") : t("quickbar.applyFilter")) + " \xB7 " + t("saveFilters.rename");
    }
  }
  /** Přejmenování na místě: název se změní v políčku, Enter uloží, Escape zruší. */
  renameInline(row, nameBtn, item) {
    const input = el("input.lattice-savefilters-rename", { type: "text", value: item.name });
    row.replaceChild(input, nameBtn);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) this.grid.renameSavedFilter(item.id, input.value);
      this.renderList();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }
};
var DISK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M4 3h13l3 3v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path fill="var(--lattice-bg, #fff)" d="M7 4h8v5H7zM6 14h12v7H6z"/></svg>';
var PILL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><rect class="lattice-pin-fill" x="5" y="9.5" width="14" height="5" rx="2.5" fill="currentColor"/></svg>';
var SELECT_SVG2 = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path class="lattice-pin-fill" fill="currentColor" d="M6 9h8v1.8H6zm0 4h6v1.8H6z"/><path fill="currentColor" d="M16.2 10.2h3.4L17.9 13z"/></svg>';
var BUILDER_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M17 12.5v7m-3.5-3.5h7"/></svg>';
var PENCIL_SVG2 = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12.1 1.6a1.4 1.4 0 012 2l-.9.9-2-2 .9-.9zM10 3.2l2 2-6.7 6.7-2.6.6.6-2.6L10 3.2z"/></svg>';

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
      const validate2 = this.grid.options.onCellValidate;
      if (typeof validate2 === "function") {
        let ok = true;
        try {
          ok = validate2({ field: a.col.field, row: a.rowData, rowIndex: a.idx, oldValue, newValue: val, col: a.col });
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
      const num5 = Number(s.replace(/\s/g, "").replace(",", "."));
      if (rule.min != null && !(num5 >= rule.min)) return rule.message || t("min").replace("{n}", rule.min);
      if (rule.max != null && !(num5 <= rule.max)) return rule.message || t("max").replace("{n}", rule.max);
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
  const input = el("input.lattice-edit-input", { type: "text", value: str2(rowData[col.field]) });
  swapCell(cell, input);
  focusInput(input);
  bindInput(input, () => done(input.value), () => done(void 0));
}
function numberEditor(cell, col, rowData, done) {
  const input = el("input.lattice-edit-input.is-number", { type: "text", inputMode: "decimal", value: str2(rowData[col.field]) });
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
  const input = el("input.lattice-edit-input", { type: "text", value: str2(rowData[col.field]) });
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
  const cur = Math.round(num4(rowData[col.field]) || 0);
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
  let val = clamp(num4(rowData[col.field]) || 0, 0, max);
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
    const label = el("input.lattice-edit-input", { type: "text", value: str2(cur.label != null ? cur.label : cur.text != null ? cur.text : "") });
    const url = el("input.lattice-edit-input", { type: "text", value: str2(cur.url != null ? cur.url : cur.href != null ? cur.href : "") });
    const target = el("input.lattice-edit-input", { type: "text", value: str2(cur.target || "") });
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
    const url = el("input.lattice-edit-input", { type: "text", value: str2(cur) });
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
  let rgb = parseColor(str2(rowData[col.field])) || { r: 0, g: 0, b: 0 };
  const menu = el("div.lattice-menu.lattice-edit-popup.lattice-edit-color");
  const preview = el("input", { type: "color", value: rgbToHex2(rgb) });
  const hex = el("input.lattice-edit-input", { type: "text", value: rgbToHex2(rgb) });
  const r = numIn(rgb.r), g = numIn(rgb.g), b = numIn(rgb.b);
  const cmyk = rgbToCmyk(rgb);
  const c = numIn(cmyk.c, 100), m = numIn(cmyk.m, 100), y = numIn(cmyk.y, 100), k = numIn(cmyk.k, 100);
  const syncFrom = (src) => {
    if (src === "picker") rgb = parseColor(preview.value);
    else if (src === "hex") {
      const p = parseColor(hex.value);
      if (p) rgb = p;
    } else if (src === "rgb") rgb = { r: clampI(r.value, 255), g: clampI(g.value, 255), b: clampI(b.value, 255) };
    else if (src === "cmyk") rgb = cmykToRgb({ c: clampI(c.value, 100), m: clampI(m.value, 100), y: clampI(y.value, 100), k: clampI(k.value, 100) });
    const hx = rgbToHex2(rgb);
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
    done(rgbToHex2(rgb));
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
    const cur = str2(rowData[col.field]);
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
function str2(v) {
  return v == null ? "" : String(v);
}
function num4(v) {
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
function rgbToHex2({ r, g, b }) {
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
    return col ? rowEl.querySelector('.lattice-cell[data-field="' + cssEscape(col.field) + '"]') : null;
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
      if (dir === "undo") {
        if (src.insertRow) src.insertRow(e.row, e.index);
        else src.addRow(e.row);
      } else src.deleteRow(grid.keyField, grid.rowKey(e.row));
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
  groupColWidths: {},
  // uživatelské šířky vedoucích sloupců seskupení: { '<groupId>': px }
  groupBy: null,
  // seskupení řádků: pole (field) | {field,part} | jejich pole (víceúrovňové)
  groupDisplay: "headers",
  // jak zobrazit úrovně seskupení: 'headers' (vnořené hlavičky) | 'columns' (vedoucí sloupce)
  groupRepeat: true,
  // opakovat hodnotu seskupení v každém řádku (true) | jen v záhlaví skupiny (false, jen headers)
  selectColumn: true,
  // zobrazit sloupec s checkboxy (jen když je selectable)
  selectRowClick: false,
  // klik na řádek = výběr (false = vybírá jen checkbox)
  rowHighlight: false,
  // klik na řádek = přepnutí zvýraznění (podbarvení); true | 'click' zapne, false vypne
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
  showVersion: true,
  // verze knihovny vpravo v patičce (kontrola, s jakou verzí uživatel pracuje)
  wrapText: false,
  // zalamovat text v buňkách (jinak … ořez)
  wrapHeader: false,
  // zalamovat názvy sloupců v záhlaví (nezávisle na wrapText); auto-fit počítá s 2 řádky
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
var TRANSIENT_INSTANCE_KEYS = ["externalFiltersCollapsed"];
function presetParts(parts) {
  const p = parts || {};
  return { columns: p.columns !== false, filters: p.filters !== false, instance: p.instance !== false };
}
var COLUMN_INSTANCE_KEYS = ["groupBy", "groupDisplay", "groupRepeat", "groupColWidths"];
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
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
    this.globalAdvanced = (Array.isArray(options.globalAdvancedFilters) ? options.globalAdvancedFilters : []).map((f) => ({ ...f, scope: "global" }));
    this.universal = this.state.universal || null;
    this.urlState = options.urlState ? { key: typeof options.urlState === "object" && options.urlState.key || options.id } : null;
    this.groupsCollapsed = new Set(this.state.groups || []);
    this.colGroupsCollapsed = new Set(this.state.colGroups || []);
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
    this.selectAllFiltered = false;
    this.selectExcept = /* @__PURE__ */ new Set();
    this.highlightedKeys = new Set(this.state.highlighted || []);
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
    this.saveFiltersPanel = new SaveFiltersPanel(this);
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
    this.state.colGroups = [...this.colGroupsCollapsed];
    this.state.highlighted = [...this.highlightedKeys];
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
    this._applyInstanceSnapshot(s.instance);
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
        instance: this.captureInstance(),
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
    const reqId = this._reqId = (this._reqId || 0) + 1;
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
      if (reqId !== this._reqId) return;
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
  /**
   * Řazení SKUPIN z hlavičky skupiny (i pro pole skryté seskupením). Nastaví
   * pole jako PRIMÁRNÍ řadicí klíč (skupiny se podle něj seřadí) a zachová
   * ostatní řazení jako sekundární (řazení řádků uvnitř skupin). Cyklus asc↔desc.
   */
  cycleGroupSort(field2) {
    this._clearActivePreset();
    const cur = this.sort.find((s) => s.field === field2);
    const dir = !cur || cur.dir === "desc" ? "asc" : "desc";
    const others = this.sort.filter((s) => s.field !== field2);
    this._setSort([{ field: field2, dir }, ...others]);
  }
  /** Aktuální směr řazení pole ('asc'|'desc'|null). */
  sortDir(field2) {
    const s = this.sort.find((x) => x.field === field2);
    return s ? s.dir : null;
  }
  /** Přizpůsobí šířku jednoho sloupce obsahu. */
  autoFitColumn(field2) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    const w = measureColumnWidth(col, this);
    if (w) {
      col.width = w;
      this._clearActivePreset();
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
  /**
   * Normalizované deskriptory seskupení (víceúrovňově). Položka instance.groupBy
   * může být `field` (string) nebo `{ field, part }` (datumová úroveň — rok,
   * kvartál, …). Vrací `[{ field, part, id }]`; `id` je stabilní klíč
   * (`field` nebo `field@part`), unikátní a odpovídající existujícímu sloupci.
   */
  groupDescriptors() {
    const g = this.instance.groupBy;
    const arr = Array.isArray(g) ? g : g ? [g] : [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of arr) {
      const field2 = typeof item === "string" ? item : item && item.field;
      const part = typeof item === "string" ? null : item && item.part || null;
      if (!field2 || !this.columns.some((c) => c.field === field2)) continue;
      const id = part ? field2 + "@" + part : field2;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ field: field2, part, id });
    }
    return out;
  }
  /** Zpětně kompatibilní: jen názvy polí použitých k seskupení (bez ohledu na part). */
  groupFields() {
    return this.groupDescriptors().map((d) => d.field);
  }
  /** Pole, jejichž SYROVÁ hodnota je seskupení (part == null) → skryjí se jako běžný sloupec. */
  groupedRawFields() {
    return this.groupDescriptors().filter((d) => !d.part).map((d) => d.field);
  }
  /** Je seskupení řádků aktivní (aspoň jedna platná úroveň)? */
  groupActive() {
    return this.groupDescriptors().length > 0;
  }
  /** Stabilní id deskriptoru pro (field, part). */
  groupId(field2, part = null) {
    return part ? field2 + "@" + part : field2;
  }
  /** Je daná úroveň (field + volitelný part) použita k seskupení? */
  isRowGrouped(field2, part = null) {
    const id = this.groupId(field2, part);
    return this.groupDescriptors().some((d) => d.id === id);
  }
  /** Úroveň (1-based) seskupení pro (field, part), nebo 0 když se neseskupuje. */
  rowGroupLevel(field2, part = null) {
    const id = this.groupId(field2, part);
    return this.groupDescriptors().findIndex((d) => d.id === id) + 1;
  }
  /** Přepne, zda se podle úrovně (field + volitelný part) seskupuje (přidá na konec / odebere). */
  toggleRowGroup(field2, part = null) {
    const id = this.groupId(field2, part);
    const arr = this.groupDescriptors();
    const i = arr.findIndex((d) => d.id === id);
    if (i === -1) arr.push({ field: field2, part, id });
    else arr.splice(i, 1);
    const groupBy = arr.map((d) => d.part ? { field: d.field, part: d.part } : d.field);
    this.setInstance({ groupBy: groupBy.length ? groupBy : null });
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
    const descriptors = this.groupDescriptors();
    const indexed = rows.map((row, index) => ({ row, index }));
    return this._groupLevel(indexed, descriptors, 0, "", []);
  }
  _groupLevel(items, descriptors, level, parentKey, parentPath) {
    const desc = descriptors[level];
    const { field: field2, part } = desc;
    const last = level === descriptors.length - 1;
    const map = /* @__PURE__ */ new Map();
    for (const it of items) {
      const raw = it.row[field2];
      const bucket = part ? dateBucket(raw, part, this.i18n) : null;
      const value = bucket ? bucket.label : it.row[field2];
      const vkey = value == null || value === "" ? "\0empty" : String(value);
      let g = map.get(vkey);
      if (!g) {
        g = { value, vkey, sort: bucket ? bucket.sort : null, items: [] };
        map.set(vkey, g);
      }
      g.items.push(it);
    }
    let groups = [...map.values()];
    if (part) {
      const sorted = this.sort.find((s) => s.field === field2);
      const dir = sorted && sorted.dir === "desc" ? -1 : 1;
      groups.sort((a, b) => dir * ((a.sort ?? 0) - (b.sort ?? 0)));
    }
    return groups.map((g) => {
      const key = parentKey ? parentKey + "\0" + g.vkey : g.vkey;
      const path = [...parentPath, { field: field2, part, value: g.value }];
      const base = { field: field2, part, value: g.value, key, level, count: g.items.length, path };
      return last ? { ...base, rows: g.items } : { ...base, groups: this._groupLevel(g.items, descriptors, level + 1, key, path) };
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
  /** Je skupina SLOUPCŮ (dle názvu) sbalená? */
  isColGroupCollapsed(title) {
    return this.colGroupsCollapsed.has(title);
  }
  /**
   * Přepne sbalení / rozbalení skupiny SLOUPCŮ. Sbalená skupina se v tabulce
   * schová do úzkého proužku (jen ikona pro rozbalení); persistuje se. Mění se
   * sada sloupců i šířky → překreslí hlavičku, tělo a přepočítá layout.
   */
  toggleColGroup(title) {
    if (!title) return;
    if (this.colGroupsCollapsed.has(title)) this.colGroupsCollapsed.delete(title);
    else this.colGroupsCollapsed.add(title);
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
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
  /** Lze uložit globální rozšířený filtr? (aplikace dodala callback) */
  canSaveGlobalAdvanced() {
    return typeof this.options.onSaveGlobalAdvancedFilter === "function";
  }
  /**
   * Uloží pojmenovaný rozšířený filtr (stejný název ve stejném scope přepíše).
   *  - scope 'local' (výchozí) — do localStorage blobu (jen pro tohoto uživatele),
   *    kompletně v knihovně, bez závislosti na aplikaci.
   *  - scope 'global' — knihovna filtr jen sestaví, ukáže v seznamu a předá aplikaci
   *    přes callback onSaveGlobalAdvancedFilter({ id, name, tree }); ta zajistí
   *    perzistenci a sdílení mezi uživateli (DB). Vrací sestavenou položku.
   */
  saveAdvanced(name, tree, scope = "local", display = false) {
    return this._saveNamedFilter(name, scope, display, { tree: JSON.parse(JSON.stringify(tree)) });
  }
  /**
   * Společná perzistence pojmenovaného uloženého filtru (rozšířený strom NEBO snímek
   * sloupcových filtrů). `fields` nese specifika druhu ({ tree } | { kind, filters, filterTypes }).
   * Stejný název ve stejném scope přepíše (zachová id → downstream INSERT … ON DUPLICATE KEY).
   *  - local  → do localStorage blobu (state.advancedFilters), kompletně v knihovně.
   *  - global → knihovna položku sestaví a předá aplikaci přes onSaveGlobalAdvancedFilter;
   *    ta zajistí perzistenci a sdílení (DB). Payload nese i `fields` (u snímku tedy kind+filters).
   */
  _saveNamedFilter(name, scope, display, fields) {
    name = String(name || "").trim();
    if (!name) return null;
    const core = { name, ...normalizeDisplay(display), ...fields };
    if (scope === "global") {
      const existing2 = this.globalAdvanced.find((f) => f.name === name);
      const id = existing2 ? existing2.id : uid2();
      this.globalAdvanced = this.globalAdvanced.filter((f) => f.name !== name);
      const norm5 = { id, ...core, scope: "global" };
      this.globalAdvanced.push(norm5);
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === "function") cb({ id, ...core });
      this.renderer.renderToolbar();
      return norm5;
    }
    const existing = (this.state.advancedFilters || []).find((f) => f.name === name);
    const item = { id: existing ? existing.id : uid2(), ...core };
    this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.name !== name);
    this.state.advancedFilters.push(item);
    this.store.save(this.state);
    this.renderer.renderToolbar();
    return item;
  }
  /**
   * Přepne u uloženého filtru jeho zobrazení v toolbaru — `key` je `'asButton'`
   * (rychlá řada tlačítek) nebo `'asSelect'` (rozbalovací výběr). U globálního filtru
   * pošle změnu aplikaci stejným callbackem jako uložení. `@v1.14.0`
   */
  setAdvancedDisplay(id, key, on) {
    if (key !== "asButton" && key !== "asSelect") return null;
    const g = this.globalAdvanced.find((f) => f.id === id);
    if (g) {
      if (g.asSelect === void 0) g.asSelect = !g.asButton;
      g[key] = !!on;
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === "function") {
        const { scope, ...core } = g;
        cb({ ...core });
      }
      this.renderer.renderToolbar();
      return g;
    }
    const item = (this.state.advancedFilters || []).find((f) => f.id === id);
    if (!item) return null;
    if (item.asSelect === void 0) item.asSelect = !item.asButton;
    item[key] = !!on;
    this.store.save(this.state);
    this.renderer.renderToolbar();
    return item;
  }
  /** Smaže uložený rozšířený filtr (lokální z blobu; globální z UI + callback aplikace). */
  deleteAdvanced(id) {
    const g = this.globalAdvanced.find((f) => f.id === id);
    if (g) {
      this.globalAdvanced = this.globalAdvanced.filter((f) => f.id !== id);
      const cb = this.options.onDeleteGlobalAdvancedFilter;
      if (typeof cb === "function") cb({ id: g.id, name: g.name });
      this.renderer.renderToolbar();
      return;
    }
    this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.id !== id);
    this.store.save(this.state);
    this.renderer.renderToolbar();
  }
  /** Uložené rozšířené filtry pro UI: lokální (scope:'local') + globální (scope:'global'). */
  listAdvanced() {
    const loc = (this.state.advancedFilters || []).map((f) => ({ ...f, scope: "local" }));
    return [...loc, ...this.globalAdvanced];
  }
  /** Je uložená položka snímkem sloupcových filtrů (vs. rozšířený strom)? */
  _isSnapshot(item) {
    return !!(item && item.kind === "columns");
  }
  /** Odpovídá uložená položka aktuálně aplikovanému stavu filtrů? */
  _isSavedActive(item) {
    if (this._isSnapshot(item)) return this._sameFilters(this._activeColumnFilters(), item.filters);
    return !!(this.advanced && JSON.stringify(this.advanced) === JSON.stringify(item.tree));
  }
  /** Id uloženého filtru odpovídajícího aktuálnímu stavu (nebo ''). */
  activeSavedId() {
    const f = this.listAdvanced().find((x) => this._isSavedActive(x));
    return f ? f.id : "";
  }
  /** Uložené filtry označené k zobrazení jako tlačítko (řada nad ikonami v toolbaru). */
  buttonAdvanced() {
    return this.listAdvanced().filter((f) => f.asButton);
  }
  /**
   * Uložené filtry patřící do rozbalovacího výběru v toolbaru. Položka bez volby
   * (uložená před v1.14.0) se řídí postaru: co není tlačítko, je ve výběru.
   */
  selectAdvanced() {
    return this.listAdvanced().filter((f) => f.asSelect === void 0 ? !f.asButton : !!f.asSelect);
  }
  /** Přepínač uloženého filtru (toggle): aplikuje ho, nebo zruší, když už je aktivní. */
  toggleSavedAdvanced(id) {
    const item = this.listAdvanced().find((f) => f.id === id);
    if (!item) return;
    const active = this._isSavedActive(item);
    if (this._isSnapshot(item)) {
      if (active) this.clearColumnFilters();
      else this.applyFiltersSnapshot(item);
    } else if (active) this.clearAdvanced();
    else this.applyAdvanced(JSON.parse(JSON.stringify(item.tree)));
  }
  /* ------- snímky sloupcových filtrů (uživatel „naklikal" filtry a uloží je) ------- */
  /** Porovná dvě mapy filtrů field→value nezávisle na pořadí klíčů. */
  _sameFilters(a, b) {
    const ka = Object.keys(a || {}).sort();
    const kb = Object.keys(b || {}).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }
  /** Aktivní sloupcové filtry (jen ty s neprázdnou hodnotou dle typu filtru). */
  _activeColumnFilters() {
    const out = {};
    for (const [field2, value] of Object.entries(this.filters || {})) {
      const col = this.columns.find((c) => c.field === field2);
      if (!col || !col.filter) continue;
      const def = getFilter(col.filter);
      if (def && !def.isEmpty(value)) out[field2] = value;
    }
    return out;
  }
  /** Je aplikovaný aspoň jeden sloupcový filtr (má hodnotu)? Pro viditelnost ukládací ikony. */
  hasColumnFilters() {
    return Object.keys(this._activeColumnFilters()).length > 0;
  }
  /**
   * Sejme aktuální sloupcové filtry do přenosného snímku: hodnoty + nestandardní
   * typy filtru u dotčených sloupců (aby po načtení fungoval např. přepnutý „Dynamické").
   * Vrací null, když žádný sloupcový filtr není aktivní.
   */
  _captureColumnFilters() {
    const filters = this._activeColumnFilters();
    if (!Object.keys(filters).length) return null;
    const filterTypes = {};
    for (const c of this.columns) {
      if (c.field in filters && c.filter !== c.defaultFilter) filterTypes[c.field] = c.filter;
    }
    return { filters: JSON.parse(JSON.stringify(filters)), filterTypes };
  }
  /** Uloží aktuální sloupcové filtry pod názvem (local/global, volitelně jako tlačítko). */
  saveFilterSnapshot(name, scope = "local", display = false) {
    const snap = this._captureColumnFilters();
    if (!snap) return null;
    return this._saveNamedFilter(name, scope, display, {
      kind: "columns",
      filters: snap.filters,
      filterTypes: snap.filterTypes
    });
  }
  /* ------- úprava uloženého filtru (přepsání hodnot, přejmenování) ------- */
  /**
   * Přepíše uložený snímek **aktuálními** sloupcovými filtry z hlavičky. Uživatel si
   * filtry přenastaví v tabulce, otevře panel uložených filtrů a u položky klikne na
   * disketu. Zůstává `id`, název, rozsah i volby zobrazení. Vrací `null`, když není
   * co uložit (žádný aktivní sloupcový filtr) nebo položka není snímek. `@v1.14.0`
   */
  overwriteSavedFilter(id) {
    const item = this.listAdvanced().find((f) => f.id === id);
    if (!item || item.kind !== "columns" || !this.hasColumnFilters()) return null;
    return this.saveFilterSnapshot(item.name, item.scope || "local", {
      button: !!item.asButton,
      select: item.asSelect === void 0 ? !item.asButton : !!item.asSelect
    });
  }
  /**
   * Přejmenuje uložený filtr (snímek i strom) — mění jen název, `id` a obsah zůstávají.
   * Případná jiná položka téhož názvu ustoupí, ať nevznikne dvojice. `@v1.14.0`
   */
  renameSavedFilter(id, name) {
    const nm = String(name || "").trim();
    if (!nm) return null;
    const g = this.globalAdvanced.find((f) => f.id === id);
    const target = g || (this.state.advancedFilters || []).find((f) => f.id === id);
    if (!target || target.name === nm) return null;
    if (g) this.globalAdvanced = this.globalAdvanced.filter((f) => f.id === id || f.name !== nm);
    else this.state.advancedFilters = (this.state.advancedFilters || []).filter((f) => f.id === id || f.name !== nm);
    target.name = nm;
    if (g) {
      const cb = this.options.onSaveGlobalAdvancedFilter;
      if (typeof cb === "function") {
        const { scope, ...core } = target;
        cb({ ...core });
      }
    } else {
      this.store.save(this.state);
    }
    this.renderer.renderToolbar();
    return target;
  }
  /** Obnoví uložený snímek sloupcových filtrů zpět do políček hlavičky a přefiltruje. */
  applyFiltersSnapshot(snap) {
    if (!snap || !snap.filters) return;
    this._clearActivePreset();
    const types = snap.filterTypes || {};
    for (const c of this.columns) {
      if (!(c.field in snap.filters)) continue;
      const t = types[c.field];
      c.filter = t && c.availableFilters && c.availableFilters.includes(t) ? t : c.defaultFilter;
    }
    this.filters = JSON.parse(JSON.stringify(snap.filters));
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
  }
  /** Zruší jen sloupcové filtry (univerzální/rozšířený/quickSearch nechá být). */
  clearColumnFilters() {
    if (!Object.keys(this.filters).length) return;
    this._clearActivePreset();
    this.filters = {};
    this.page = 1;
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.renderer.renderToolbar();
    this.refresh();
    this._emitFilter();
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
    this.gear?.refresh();
    this._emitColumnLayout("visibility", { field: field2, visible: col.visible });
  }
  setColumnWidth(field2, width) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.width = Math.max(col.minWidth, width);
    this._clearActivePreset();
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
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /** Přejmenuje sloupec (titulek). Prázdný název vrátí výchozí z definice. */
  setColumnTitle(field2, title) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    const v = String(title == null ? "" : title).trim();
    col.title = v || col.defaultTitle;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /** Barva záhlaví SLOUPCE (pozadí + písmo); prázdné hodnoty barvu zruší. */
  setColumnHeaderColor(field2, { background, color } = {}) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.headerBackground = background || null;
    col.headerColor = color || null;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /** Barva záhlaví celé SKUPINY sloupců (nastaví se na všechny její členy). */
  setColGroupHeaderColor(title, { background, color } = {}) {
    if (!title) return;
    let any = false;
    for (const c of this.columns) {
      if (c.group === title) {
        c.groupHeaderBackground = background || null;
        c.groupHeaderColor = color || null;
        any = true;
      }
    }
    if (!any) return;
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderHeader();
    this.renderer.applyLayout();
    this.gear?.refresh();
  }
  /**
   * Formát BUŇKY sloupce (vzhled těla: zarovnání, tučné/kurzíva/podtržení/
   * přeškrtnutí, barva písma/pozadí). `patch` se sloučí; `null` formát zruší.
   */
  setColumnCellFormat(field2, patch) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    if (patch === null) col.cellFormat = null;
    else {
      const next = Object.assign({}, col.cellFormat, patch);
      const hasAny = Object.keys(next).some((k) => next[k]);
      col.cellFormat = hasAny ? next : null;
    }
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /**
   * Vzorec pro souhrnný ŘÁDEK sloupce (vážený / poolovaný souhrn z agregací
   * jiných sloupců — viz core/formula.js). `formula` null/'' vzorec zruší.
   * @throws {FormulaError} když je vzorec neplatný.
   */
  setColumnSummaryFormula(field2, formula, label) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    const src = String(formula == null ? "" : formula).trim();
    if (src) {
      const chk = validateAggregate(src);
      if (!chk.ok) throw new FormulaError(chk.error);
    }
    col.summaryFormula = src || null;
    if (label !== void 0) col.summaryFormulaLabel = src ? String(label).trim() || null : null;
    else if (!src) col.summaryFormulaLabel = null;
    this._clearActivePreset();
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
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /** Výjimka formátu jednoho sloupce; patch=null zruší výjimku (řídí se globálem). */
  setColumnFormat(field2, patch) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.format = patch === null ? null : Object.assign({}, col.format, patch);
    this._clearActivePreset();
    this.saveState();
    this.renderer.renderBody();
    this.gear?.refresh();
  }
  /** Zapojení sloupce do souhrnu ŘÁDKŮ (pravý sloupec) — pole funkcí. */
  setColumnRowSummary(field2, fns) {
    const col = this.columns.find((c) => c.field === field2);
    if (!col) return;
    col.rowSummary = Array.isArray(fns) ? fns : [];
    this._clearActivePreset();
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
    this._clearActivePreset();
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
    this._clearActivePreset();
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
    this.colGroupsCollapsed.delete(groupTitle);
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
    this._clearActivePreset();
    this.saveState();
    this.renderer.applyLayout();
  }
  /**
   * Zahodí uživatelské úpravy sloupců a vrátí výchozí (z definice). Vrací i
   * volby, které se zapínají v tomtéž dialogu a sloupce přeskupují — tedy
   * **seskupení řádků** (seskupený sloupec se kvůli němu stěhuje dopředu
   * a ukotvuje, bez resetu by ho „Obnovit výchozí" neumělo srovnat). Zbytek
   * nastavení tabulky (motiv, stránkování, souhrnný řádek…) patří do „Nastavení
   * tabulky", na ten tenhle reset nesahá.
   */
  resetColumns() {
    this._clearActivePreset();
    this.columns = buildColumns(this.columnDefs || [], []);
    this.state.columns = [];
    const base = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance);
    for (const k of COLUMN_INSTANCE_KEYS) this.instance[k] = base[k];
    this.groupsCollapsed.clear();
    this.colGroupsCollapsed.clear();
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
  /* =================== počítané sloupce (vzorec z UI) =================== */
  /**
   * Přidá počítaný sloupec definovaný vzorcem. Hodnota se počítá z ostatních
   * sloupců (viz src/core/formula.js). Počítané sloupce jsou jen ke čtení a
   * persistují se (localStorage i presety). Vrací `field` nového sloupce.
   * @throws {FormulaError} když je vzorec neplatný.
   */
  addComputedColumn({ title, type = "number", formula } = {}) {
    const src = String(formula == null ? "" : formula).trim();
    if (!src) throw new FormulaError("Pr\xE1zdn\xFD vzorec");
    const chk = validateFormula(src);
    if (!chk.ok) throw new FormulaError(chk.error);
    const field2 = this._uniqueComputedField();
    const def = {
      field: field2,
      title: title != null && String(title).trim() ? String(title).trim() : this.i18n.t("calc.defaultTitle"),
      type: type || "text",
      computed: true,
      formula: src
    };
    this.columns.push(resolveColumn(def, null));
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
    return field2;
  }
  /**
   * Upraví existující počítaný sloupec (název / typ / vzorec). Zachová
   * uživatelský stav sloupce (šířka, viditelnost, souhrny, formát, pořadí).
   * @throws {FormulaError} když je nový vzorec neplatný.
   */
  updateComputedColumn(field2, { title, type, formula } = {}) {
    const idx = this.columns.findIndex((c) => c.field === field2);
    if (idx < 0 || this.columns[idx].formula == null) return;
    const old = this.columns[idx];
    const src = formula != null ? String(formula).trim() : old.formula;
    const chk = validateFormula(src);
    if (!chk.ok) throw new FormulaError(chk.error);
    const def = {
      field: field2,
      title: title != null && String(title).trim() ? String(title).trim() : old.title,
      type: type || old.type,
      computed: true,
      formula: src
    };
    this.columns[idx] = resolveColumn(def, serializeColumns([old])[0]);
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
  }
  /** Odebere počítaný sloupec (jen sloupce vytvořené vzorcem lze smazat). */
  removeComputedColumn(field2) {
    const idx = this.columns.findIndex((c) => c.field === field2);
    if (idx < 0 || this.columns[idx].formula == null) return;
    this.columns.splice(idx, 1);
    delete this.filters[field2];
    this.sort = this.sort.filter((s) => s.field !== field2);
    this._clearActivePreset();
    this.saveState();
    this.rerenderColumns();
  }
  /** Vygeneruje neobsazený `field` pro počítaný sloupec (calc1, calc2, …). */
  _uniqueComputedField() {
    const used = new Set(this.columns.map((c) => c.field));
    let n = 1, f;
    do {
      f = "calc" + n++;
    } while (used.has(f));
    return f;
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
    const index = src.data.findIndex((r) => this.rowKey(r) === String(key));
    const row = index >= 0 ? src.data[index] : null;
    const ok = src.deleteRow(this.keyField, key);
    this.refresh();
    if (ok) {
      if (row) this.history?.record({ type: "delete", row, index });
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
      const index = src.data.findIndex((r) => this.rowKey(r) === String(k));
      const row = index >= 0 ? src.data[index] : null;
      if (src.deleteRow(this.keyField, k)) {
        removed.push({ [this.keyField]: k });
        if (row) entries.push({ type: "delete", row, index });
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
    const key = typeof row === "object" && row !== null ? this.rowKey(row) : String(row);
    if (this.selectAllFiltered) return !this.selectExcept.has(key);
    return this.selected.has(key);
  }
  /** Nastaví výběr jednoho řádku (respektuje single/max). */
  setRowSelected(key, on) {
    key = String(key);
    if (this.selectAllFiltered) {
      if (on) this.selectExcept.delete(key);
      else this.selectExcept.add(key);
      this._afterSelectionChange();
      return;
    }
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
    this.setRowSelected(key, !this.isSelected(String(key)));
  }
  /** Hromadně nastaví výběr sady klíčů (pro shift-výběr rozsahu). */
  selectKeys(keys, on) {
    for (const k of keys) {
      const key = String(k);
      if (this.selectAllFiltered) {
        if (on) this.selectExcept.delete(key);
        else this.selectExcept.add(key);
      } else if (on) this.selected.add(key);
      else this.selected.delete(key);
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
  /** Řádky aktuálního rozsahu (stránka nebo všechny filtrované, co jich grid má). */
  scopeRows() {
    if (this.selectScope === "all") return this.dataSource.allRows && this.dataSource.allRows() || this.rows;
    return this.rows || [];
  }
  /**
   * Počet řádků na **aktuální stránce** — kolik jich je opravdu vidět (na poslední
   * stránce jich bývá míň než `pageSize`). Popisek „Stránka (N)". `@v1.16.0`
   */
  pageCount() {
    return (this.rows || []).length;
  }
  /**
   * Počet **všech** záznamů odpovídajících filtru — i těch nezobrazených na dalších
   * stránkách. Server-side je to `total` z odpovědi, client-side celá filtrovaná sada.
   * Popisek „Všechny záznamy (N)".
   */
  filteredCount() {
    const all = this.dataSource.allRows && this.dataSource.allRows();
    if (Array.isArray(all)) return all.length;
    return Number.isFinite(this.total) ? this.total : (this.rows || []).length;
  }
  /** Počet vybraných záznamů (v režimu „vybráno vše" = všechny minus výjimky). */
  selectedCount() {
    if (this.selectAllFiltered) return Math.max(0, this.filteredCount() - this.selectExcept.size);
    return this.selected.size;
  }
  /** Jsou vybrané všechny řádky aktuálního rozsahu? */
  isScopeAllSelected() {
    if (this.selectAllFiltered) return this.selectScope === "all" ? this.selectExcept.size === 0 : (this.rows || []).every((r) => this.isSelected(r));
    const rows = this.scopeRows();
    return rows.length > 0 && rows.every((r) => this.isSelected(r));
  }
  /**
   * Vybere / odznačí celý aktuální rozsah (dle `isScopeAllSelected`).
   *  - rozsah **'page'** = řádky, které jsou právě vidět,
   *  - rozsah **'all'** = všechny filtrované záznamy. Když je grid client-side, vyjmenují
   *    se klíče; server-side (klíče nezobrazených stránek grid nezná) se zapne režim
   *    „vybráno vše" a odškrtnuté řádky se drží jako výjimky — na dalších stránkách
   *    se výběr projeví, jakmile na ně uživatel vstoupí.
   */
  toggleScopeSelection() {
    const on = !this.isScopeAllSelected();
    if (this.selectScope === "all") {
      if (!on) return this.clearSelection();
      const all = this.dataSource.allRows && this.dataSource.allRows();
      if (Array.isArray(all)) {
        this.selectAllFiltered = false;
        this.selectExcept.clear();
        for (const r of all) this.selected.add(this.rowKey(r));
      } else {
        this.selectAllFiltered = true;
        this.selectExcept.clear();
        this.selected.clear();
      }
      this._afterSelectionChange();
      return;
    }
    for (const r of this.rows || []) {
      const k = this.rowKey(r);
      if (this.selectAllFiltered) {
        if (on) this.selectExcept.delete(k);
        else this.selectExcept.add(k);
      } else if (on) this.selected.add(k);
      else this.selected.delete(k);
    }
    this._afterSelectionChange();
  }
  /**
   * Vybere **celou aktuální stránku** (a přepne na ni rozsah). Volba „Stránka (N)"
   * v menu výběru — klik rovnou vybírá, nejen přepíná rozsah. `@v1.16.0`
   */
  selectPage() {
    this.setSelectScope("page");
    for (const r of this.rows || []) {
      const k = this.rowKey(r);
      if (this.selectAllFiltered) this.selectExcept.delete(k);
      else this.selected.add(k);
    }
    this._afterSelectionChange();
  }
  /**
   * Vybere **všechny filtrované záznamy** včetně nezobrazených (a přepne na ně rozsah).
   * Volba „Všechny záznamy (N)" v menu výběru. `@v1.16.0`
   */
  selectAllRecords() {
    this.setSelectScope("all");
    this.selectAll();
  }
  /** Je vybraná celá aktuální stránka? (zvýraznění volby „Stránka" v menu) */
  isPageAllSelected() {
    const rows = this.rows || [];
    return rows.length > 0 && rows.every((r) => this.isSelected(r));
  }
  /** Jsou vybrané všechny filtrované záznamy? (zvýraznění volby „Všechny záznamy") */
  isAllRecordsSelected() {
    if (this.selectAllFiltered) return this.selectExcept.size === 0;
    const all = this.dataSource.allRows && this.dataSource.allRows();
    if (!Array.isArray(all) || !all.length) return false;
    return all.every((r) => this.isSelected(r));
  }
  /** Invertuje výběr v rámci aktuálního rozsahu (stránka nebo vše). */
  invertSelection() {
    if (this.selectAllFiltered) {
      this.selected = new Set(this.selectExcept);
      this.selectAllFiltered = false;
      this.selectExcept.clear();
      this._afterSelectionChange();
      return;
    }
    for (const r of this.scopeRows()) {
      const k = this.rowKey(r);
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.add(k);
    }
    this._afterSelectionChange();
  }
  clearSelection() {
    this.selected.clear();
    this.selectAllFiltered = false;
    this.selectExcept.clear();
    this._afterSelectionChange();
  }
  /** Vybere všechny filtrované záznamy (bez ohledu na rozsah) — convenience API. */
  selectAll() {
    const all = this.dataSource.allRows && this.dataSource.allRows();
    if (Array.isArray(all)) {
      for (const r of all) this.selected.add(this.rowKey(r));
    } else {
      this.selectAllFiltered = true;
      this.selectExcept.clear();
      this.selected.clear();
    }
    this._afterSelectionChange();
  }
  /**
   * Popis výběru pro aplikaci. V režimu „vybráno vše" (server-side napříč stránkami)
   * nejsou klíče známé — aplikace dostane `all: true` + `excluded` a dotáhne si záznamy
   * sama (typicky přes `getServerParams()` se stejným filtrem). `@v1.16.0`
   */
  getSelection() {
    return {
      all: this.selectAllFiltered,
      count: this.selectedCount(),
      keys: this.selectAllFiltered ? [] : [...this.selected],
      excluded: this.selectAllFiltered ? [...this.selectExcept] : []
    };
  }
  getSelectedKeys() {
    return [...this.selected];
  }
  /** Vybrané řádky jako objekty (z client dat, jinak z aktuální stránky). */
  getSelectedRows() {
    const src = this.dataSource.data || this.rows || [];
    return src.filter((r) => this.isSelected(r));
  }
  _afterSelectionChange() {
    this.renderer.updateSelectionUI();
    if (this.options.onSelectionChange) this.options.onSelectionChange(this.getSelectedRows(), this.getSelectedKeys(), this.getSelection());
  }
  /**
   * Změna filtru mění, co „všechny záznamy" znamená → režim „vybráno vše" se zruší,
   * aby se výběr tiše nepřenesl na jinou množinu dat.
   */
  _resetSelectAllScope() {
    if (!this.selectAllFiltered) return;
    this.selectAllFiltered = false;
    this.selectExcept.clear();
    this._afterSelectionChange();
  }
  /**
   * Serverové request parametry, které by grid právě teď poslal (sort/filter/search/advanced
   * dle `ajax.paramNames`, s rozvinutými relativními datovými tokeny). Pro vlastní endpointy
   * aplikace (např. „ID všech filtrovaných řádků" napříč stránkami, nebo export) — týž filtr
   * bez ruční duplikace serializace. Respektuje i `ajax.requestBuilder`.
   * Jen v server-side režimu; client-side vrací `{}`.
   * @param {{paginate?: boolean}} [opts] `paginate:true` přidá i `page`/`size` (default `false` = bez stránkování → „vše filtrované").
   * @returns {object}
   */
  getServerParams({ paginate = false } = {}) {
    if (!(this.dataSource instanceof ServerData)) return {};
    const state = {
      page: this.page,
      pageSize: this.pageSize,
      paginate,
      sort: this.sort,
      filters: this.filters,
      advanced: this.advanced,
      universal: this.universalActive() ? this.universal : null,
      search: this.quickSearch || "",
      columns: this.columns
    };
    const ajax = this.dataSource.ajax;
    return ajax.requestBuilder ? ajax.requestBuilder(state) : this.dataSource.buildParams(state);
  }
  /**
   * Hotový urlencoded querystring z {@link getServerParams} (bracket-formát kontraktu).
   * Rozšířený filtr `advanced` je vždy jako JSON string, takže querystring funguje i u
   * gridu s `ajax.method: 'POST'`. Připoj za `?`/`&` na vlastní GET endpoint.
   * @param {{paginate?: boolean}} [opts]
   * @returns {string}
   */
  getServerQuery(opts) {
    let params = this.getServerParams(opts);
    const advKey = this.dataSource.names && this.dataSource.names.advanced || "advanced";
    if (params[advKey] && typeof params[advKey] === "object") {
      params = { ...params, [advKey]: JSON.stringify(params[advKey]) };
    }
    return encodeParams(params).toString();
  }
  /* ---------------- zvýraznění (podbarvení) řádků ---------------- */
  /** Zvýrazněné řádky jako pole klíčů (keyField). */
  get highlightedRows() {
    return [...this.highlightedKeys];
  }
  /** Je řádek (objekt nebo klíč) zvýrazněný? */
  isHighlighted(row) {
    return this.highlightedKeys.has(typeof row === "object" && row !== null ? this.rowKey(row) : String(row));
  }
  /** Zapne/vypne zvýraznění jednoho řádku. Překreslí jen dotčený řádek (bez plného re-renderu). */
  highlightRow(key, on = true) {
    key = String(key);
    if (on) this.highlightedKeys.add(key);
    else this.highlightedKeys.delete(key);
    this._afterHighlightChange(key);
  }
  toggleRowHighlight(key) {
    this.highlightRow(key, !this.highlightedKeys.has(String(key)));
  }
  /** Zruší veškeré zvýraznění. */
  clearHighlights() {
    if (!this.highlightedKeys.size) return;
    this.highlightedKeys.clear();
    this._afterHighlightChange();
  }
  _afterHighlightChange(key) {
    this.renderer.updateHighlightUI(key);
    this.saveState();
    if (this.options.onHighlightChange) this.options.onHighlightChange(this.highlightedRows);
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
  /**
   * Snapshot persistovatelného stavu (pro uložení do presetu / globálních výchozích).
   * Zachytit se dá VŠE, co si uživatel může naklikat: sloupce (pořadí, šířky,
   * souhrny, formáty, barvy záhlaví…), řazení + filtry a nastavení tabulky
   * (`instance`) — včetně seskupení řádků, souhrnného řádku a mezisoučtů skupin.
   *
   * `parts` (nepovinné) vybírá, co se do snímku dostane: `{ columns, filters,
   * instance }`. Nezadáno = všechno. Část, kterou snímek neobsahuje, se při
   * aplikaci NEMĚNÍ — tak vznikne třeba preset „jen filtry".
   */
  captureState(parts) {
    const p = presetParts(parts);
    const st = {};
    if (p.columns) st.columns = serializeColumns(this.columns);
    if (p.filters) {
      st.sort = JSON.parse(JSON.stringify(this.sort));
      st.filters = JSON.parse(JSON.stringify(this.filters));
    }
    if (p.instance) st.instance = this.captureInstance();
    return st;
  }
  /** Které části preset obsahuje (pro UI: popisek „co preset nese"). */
  presetContents(preset) {
    const st = preset && preset.state || {};
    return {
      columns: Array.isArray(st.columns),
      filters: Array.isArray(st.sort) || isPlainObject(st.filters),
      instance: isPlainObject(st.instance)
    };
  }
  /**
   * Snapshot nastavení tabulky. Bere celou `instance` (ať se nově přidaná volba
   * zachytí sama od sebe) kromě přechodného UI stavu, který není „nastavení“ —
   * ten by se přes preset přenášet neměl. Hloubková kopie: preset musí přežít
   * další změny živé instance (cssVars, format, scaleColors, groupBy).
   */
  captureInstance() {
    const snap = JSON.parse(JSON.stringify(this.instance));
    for (const k of TRANSIENT_INSTANCE_KEYS) delete snap[k];
    return snap;
  }
  /**
   * Nasadí snapshot nastavení do živé instance — stejný merge jako při startu
   * (výchozí ← options.instance ← snapshot), takže volba, kterou snapshot nezná,
   * spadne na výchozí hodnotu. Přechodný UI stav zůstává uživateli, jaký měl.
   */
  _applyInstanceSnapshot(snap) {
    const prev = this.instance;
    this.instance = Object.assign(
      {},
      INSTANCE_DEFAULTS,
      this.options.instance,
      JSON.parse(JSON.stringify(snap || {}))
    );
    for (const k of TRANSIENT_INSTANCE_KEYS) this.instance[k] = prev[k];
    this.pageSize = this.instance.pageSize;
  }
  /** Presety označené k zobrazení jako tlačítko (řada nad ikonami v toolbaru). `@v1.14.0` */
  buttonPresets() {
    return this.presets ? this.presets.buttons() : [];
  }
  /** Presety označené k zobrazení v rozbalovacím výběru v toolbaru. `@v1.14.0` */
  selectPresets() {
    return this.presets ? this.presets.selects() : [];
  }
  /** Aplikuje preset — sestaví sloupce/řazení/filtry/nastavení ze snapshotu a překreslí. */
  applyPreset(preset) {
    const st = preset && preset.state ? preset.state : {};
    if (Array.isArray(st.columns)) {
      this.columns = buildColumns(this.columnDefs || [], st.columns);
    }
    if (Array.isArray(st.sort)) this.sort = JSON.parse(JSON.stringify(st.sort));
    if (isPlainObject(st.filters)) this.filters = JSON.parse(JSON.stringify(st.filters));
    if (isPlainObject(st.instance)) {
      this._applyInstanceSnapshot(st.instance);
      this.renderer.applyInstanceStyles();
    }
    this.page = 1;
    this._activePresetId = preset.id;
    this.saveState();
    this.renderer.renderToolbar();
    this.renderer.renderHeader();
    this.renderer.renderBody();
    this.renderer.applyLayout();
    this.gear?.refresh();
    this.refresh();
  }
  /**
   * Přepínač presetu (klik na tlačítko v rychlé řadě): neaktivní preset aplikuje,
   * u aktivního vrátí **výchozí zobrazení** — obdoba „vypnutí" u uložených filtrů.
   * `@v1.14.0`
   */
  togglePreset(preset) {
    if (!preset) return;
    if (this._activePresetId === preset.id) this.resetView();
    else this.applyPreset(preset);
  }
  /**
   * Vrátí **výchozí zobrazení**: sloupce a nastavení tabulky jako po startu bez
   * presetu (výchozí ← `options.instance`). Co si uživatel naklikal *mimo* zobrazení
   * — **filtry** (sloupcové, univerzální, rozšířený), **řazení** i rychlé hledání —
   * zůstává v platnosti. `@v1.14.0`
   */
  resetView() {
    this._activePresetId = null;
    this.columns = buildColumns(this.columnDefs || [], []);
    this.state.columns = [];
    const prev = this.instance;
    this.instance = Object.assign({}, INSTANCE_DEFAULTS, this.options.instance);
    for (const k of TRANSIENT_INSTANCE_KEYS) this.instance[k] = prev[k];
    this.pageSize = this.instance.pageSize;
    this.groupsCollapsed.clear();
    this.colGroupsCollapsed.clear();
    this.page = 1;
    this.saveState();
    this.renderer.applyInstanceStyles();
    this.renderer.renderToolbar();
    this.rerenderColumns();
    this.refresh();
  }
  /** Zruší označení aktivního presetu (uživatel začal měnit ručně). */
  _clearActivePreset() {
    const had = this._activePresetId;
    this._activePresetId = null;
    if (had && this.renderer && this.buttonPresets().some((p) => p.id === had)) this.renderer.renderToolbar();
  }
  /* =================== callbacky stavu (pro aplikaci) =================== */
  /** Řazení se změnilo → options.onSort([{field,dir}, …]). */
  _emitSort() {
    if (this.options.onSort) this.options.onSort(this.sort.map((s) => ({ ...s })));
  }
  /** Filtry se změnily → options.onFilter({filters, universal, advanced}). */
  _emitFilter() {
    this.renderer.updateFilterClearBtn();
    this._resetSelectAllScope();
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
    if ("wrapHeader" in patch) {
      this.renderer.applyLayout();
    }
    if ("summaryRow" in patch || "groupSubtotals" in patch) {
      this.renderer.renderBody();
    }
    if ("emptyText" in patch || "wrapText" in patch || "locale" in patch || "scaleColors" in patch || "linkNewTab" in patch) {
      this.renderer.renderBody();
    }
    if ("groupBy" in patch || "groupDisplay" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
      this.gear?.refresh();
    }
    if ("groupRepeat" in patch) {
      this.renderer.renderBody();
    }
    if ("selectColumn" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
    }
    if ("selectRowClick" in patch || "rowHighlight" in patch) {
      this.renderer.renderBody();
    }
    if ("actionsLayout" in patch) {
      this.renderer.renderHeader();
      this.renderer.renderBody();
      this.renderer.applyLayout();
    }
    if ("showVersion" in patch) this.renderer.renderFooter();
    if ("paginationPosition" in patch || "pageSize" in patch) {
      if ("pageSize" in patch) this.pageSize = this.instance.pageSize;
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
export {
  ClientData,
  HEADER_COLOR_PRESETS,
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
  openColorPicker,
  openHeaderColorPicker,
  registerFilter,
  registerLanguage,
  registerType,
  serializeColumns
};
