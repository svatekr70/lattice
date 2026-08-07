/**
 * Minimalistické DOM helpery. Žádná knihovna — jen ať se neopakuje
 * document.createElement boilerplate.
 */

/**
 * Vytvoří element.
 * @param {string} tag         Např. 'div' nebo 'div.lattice-cell' (tag.class.class).
 * @param {object} [props]     Vlastnosti/atributy. Speciální klíče:
 *        `class`/`className` (string), `style` (objekt), `dataset` (objekt),
 *        `on` (objekt event→handler), `text` (textContent), `html` (innerHTML).
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = {}, children) {
  let tagName = tag;
  let classes = [];
  const dotIdx = tag.indexOf('.');
  if (dotIdx !== -1) {
    tagName = tag.slice(0, dotIdx) || 'div';
    classes = tag.slice(dotIdx + 1).split('.').filter(Boolean);
  }
  const node = document.createElement(tagName);
  if (classes.length) node.classList.add(...classes);

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class' || k === 'className') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (k === 'on' && typeof v === 'object') {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    } else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k in node) {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else node.setAttribute(k, v);
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  if (children == null) return node;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

/** Odebere všechny potomky. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Zavře na kliknutí mimo `node` (a na Escape). Vrátí odpojovací funkci. */
export function onOutside(node, cb) {
  const onDown = (e) => { if (!node.contains(e.target)) cb(e); };
  const onKey = (e) => { if (e.key === 'Escape') cb(e); };
  // setTimeout: neodpálit hned na tomtéž kliknutí, které panel otevřelo.
  // Když se odpojí dřív, než timer stihne navázat, timer zrušíme — jinak by se
  // listener navázal „naprázdno" (s odkazem na už odpojený node) a leakoval.
  let armed = false;
  const id = setTimeout(() => {
    armed = true;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return () => {
    clearTimeout(id);
    if (!armed) return;
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

/** Jednoduchý debounce. */
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Escapuje řetězec pro použití v CSS selektoru (např. data-field s uvozovkami/tečkou). */
export function cssEscape(s) {
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
