/**
 * Ukázková data pro demo — deterministický generátor (seedovaný PRNG), ať jsou
 * data stabilní přes reloady (důležité pro testování persistence a frozen).
 * Sdílené mezi client-side demem (browser) i mock serverem (Node).
 */

const CATEGORIES = ['Email', 'PPC', 'Sociální sítě', 'Bannery', 'Newsletter', 'Event'];
const OWNERS = ['Nováková', 'Svoboda', 'Dvořák', 'Procházková', 'Kučera', 'Veselá'];
const STATUSES = ['Plánováno', 'Běží', 'Pozastaveno', 'Dokončeno'];
const REGIONS = ['Praha', 'Brno', 'Ostrava', 'Plzeň', 'Online'];
const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
// emoji per kategorie (pro typ 'icon' přes mapování hodnota→ikona)
export const CATEGORY_ICONS = { Email: '✉️', PPC: '💰', 'Sociální sítě': '📣', Bannery: '🖼️', Newsletter: '📰', Event: '🎪' };
const STATUS_COLORS = { 'Plánováno': '#64748b', 'Běží': '#16a34a', 'Pozastaveno': '#f59e0b', 'Dokončeno': '#2563eb' };

/** Barevný SVG avatar jako data: URI (ukázka image ve formátu Data:). */
function svgAvatar(color, n) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>` +
    `<rect width='64' height='64' rx='10' fill='${color}'/>` +
    `<text x='32' y='42' font-size='26' fill='white' text-anchor='middle' font-family='sans-serif'>${n}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
/** HTML štítek (ukázka typu 'html'). */
function htmlBadge(text, color) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:${color};color:#fff;font-size:11px;font-weight:600">${text}</span>`;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trajektorie 0–100 pro sparkline (náhodná procházka, ať to „vypadá jako trend"). */
function seriesTrend(rnd, n = 12) {
  const out = [];
  let v = 20 + rnd() * 60;
  for (let i = 0; i < n; i++) { v = Math.max(2, Math.min(100, v + (rnd() - 0.45) * 26)); out.push(Math.round(v)); }
  return out;
}

/**
 * Sjednocený „kitchen-sink" dataset kampaní. Kryje VŠECHNY datové typy i featury:
 *  - hierarchie: prvních 6 řádků jsou PROGRAMY (parentId=null), zbytek jsou
 *    kampaně s parentId = program své kategorie → stejná data slouží ploché
 *    tabulce, seskupení řádků i STROMOVÉMU zobrazení (treeParentField:'parentId').
 *  - typy: id, text, link, icon, image, color, money, number, progress, rating,
 *    tick, boolean, html, date, datetime a sparkline (pole `trend`/`weekly`).
 *  - `kind` (Program/Kampaň), `conversions`, `updatedAt` pro řazení i souhrny.
 */
export function generateCampaigns(count = 400) {
  const rnd = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let id = 0;

  const build = (category, parentId, kind) => {
    id++;
    const isProg = kind === 'Program';
    const created = new Date(2025, 0, 1 + Math.floor(rnd() * 540));
    const starts = new Date(created.getTime() + Math.floor(rnd() * 60) * 86400000);
    const updated = new Date(starts.getTime() + Math.floor(rnd() * 240) * 3600000);
    const status = isProg ? 'Běží' : pick(STATUSES);
    const color = pick(COLORS);
    return {
      id, parentId, kind,
      name: isProg ? `Program: ${category}` : `Kampaň ${category} #${id}`,
      web: `kampan/${id}`, // link — poskládá se s urlPrefix v konfiguraci sloupce
      category,
      icon: category, // typ icon mapuje kategorii → emoji (CATEGORY_ICONS)
      owner: pick(OWNERS),
      region: pick(REGIONS),
      budget: Math.floor((isProg ? 300000 : 5000) + rnd() * (isProg ? 900000 : 495000)),
      conversions: Math.floor(rnd() * (isProg ? 6000 : 900)),
      score: Math.round(rnd() * 100),
      progress: Math.round(rnd() * 100),
      rating: Math.round(rnd() * 5),
      color, // typ color
      // image: střídavě data: URI (SVG avatar) a http URL (obé musí fungovat)
      image: id % 2 === 0 ? svgAvatar(color, id) : `https://picsum.photos/seed/lat${id}/120/120`,
      verified: rnd() > 0.45, // typ tick
      label: htmlBadge(status, STATUS_COLORS[status]), // typ html
      createdAt: iso(created),
      startsAt: iso(starts),
      updatedAt: isoDateTime(updated), // typ datetime
      status,
      active: rnd() > 0.4,
      trend: seriesTrend(rnd, 12), // sparkline (čára)
      weekly: Array.from({ length: 7 }, () => Math.round(rnd() * 50)), // sparkline (sloupce)
    };
  };

  const rows = [];
  // 1) Programy — jeden rodič na kategorii (kořeny stromu).
  const programOf = {};
  for (const cat of CATEGORIES) { const r = build(cat, null, 'Program'); programOf[cat] = r.id; rows.push(r); }
  // 2) Kampaně — děti pod programem své kategorie.
  while (rows.length < count) { const cat = pick(CATEGORIES); rows.push(build(cat, programOf[cat], 'Kampaň')); }
  return rows;
}

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function isoDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${iso(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const OPTIONS = {
  categories: CATEGORIES.map((c) => ({ value: c, label: c })),
  owners: OWNERS.map((o) => ({ value: o, label: o })),
  statuses: STATUSES.map((s) => ({ value: s, label: s })),
  regions: REGIONS.map((r) => ({ value: r, label: r })),
};
