/**
 * printTable — vytiskne data tabulky. Sestaví jednoduchý HTML `<table>` z
 * viditelných sloupců a předaných řádků do skrytého iframe a spustí tisk.
 * Bez závislostí.
 */
import { cellValue } from '../core/cellValue.js';

export function printTable(title, cols, rows, opts = {}) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const thead = '<thead><tr>' + cols.map((c) => `<th>${esc(c.title)}</th>`).join('') + '</tr></thead>';
  const tbody = '<tbody>' + rows.map((r) =>
    '<tr>' + cols.map((c) => `<td>${esc(cellValue(r, c))}</td>`).join('') + '</tr>'
  ).join('') + '</tbody>';
  const style = opts.style || `
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
    th { background: #eee; }
    @media print { body { margin: 0; } }`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'tisk')}</title><style>${style}</style></head>` +
    `<body>${title ? `<h1>${esc(title)}</h1>` : ''}<table>${thead}${tbody}</table></body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const w = iframe.contentWindow;
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  w.onafterprint = cleanup;
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* no-op */ } if (!('onafterprint' in w)) cleanup(); }, 200);
}
