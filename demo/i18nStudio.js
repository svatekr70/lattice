/**
 * Překladatelské studio (demo nástroj) — z vestavěného slovníku (cs/en) vygeneruje
 * editovatelný seznam VŠECH řetězců, umožní je přeložit do nového jazyka, stáhnout
 * výsledek jako `<kód>.js` (drop-in vedle cs.js/en.js) a živě ho vyzkoušet na tabulce.
 *
 * Bez závislostí a bez překladové služby: samotný překlad zadá člověk (nebo si
 * nechá vygenerovat „zadání pro překladač" jako JSON, přeloží kdekoli a naimportuje
 * zpět). Nástroj řeší extrakci klíčů, strukturu, placeholdery, náhled a export.
 */
import { Lattice } from '../src/index.js';
import { campaignColumns } from './columns.js';
import en from '../src/i18n/en.js';
import cs from '../src/i18n/cs.js';

const BASES = { en, cs };

/* ---- ploché klíče <-> vnořený objekt ------------------------------------ */

/** Rozloží slovník na uspořádané listy: [{ path, kind:'string'|'array', source }]. */
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (Array.isArray(v)) out.push({ path, kind: 'array', source: v });
    else if (v && typeof v === 'object') flatten(v, path, out);
    else out.push({ path, kind: 'string', source: String(v) });
  }
  return out;
}

/** Poskládá plochou mapu path→hodnota zpět do vnořeného objektu (pořadí dle `order`). */
function unflatten(map, order) {
  const root = {};
  for (const { path } of order) {
    const parts = path.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = map[path]; // string nebo pole
  }
  return root;
}

/** `export default {…};` – JSON je platný JS objektový literál, takže je to drop-in modul. */
function toModule(dict) {
  return 'export default ' + JSON.stringify(dict, null, 2) + ';\n';
}

const PLACEHOLDER = /\{(\w+)\}/g;
function placeholders(s) { return (String(s).match(PLACEHOLDER) || []).sort().join(','); }

/* ---- UI ----------------------------------------------------------------- */

export function i18nStudioExample(el, ctx) {
  let baseCode = ctx.lang === 'cs' ? 'cs' : 'en';
  let entries = flatten(BASES[baseCode]);          // [{path,kind,source}]
  const targets = new Map();                       // path -> string (uživatelův překlad; '' = nevyplněno)

  el.innerHTML = '';
  el.appendChild(styleTag());

  // --- ovládací lišta ---
  const bar = div('i18ns-bar');
  bar.innerHTML = `
    <label>Základ (zdroj): <select class="base">
      <option value="en">English</option>
      <option value="cs">Čeština</option>
    </select></label>
    <label>Cílový jazyk – kód: <input class="code" placeholder="např. de" size="6" value="de"></label>
    <label>Název: <input class="name" placeholder="Deutsch" size="12" value="Deutsch"></label>
    <input class="search" type="search" placeholder="Hledat klíč / text…">
    <span class="prog"></span>`;
  el.appendChild(bar);
  bar.querySelector('.base').value = baseCode;

  // --- tlačítka ---
  const tools = div('i18ns-tools');
  tools.innerHTML = `
    <button class="fillsrc" type="button">Nevyplněné doplnit ze zdroje</button>
    <button class="task" type="button">Zkopírovat zadání pro překladač (JSON)</button>
    <button class="import" type="button">Importovat překlad…</button>
    <button class="dl primary" type="button">Stáhnout soubor</button>
    <button class="preview primary" type="button">Náhled v tabulce</button>`;
  el.appendChild(tools);

  // --- editor ---
  const editor = div('i18ns-editor');
  el.appendChild(editor);

  // --- náhledová tabulka ---
  const previewWrap = div('i18ns-preview');
  previewWrap.innerHTML = '<div class="i18ns-plabel">Náhled — stiskni „Náhled v tabulce" po přeložení:</div>';
  const gridEl = div('');
  previewWrap.appendChild(gridEl);
  el.appendChild(previewWrap);

  const preview = new Lattice(gridEl, {
    i18n: ctx.lang, id: 'ex-i18n', columns: campaignColumns(), data: ctx.data.slice(0, 12),
    pageSize: 5, selectable: true,
    instance: { filterLayout: 'header', summaryRow: 'page' },
  });

  /* ---- render editoru ---- */
  const inputs = new Map(); // path -> input el
  function renderEditor(filter = '') {
    editor.innerHTML = '';
    inputs.clear();
    const q = filter.trim().toLowerCase();
    let section = null, body = null;
    for (const e of entries) {
      if (q && !e.path.toLowerCase().includes(q) && !srcStr(e).toLowerCase().includes(q)) continue;
      const top = e.path.split('.')[0];
      if (top !== section) {
        section = top;
        const h = div('i18ns-sec');
        h.textContent = top;
        editor.appendChild(h);
        body = div('i18ns-rows');
        editor.appendChild(body);
      }
      body.appendChild(rowFor(e));
    }
    updateProgress();
  }

  function srcStr(e) { return e.kind === 'array' ? e.source.join(' | ') : e.source; }

  function rowFor(e) {
    const row = div('i18ns-row');
    const meta = div('i18ns-meta');
    meta.innerHTML = `<code>${e.path}</code>${e.kind === 'array' ? '<span class="i18ns-arr">pole ' + e.source.length + '×, odděl „ | "</span>' : ''}`;
    const src = div('i18ns-src');
    src.textContent = srcStr(e);
    src.title = srcStr(e);

    const inp = document.createElement(e.kind === 'array' || srcStr(e).length > 40 ? 'textarea' : 'input');
    inp.className = 'i18ns-inp';
    inp.value = targets.get(e.path) || '';
    inp.placeholder = srcStr(e);
    if (inp.tagName === 'TEXTAREA') inp.rows = 1;
    inp.addEventListener('input', () => {
      targets.set(e.path, inp.value);
      markRow(row, e, inp.value);
      updateProgress();
    });
    inputs.set(e.path, inp);

    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'i18ns-eq'; copy.title = 'Zkopírovat zdroj'; copy.textContent = '⧉';
    copy.addEventListener('click', () => { inp.value = srcStr(e); targets.set(e.path, inp.value); markRow(row, e, inp.value); updateProgress(); });

    const right = div('i18ns-right');
    right.append(inp, copy);
    row.append(meta, src, right);
    markRow(row, e, inp.value);
    return row;
  }

  // Zvýrazní chybějící placeholder (např. {n}) v překladu vůči zdroji.
  function markRow(row, e, val) {
    row.classList.toggle('is-filled', !!val.trim());
    const bad = !!val.trim() && placeholders(e.source) !== placeholders(val);
    row.classList.toggle('is-badph', bad);
  }

  function updateProgress() {
    const total = entries.length;
    let filled = 0, bad = 0;
    for (const e of entries) {
      const v = (targets.get(e.path) || '').trim();
      if (v) filled++;
      if (v && placeholders(e.source) !== placeholders(v)) bad++;
    }
    const pct = total ? Math.round((filled / total) * 100) : 0;
    bar.querySelector('.prog').innerHTML =
      `přeloženo <b>${filled}/${total}</b> (${pct} %)` + (bad ? ` · <span class="warn">${bad}× nesouhlasí placeholder</span>` : '');
  }

  /* ---- sestavení cílového slovníku (prázdné → zdroj, aby byl soubor kompletní) ---- */
  function buildDict() {
    const map = {};
    for (const e of entries) {
      const raw = (targets.get(e.path) || '').trim() || srcStr(e);
      map[e.path] = e.kind === 'array' ? raw.split('|').map((s) => s.trim()) : raw;
    }
    return unflatten(map, entries);
  }

  /* ---- akce ---- */
  bar.querySelector('.base').addEventListener('change', (ev) => {
    baseCode = ev.target.value;
    entries = flatten(BASES[baseCode]);
    renderEditor(bar.querySelector('.search').value);
  });
  bar.querySelector('.search').addEventListener('input', (ev) => renderEditor(ev.target.value));

  tools.querySelector('.fillsrc').addEventListener('click', () => {
    for (const e of entries) if (!(targets.get(e.path) || '').trim()) targets.set(e.path, srcStr(e));
    renderEditor(bar.querySelector('.search').value);
  });

  tools.querySelector('.task').addEventListener('click', async () => {
    const only = entries.filter((e) => !(targets.get(e.path) || '').trim());
    const list = (only.length ? only : entries);
    const payload = {};
    for (const e of list) payload[e.path] = srcStr(e);
    const name = bar.querySelector('.name').value || bar.querySelector('.code').value;
    const text =
      `Přelož hodnoty do jazyka: ${name}. Zachovej klíče i zástupné symboly ve složených závorkách (např. {n}, {from}). ` +
      `U hodnot s „ | " jde o seznam položek – přelož každou. Vrať POUZE stejný JSON s přeloženými hodnotami:\n\n` +
      JSON.stringify(payload, null, 2);
    try { await navigator.clipboard.writeText(text); flash(tools.querySelector('.task'), 'Zkopírováno ✓'); }
    catch { downloadText((bar.querySelector('.code').value || 'lang') + '-task.json', text); }
  });

  tools.querySelector('.import').addEventListener('click', () => openImport(async (text, isJs) => {
    let obj;
    if (isJs) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      try { obj = (await import(/* @vite-ignore */ url)).default; } finally { URL.revokeObjectURL(url); }
    } else {
      obj = JSON.parse(text);
    }
    const flatMap = looksFlat(obj) ? obj : Object.fromEntries(flatten(obj).map((e) => [e.path, e.kind === 'array' ? e.source.join(' | ') : e.source]));
    let n = 0;
    for (const e of entries) {
      if (e.path in flatMap && flatMap[e.path] != null) {
        const v = flatMap[e.path];
        targets.set(e.path, Array.isArray(v) ? v.join(' | ') : String(v));
        n++;
      }
    }
    renderEditor(bar.querySelector('.search').value);
    return n;
  }));

  tools.querySelector('.dl').addEventListener('click', () => {
    const code = (bar.querySelector('.code').value || 'lang').trim().replace(/[^\w-]/g, '');
    downloadText(code + '.js', toModule(buildDict()));
  });

  tools.querySelector('.preview').addEventListener('click', () => {
    preview.setLanguage(buildDict()); // I18n.setLang přijímá i objekt slovníku
    flash(tools.querySelector('.preview'), 'Aplikováno ✓');
  });

  renderEditor();
  return preview; // app.js si ji drží kvůli destroy() při přepnutí příkladu
}

/* ---- import dialog (jednoduchý, bez modálních alertů) ---- */
function openImport(onLoad) {
  const wrap = div('i18ns-modal');
  wrap.innerHTML = `
    <div class="i18ns-modal-box">
      <div class="i18ns-modal-h">Importovat překlad</div>
      <p>Vlož JSON <code>{"cesta.klic":"překlad"}</code> nebo obsah dřívějšího <code>.js</code> slovníku, nebo vyber soubor.</p>
      <input type="file" accept=".js,.json,application/json,text/javascript">
      <textarea rows="8" placeholder='{ "filters.all": "Alle", "pagination.next": "›" }'></textarea>
      <div class="i18ns-modal-msg"></div>
      <div class="i18ns-modal-btns">
        <button class="cancel" type="button">Zavřít</button>
        <button class="ok primary" type="button">Načíst</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const msg = wrap.querySelector('.i18ns-modal-msg');
  const ta = wrap.querySelector('textarea');
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.cancel').addEventListener('click', close);
  wrap.querySelector('input[type=file]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ta.value = await f.text(); ta.dataset.js = f.name.endsWith('.js') ? '1' : '';
  });
  wrap.querySelector('.ok').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { msg.textContent = 'Nic k načtení.'; return; }
    const isJs = ta.dataset.js === '1' || /export\s+default/.test(text);
    try {
      const n = await onLoad(text, isJs);
      msg.textContent = `Naimportováno ${n} hodnot.`;
      setTimeout(close, 700);
    } catch (err) { msg.textContent = 'Chyba: ' + err.message; }
  });
}

function looksFlat(o) { return o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).some((k) => k.includes('.')); }

/* ---- utils ---- */
function div(cls) { const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function flash(btn, txt) {
  const old = btn.textContent; btn.textContent = txt; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1000);
}

function styleTag() {
  const s = document.createElement('style');
  s.textContent = `
  .i18ns-bar,.i18ns-tools{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-bottom:10px;font-size:13px}
  .i18ns-bar label{color:#55606f}
  .i18ns-bar select,.i18ns-bar input,.i18ns-modal input,.i18ns-modal textarea{padding:5px 8px;border:1px solid #cfd5dd;border-radius:6px;font:inherit;font-size:13px}
  .i18ns-bar .search{flex:1;min-width:160px}
  .i18ns-bar .prog{color:#55606f}.i18ns-bar .prog b{color:#1f2733}.i18ns-bar .warn{color:#c2410c}
  .i18ns-tools button,.i18ns-modal button{padding:6px 12px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer;font:inherit;font-size:13px}
  .i18ns-tools button.primary,.i18ns-modal button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .i18ns-tools button:hover{background:#f1f3f6}.i18ns-tools button.primary:hover{background:#1d4ed8}
  .i18ns-editor{max-height:46vh;overflow:auto;border:1px solid #e3e7ee;border-radius:8px;margin-bottom:16px}
  .i18ns-sec{position:sticky;top:0;background:#eef1f5;color:#1f2733;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;padding:6px 12px;border-bottom:1px solid #e3e7ee;z-index:1}
  .i18ns-row{display:grid;grid-template-columns:230px 1fr 1fr;gap:10px;align-items:start;padding:6px 12px;border-bottom:1px solid #f0f2f6}
  .i18ns-row:hover{background:#fafbfc}
  .i18ns-meta code{font-size:11px;color:#6b7583;word-break:break-all}
  .i18ns-arr{display:block;font-size:11px;color:#9aa4b2}
  .i18ns-src{color:#1f2733;font-size:13px;white-space:pre-wrap;word-break:break-word;padding-top:3px}
  .i18ns-right{display:flex;gap:6px;align-items:start}
  .i18ns-inp{flex:1;min-width:0;padding:5px 8px;border:1px solid #cfd5dd;border-radius:6px;font:inherit;font-size:13px;resize:vertical}
  .i18ns-row.is-filled .i18ns-inp{border-color:#86c397;background:#f6fbf7}
  .i18ns-row.is-badph .i18ns-inp{border-color:#e0a458;background:#fff8ee}
  .i18ns-eq{flex:0 0 auto;width:28px;padding:0;border:1px solid #cfd5dd;border-radius:6px;background:#fff;cursor:pointer}
  .i18ns-eq:hover{background:#eef1f5}
  .i18ns-plabel{font-size:12px;color:#6b7583;margin-bottom:6px}
  .i18ns-modal{position:fixed;inset:0;background:rgba(15,20,28,.45);display:flex;align-items:center;justify-content:center;z-index:2000}
  .i18ns-modal-box{background:#fff;border-radius:10px;padding:18px 20px;max-width:560px;width:92%;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  .i18ns-modal-h{font-size:16px;font-weight:700;margin-bottom:6px}
  .i18ns-modal-box p{color:#55606f;font-size:13px;margin:0 0 10px}
  .i18ns-modal textarea{width:100%;font-family:ui-monospace,Menlo,Consolas,monospace}
  .i18ns-modal input[type=file]{display:block;margin-bottom:8px}
  .i18ns-modal-msg{color:#2563eb;font-size:13px;min-height:18px;margin:6px 0}
  .i18ns-modal-btns{display:flex;justify-content:flex-end;gap:8px}
  @media(max-width:760px){.i18ns-row{grid-template-columns:1fr}}
  `;
  return s;
}
