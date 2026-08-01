/**
 * formula.js — bezpečné vyhodnocení uživatelských výrazů pro POČÍTANÉ SLOUPCE.
 *
 * Řetězec vzorce zadaný v UI se zkompiluje na funkci `(row) => hodnota`, kterou
 * si počítaný sloupec uloží jako `col.value`. Odtud ho využije vše ostatní
 * (render, řazení, filtr, hledání, export) přes `cellValue`.
 *
 * Bez `eval` / `new Function` — vlastní tokenizer → rekurzivní parser → AST →
 * evaluátor. Vyhodnocují se jen definované operátory a funkce a čtení polí
 * řádku; nic z globálního prostředí není dosažitelné. Odkaz na sloupec je
 * `identifikator` nebo `[Název s mezerami]`.
 *
 * Podporováno: aritmetika (+ - * / %), porovnání (== != < <= > >=), logika
 * (&& || !), ternár (a ? b : c), řetězce (spojení přes +), literály (čísla,
 * 'text', true/false/null) a sada funkcí (text, čísla, datumy, if/coalesce).
 * Chyba za běhu → výjimka; `cellValue` ji odchytí a vrátí `undefined`.
 */

export class FormulaError extends Error {
  constructor(message) { super(message); this.name = 'FormulaError'; }
}

/* ------------------------------ tokenizer ------------------------------ */

const ID_START = /[A-Za-z_À-ɏ]/;
const ID_PART = /[A-Za-z0-9_À-ɏ]/;

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // číslo (jen tečka jako des. oddělovač; čárka je oddělovač argumentů)
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i + 1;
      while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      const num = parseFloat(src.slice(i, j));
      if (!Number.isFinite(num)) throw new FormulaError('Neplatné číslo: ' + src.slice(i, j));
      toks.push({ t: 'num', v: num });
      i = j; continue;
    }

    // řetězec '...' nebo "..." (zdvojení uvozovky = její vložení)
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1; let s = '';
      while (j < n) {
        if (src[j] === q) {
          if (src[j + 1] === q) { s += q; j += 2; continue; } // zdvojená = escape
          break;
        }
        s += src[j]; j++;
      }
      if (j >= n) throw new FormulaError('Neuzavřený řetězec');
      toks.push({ t: 'str', v: s });
      i = j + 1; continue;
    }

    // pole v hranatých závorkách: [Název s mezerami]
    if (c === '[') {
      let j = i + 1; let s = '';
      while (j < n && src[j] !== ']') { s += src[j]; j++; }
      if (j >= n) throw new FormulaError('Neuzavřená [závorka] pole');
      toks.push({ t: 'field', v: s.trim() });
      i = j + 1; continue;
    }

    // identifikátor (pole nebo název funkce nebo klíčové slovo)
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j++;
      toks.push({ t: 'ident', v: src.slice(i, j) });
      i = j; continue;
    }

    // víceznakové operátory
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '<>' || two === '&&' || two === '||') {
      toks.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue;
    }
    // jednoznakové operátory (samotné '=' bereme jako '==')
    if ('+-*/%<>'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '=') { toks.push({ t: 'op', v: '==' }); i++; continue; }
    if (c === '!') { toks.push({ t: 'op', v: '!' }); i++; continue; }
    if ('(),?:'.includes(c)) { toks.push({ t: 'punct', v: c }); i++; continue; }

    throw new FormulaError('Neznámý znak: „' + c + '"');
  }
  toks.push({ t: 'eof' });
  return toks;
}

/* -------------------------------- parser -------------------------------- */

// Precedence (nízká → vysoká): ternár < || < && < porovnání < +− < */% < unární
function parse(toks) {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const expect = (t, v) => {
    const tk = next();
    if (tk.t !== t || (v != null && tk.v !== v)) throw new FormulaError('Očekáváno „' + (v || t) + '"');
    return tk;
  };

  const isOp = (v) => { const tk = peek(); return tk.t === 'op' && v.includes(tk.v); };
  const isPunct = (v) => { const tk = peek(); return tk.t === 'punct' && tk.v === v; };

  function binLevel(sub, ops) {
    let left = sub();
    while (isOp(ops)) { const op = next().v; left = { k: 'bin', op, l: left, r: sub() }; }
    return left;
  }

  const parseExpr = () => parseTernary();

  function parseTernary() {
    const cond = parseOr();
    if (isPunct('?')) {
      next();
      const a = parseExpr();
      expect('punct', ':');
      const b = parseExpr();
      return { k: 'if', args: [cond, a, b] };
    }
    return cond;
  }

  const parseOr = () => binLevel(parseAnd, ['||']);
  const parseAnd = () => binLevel(parseCmp, ['&&']);
  const parseCmp = () => binLevel(parseAdd, ['==', '!=', '<', '<=', '>', '>=']);
  const parseAdd = () => binLevel(parseMul, ['+', '-']);
  const parseMul = () => binLevel(parseUnary, ['*', '/', '%']);

  function parseUnary() {
    if (isOp(['-', '+', '!'])) { const op = next().v; return { k: 'un', op, x: parseUnary() }; }
    return parsePrimary();
  }

  function parsePrimary() {
    const tk = peek();
    if (tk.t === 'num') { next(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'str') { next(); return { k: 'str', v: tk.v }; }
    if (tk.t === 'field') { next(); return { k: 'field', v: tk.v }; }
    if (isPunct('(')) { next(); const e = parseExpr(); expect('punct', ')'); return e; }
    if (tk.t === 'ident') {
      next();
      const name = tk.v;
      const low = name.toLowerCase();
      if (low === 'true') return { k: 'lit', v: true };
      if (low === 'false') return { k: 'lit', v: false };
      if (low === 'null') return { k: 'lit', v: null };
      // volání funkce name( ... )
      if (isPunct('(')) {
        next();
        const args = [];
        if (!isPunct(')')) {
          args.push(parseExpr());
          while (isPunct(',')) { next(); args.push(parseExpr()); }
        }
        expect('punct', ')');
        return { k: 'call', name: low, args };
      }
      // holý identifikátor = odkaz na pole
      return { k: 'field', v: name };
    }
    throw new FormulaError('Neočekávaný vstup ve výrazu');
  }

  const ast = parseExpr();
  if (peek().t !== 'eof') throw new FormulaError('Přebývající vstup za výrazem');
  return ast;
}

/* ------------------------------ koerce typů ------------------------------ */

function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (v == null || v === '') return NaN;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
function isNum(v) { return Number.isFinite(num(v)); }
function str(v) {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v);
}
function bool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  const s = String(v).trim().toLowerCase();
  return !(s === '' || s === '0' || s === 'false' || s === 'ne' || s === 'no');
}
function toDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function midnight(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }

/* ------------------------------- funkce -------------------------------- */

const FUNCS = {
  // matematika
  abs: (a) => Math.abs(num(a)),
  round: (a, d) => { const p = Math.pow(10, d == null ? 0 : Math.trunc(num(d))); return Math.round(num(a) * p) / p; },
  floor: (a) => Math.floor(num(a)),
  ceil: (a) => Math.ceil(num(a)),
  sqrt: (a) => Math.sqrt(num(a)),
  pow: (a, b) => Math.pow(num(a), num(b)),
  mod: (a, b) => num(a) % num(b),
  min: (...xs) => Math.min(...xs.map(num)),
  max: (...xs) => Math.max(...xs.map(num)),
  number: (a) => num(a),

  // text
  concat: (...xs) => xs.map(str).join(''),
  upper: (a) => str(a).toUpperCase(),
  lower: (a) => str(a).toLowerCase(),
  trim: (a) => str(a).trim(),
  len: (a) => str(a).length,
  left: (a, n) => { const k = Math.trunc(num(n)); return k <= 0 ? '' : str(a).slice(0, k); },
  right: (a, n) => { const s = str(a), k = Math.trunc(num(n)); return k <= 0 ? '' : s.slice(Math.max(0, s.length - k)); },
  substr: (a, start, len) => { const s = str(a), st = Math.trunc(num(start)); return len == null ? s.slice(st) : s.slice(st, st + Math.trunc(num(len))); },
  replace: (a, from, to) => str(a).split(str(from)).join(str(to)),
  contains: (a, sub) => str(a).toLowerCase().includes(str(sub).toLowerCase()),

  // logika
  coalesce: (...xs) => {
    for (const x of xs) if (x != null && x !== '' && !(typeof x === 'number' && Number.isNaN(x))) return x;
    return xs.length ? xs[xs.length - 1] : null;
  },
  isblank: (a) => a == null || str(a).trim() === '',
  not: (a) => !bool(a),
  text: (a) => str(a),

  // datum (dnešní datum se bere z reálného času prohlížeče)
  today: () => midnight(new Date()),
  now: () => new Date(),
  date: (a) => toDate(a),
  year: (a) => { const d = toDate(a); return d ? d.getFullYear() : NaN; },
  month: (a) => { const d = toDate(a); return d ? d.getMonth() + 1 : NaN; },
  day: (a) => { const d = toDate(a); return d ? d.getDate() : NaN; },
  weekday: (a) => { const d = toDate(a); return d ? ((d.getDay() + 6) % 7) + 1 : NaN; }, // 1=Po … 7=Ne
  days: (a, b) => { const da = toDate(a), db = toDate(b); if (!da || !db) return NaN; return Math.round((midnight(db) - midnight(da)) / 86400000); },
  age: (a) => {
    const d = toDate(a); if (!d) return NaN;
    const t = new Date(); let y = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) y--;
    return y;
  },
};

/** Názvy funkcí, které umíme (pro nápovědu v UI i validaci). */
export const FORMULA_FUNCTIONS = Object.keys(FUNCS).concat(['if']);

/**
 * Katalog funkcí pro referenci/výběr v UI (Excel-like). Řazeno do kategorií;
 * signatury a popisy se berou z i18n (`calc.fn.<name>` / `calc.fnCat.<cat>`).
 */
export const FORMULA_CATALOG = [
  { cat: 'num', fns: ['round', 'floor', 'ceil', 'abs', 'sqrt', 'pow', 'mod', 'min', 'max', 'number'] },
  { cat: 'text', fns: ['concat', 'upper', 'lower', 'trim', 'len', 'left', 'right', 'substr', 'replace', 'contains', 'text'] },
  { cat: 'logic', fns: ['if', 'coalesce', 'isblank', 'not'] },
  { cat: 'date', fns: ['today', 'now', 'date', 'year', 'month', 'day', 'weekday', 'days', 'age'] },
];

/* ------------------------------ evaluátor ------------------------------ */

const hasOwn = Object.prototype.hasOwnProperty;

function evalNode(node, row) {
  switch (node.k) {
    case 'num': case 'str': case 'lit': return node.v;
    // Jen VLASTNÍ vlastnosti řádku — nikdy zděděné z prototypu (constructor,
    // __proto__, toString…), aby vzorec nemohl sáhnout mimo data.
    case 'field': return (row != null && hasOwn.call(row, node.v)) ? row[node.v] : undefined;
    case 'un': {
      const x = evalNode(node.x, row);
      if (node.op === '-') return -num(x);
      if (node.op === '+') return num(x);
      return !bool(x); // '!'
    }
    case 'bin': return evalBin(node, row);
    case 'if': // ternár i funkce if() — líné vyhodnocení větví
      return bool(evalNode(node.args[0], row))
        ? evalNode(node.args[1], row)
        : (node.args[2] !== undefined ? evalNode(node.args[2], row) : null);
    case 'call': {
      if (node.name === 'if') {
        return bool(evalNode(node.args[0], row))
          ? evalNode(node.args[1], row)
          : (node.args[2] !== undefined ? evalNode(node.args[2], row) : null);
      }
      const fn = FUNCS[node.name];
      return fn(...node.args.map((a) => evalNode(a, row)));
    }
  }
  return undefined;
}

function evalBin(node, row) {
  const op = node.op;
  // logika se zkráceným vyhodnocením
  if (op === '&&') return bool(evalNode(node.l, row)) && bool(evalNode(node.r, row));
  if (op === '||') return bool(evalNode(node.l, row)) || bool(evalNode(node.r, row));
  const a = evalNode(node.l, row), b = evalNode(node.r, row);
  switch (op) {
    // '+' sčítá jen když jsou obě strany číselné, jinak spojuje text
    case '+': return (isNum(a) && isNum(b)) ? num(a) + num(b) : str(a) + str(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': { const d = num(b); return d === 0 ? NaN : num(a) / d; }
    case '%': { const d = num(b); return d === 0 ? NaN : num(a) % d; }
    case '==': return eq(a, b);
    case '!=': return !eq(a, b);
    case '<': case '<=': case '>': case '>=': return cmp(op, a, b);
  }
  return undefined;
}

function eq(a, b) {
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  return str(a) === str(b);
}
function cmp(op, a, b) {
  let x, y;
  if (isNum(a) && isNum(b)) { x = num(a); y = num(b); } else { x = str(a); y = str(b); }
  switch (op) { case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y; }
}

/* ---------- validace (neznámé funkce / špatná arita if) v AST ---------- */

function validate(node) {
  if (!node || typeof node !== 'object') return;
  if (node.k === 'call') {
    if (node.name === 'if') {
      if (node.args.length < 2) throw new FormulaError('if() potřebuje aspoň podmínku a hodnotu: if(podmínka, když ano, když ne)');
    } else if (!FUNCS[node.name]) {
      throw new FormulaError('Neznámá funkce: ' + node.name + '()');
    }
  }
  for (const key of ['x', 'l', 'r']) if (node[key]) validate(node[key]);
  if (node.args) node.args.forEach(validate);
}

/* -------------------------------- API ---------------------------------- */

/** Rozparsuje vzorec na AST (vyhodí FormulaError při syntaktické chybě). */
export function parseFormula(src) { return parse(tokenize(String(src == null ? '' : src))); }

/** Zkompiluje vzorec na funkci `(row) => hodnota`. Vyhodí FormulaError. */
export function compileFormula(src) {
  const ast = parseFormula(src);
  validate(ast);
  return (row) => evalNode(ast, row);
}

/** Ověří vzorec bez vyhození výjimky: `{ ok, error?, ast? }`. */
export function validateFormula(src) {
  try { const ast = parseFormula(src); validate(ast); return { ok: true, ast }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

/** Názvy polí, na která vzorec odkazuje (pro kontrolu/nápovědu). */
export function formulaFields(ast) {
  const out = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.k === 'field') out.add(n.v);
    for (const key of ['x', 'l', 'r']) if (n[key]) walk(n[key]);
    if (n.args) n.args.forEach(walk);
  })(ast);
  return [...out];
}

/* =================== AGREGAČNÍ vzorce (souhrnný řádek) =================== */
/**
 * Vzorec pro SOUHRN sloupce se počítá přes VŠECHNY řádky (v rozsahu). Uvnitř
 * agregační funkce `sum/avg/count/min/max/median` se argument vyhodnotí pro
 * každý řádek zvlášť (per-row evaluátorem) a výsledky se zredukují. Mimo
 * agregaci jsou jen skalární operace nad výsledky agregací — proto lze psát
 * poolované poměry: `sum(spojeno) / sum(vytoceno) * 100` i vážené průměry:
 * `sum(cena * obchody) / sum(obchody)`.
 */

const AGG_FNS = {
  sum: (vs) => vs.reduce((a, b) => a + b, 0),
  avg: (vs) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN),
  min: (vs) => (vs.length ? Math.min(...vs) : NaN),
  max: (vs) => (vs.length ? Math.max(...vs) : NaN),
  median: (vs) => {
    if (!vs.length) return NaN;
    const s = [...vs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
};

/** Vyhodnotí argument agregace pro každý řádek a vrátí pole konečných čísel. */
function aggNums(argNode, rows) {
  const out = [];
  for (const r of rows) { const n = num(evalNode(argNode, r)); if (Number.isFinite(n)) out.push(n); }
  return out;
}
/** Počet řádků s neprázdnou hodnotou argumentu (count). */
function aggCount(argNode, rows) {
  let c = 0;
  for (const r of rows) {
    const v = argNode ? evalNode(argNode, r) : 1;
    if (v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) c++;
  }
  return c;
}

function evalAgg(node, rows) {
  switch (node.k) {
    case 'num': case 'str': case 'lit': return node.v;
    case 'field': return undefined; // pole mimo agregaci (validace to nepustí)
    case 'un': {
      const x = evalAgg(node.x, rows);
      if (node.op === '-') return -num(x);
      if (node.op === '+') return num(x);
      return !bool(x);
    }
    case 'bin': return evalAggBin(node, rows);
    case 'if':
      return bool(evalAgg(node.args[0], rows))
        ? evalAgg(node.args[1], rows)
        : (node.args[2] !== undefined ? evalAgg(node.args[2], rows) : null);
    case 'call': {
      const n = node.name;
      if (n === 'count') return aggCount(node.args[0], rows);
      if (AGG_FNS[n]) return AGG_FNS[n](aggNums(node.args[0], rows));
      if (n === 'if') {
        return bool(evalAgg(node.args[0], rows))
          ? evalAgg(node.args[1], rows)
          : (node.args[2] !== undefined ? evalAgg(node.args[2], rows) : null);
      }
      return FUNCS[n](...node.args.map((a) => evalAgg(a, rows)));
    }
  }
  return undefined;
}

function evalAggBin(node, rows) {
  const op = node.op;
  if (op === '&&') return bool(evalAgg(node.l, rows)) && bool(evalAgg(node.r, rows));
  if (op === '||') return bool(evalAgg(node.l, rows)) || bool(evalAgg(node.r, rows));
  const a = evalAgg(node.l, rows), b = evalAgg(node.r, rows);
  switch (op) {
    case '+': return (isNum(a) && isNum(b)) ? num(a) + num(b) : str(a) + str(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': { const d = num(b); return d === 0 ? NaN : num(a) / d; }
    case '%': { const d = num(b); return d === 0 ? NaN : num(a) % d; }
    case '==': return eq(a, b);
    case '!=': return !eq(a, b);
    case '<': case '<=': case '>': case '>=': return cmp(op, a, b);
  }
  return undefined;
}

const AGG_NAMES = new Set(['sum', 'avg', 'count', 'min', 'max', 'median']);

/** Validace agregačního vzorce: pole jen uvnitř agregace, agregace se nevnořují. */
function validateAgg(node, insideAgg) {
  if (!node || typeof node !== 'object') return;
  if (node.k === 'field' && !insideAgg) {
    throw new FormulaError('Pole „' + node.v + '" musí být uvnitř agregace — např. sum(' + node.v + ')');
  }
  if (node.k === 'call') {
    const isAgg = AGG_NAMES.has(node.name);
    if (isAgg && insideAgg) throw new FormulaError('Agregaci nelze vnořit do jiné agregace: ' + node.name + '()');
    if (!isAgg && node.name !== 'if' && !FUNCS[node.name]) throw new FormulaError('Neznámá funkce: ' + node.name + '()');
    const inner = insideAgg || isAgg;
    node.args.forEach((a) => validateAgg(a, inner));
    return;
  }
  for (const key of ['x', 'l', 'r']) if (node[key]) validateAgg(node[key], insideAgg);
  if (node.args) node.args.forEach((a) => validateAgg(a, insideAgg));
}

/** Zkompiluje agregační vzorec na funkci `(rows) => hodnota`. Vyhodí FormulaError. */
export function compileAggregate(src) {
  const ast = parseFormula(src);
  validateAgg(ast, false);
  return (rows) => evalAgg(ast, rows || []);
}

/** Ověří agregační vzorec bez vyhození výjimky: `{ ok, error?, ast? }`. */
export function validateAggregate(src) {
  try { const ast = parseFormula(src); validateAgg(ast, false); return { ok: true, ast }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

/** Katalog agregačních funkcí pro referenci v UI (souhrnný editor). */
export const AGGREGATE_CATALOG = [
  { cat: 'agg', fns: ['sum', 'avg', 'count', 'min', 'max', 'median'] },
  { cat: 'num', fns: ['round', 'abs', 'floor', 'ceil'] },
];
