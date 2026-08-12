/**
 * Uložení „naklikaných" sloupcových filtrů pod názvem — bez definování rozšířeného
 * filtru. Uživatel nastaví filtry v hlavičce, klikne na ikonu (trychtýř + disketa)
 * a uloží snímek lokálně nebo globálně, volitelně jako tlačítko. Snímky se objeví ve
 * stejném seznamu (select + řada tlačítek) jako uložené rozšířené filtry.
 */
import { el, onOutside } from '../util/dom.js';
import { positionUnder } from './gear.js';

export class SaveFiltersPanel {
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

  open(anchor) {
    if (this.panel) this.close();
    this.anchor = anchor;
    const panel = el('div.lattice-panel.lattice-savefilters-panel');
    this.panel = panel;
    this.render();
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.off = onOutside(panel, (e) => { if (!this.anchor?.contains(e.target)) this.close(); });
  }

  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }

  render() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const panel = this.panel;
    panel.textContent = '';

    panel.appendChild(el('div.lattice-panel-head', {}, [
      el('span.lattice-panel-title', { text: t('saveFilters.title') }),
    ]));

    // Řada: název + „jako tlačítko" + uložit / uložit globálně
    const nameInput = el('input.lattice-adv-name', { type: 'text', placeholder: t('saveFilters.namePlaceholder') });
    const asBtnInput = el('input', { type: 'checkbox' });
    const asBtnLabel = el('label.lattice-adv-asbtn', { title: t('saveFilters.asButtonHint') }, [
      asBtnInput, el('span', { text: t('saveFilters.asButton') }),
    ]);

    const saveWithScope = (scope) => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const item = grid.saveFilterSnapshot(name, scope, asBtnInput.checked);
      if (!item) return; // žádný aktivní sloupcový filtr → není co uložit
      nameInput.value = '';
      asBtnInput.checked = false;
      this.renderList(); // ukázat novou položku v seznamu
    };

    const saveBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: t('saveFilters.save') });
    saveBtn.addEventListener('click', () => saveWithScope('local'));
    const rowEls = [nameInput, asBtnLabel, saveBtn];
    if (grid.canSaveGlobalAdvanced()) {
      const globeBtn = el('button.lattice-dr-btn.is-success', { type: 'button', text: t('saveFilters.saveGlobal') });
      globeBtn.addEventListener('click', () => saveWithScope('global'));
      rowEls.push(globeBtn);
    }
    panel.appendChild(el('div.lattice-adv-saverow', {}, rowEls));

    // Seznam již uložených snímků (aplikovat / smazat)
    this.listEl = el('div.lattice-savefilters-list');
    panel.appendChild(this.listEl);
    this.renderList();
  }

  renderList() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const list = this.listEl;
    list.textContent = '';
    const snaps = grid.listAdvanced().filter((f) => f.kind === 'columns');
    if (!snaps.length) {
      list.appendChild(el('div.lattice-savefilters-empty', { text: t('saveFilters.none') }));
      if (this.panel) positionUnder(this.panel, this.anchor);
      return;
    }
    const activeId = grid.activeSavedId();
    for (const s of snaps) {
      const apply = el('button.lattice-savefilters-name' + (s.id === activeId ? '.is-active' : ''), {
        type: 'button', text: (s.scope === 'global' ? '🌐 ' : '') + s.name, title: t('saveFilters.apply'),
      });
      apply.addEventListener('click', () => { grid.applyFiltersSnapshot(s); this.renderList(); });
      const del = el('button.lattice-icon-btn.is-danger', { type: 'button', title: t('saveFilters.delete'), text: '×' });
      del.addEventListener('click', () => { grid.deleteAdvanced(s.id); this.renderList(); });
      list.appendChild(el('div.lattice-savefilters-row', {}, [apply, del]));
    }
    if (this.panel) positionUnder(this.panel, this.anchor);
  }
}
