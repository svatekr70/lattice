/**
 * Paginace — vlevo info „Zobrazeno X-Y z N řádků", vpravo
 * „Velikost stránky" + select + « ‹ [číslované stránky] › » (aktivní zvýrazněná).
 * Když je stránkování v instanci vypnuté, patička se nevykreslí.
 */
import { el, clear } from '../util/dom.js';

// „Vše" = velmi velká (ale JSON-bezpečná) velikost stránky → jedna stránka se vším.
export const ALL_PAGE_SIZE = 1e9;

export class Pagination {
  constructor(grid) {
    this.grid = grid;
  }

  render(footer) {
    clear(footer);
    const grid = this.grid;
    const t = grid.i18n.t.bind(grid.i18n);
    const page = grid.page;
    const last = grid.lastPage || 1;
    const total = grid.total ?? 0;

    /* --- levá část: „Zobrazeno X-Y z N řádků" --- */
    const from = total === 0 ? 0 : (page - 1) * grid.pageSize + 1;
    const to = Math.min(page * grid.pageSize, total);
    const info = el('div.lattice-page-info', {
      text: total === 0 ? t('pagination.empty') : t('pagination.showing', { from, to, total }),
    });

    /* --- pravá část: velikost stránky + navigace --- */
    const sizes = grid.options.pageSizes || [10, 25, 50, 100];
    const isAll = grid.pageSize >= ALL_PAGE_SIZE;
    const sizeSel = el('select.lattice-page-size');
    for (const s of sizes) sizeSel.appendChild(el('option', { value: s, text: String(s) }));
    if (grid.options.pageSizeAll !== false) sizeSel.appendChild(el('option', { value: 'all', text: t('pagination.all') }));
    sizeSel.value = isAll ? 'all' : String(grid.pageSize);
    sizeSel.addEventListener('change', () => grid.setPageSize(sizeSel.value === 'all' ? ALL_PAGE_SIZE : Number(sizeSel.value)));

    const nav = el('div.lattice-page-nav');
    const btn = (label, targetPage, { disabled = false, active = false, title } = {}) => {
      const b = el('button.lattice-page-btn', { type: 'button', text: label });
      if (title) b.title = title;
      if (active) b.classList.add('is-active');
      b.disabled = disabled;
      if (!disabled && !active) b.addEventListener('click', () => grid.setPage(targetPage));
      return b;
    };

    nav.appendChild(btn(t('pagination.first'), 1, { disabled: page <= 1, title: t('pagination.firstTitle') }));
    nav.appendChild(btn(t('pagination.prev'), page - 1, { disabled: page <= 1, title: t('pagination.prevTitle') }));

    // Okno číslovaných tlačítek kolem aktuální stránky.
    for (const p of this.pageWindow(page, last)) {
      nav.appendChild(btn(String(p), p, { active: p === page }));
    }

    nav.appendChild(btn(t('pagination.next'), page + 1, { disabled: page >= last, title: t('pagination.nextTitle') }));
    nav.appendChild(btn(t('pagination.last'), last, { disabled: page >= last, title: t('pagination.lastTitle') }));

    // Skok na stránku ručně (např. 165 z 180 bez proklikávání).
    const jump = el('input.lattice-page-jump', { type: 'number', min: 1, max: last, value: String(page), title: t('pagination.gotoTitle') });
    const go = () => {
      const v = parseInt(jump.value, 10);
      if (Number.isFinite(v) && v !== page) grid.setPage(Math.min(Math.max(1, v), last));
    };
    jump.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    jump.addEventListener('change', go);
    const jumpWrap = el('div.lattice-page-jump-wrap', {}, [
      el('span', { text: t('pagination.pageLabel') }),
      jump,
      el('span.lattice-page-size-label', { text: '/ ' + last }),
    ]);

    const controls = el('div.lattice-page-controls', {}, [
      el('span.lattice-page-size-label', { text: t('pagination.pageSize') }),
      sizeSel,
      nav,
      jumpWrap,
    ]);

    footer.append(info, controls);
  }

  /** Vrátí okno čísel stránek kolem aktuální (count tlačítek, klampováno). */
  pageWindow(page, last) {
    const count = this.grid.options.paginationButtons ?? 5;
    let start = Math.max(1, page - Math.floor(count / 2));
    let end = Math.min(last, start + count - 1);
    start = Math.max(1, end - count + 1);
    const out = [];
    for (let p = start; p <= end; p++) out.push(p);
    return out;
  }
}
