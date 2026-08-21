# Lattice — API reference

Datová tabulka (grid) ve vanilla JS (ESM), bez runtime závislostí. Tento dokument je
kompletní referenční přehled — options, sloupce, typy, filtry, metody, callbacky a features.
Živé ukázky ke každé věci jsou v demu (`demo/index.html`).

> 📘 Hledáš, jak tabulku **ovládat** z pohledu uživatele (řazení, filtry, seskupení, editace…)?
> Viz **[uživatelská příručka](../prirucka/index.html)** s obrázky.

- **Filozofie:** *knihovna počítá, aplikace persistuje.* Grid nikdy sám nesahá na backend —
  emituje callbacky a aplikace si ukládání řeší. Veškerý uživatelský stav (pořadí/šířky/
  viditelnost sloupců, řazení, filtry, nastavení, lokální presety) žije v **jednom**
  localStorage klíči `lattice:<id>` (proto je `id` povinné).
- **Bez build kroku:** čisté ESM s explicitními `.js` importy; funguje přes
  `<script type="module">` i z CDN.

---

## Instalace

**CDN (jeden request, bez buildu):**
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/svatekr70/lattice@v1.14.0/dist/lattice.css">
<div id="grid"></div>
<script type="module">
  import { Lattice } from 'https://cdn.jsdelivr.net/gh/svatekr70/lattice@v1.14.0/dist/lattice.min.js';
  new Lattice('#grid', { id: 'moje', columns, data });
</script>
```
Pro produkci připni verzi (`@v1.14.0`) nebo commit; `@main` je „vždy nejnovější" (jsDelivr
cachuje větev ~12 h).

**npm — přímo z GitHubu** (na npmjs.com knihovna publikovaná není):
```bash
npm i github:svatekr70/lattice#v1.14.0
```
```js
import { Lattice } from 'lattice';
import 'lattice/css';
```
Bez `#v1.14.0` se nainstaluje aktuální `main`. `dist/` je součástí repa, takže se nic nebuilduje.

> ⚠️ **`npm i lattice` stáhne cizí balíček** stejného jména z npm registru, ne tuhle knihovnu.
> Instaluj vždy přes `github:svatekr70/lattice`.

---

## Rychlý start

```js
const grid = new Lattice('#grid', {
  id: 'kampane',                 // POVINNÉ: klíč persistence (localStorage)
  columns: [
    { field: 'id',        title: 'ID',        type: 'id' },
    { field: 'name',      title: 'Název',     type: 'text',    filter: 'text' },
    { field: 'budget',    title: 'Rozpočet',  type: 'money',   filter: 'number-range' },
    { field: 'createdAt', title: 'Vytvořeno', type: 'date',    filter: 'date-range' },
    { field: 'active',    title: 'Aktivní',   type: 'boolean', filter: 'select' },
  ],
  data: rows,                    // pole objektů
  pageSize: 25,
  quickSearch: true,
});
```
`new Lattice(mount, options)` — `mount` je CSS selektor nebo element.

---

## Volby konstruktoru (options)

| Volba | Popis |
|---|---|
| `id` | **Povinné.** Klíč persistence (localStorage `lattice:<id>`). |
| `columns` | Pole definic sloupců (viz níže). |
| `data` | Client-side data (pole objektů). |
| `serverSide` / `ajaxUrl` / `ajax` / `progressiveLoad` | Server-side režim. `ajaxUrl` = jen URL; `ajax` = plný objekt requestu (`url, method, params, headers, requestBuilder, responseParser`). `progressiveLoad: 'scroll' \| 'load'` = donačítání. **Podrobně viz *Server-side režim*.** |
| `virtualScroll` | Virtuální scrollování (obří client-side data, bez stránkování). |
| `quickSearch` | Pole rychlého hledání přes všechny viditelné sloupce (předpočítaný index). |
| `keyField` | Klíč řádku (jinak sloupec typu `id`, jinak `'id'`). |
| `pageSize` | Výchozí velikost stránky. |
| `instance` | Výchozí nastavení tabulky (theme, layout, density, format, filterLayout, …) — viz *Nastavení instance*. |
| `selectable` | `true` \| `'single'` \| číslo (max). Výběr řádků checkboxy. |
| `selectionActions` | Lišta hromadných akcí nad výběrem: `[{ label, onClick(rows, keys, grid), danger?, icon? }]`. |
| `rowDetail` | Rozbalovací detail řádku: `(row) => HTMLElement \| string`. |
| `responsive` | Úzký viewport skládá přetečené sloupce do detailu (priorita `col.responsive`). |
| `pinnedTop` / `pinnedBottom` | Připnuté řádky (pole objektů) — vždy viditelné nahoře/dole. Za běhu `setPinnedRows({ top, bottom })`. |
| `urlState` | Sync řazení/filtrů/hledání/stránky do URL query stringu (sdílitelné pohledy). `true` nebo `{ key }`. |
| `fillHandle` | Fill handle (táhni roh výběru → vyplň rozsah). Automaticky při `rangeSelection` + editaci; `false` vypne. |
| `rangeSelection` | Výběr obdélníku buněk + schránka (Ctrl/⌘+C/V). Přidá **souhrn výběru** (počet/součet/průměr/min/max) a **fill handle**. |
| `editable` | Globální povolení inline editace (jinak per-sloupec `col.editable`). |
| `movableRows` / `orderField` / `acceptExternalRows` | Přesouvání řádků (tažením), přečíslování, příjem řádků z jiné tabulky. |
| `treeData` (+ `treeIdField`, `treeParentField`, `treeChildField`, `treeLeftField`, `treeRightField`, `treeStartExpanded`) | Hierarchická data (strom): zanořené `_children`, plochý `parentId`, nebo nested-set (lft/rgt). |
| `history` / `historySize` | Undo/redo (client-side). |
| `actions` | Řádkové akce: `[{ name, title?, icon?, onClick(row, index, e), visible?(row), disabled?(row), danger? }]`. Pole je **`title`** (ne `label`); `onClick` dostává `(row, index, e)`. Styl řídí `instance.actionsLayout`. Viz *Řádkové akce vs. kontextové menu*. |
| `rowContextMenu` | Kontextové menu řádku (pravý klik na buňku typu `id`): `(row, index) => [{ label, action, disabled? }]`; `action(row, index)`. |
| `cellContextMenu` | Kontextové menu buňky (pravý klik): `(ctx) => [{ label, action, disabled? }]`, kde `ctx = { row, value, field, index, col, cell, grid }`; `action(ctx)`. |
| `rowClass` / `rowStyle` | Podmíněné formátování řádku (třídy / inline styl dle dat). |
| `i18n` | `'cs'` \| `'en'` \| vlastní slovník / objekt. |
| `helpUrl` | URL nápovědy — ikona **?** v toolbaru (vpravo od ⚙, otevírá se v nové kartě). Default oficiální příručka; `null` ikonu skryje. |
| `storage` | Vlastní `Storage` (default `localStorage`; lze in-memory shim). |
| `globalPresets` / `onSaveGlobalPreset` / `onDeleteGlobalPreset` | Sdílené (globální) presety — aplikace je dodá a persistuje. Viz *Presety a globální nastavení*. |
| `globalAdvancedFilters` / `onSaveGlobalAdvancedFilter` / `onDeleteGlobalAdvancedFilter` | Sdílené (globální) rozšířené filtry — aplikace je dodá a persistuje. Viz *Presety a globální nastavení*. |
| `globalDefaults` / `onSaveGlobalDefaults` | Globální výchozí nastavení tabulky od správce. Viz *Presety a globální nastavení*. |
| `on…` callbacky | Viz *Callbacky*. |

### Řádkové akce vs. kontextové menu

Dva různé mechanismy, nepleť si je:

- **`actions`** = deklarativní **tlačítka/ikony viditelná v každém řádku** (ve sloupci vpravo, nebo v ⋮ menu podle `instance.actionsLayout: 'column' | 'menu'`). Filtrují se per-řádek přes `visible(row)`.
- **`rowContextMenu` / `cellContextMenu`** = položky menu **na pravý klik** (na vyžádání). Nemají ikony ani `visible(row)`; `cellContextMenu` má bohatší kontext (`value`, `col`, `cell`).

```js
new Lattice('#grid', {
  actions: [
    { name: 'edit',   title: 'Upravit', onClick: (row, i, e) => openEditor(row) },
    { name: 'delete', danger: true, disabled: (row) => row.locked,
      onClick: (row) => remove(row.id) },
  ],
  instance: { actionsLayout: 'menu' },        // 'column' (výchozí) | 'menu' (⋮)
  cellContextMenu: (ctx) => [                  // ctx = { row, value, field, index, col, cell, grid }
    { label: 'Kopírovat hodnotu', action: (c) => navigator.clipboard.writeText(c.value) },
  ],
});
```

---

## Definice sloupce

| Vlastnost | Typ | Popis |
|---|---|---|
| `field` | string | Klíč v datovém objektu (u computed sloupce jen identita). |
| `title` | string | Popisek hlavičky (výchozí = `field`). Uživatel ho **přejmenuje** v dialogu Sloupce (dvojklik na název); přejmenování se persistuje. |
| `type` | string | Datový typ → formát a výchozí filtr (viz *Typy*). |
| `value` | function | `(row) => any` — odvozená (computed) hodnota z celého řádku. Řadí/filtruje/hledá/exportuje se podle ní; needituje se. |
| `formula` | string | Počítaný sloupec zadaný **vzorcem** (řetězec, viz *Počítané sloupce*). Bezpečně se vyhodnotí (bez `eval`) → `value`. Sloupec s `formula` se persistuje (i v presetech) a jde vytvořit/upravit v UI. |
| `validator` | various | Deklarativní validace editace: `'required'` \| RegExp \| `{ required, min, max, minLen, maxLen, pattern, message }` \| `fn(v,row) => true\|string` \| pole pravidel. |
| `width` / `minWidth` | number | Šířka v px (uživatel může měnit tažením) / minimální šířka. |
| `align` | `'left'\|'center'\|'right'` | Zarovnání (jinak dle typu: čísla/datum/`id` vpravo, boolean na střed). |
| `frozen` | `true\|'left'\|'right'` | Ukotvení sloupce. `'never'` zakáže ukotvení uživatelem. |
| `visible` | boolean | Výchozí viditelnost (výchozí `true`). **`false` = skrytý po startu, ale zapnutelný** uživatelem v dialogu Sloupce (☰). Uživatelská viditelnost se persistuje (`lattice:<id>`) a má přednost před touto výchozí hodnotou. |
| `group` | string | Skupina sloupců (spojí sousední sloupce pod společné záhlaví). Skupinu lze v UI **sbalit** do úzkého proužku (ikona −/+ v záhlaví skupiny). Alternativně nested definice: `{ title, columns:[…] }`. |
| `filter` | string | Typ filtru; když se vynechá, odvodí se z typu. |
| `filterValues` | array | Hodnoty pro `select`/`multiselect` filtr (jinak `filterUrl`). |
| `editable` | boolean | Povolí inline editaci buňky. |
| `editor` / `editorParams` | string/object | Vlastní editor (`'select'`, `'multiselect'`, …). **Možnosti `select`/`multiselect` editoru se berou z `col.filterValues`** (sdílené s filtrem), nebo asynchronně z `col.filterUrl` — ne z `editorParams`. |
| `headerSort` | boolean | Řazení klikem na hlavičku (výchozí `true`). |
| `wrap` | boolean | Per-sloupcové zalamování textu v buňkách (`@v1.8.0`). `true` = zalomit i při vypnutém globálním `instance.wrapText`; `false` = nezalamovat i když je globál zapnutý; nezadáno = řídí se globálem. |
| `formatter` | function | `(value, col, row) => string \| Node` — vlastní vykreslení buňky (má přednost před `type`). |
| `formatterParams` | object | Parametry formátovače daného typu. |
| `summary` / `rowSummary` | string[] | Souhrnné funkce sloupce (dole) / řádku (vpravo): `['sum','avg','min','max','count']`. |
| `summaryFormula` (+ `summaryFormulaLabel`) | string | **Vážený / poolovaný souhrn** vzorcem z agregací jiných sloupců — např. `sum(spojeno) / sum(vytoceno) * 100`. Viz *Počítané sloupce → agregační funkce*. `summaryFormulaLabel` = název řádku vlevo (sloupce se stejným názvem sdílejí řádek). |
| `condFormat` | object | Barevná škála („semafor"): `{ on:true, levels:3\|5\|7, reverse?, colors?, mode?, thresholds? }`. |
| `cellClass` / `cellStyle` | function | Podmíněné třídy / inline styl buňky dle hodnoty. |
| `headerBackground` / `headerColor` | string | Barva **záhlaví sloupce** (pozadí / písmo). Nastavitelné i v UI (color picker s barevným kolem + Bootstrap presety). Persistuje se. |
| `groupHeaderBackground` / `groupHeaderColor` | string | Barva **záhlaví skupiny**. Buď per-sloupec, nebo v nested definici skupiny (`{ title, headerBackground, columns }`). Sloupec bez vlastní barvy **zdědí barvu skupiny**. |
| `cellFormat` | object | Vzhled **buňky** (těla): `{ align:'left'\|'center'\|'right', bold, italic, underline, strike, color, background }`. Nastavitelné v UI („Formát buňky"). Persistuje se. |
| `cellPopup` / `headerPopup` | function | Popup na klik do buňky / z ⓘ v hlavičce. |
| `headerMenu` | true\|array\|fn | Menu hlavičky sloupce. |
| `responsive` | number\|false | Pořadí skládání při `responsive:true` (vyšší = schová se dřív); `false` = nikdy neschovat. |

---

## Datové typy (`type`)

| Typ | Popis |
|---|---|
| `text` | Prostý text. |
| `id` | Identifikátor záznamu — needituje se, drží klíč řádku, výchozí zarovnání vpravo. |
| `number` | Číslo (des. místa, oddělovač tisíců, záporná barevně/v závorkách). |
| `money` | Měna se symbolem (`formatterParams: { currency: 'CZK' }`). |
| `date` / `datetime` / `time` | Datum/čas dle vzoru (`dd.mm.yyyy`, `d. mmmm yyyy`, …). |
| `boolean` / `tick` | Ano/Ne (✓/✕, barvy ze škály) / jen ✓ když pravda. **Zobrazení lze změnit** — `formatterParams: { trueText, falseText, plain }` (nebo v UI přes ikonu formátu ✓): např. `Ano/Ne`, `1/0`, `✅/❌`; `plain:true` vypne barvení. |
| `progress` | Vodorovný pruh (`formatterParams: { max, color, showValue }`). |
| `rating` | Hvězdičky (`formatterParams: { max }`). |
| `sparkline` | Mini graf z pole hodnot — SVG bez závislosti (`formatterParams: { type:'line'\|'bar', color, fill, height, width }`). |
| `link` | Odkaz (`formatterParams: { urlPrefix, urlSuffix, urlField, url, target, label, rel }`). Zobrazený text = hodnota sloupce (nebo `label`); URL se skládá `urlPrefix + hodnota + urlSuffix`. **`urlField`** vezme pro URL jiné pole řádku než zobrazené (např. text = název, odkaz přes ID: `field:'name', formatterParams:{ urlField:'id', urlPrefix:'/clients/edit/' }`). **`url(value, row, col)`** = builder vracející celé href. Nová karta globálně přes `instance.linkNewTab` (přebije `target`); v nové kartě se přidá ikona externího odkazu. |
| `image` | Obrázek z URL/`data:` (+ lightbox). |
| `icon` | Ikona/emoji (`formatterParams: { icons: { hodnota: emoji } }`). |
| `color` | Barevná výplň buňky. |
| `html` | Vykreslí HTML (jen pro důvěryhodná data). |

Vlastní typ: `registerType(name, (value, col, row) => string | Node)`.

---

## Filtry (`col.filter`)

| Filtr | Pro typy | Popis |
|---|---|---|
| `text` | text | Obsahuje (prefix `!` = neobsahuje). |
| `number` | number/money/… | Porovnání `=, >, <`. |
| `number-range` | number/money/… | Rozsah Od–Do. |
| `date-range` / `date-two` | date/datetime | Kalendářní rozsah / dvě pole Od / Do. |
| `dynamic` | date/datetime | Vlastní výraz: operátory `>` `<` `>=` `<=` `=`, spojky `AND`/`OR` (AND váže těsněji), pevné datum i relativní tokeny (`today±N[dwmy]`, `now` — viz tabulka u rozšířeného filtru). Např. `>today-14 AND <today+14`; chybný výraz se tiše ignoruje. `@v1.11.0` |
| `select` / `multiselect` | kdykoli | Výběr jedné / více hodnot (potřebuje `filterValues` nebo `filterUrl`). |
| `boolean` | boolean | Ano / Ne / Vše. |

**Umístění filtrů** řídí `instance.filterLayout`: `'header'` (v záhlaví) \| `'external'` (panel nad
tabulkou) \| `'universal'` (jedno pole Pole/Typ/Hodnota) \| `'none'`. Navíc **rozšířený filtr**
(strom AND/OR pravidel) přes `grid.applyAdvanced(tree)`. Vlastní filtr: `registerFilter(name, def)`.

> **Tree:** filtry i rychlé hledání fungují i ve stromovém zobrazení — zachovají cestu k nálezu
> (rodiče) a větev se shodou se rozbalí.

### Rozšířený filtr (strom pravidel)

`grid.applyAdvanced(tree)` aplikuje strom podmínek, `grid.clearAdvanced()` ho zruší. Schéma:

```js
// group    = { combinator: 'AND' | 'OR', rules: [ group | condition, … ] }
// condition = { field, op, value }
const tree = {
  combinator: 'AND',
  rules: [
    { combinator: 'OR', rules: [
      { field: 'category', op: 'eq', value: 'PPC' },
      { field: 'category', op: 'eq', value: 'Bannery' },
    ] },
    { field: 'budget', op: 'gte', value: 100000 },
  ],
};
grid.applyAdvanced(tree);
```

Operátory (`op`): `eq, neq, contains, ncontains, starts, ends, gt, gte, lt, lte, in, nin, empty, nempty`
(`in`/`nin` = seznam oddělený čárkou; `empty`/`nempty` ignorují `value`). Uložení pojmenovaných
filtrů viz *Metody instance* (`saveAdvanced`) a *Globální rozšířené filtry*.

**Relativní datové tokeny.** V `value` můžeš místo pevného data použít token, který se dopočítá
až při každém vyhodnocení filtru — díky tomu uložený filtr „posouvá okno" s časem:

| Token | Význam |
| --- | --- |
| `today` | dnešek (`YYYY-MM-DD`, lokální půlnoc) |
| `today+14` / `today-7` | ± N dní (jednotka `d` je výchozí) |
| `today+2w` / `-1m` / `+1y` | jednotky: `d` (den), `w` (týden), `m` (měsíc), `y` (rok) |
| `now` | aktuální okamžik včetně času (`YYYY-MM-DDThh:mm:ss`) |
| `sow` / `eow` | začátek (pondělí) / konec (neděle) týdne `@v1.12.0` |
| `som` / `eom` | první / poslední den měsíce `@v1.12.0` |
| `soq` / `eoq` | první / poslední den kvartálu `@v1.12.0` |
| `soy` / `eoy` | první / poslední den roku `@v1.12.0` |

Hranice období berou i offset (`sow-1w`, `eom-1m`, …) — offset se aplikuje **nejdřív**, pak se
zarovná na hranici, takže `eom-1m` = poslední den minulého měsíce i u kratších měsíců. Příklady:
**minulý týden** `>=sow-1w AND <=eow-1w`, **tento měsíc** `>=som AND <=eom`, **minulý měsíc**
`>=som-1m AND <=eom-1m`, **letos** `>=soy AND <=eoy`. V dynamickém filtru sloupce je u pole tlačítko
**„?"** s hotovými obdobími (klik je vyplní a rovnou aplikuje).

Stejné tokeny pohánějí i **dynamické presety v `date-range` pickeru** (`@v1.12.0`): přepínač
**„dynamické období"** v dialogu uloží u presetu token (`{from:'sow-1w', to:'eow-1w'}`) místo pevných
dat, takže uložený filtr/preset/snímek zůstane živý. `match`/`toServer` date-range filtru tokeny
rozvíjejí (pevná data projdou beze změny).

```js
// „Zkušební doba končí v příštích 14 dnech" — bez pevného data:
const tree = { combinator: 'AND', rules: [
  { field: 'probation_end', op: 'gte', value: 'today' },
  { field: 'probation_end', op: 'lte', value: 'today+14' },
] };
```

Token je běžný **řetězec** (JSON-safe) — rozvine se až při porovnání, žádný spustitelný kód se
neukládá, takže je bezpečný i pro **globálně sdílené** filtry. Je case-insensitive a toleruje mezery
(`today + 14 d`). Cokoli, co není platný token (`2026-01-01`, `yesterday`, číslo), se použije beze změny.
Funguje i uvnitř `in`/`nin` seznamu (`today, today+7`). V **server-side** režimu (`@v1.7.0+`) se
tokeny **rozvinou na konkrétní data** už při skládání requestu (viz *Server-side režim → Rozšířený
filtr (`advanced`)*), takže backend dostane hotové ISO datum a nemusí tokeny umět parsovat.

> **Externí (programové) filtrování na client-side:** Lattice **nemá** API pro vlastní row-predikát
> (žádná `filterFunc` / `rowFilter`). Když potřebuješ filtrovat vlastní logikou, buď (a) předej už
> **předfiltrovaná data** přes `setData(rows)`, nebo (b) sestav strom a použij `applyAdvanced(tree)`.
> V **server-side** režimu se rozšířený filtr (`advanced`) posílá na backend nativně (`@v1.7.0+`) —
> viz *Server-side režim*; překlad `advanced` do SQL je na aplikaci.

---

## Nastavení instance (`options.instance` / `setInstance`)

Vše se persistuje a projeví ihned. Uživatel to mění v UI „Nastavení tabulky" (ozubené kolo).

| Klíč | Hodnoty (výchozí) |
|---|---|
| `theme` | `'default'` \| `'auto'` (dle systému) \| `'minimal'` \| `'compact'` \| `'slate'` (tmavý) \| `'ocean'` \| `'warm'` \| `'contrast'` \| `'bootstrap5'` \| `'tailwind'` \| `'material'` |
| `layout` | `'fitData'` \| `'fitDataFill'` \| `'fitDataStretch'` \| `'fitColumns'` |
| `density` | `'comfortable'` \| `'compact'` |
| `paginationPosition` | `'footer'` \| `'header'` \| `'both'` \| `'none'` |
| `filterLayout` | `'header'` \| `'external'` \| `'universal'` \| `'none'` |
| `rowNumbers` | `'none'` \| `'continuous'` \| `'perPage'` |
| `headerRotate` | `'none'` \| `'90'` \| `'270'` |
| `summaryRow` | `'none'` \| `'page'` (zobrazená stránka) \| `'all'`. **Server-side:** `'all'` agreguje jen z **aktuálně načtených řádků** (grid nemá celý dataset) — souhrn „přes vše" musí spočítat server. |
| `groupBy` | seskupení řádků (víceúrovňové): `null`, `field`, nebo pole. Položka je buď název pole (`'region'`), nebo `{ field, part }` pro **datumové úrovně** — `part` ∈ `year, quarter, month, week, weekday, day, hour, minute`. Víc úrovní se zanoří (`[{field:'createdAt',part:'year'},{field:'createdAt',part:'quarter'}]`); datumové skupiny se řadí chronologicky. |
| `groupDisplay` | jak zobrazit úrovně: `'headers'` (vnořené sbalitelné hlavičky, výchozí) \| `'columns'` (ploché řádky). V OBOU režimech se seskupené úrovně vykreslí jako **ukotvené vedoucí sloupce vlevo** (při horizontálním scrollu zůstanou stát, reálné sloupce odjedou za nimi); `'headers'` k tomu navíc přidá sbalitelné lišty skupin. |
| `groupRepeat` | v režimu `'headers'`: opakovat hodnotu seskupení v každém řádku (`true`, výchozí) \| nechat vedoucí sloupce prázdné a hodnotu jen v liště skupiny (`false`). |
| `groupSubtotals` | `true` = mezisoučty za skupiny |
| `actionsLayout` | `'column'` (sloupec) \| `'menu'` (⋮ trojtečkové) |
| `selectRowClick` | `true` = výběr i klikem na řádek (jinak jen checkbox) |
| `rowHighlight` | `true` \| `'click'` = klik na řádek přepíná **zvýraznění** (podbarvení). Ignoruje klik do editovatelných buněk, akčních tlačítek a checkboxu výběru. Přepínatelné i z UI (*Sloupce a řádky*). Viz *Zvýraznění řádků* (`@v1.8.0`). |
| `resizeGuide` | `true` = vodicí čára při změně šířky |
| `zebra` / `wrapText` / `emptyText` | pruhování / **globální** zalamování dat v buňkách (per-sloupec přebije `col.wrap`) / placeholder prázdné buňky |
| `wrapHeader` | `true` = zalamovat názvy sloupců v záhlaví (nezávisle na `wrapText`). Auto-fit (dvojklik na oddělovač) pak počítá šířku podle názvu složeného do 2 řádků, ale nikdy ne užší než nejširší nezalomená data na stránce. Netýká se otočených hlaviček. |
| `linkNewTab` | odkazy (typ `link`) otevírat v nové kartě + ikona externího odkazu. Per-sloupec přebije `formatterParams.target`. |
| `scaleColors` | kotevní barvy semaforu `[low, mid, high]` (ovlivní condFormat i boolean ✓/✕) |
| `cssVars` | vlastní CSS proměnné `{ '--lattice-accent': '#e91e63', … }` |
| `fontSize` / `fontFamily` | velikost / rodina písma |
| `format` | globální formát po druzích: `{ number, money, date, datetime, time }` |

### Zvýraznění (podbarvení) řádků — `@v1.8.0`

Trvalé žluté (themeovatelné) podbarvení vybraných řádků — nezávislé na výběru checkboxy.
Stav drží knihovna, přežije re-render/řazení/filtr a persistuje se do `lattice:<id>`.

```js
grid.highlightRow(id);            // zvýraznit
grid.highlightRow(id, false);     // zrušit u jednoho
grid.toggleRowHighlight(id);      // přepnout
grid.clearHighlights();           // zrušit vše
grid.highlightedRows;             // ['12', '34', …] (getter, klíče keyField)
// reakce na změnu:
new Lattice('#grid', { onHighlightChange: (keys) => save(keys) });
```

**Klik na řádek přepíná zvýraznění** přes `instance.rowHighlight: true` (nebo `'click'`).
Klik do editovatelné buňky, akčního tlačítka nebo checkboxu výběru se ignoruje. Zapnout/vypnout
jde i **z UI** — Nastavení tabulky (⚙) → *Sloupce a řádky* → „Zvýraznění řádku klikem" (`@v1.8.1`).

**Barva** je řízena CSS proměnnými (bez `!important` na straně aplikace) — přepiš je globálně,
na `.lattice`, nebo přes `instance.cssVars`:

| Proměnná | Výchozí (světlá / tmavá) |
|---|---|
| `--lattice-row-highlight-bg` | `#fff3bf` / `#4a3f1e` |
| `--lattice-row-highlight-hover` | `#ffea8a` / `#5a4d26` |

Barvu lze změnit i **z UI** — dialog **Nastavení tabulky (⚙) → Vlastní úpravy**, swatche
„Zvýraznění řádku" / „…při najetí" (uloží se do `instance.cssVars`, „Obnovit vlastní úpravy" vrátí
motiv). Podbarví celý řádek včetně ukotvených, číslovacích a souhrnných buněk. Veřejná třída na řádku
je `.lattice-row.is-highlighted` (stabilní; podbarvení řeší proměnné, třídu obvykle nepotřebuješ).

---

## Metody instance

| Metoda | Popis |
|---|---|
| `setData(rows)` / `updateData(rows)` | Nahradit / hromadně sloučit data (upsert dle keyField). |
| `addRow(row, atStart?)` / `updateRow(key, patch)` / `deleteRow(key)` | Granulární mutace (emitují `onDataChange`, historie). |
| `moveRow(...)` / `receiveExternalRow(...)` | Přesun / příjem řádku. |
| `sortColumn(field, dir)` / `toggleSort(field, append?)` | Řazení (append = víceúrovňové). |
| `setFilter(field, value)` / `clearFilters()` | Filtry. |
| `setQuickSearch(term)` | Rychlé hledání. |
| `applyAdvanced(tree)` / `clearAdvanced()` | Aplikace / zrušení rozšířeného filtru (strom pravidel). |
| `saveAdvanced(name, tree, scope?, display?)` | Uloží pojmenovaný filtr — `scope: 'local'` (výchozí, localStorage) nebo `'global'` (sdílené → callback). `display` (`@v1.14.0`) = kde se filtr v toolbaru ukáže: `{ button, select }` — pilulka v řadě ikon (vlevo od filtračních ikon) a/nebo položka v rozbalovacím výběru uložených filtrů. Legacy boolean (`asButton`, `@v1.10.0`) dál funguje: `true` = jen tlačítko, `false` = jen výběr. |
| `listAdvanced()` / `deleteAdvanced(id)` / `canSaveGlobalAdvanced()` | Seznam uložených filtrů (se `scope`) / smazání (dle scope) / lze uložit globálně? |
| `activeSavedId()` / `buttonAdvanced()` / `toggleSavedAdvanced(id)` | Id uloženého filtru odpovídajícího aktuálnímu stavu / uložené filtry označené jako tlačítko / přepínač uloženého filtru (aplikuje, nebo zruší když je aktivní). `@v1.10.0` |
| `selectAdvanced()` | Uložené filtry patřící do rozbalovacího výběru v toolbaru. Položka bez `asSelect` (uložená před `v1.14.0`) se řídí postaru — co není tlačítko, je ve výběru. `@v1.14.0` |
| `setAdvancedDisplay(id, key, on)` | Přepne u uloženého filtru zobrazení bez opětovného ukládání — `key` je `'asButton'` \| `'asSelect'`. U globálního filtru pošle změnu přes `onSaveGlobalAdvancedFilter`. `@v1.14.0` |
| `overwriteSavedFilter(id)` | Přepíše uložený **snímek** aktuálními sloupcovými filtry z hlavičky (`id`, název, rozsah i volby zobrazení zůstávají). Vrací `null`, když není co uložit. `@v1.14.0` |
| `renameSavedFilter(id, name)` | Přejmenuje uložený filtr (snímek i strom) — mění jen název. `@v1.14.0` |
| `saveFilterSnapshot(name, scope?, display?)` | **Snímek sloupcových filtrů** — uloží aktuální „naklikané" filtry z hlavičky pod názvem (do stejného seznamu jako `saveAdvanced`, `scope`/`display` stejně). Vrací `null`, když žádný sloupcový filtr není aktivní. `@v1.11.0` |
| `applyFiltersSnapshot(snap)` / `clearColumnFilters()` / `hasColumnFilters()` | Obnoví snímek zpět do políček hlavičky (a přefiltruje) / zruší jen sloupcové filtry / je aktivní aspoň jeden sloupcový filtr? `@v1.11.0` |
| `applyPreset(preset)` / `buttonPresets()` / `selectPresets()` | Aplikuje preset / presety označené jako tlačítko / presety nabízené v rozbalovacím výběru v toolbaru. `@v1.14.0` |
| `togglePreset(preset)` | Přepínač presetu (klik na tlačítko v rychlé řadě): neaktivní aplikuje, u aktivního zavolá `resetView()`. `@v1.14.0` |
| `resetView()` | **Výchozí zobrazení** — sloupce a nastavení tabulky jako po startu bez presetu (výchozí ← `options.instance`). Filtry (sloupcové, univerzální, rozšířený), řazení i rychlé hledání zůstávají v platnosti. `@v1.14.0` |
| `setPage(n)` / `setPageSize(n)` | Stránkování. |
| `setInstance(patch)` | Nastavení tabulky (theme, layout, …). |
| `setFormat(kind, patch)` / `setColumnFormat(field, patch)` | Formát globálně / per-sloupec. |
| `setColumnSummary(field, summary)` / `setColumnRowSummary(field, fns)` | Souhrny sloupce (dole) / řádku (vpravo) — pole funkcí `['sum','avg','min','max','count']`. |
| `setColumnSummaryFormula(field, formula, label?)` | Vážený souhrn sloupce vzorcem (`null` zruší). `label` = název řádku. |
| `setColumnTitle(field, title)` | Přejmenuje sloupec (prázdné = zpět na výchozí). |
| `toggleColGroup(title)` / `isColGroupCollapsed(title)` | Sbalí/rozbalí skupinu sloupců / je sbalená? |
| `setColumnHeaderColor(field, {background, color})` | Barva záhlaví sloupce (prázdné zruší). |
| `setColGroupHeaderColor(title, {background, color})` | Barva záhlaví celé skupiny (nastaví všem členům). |
| `setColumnCellFormat(field, patch)` | Formát buňky sloupce (`null` zruší). |
| `addComputedColumn({ title, type, formula })` | Přidá **počítaný sloupec** ze vzorce (vrátí jeho `field`). Vyhodí `FormulaError` u neplatného vzorce. |
| `updateComputedColumn(field, { title?, type?, formula? })` | Upraví počítaný sloupec (zachová šířku/pořadí/souhrny/formát). |
| `removeComputedColumn(field)` | Odebere počítaný sloupec (jen sloupce vytvořené vzorcem). |
| `setPinnedRows({ top?, bottom? })` | Připnuté řádky za běhu. |
| `getSelectedRows()` / `getSelectedKeys()` / `clearSelection()` | Výběr. **Server-side:** `getSelectedKeys()` vrací klíče **napříč stránkami** (přetrvávají při stránkování), ale `getSelectedRows()` vrátí jen řádky **z aktuálně načtené stránky**. |
| `selectKeys(keys, on?)` / `setSelectScope(scope)` | Programový výběr dle klíčů (`on=false` odznačí) / rozsah „vybrat vše" (`'page' \| 'all'`, výchozí `'page'`). **Server-side:** „vybrat vše filtrované napříč stránkami" grid neumí (nemá celý dataset) — vytáhni ID ze serveru (viz `getServerParams`) a nastav přes `selectKeys`. |
| `highlightRow(key, on?)` / `toggleRowHighlight(key)` / `clearHighlights()` / `highlightedRows` | Zvýraznění (podbarvení) řádků. Přežije re-render/řazení/filtr, persistuje se do `lattice:<id>`. `highlightedRows` (getter) = pole klíčů. Změna překreslí jen dotčený řádek. Viz *Zvýraznění řádků* (`@v1.8.0`). |
| `getServerParams({ paginate? })` / `getServerQuery({ paginate? })` | **Server-side.** Aktuální serverové parametry (sort/filter/search/advanced dle `ajax.paramNames`, tokeny rozvinuté) jako objekt / hotový urlencoded querystring. `paginate` default `false` (bez page/size = „vše filtrované"). Pro vlastní endpointy (ID všech filtrovaných řádků, export) bez ruční duplikace. Client-side vrací `{}` / `''`. `@v1.8.0`. |
| `getColumnLayout()` | Snímek layoutu sloupců. |
| `resetColumns()` | Zahodí uživatelské úpravy sloupců (pořadí, viditelnost, šířky, souhrny, formáty) a vrátí výchozí z definice. Ruší i **seskupení řádků** (`groupBy`/`groupDisplay`/`groupRepeat` zpět na `options.instance`) a sbalené skupiny — zapíná se z téhož dialogu. Ostatní nastavení tabulky nemění. |
| `undo()` / `redo()` / `clearHistory()` | Historie. |
| `exportData(fmt, opts)` / `download(fmt, opts)` / `print(opts)` | Export (`csv \| tsv \| json \| xml \| excel`) / tisk. Excel = SpreadsheetML, bez závislosti. |
| `importFile(file)` / `importFromUrl(url, i, opts)` / `importHTMLTable` / `importXML` | Import. |
| `setLanguage(lang)` | Změna jazyka. |
| `captureState(parts?)` / `captureInstance()` | Snímek stavu pro preset (`{columns, sort, filters, instance}`) / jen nastavení tabulky. `parts` = `{columns, filters, instance}` vybírá, co se zachytí (bez něj vše). `@v1.13.0` |
| `presetContents(preset)` | Které části preset nese: `{columns, filters, instance}`. `@v1.13.0` |
| `applyPreset(preset)` | Aplikace presetu — sloupce/řazení/filtry + nastavení tabulky (má-li ho preset uložené). |
| `refresh()` | Překreslení / znovunačtení. **Client-side** = přepočet v paměti; **server-side** = **nový HTTP dotaz** (použij po mutaci `ajax.params`). |
| `destroy()` | Zrušení instance. |
| `hasGlobalDefaults()` / `globalDefaultsAvailable()` | Jsou k dispozici globální výchozí nastavení / je nová verze, kterou uživatel ještě neviděl. |
| `applyGlobalDefaults()` / `dismissGlobalDefaults()` | Použít globální výchozí nastavení teď / potvrdit verzi bez použití. |
| `setGlobalDefaults()` | Uložit aktuální nastavení jako globální výchozí (spustí `onSaveGlobalDefaults`). |

---

## Server-side režim (`serverSide` / `ajax`)

Zapni `serverSide: true` a dodej buď `ajaxUrl: '/api/…'` (jen URL), nebo plný objekt `ajax`:

```js
new Lattice('#grid', {
  serverSide: true,
  ajax: {
    url: '/api/candidates',
    method: 'GET',                 // | 'POST' (params se pošlou jako JSON body)
    params: { tenantId: 5 },       // vlastní parametry do KAŽDÉHO requestu
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    paramNames: { page: 'page', size: 'size', sort: 'sort', filter: 'filter', search: 'search', advanced: 'advanced' }, // přejmenování
    // resolveTokens: true,                  // rozvinout relativní datové tokeny v `advanced` (default true)
    // requestBuilder: (state) => ({ … }),   // volitelně: přestav CELÉ query params
    // responseParser: (json) => ({ rows, total, lastPage, lastRow }), // volitelně: vlastní parsování
  },
});
```

### `ajax` objekt

| Pole | Typ | Popis |
|---|---|---|
| `url` | string | **Povinné** (jinak chyba už při vytvoření). |
| `method` | `'GET'` \| `'POST'` | Výchozí `'GET'`. GET → params jako query string; POST → params jako **JSON body** (+ `Content-Type: application/json`). |
| `params` | object | Statické extra parametry přidané do **každého** requestu (viz níže — mutace za běhu). |
| `headers` | object | Hlavičky do `fetch`. |
| `paramNames` | object | Přejmenování klíčů. Výchozí `{ page:'page', size:'size', sort:'sort', filter:'filter', search:'search', advanced:'advanced' }` (`search` a `advanced` přidány v `@v1.7.0`). |
| `resolveTokens` | bool | Rozvinout relativní datové tokeny (`today+14`, `now`, …) v `advanced` na konkrétní data **před odesláním** na server. Výchozí `true` — backend tak dostane hotové ISO datum. `false` = posílá tokeny tak, jak jsou (backend si je rozvine sám). `@v1.7.0`. |
| `requestBuilder(state)` | fn | Přestaví **celé** query params z `state = { page, pageSize, paginate, sort, filters, advanced, universal, search, columns }` (pozor: `pageSize`, ne `size`; `advanced` je **nerozvinutý** strom — tokeny si rozviň sám, viz `resolveTreeTokens`). Když je zadán, `params` ani `paramNames` se **neaplikují** automaticky. |
| `responseParser(json)` | fn | Vlastní parsování odpovědi → musí vrátit `{ rows, total, lastPage, lastRow }` (nedostává `pageSize`, takže `lastPage` si spočítej sám). |

### Externí stav přes `ajax.params` (velmi časté)

`ajax.params` se do requestu skládá mělkou kopií (`Object.assign({}, ajax.params)`) **při každém dotazu**, čtenou vždy znovu. Když si podržíš referenci na objekt, zmutuješ ho a zavoláš `refresh()`, nové hodnoty se projeví:

```js
const params = { tenantId: 5, status: 'active' };
const grid = new Lattice('#grid', { serverSide: true, ajax: { url: '/api/candidates', params } });

// později — externí filtrovací tlačítko MIMO grid:
params.status = 'archived';   // zmutuj referenci
grid.refresh();               // → nový dotaz s aktuálními params
```

Je to **jediný** způsob, jak poslat na server stav mimo grid (externí filtry). Kopie je **mělká** (vnořené objekty se sdílejí); s `requestBuilder` se `params` neslučuje vůbec.

### Request parametry

- `page` (**1-based**), `size` — posílají se jen při zapnutém stránkování.
- `sort` = pole `[{ field, dir }]` → serializuje se jako `sort[0][field]`, `sort[0][dir]`, …
- `filter` = pole `[{ field, type, value }]`, kde `type` ∈ `like, !like, =, !=, in, >=, >, <=, <, dateRange`:
  - **range** (`number-range`, `date-two`): dva záznamy se stejným `field` (`>=` a `<=`); kterýkoli může chybět.
  - **date-range**: JEDEN záznam `type:'dateRange'`, `value: "from|to"`.
  - **multiselect**: `type:'in'`, `value` je **pole** → `filter[0][value][0]`, `filter[0][value][1]`, … (ne spojené `'|'`).
- `search` (quick search) — trimovaný řetězec, výchozí klíč `search`.
- `advanced` (rozšířený filtr, strom AND/OR pravidel) — **jen když je neprázdný**; formát viz níže (`@v1.7.0`).

GET serializuje bracket-formátem (`key[i]` pro pole, `key[klíč]` pro objekt); POST pošle stejnou strukturu jako JSON body.

#### Rozšířený filtr (`advanced`) — `@v1.7.0`

Rozšířený filtr (`grid.applyAdvanced(tree)`, včetně vybraného **globálního** uloženého filtru) se
posílá na backend nativně — stejně jako `sort`/`filter`/`search`. Je **aditivní**: backendy, které
`advanced` ignorují, fungují beze změny.

- **Formát:** celý strom jako **JSON** (ne bracket-formát — vnořené skupiny by se rozpadly).
  - **GET:** `advanced=<urlencoded JSON>` (jeden parametr) → backend: `json_decode($_GET['advanced'])`.
  - **POST:** `advanced` je **vnořený objekt** přímo v JSON body.
- **Rozvinuté tokeny:** relativní datové tokeny (`today+14`, `now`, …) se defaultně rozvinou na
  konkrétní ISO datum (`ajax.resolveTokens`, viz *`ajax` objekt*), takže backend zůstává „hloupý".
- **Schéma stromu:** `group = { combinator: 'AND'|'OR', rules: [group|condition] }`,
  `condition = { field, op, value }`; `op` ∈ `eq, neq, contains, ncontains, starts, ends,
  gt, gte, lt, lte, in, nin, empty, nempty` (u `in`/`nin` je `value` CSV/pole; `empty`/`nempty`
  bez `value`).

Příklad payloadu (filtr „zkušební doba končí v příštích 14 dnech", dnes `2026-08-05`):

```jsonc
// GET:  ?…&advanced=%7B%22combinator%22%3A%22AND%22%2C%22rules%22%3A%5B…%5D%7D
// dekódovaná hodnota parametru `advanced`:
{ "combinator": "AND", "rules": [
  { "field": "probation_end", "op": "gte", "value": "2026-08-05" },
  { "field": "probation_end", "op": "lte", "value": "2026-08-19" }
] }
```

**Doporučené zpracování na serveru** (zůstává na aplikaci): `json_decode` → rekurzivní průchod
stromu → skládání `WHERE` (whitelist `field` → DB sloupec, mapování `op` na SQL, `in`/`nin` →
`IN (…)`, M:N vztahy přes `EXISTS`). Prázdný / chybějící `advanced` = bez omezení.

### Odpověď serveru

Grid čte `{ data, total, last_page, last_row }` (nebo přímo top-level pole = `data`):

| Pole | Povinné | Význam |
|---|---|---|
| `data` | ~ano | Řádky stránky (může být i celé JSON pole). |
| `total` | ne\* | Celkový počet po filtraci (napříč stránkami) — pro „Zobrazeno X–Y z **N**". Fallback: `last_row` → `data.length`. |
| `last_row` | ne | Alternativa/synonymum k `total`. |
| `last_page` | ne | Počet stránek. Fallback: `ceil(total / size)`. |

\* Bez `total`/`last_row` grid použije `data.length` → počítadlo i paginace budou vědět jen o načtené stránce. Pro korektní stránkování **vracej `total`** (nebo `last_row`). Výpočet: `N = total`, `X = (page−1)·size + 1`, `Y = min(page·size, total)`.

### Auto-refetch

Nový dotaz na server vyvolají **automaticky**: `setFilter`, `clearFilters`, `setQuickSearch`, `setPage` (kromě kliku na aktuální stránku), `setPageSize`, **řazení klikem na hlavičku** (`sortColumn` / `toggleSort`) a **rozšířený filtr** (`applyAdvanced` / `clearAdvanced`, včetně výběru globálního uloženého filtru — `@v1.7.0`; refetch běží přes interní `refresh()` a nově nese parametr `advanced`). `refresh()` volej ručně jen po změně `ajax.params` nebo jiného externího stavu — jinak je zbytečné.

### Vlastní endpointy s aktuálním filtrem — `getServerParams` / `getServerQuery` (`@v1.8.0`)

Když aplikace potřebuje zavolat **vlastní** server-side endpoint se **stejným filtrem**, jaký má
grid právě aplikovaný — typicky „ID všech filtrovaných řádků napříč stránkami" (pro „vybrat vše
filtrované") nebo „export všech filtrovaných řádků" — nemusí serializaci duplikovat ručně:

```js
// objekt parametrů (sort/filter/search/advanced dle paramNames, tokeny rozvinuté; bez stránkování)
const params = grid.getServerParams();               // { sort:[…], filter:[…], search:'…', advanced:'{…}' }

// nebo rovnou urlencoded querystring (advanced je vždy JSON string → funguje i u POST-mode gridu)
const qs = grid.getServerQuery();                     // 'sort[0][field]=…&filter[0]…&advanced=%7B…%7D'
const ids = await fetch(`/api/candidates/ids?${qs}`).then((r) => r.json());
grid.selectKeys(ids, true);                           // „vybrat vše filtrované"

const csvUrl = `/api/candidates?all=1&${qs}`;         // export všech filtrovaných
```

`getServerParams({ paginate: true })` přidá i `page`/`size`. Backend čte `advanced` stejně jako u
běžného dotazu (viz *Rozšířený filtr*). V client-side režimu obě metody vrací prázdno (`{}` / `''`).

---

## Vzhled a skupiny sloupců (UI)

Vše nastavitelné z **dialogu Sloupce** (ikona ☰) a persistované (localStorage i presety).

- **Přejmenování** — dvojklik na název sloupce v dialogu → inline editace.
- **Skupiny sloupců** — přiřazení přes ikonu *Skupina*. V pop-upu skupiny je i **barva** (A)
  a **zrušení** (×), aby se na destruktivní akci neklikalo omylem v gridu. Skupina jde v záhlaví
  **sbalit** do úzkého proužku (ikona −/+); sbalený stav se pamatuje. Sloupec může být jen v jedné skupině.
- **Barvy záhlaví** (sloupce i skupiny) — ikona *A*. Picker má **barevné kolo** (výchozí),
  jezdec jasu a druhý tab s **Bootstrap paletami** (16 kombinací — plné i jemné „alert" tóny)
  a vlastní volbou; pamatuje si **naposledy použité** barvy. Sloupec bez vlastní barvy
  **zdědí barvu své skupiny**; písmo se u presetů/kola dopočítá kontrastně. Stejný picker
  je i v *Nastavení tabulky* → „Barvy škály" a „Vlastní úpravy".
- **Formát buňky** — ikona *¶*: zarovnání, tučné/kurzíva/podtržené/přeškrtnuté, barva písma a pozadí.
- **Zobrazení boolean** — ikona *✓* u boolean sloupce: varianty ✓/✕, Ano/Ne, 1/0, ✅/❌, 👍/👎 nebo vlastní texty, s volbou barvení.

---

## Presety a globální nastavení

Filozofie: **knihovna počítá, aplikace persistuje.** Lattice snapshoty stavu jen sestaví,
ukáže v UI a předá aplikaci; kde a jak se uloží (DB, sdílení mezi uživateli) řeší aplikace.

Vše se váže na **`options.id` gridu** — je to klíč pro localStorage i pro řádky v DB
(`grid_id`). Dva různé gridy = dvě různá `id` = oddělené presety i nastavení.

### Tři vrstvy

| Vrstva | Kdo ukládá | K čemu |
|---|---|---|
| **Lokální presety** | knihovna (localStorage) | Soukromé pojmenované pohledy jednoho uživatele. Bez kódu aplikace. |
| **Globální presety** | **aplikace** (DB) | Pojmenované pohledy **sdílené všem** (kdokoli uloží, kdokoli použije). |
| **Globální výchozí nastavení** | **aplikace** (DB) | „Výchozí tabulka" nastavená správcem — jak grid vypadá novému uživateli. |

### Tvar presetu

```js
{ id: 'uuid',            // vygeneruje knihovna
  name: 'PPC ≥ 100k',    // název od uživatele
  state: {               // = grid.captureState(parts); klíč CHYBÍ, když uživatel část odškrtl
    columns,             // pořadí/viditelnost/šířky/ukotvení/filtr-typ/souhrny/formát/vzorce
    sort,                // řazení
    filters,             // hodnoty filtrů
    instance,            // nastavení tabulky (`@v1.13.0`): seskupení řádků (groupBy/groupDisplay/
                         // groupRepeat), souhrnný řádek (summaryRow), mezisoučty skupin
                         // (groupSubtotals), stránkování, vzhled, formát hodnot…
  } }
```

Preset umí držet **vše, co si uživatel naklikal** v nastavení sloupců i v nastavení tabulky —
kliknutím na preset se obnoví i seskupení řádků, souhrnný řádek a mezisoučty skupin.

### Co se do presetu uloží (`@v1.13.0`)

Nad polem s názvem jsou v panelu presetů tři zaškrtávátka — uživatel si vybere, co preset ponese
(aspoň jedno musí zůstat zaškrtnuté):

| Volba | Klíče ve `state` | Obsah |
|---|---|---|
| **Sloupce** | `columns` | pořadí, viditelnost, šířky, ukotvení, souhrny, formáty, barvy záhlaví, počítané sloupce |
| **Filtry a řazení** | `sort`, `filters` | hodnoty filtrů v záhlaví + nastavené řazení |
| **Nastavení tabulky** | `instance` | seskupení řádků, souhrnný řádek, mezisoučty skupin, stránkování, vzhled, formát hodnot |

Programově totéž: `grid.captureState({ columns: true, filters: false, instance: true })`, resp.
`grid.presets.saveLocal(name, parts)` / `saveGlobal(name, parts)`. Bez `parts` se uloží vše.

**Klíčové pravidlo:** `applyPreset()` mění jen ty části, které snímek **obsahuje**. Preset
„jen filtry" tedy nesáhne na sloupce ani na seskupení. Co preset nese, zjistí
`grid.presetContents(preset)` (UI to ukazuje v tooltipu řádku).

> **Zpětná kompatibilita.** Preset uložený starší verzí `state.instance` nemá — při jeho použití
> se nastavení tabulky **nemění** (obnoví se jen sloupce/řazení/filtry), aby uživateli nezmizelo
> seskupení nebo motiv. Po přeuložení presetu už `instance` nese.
>
> Sbalení externího filtračního panelu (`externalFiltersCollapsed`) je přechodný stav UI, ne
> nastavení: do presetu ani do globálních výchozích se neukládá a zůstává uživateli tak, jak si
> ho nastavil.

### Globální presety — kontrakt

**Vstup** (aplikace → knihovna) při vytvoření instance:

| Option | Typ | Popis |
|---|---|---|
| `globalPresets` | `Array<{id,name,state,asButton?,asSelect?}>` | Presety načtené aplikací z DB (`WHERE grid_id = options.id`). Zobrazí se v nabídce s odznakem globusu; `asButton` / `asSelect` (`@v1.14.0`) je navíc propíšou do řady tlačítek presetů (vlastní řádek nad ikonami), resp. do výběru „— pohledy —" v toolbaru. |

**Výstup** (knihovna → aplikace) — callbacky, které si aplikace uloží do DB:

| Callback | Kdy se volá | Argument |
|---|---|---|
| `onSaveGlobalPreset(preset)` | uživatel uložil globální preset (tlačítko **globus**) nebo u něj přepnul zobrazení (tlačítko / výběr) | `{ id, name, state, asButton, asSelect }` (`asButton`/`asSelect` `@v1.14.0`) |
| `onDeleteGlobalPreset(preset)` | uživatel smazal globální preset (**×**) | `{ id, name }` |

Bez `onSaveGlobalPreset` se tlačítko globus vůbec neukáže (globální ukládání je vypnuté).
Knihovna preset po uložení rovnou přidá do své nabídky — nemusíš překreslovat ani znovu načítat.

### Globální rozšířené filtry — kontrakt

Uložené **rozšířené filtry** (strom pravidel z query-builderu) fungují stejným vzorem jako
presety: **lokální** (per-uživatel, localStorage) a **globální** (sdílené všem, spravuje
aplikace). Položka filtru je `{ id, name, tree }`, kde `tree` je strom podmínek
(`{ combinator: 'AND'|'OR', rules: [...] }`).

Stejným mechanismem (`@v1.11.0`) se ukládají i **snímky sloupcových filtrů** ze `saveFilterSnapshot`
— jen místo `tree` nesou `kind: 'columns'`, `filters` (mapa `field → hodnota`) a `filterTypes`
(nestandardní typy filtru u dotčených sloupců). Žijí ve **stejném seznamu** i callbacku; aplikace
je odliší podle přítomnosti `kind: 'columns'` (jinak stačí uložit celý objekt tak, jak přijde).

**Vstup** (aplikace → knihovna) při vytvoření instance:

| Option | Typ | Popis |
|---|---|---|
| `globalAdvancedFilters` | `Array<{id,name,tree,asButton?,asSelect?}>` \| `Array<{id,name,kind:'columns',filters,filterTypes,asButton?,asSelect?}>` | Filtry načtené aplikací z DB (`WHERE grid_id = options.id`) — stromy i snímky sloupcových filtrů. V nabídce (panel i quick-select v toolbaru) se odlišují glóbem (🌐). |

**Výstup** (knihovna → aplikace) — callbacky, které si aplikace uloží do DB:

| Callback | Kdy se volá | Argument |
|---|---|---|
| `onSaveGlobalAdvancedFilter(filter)` | uživatel uložil globální filtr (**globus** v panelu rozšířeného filtru nebo v panelu „uložit sloupcové filtry") | strom: `{ id, name, tree, asButton, asSelect }` · snímek: `{ id, name, kind:'columns', filters, filterTypes, asButton, asSelect }` (`asSelect` `@v1.14.0`) |
| `onDeleteGlobalAdvancedFilter(filter)` | uživatel smazal globální filtr (**×**) | `{ id, name }` |

Bez `onSaveGlobalAdvancedFilter` se globus v panelu rozšířeného filtru neukáže (globální
ukládání je vypnuté; `canSaveGlobalAdvanced()` vrací `false`). Globální filtry se
**nepersistují** do localStorage — zdrojem pravdy je aplikace, která je dodá při každém startu.

Programově: `grid.saveAdvanced(name, tree, 'global')` uloží globálně (spustí callback a vrátí
`{ id, name, tree, scope:'global' }`), bez třetího argumentu (nebo `'local'`) uloží lokálně.
Snímek sloupcových filtrů uloží obdobně `grid.saveFilterSnapshot(name, 'global')` (payload s
`kind:'columns'`). `grid.listAdvanced()` vrací obojí (stromy i snímky) sjednoceně, každou položku
se `scope: 'local' | 'global'`.

> **Server-side (`@v1.7.0+`):** výběr uloženého (i globálního) rozšířeného filtru jen nastaví
> `grid.advanced` a spustí refetch — a ten teď nese parametr `advanced` (viz *Server-side režim →
> Rozšířený filtr*). Uložené rozšířené filtry tak na server-side gridech fungují nativně, bez
> app-side obcházení `refresh()`.

### Globální výchozí nastavení (defaults) — kontrakt

Nastaví, jak grid vypadá **novému** uživateli, a umožní správci rozeslat aktualizaci.

**Vstup:**

| Option | Typ | Popis |
|---|---|---|
| `globalDefaults` | `{ version, state }` | `version` = monotónní číslo (např. `Date.now()` při uložení). `state` = `{ instance, columns, sort, filters }`. |

**Výstup:**

| Callback | Kdy | Argument |
|---|---|---|
| `onSaveGlobalDefaults(payload)` | správce uložil výchozí nastavení („Nastavení tabulky" → uložit globálně) | `{ version, state }` |

**Chování dle uživatele:**

- **Nový uživatel** (prázdný localStorage) → `globalDefaults.state` se automaticky použije (seed).
- **Existující uživatel** → jeho úpravy se **nepřepíšou**; nová verze se jen **nabídne** (odznak
  u ⚙). Přijme ji přes „Nastavení tabulky" (`applyGlobalDefaults()`), nebo ponechá své
  (`dismissGlobalDefaults()`). Rozhoduje `version` vs. uložené `state._gdVersion`.

### Tok dat

```
INICIALIZACE          aplikace → DB(grid_id) → globalPresets / globalDefaults → new Lattice(...)
ULOŽENÍ (uživatel)    UI → onSaveGlobalPreset / onSaveGlobalDefaults(payload) → aplikace → DB
POUŽITÍ (jiný user)   DB → globalPresets → nabídka → klik → applyPreset (uvnitř knihovny)
```

### Příklad: MySQL-backed globální presety

```sql
CREATE TABLE lattice_presets (
  id         VARCHAR(64)  PRIMARY KEY,     -- preset.id (uuid z knihovny)
  grid_id    VARCHAR(128) NOT NULL,        -- = options.id gridu
  name       VARCHAR(255) NOT NULL,
  state      JSON         NOT NULL,        -- preset.state (columns/sort/filters)
  as_button  TINYINT(1)   NOT NULL DEFAULT 0,  -- @v1.14.0: pilulka v rychlé řadě nad ikonami
  as_select  TINYINT(1)   NOT NULL DEFAULT 0,  -- @v1.14.0: položka v rozbalovacím výběru
  created_by VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (grid_id)
);
```

```js
const GRID_ID = 'obchodnici-prehled';     // stejné jako řádky v DB (grid_id)

new Lattice('#grid', {
  id: GRID_ID,
  columns, data,
  // NAČTENÍ: presety z DB pro tento grid
  globalPresets: await api.get(`/lattice/presets?grid=${GRID_ID}`),
  // ULOŽENÍ: knihovna sestaví preset, aplikace ho zapíše do DB
  onSaveGlobalPreset: (preset) =>
    api.post('/lattice/presets', { grid_id: GRID_ID, ...preset }),
  // SMAZÁNÍ:
  onDeleteGlobalPreset: ({ id }) =>
    api.delete(`/lattice/presets/${id}`),
});
```

Globální výchozí nastavení analogicky — tabulka `lattice_defaults(grid_id PK, version, state JSON)`:

```js
new Lattice('#grid', {
  id: GRID_ID, columns, data,
  globalDefaults: await api.get(`/lattice/defaults?grid=${GRID_ID}`),  // { version, state } | null
  onSaveGlobalDefaults: ({ version, state }) =>
    api.put(`/lattice/defaults/${GRID_ID}`, { version, state }),        // upsert dle grid_id
});
```

Globální **rozšířené filtry** stejným vzorem — tabulka
`lattice_advanced_filters(id PK, grid_id, name, tree JSON, …)` (obdoba `lattice_presets`,
jen místo sloupce `state` je `tree`):

```js
new Lattice('#grid', {
  id: GRID_ID, columns, data,
  // NAČTENÍ: uložené filtry z DB pro tento grid
  globalAdvancedFilters: await api.get(`/lattice/advanced-filters?grid=${GRID_ID}`),
  // ULOŽENÍ: knihovna sestaví { id, name, tree }, aplikace ho zapíše do DB
  onSaveGlobalAdvancedFilter: (filter) =>
    api.post('/lattice/advanced-filters', { grid_id: GRID_ID, ...filter }),
  // SMAZÁNÍ:
  onDeleteGlobalAdvancedFilter: ({ id }) =>
    api.delete(`/lattice/advanced-filters/${id}`),
});
```

> **Legacy adaptér** (stále podporovaný): místo `globalPresets` + callbacků lze dodat
> `options.presets = { global: { load(), save(preset), remove(id) } }` (async). Nové kódy
> ať používají `globalPresets` + `onSaveGlobalPreset` / `onDeleteGlobalPreset`.

> **Verze:** globální **presety** i **defaults** (`globalPresets`, `onSaveGlobalPreset`,
> `onDeleteGlobalPreset`, `globalDefaults`, `onSaveGlobalDefaults`) jsou k dispozici **od
> `v1.1.0`** — ve `v1.0.1` a starších je jen `applyPreset` + lokální presety. Přes CDN připni
> `@v1.1.0` (nebo novější). Globální **rozšířené filtry** (`globalAdvancedFilters`,
> `onSaveGlobalAdvancedFilter`, `onDeleteGlobalAdvancedFilter`, `saveAdvanced(name, tree, scope)`)
> jsou k dispozici **od `v1.5.0`**.

---

## Počítané sloupce (vzorce)

Sloupec může hodnotu **spočítat** — v kódu funkcí `value: (row) => …`, nebo **vzorcem**
`formula: '…'`. Vzorec je bezpečně vyhodnocený vlastním parserem (**žádný `eval` /
`new Function`**; čtou se jen data řádku a definované funkce). Sloupce s `formula` se
persistují (localStorage i presety) a uživatel je vytváří/upravuje v UI — dialog **Sloupce**
(ozubené kolo) → „＋ Přidat počítaný sloupec". Pole i **funkce** se vkládají klikáním (editor má
prohledávatelnou **referenci funkcí** rozdělenou do kategorií), je **živý náhled** výsledku a **typ**
sloupce se sám odvodí z výsledku vzorce.

```js
grid.addComputedColumn({ title: 'Marže %', type: 'number',
  formula: 'round((obrat - naklad) / obrat * 100, 1)' });
```

**Odkaz na sloupec:** holý název (`cena`) nebo `[Název s mezerami]`.
**Literály:** čísla (`3.14`), text (`'ahoj'` / `"ahoj"`; zdvojená uvozovka = escape), `true`/`false`/`null`.
**Operátory:** `+ - * / %`, porovnání `== != < <= > >=`, logika `&& || !`, ternár `a ? b : c`.
`+` **sčítá** jen když jsou obě strany číselné, jinak **spojuje text** (`jmeno + ' ' + prijmeni`).
Čísla se z textu koercují včetně `"1 234,56"`.

**Funkce:**

| Skupina | Funkce |
|---|---|
| Čísla | `round(x, des?)`, `floor`, `ceil`, `abs`, `sqrt`, `pow(a,b)`, `mod(a,b)`, `min(…)`, `max(…)`, `number(x)` |
| Text | `concat(…)`, `upper`, `lower`, `trim`, `len`, `left(s,n)`, `right(s,n)`, `substr(s,od,délka?)`, `replace(s,co,čím)`, `contains(s,co)`, `text(x)` |
| Logika | `if(podm, ano, ne)`, `coalesce(…)`, `isblank(x)`, `not(x)` |
| Datum | `today()`, `now()`, `date(x)`, `year/month/day/weekday(d)`, `days(od,do)`, `age(d)` |

Chyba za běhu (např. dělení nulou) → hodnota `undefined` (buňka zůstane prázdná, nic nespadne).
Počítané sloupce jsou **jen ke čtení**; řadí, filtrují, hledají i exportují se podle spočítané hodnoty.

### Agregační funkce (vážený souhrn řádku)

Souhrnný řádek sloupce lze počítat vzorcem přes **všechny řádky** (v rozsahu stránka/vše) — pole
`summaryFormula`, nebo v UI přes **Σ → „Vzorec (vážený souhrn)"**. Uvnitř agregace se argument
vyhodnotí pro každý řádek a výsledky se zredukují; mimo agregaci jsou jen skalární operace nad
výsledky. Proto lze psát **poolované poměry** i **vážené průměry** (matematicky správně, na rozdíl
od prostého průměru poměrů):

| Funkce | Význam |
|---|---|
| `sum(výraz)` | Součet výrazu přes řádky |
| `avg(výraz)` | Průměr výrazu přes řádky |
| `count(výraz)` | Počet neprázdných |
| `min/max/median(výraz)` | Nejmenší / největší / prostřední hodnota |

```js
{ field: 'dovolatelnost', title: 'Dovolatelnost %', type: 'number',
  formula: 'round(spojeno / vytoceno * 100, 1)',                 // per řádek
  summaryFormula: 'round(sum(spojeno) / sum(vytoceno) * 100, 1)',// souhrn (poolovaně)
  summaryFormulaLabel: 'Dovolatelnost' }                          // název řádku vlevo
// Vážený průměr: sum(cena * obchody) / sum(obchody)
```

Pravidla: **pole musí být uvnitř agregace** (`sum(spojeno)`, ne holé `spojeno`); agregace se
**nevnořují**. Skalární funkce (`round`, `abs`…) lze použít nad výsledkem: `round(avg(x), 2)`.

---

## Callbacky (options `on…`)

Grid nikdy nepersistuje sám — přes callbacky říká aplikaci, co se stalo.

| Callback | Kdy |
|---|---|
| `onRowClick(row, i, e)` | Levý klik na řádek. |
| `onCellClick(ctx, e)` | Levý klik na buňku (`{ row, value, field, index, col }`). |
| `onRowContext(row, i, e)` | Pravý klik na řádek. |
| `onCellEdit({ field, row, rowIndex, oldValue, newValue })` | Po přijetí inline editace. |
| `onCellValidate(ctx) => boolean` | Před přijetím editace (false = zamítnout). |
| `onCellInvalid({ field, row, value, error })` | Deklarativní validace zamítla editaci. |
| `onDataChange(action, rows)` | Po změně dat (add/update/delete/import…). |
| `onRowMove(payload)` / `onRowReceive(row, meta)` | Přesun / příjem řádku. |
| `onRangeCopy(data, tsv)` / `onRangePaste(changed)` / `onFill(changed)` | Rozsah buněk: kopie / vložení / fill. |
| `onSelectionChange(rows, keys)` | Změna výběru řádků. |
| `onHighlightChange(keys)` | Změna zvýraznění (podbarvení) řádků — pole klíčů (`@v1.8.0`). |
| `onSort(sort)` | Řazení — `[{ field, dir }]`. |
| `onFilter({ filters, universal, advanced })` | Změna filtrů. |
| `onPageChange({ page, pageSize })` | Změna stránky / velikosti. |
| `onColumnLayoutChange({ kind, detail, columns })` | Přesun/šířka/skrytí/ukotvení/skupina — pro uložení layoutu na backend. |
| `onDataLoad({ rows, total, … })` / `onError(err)` | Server-side načtení / chyba. |

---

## Veřejné exporty (ESM)

```js
import {
  Lattice,                       // hlavní třída
  registerType, getFormatter,    // vlastní datové typy
  registerFilter, getFilter,     // vlastní filtry
  registerLanguage, availableLanguages, I18n,
  Store,                         // per-grid persistence
  buildColumns, serializeColumns,
  ClientData, ServerData, encodeParams,
  openColorPicker, openHeaderColorPicker, HEADER_COLOR_PRESETS,
  VERSION,
} from 'lattice';
```

**Color picker** (stejný, jaký používá UI gridu):

```js
openColorPicker(anchorEl, {
  current: '#2563eb',            // výchozí barva (i rgba())
  alpha: true,                   // volitelný jezdec průhlednosti → vrací rgba(…)
  onPick: (color) => { … },      // vybraná barva
  onClear: () => { … },          // „Bez barvy"
  t: i18n.t.bind(i18n),          // volitelně překlad popisků
});
```

Nabízí barevné kolo, **Bootstrap palety** (`HEADER_COLOR_PRESETS` — 16 kombinací, plné i jemné)
a **paměť naposledy použitých** barev (per prohlížeč). `openHeaderColorPicker` je varianta
pro dvojici pozadí + písmo (písmo se dopočítá kontrastně).

---

## Themování

Motivy = přemapování CSS proměnných `--lattice-*` (barvy i struktura). Tři způsoby, jak vzhled ovlivnit:

1. **Hotový motiv** — `instance.theme` (`default`, `slate`, `minimal`, `compact`, `ocean`, `bootstrap5`, `tailwind`, `material`, …).
2. **Vlastní CSS soubor** — vlož `.lattice { --lattice-…: … }` **za** `dist/lattice.css`. Nejjednodušší je
   naklikat ho v **generátoru stylů** (`demo/styler.html`): naklikáš barvy (s alfa kanálem), písmo,
   tvary, rozestupy i okraje, vidíš živý náhled a stáhneš hotový `lattice-custom.css`.
3. **Per-instance** — `instance.cssVars: { '--lattice-accent': '#e91e63', … }` (inline na rootu gridu,
   vyhraje nad motivem i vlastním souborem).

### Proměnné

**Barvy plochy:** `--lattice-bg`, `--lattice-row-odd`, `--lattice-row-hover`, `--lattice-header-bg`,
`--lattice-header-color`, `--lattice-header-soft`, `--lattice-text`, `--lattice-muted`,
`--lattice-border`, `--lattice-accent`, `--lattice-accent-soft`, `--lattice-link`,
`--lattice-row-highlight-bg`, `--lattice-row-highlight-hover` (zvýraznění řádku, `@v1.8.0`).

**Sémantické a prvky:** `--lattice-danger(-soft)`, `--lattice-success(-soft)`, `--lattice-warn(-soft)`,
`--lattice-star-on/off`, `--lattice-progress-track/fill`, `--lattice-bool-true/false`.

**Okraje sloupců** (barva + šířka; platí hierarchie **ukotvený > skupinový > obyčejný**):
- obyčejné svislé linky — `--lattice-cell-vborder-color`, `--lattice-cell-vborder-width`
  (nebo celý shorthand `--lattice-cell-vborder`, `none` = bez linek),
- hrany skupin sloupců — `--lattice-group-border`, `--lattice-group-border-width`,
- dělící linka ukotvených sloupců — `--lattice-frozen-line`, `--lattice-frozen-line-width`.

**Spodní linky záhlaví** (barva + šířka): pod řádkem skupin `--lattice-group-border-bottom-color/-width`,
pod řádkem záhlaví `--lattice-header-border-color/-width`, pod řádkem filtrů `--lattice-filter-border-color/-width`.

**Typografie a tvar:** `--lattice-font`, `--lattice-font-size`, `--lattice-header-font`,
`--lattice-header-weight/-size/-transform/-spacing`, `--lattice-radius`, `--lattice-control-radius`,
`--lattice-cell-pad-x/y`, `--lattice-header-pad-y`, `--lattice-max-height`.

> **Pozn.:** `--lattice-font`, `--lattice-font-size`, `--lattice-bool-true` a `--lattice-bool-false`
> nastavuje grid **inline** na rootu; ve vlastním CSS souboru je proto přebij s `!important`
> (generátor stylů to dělá automaticky).

Tmavý režim: `theme: 'slate'` nebo `theme: 'auto'` (dle `prefers-color-scheme`).

---

## Lokalizace

Vestavěné `cs` / `en`. Vlastní jazyk: `registerLanguage('de', dict)` (stejná struktura jako
`src/i18n/en.js`) nebo rovnou `i18n: dictObject`. Za běhu `grid.setLanguage('en')`.
