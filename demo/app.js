/**
 * Demo shell — dvě záložky: „Příklady" (živé ukázky per feature) a „Dokumentace"
 * (referenční stránky se živými ukázkami). Sidebar se přepíná dle režimu.
 * Routování přes #hash: `#ex-…` = příklad, `#doc-…` = dokumentace.
 */
import { generateCampaigns } from './data.js';
import { GROUPS, ALL } from './examples.js';
import { DOC_GROUPS, DOC_ALL } from './docs.js';

const data = generateCampaigns(400);

/* ---------- globální presety / výchozí nastavení (spravuje aplikace) ---------- */
const PRESET_API = '/api/presets?grid=ex-presets';
let globalPresetsData = [];
async function loadGlobalPresets() {
  try { globalPresetsData = await fetch(PRESET_API).then((r) => r.json()); } catch { globalPresetsData = []; }
  if (mode === 'examples' && currentId === 'ex-presets') show('ex-presets');
}
const presetHandlers = {
  get globalPresets() { return globalPresetsData; },
  onSaveGlobalPreset: (preset) => {
    globalPresetsData = globalPresetsData.filter((p) => p.name !== preset.name).concat(preset);
    fetch(PRESET_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset }) }).catch(() => {});
    window.alert('Aplikace → uložit globální preset:\n\n' + JSON.stringify({ name: preset.name }, null, 2));
  },
  onDeleteGlobalPreset: (preset) => {
    globalPresetsData = globalPresetsData.filter((p) => p.id !== preset.id);
    fetch(`${PRESET_API}&id=${encodeURIComponent(preset.id)}`, { method: 'DELETE' }).catch(() => {});
  },
};

/* globální rozšířené filtry (spravuje aplikace, stejně jako presety) */
const ADV_API = '/api/advanced-filters?grid=ex-filter-advanced';
let globalAdvancedData = [];
async function loadGlobalAdvanced() {
  try { globalAdvancedData = await fetch(ADV_API).then((r) => r.json()); } catch { globalAdvancedData = []; }
  if (mode === 'examples' && currentId === 'ex-filter-advanced') show('ex-filter-advanced');
}
const advancedHandlers = {
  get globalAdvancedFilters() { return globalAdvancedData; },
  onSaveGlobalAdvancedFilter: (filter) => {
    globalAdvancedData = globalAdvancedData.filter((f) => f.name !== filter.name).concat(filter);
    fetch(ADV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter }) }).catch(() => {});
    window.alert('Aplikace → uložit globální rozšířený filtr:\n\n' + JSON.stringify({ name: filter.name }, null, 2));
  },
  onDeleteGlobalAdvancedFilter: (filter) => {
    globalAdvancedData = globalAdvancedData.filter((f) => f.id !== filter.id);
    fetch(`${ADV_API}&id=${encodeURIComponent(filter.id)}`, { method: 'DELETE' }).catch(() => {});
  },
};

const DEFAULTS_API = '/api/defaults';
let globalDefaultsMap = {};
async function loadGlobalDefaults() {
  try { globalDefaultsMap = await fetch(DEFAULTS_API).then((r) => r.json()); } catch { globalDefaultsMap = {}; }
  if (mode === 'examples' && currentId) show(currentId);
}
const defaultsHandlers = {
  getFor: (id) => globalDefaultsMap[id] || null,
  save: (id, defaults) => {
    globalDefaultsMap[id] = defaults;
    fetch(DEFAULTS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grid: id, defaults }) }).catch(() => {});
    window.alert('Aplikace → uložit výchozí nastavení pro VŠECHNY (grid ' + id + '):\n\nverze ' + defaults.version + '\nPo reloadu se přepíše i uložené nastavení ostatních.');
  },
};

/* ---------- stav ---------- */
let lang = 'cs';
let mode = 'examples';       // 'examples' | 'docs'
let grid = null;             // aktivní instance příkladu
let currentId = null;        // id aktivního příkladu
let currentDocId = null;     // id aktivní doc stránky
let docGrids = [];           // živé instance uvnitř doc stránky (kvůli úklidu)

const els = {
  nav: document.getElementById('nav'),
  navSearch: document.getElementById('navSearch'),
  navEmpty: document.getElementById('navEmpty'),
  title: document.getElementById('ex-title'),
  blurb: document.getElementById('ex-blurb'),
  code: document.getElementById('ex-code'),
  mount: document.getElementById('grid'),
  lang: document.getElementById('lang'),
  reset: document.getElementById('reset'),
  exView: document.getElementById('ex-view'),
  docsView: document.getElementById('docs-view'),
  tabEx: document.getElementById('tab-examples'),
  tabDocs: document.getElementById('tab-docs'),
};

/* ---------- postranní navigace ---------- */
const CHEVRON = '<span class="nav-chevron"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg></span>';

function buildNav(groups, hashPrefix) {
  els.nav.innerHTML = '';
  for (const group of groups) {
    const cat = document.createElement('button');
    cat.type = 'button';
    cat.className = 'nav-cat';
    cat.innerHTML = `<span>${group.category}</span>${CHEVRON}`;
    const list = document.createElement('div');
    list.className = 'nav-list';
    for (const item of group.items) {
      const a = document.createElement('a');
      a.className = 'nav-item';
      a.href = '#' + hashPrefix + item.id;
      a.textContent = item.title;
      a.dataset.hash = hashPrefix + item.id;
      list.appendChild(a);
    }
    cat.addEventListener('click', () => {
      const collapsed = cat.classList.toggle('is-collapsed');
      list.style.display = collapsed ? 'none' : '';
    });
    els.nav.append(cat, list);
  }
  filterNav(); // po přestavění nabídky znovu použij aktuální hledání
}

function highlightNav() {
  const active = mode === 'docs' ? 'doc-' + currentDocId : currentId;
  for (const a of els.nav.querySelectorAll('.nav-item')) {
    a.classList.toggle('active', a.dataset.hash === active);
  }
}

/** Bezdiakritické, malými písmeny — pro tolerantní hledání. */
function foldText(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Filtruje položky v sidebaru podle hledaného textu (název ukázky/stránky). */
function filterNav() {
  const q = foldText(els.navSearch ? els.navSearch.value.trim() : '');
  let anyVisible = false;
  els.nav.querySelectorAll('.nav-list').forEach((list) => {
    const cat = list.previousElementSibling; // odpovídající .nav-cat
    let catHas = false;
    list.querySelectorAll('.nav-item').forEach((a) => {
      const match = !q || foldText(a.textContent).includes(q);
      a.classList.toggle('is-hidden', !match);
      if (match) catHas = true;
    });
    if (cat) cat.classList.toggle('is-hidden', !!q && !catHas);
    // při hledání ukaž nálezy bez ohledu na sbalení kategorie; jinak dle stavu sbalení
    if (q) list.style.display = catHas ? '' : 'none';
    else list.style.display = (cat && cat.classList.contains('is-collapsed')) ? 'none' : '';
    if (catHas) anyVisible = true;
  });
  if (els.navEmpty) els.navEmpty.hidden = !(q && !anyVisible);
}

/* ---------- režim ---------- */
function setMode(m) {
  if (mode === m && els.nav.childElementCount) return;
  mode = m;
  els.tabEx.classList.toggle('is-active', m === 'examples');
  els.tabDocs.classList.toggle('is-active', m === 'docs');
  els.exView.hidden = m !== 'examples';
  els.docsView.hidden = m !== 'docs';
  if (m === 'examples') buildNav(GROUPS, '');
  else buildNav(DOC_GROUPS, 'doc-');
}

/* ---------- příklad ---------- */
function show(id) {
  const ex = ALL.find((e) => e.id === id) || ALL[0];
  currentId = ex.id;
  if (grid) { try { grid.destroy(); } catch { /* no-op */ } grid = null; }
  els.mount.innerHTML = '';
  els.title.textContent = ex.title;
  els.blurb.innerHTML = ex.blurb; // blurby jsou důvěryhodné (autor příkladu) a smí obsahovat <b>/<code>
  els.code.textContent = ex.code;
  grid = ex.mount(els.mount, {
    data, lang,
    globalPresets: presetHandlers.globalPresets,
    onSaveGlobalPreset: presetHandlers.onSaveGlobalPreset,
    onDeleteGlobalPreset: presetHandlers.onDeleteGlobalPreset,
    globalAdvancedFilters: advancedHandlers.globalAdvancedFilters,
    onSaveGlobalAdvancedFilter: advancedHandlers.onSaveGlobalAdvancedFilter,
    onDeleteGlobalAdvancedFilter: advancedHandlers.onDeleteGlobalAdvancedFilter,
    globalDefaultsFor: defaultsHandlers.getFor,
    saveGlobalDefaults: defaultsHandlers.save,
  });
  window.grid = grid;
  highlightNav();
  if (location.hash !== '#' + ex.id) history.replaceState(null, '', '#' + ex.id);
}

/* ---------- doc stránka ---------- */
function destroyDocGrids() {
  for (const g of docGrids) { try { g.destroy(); } catch { /* no-op */ } }
  docGrids = [];
}
function showDoc(id) {
  const page = DOC_ALL.find((d) => d.id === id) || DOC_ALL[0];
  currentDocId = page.id;
  destroyDocGrids();
  els.docsView.innerHTML = '';
  const rootDiv = document.createElement('div');
  rootDiv.className = 'doc';
  els.docsView.appendChild(rootDiv);
  page.build(rootDiv, { data, lang, register: (g) => docGrids.push(g) });
  window.scrollTo(0, 0);
  highlightNav();
  const hash = '#doc-' + page.id;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

/* ---------- routing ---------- */
function route(hash) {
  if (hash && hash.startsWith('doc-')) {
    setMode('docs');
    showDoc(hash.slice(4));
  } else {
    setMode('examples');
    show(hash || ALL[0].id);
  }
}

/* ---------- ovládání ---------- */
els.tabEx.addEventListener('click', () => route(currentId || ALL[0].id));
els.tabDocs.addEventListener('click', () => route('doc-' + (currentDocId || DOC_ALL[0].id)));

if (els.navSearch) {
  els.navSearch.addEventListener('input', filterNav);
  // Esc vyčistí hledání
  els.navSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.navSearch.value = ''; filterNav(); } });
}

els.lang.addEventListener('change', () => {
  lang = els.lang.value;
  if (mode === 'examples') { if (grid) grid.setLanguage(lang); }
  else showDoc(currentDocId); // re-render doc (živé ukázky v novém jazyce)
});

els.reset.addEventListener('click', () => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('lattice:')) localStorage.removeItem(key);
  }
  if (mode === 'examples') show(currentId);
  else showDoc(currentDocId);
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  const cur = mode === 'docs' ? 'doc-' + currentDocId : currentId;
  if (hash && hash !== cur) route(hash);
});

route(location.hash.slice(1) || ALL[0].id);
loadGlobalPresets();
loadGlobalAdvanced();
loadGlobalDefaults();
