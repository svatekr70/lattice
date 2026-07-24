/**
 * Barevná škála (semafor) pro podmíněné formátování. Tři kotevní barvy
 * low → mid → high (výchozí červená/žlutá/zelená); mezilehlé hladiny se
 * interpolují. Sdílené mezi vykreslením buňky a náhledem v UI.
 */

export const DEFAULT_SCALE_COLORS = ['#e5534b', '#f2c037', '#42a05a']; // low, mid, high

function hex2rgb(h) {
  let s = String(h || '').replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function lum(r) { return (0.299 * r[0] + 0.587 * r[1] + 0.114 * r[2]) / 255; }
function css(r) { return `rgb(${Math.round(r[0])}, ${Math.round(r[1])}, ${Math.round(r[2])})`; }

/** Barva ve zlomku f∈[0,1] přes tři kotvy (low→mid→high). */
function anchorAt(anchors, f) {
  if (f <= 0.5) return mix(anchors[0], anchors[1], f / 0.5);
  return mix(anchors[1], anchors[2], (f - 0.5) / 0.5);
}

/** Zařadí hodnotu do hladiny 0..levels-1 dle vzestupných prahů. */
export function levelIndex(value, thresholds) {
  let idx = 0;
  for (const t of thresholds) if (value >= t) idx++;
  return idx;
}

/**
 * Barva hladiny `i` (z `levels`) dle režimu:
 *   'text' → { text } (čitelná, případně ztmavená)
 *   jiné   → { bg, fg } (světlá výplň + kontrastní text)
 */
export function levelColor(colors, i, levels, reverse, mode) {
  const anchors = (Array.isArray(colors) && colors.length === 3 ? colors : DEFAULT_SCALE_COLORS).map(hex2rgb);
  let f = levels > 1 ? i / (levels - 1) : 0;
  if (reverse) f = 1 - f;
  const c = anchorAt(anchors, f);          // PŘESNĚ zvolená barva (u kotev), mezi nimi interpolace
  const color = css(c);
  // 'text' → obarví číslo přesně zvolenou barvou; jinak výplň pozadí + kontrastní text.
  if (mode === 'text') return { text: color };
  return { bg: color, fg: lum(c) < 0.55 ? '#ffffff' : '#1f2733' };
}
