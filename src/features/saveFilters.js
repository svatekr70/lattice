/**
 * Panel uložených filtrů (ikona trychtýř + disketa v toolbaru). Dvě role v jednom:
 *
 *  - **uložení** „naklikaných" sloupcových filtrů pod názvem — uživatel nastaví filtry
 *    v hlavičce, pojmenuje je a uloží lokálně/globálně, volitelně jako tlačítko a/nebo
 *    do rozbalovacího výběru (řádek se ukáže, jen když je co ukládat),
 *  - **správa** všech uložených filtrů (snímky i stromy z rozšířeného filtru): použít,
 *    přepnout zobrazení (tlačítko / výběr), upravit a smazat.
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

  /** `prefillName` předvyplní název (úprava uloženého snímku → uložení pod stejným jménem). */
  open(anchor, prefillName = '') {
    if (this.panel) this.close();
    if (!anchor) return;
    this.anchor = anchor;
    const panel = el('div.lattice-panel.lattice-savefilters-panel');
    this.panel = panel;
    this.render(prefillName);
    document.body.appendChild(panel);
    positionUnder(panel, anchor);
    this.off = onOutside(panel, (e) => {
      if (this.anchor?.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.lattice-menu')) return;
      this.close();
    });
  }

  close() {
    this.off?.();
    this.panel?.remove();
    this.panel = null;
    this.off = null;
  }

  render(prefillName = '') {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const panel = this.panel;
    panel.textContent = '';

    panel.appendChild(el('div.lattice-panel-head', {}, [
      el('span.lattice-panel-title', { text: t('saveFilters.manage') }),
    ]));

    // Řada pro uložení aktuálních sloupcových filtrů: název + „tlačítko" / „výběr" + uložit.
    // Bez aktivního sloupcového filtru není co ukládat → místo řady jen nápověda.
    if (grid.hasColumnFilters()) panel.appendChild(this.buildSaveRow(prefillName));
    else panel.appendChild(el('div.lattice-savefilters-empty', { text: t('saveFilters.hint') }));

    // Seznam všech uložených filtrů (snímky i stromy) — použít / zobrazení / upravit / smazat
    this.listEl = el('div.lattice-savefilters-list');
    panel.appendChild(this.listEl);
    this.renderList();
  }

  buildSaveRow(prefillName) {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);

    const nameInput = el('input.lattice-adv-name', { type: 'text', placeholder: t('saveFilters.namePlaceholder'), value: prefillName });
    const asBtnInput = el('input', { type: 'checkbox' });
    const asBtnLabel = el('label.lattice-adv-asbtn', { title: t('saveFilters.asButtonHint') }, [
      asBtnInput, el('span', { text: t('saveFilters.asButton') }),
    ]);
    const asSelInput = el('input', { type: 'checkbox' });
    asSelInput.checked = true; // výchozí = do rozbalovacího výběru (jako doteď)
    const asSelLabel = el('label.lattice-adv-asbtn', { title: t('saveFilters.asSelectHint') }, [
      asSelInput, el('span', { text: t('saveFilters.asSelect') }),
    ]);
    // Úprava uloženého: převezmi jeho volby zobrazení, ať se uložením pod stejným názvem neztratí.
    if (prefillName) {
      const cur = grid.listAdvanced().find((f) => f.name === prefillName);
      if (cur) { asBtnInput.checked = !!cur.asButton; asSelInput.checked = cur.asSelect === undefined ? !cur.asButton : !!cur.asSelect; }
    }

    const saveWithScope = (scope) => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const item = grid.saveFilterSnapshot(name, scope, { button: asBtnInput.checked, select: asSelInput.checked });
      if (!item) return; // žádný aktivní sloupcový filtr → není co uložit
      nameInput.value = '';
      asBtnInput.checked = false;
      asSelInput.checked = true;
      this.renderList(); // ukázat novou položku v seznamu
    };

    const saveBtn = el('button.lattice-dr-btn.is-primary', { type: 'button', text: t('saveFilters.save') });
    saveBtn.addEventListener('click', () => saveWithScope('local'));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveWithScope('local'); });
    const rowEls = [nameInput, asBtnLabel, asSelLabel, saveBtn];
    if (grid.canSaveGlobalAdvanced()) {
      const globeBtn = el('button.lattice-dr-btn.is-success', { type: 'button', text: t('saveFilters.saveGlobal') });
      globeBtn.addEventListener('click', () => saveWithScope('global'));
      rowEls.push(globeBtn);
    }
    return el('div.lattice-adv-saverow', {}, rowEls);
  }

  renderList() {
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const list = this.listEl;
    list.textContent = '';
    const saved = grid.listAdvanced();
    if (!saved.length) {
      list.appendChild(el('div.lattice-savefilters-empty', { text: t('saveFilters.none') }));
      if (this.panel) positionUnder(this.panel, this.anchor);
      return;
    }
    const activeId = grid.activeSavedId();
    this._rows = [];
    for (const item of saved) {
      const row = el('div.lattice-savefilters-row');

      const apply = el('button.lattice-savefilters-name' + (item.id === activeId ? '.is-active' : ''), {
        type: 'button', text: (item.scope === 'global' ? '🌐 ' : '') + item.name,
        title: (item.id === activeId ? t('quickbar.clearFilter') : t('quickbar.applyFilter')) + ' · ' + t('saveFilters.rename'),
      });
      // Pozor: po zapnutí/vypnutí seznam NEpřekreslujeme celý (jen zvýraznění), jinak by
      // se řádky vyměnily mezi dvěma kliky a dvojklik na název by se nikdy nespustil.
      apply.addEventListener('click', () => { grid.toggleSavedAdvanced(item.id); this.syncActive(); });
      apply.addEventListener('dblclick', () => this.renameInline(row, apply, item));
      row.appendChild(apply);
      this._rows.push({ item, apply });

      // Tužka: přejmenovat (obsah filtru zůstává). Totéž svede i dvojklik na název.
      const ren = el('button.lattice-preset-pin', { type: 'button', title: t('saveFilters.rename'), html: PENCIL_SVG });
      ren.addEventListener('click', () => this.renameInline(row, apply, item));
      row.appendChild(ren);

      // Disketa: přepiš tenhle uložený filtr TÍM, co je právě naklikané v hlavičce.
      // Tak se mění „vlastnosti" filtru — nastav filtry v tabulce a klikni sem.
      if (item.kind === 'columns') {
        const over = el('button.lattice-preset-pin.lattice-savefilters-overwrite', {
          type: 'button', html: DISK_SVG,
          title: grid.hasColumnFilters() ? t('saveFilters.overwrite') : t('saveFilters.overwriteDisabled'),
        });
        over.disabled = !grid.hasColumnFilters();
        over.addEventListener('click', () => { grid.overwriteSavedFilter(item.id); this.renderList(); });
        row.appendChild(over);
      } else {
        // strom z rozšířeného filtru se upravuje v query-builderu
        const edit = el('button.lattice-preset-pin', { type: 'button', title: t('saveFilters.edit'), html: BUILDER_SVG });
        edit.addEventListener('click', () => { this.close(); grid.renderer.editSavedItem(item, 'filter'); });
        row.appendChild(edit);
      }

      // Kde se filtr nabízí — dvojice přepínačů jako u presetů v panelu „Sloupce".
      const asSelect = item.asSelect === undefined ? !item.asButton : !!item.asSelect;
      for (const [key, on, icon, hint] of [
        ['asButton', !!item.asButton, PILL_SVG, 'saveFilters.asButtonHint'],
        ['asSelect', asSelect, SELECT_SVG, 'saveFilters.asSelectHint'],
      ]) {
        const tog = el('button.lattice-preset-pin' + (on ? '.is-on' : ''), { type: 'button', title: t(hint), html: icon });
        tog.addEventListener('click', () => { grid.setAdvancedDisplay(item.id, key, !on); this.renderList(); });
        row.appendChild(tog);
      }

      const del = el('button.lattice-icon-btn.is-danger', { type: 'button', title: t('saveFilters.delete'), text: '×' });
      del.addEventListener('click', () => { grid.deleteAdvanced(item.id); this.renderList(); });
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
      apply.classList.toggle('is-active', on);
      apply.title = (on ? t('quickbar.clearFilter') : t('quickbar.applyFilter')) + ' · ' + t('saveFilters.rename');
    }
  }

  /** Přejmenování na místě: název se změní v políčku, Enter uloží, Escape zruší. */
  renameInline(row, nameBtn, item) {
    const input = el('input.lattice-savefilters-rename', { type: 'text', value: item.name });
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
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }
}

/* ikony akcí v řádku (stejné jako v panelu presetů) */
const DISK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M4 3h13l3 3v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path fill="var(--lattice-bg, #fff)" d="M7 4h8v5H7zM6 14h12v7H6z"/></svg>';
const PILL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><rect class="lattice-pin-fill" x="5" y="9.5" width="14" height="5" rx="2.5" fill="currentColor"/></svg>';
const SELECT_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path class="lattice-pin-fill" fill="currentColor" d="M6 9h8v1.8H6zm0 4h6v1.8H6z"/><path fill="currentColor" d="M16.2 10.2h3.4L17.9 13z"/></svg>';
const BUILDER_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M2 4h15l-5.5 7v5l-4 2v-7z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M17 12.5v7m-3.5-3.5h7"/></svg>';
const PENCIL_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12.1 1.6a1.4 1.4 0 012 2l-.9.9-2-2 .9-.9zM10 3.2l2 2-6.7 6.7-2.6.6.6-2.6L10 3.2z"/></svg>';
