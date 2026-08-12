/**
 * Rozšířený filtr (query builder) — vnořené skupiny podmínek s AND/OR,
 * pojmenované uložené filtry a výběr z nich.
 *
 * Strom: viz filters/advancedEval.js.
 */
import { el, clear, onOutside } from '../util/dom.js';
import { positionUnder } from './gear.js';
import { ADV_OPS, isGroup } from '../filters/advancedEval.js';

export class AdvancedFilter {
  constructor(grid) {
    this.grid = grid;
    this.panel = null;
    this.off = null;
    this.tree = null;
    this.selectedId = '';
  }

  toggle(anchor) {
    if (this.panel) return this.close();
    this.open(anchor);
  }

  open(anchor) {
    if (this.panel) this.close(); // pojistka: nikdy nenech viset starý panel/outside-listener
    this.anchor = anchor;
    // pracovní kopie aktivního filtru, nebo prázdná skupina s jednou podmínkou
    this.tree = this.grid.advanced ? clone(this.grid.advanced) : freshGroup(this.grid);
    // předvybrat uložený filtr, pokud aktivní strom odpovídá nějakému uloženému
    this.selectedId = this.matchSavedId(this.grid.advanced);

    const panel = el('div.lattice-panel.lattice-adv-panel');
    this.panel = panel;
    this.renderPanel();
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    // pozor: kotva se může za běhu přepnout (renderToolbar vyrobí nové tlačítko),
    // proto testujeme aktuální this.anchor, ne uzavřenou proměnnou anchor.
    this.off = onOutside(panel, (e) => { if (!this.anchor?.contains(e.target)) this.close(); });
  }

  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }

  /** Vrátí id uloženého filtru, jehož strom odpovídá `tree` (nebo ''). */
  matchSavedId(tree) {
    if (!tree) return '';
    const s = JSON.stringify(tree);
    const f = this.grid.listAdvanced().find((x) => JSON.stringify(x.tree) === s);
    return f ? f.id : '';
  }

  renderPanel() {
    const panel = this.panel;
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    clear(panel);

    panel.appendChild(el('div.lattice-panel-head', {}, [
      el('span.lattice-panel-title', { text: t('advanced.title') }),
    ]));

    // Uložené filtry (select + smazat) — samostatný uzel, aby se neresetoval při editaci stromu.
    this.savedRow = this.buildSavedRow();
    panel.appendChild(this.savedRow);

    // Builder — překresluje se samostatně (nezasahuje do selectu uložených).
    this.builderEl = el('div.lattice-adv-builder');
    this.renderBuilder();
    panel.appendChild(this.builderEl);

    // Patička: název + uložit; vymazat; použít
    const nameInput = el('input.lattice-adv-name', { type: 'text', placeholder: t('advanced.namePlaceholder') });
    this.nameInput = nameInput;
    // předvyplnit název aktivního uloženého filtru (můžu upravit a uložit pod stejným názvem)
    if (this.selectedId) {
      const cur = this.grid.listAdvanced().find((x) => x.id === this.selectedId);
      if (cur) nameInput.value = cur.name;
    }
    // Přepínač „zobrazit jako tlačítko" — uloží se u konkrétního filtru; když je zapnutý,
    // filtr se vykreslí jako tlačítko v řadě nad ikonami toolbaru (místo jen v selectu).
    const asBtnInput = el('input', { type: 'checkbox' });
    this.asBtnInput = asBtnInput;
    if (this.selectedId) {
      const cur = this.grid.listAdvanced().find((x) => x.id === this.selectedId);
      if (cur) asBtnInput.checked = !!cur.asButton;
    }
    const asBtnLabel = el('label.lattice-adv-asbtn', { title: t('advanced.asButtonHint') }, [
      asBtnInput, el('span', { text: t('advanced.asButton') }),
    ]);
    const saveBtn = el('button.lattice-dr-btn', { type: 'button', text: t('advanced.save') });
    const saveWithScope = (scope) => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const item = this.grid.saveAdvanced(name, this.tree, scope, asBtnInput.checked);
      nameInput.value = '';
      asBtnInput.checked = false;
      this.selectedId = item ? item.id : this.selectedId;
      this.refreshSavedRow();
    };
    saveBtn.addEventListener('click', () => saveWithScope('local'));
    const saveRowEls = [nameInput, asBtnLabel, saveBtn];
    // Globus (globální filtr) — jen když aplikace dodala callback; klik pošle callback.
    if (this.grid.canSaveGlobalAdvanced()) {
      const globeBtn = el('button.lattice-dr-btn.is-success', { type: 'button', text: t('advanced.saveGlobal') });
      globeBtn.addEventListener('click', () => saveWithScope('global'));
      saveRowEls.push(globeBtn);
    }
    const clearBtn = el('button.lattice-dr-btn', { type: 'button', text: t('advanced.clear') });
    clearBtn.addEventListener('click', () => { this.grid.clearAdvanced(); this.close(); });
    const applyBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: t('advanced.apply') });
    applyBtn.addEventListener('click', () => { this.grid.applyAdvanced(this.tree); this.close(); });

    panel.appendChild(el('div.lattice-adv-footer', {}, [
      el('div.lattice-adv-saverow', {}, saveRowEls),
      el('div.lattice-adv-footer-btns', {}, [clearBtn, applyBtn]),
    ]));
  }

  buildSavedRow() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    // snímky sloupcových filtrů (kind:'columns') sem nepatří — nejsou to editovatelné stromy
    const saved = grid.listAdvanced().filter((f) => f.kind !== 'columns');

    const sel = el('select.lattice-adv-saved');
    sel.appendChild(el('option', { value: '', text: t('advanced.savedPlaceholder') }));
    // globální filtry (sdílené aplikací) odlišíme glóbem, ať je poznat od lokálních
    for (const f of saved) sel.appendChild(el('option', { value: f.id, text: (f.scope === 'global' ? '🌐 ' : '') + f.name }));
    sel.value = this.selectedId || '';
    sel.addEventListener('change', () => {
      this.selectedId = sel.value;
      const f = saved.find((x) => x.id === sel.value);
      if (!f) return;
      this.tree = clone(f.tree);
      if (this.nameInput) this.nameInput.value = f.name; // předvyplň název → uložení pod stejným
      if (this.asBtnInput) this.asBtnInput.checked = !!f.asButton; // odraz stav „jako tlačítko"
      this.renderBuilder();            // překresli JEN strom, select zůstane vybraný
      grid.applyAdvanced(this.tree);   // vybraný filtr rovnou aplikuj
    });

    const del = el('button.lattice-icon-btn.is-danger', { type: 'button', title: t('advanced.delete'), text: '×' });
    del.addEventListener('click', () => {
      const id = sel.value;
      if (!id) return;
      grid.deleteAdvanced(id);
      this.selectedId = '';
      this.refreshSavedRow();
    });

    return el('div.lattice-adv-saved-row', {}, [sel, del]);
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
    // strukturální změna stromu (přidání/odebrání) → překresli jen builder
    this.selectedId = ''; // uživatel edituje → už to není přesně vybraný uložený filtr
    if (this.savedRow) { const s = this.savedRow.querySelector('select'); if (s) s.value = ''; }
    this.renderBuilder();
  }

  renderGroup(group, parent) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const grid = this.grid;
    const box = el('div.lattice-adv-group');

    const combSel = el('select.lattice-adv-comb');
    combSel.appendChild(el('option', { value: 'AND', text: t('advanced.and') }));
    combSel.appendChild(el('option', { value: 'OR', text: t('advanced.or') }));
    combSel.value = group.combinator || 'AND';
    combSel.addEventListener('change', () => { group.combinator = combSel.value; });

    const addCond = el('button.lattice-adv-add', { type: 'button', text: '+ ' + t('advanced.addCondition') });
    addCond.addEventListener('click', () => { group.rules.push(newCondition(grid)); this.rerender(); });
    const addGroup = el('button.lattice-adv-add', { type: 'button', text: '+ ' + t('advanced.addGroup') });
    addGroup.addEventListener('click', () => { group.rules.push({ combinator: 'AND', rules: [newCondition(grid)] }); this.rerender(); });

    const head = el('div.lattice-adv-group-head', {}, [combSel, addCond, addGroup]);
    if (parent) {
      const rm = el('button.lattice-adv-rm', { type: 'button', title: t('advanced.remove'), text: '×' });
      rm.addEventListener('click', () => { parent.rules.splice(parent.rules.indexOf(group), 1); this.rerender(); });
      head.appendChild(rm);
    }
    box.appendChild(head);

    const rules = el('div.lattice-adv-rules');
    for (const r of group.rules) {
      rules.appendChild(isGroup(r) ? this.renderGroup(r, group) : this.renderCondition(r, group));
    }
    box.appendChild(rules);
    return box;
  }

  renderCondition(cond, parent) {
    const t = this.grid.i18n.t.bind(this.grid.i18n);
    const row = el('div.lattice-adv-cond');

    const fieldSel = el('select.lattice-adv-field');
    for (const c of this.grid.columns) fieldSel.appendChild(el('option', { value: c.field, text: c.title }));
    fieldSel.value = cond.field;
    fieldSel.addEventListener('change', () => { cond.field = fieldSel.value; });

    const opSel = el('select.lattice-adv-op');
    for (const op of ADV_OPS) opSel.appendChild(el('option', { value: op, text: t('advanced.ops.' + op) }));
    opSel.value = cond.op;

    const valInput = el('input.lattice-adv-value', { type: 'text', value: cond.value ?? '', placeholder: t('advanced.valuePlaceholder'), title: t('advanced.valueHint') });
    valInput.addEventListener('input', () => { cond.value = valInput.value; });
    const syncVal = () => { valInput.style.display = (cond.op === 'empty' || cond.op === 'nempty') ? 'none' : ''; };
    opSel.addEventListener('change', () => { cond.op = opSel.value; syncVal(); });
    syncVal();

    const rm = el('button.lattice-adv-rm', { type: 'button', title: t('advanced.remove'), text: '×' });
    rm.addEventListener('click', () => { parent.rules.splice(parent.rules.indexOf(cond), 1); this.rerender(); });

    row.append(fieldSel, opSel, valInput, rm);
    return row;
  }
}

/* ---- pomocné ---- */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function newCondition(grid) {
  const first = grid.columns[0];
  return { field: first ? first.field : '', op: 'contains', value: '' };
}

function freshGroup(grid) {
  return { combinator: 'AND', rules: [newCondition(grid)] };
}
