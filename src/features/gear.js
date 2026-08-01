/**
 * Gear dialog — správa sloupců + presety (dropdown z ikony v toolbaru).
 *
 * Obsah panelu:
 *   - hlavička: název + reset sloupců (červená) + uložit globálně (globus, jen
 *     když aplikace dodá adaptér globálních presetů),
 *   - presety: seznam uložených (klik = aplikovat, × = smazat) + pole na název
 *     a uložení lokálního presetu (záložka),
 *   - vyhledávání sloupce,
 *   - seznam sloupců: viditelnost (checkbox), pořadí (drag & drop), ukotvení (pin).
 *
 * Každá změna rovnou aktualizuje model a persistuje (grid.saveState).
 */
import { el, clear, onOutside } from '../util/dom.js';
import { openMenu } from './menu.js';
import { availableSummaries, SUMMARY_ORDER, SUMMARY_SYMBOL } from './summary.js';
import { formatKind } from '../core/format.js';
import { formatFields } from './instanceSettings.js';
import { levelColor, DEFAULT_SCALE_COLORS } from '../core/colorScale.js';
import { DATE_PARTS } from '../core/dateParts.js';
import { validateFormula, compileFormula, FORMULA_CATALOG, validateAggregate, compileAggregate, AGGREGATE_CATALOG } from '../core/formula.js';

export class Gear {
  constructor(grid) {
    this.grid = grid;
    this.panel = null;
    this.off = null;
    this._search = '';
  }

  toggle(anchor) {
    if (this.panel) return this.close();
    this.open(anchor);
  }

  open(anchor) {
    const panel = el('div.lattice-panel.lattice-gear-panel');
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
      // po překreslení udržet pozici (obsah mohl změnit výšku)
      if (this.anchor) positionUnder(this.panel, this.anchor);
    }
  }

  renderList(panel) {
    clear(panel);
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);

    /* --- hlavička s nástroji: fit šířky → zrušit filtry → reset → globus --- */
    const tools = el('div.lattice-panel-tools');

    const fitBtn = el('button.lattice-icon-btn', { type: 'button', title: t('columns.fitWidth'), html: FIT_SVG });
    fitBtn.addEventListener('click', () => grid.autoFitColumns());
    tools.appendChild(fitBtn);

    const clearBtn = el('button.lattice-icon-btn', { type: 'button', title: t('columns.clearFilters'), html: CLEAR_FILTER_SVG });
    clearBtn.addEventListener('click', () => grid.clearAllFilters());
    tools.appendChild(clearBtn);

    const resetBtn = el('button.lattice-icon-btn.is-danger', { type: 'button', title: t('columns.reset'), html: RESET_SVG });
    resetBtn.addEventListener('click', () => { grid.resetColumns(); });
    tools.appendChild(resetBtn);

    panel.appendChild(el('div.lattice-panel-head', {}, [
      el('span.lattice-panel-title', { text: t('columns.manage') }),
      tools,
    ]));

    /* --- presety --- */
    panel.appendChild(this.buildPresets());

    /* --- vyhledávání sloupce --- */
    const search = el('input.lattice-col-search', { type: 'text', placeholder: t('presets.searchColumn'), value: this._search });
    search.addEventListener('input', () => { this._search = search.value; this.filterColumnRows(); });
    panel.appendChild(search);

    /* --- seznam sloupců --- */
    const list = el('div.lattice-gear-list');
    grid.columns.forEach((col) => list.appendChild(this.buildRow(col)));
    panel.appendChild(list);
    this._listEl = list;
    this.filterColumnRows();

    /* --- přidat počítaný sloupec (vzorec) --- */
    const addBtn = el('button.lattice-addcalc-btn', {
      type: 'button',
      html: FX_SVG + '<span>' + t('calc.add') + '</span>',
    });
    addBtn.addEventListener('click', () => openFormulaEditor(addBtn, grid, null, this));
    panel.appendChild(el('div.lattice-gear-addcalc', {}, [addBtn]));
  }

  /* ---------------- presety ---------------- */

  buildPresets() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const wrap = el('div.lattice-preset-box');

    const presets = grid.presets.all();
    if (presets.length === 0) {
      wrap.appendChild(el('div.lattice-preset-empty', { text: t('presets.none') }));
    } else {
      const list = el('div.lattice-preset-list');
      for (const p of presets) list.appendChild(this.buildPresetRow(p));
      wrap.appendChild(list);
    }

    // Řádek pro uložení presetu: název → záložka (lokální) → globus (globální).
    const input = el('input.lattice-preset-input', { type: 'text', placeholder: t('presets.namePlaceholder') });
    this._nameInput = input;
    const saveBtn = el('button.lattice-icon-btn', { type: 'button', title: t('presets.saveLocal'), html: BOOKMARK_SVG });
    const doSaveLocal = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      grid.presets.saveLocal(name);
      input.value = '';
      this.refresh();
    };
    saveBtn.addEventListener('click', doSaveLocal);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSaveLocal(); });

    const rowEls = [input, saveBtn];
    // Globus (globální preset) — hned za záložkou; klik pošle callback aplikaci.
    if (grid.presets.canSaveGlobal()) {
      const globeBtn = el('button.lattice-icon-btn.is-success', { type: 'button', title: t('presets.saveGlobal'), html: GLOBE_SVG });
      globeBtn.addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        grid.presets.saveGlobal(name);
        input.value = '';
        this.refresh();
      });
      rowEls.push(globeBtn);
    }
    wrap.appendChild(el('div.lattice-preset-save', {}, rowEls));
    return wrap;
  }

  buildPresetRow(preset) {
    const grid = this.grid;
    const active = grid._activePresetId === preset.id;
    const row = el('div.lattice-preset-row', { class: active ? 'is-active' : '', title: preset.name });

    const name = el('span.lattice-preset-name', { text: preset.name });
    name.addEventListener('click', () => grid.applyPreset(preset));
    row.appendChild(name);

    if (preset.scope === 'global') {
      row.appendChild(el('span.lattice-preset-badge', { title: grid.i18n.t('presets.global'), html: GLOBE_SVG }));
    }

    const del = el('button.lattice-preset-del', { type: 'button', title: '×', text: '×' });
    del.addEventListener('click', async (e) => {
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
      const title = row.dataset.title || '';
      row.style.display = !q || title.includes(q) ? '' : 'none';
    }
  }

  buildRow(col) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const row = el('div.lattice-gear-row', { draggable: true, dataset: { field: col.field, title: String(col.title).toLowerCase() } });

    const grip = el('span.lattice-grip', { text: '⋮⋮', title: 'Přetáhnout' });

    const cb = el('input', { type: 'checkbox', checked: col.visible });
    cb.addEventListener('change', () => grid.setColumnVisible(col.field, cb.checked));

    const label = el('label.lattice-gear-label', {}, [cb, el('span', { text: col.title })]);
    // Počítaný sloupec (vzorec z UI): odznak „ƒ" = klik otevře editor vzorce.
    if (col.formula != null) {
      const fx = el('button.lattice-calc-badge', { type: 'button', title: t('calc.edit'), html: FX_SVG });
      fx.addEventListener('click', (e) => { e.preventDefault(); openFormulaEditor(fx, grid, col, this); });
      label.appendChild(fx);
    }

    const tools = el('div.lattice-gear-tools');

    // Pořadí ikon: 1) ukotvení (pin), 2) filtr, 3) skupina.

    // 1) Ukotvení sloupce (vlevo/vpravo/žádné).
    // Bez šipky — stranu ukotvení naznačíme zrcadlením pinu (vpravo = zrcadlově).
    const pin = el('button.lattice-pin', {
      type: 'button',
      title: 'Ukotvit (vlevo/vpravo)',
      class: [col.frozen ? 'is-active' : '', col.frozen === 'right' ? 'is-right' : ''].filter(Boolean).join(' '),
      text: '📌',
    });
    if (col.frozenAllowed === false) pin.disabled = true;
    pin.addEventListener('click', () => {
      const next = col.frozen === true || col.frozen === 'left' ? 'right' : col.frozen === 'right' ? false : true;
      grid.setColumnFrozen(col.field, next);
    });
    tools.appendChild(pin);

    // 2) Filtr sloupce zobrazit/skrýt (jen když sloupec nějaký filtr má).
    // Když filtr nelze (obrázky, ikony…), ponecháme prázdný slot → ikony zůstanou zarovnané.
    if (col.filter) {
      const ftog = el('button.lattice-fbtn', {
        type: 'button',
        title: grid.i18n.t('columns.filterToggle'),
        class: col.filterEnabled ? 'is-active' : '',
        html: FUNNEL_SVG,
      });
      ftog.addEventListener('click', () => grid.setColumnFilterEnabled(col.field, !col.filterEnabled));
      tools.appendChild(ftog);
    } else {
      tools.appendChild(el('span.lattice-gslot-empty'));
    }

    // 3) Skupina sloupce (vytvořit/přiřadit/zrušit).
    const grpBtn = el('button.lattice-gbtn', {
      type: 'button',
      title: col.group ? grid.i18n.t('columns.groupSet') + ': ' + col.group : grid.i18n.t('columns.groupSet'),
      class: col.group ? 'is-active' : '',
      html: GROUP_SVG,
    });
    grpBtn.addEventListener('click', () => openGroupPicker(grpBtn, grid, col, () => this.refresh()));
    tools.appendChild(grpBtn);

    // 4) Otočení hlavičky sloupce (podle tabulky / vodorovně / 90° / 270°).
    const rotBtn = el('button.lattice-gbtn', {
      type: 'button',
      title: t('columns.headerRotate'),
      class: col.headerRotate != null ? 'is-active' : '',
      html: ROTATE_SVG,
    });
    rotBtn.addEventListener('click', () => {
      const cur = col.headerRotate == null ? 'inherit' : col.headerRotate;
      openMenu(rotBtn, [
        { value: 'inherit', label: t('columns.rotateInherit'), active: cur === 'inherit' },
        { value: 'none', label: t('columns.rotateNone'), active: cur === 'none' },
        { value: '90', label: t('columns.rotate90'), active: cur === '90' },
        { value: '270', label: t('columns.rotate270'), active: cur === '270' },
      ], (v) => grid.setColumnHeaderRotate(col.field, v === 'inherit' ? null : v));
    });
    tools.appendChild(rotBtn);

    // 5) Souhrn sloupce (jedna či více funkcí; Počet pro vše, ostatní jen čísla).
    const sumBtn = el('button.lattice-gbtn', {
      type: 'button',
      title: t('columns.summary'),
      class: ((col.summary && col.summary.length) || (col.rowSummary && col.rowSummary.length)) ? 'is-active' : '',
      text: 'Σ',
    });
    sumBtn.addEventListener('click', () => openSummaryPicker(sumBtn, grid, col));
    tools.appendChild(sumBtn);

    // 5b) Formát zobrazení — jen typy, které se formátují (číslo/měna/datum/čas).
    // U ostatních prázdný slot (zarovnání ikon).
    if (formatKind(col.type)) {
      const fmtBtn = el('button.lattice-gbtn.lattice-fmtbtn', {
        type: 'button', title: t('instance.colFormatTitle'),
        class: col.format ? 'is-active' : '', text: '0.0',
      });
      fmtBtn.addEventListener('click', () => openFormatPicker(fmtBtn, grid, col));
      tools.appendChild(fmtBtn);
    } else {
      tools.appendChild(el('span.lattice-gslot-empty'));
    }

    // 6) Seskupovat řádky podle tohoto sloupce (víceúrovňové; badge = pořadí úrovně).
    // U typů, kde seskupení nedává smysl, ponecháme prázdný slot (zarovnání ikon).
    if (!ROWGROUP_EXCLUDE.has(col.type)) {
      const isDate = DATE_TYPES.has(col.type);
      // U datumových sloupců počítáme kolik úrovní (částí) je aktivních; jinak 1/0.
      const activeParts = isDate ? DATE_PARTS.filter((p) => grid.isRowGrouped(col.field, p)) : [];
      const level = isDate ? activeParts.length : grid.rowGroupLevel(col.field);
      const rgBtn = el('button.lattice-gbtn.lattice-rgbtn', {
        type: 'button',
        title: isDate ? t('group.by') : t('columns.rowGroupToggle'),
        class: level ? 'is-active' : '',
        html: ROWGROUP_SVG + (level ? '<span class="lattice-rg-badge">' + level + '</span>' : ''),
      });
      if (isDate) {
        // Datum → menu s úrovněmi (rok, kvartál, …); víc lze zapnout najednou.
        rgBtn.addEventListener('click', () => {
          const items = DATE_PARTS.map((p) => ({
            value: p, label: t('group.parts.' + p), active: grid.isRowGrouped(col.field, p),
          }));
          // Checkboxy — lze zapnout víc úrovní najednou (Rok i Měsíc), menu zůstane otevřené.
          openMenu(rgBtn, items, (part) => grid.toggleRowGroup(col.field, part), {
            multi: true,
            isActive: (part) => grid.isRowGrouped(col.field, part),
          });
        });
      } else {
        rgBtn.addEventListener('click', () => grid.toggleRowGroup(col.field));
      }
      tools.appendChild(rgBtn);
    } else {
      tools.appendChild(el('span.lattice-gslot-empty'));
    }

    row.append(grip, label, tools);
    this.wireRowDrag(row, col);
    return row;
  }

  wireRowDrag(row, col) {
    const grid = this.grid;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      grid._gearDrag = col.field;
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      grid._gearDrag = null;
    });
    row.addEventListener('dragover', (e) => {
      if (!grid._gearDrag || grid._gearDrag === col.field) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      row.classList.toggle('drop-before', before);
      row.classList.toggle('drop-after', !before);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = grid._gearDrag;
      row.classList.remove('drop-before', 'drop-after');
      if (!from || from === col.field) return;
      const r = row.getBoundingClientRect();
      grid.moveColumn(from, col.field, e.clientY < r.top + r.height / 2 ? 'before' : 'after');
    });
  }
}

/** Umístí panel pod kotvící tlačítko (zarovnáno k pravému okraji). */
export function positionUnder(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  panel.style.position = 'absolute';
  panel.style.top = window.scrollY + r.bottom + 4 + 'px';
  const left = window.scrollX + r.right - panel.offsetWidth;
  panel.style.left = Math.max(8, left) + 'px';
}

/**
 * Popover pro nastavení skupiny sloupce: bez skupiny / existující skupiny /
 * vytvoření nové. Po volbě se sloupec přiřadí (a srovná do souvislé skupiny).
 */
function openGroupPicker(anchor, grid, col, onDone) {
  // Nikdy nestohovat víc pickerů (kdyby zůstal otevřený jiný).
  document.querySelectorAll('.lattice-group-menu').forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const cur = col.group || null;
  const menu = el('div.lattice-menu.lattice-group-menu');

  const pick = (g) => { close(); grid.setColumnGroup(col.field, g); onDone && onDone(); };

  const none = el('div.lattice-menu-item', { class: cur === null ? 'is-active' : '', text: t('columns.noGroup') });
  none.addEventListener('click', () => pick(null));
  menu.appendChild(none);

  for (const g of grid.groupNames()) {
    const item = el('div.lattice-menu-item', { class: g === cur ? 'is-active' : '', text: g });
    item.addEventListener('click', () => pick(g));
    menu.appendChild(item);
  }

  const input = el('input.lattice-group-new', { type: 'text', placeholder: t('columns.newGroup') });
  const add = () => { const v = input.value.trim(); if (v) pick(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const addBtn = el('button.lattice-icon-btn', { type: 'button', text: '+' });
  addBtn.addEventListener('click', add);
  menu.appendChild(el('div.lattice-group-newrow', {}, [input, addBtn]));

  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  setTimeout(() => input.focus(), 0);
  return close;
}

/**
 * Popover souhrnných funkcí sloupce se dvěma sadami:
 *  - „Pro sloupce" → souhrnný ŘÁDEK dole (col.summary),
 *  - „Pro řádky"   → souhrnný SLOUPEC vpravo (col.rowSummary).
 * Počet je vždy; min/max/součet/průměr jen u číselných sloupců.
 */
function openSummaryPicker(anchor, grid, col) {
  document.querySelectorAll('.lattice-summary-menu').forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const labelKey = { min: 'columns.summaryMin', max: 'columns.summaryMax', sum: 'columns.summarySum', avg: 'columns.summaryAvg', count: 'columns.summaryCount' };
  const menu = el('div.lattice-menu.lattice-summary-menu');

  // Jedna sada = nadpis + zaškrtávací položky navázané na getter/setter pole funkcí.
  const section = (titleKey, getArr, setArr) => {
    const current = new Set(getArr() || []);
    menu.appendChild(el('div.lattice-summary-menu-head', { text: t(titleKey) }));
    for (const fn of availableSummaries(col)) {
      const item = el('div.lattice-menu-item', { class: current.has(fn) ? 'is-selected' : '' }, [
        el('span.lattice-ms-check', { text: current.has(fn) ? '✓' : '' }),
        el('span.lattice-summary-menu-sym', { text: SUMMARY_SYMBOL[fn] }),
        el('span', { text: t(labelKey[fn]) }),
      ]);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (current.has(fn)) current.delete(fn); else current.add(fn);
        item.classList.toggle('is-selected', current.has(fn));
        item.querySelector('.lattice-ms-check').textContent = current.has(fn) ? '✓' : '';
        setArr(SUMMARY_ORDER.filter((f) => current.has(f)));
      });
      menu.appendChild(item);
    }
  };

  section('columns.summaryForColumns', () => col.summary, (v) => grid.setColumnSummary(col.field, v));
  // Vážený / vlastní souhrn vzorcem (poolované poměry) — otevře editor.
  const fx = el('div.lattice-menu-item.lattice-summary-fxitem', { class: col.summaryFormula ? 'is-selected' : '' }, [
    el('span.lattice-ms-check', { text: col.summaryFormula ? '✓' : '' }),
    el('span.lattice-summary-menu-sym', { text: 'ƒ' }),
    el('span', { text: t('calc.sumFormulaOption') }),
  ]);
  fx.addEventListener('mousedown', (e) => { e.preventDefault(); close(); openSummaryFormulaEditor(anchor, grid, col); });
  menu.appendChild(fx);

  menu.appendChild(el('div.lattice-summary-menu-sep'));
  section('columns.summaryForRows', () => col.rowSummary, (v) => grid.setColumnRowSummary(col.field, v));

  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

/**
 * Editor VÁŽENÉHO / VLASTNÍHO souhrnu sloupce (vzorec z agregací jiných sloupců).
 * Umožní poolované poměry (Σa/Σb) i vážené průměry (Σ(a×b)/Σb) — matematicky
 * korektní souhrn místo prostého průměru poměrů. Ukládá do col.summaryFormula.
 */
function openSummaryFormulaEditor(anchor, grid, col) {
  document.querySelectorAll('.lattice-formula-menu').forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const menu = el('div.lattice-menu.lattice-formula-menu');

  menu.appendChild(el('div.lattice-summary-menu-head', { text: t('calc.sumFormulaTitle') + ' — ' + col.title }));
  menu.appendChild(el('div.lattice-formula-hint', { text: t('calc.sumFormulaHint') }));

  // Volitelný název řádku (vlevo místo „Vzorec"); sloupce se stejným názvem sdílejí řádek.
  const nameInp = el('input.lattice-set-input', { type: 'text', value: col.summaryFormulaLabel || '', placeholder: t('calc.sumFormulaLabelPlaceholder') });
  menu.appendChild(csField(t('calc.sumFormulaLabel'), nameInp));

  const ta = el('textarea.lattice-formula-input', { rows: 2, spellcheck: 'false', placeholder: t('calc.sumFormulaPlaceholder') });
  ta.value = col.summaryFormula || '';
  menu.appendChild(el('div.lattice-formula-row', {}, [el('span.lattice-set-label', { text: t('calc.formula') }), ta]));

  // Pole se vkládají dovnitř agregace (klik na „sum" → sum(), pak klik na pole).
  const chips = el('div.lattice-formula-fields');
  for (const c of grid.columns) {
    if (c._rownum) continue;
    const token = /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.field) ? c.field : '[' + c.field + ']';
    const chip = el('button.lattice-formula-chip', { type: 'button', text: c.title, title: c.field });
    chip.addEventListener('mousedown', (e) => { e.preventDefault(); insertAtCursor(ta, token); updatePreview(); });
    chips.appendChild(chip);
  }
  menu.appendChild(el('div.lattice-formula-fieldswrap', {}, [
    el('div.lattice-formula-hint', { text: t('calc.insertField') }),
    chips,
  ]));

  menu.appendChild(buildFnReference(t, AGGREGATE_CATALOG, ta, () => updatePreview(), () => fit()));

  const preview = el('div.lattice-formula-preview');
  menu.appendChild(preview);

  function scopeRows() {
    return grid.summarySource(grid.instance.summaryRow === 'page' ? 'page' : 'all');
  }
  function updatePreview() {
    const src = ta.value.trim();
    if (!src) { preview.className = 'lattice-formula-preview'; preview.textContent = ''; return; }
    const chk = validateAggregate(src);
    if (!chk.ok) { preview.className = 'lattice-formula-preview is-error'; preview.textContent = '⚠ ' + chk.error; return; }
    try {
      const val = compileAggregate(src)(scopeRows());
      preview.className = 'lattice-formula-preview is-ok';
      preview.textContent = t('calc.previewLabel') + ' ' + formatPreview(val);
    } catch (e) {
      preview.className = 'lattice-formula-preview is-error';
      preview.textContent = '⚠ ' + (e && e.message ? e.message : String(e));
    }
  }
  ta.addEventListener('input', updatePreview);

  const save = () => {
    const src = ta.value.trim();
    const chk = src ? validateAggregate(src) : { ok: true };
    if (!chk.ok) { updatePreview(); return; }
    try { grid.setColumnSummaryFormula(col.field, src, nameInp.value); }
    catch (e) { preview.className = 'lattice-formula-preview is-error'; preview.textContent = '⚠ ' + (e && e.message ? e.message : String(e)); return; }
    close();
  };
  const saveBtn = el('button.lattice-formula-btn.is-primary', { type: 'button', text: t('calc.save') });
  saveBtn.addEventListener('click', save);
  const actions = [saveBtn];
  if (col.summaryFormula) {
    const clr = el('button.lattice-formula-btn.is-danger', { type: 'button', text: t('calc.sumFormulaClear') });
    clr.addEventListener('click', () => { grid.setColumnSummaryFormula(col.field, null); close(); });
    actions.push(clr);
  }
  const cancelBtn = el('button.lattice-formula-btn', { type: 'button', text: t('calc.cancel') });
  cancelBtn.addEventListener('click', () => close());
  actions.push(cancelBtn);
  menu.appendChild(el('div.lattice-formula-actions', {}, actions));

  function fit() {
    positionUnder(menu, anchor);
    const vh = window.innerHeight;
    if (menu.getBoundingClientRect().bottom > vh - 8) {
      menu.style.top = Math.max(window.scrollY + 8, window.scrollY + vh - menu.offsetHeight - 8) + 'px';
    }
  }

  updatePreview();
  document.body.appendChild(menu);
  fit();
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  setTimeout(() => ta.focus(), 0);
  return close;
}

/**
 * Per-column formát zobrazení: přepínač „podle tabulky (globální)" ↔ „vlastní",
 * a při vlastním sada polí (des. místa, tisíce, měna, záporná / vzor datumu).
 */
function openFormatPicker(anchor, grid, col) {
  document.querySelectorAll('.lattice-format-menu').forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const kind = formatKind(col.type);
  const menu = el('div.lattice-menu.lattice-format-menu');

  function render() {
    clear(menu);
    const isCustom = !!col.format;
    menu.appendChild(el('div.lattice-summary-menu-head', { text: t('instance.colFormatTitle') }));
    menu.appendChild(radioRow(t('instance.colFormatGlobal'), !isCustom, () => {
      grid.setColumnFormat(col.field, null); render();
    }));
    menu.appendChild(radioRow(t('instance.colFormatCustom'), isCustom, () => {
      grid.setColumnFormat(col.field, Object.assign({}, grid.effectiveFormat(col))); render();
    }));
    if (isCustom) {
      const fields = el('div.lattice-fmt-fields');
      for (const f of formatFields(kind, grid.effectiveFormat(col), grid, (patch) => grid.setColumnFormat(col.field, patch))) fields.appendChild(f);
      menu.appendChild(fields);
    }
    // Barevná škála (semafor) — jen číselné sloupce.
    if (kind === 'number' || kind === 'money') menu.appendChild(buildCondScale(grid, col, render));
  }
  render();

  document.body.appendChild(menu);
  positionUnder(menu, anchor);
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  return close;
}

function radioRow(label, checked, onPick) {
  const row = el('label.lattice-menu-item.lattice-fmt-radio', {}, [
    el('input', { type: 'radio', checked: !!checked }),
    el('span', { text: label }),
  ]);
  row.querySelector('input').addEventListener('change', () => onPick());
  return row;
}

/** Editor podmíněné barevné škály (semafor): on/off, počet hladin, obráceně, prahy. */
function buildCondScale(grid, col, rerender) {
  const t = grid.i18n.t.bind(grid.i18n);
  const cf = col.condFormat || {};
  const frag = document.createDocumentFragment();
  frag.appendChild(el('div.lattice-summary-menu-sep'));
  frag.appendChild(el('div.lattice-summary-menu-head', { text: t('instance.condScale') }));
  frag.appendChild(csToggle(t('instance.condScaleOn'), !!cf.on, (v) => { grid.setColumnCondFormat(col.field, { on: v }); rerender(); }));
  if (!cf.on) return frag;

  const levels = cf.levels || 3;
  frag.appendChild(csField(t('instance.condLevels'), csSelect(String(levels), [['3', '3'], ['5', '5'], ['7', '7']], (v) => {
    grid.setColumnCondFormat(col.field, { levels: Number(v), thresholds: null }); rerender();
  })));
  frag.appendChild(csField(t('instance.condApply'), csSelect(cf.mode || 'bg', [['bg', t('instance.condApplyBg')], ['text', t('instance.condApplyText')]], (v) => {
    grid.setColumnCondFormat(col.field, { mode: v }); rerender();
  })));
  frag.appendChild(csToggle(t('instance.condReverse'), !!cf.reverse, (v) => { grid.setColumnCondFormat(col.field, { reverse: v }); rerender(); }));

  // Prahy (levels-1 hodnot). Předvyplněné automatikou; uživatel je může přepsat.
  const th = (Array.isArray(cf.thresholds) && cf.thresholds.length === levels - 1) ? cf.thresholds.slice() : grid.autoThresholds(col.field, levels);
  const row = el('div.lattice-cond-thresholds');
  const inputs = [];
  for (let i = 0; i < levels - 1; i++) {
    const inp = el('input.lattice-set-input.lattice-cond-th', { type: 'number', value: th[i] != null ? th[i] : '' });
    inp.addEventListener('change', () => {
      const vals = inputs.map((x) => Number(x.value)).filter((n) => Number.isFinite(n));
      if (vals.length === levels - 1) { grid.setColumnCondFormat(col.field, { thresholds: vals.sort((a, b) => a - b) }); rerender(); }
    });
    inputs.push(inp); row.appendChild(inp);
  }
  frag.appendChild(csField(t('instance.condThresholds'), row));

  // Náhled hladin (sdílené barvy z nastavení tabulky; dle režimu výplň vs. číslo).
  const prev = el('div.lattice-cond-preview');
  const colors = grid.instance.scaleColors || DEFAULT_SCALE_COLORS;
  for (let i = 0; i < levels; i++) {
    const c = levelColor(colors, i, levels, cf.reverse, cf.mode);
    if (c.text) prev.appendChild(el('span.lattice-cond-swatch.is-text', { style: { color: c.text }, text: String(i + 1) }));
    else prev.appendChild(el('span.lattice-cond-swatch', { style: { background: c.bg, color: c.fg } }));
  }
  frag.appendChild(prev);
  return frag;
}

function csField(label, control) {
  return el('label.lattice-set-row', {}, [el('span.lattice-set-label', { text: label }), control]);
}
function csToggle(label, value, onChange) {
  const cb = el('input', { type: 'checkbox', checked: !!value });
  cb.addEventListener('change', () => onChange(cb.checked));
  return csField(label, cb);
}
function csSelect(value, options, onChange) {
  const sel = el('select.lattice-set-input');
  for (const [v, lab] of options) sel.appendChild(el('option', { value: v, text: lab }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/* ------------------------- editor počítaného sloupce ------------------------- */

/**
 * Popover pro vytvoření/úpravu počítaného sloupce: název, typ (číslo/text/datum),
 * pole vzorce, klikací seznam sloupců (vkládá odkaz na pole) a živý náhled
 * (vyhodnotí vzorec na 1. řádku dat → výsledek nebo chyba). Uloží přes
 * grid.addComputedColumn / grid.updateComputedColumn; smazání přes removeComputedColumn.
 * @param {Element} anchor  kotva pro umístění
 * @param {object}  grid
 * @param {?object} col     upravovaný sloupec, nebo null pro nový
 * @param {Gear}    gear    reference na dialog (refresh po uložení)
 */
function openFormulaEditor(anchor, grid, col, gear) {
  document.querySelectorAll('.lattice-formula-menu').forEach((m) => m.remove());
  const t = grid.i18n.t.bind(grid.i18n);
  const editing = !!col;
  const menu = el('div.lattice-menu.lattice-formula-menu');

  menu.appendChild(el('div.lattice-summary-menu-head', { text: t(editing ? 'calc.editTitle' : 'calc.newTitle') }));

  const nameInp = el('input.lattice-set-input', { type: 'text', value: editing ? col.title : '', placeholder: t('calc.namePlaceholder') });
  menu.appendChild(csField(t('calc.name'), nameInp));

  // Typ se u nového sloupce sám odvodí z výsledku vzorce (dokud ho uživatel
  // nezmění ručně) — aby textový vzorec neskončil v číselném sloupci prázdný.
  let userPickedType = editing;
  const typeSel = csSelect(editing ? col.type : 'number', [
    ['number', t('calc.typeNumber')],
    ['text', t('calc.typeText')],
    ['date', t('calc.typeDate')],
  ], () => { userPickedType = true; updatePreview(); });
  menu.appendChild(csField(t('calc.type'), typeSel));

  const ta = el('textarea.lattice-formula-input', { rows: 2, spellcheck: 'false', placeholder: t('calc.formulaPlaceholder') });
  ta.value = editing ? (col.formula || '') : '';
  menu.appendChild(el('div.lattice-formula-row', {}, [el('span.lattice-set-label', { text: t('calc.formula') }), ta]));

  // Klikací seznam sloupců — vloží odkaz na pole do vzorce (podle kurzoru).
  const chips = el('div.lattice-formula-fields');
  for (const c of grid.columns) {
    if (editing && c.field === col.field) continue; // neodkazovat sám na sebe
    if (c.formula != null) continue;                // jiné počítané sloupce nenabízíme (zjednodušení)
    const token = /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.field) ? c.field : '[' + c.field + ']';
    const chip = el('button.lattice-formula-chip', { type: 'button', text: c.title, title: c.field });
    chip.addEventListener('mousedown', (e) => { e.preventDefault(); insertAtCursor(ta, token); updatePreview(); });
    chips.appendChild(chip);
  }
  menu.appendChild(el('div.lattice-formula-fieldswrap', {}, [
    el('div.lattice-formula-hint', { text: t('calc.insertField') }),
    chips,
  ]));

  // Reference funkcí (rozbalovací, prohledávatelná) — sdílená s editorem souhrnu.
  menu.appendChild(buildFnReference(t, FORMULA_CATALOG, ta, () => updatePreview(), () => fit()));

  const preview = el('div.lattice-formula-preview');
  menu.appendChild(preview);

  function sampleRow() {
    const rows = (grid.dataSource && grid.dataSource.allRows) ? grid.dataSource.allRows() : (grid.rows || []);
    return rows && rows.length ? rows[0] : {};
  }
  function updatePreview() {
    const src = ta.value.trim();
    if (!src) { preview.className = 'lattice-formula-preview'; preview.textContent = ''; return; }
    const chk = validateFormula(src);
    if (!chk.ok) { preview.className = 'lattice-formula-preview is-error'; preview.textContent = '⚠ ' + chk.error; return; }
    let val;
    try {
      val = compileFormula(src)(sampleRow());
    } catch (e) {
      preview.className = 'lattice-formula-preview is-error';
      preview.textContent = '⚠ ' + (e && e.message ? e.message : String(e));
      return;
    }
    // Auto-typ podle výsledku (dokud uživatel typ nezvolil ručně).
    if (!userPickedType && val != null) {
      const guessed = inferFormulaType(val);
      if (typeSel.value !== guessed) typeSel.value = guessed;
    }
    // Varování: číselný sloupec, ale výsledek je text → buňka by zůstala prázdná.
    const numericType = typeSel.value === 'number' || typeSel.value === 'money';
    const isTextVal = typeof val === 'string' && val.trim() !== '' && !isNumericStr(val);
    if (numericType && isTextVal) {
      preview.className = 'lattice-formula-preview is-warn';
      preview.textContent = t('calc.previewLabel') + ' ' + formatPreview(val) + ' — ' + t('calc.textHint');
    } else {
      preview.className = 'lattice-formula-preview is-ok';
      preview.textContent = t('calc.previewLabel') + ' ' + formatPreview(val);
    }
  }
  ta.addEventListener('input', updatePreview);

  const save = () => {
    const src = ta.value.trim();
    const chk = validateFormula(src);
    if (!chk.ok) { updatePreview(); return; }
    try {
      if (editing) grid.updateComputedColumn(col.field, { title: nameInp.value, type: typeSel.value, formula: src });
      else grid.addComputedColumn({ title: nameInp.value, type: typeSel.value, formula: src });
    } catch (e) {
      preview.className = 'lattice-formula-preview is-error';
      preview.textContent = '⚠ ' + (e && e.message ? e.message : String(e));
      return;
    }
    close();
    gear.refresh();
  };

  const saveBtn = el('button.lattice-formula-btn.is-primary', { type: 'button', text: t('calc.save') });
  saveBtn.addEventListener('click', save);
  const actions = [saveBtn];
  if (editing) {
    const delBtn = el('button.lattice-formula-btn.is-danger', { type: 'button', text: t('calc.delete') });
    delBtn.addEventListener('click', () => { grid.removeComputedColumn(col.field); close(); gear.refresh(); });
    actions.push(delBtn);
  }
  const cancelBtn = el('button.lattice-formula-btn', { type: 'button', text: t('calc.cancel') });
  cancelBtn.addEventListener('click', () => close());
  actions.push(cancelBtn);
  menu.appendChild(el('div.lattice-formula-actions', {}, actions));

  // Umístí editor pod kotvu; když je vysoký a přetekl by dolů, posune ho nahoru.
  function fit() {
    positionUnder(menu, anchor);
    const vh = window.innerHeight;
    if (menu.getBoundingClientRect().bottom > vh - 8) {
      menu.style.top = Math.max(window.scrollY + 8, window.scrollY + vh - menu.offsetHeight - 8) + 'px';
    }
  }

  updatePreview();
  document.body.appendChild(menu);
  fit();
  const off = onOutside(menu, (e) => { if (!anchor.contains(e.target)) close(); });
  function close() { off(); menu.remove(); }
  setTimeout(() => (editing ? ta : nameInp).focus(), 0);
  return close;
}

/** Vloží funkci `name()` do textarey a umístí kurzor dovnitř závorek. */
function insertFunction(ta, name, sig) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, s);
  const after = ta.value.slice(e);
  const pad = before && !/[\s(,]$/.test(before) ? ' ' : '';
  const insert = name + '()';
  ta.value = before + pad + insert + after;
  const base = (before + pad + insert).length;
  // bezargumentové funkce (today(), now()) → kurzor za závorky, jinak dovnitř
  const zeroArg = /\(\s*\)\s*$/.test(sig);
  const pos = zeroArg ? base : base - 1;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

/**
 * Rozbalovací, prohledávatelná reference funkcí. `catalog` = FORMULA_CATALOG
 * (per-row) nebo AGGREGATE_CATALOG (souhrn). Klik na funkci ji vloží do `ta`.
 * @returns {Element} obal (`div.lattice-formula-fnwrap`)
 */
function buildFnReference(t, catalog, ta, onInsert, fit) {
  const fnBody = el('div.lattice-formula-fnbody');
  const fnToggle = el('button.lattice-formula-fntoggle', {
    type: 'button',
    html: FX_SVG + '<span>' + t('calc.fnTitle') + '</span><span class="lattice-formula-caret">▾</span>',
  });
  const fnSearch = el('input.lattice-set-input.lattice-formula-fnsearch', { type: 'text', placeholder: t('calc.fnSearch') });
  const fnList = el('div.lattice-formula-fnlist');
  const fnCats = [];
  for (const group of catalog) {
    const head = el('div.lattice-formula-fncat', { text: t('calc.fnCat.' + group.cat) });
    fnList.appendChild(head);
    const cat = { head, items: [] };
    // agregační funkce mají popisy pod `calc.agg.*`, ostatní pod `calc.fn.*`.
    const base = group.cat === 'agg' ? 'calc.agg.' : 'calc.fn.';
    for (const name of group.fns) {
      const sig = t(base + name + '.sig');
      const desc = t(base + name + '.desc');
      const item = el('button.lattice-formula-fnitem', { type: 'button', title: sig + ' — ' + desc }, [
        el('code.lattice-formula-fnsig', { text: sig }),
        el('span.lattice-formula-fndesc', { text: desc }),
      ]);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); insertFunction(ta, name, sig); onInsert(); });
      fnList.appendChild(item);
      cat.items.push({ el: item, hay: (name + ' ' + sig + ' ' + desc).toLowerCase() });
    }
    fnCats.push(cat);
  }
  fnSearch.addEventListener('input', () => {
    const q = fnSearch.value.trim().toLowerCase();
    for (const cat of fnCats) {
      let any = false;
      for (const it of cat.items) {
        const show = !q || it.hay.includes(q);
        it.el.style.display = show ? '' : 'none';
        if (show) any = true;
      }
      cat.head.style.display = any ? '' : 'none';
    }
  });
  fnBody.append(fnSearch, fnList);
  fnBody.style.display = 'none';
  fnToggle.addEventListener('click', () => {
    const open = fnBody.style.display === 'none';
    fnBody.style.display = open ? '' : 'none';
    fnToggle.classList.toggle('is-open', open);
    if (open) setTimeout(() => fnSearch.focus(), 0);
    if (fit) fit();
  });
  return el('div.lattice-formula-fnwrap', {}, [fnToggle, fnBody]);
}

/** Vloží text do textarey na pozici kurzoru (s mezerou, když navazuje na slovo). */
function insertAtCursor(ta, text) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, s);
  const after = ta.value.slice(e);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + pad + text + after;
  const pos = (before + pad + text).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

/** Odvodí datový typ počítaného sloupce z výsledku vzorce. */
function inferFormulaType(v) {
  if (typeof v === 'number') return 'number';
  if (v instanceof Date) return 'date';
  return 'text';
}

/** Je hodnota (i řetězec „1 234,56") číselná? */
function isNumericStr(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  return Number.isFinite(Number(String(v).replace(/\s/g, '').replace(',', '.')));
}

/** Krátký náhled hodnoty pro editor (číslo zaokrouhlí, datum na YYYY-MM-DD). */
function formatPreview(v) {
  if (v == null) return '—';
  if (v instanceof Date) return isNaN(v.getTime()) ? '—' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}

const GROUP_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5h8v6H3V5zm10 0h8v2h-8V5zm0 4h8v2h-8V9zM3 13h18v2H3v-2zm0 4h18v2H3v-2z"/></svg>';
// Řádkové seskupení: odsazené řádky (bracket) — vizuálně odlišné od skupiny sloupců.
const ROWGROUP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 4h18v2H3V4zm4 4h14v2H7V8zm0 4h14v2H7v-2zM3 8h2v10H3V8zm4 8h14v2H7v-2z"/></svg>';
// Typy sloupců, podle kterých nemá smysl seskupovat řádky.
const ROWGROUP_EXCLUDE = new Set(['image', 'html', 'progress', 'rating', 'color']);
const DATE_TYPES = new Set(['date', 'datetime', 'time']);
// otočené „A" (otočení hlavičky)
const ROTATE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.5 4l4.5 12h-2l-1-3H5l-1 3H2L6.5 4h1zM6 5.9L4.6 11h2.8L6 5.9zM20 13l-4 4-4-4h3V4h2v9h3z"/></svg>';
const FUNNEL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
// obousměrná šipka (přizpůsobit šířku)
const FIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7v10H2V7h2zm18 0v10h-2V7h2zM8 11l-3 1 3 1v-2zm8 0v2l3-1-3-1zM6 11h12v2H6v-2z"/></svg>';
// nálevka s křížkem (zrušit filtry)
const CLEAR_FILTER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="var(--lattice-danger)" stroke-width="2.8" stroke-linecap="round" d="M15 14l6 6m0-6l-6 6"/></svg>';
const RESET_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5V2L8 6l4 4V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg>';
const GLOBE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.9 6h-2.5a15.7 15.7 0 00-1.3-3.4A8 8 0 0118.9 8zM12 4c.8 1.1 1.4 2.4 1.8 4h-3.6c.4-1.6 1-2.9 1.8-4zM4.3 14a7.8 7.8 0 010-4h2.9a17 17 0 000 4zm.8 2h2.5c.3 1.2.8 2.4 1.3 3.4A8 8 0 015.1 16zm2.5-8H5.1a8 8 0 013.8-3.4C8.4 5.6 7.9 6.8 7.6 8zM12 20c-.8-1.1-1.4-2.4-1.8-4h3.6c-.4 1.6-1 2.9-1.8 4zm2.2-6H9.8a15 15 0 010-4h4.4a15 15 0 010 4zm.6 5.4c.5-1 1-2.2 1.3-3.4h2.5a8 8 0 01-3.8 3.4zm2.1-5.4a17 17 0 000-4h2.9a7.8 7.8 0 010 4z"/></svg>';
const BOOKMARK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 011 1v18l-7-4-7 4V3a1 1 0 011-1z"/></svg>';
// „ƒx" — počítaný sloupec (vzorec)
const FX_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M14.5 4.2c-1.6-.3-2.8.5-3.1 2.2L11.1 8h2.2l-.3 1.8h-2.2l-1 5.7c-.4 2.4-1.7 3.6-3.8 3.6-.5 0-1-.1-1.4-.2l.3-1.8c.3.1.6.2.9.2.9 0 1.4-.6 1.6-1.9l1-5.6H7l.3-1.8h1.8l.3-1.9C10.1 3.6 11.8 2.1 14 2.4l.5 1.8zM15.9 12.6l1.6 2.2 1.9-2.2h2l-2.9 3.3 1.8 2.5-.1.1h-1.9l-1.6-2.3-2 2.3h-2l3-3.4-1.8-2.5v-.1h2z"/></svg>';
