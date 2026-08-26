/**
 * ColumnModel — deterministické sestavení finálního modelu sloupců.
 *
 * Vstup:  definice sloupců z configu  +  persistovaný stav (state.columns).
 * Výstup: pole „resolved" sloupců v UŽIVATELSKÉM pořadí, každý s finální
 *         viditelností / šířkou / ukotvením — sestavené PŘED renderem.
 *
 * Pravidla (viz zadání „Na co si dát pozor"):
 *  1. Persistovaný stav je zdroj pravdy pro pořadí/visible/width/frozen.
 *  2. Frozen se počítá z AKTUÁLNÍHO pořadí, ne z init pořadí (řeší se až
 *     v layoutu — ColumnModel drží frozen jen jako flag na sloupci).
 *  3. Nové sloupce přidané v kódu (nejsou v uloženém stavu) se doplní na konec.
 *  4. Sloupce zmizelé z configu (jsou v uloženém stavu, ale ne v definici)
 *     se zahodí — nemá cenu držet stav pro neexistující sloupec.
 *
 * Model je čistá funkce nad daty (žádný DOM) → snadno testovatelné.
 */

import { compileFormula } from './formula.js';

export const DEFAULT_WIDTH = 150;
export const DEFAULT_MIN_WIDTH = 40;

/**
 * Sestaví resolved sloupce.
 * @param {Array<object>} defs         Definice z configu (v pořadí definice).
 * @param {Array<object>} savedColumns state.columns (v uživatelském pořadí) nebo [].
 * @returns {Array<object>} resolved sloupce v uživatelském pořadí.
 */
export function buildColumns(defs, savedColumns = []) {
  defs = flattenGroups(defs);
  const byField = new Map();
  for (const def of defs) {
    if (!def || def.field == null) {
      throw new Error('Lattice: každý sloupec musí mít `field`.');
    }
    if (byField.has(def.field)) {
      throw new Error(`Lattice: duplicitní field "${def.field}" v definici sloupců.`);
    }
    byField.set(def.field, def);
  }

  const result = [];
  const used = new Set();

  // 1) Nejdřív sloupce v uloženém pořadí (pokud pro ně existuje definice).
  for (const saved of savedColumns) {
    if (!saved) continue;
    let def = byField.get(saved.field);
    if (!def) {
      // Počítaný sloupec vytvořený v UI nemá definici v configu — zrekonstruujeme
      // ji z persistovaného stavu (title/type/formula). Ostatní „zmizelé" sloupce
      // (v uloženém stavu, ale ne v definici) se zahodí.
      if (saved.computed && typeof saved.formula === 'string') {
        def = { field: saved.field, title: saved.title != null ? saved.title : saved.field, type: saved.type || 'text', computed: true, formula: saved.formula };
      } else continue;
    }
    if (used.has(saved.field)) continue; // ochrana proti duplicitě v uloženém stavu
    result.push(resolveColumn(def, saved));
    used.add(saved.field);
  }

  // 2) Doplnit nové/nezmíněné sloupce v pořadí definice na konec.
  for (const def of defs) {
    if (used.has(def.field)) continue;
    result.push(resolveColumn(def, null));
    used.add(def.field);
  }

  return result;
}

/**
 * Zploští vnořené definice sloupců (skupiny) na listové sloupce a každému
 * přiřadí `group` = titulek skupiny. Podporuje jednu úroveň seskupení
 * (skupiny sloupců pod společné záhlaví).
 */
export function flattenGroups(defs) {
  const out = [];
  for (const def of defs) {
    if (def && Array.isArray(def.columns) && def.field == null) {
      const groupTitle = def.title != null ? String(def.title) : '';
      for (const child of def.columns) {
        out.push({ ...child, group: groupTitle, groupDef: def });
      }
    } else {
      out.push(def);
    }
  }
  return out;
}

/**
 * Sloučí jednu definici s uloženým stavem do resolved sloupce.
 * Persistuje se jen uživatelský stav (visible/width/frozen); vše ostatní
 * (title, type, filter, formatter, …) je vždy živé z definice.
 */
export function resolveColumn(def, saved) {
  const s = saved || {};
  const availableFilters = deriveAvailableFilters(def);
  // Počítaný sloupec: hodnota z funkce def.value, nebo zkompilovaná z řetězce
  // def.formula (počítaný sloupec definovaný v UI, který se persistuje).
  const formula = typeof def.formula === 'string' ? def.formula : null;
  let value = typeof def.value === 'function' ? def.value : null;
  if (!value && formula) {
    try { value = compileFormula(formula); } catch { value = () => undefined; }
  }
  // Filtr byl v definici zadán explicitně (def.filter / def.filterTypes) → zapnutý
  // ve výchozím stavu. Odvozený z typu → dostupný, ale ve výchozím stavu vypnutý
  // (uživatel ho zapne v dialogu „Sloupce"), aby se řádek filtrů nezaplnil sám.
  const filterExplicit = !!(def.filter || Array.isArray(def.filterTypes));
  const defaultFilter = def.filter || availableFilters[0] || null;
  const defaultFilterEnabled = def.filterEnabled !== undefined ? def.filterEnabled !== false : filterExplicit;
  // Uživatelem zvolený typ filtru má přednost před defaultem z definice.
  const filter = s.filterType != null ? s.filterType : defaultFilter;
  return {
    // --- z definice (živé, nepersistuje se) ---
    field: def.field,
    // Titulek lze přejmenovat v UI → persistuje se odchylka od configu.
    defaultTitle: def.title != null ? String(def.title) : def.field,
    title: s.title !== undefined ? s.title : (def.title != null ? String(def.title) : def.field),
    type: def.type || 'text',
    defaultFilter,                       // původní/odvozený filtr (pro reset/labely)
    availableFilters,                    // mezi čím lze přepínat
    filterValues: def.filterValues || null,
    filterUrl: def.filterUrl || null,    // pro select/multiselect z API
    formatter: def.formatter || null,    // vlastní formátor buňky
    value,                               // odvozená (computed) hodnota z celého řádku (funkce nebo null)
    formula,                             // vzorec počítaného sloupce (řetězec) — jen u sloupců z UI; jinak null
    validator: def.validator != null ? def.validator : null,     // deklarativní validace editace
    cellClass: typeof def.cellClass === 'function' ? def.cellClass : null,   // podmíněné třídy buňky
    cellStyle: typeof def.cellStyle === 'function' ? def.cellStyle : null,   // podmíněný inline styl buňky
    editor: def.editor || null,
    headerSort: def.headerSort !== false, // řadit klikem na hlavičku (default true)
    wrap: def.wrap, // per-sloupcové zalamování (true/false přebije globální wrapText; undefined = dle globálu)
    minWidth: def.minWidth != null ? def.minWidth : DEFAULT_MIN_WIDTH,
    // Výchozí zarovnání dle datového typu (přepsatelné explicitním def.align):
    // čísla a datumy vpravo, boolean na střed, ostatní vlevo.
    align: def.align || defaultAlign(def.type || 'text'),
    defaultGroup: def.group || null,     // skupina z konfigurace (výchozí)
    group: s.group !== undefined ? s.group : (def.group || null), // skupina (uživatel může přepsat)
    frozenAllowed: def.frozen !== 'never', // lze ukotvit? (def.frozen: 'never' zakáže)
    editable: def.type === 'id' ? false : def.editable === true, // typ 'id' se nikdy needituje
    editorParams: def.editorParams || null,
    formatterParams: def.formatterParams || null,
    cellPopup: typeof def.cellPopup === 'function' ? def.cellPopup : null,   // popup na klik do buňky
    headerPopup: typeof def.headerPopup === 'function' ? def.headerPopup : null, // popup z ⓘ v hlavičce
    headerMenu: def.headerMenu != null ? def.headerMenu : null, // menu hlavičky (true | pole | funkce)
    // Vlastní barvy záhlaví SLOUPCE (pozadí + písmo). null = výchozí motiv.
    // Persistuje se jen odchylka od configu (uživatel je mění v UI).
    defaultHeaderBackground: def.headerBackground || null,
    headerBackground: s.headerBackground !== undefined ? s.headerBackground : (def.headerBackground || null),
    defaultHeaderColor: def.headerColor || null,
    headerColor: s.headerColor !== undefined ? s.headerColor : (def.headerColor || null),
    // Vlastní barvy záhlaví SKUPINY — z nested definice skupiny
    // (`{ title, headerBackground, columns }`) nebo per-sloupec (`groupHeaderBackground`).
    defaultGroupHeaderBackground: def.groupHeaderBackground || (def.groupDef && def.groupDef.headerBackground) || null,
    groupHeaderBackground: s.groupHeaderBackground !== undefined ? s.groupHeaderBackground : (def.groupHeaderBackground || (def.groupDef && def.groupDef.headerBackground) || null),
    defaultGroupHeaderColor: def.groupHeaderColor || (def.groupDef && def.groupDef.headerColor) || null,
    groupHeaderColor: s.groupHeaderColor !== undefined ? s.groupHeaderColor : (def.groupHeaderColor || (def.groupDef && def.groupDef.headerColor) || null),
    def, // reference na původní definici (pro rozšíření/vlastní typy)

    // --- uživatelský stav (persistuje se; priorita: saved → definice → default) ---
    visible: pick(s.visible, def.visible, true) !== false,
    width: numberOr(s.width, def.width, DEFAULT_WIDTH),
    frozen: def.frozen === 'never' ? false : normalizeFrozen(pick(s.frozen, def.frozen, false)),
    filter,                              // aktivní typ header filtru (persistuje se jako filterType)
    defaultFilterEnabled,                // výchozí stav (pro serializaci jen odchylek)
    filterEnabled: pick(s.filterEnabled, def.filterEnabled, defaultFilterEnabled) !== false, // zobrazit filtr sloupce?
    // Otočení hlavičky: null = podle nastavení tabulky | 'none' | '90' | '270'
    defaultHeaderRotate: def.headerRotate != null ? String(def.headerRotate) : null,
    headerRotate: s.headerRotate !== undefined ? s.headerRotate : (def.headerRotate != null ? String(def.headerRotate) : null),
    // Souhrnné funkce sloupce (pole; jedna či více z 'min'|'max'|'sum'|'avg'|'count').
    defaultSummary: normSummary(def.summary),
    summary: s.summary !== undefined ? normSummary(s.summary) : normSummary(def.summary),
    // Zapojení sloupce do souhrnu ŘÁDKŮ (pravý sloupec); pole funkcí jako summary.
    defaultRowSummary: normSummary(def.rowSummary),
    rowSummary: s.rowSummary !== undefined ? normSummary(s.rowSummary) : normSummary(def.rowSummary),
    // Vzorec pro souhrnný ŘÁDEK dole (vážený/poolovaný souhrn z agregací jiných
    // sloupců, viz core/formula.js). null = žádný, jinak řetězec.
    defaultSummaryFormula: def.summaryFormula || null,
    summaryFormula: s.summaryFormula !== undefined ? s.summaryFormula : (def.summaryFormula || null),
    // Volitelný název řádku souhrnného vzorce (vlevo místo generického „Vzorec").
    // Sloupce se stejným názvem sdílejí jeden řádek; různé názvy = víc řádků.
    defaultSummaryFormulaLabel: def.summaryFormulaLabel || null,
    summaryFormulaLabel: s.summaryFormulaLabel !== undefined ? s.summaryFormulaLabel : (def.summaryFormulaLabel || null),
    // Formát zobrazení (číslo/měna/datum) — výjimka sloupce vůči globálnímu formátu.
    // null = řídit se globálním nastavením tabulky.
    defaultColFormat: def.format || null,
    format: s.format !== undefined ? s.format : (def.format || null),
    // Podmíněná barevná škála (semafor) — { on, levels, reverse, thresholds }.
    defaultCondFormat: def.condFormat || null,
    condFormat: s.condFormat !== undefined ? s.condFormat : (def.condFormat || null),
    // Formát BUŇKY (vzhled těla sloupce): { align, bold, italic, underline,
    // strike, color, background }. Nastavuje se v UI; persistuje se odchylka.
    defaultCellFormat: def.cellFormat || null,
    cellFormat: s.cellFormat !== undefined ? s.cellFormat : (def.cellFormat || null),
  };
}

/** Normalizuje souhrn na pole funkcí. */
function normSummary(v) {
  if (Array.isArray(v)) return v.slice();
  return v ? [v] : [];
}

/** Filtry kompatibilní s daným datovým typem sloupce (mezi nimi se dá přepínat). */
const FILTERS_BY_TYPE = {
  number: ['number', 'number-range'],
  money: ['number', 'number-range'],
  progress: ['number', 'number-range'],
  rating: ['number', 'number-range'],
  date: ['date-range', 'date-two', 'dynamic'],
  datetime: ['date-range', 'date-two', 'dynamic'],
  boolean: ['boolean'],
  text: ['text'],
};

/**
 * Odvodí seznam přepínatelných typů filtru pro sloupec.
 *  - `def.filterTypes` (pole) má absolutní přednost (explicitní whitelist).
 *  - jinak dle datového typu; u textu přidá select/multiselect/multiselect-exclude.
 *  - vždy obsahuje aktuální `def.filter`, aby šlo přepnout zpět.
 */
export function deriveAvailableFilters(def) {
  let list;
  if (Array.isArray(def.filterTypes)) {
    list = def.filterTypes.slice();
  } else {
    // Filtry se odvodí z datového typu i BEZ explicitního `filter` — číselné,
    // datumové, boolean i textové sloupce jdou tak filtrovat rovnou (zapíná se
    // v dialogu „Sloupce"). Typy bez smysluplného filtru (image, html, icon,
    // color, link, tick, id) nemají žádný — pokud si ho def.filter nevynutí.
    const type = def.type || 'text';
    list = (FILTERS_BY_TYPE[type] || []).slice();
    // Textové sloupce vždy nabídnou Text / Výběr / Více hodnot / Vyloučit více
    // (select i multiselect si hodnoty odvodí z dat, když nejsou filterValues/filterUrl).
    if (type === 'text') list.push('select', 'multiselect', 'multiselect-exclude');
  }
  if (def.filter && !list.includes(def.filter)) list.unshift(def.filter);
  return [...new Set(list)];
}

/** Výchozí zarovnání sloupce dle datového typu. */
function defaultAlign(type) {
  if (type === 'id' || type === 'number' || type === 'money' || type === 'date' || type === 'datetime') return 'right';
  if (type === 'boolean' || type === 'tick' || type === 'icon' || type === 'color') return 'center';
  return null; // text apod. → vlevo
}

/** Ukotvení: 'right' vpravo, jakákoli jiná pravdivá hodnota vlevo (true), jinak false. */
function normalizeFrozen(v) {
  if (v === 'right') return 'right';
  return v ? true : false;
}

/**
 * Z resolved sloupců vytáhne jen to, co se persistuje (v aktuálním pořadí).
 * Tohle putuje do state.columns.
 */
export function serializeColumns(columns) {
  return columns.map((c) => ({
    field: c.field,
    // přejmenovaný titulek se ukládá jen při odchylce od configu.
    ...(c.title !== c.defaultTitle ? { title: c.title } : {}),
    // Počítaný sloupec (definovaný v UI) se persistuje celý — bez configu ho
    // po reloadu nelze zrekonstruovat, tak uložíme i jeho titulek, typ a vzorec.
    ...(c.formula != null ? { computed: true, formula: c.formula, title: c.title, type: c.type } : {}),
    visible: c.visible,
    width: c.width,
    frozen: c.frozen,
    // Zvolený typ filtru se ukládá jen když se liší od defaultu z definice
    // (jinak by ho persistovaný stav „zamrazil" a změna v kódu by se neprojevila).
    ...(c.filter !== c.defaultFilter ? { filterType: c.filter } : {}),
    // filterEnabled se ukládá jen když se liší od výchozího stavu sloupce.
    ...(c.filterEnabled !== c.defaultFilterEnabled ? { filterEnabled: c.filterEnabled } : {}),
    // skupina se ukládá jen když se liší od konfigurace (uživatel ji změnil).
    ...(c.group !== c.defaultGroup ? { group: c.group } : {}),
    // otočení hlavičky se ukládá jen když se liší od výchozího (uživatel ho změnil).
    ...(c.headerRotate !== c.defaultHeaderRotate ? { headerRotate: c.headerRotate } : {}),
    // souhrnné funkce se ukládají, jen když se liší od výchozích.
    ...(JSON.stringify(c.summary) !== JSON.stringify(c.defaultSummary) ? { summary: c.summary } : {}),
    ...(JSON.stringify(c.rowSummary) !== JSON.stringify(c.defaultRowSummary) ? { rowSummary: c.rowSummary } : {}),
    // vzorec souhrnu (+ jeho název řádku) se ukládá jen když se liší od výchozího.
    ...(c.summaryFormula !== c.defaultSummaryFormula ? { summaryFormula: c.summaryFormula } : {}),
    ...(c.summaryFormulaLabel !== c.defaultSummaryFormulaLabel ? { summaryFormulaLabel: c.summaryFormulaLabel } : {}),
    // barvy záhlaví (sloupce i skupiny) se ukládají jen při odchylce od configu.
    ...(c.headerBackground !== c.defaultHeaderBackground ? { headerBackground: c.headerBackground } : {}),
    ...(c.headerColor !== c.defaultHeaderColor ? { headerColor: c.headerColor } : {}),
    ...(c.groupHeaderBackground !== c.defaultGroupHeaderBackground ? { groupHeaderBackground: c.groupHeaderBackground } : {}),
    ...(c.groupHeaderColor !== c.defaultGroupHeaderColor ? { groupHeaderColor: c.groupHeaderColor } : {}),
    // formát buňky (vzhled těla) — jen při odchylce od configu.
    ...(JSON.stringify(c.cellFormat) !== JSON.stringify(c.defaultCellFormat) ? { cellFormat: c.cellFormat } : {}),
    // formát se ukládá jen když se liší od výchozího (uživatel udělal výjimku).
    ...(JSON.stringify(c.format) !== JSON.stringify(c.defaultColFormat) ? { format: c.format } : {}),
    ...(JSON.stringify(c.condFormat) !== JSON.stringify(c.defaultCondFormat) ? { condFormat: c.condFormat } : {}),
  }));
}

/* ------------------------------------------------------------------ */

function pick(...vals) {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}

function numberOr(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (v !== undefined && v !== null && Number.isFinite(n)) return n;
  }
  return DEFAULT_WIDTH;
}
