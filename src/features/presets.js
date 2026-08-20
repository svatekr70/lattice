/**
 * Presety — pojmenované snapshoty stavu gridu: všechno, co si uživatel naklikal
 * v nastavení sloupců (pořadí/viditelnost/šířky/ukotvení/souhrny/formáty/barvy)
 * i v nastavení tabulky (seskupení řádků, souhrnný řádek, mezisoučty skupin,
 * stránkování, vzhled) + řazení a filtry. Klikem se celý snapshot aplikuje.
 *
 * Dvě úrovně:
 *  - **lokální** (per-uživatel): uložené v témže localStorage blobu (`state.presets`).
 *    Kompletně v knihovně, žádná závislost na aplikaci.
 *  - **globální** (sdílené všem): localStorage je per-prohlížeč, takže sdílení
 *    napříč uživateli knihovna sama nezajistí — úložiště dodá APLIKACE přes
 *    adaptér `options.presets.global = { load, save, remove }`. Když adaptér
 *    není, globální presety (tlačítko Globus) se prostě neukážou.
 *
 * PresetStore drží kolekce a adaptér; zachycení/aplikaci stavu řeší Lattice
 * (captureState/applyPreset), protože sahá do vnitřků gridu.
 */

export class PresetStore {
  constructor(grid) {
    this.grid = grid;
    const o = grid.options;
    // Globální presety dodá aplikace přímo polem `globalPresets` při vytvoření
    // instance. Uložení/smazání řeší aplikace přes callbacky onSaveGlobalPreset /
    // onDeleteGlobalPreset. (Legacy: adaptér options.presets.global.)
    this.adapter = o.presets && o.presets.global ? o.presets.global : null;
    this.globals = (Array.isArray(o.globalPresets) ? o.globalPresets : []).map((p) => ({ ...p, scope: 'global' }));
    this.globalsLoaded = !this.adapter;
  }

  /** Lze uložit globální preset? (callback nebo legacy adaptér) */
  canSaveGlobal() {
    return typeof this.grid.options.onSaveGlobalPreset === 'function' || !!(this.adapter && this.adapter.save);
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
        this.globals = (Array.isArray(list) ? list : []).map((p) => ({ ...p, scope: 'global' }));
      } catch { /* ponech, co je */ }
    }
    this.globalsLoaded = true;
    return this.globals;
  }

  /** Sjednocený seznam pro UI (lokální + globální), každý se `scope`. */
  all() {
    const loc = this.local().map((p) => ({ ...p, scope: 'local' }));
    return [...loc, ...this.globals];
  }

  /**
   * Uloží aktuální stav jako lokální preset (stejný název přepíše). `parts`
   * vybírá, co preset ponese (`{columns, filters, instance}`) — nezadáno = vše.
   */
  saveLocal(name, parts) {
    const preset = { id: uid(), name: String(name).trim(), state: this.grid.captureState(parts) };
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
   * `parts` vybírá, co preset ponese (viz `saveLocal`).
   */
  saveGlobal(name, parts) {
    const preset = { id: uid(), name: String(name).trim(), state: this.grid.captureState(parts) };
    if (!preset.name) return null;
    this.globals = this.globals.filter((p) => p.name !== preset.name);
    const norm = { ...preset, scope: 'global' };
    this.globals.push(norm);
    const cb = this.grid.options.onSaveGlobalPreset;
    if (typeof cb === 'function') cb({ id: preset.id, name: preset.name, state: preset.state });
    else if (this.adapter && this.adapter.save) Promise.resolve(this.adapter.save(preset)).catch(() => {});
    return norm;
  }

  /** Smaže preset (lokální z blobu; globální z UI + callback / adaptér aplikace). */
  async remove(preset) {
    if (preset.scope === 'global') {
      this.globals = this.globals.filter((p) => p.id !== preset.id);
      const cb = this.grid.options.onDeleteGlobalPreset;
      if (typeof cb === 'function') cb({ id: preset.id, name: preset.name });
      else if (this.adapter && this.adapter.remove) await this.adapter.remove(preset.id);
    } else {
      this.grid.state.presets = this.local().filter((p) => p.id !== preset.id);
      this.grid.saveState();
    }
  }
}

function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
