/**
 * Vygeneruje `src/releases.js` z CHANGELOG.md — seznam vydání pro záložku
 * „O Lattice" v nastavení tabulky (verze, datum, jednořádkové shrnutí).
 *
 * Spouští se ručně před vydáním:  npm run releases
 * Bere nadpis `## [x.y.z] – YYYY-MM-DD` a první odstavec pod ním.
 */
import { readFile, writeFile } from 'node:fs/promises';

const MAX = 20;          // kolik posledních vydání ponést v bundlu
const MAX_CHARS = 260;   // délka shrnutí (delší se ořízne na hranici věty/slova)
const MAX_ITEMS = 12;    // kolik odrážek z vydání ponést (rozbalí se v UI)

const md = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const blocks = md.split(/\n(?=## \[)/).filter((b) => b.startsWith('## ['));

const releases = [];
for (const block of blocks.slice(0, MAX)) {
  const head = block.match(/^## \[([^\]]+)\]\s*[–-]\s*(\S+)/);
  if (!head) continue;
  const body = block.slice(block.indexOf('\n') + 1);
  const plain = (x) => x.replace(/\s+/g, ' ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
  // 1) úvodní odstavec pod nadpisem verze (novější vydání ho mají)
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('-')) || '';
  // 2) starší vydání jdou rovnou na odrážky → shrnutí složíme z jejich úvodních vět
  const bullets = [...body.matchAll(/^- (.+(?:\n {2,}.+)*)/gm)]
    .map((m) => plain(m[1]))
    .map((x) => { const dot = x.indexOf('. '); return dot > 20 ? x.slice(0, dot) : x; });
  let text = para ? plain(para) : bullets.join(' · ');
  if (text.length > MAX_CHARS) {
    const cut = text.slice(0, MAX_CHARS);
    text = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '…';
  }
  // Body vydání (odrážky první úrovně) — v UI se rozbalí pod shrnutím.
  const items = [...body.matchAll(/^- (.+(?:\n {2,}.+)*)/gm)]
    .map((m) => plain(m[1]))
    .map((x) => (x.length > 200 ? x.slice(0, 199).replace(/\s+\S*$/, '') + '…' : x))
    .slice(0, MAX_ITEMS);

  releases.push({ version: head[1], date: head[2], text, items });
}

const out = `/**
 * Seznam vydání pro záložku „O Lattice" (nastavení tabulky).
 * GENEROVÁNO z CHANGELOG.md — needituj ručně, spusť \`npm run releases\`.
 */
export const RELEASES = ${JSON.stringify(releases, null, 2)};
`;
await writeFile(new URL('../src/releases.js', import.meta.url), out, 'utf8');
console.log(`releases: ${releases.length} vydání → src/releases.js`);
