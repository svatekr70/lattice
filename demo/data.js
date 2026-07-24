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

export function generateCampaigns(count = 240) {
  const rnd = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const created = new Date(2025, 0, 1 + Math.floor(rnd() * 540));
    const starts = new Date(created.getTime() + Math.floor(rnd() * 60) * 86400000);
    const category = pick(CATEGORIES);
    const status = pick(STATUSES);
    const color = pick(COLORS);
    rows.push({
      id: i,
      name: `Kampaň ${category} #${i}`,
      // link — hodnota se poskládá s urlPrefix v konfiguraci sloupce
      web: `kampan/${i}`,
      category,
      icon: category, // typ icon mapuje kategorii → emoji (CATEGORY_ICONS)
      owner: pick(OWNERS),
      region: pick(REGIONS),
      budget: Math.floor(5000 + rnd() * 495000),
      score: Math.round(rnd() * 100),
      progress: Math.round(rnd() * 100),
      rating: Math.round(rnd() * 5),
      color, // typ color
      // image: střídavě data: URI (SVG avatar) a http URL (obé musí fungovat)
      image: i % 2 === 0 ? svgAvatar(color, i) : `https://picsum.photos/seed/lat${i}/120/120`,
      verified: rnd() > 0.45, // typ tick
      label: htmlBadge(status, STATUS_COLORS[status]), // typ html
      createdAt: iso(created),
      startsAt: iso(starts),
      status,
      active: rnd() > 0.4,
    });
  }
  return rows;
}

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const OPTIONS = {
  categories: CATEGORIES.map((c) => ({ value: c, label: c })),
  owners: OWNERS.map((o) => ({ value: o, label: o })),
  statuses: STATUSES.map((s) => ({ value: s, label: s })),
  regions: REGIONS.map((r) => ({ value: r, label: r })),
};
