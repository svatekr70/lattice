/**
 * Tipy pro uživatele — jednořádkové rady v info pruhu nad tabulkou („Věděl jsi, že…").
 *
 * Míří na lidi, kteří v tabulce **pracují** (ne na ty, kdo Lattice implementují): přesun
 * sloupců myší, víceúrovňové řazení, typy filtrů, seskupení, souhrny, pohledy…
 *
 * - Zapíná **aplikace** volbou `options.tips` (výchozí vypnuto), aby se pruh neobjevil
 *   tam, kde se nehodí.
 * - **Uživatel** si je vypne křížkem v pruhu (`instance.showTips`, persistuje se stejně
 *   jako ostatní nastavení) a zapne zpět v *Nastavení tabulky → Vzhled*.
 * - Texty jsou v i18n (`tips.list.<id>`), takže je aplikace může přebít vlastním slovníkem.
 *   Vlastní tipy navíc přidá `tips: { extra: ['…'] }`.
 *
 * Tip, který mluví o vypnuté funkci, by radil do zdi — proto má každý volitelné `when`,
 * které se ptá gridu, jestli tu funkci vůbec má.
 */

/** Je funkce (feature flag aplikace) zapnutá? Chybějící flag = zapnuto. */
const feat = (grid, key) => (grid.options.features || {})[key] !== false;

/**
 * Katalog tipů: `id` = klíč do i18n (`tips.list.<id>`), `when(grid)` = volitelná
 * podmínka dostupnosti. Pořadí je jen kvůli přehlednosti — vybírá se náhodně.
 */
export const TIPS = [
  /* --- sloupce: řazení, pořadí, šířka, viditelnost --- */
  { id: 'sort' },
  { id: 'sortMulti' },
  { id: 'sortDefault', when: (g) => feat(g, 'instanceSettings') },
  { id: 'moveColumn' },
  { id: 'moveColumnDialog', when: (g) => feat(g, 'gear') },
  { id: 'resize' },
  { id: 'fitWidth', when: (g) => feat(g, 'gear') },
  { id: 'freeze', when: (g) => feat(g, 'gear') },
  { id: 'hideColumn', when: (g) => feat(g, 'gear') },
  { id: 'searchColumn', when: (g) => feat(g, 'gear') },
  { id: 'renameColumn', when: (g) => feat(g, 'gear') },

  /* --- filtry v hlavičce --- */
  { id: 'filterType', when: hasFilters },
  { id: 'filterNegate', when: hasFilters },
  { id: 'filterNumber', when: hasFilters },
  { id: 'filterRange', when: hasFilters },
  { id: 'filterDateTwo', when: (g) => hasFilters(g) && hasType(g, 'date') },
  { id: 'filterDynamic', when: (g) => hasFilters(g) && hasType(g, 'date') },
  { id: 'filterDynamicHelp', when: (g) => hasFilters(g) && hasType(g, 'date') },
  { id: 'filterDynamicRange', when: (g) => hasFilters(g) && hasType(g, 'date') },
  { id: 'filterClear', when: hasFilters },
  { id: 'filterToggleColumn', when: (g) => hasFilters(g) && feat(g, 'gear') },
  { id: 'filterCount', when: hasFilters },
  { id: 'filterLayout', when: (g) => hasFilters(g) && feat(g, 'instanceSettings') },

  /* --- rozšířený filtr a ukládání filtrů --- */
  { id: 'advanced', when: (g) => feat(g, 'advancedFilter') },
  { id: 'advancedGroup', when: (g) => feat(g, 'advancedFilter') },
  { id: 'advancedRelative', when: (g) => feat(g, 'advancedFilter') && hasType(g, 'date') },
  { id: 'saveFilter', when: (g) => feat(g, 'advancedFilter') && hasFilters(g) },
  { id: 'saveFilterWhere', when: (g) => feat(g, 'advancedFilter') },
  { id: 'saveFilterGroup', when: (g) => feat(g, 'advancedFilter') },
  { id: 'saveFilterOverwrite', when: (g) => feat(g, 'advancedFilter') && hasFilters(g) },
  { id: 'quickbarMenu', when: (g) => feat(g, 'advancedFilter') || feat(g, 'gear') },
  { id: 'globalShared', when: (g) => typeof g.options.onSaveGlobalPreset === 'function' || typeof g.options.onSaveGlobalAdvancedFilter === 'function' },

  /* --- pohledy (presety) --- */
  { id: 'presets', when: (g) => feat(g, 'gear') },
  { id: 'presetParts', when: (g) => feat(g, 'gear') },
  { id: 'presetToggle', when: (g) => feat(g, 'gear') },

  /* --- seskupení, souhrny --- */
  { id: 'groupRows', when: (g) => feat(g, 'gear') },
  { id: 'groupDate', when: (g) => feat(g, 'gear') && hasType(g, 'date') },
  { id: 'groupDisplay', when: (g) => feat(g, 'instanceSettings') },
  { id: 'groupSort', when: (g) => feat(g, 'gear') },
  { id: 'summary', when: (g) => feat(g, 'gear') },
  { id: 'summaryScope', when: (g) => feat(g, 'instanceSettings') },
  { id: 'subtotals', when: (g) => feat(g, 'instanceSettings') },

  /* --- vzhled sloupců a tabulky --- */
  { id: 'columnGroup', when: (g) => feat(g, 'gear') },
  { id: 'headerColor', when: (g) => feat(g, 'gear') },
  { id: 'computed', when: (g) => feat(g, 'gear') },
  { id: 'computedHelp', when: (g) => feat(g, 'gear') },
  { id: 'rowNumbers', when: (g) => feat(g, 'instanceSettings') },
  { id: 'theme', when: (g) => feat(g, 'instanceSettings') },
  { id: 'wrap', when: (g) => feat(g, 'instanceSettings') },
  { id: 'scale', when: (g) => feat(g, 'gear') },
  { id: 'format', when: (g) => feat(g, 'instanceSettings') },
  { id: 'reset', when: (g) => feat(g, 'gear') },

  /* --- práce s daty --- */
  { id: 'persistence' },
  { id: 'pageSize', when: (g) => g.paginationEnabled && g.paginationEnabled() },
  { id: 'keyboard' },
  { id: 'quickSearch', when: (g) => !!g.options.quickSearch },
  { id: 'range', when: (g) => !!g.range },
  { id: 'rangeCopy', when: (g) => !!g.range },
  { id: 'edit', when: (g) => g.options.editable === true || g.columns.some((c) => c.editable) },
  { id: 'selection', when: (g) => !!(g.selectable && g.selectable.enabled) },
  { id: 'selectionFilter', when: (g) => !!(g.selectable && g.selectable.enabled) },
  { id: 'tree', when: (g) => !!g.tree },
  { id: 'rowMove', when: (g) => !!g.movable },
  { id: 'history', when: (g) => !!g.history },
  { id: 'detail', when: (g) => !!g.detailFn },
  { id: 'contextMenu', when: (g) => typeof g.options.rowContextMenu === 'function' || typeof g.options.onRowContext === 'function' },
  { id: 'help', when: (g) => feat(g, 'help') && g.options.helpUrl !== null },
  { id: 'about', when: (g) => feat(g, 'instanceSettings') },
  { id: 'tipsOff' },
];

/** Má tabulka vůbec filtrovací pole (sloupce s filtrem a zapnuté umístění)? */
function hasFilters(grid) {
  if (grid.instance && grid.instance.filterLayout === 'none') return false;
  return (grid.columns || []).some((c) => c.filter);
}

/** Je v tabulce sloupec daného datového typu (kvůli tipům o datumových filtrech)? */
function hasType(grid, type) {
  return (grid.columns || []).some((c) => String(c.type || '').startsWith(type));
}

/**
 * Znormalizuje `options.tips`:
 *   `true` → vestavěné tipy · `false`/nezadáno → vypnuto
 *   `{ enabled?, builtin?, extra? }` → jemné doladění (`extra` = vlastní tipy aplikace,
 *   `builtin: false` = jen vlastní).
 */
export function normalizeTips(opt) {
  if (opt === true) return { enabled: true, builtin: true, extra: [] };
  if (!opt || typeof opt !== 'object') return { enabled: false, builtin: true, extra: [] };
  const extra = (Array.isArray(opt.extra) ? opt.extra : []).map((x) => String(x || '').trim()).filter(Boolean);
  return {
    enabled: opt.enabled !== false,
    builtin: opt.builtin !== false,
    extra,
  };
}

/**
 * Texty tipů, které pro tenhle grid dávají smysl — vestavěné (podle `when` a s textem
 * ze slovníku) + vlastní z `options.tips.extra`. Chybějící překlad (t() vrátí zpět cestu
 * klíče) tip vyřadí, ať v pruhu nesvítí `tips.list.neco`.
 */
export function availableTips(grid) {
  const cfg = grid.tips || normalizeTips(grid.options.tips);
  if (!cfg.enabled) return [];
  const out = [];
  if (cfg.builtin) {
    const t = grid.i18n.t.bind(grid.i18n);
    for (const tip of TIPS) {
      if (tip.when && !tip.when(grid)) continue;
      const key = 'tips.list.' + tip.id;
      const text = t(key);
      if (!text || text === key) continue;
      out.push(text);
    }
  }
  return out.concat(cfg.extra);
}

/**
 * Náhodný tip pro zobrazení. `avoid` (právě zobrazený text) nechce vidět znovu, dokud
 * je z čeho vybírat — jinak by „Další tip" občas nic nezměnil.
 */
export function pickTip(grid, avoid) {
  const list = availableTips(grid);
  if (!list.length) return '';
  const pool = list.length > 1 && avoid ? list.filter((x) => x !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
