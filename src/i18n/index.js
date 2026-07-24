/**
 * i18n — lokalizace popisků.
 *
 * Slovník je vnořený objekt; klíče se hledají tečkovou cestou
 * (`t('pagination.next')`). Chybějící klíč v aktivním jazyce spadne na
 * angličtinu (default), a když ani tam není, vrátí se sám klíč (viditelné
 * v UI, snadno se dohledá).
 *
 * Jazyk se předává v configu jako `i18n: 'cs'` (vestavěný) nebo jako objekt
 * s vlastním slovníkem (částečný slovník se přeloží tam, kde klíče má, zbytek
 * padá na default).
 */
import cs from './cs.js';
import en from './en.js';

const BUILTIN = { cs, en };
const DEFAULT = en;

/**
 * Zaregistruje další jazyk pod kódem (např. 'de'), aby se dal používat jako
 * vestavěný přes `i18n: 'de'`. Stačí importovat slovník a jednou zavolat:
 *   import de from './i18n/de.js';
 *   registerLanguage('de', de);
 * @param {string} code  BCP-47 / krátký kód jazyka
 * @param {object} dict  slovník (stejná struktura jako en.js/cs.js)
 */
export function registerLanguage(code, dict) {
  if (code && dict && typeof dict === 'object') BUILTIN[code] = dict;
  return BUILTIN;
}

/** Kódy dostupných vestavěných jazyků. */
export function availableLanguages() {
  return Object.keys(BUILTIN);
}

export class I18n {
  /**
   * @param {string|object} lang  Kód vestavěného jazyka nebo vlastní slovník.
   */
  constructor(lang) {
    this.setLang(lang);
  }

  setLang(lang) {
    if (typeof lang === 'string') {
      this.lang = lang;
      this.dict = BUILTIN[lang] || DEFAULT;
    } else if (lang && typeof lang === 'object') {
      this.lang = lang.locale || lang.lang || undefined;
      this.dict = lang;
    } else {
      this.lang = undefined;
      this.dict = DEFAULT;
    }
  }

  /** BCP-47 kód pro locale-aware řazení (localeCompare). Může být undefined. */
  get locale() {
    return this.lang || undefined;
  }

  /** Vrátí pole ze slovníku (měsíce, dny…) — t() vrací jen stringy. Fallback na default. */
  list(path) {
    const walk = (obj) => {
      let cur = obj;
      for (const key of path.split('.')) { if (cur == null) return undefined; cur = cur[key]; }
      return Array.isArray(cur) ? cur : undefined;
    };
    return walk(this.dict) || walk(DEFAULT) || [];
  }

  /**
   * Přeloží tečkovou cestu. Volitelné `vars` nahradí {placeholder}y.
   * @param {string} path e.g. 'pagination.of'
   * @param {object} [vars]
   */
  t(path, vars) {
    let s = lookup(this.dict, path);
    if (s === undefined) s = lookup(DEFAULT, path);
    if (s === undefined) return path;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    }
    return s;
  }
}

function lookup(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}
