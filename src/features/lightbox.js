/**
 * Jednoduchý lightbox pro obrázky — bez závislosti. Klik na náhled otevře
 * překryv s větším obrázkem; zavírá se klikem mimo, na křížek nebo Escape.
 */
import { el } from '../util/dom.js';

export function openLightbox(src, alt) {
  const img = el('img.lattice-lightbox-img', { src, alt: alt || '' });
  img.addEventListener('click', (e) => e.stopPropagation()); // klik na obrázek nezavírá

  const closeBtn = el('button.lattice-lightbox-close', { type: 'button', text: '×', title: 'Zavřít' });

  const overlay = el('div.lattice-lightbox', {}, [img, closeBtn]);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  return close;
}
