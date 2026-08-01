/**
 * Store — JEDEN zdroj pravdy pro per-grid uživatelský stav.
 *
 * Veškerý persistovaný stav gridu (pořadí/viditelnost/šířky/ukotvení sloupců,
 * řazení, filtry, nastavení instance) žije v JEDNOM localStorage klíči
 * `lattice:<id>` jako jeden JSON blob. Žádná paralelní „nativní" persistence,
 * žádné oddělené klíče — přesně to v minulosti způsobovalo přepisování stavu.
 *
 * Store se stará jen o čtení/zápis blobu. Interpretaci (merge s configem,
 * sestavení sloupců) řeší ColumnModel — Store nezná význam dat.
 */

const PREFIX = 'lattice:';

/** Prázdný, ale kompletní tvar stavu — ať se nikde nemusí řešit undefined. */
export function emptyState() {
  return {
    columns: [],   // [{ field, visible, width, frozen }] v uživatelském pořadí
    sort: [],      // [{ field, dir }]
    filters: {},   // { field: value }  (tvar value závisí na typu filtru)
    universal: null, // univerzální filtr { field, op, value }
    instance: {},  // { pagination, layout, density, fontSize }
    presets: [],   // [{ id, name, state:{columns,sort,filters} }] lokální presety (per-uživatel)
    advanced: null, // aktivní rozšířený filtr (strom pravidel) nebo null
    advancedFilters: [], // [{ id, name, tree }] uložené rozšířené filtry
    groups: [],    // hodnoty sbalených skupin řádků (row grouping)
    colGroups: [], // názvy sbalených skupin sloupců (column grouping)
    tree: [],      // klíče rozbalených uzlů (tree data)
    _gdVersion: null, // naposledy aplikovaná verze globálních výchozích nastavení
  };
}

export class Store {
  /**
   * @param {string} id  Identifikátor gridu (klíč do localStorage).
   * @param {object} [opts]
   * @param {Storage} [opts.storage]  Vlastní storage (default window.localStorage).
   *        Když storage není dostupná (SSR, privátní režim), Store degraduje
   *        na in-memory objekt — grid funguje, jen se stav nepřežije reload.
   */
  constructor(id, opts = {}) {
    if (!id) throw new Error('Lattice Store: chybí `id` (klíč pro persistenci).');
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
        _gdVersion: parsed._gdVersion != null ? parsed._gdVersion : base._gdVersion,
      };
    } catch {
      // Poškozený JSON — raději začít načisto než spadnout.
      return base;
    }
  }

  /** Existuje uložený stav (rozlišení „úplně nový uživatel" vs. „má nastaveno")? */
  has() {
    try { return this.storage.getItem(this.key) != null; } catch { return false; }
  }

  /** Uloží celý blob. Tichý no-op při chybě (např. plná/nedostupná storage). */
  save(state) {
    try {
      this.storage.setItem(this.key, JSON.stringify(state));
    } catch {
      /* storage nedostupná / quota — grid běží dál, jen bez persistence */
    }
  }

  /** Smaže persistovaný stav tohoto gridu. */
  clear() {
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* no-op */
    }
  }
}

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** localStorage když jde, jinak in-memory náhrada se stejným rozhraním. */
function resolveStorage() {
  try {
    const s = globalThis.localStorage;
    // Ověřit, že opravdu funguje (Safari privátní režim umí házet při setItem).
    const probe = PREFIX + '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}
