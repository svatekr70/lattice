/**
 * fileImport — načtení a rozparsování souboru (CSV / JSON) do pole objektů.
 * Bez závislostí; XLSX se záměrně neřeší (vyžadoval by knihovnu). Parsery jsou
 * čisté funkce (testovatelné v Node), `parseFile` používá prohlížečový FileReader.
 */

/**
 * Rozparsuje CSV text na pole objektů (první řádek = hlavička).
 * Zvládá uvozovky, escapované "" uvnitř, oddělovač , ; nebo tab (autodetekce).
 * @param {string} text
 * @param {object} [opts] { delimiter }
 */
export function parseCSV(text, opts = {}) {
  const delim = opts.delimiter || sniffDelimiter(text);
  const grid = parseGrid(String(text), delim);
  if (!grid.length) return [];
  const header = grid[0].map((h, i) => String(h).trim() || 'col' + (i + 1));
  const out = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.length === 1 && cells[0] === '') continue; // prázdný řádek
    const obj = {};
    header.forEach((h, j) => { obj[h] = coerce(cells[j]); });
    out.push(obj);
  }
  return out;
}

/** Rozparsuje JSON text na pole objektů (přijme pole, {data:[…]} i jeden objekt). */
export function parseJSON(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && typeof data === 'object') return [data];
  return [];
}

/**
 * Načte lokální File (z <input type=file> nebo drag&drop) a rozparsuje dle
 * přípony / obsahu. Vrací { rows, format }.
 * @param {File} file
 * @returns {Promise<{rows: object[], format: 'csv'|'json'}>}
 */
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.xml') || (!name.endsWith('.csv') && !name.endsWith('.json') && /^\s*<(\?xml|feed|rss|[a-z])/i.test(text))) {
          resolve({ rows: parseXML(text).rows, format: 'xml' });
        } else if (name.endsWith('.json') || (!name.endsWith('.csv') && /^\s*[[{]/.test(text))) {
          resolve({ rows: parseJSON(text), format: 'json' });
        } else {
          resolve({ rows: parseCSV(text), format: 'csv' });
        }
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Vytáhne řádky z HTML `<table>` elementu. Hlavička = první řádek s `<th>`
 * (jinak první řádek); field = slug názvu, title = původní text hlavičky.
 * @param {HTMLTableElement} table
 * @returns {{ rows: object[], fields: string[], titles: object }}
 */
export function tableToRows(table) {
  const trs = Array.from(table.rows || []);
  if (!trs.length) return { rows: [], fields: [], titles: {} };
  let headerIdx = trs.findIndex((r) => r.querySelector && r.querySelector('th'));
  if (headerIdx === -1) headerIdx = 0;
  const headCells = Array.from(trs[headerIdx].cells);
  const fields = [];
  const titles = {};
  const used = new Set();
  headCells.forEach((c, i) => {
    const text = (c.textContent || '').trim();
    let f = slug(text) || 'col' + (i + 1);
    while (used.has(f)) f += '_' + i; // zaruč unikátnost
    used.add(f);
    fields.push(f);
    titles[f] = text || 'Sloupec ' + (i + 1);
  });

  const rows = [];
  for (let i = headerIdx + 1; i < trs.length; i++) {
    const cells = Array.from(trs[i].cells);
    if (!cells.length) continue;
    const obj = {};
    fields.forEach((f, j) => { obj[f] = coerce(cells[j] ? (cells[j].textContent || '').trim() : ''); });
    rows.push(obj);
  }
  return { rows, fields, titles };
}

/**
 * Rozparsuje HTML (string) a vrátí data z N-té `<table>` na stránce.
 * Vyžaduje DOMParser (prohlížeč).
 * @param {string} html
 * @param {number} [index=0]  pořadí tabulky na stránce (0 = první)
 */
export function parseHTMLTable(html, index = 0) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const tables = doc.querySelectorAll('table');
  const table = tables[index];
  if (!table) throw new Error(`Tabulka #${index} nenalezena (na stránce je ${tables.length}).`);
  return tableToRows(table);
}

/**
 * Rozparsuje XML (string) na pole objektů. Automaticky najde opakující se
 * „záznamový" element (ATOM `entry`, RSS `item`, obecně nejčastější element
 * s dětmi) a z jeho dětských elementů/atributů udělá pole. Vyžaduje DOMParser.
 * @param {string} text
 * @param {object} [opts] { record } — vynutit název záznamového elementu.
 * @returns {{ rows: object[], fields: string[], titles: object }}
 */
export function parseXML(text, opts = {}) {
  const doc = new DOMParser().parseFromString(String(text), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Neplatné XML.');
  const records = pickRecords(doc, opts.record);
  if (!records.length) return { rows: [], fields: [], titles: {} };

  const fields = [];
  const titles = {};
  const seen = new Set();
  const addField = (f, title) => { if (!seen.has(f)) { seen.add(f); fields.push(f); titles[f] = title; } };

  const rows = records.map((rec) => {
    const obj = {};
    for (const a of Array.from(rec.attributes || [])) {
      const f = '@' + a.name; addField(f, a.name); obj[f] = coerce(a.value);
    }
    for (const c of Array.from(rec.children || [])) {
      const f = c.localName || c.nodeName;
      const val = c.childElementCount > 0
        ? (c.textContent || '').trim()
        : ((c.textContent || '').trim() || attrValue(c));
      if (f in obj) obj[f] = obj[f] + '; ' + val; // opakovaný element (např. víc <link>)
      else { addField(f, humanizeTag(f)); obj[f] = coerce(val); }
    }
    return obj;
  });
  return { rows, fields, titles };
}

/** Vybere množinu záznamových elementů (override, nebo nejčastější element s dětmi). */
function pickRecords(doc, override) {
  const all = Array.from(doc.getElementsByTagName('*'));
  if (override) return all.filter((el) => (el.localName || el.nodeName) === override);
  const tally = new Map();
  for (const el of all) {
    if (el.childElementCount > 0) {
      const n = el.localName || el.nodeName;
      tally.set(n, (tally.get(n) || 0) + 1);
    }
  }
  let best = null, bestCount = 1;
  for (const [n, c] of tally) if (c > bestCount) { bestCount = c; best = n; }
  if (best) return all.filter((el) => (el.localName || el.nodeName) === best);
  const root = doc.documentElement;
  return root ? Array.from(root.children) : []; // fallback: přímé děti kořene
}

function attrValue(el) {
  return el.getAttribute('href') || el.getAttribute('value') || (el.attributes[0] && el.attributes[0].value) || '';
}
function humanizeTag(n) {
  return String(n).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().replace(/^./, (c) => c.toUpperCase());
}

/** field slug z názvu hlavičky (diakritika pryč, mezery → _). */
function slug(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/* ---------------- interní ---------------- */

/** Rozseká CSV na 2D pole buněk (stavový automat kvůli uvozovkám a newline). */
function parseGrid(text, delim) {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQuotes = false, started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    started = true;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (started && (field !== '' || row.length)) { row.push(field); rows.push(row); }
  return rows;
}

/** Odhad oddělovače z prvního řádku (preferuje , ; tab). */
function sniffDelimiter(text) {
  const nl = text.indexOf('\n');
  const line = nl >= 0 ? text.slice(0, nl) : text;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
}

/** Buňku převede na number/boolean, když je to bezpečné (round-trip), jinak string. */
function coerce(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (s === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(s) && String(Number(s)) === s) return Number(s);
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  return s;
}
