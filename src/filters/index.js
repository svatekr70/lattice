/**
 * Header filtry — deklarativní `filter` typ na sloupci určuje ovládací prvek,
 * client-side porovnání i server-side serializaci.
 *
 * Každý filtr implementuje jednotné rozhraní:
 *   build(column, ctx) -> HTMLElement   // ovládací prvek do hlavičky
 *   isEmpty(value)      -> boolean       // je filtr prázdný (neaplikovat)?
 *   match(value, cell, row, column) -> boolean   // client-side test řádku
 *   toServer(field, value, column)  -> Array<{field,type,value}>  // server params
 *
 * ctx (předává Lattice):
 *   { i18n, value, onChange(value), fetchJson(url), debounceMs }
 *
 * Registr je otevřený — registerFilter() přidá vlastní typ bez zásahu do jádra.
 */
import { el, clear, debounce, onOutside } from '../util/dom.js';
import { buildDateRangePicker } from './dateRangePicker.js';
import { resolveToken } from './advancedEval.js';
import { positionUnder } from '../features/gear.js';

const registry = new Map();

export function registerFilter(name, def) {
  registry.set(name, def);
}
export function getFilter(name) {
  return registry.get(name) || null;
}

/* ---- pomocné ----------------------------------------------------------- */

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function toTime(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}
/** Normalizuje hodnotu buňky na den (00:00) pro férové porovnání rozsahů. */
function dayTime(v) {
  const t = toTime(v);
  if (t == null) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function norm(s) {
  return String(s ?? '').toLowerCase();
}

/** Normalizuje option na { value, label } (string value). */
function normOption(o) {
  if (o != null && typeof o === 'object') return { value: String(o.value), label: String(o.label != null ? o.label : o.value) };
  return { value: String(o), label: String(o) };
}

/**
 * Seřadí options abecedně vzestupně podle labelu, locale-aware podle aktivního
 * jazyka (v češtině tak 'č' řadí hned za 'c'). Vypne se `column.filterSort:false`.
 */
function sortOptions(opts, column, ctx) {
  if (column.filterSort === false) return opts;
  const locale = ctx.i18n && ctx.i18n.locale;
  return opts.slice().sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true }));
}

/** Načte options (statické z filterValues nebo async z filterUrl) → [{value,label}], seřazené. */
function fetchOptions(column, ctx) {
  if (Array.isArray(column.filterValues)) return Promise.resolve(sortOptions(column.filterValues.map(normOption), column, ctx));
  if (column.filterUrl && ctx.fetchJson) {
    return ctx.fetchJson(column.filterUrl)
      .then((d) => sortOptions((Array.isArray(d) ? d : d && d.data ? d.data : []).map(normOption), column, ctx))
      .catch(() => []);
  }
  // Bez filterValues/filterUrl: odvoď hodnoty z dat (distinktní hodnoty sloupce).
  if (typeof ctx.distinctValues === 'function') return Promise.resolve(sortOptions(ctx.distinctValues().map(normOption), column, ctx));
  return Promise.resolve([]);
}

/* ---- TEXT (s podporou negace !výraz) ----------------------------------- */

registerFilter('text', {
  build(column, ctx) {
    const input = el('input.lattice-filter-input', {
      type: 'text',
      placeholder: ctx.i18n.t('filters.search'),
      title: ctx.i18n.t('filters.negateHint'),
      value: ctx.value ?? '',
    });
    // Malý křížek vpravo — objeví se, když je něco zadané, klik vyčistí filtr.
    const clear = el('button.lattice-filter-clear', { type: 'button', tabindex: '-1', title: ctx.i18n.t('filters.clearOne'), text: '×' });
    const sync = () => { clear.style.display = input.value ? '' : 'none'; };
    sync();
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener('input', () => { sync(); fire(input.value); });
    clear.addEventListener('mousedown', (e) => e.preventDefault()); // ať input neztratí fokus před klikem
    clear.addEventListener('click', () => { input.value = ''; sync(); ctx.onChange(''); input.focus(); });
    return el('div.lattice-filter-clearable', {}, [input, clear]);
  },
  isEmpty: (v) => !v || String(v).trim() === '',
  match(value, cell) {
    const raw = String(value).trim();
    const negate = raw.startsWith('!');
    const needle = norm(negate ? raw.slice(1) : raw);
    if (needle === '') return true;
    const has = norm(cell).includes(needle);
    return negate ? !has : has;
  },
  toServer: (field, value) => [{ field, type: 'like', value }],
});

/* ---- NUMBER (podporuje >, <, >=, <=, = prefix; jinak rovná se) ---------- */

registerFilter('number', {
  build(column, ctx) {
    const input = el('input.lattice-filter-input', {
      type: 'text',
      placeholder: '=, >, <…',
      value: ctx.value ?? '',
    });
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener('input', () => fire(input.value));
    return input;
  },
  isEmpty: (v) => !v || String(v).trim() === '',
  match(value, cell) {
    const m = String(value).trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    if (!m) return true;
    const op = m[1] || '=';
    const target = toNumber(m[2]);
    const n = toNumber(cell);
    if (target == null || n == null) return false;
    switch (op) {
      case '>': return n > target;
      case '<': return n < target;
      case '>=': return n >= target;
      case '<=': return n <= target;
      default: return n === target;
    }
  },
  toServer(field, value) {
    const m = String(value).trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    const op = (m && m[1]) || '=';
    const val = m ? m[2] : value;
    return [{ field, type: op, value: val }];
  },
});

/* ---- NUMBER-RANGE (min–max) -------------------------------------------- */

registerFilter('number-range', {
  build(column, ctx) {
    const v = ctx.value || {};
    const min = el('input.lattice-filter-input', { type: 'number', placeholder: ctx.i18n.t('filters.from'), value: v.min ?? '' });
    const max = el('input.lattice-filter-input', { type: 'number', placeholder: ctx.i18n.t('filters.to'), value: v.max ?? '' });
    const fire = debounce(() => ctx.onChange({ min: min.value || null, max: max.value || null }), ctx.debounceMs);
    min.addEventListener('input', fire);
    max.addEventListener('input', fire);
    return stackedPair(ctx, min, max); // Od/Do pod sebou
  },
  isEmpty: (v) => !v || (v.min == null && v.max == null),
  match(value, cell) {
    const n = toNumber(cell);
    if (n == null) return false;
    const lo = toNumber(value.min);
    const hi = toNumber(value.max);
    if (lo != null && n < lo) return false;
    if (hi != null && n > hi) return false;
    return true;
  },
  toServer(field, value) {
    const out = [];
    if (value.min != null && value.min !== '') out.push({ field, type: '>=', value: value.min });
    if (value.max != null && value.max !== '') out.push({ field, type: '<=', value: value.max });
    return out;
  },
});

/* ---- DATE-RANGE (Od–Do v JEDNOM poli: value "from|to", 1 server param) -- */

/** Dvě pole (Od / Do) pod sebou s popiskem — vejdou se i do úzkého sloupce. */
function stackedPair(ctx, fromInput, toInput) {
  const row = (label, input) => el('label.lattice-stacked-row', {}, [el('span.lattice-stacked-lbl', { text: label }), input]);
  return el('div.lattice-filter-stacked', {}, [row(ctx.i18n.t('filters.from'), fromInput), row(ctx.i18n.t('filters.to'), toInput)]);
}

function buildDatePair(ctx) {
  const v = ctx.value || {};
  const from = el('input.lattice-filter-input', { type: 'date', value: v.from ?? '' });
  const to = el('input.lattice-filter-input', { type: 'date', value: v.to ?? '' });
  return { from, to, wrap: stackedPair(ctx, from, to) };
}

registerFilter('date-range', {
  build(column, ctx) {
    return buildDateRangePicker(column, ctx);
  },
  isEmpty: (v) => !v || (!v.from && !v.to),
  match(value, cell) {
    const t = dayTime(cell);
    if (t == null) return false;
    // from/to mohou být relativní tokeny (dynamický preset) → rozvinout; pevná data projdou beze změny
    const lo = dayTime(resolveToken(value.from));
    const hi = dayTime(resolveToken(value.to));
    if (lo != null && t < lo) return false;
    if (hi != null && t > hi) return false;
    return true;
  },
  // JEDNO pole: rozsah pošleme jako jednu hodnotu "from|to" (tokeny rozvinuté na konkrétní datum)
  toServer: (field, value) => [{ field, type: 'dateRange', value: `${resolveToken(value.from) || ''}|${resolveToken(value.to) || ''}` }],
});

/* ---- DATE-TWO (dvě samostatná pole → 2 server params, jedno nepovinné) -- */

registerFilter('date-two', {
  build(column, ctx) {
    const { from, to, wrap } = buildDatePair(ctx);
    const fire = () => ctx.onChange({ from: from.value || null, to: to.value || null });
    from.addEventListener('change', fire);
    to.addEventListener('change', fire);
    return wrap;
  },
  isEmpty: (v) => !v || (!v.from && !v.to),
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
  toServer(field, value) {
    const out = [];
    if (value.from) out.push({ field, type: '>=', value: value.from });
    if (value.to) out.push({ field, type: '<=', value: value.to });
    return out;
  },
});

/* ---- DYNAMIC (výraz s operátory + AND/OR, relativní datumy) ------------- */
/* Např. ">today-14 AND <today+14" nebo ">=2024-01-01 OR <today-1y".
 * Operátory >, <, >=, <=, = (výchozí =); operand je absolutní datum (YYYY-MM-DD)
 * nebo relativní token (today, today±N[dwmy], now) rozvinutý přes resolveToken.
 * AND váže těsněji než OR: "a AND b OR c" = "(a AND b) OR c".
 * Tichá tolerance chyb: neplatná klauzule se zahodí; když nezbude žádná, nefiltruje se. */

const DYN_CLAUSE_RE = /^\s*(>=|<=|>|<|=)?\s*(.+)$/;

/** Rozparsuje jednu klauzuli "op operand" → { op, target } nebo null (neplatná). */
function dynClause(str) {
  const m = String(str).match(DYN_CLAUSE_RE);
  if (!m) return null;
  const target = dayTime(resolveToken(m[2].trim())); // operand: absolutní datum nebo token
  if (target == null) return null;
  return { op: m[1] || '=', target };
}

/** Rozdělí výraz na OR-skupiny AND-klauzulí; neplatné klauzule tiše zahodí. */
function dynParse(value) {
  const groups = [];
  for (const g of String(value).split(/\bOR\b|\|\|/i)) {
    const clauses = g.split(/\bAND\b|&&/i).map(dynClause).filter(Boolean);
    if (clauses.length) groups.push(clauses);
  }
  return groups; // [] = nic platného → tichá tolerance (nefiltruje)
}

function dynTest(t, c) {
  switch (c.op) {
    case '>': return t > c.target;
    case '<': return t < c.target;
    case '>=': return t >= c.target;
    case '<=': return t <= c.target;
    default: return t === c.target;
  }
}

// Našeptávač: pojmenovaná období → hotový výraz (klik ho vyplní a rovnou aplikuje).
const DYN_RECIPES = [
  ['today', '=today'],
  ['d7', '>=today-7 AND <=today'],
  ['thisWeek', '>=sow AND <=eow'],
  ['lastWeek', '>=sow-1w AND <=eow-1w'],
  ['thisMonth', '>=som AND <=eom'],
  ['lastMonth', '>=som-1m AND <=eom-1m'],
  ['thisYear', '>=soy AND <=eoy'],
];

/** Popover s rychlými obdobími a zápisem — otevře „?" u dynamického filtru. */
function openDynamicHelp(anchor, input, ctx) {
  document.querySelectorAll('.lattice-dyn-pop').forEach((p) => p.remove()); // jen jeden
  const t = (k) => ctx.i18n.t(k);
  const pop = el('div.lattice-panel.lattice-dyn-pop');
  let off = null;
  const close = () => { off?.(); pop.remove(); };
  pop.appendChild(el('div.lattice-dyn-pop-h', { text: t('filters.dynamicHelp.periods') }));
  const chips = el('div.lattice-dyn-recipes');
  for (const [key, expr] of DYN_RECIPES) {
    const b = el('button.lattice-dyn-recipe', { type: 'button', text: t('filters.dynamicHelp.r.' + key), title: expr });
    b.addEventListener('click', () => { input.value = expr; ctx.onChange(expr); close(); });
    chips.appendChild(b);
  }
  pop.appendChild(chips);
  pop.appendChild(el('div.lattice-dyn-pop-h', { text: t('filters.dynamicHelp.syntax') }));
  pop.appendChild(el('div.lattice-dyn-tokens', { text: t('filters.dynamicHelp.tokens') }));
  document.body.appendChild(pop);
  positionUnder(pop, anchor);
  off = onOutside(pop, (e) => { if (!anchor.contains(e.target)) close(); });
}

registerFilter('dynamic', {
  build(column, ctx) {
    const input = el('input.lattice-filter-input.lattice-dyn-input', {
      type: 'text',
      placeholder: ctx.i18n.t('filters.dynamicPlaceholder'),
      title: ctx.i18n.t('filters.dynamicHint'),
      value: ctx.value ?? '',
    });
    const fire = debounce((v) => ctx.onChange(v), ctx.debounceMs);
    input.addEventListener('input', () => fire(input.value));
    // Našeptávač „?" — rychlá období + zápis (uživatel nemusí syntaxi znát).
    const help = el('button.lattice-dyn-help', { type: 'button', title: ctx.i18n.t('filters.dynamicHelp.title'), text: '?' });
    help.addEventListener('click', (e) => { e.stopPropagation(); openDynamicHelp(help, input, ctx); });
    return el('div.lattice-dyn-wrap', {}, [input, help]);
  },
  isEmpty: (v) => !v || String(v).trim() === '',
  match(value, cell) {
    const t = dayTime(cell);
    if (t == null) return false;
    const groups = dynParse(value);
    if (!groups.length) return true; // žádná platná klauzule → tiše nefiltruj
    // OR mezi skupinami, AND uvnitř skupiny
    return groups.some((clauses) => clauses.every((c) => dynTest(t, c)));
  },
  toServer(field, value) {
    // Tokeny rozvineme na konkrétní datumy, ať je backend nemusí umět parsovat.
    // Kombinátor předáme přes `combinator`/`group` (u čistého AND je to jako date-two).
    const orGroups = String(value).split(/\bOR\b|\|\|/i);
    const multiOr = orGroups.length > 1;
    const out = [];
    orGroups.forEach((g, gi) => {
      for (const s of g.split(/\bAND\b|&&/i)) {
        const m = String(s).match(DYN_CLAUSE_RE);
        if (!m) continue;
        const operand = resolveToken(m[2].trim());
        if (dayTime(operand) == null) continue; // neplatné tiše přeskoč
        const param = { field, type: m[1] || '=', value: operand };
        if (multiOr) { param.combinator = 'OR'; param.group = gi; }
        out.push(param);
      }
    });
    return out;
  },
});

/* ---- SELECT (jedna hodnota) -------------------------------------------- */

registerFilter('select', {
  build(column, ctx) {
    return buildSelect(column, ctx);
  },
  isEmpty: (v) => v == null || v === '',
  match: (value, cell) => norm(cell) === norm(value),
  toServer: (field, value) => [{ field, type: '=', value }],
});

/**
 * Vlastní single-select (Select2-like, bez závislosti): kompaktní pole s vybraným
 * labelem + rozbalovací panel s hledáním. Sdílí vzhled s multiselectem
 * (třídy .lattice-ms*), ale bez chipů a zaškrtávání — výběr rovnou zavře panel.
 */
function buildSelect(column, ctx) {
  let value = ctx.value != null && ctx.value !== '' ? String(ctx.value) : null;
  let options = [];
  let panel = null;
  let closePanel = null;

  const control = el('div.lattice-ms.lattice-ms-single', { tabindex: '0' });
  const text = el('span.lattice-ms-text');
  const caret = el('span.lattice-ms-caret', { html: CARET_SVG });
  control.append(text, caret);

  const labelFor = (v) => {
    const o = options.find((o) => o.value === v);
    return o ? o.label : v;
  };

  function renderText() {
    clear(text);
    if (value == null) {
      text.appendChild(el('span.lattice-ms-placeholder', { text: ctx.i18n.t('filters.all') }));
    } else {
      text.appendChild(el('span.lattice-ms-single-label', { text: labelFor(value) }));
    }
  }

  function pick(v) {
    value = v;
    renderText();
    close();
    ctx.onChange(value != null ? value : null);
  }

  function open() {
    if (panel) return;
    panel = el('div.lattice-ms-panel');
    const search = el('input.lattice-ms-search', { type: 'text', placeholder: ctx.i18n.t('filters.search') });
    const list = el('div.lattice-ms-list');
    panel._search = search;
    panel._list = list;
    search.addEventListener('input', () => renderPanelList(list, search.value));
    panel.append(search, list);
    document.body.appendChild(panel);
    positionPanel(panel, control);
    renderPanelList(list, '');
    control.classList.add('is-open');
    closePanel = onOutside(panel, (e) => { if (!control.contains(e.target)) close(); });
    search.focus();
  }

  function close() {
    closePanel?.();
    panel?.remove();
    panel = null;
    closePanel = null;
    control.classList.remove('is-open');
  }

  function renderPanelList(list, q) {
    clear(list);
    const needle = (q || '').trim().toLowerCase();
    // „Vše" (zrušení výběru) vždy na začátku, nefiltruje se hledáním.
    const allRow = el('div.lattice-ms-option', { class: value == null ? 'is-selected' : '' }, [
      el('span.lattice-ms-check', { text: value == null ? '✓' : '' }),
      el('span.lattice-ms-muted', { text: ctx.i18n.t('filters.all') }),
    ]);
    allRow.addEventListener('mousedown', (e) => { e.preventDefault(); pick(null); });
    list.appendChild(allRow);

    const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
    for (const o of shown) {
      const on = value === o.value;
      const row = el('div.lattice-ms-option', { class: on ? 'is-selected' : '' }, [
        el('span.lattice-ms-check', { text: on ? '✓' : '' }),
        el('span', { text: o.label }),
      ]);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(o.value); });
      list.appendChild(row);
    }
  }

  control.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panel ? close() : open();
  });
  control.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel ? close() : open(); }
    if (e.key === 'Escape') close();
  });

  fetchOptions(column, ctx).then((opts) => {
    options = opts;
    renderText();
    if (panel) renderPanelList(panel._list, panel._search.value);
  });

  renderText();
  return control;
}

/* ---- MULTISELECT (více hodnot) ----------------------------------------- */

registerFilter('multiselect', {
  build(column, ctx) {
    return buildMultiselect(column, ctx);
  },
  isEmpty: (v) => !Array.isArray(v) || v.length === 0,
  match(value, cell) {
    const set = value.map(norm);
    return set.includes(norm(cell));
  },
  toServer: (field, value) => [{ field, type: 'in', value }],
});

/**
 * Vlastní multiselect (Select2-like, bez závislosti): kompaktní pole s chipy
 * vybraných hodnot + rozbalovací panel s hledáním a odškrtáváním. Žádný nativní
 * <select multiple> se 4 řádky a scrollerem.
 */
function buildMultiselect(column, ctx) {
  let selected = Array.isArray(ctx.value) ? ctx.value.map(String) : [];
  let options = [];
  let panel = null;
  let closePanel = null;

  const control = el('div.lattice-ms', { tabindex: '0' });
  const chips = el('div.lattice-ms-chips');
  const caret = el('span.lattice-ms-caret', { html: CARET_SVG });
  control.append(chips, caret);

  const labelFor = (v) => {
    const o = options.find((o) => o.value === v);
    return o ? o.label : v;
  };

  function fire() {
    ctx.onChange(selected.length ? selected.slice() : null);
  }

  function renderChips() {
    clear(chips);
    if (selected.length === 0) {
      chips.appendChild(el('span.lattice-ms-placeholder', { text: ctx.i18n.t('filters.all') }));
      return;
    }
    for (const v of selected) {
      const chip = el('span.lattice-ms-chip', {}, [
        el('span.lattice-ms-chip-label', { text: labelFor(v) }),
        el('span.lattice-ms-chip-x', {
          text: '×',
          on: { mousedown: (e) => { e.preventDefault(); e.stopPropagation(); toggle(v); } },
        }),
      ]);
      chips.appendChild(chip);
    }
    scheduleFit();
  }

  // Omezení výšky pole na max 2 řádky chipů — přebytek se skryje a nahradí „+N".
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
    const old = chips.querySelector('.lattice-ms-more');
    if (old) old.remove();
    const chipEls = [...chips.querySelectorAll('.lattice-ms-chip')];
    for (const c of chipEls) c.style.display = '';
    if (chipEls.length === 0) return;

    const rowH = chipEls[0].offsetHeight || 18;
    const twoRowsBottom = chipEls[0].offsetTop + rowH + rowH * 0.5; // spodek 2. řádku + tolerance
    const hiddenLabels = [];
    for (const c of chipEls) {
      if (c.offsetTop > twoRowsBottom) { c.style.display = 'none'; hiddenLabels.push(c.textContent.replace(/×$/, '')); }
    }
    if (hiddenLabels.length === 0) return;

    const more = el('span.lattice-ms-chip.lattice-ms-more');
    chips.appendChild(more);
    const setMore = () => { more.textContent = '+' + hiddenLabels.length; more.title = hiddenLabels.join(', '); };
    setMore();

    // Kdyby „+N" spadlo na 3. řádek, schovávej poslední viditelné chipy, dokud se nevejde.
    let guard = 0;
    while (more.offsetTop > twoRowsBottom && guard < chipEls.length) {
      const visible = chipEls.filter((c) => c.style.display !== 'none');
      if (!visible.length) break;
      const last = visible[visible.length - 1];
      last.style.display = 'none';
      hiddenLabels.push(last.textContent.replace(/×$/, ''));
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
    panel = el('div.lattice-ms-panel');
    const search = el('input.lattice-ms-search', { type: 'text', placeholder: ctx.i18n.t('filters.search') });
    const list = el('div.lattice-ms-list');
    panel._search = search;
    panel._list = list;
    search.addEventListener('input', () => renderPanelList(list, search.value));
    panel.append(search, list);
    document.body.appendChild(panel);
    positionPanel(panel, control);
    renderPanelList(list, '');
    control.classList.add('is-open');
    closePanel = onOutside(panel, (e) => { if (!control.contains(e.target)) close(); });
    search.focus();
  }

  function close() {
    closePanel?.();
    panel?.remove();
    panel = null;
    closePanel = null;
    control.classList.remove('is-open');
  }

  function renderPanelList(list, q) {
    clear(list);
    const needle = (q || '').trim().toLowerCase();
    const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
    if (shown.length === 0) {
      list.appendChild(el('div.lattice-ms-empty', { text: ctx.i18n.t('empty') }));
      return;
    }
    for (const o of shown) {
      const on = selected.includes(o.value);
      const row = el('div.lattice-ms-option', { class: on ? 'is-selected' : '' }, [
        el('span.lattice-ms-check', { text: on ? '✓' : '' }),
        el('span', { text: o.label }),
      ]);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); toggle(o.value); });
      list.appendChild(row);
    }
  }

  control.addEventListener('mousedown', (e) => {
    if (e.target.closest('.lattice-ms-chip-x')) return; // odebrání chipu neřeší toggle panelu
    e.preventDefault();
    panel ? close() : open();
  });
  control.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel ? close() : open(); }
    if (e.key === 'Escape') close();
  });

  // Načíst options (async) a dorenderovat.
  fetchOptions(column, ctx).then((opts) => {
    options = opts;
    renderChips();
    if (panel) renderPanelList(panel._list, panel._search.value);
  });

  renderChips();
  return control;
}

/** Umístí panel pod pole, zarovnaný k levému okraji, min. šířky pole. */
function positionPanel(panel, control) {
  const r = control.getBoundingClientRect();
  panel.style.position = 'absolute';
  panel.style.top = window.scrollY + r.bottom + 2 + 'px';
  panel.style.left = window.scrollX + r.left + 'px';
  panel.style.minWidth = r.width + 'px';
}

const CARET_SVG = '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path fill="currentColor" d="M0 0l5 6 5-6z"/></svg>';

/* ---- BOOLEAN (Ano/Ne přes select) -------------------------------------- */

registerFilter('boolean', {
  build(column, ctx) {
    const select = el('select.lattice-filter-input', {}, [
      el('option', { value: '', text: ctx.i18n.t('filters.all') }),
      el('option', { value: 'true', text: ctx.i18n.t('filters.yes') }),
      el('option', { value: 'false', text: ctx.i18n.t('filters.no') }),
    ]);
    if (ctx.value != null) select.value = ctx.value;
    select.addEventListener('change', () => ctx.onChange(select.value || null));
    return select;
  },
  isEmpty: (v) => v == null || v === '',
  match(value, cell) {
    const truthy = cell === true || cell === 1 || cell === '1' || cell === 'true';
    return value === 'true' ? truthy : !truthy;
  },
  toServer: (field, value) => [{ field, type: '=', value: value === 'true' }],
});
