/**
 * Lattice — veřejné API.
 *
 * Základní použití:
 *   import { Lattice } from 'lattice';
 *   import 'lattice/css';
 *   new Lattice('#grid', { id, columns, data });
 *
 * Rozšiřování bez zásahu do jádra:
 *   registerType('myType', formatterFn)
 *   registerFilter('myFilter', { build, isEmpty, match, toServer })
 */
export { Lattice } from './Lattice.js';
export { registerType, getFormatter } from './types/columnTypes.js';
export { registerFilter, getFilter } from './filters/index.js';
export { I18n, registerLanguage, availableLanguages } from './i18n/index.js';
export { Store } from './core/Store.js';
export { buildColumns, serializeColumns } from './core/ColumnModel.js';
export { ClientData, ServerData, encodeParams } from './core/DataSource.js';

/** Verze knihovny (odpovídá package.json). */
export const VERSION = '0.3.0';
