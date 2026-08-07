/**
 * exporter — export dat gridu do CSV / TSV / JSON / XML / Excel (bez závislostí).
 * „Excel" = SpreadsheetML 2003 (XML), který Excel/LibreOffice otevřou přímo bez
 * ZIP knihovny. PDF se neřeší. Formátovací funkce jsou čisté (testovatelné);
 * `downloadFile` používá prohlížeč (Blob + odkaz).
 */
import { cellValue } from './cellValue.js';

/** Escapuje hodnotu pro oddělovačový formát (uvozovky když je třeba). */
function esc(value, delim) {
  let s = value == null ? '' : String(value);
  // Ochrana proti CSV/formula-injection: buňka začínající =,+,-,@ se v Excelu/Calcu
  // vyhodnotí jako vzorec (např. =HYPERLINK(), =cmd|…, -2+3+cmd|…). Neutralizujeme
  // prefixem apostrofu — ale jen když CELÁ hodnota není validní číslo (aby „-5"
  // zůstalo číslem, zatímco „-2+3" i „-5abc" se ošetří).
  if (/^[=+\-@]/.test(s) && !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) s = "'" + s;
  if (s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Řádky do oddělovačového textu (CSV/TSV). `cols` = [{ field, title }].
 * @param {object} [opts] { delimiter=',', header=true }
 */
export function toDelimited(rows, cols, opts = {}) {
  const delim = opts.delimiter || ',';
  const lines = [];
  if (opts.header !== false) lines.push(cols.map((c) => esc(c.title, delim)).join(delim));
  for (const r of rows) lines.push(cols.map((c) => esc(cellValue(r, c), delim)).join(delim));
  return lines.join('\n');
}

/** Řádky do JSON (jen vybraná pole v pořadí sloupců). */
export function toJSON(rows, cols) {
  return JSON.stringify(rows.map((r) => {
    const o = {};
    for (const c of cols) o[c.field] = cellValue(r, c);
    return o;
  }), null, 2);
}

/** Řádky do XML (<data><row><field>…</field></row></data>). */
export function toXML(rows, cols) {
  const xe = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tag = (f) => String(f).replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[^a-zA-Z_]/, '_');
  const body = rows.map((r) =>
    '  <row>' + cols.map((c) => { const t = tag(c.field); return `<${t}>${xe(cellValue(r, c))}</${t}>`; }).join('') + '</row>'
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<data>\n' + body + '\n</data>';
}

/**
 * Řádky do SpreadsheetML 2003 (XML tabulka pro Excel/LibreOffice). Bez ZIP,
 * bez závislostí — Excel to otevře přímo. Čísla se pošlou jako Number (dají se
 * sčítat), ostatní jako String. Vhodné pro běžné exporty; ne pro velké sešity.
 */
export function toExcelXML(rows, cols, opts = {}) {
  const xe = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = (c) => c.type === 'number' || c.type === 'money' || c.type === 'progress' || c.type === 'rating';
  const cell = (v, numeric) => {
    if (numeric && v != null && v !== '' && Number.isFinite(Number(v))) {
      return `<Cell><Data ss:Type="Number">${Number(v)}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  };
  const head = '<Row>' + cols.map((c) => `<Cell><Data ss:Type="String">${xe(c.title)}</Data></Cell>`).join('') + '</Row>';
  const body = rows.map((r) =>
    '<Row>' + cols.map((c) => cell(cellValue(r, c), isNum(c))).join('') + '</Row>'
  ).join('');
  const name = xe(opts.sheetName || 'List1');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<?mso-application progid="Excel.Sheet"?>\n'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
    + `<Worksheet ss:Name="${name}"><Table>${head}${body}</Table></Worksheet>\n`
    + '</Workbook>';
}

/** Sestaví obsah dle formátu ('csv'|'tsv'|'json'|'xml'|'excel'). */
export function buildExport(format, rows, cols, opts = {}) {
  const f = String(format || 'csv').toLowerCase();
  if (f === 'json') return toJSON(rows, cols);
  if (f === 'xml') return toXML(rows, cols);
  if (f === 'excel' || f === 'xls') return toExcelXML(rows, cols, opts);
  const delimiter = opts.delimiter || (f === 'tsv' ? '\t' : ',');
  return toDelimited(rows, cols, { delimiter, header: opts.header });
}

export const EXPORT_META = {
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  tsv: { ext: 'tsv', mime: 'text/tab-separated-values;charset=utf-8' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8' },
  xml: { ext: 'xml', mime: 'application/xml;charset=utf-8' },
  excel: { ext: 'xls', mime: 'application/vnd.ms-excel;charset=utf-8' },
};

/** Stáhne obsah jako soubor (prohlížeč). */
export function downloadFile(content, filename, mime) {
  const blob = new Blob(['﻿' + content], { type: mime || 'text/plain;charset=utf-8' }); // BOM kvůli diakritice v Excelu
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
