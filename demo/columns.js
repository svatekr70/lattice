/**
 * Znovupoužitelné definice sloupců pro demo příklady. Jeden zdroj pravdy, ať
 * jednotlivé ukázky (filtrování, seskupení, editace…) sdílejí stejná data.
 */
import { OPTIONS, CATEGORY_ICONS } from './data.js';

/** Plná sada sloupců kampaní se všemi datovými typy a filtry. */
export function campaignColumns() {
  return [
    { field: 'id',        title: 'ID',           type: 'number',   filter: 'number',       width: 80,  align: 'right' },
    { field: 'name',      title: 'Název',        type: 'text',     filter: 'text',         width: 210 },
    { field: 'web',       title: 'Odkaz',        type: 'link',     filter: 'text',         width: 130, formatterParams: { urlPrefix: 'https://lattice.dev/' } },
    { field: 'image',     title: 'Náhled',       type: 'image',    width: 80, align: 'center', formatterParams: { height: 34, lightbox: true, alt: 'Náhled kampaně' } },
    { field: 'icon',      title: 'Typ',          type: 'icon',     width: 70,  formatterParams: { icons: CATEGORY_ICONS, size: 18 } },
    { field: 'category',  title: 'Kategorie',    type: 'text',     filter: 'multiselect',  filterValues: OPTIONS.categories, width: 150 },
    { field: 'owner',     title: 'Vlastník',     type: 'text',     filter: 'select',       filterValues: OPTIONS.owners, width: 130 },
    { field: 'region',    title: 'Region',       type: 'text',     filter: 'select',       filterValues: OPTIONS.regions, width: 120 },
    { field: 'budget',    title: 'Rozpočet',     type: 'money',    filter: 'number-range', width: 150, formatterParams: { currency: 'CZK' } },
    { field: 'score',     title: 'Skóre',        type: 'number',   filter: 'number',       width: 100 },
    { field: 'progress',  title: 'Průběh',       type: 'progress', filter: 'number-range', width: 150, formatterParams: { showValue: true } },
    { field: 'rating',    title: 'Hodnocení',    type: 'rating',   filter: 'number',       width: 130, align: 'center' },
    { field: 'color',     title: 'Barva',        type: 'color',    width: 90 },
    { field: 'verified',  title: 'Ověřeno',      type: 'tick',     filter: 'boolean',      width: 100 },
    { field: 'label',     title: 'Štítek',       type: 'html',     width: 130 },
    { field: 'createdAt', title: 'Vytvořeno',    type: 'date',     filter: 'date-range',   width: 150 },
    { field: 'startsAt',  title: 'Start',        type: 'date',     filter: 'date-two',     width: 150 },
    { field: 'status',    title: 'Stav',         type: 'text',     filter: 'select',       filterValues: OPTIONS.statuses, width: 130 },
    { field: 'active',    title: 'Aktivní',      type: 'boolean',  filter: 'boolean',      width: 110, align: 'center' },
  ];
}

/**
 * „Kitchen-sink" sada se SKUPINAMI sloupců — pokrývá všechny datové typy i
 * featury (id, image+lightbox, link přes urlField, icon, sparkline čára i
 * sloupce, money, progress, rating, condFormat, date, datetime, tick, boolean,
 * html, color). Určeno pro showcase „Datové typy".
 */
export function showcaseColumns() {
  return [
    { title: 'Identifikace', columns: [
      { field: 'id',     title: 'ID',     type: 'id',    width: 64 },
      { field: 'image',  title: 'Náhled', type: 'image', width: 66, align: 'center', formatterParams: { height: 32, lightbox: true, alt: 'Náhled' } },
      { field: 'name',   title: 'Název',  type: 'link',  width: 200, filter: 'text', formatterParams: { urlPrefix: 'https://lattice.dev/', urlField: 'web' } },
      { field: 'icon',   title: 'Typ',    type: 'icon',  width: 60, formatterParams: { icons: CATEGORY_ICONS, size: 18 } },
    ] },
    { title: 'Zařazení', columns: [
      { field: 'category', title: 'Kategorie', type: 'text', width: 130, filter: 'multiselect', filterValues: OPTIONS.categories },
      { field: 'owner',    title: 'Vlastník',  type: 'text', width: 120, filter: 'select', filterValues: OPTIONS.owners },
      { field: 'region',   title: 'Region',    type: 'text', width: 110, filter: 'select', filterValues: OPTIONS.regions },
    ] },
    { title: 'Výkon', columns: [
      { field: 'budget',      title: 'Rozpočet', type: 'money',    width: 140, filter: 'number-range', formatterParams: { currency: 'CZK' }, summary: ['sum'] },
      { field: 'conversions', title: 'Konverze', type: 'number',   width: 110, filter: 'number-range', summary: ['sum', 'avg'] },
      { field: 'score',       title: 'Skóre',    type: 'number',   width: 92,  filter: 'number-range', condFormat: { on: true, levels: 5 } },
      { field: 'progress',    title: 'Průběh',   type: 'progress', width: 130, formatterParams: { showValue: true } },
      { field: 'rating',      title: 'Hodnocení',type: 'rating',   width: 120, align: 'center' },
      { field: 'trend',       title: 'Trend',    type: 'sparkline',width: 110, formatterParams: { type: 'line', fill: true } },
      { field: 'weekly',      title: 'Týden',    type: 'sparkline',width: 92,  formatterParams: { type: 'bar', color: '#16a34a' } },
    ] },
    { title: 'Termíny', columns: [
      { field: 'createdAt', title: 'Vytvořeno', type: 'date',     width: 120, filter: 'date-range' },
      { field: 'startsAt',  title: 'Start',     type: 'date',     width: 120, filter: 'date-two' },
      { field: 'updatedAt', title: 'Změněno',   type: 'datetime', width: 150, filter: 'date-range' },
    ] },
    { title: 'Stav', columns: [
      { field: 'status',   title: 'Stav',    type: 'text',    width: 120, filter: 'select', filterValues: OPTIONS.statuses },
      { field: 'label',    title: 'Štítek',  type: 'html',    width: 120 },
      { field: 'color',    title: 'Barva',   type: 'color',   width: 80 },
      { field: 'verified', title: 'Ověřeno', type: 'tick',    width: 92,  filter: 'boolean' },
      { field: 'active',   title: 'Aktivní', type: 'boolean', width: 100, filter: 'boolean' },
    ] },
  ];
}

/** Menší přehledná sada (pro ukázky, kde nechceme rozptylovat vším). */
export function coreColumns() {
  const keep = new Set(['id', 'name', 'category', 'owner', 'region', 'budget', 'score', 'status']);
  return campaignColumns().filter((c) => keep.has(c.field));
}

/** Zapne inline editaci na všech sloupcích kromě ID a Náhledu. */
export function withEditing(columns) {
  for (const c of columns) if (c.field !== 'id' && c.field !== 'image') c.editable = true;
  return columns;
}
