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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/svatekr70/lattice@v1.1.0/dist/lattice.css">
<div id="grid"></div>
<script type="module">
  import { Lattice } from 'https://cdn.jsdelivr.net/gh/svatekr70/lattice@v1.1.0/dist/lattice.min.js';
  new Lattice('#grid', { id: 'moje', columns, data });
</script>
```
Pro produkci připni verzi (`@v1.1.0`) nebo commit; `@main` je „vždy nejnovější" (jsDelivr
cachuje větev ~12 h).

**npm:**
```bash
npm i lattice
```
```js
import { Lattice } from 'lattice';
import 'lattice/css';
```

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
| `serverSide` / `ajaxUrl` / `progressiveLoad` | Server-side režim. Grid posílá `page, size, sort[], filter[], search`, čeká `{ data, total }`. `progressiveLoad: 'scroll' \| 'load'` = donačítání. |
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
| `actions` | Sloupec akcí: `[{ name, onClick(row), disabled?(row), visible?(row), danger? }]`. Styl řídí `instance.actionsLayout`. |
| `rowContextMenu` / `cellContextMenu` | Kontextové menu řádku / buňky: `(ctx) => [{ label, action, disabled? }]`. |
| `rowClass` / `rowStyle` | Podmíněné formátování řádku (třídy / inline styl dle dat). |
| `i18n` | `'cs'` \| `'en'` \| vlastní slovník / objekt. |
| `helpUrl` | URL nápovědy — ikona **?** v toolbaru (vpravo od ⚙, otevírá se v nové kartě). Default oficiální příručka; `null` ikonu skryje. |
| `storage` | Vlastní `Storage` (default `localStorage`; lze in-memory shim). |
| `globalPresets` / `onSaveGlobalPreset` / `onDeleteGlobalPreset` | Sdílené (globální) presety — aplikace je dodá a persistuje. Viz *Presety a globální nastavení*. |
| `globalDefaults` / `onSaveGlobalDefaults` | Globální výchozí nastavení tabulky od správce. Viz *Presety a globální nastavení*. |
| `on…` callbacky | Viz *Callbacky*. |

---

## Definice sloupce

| Vlastnost | Typ | Popis |
|---|---|---|
| `field` | string | Klíč v datovém objektu (u computed sloupce jen identita). |
| `title` | string | Popisek hlavičky (výchozí = `field`). |
| `type` | string | Datový typ → formát a výchozí filtr (viz *Typy*). |
| `value` | function | `(row) => any` — odvozená (computed) hodnota z celého řádku. Řadí/filtruje/hledá/exportuje se podle ní; needituje se. |
| `formula` | string | Počítaný sloupec zadaný **vzorcem** (řetězec, viz *Počítané sloupce*). Bezpečně se vyhodnotí (bez `eval`) → `value`. Sloupec s `formula` se persistuje (i v presetech) a jde vytvořit/upravit v UI. |
| `validator` | various | Deklarativní validace editace: `'required'` \| RegExp \| `{ required, min, max, minLen, maxLen, pattern, message }` \| `fn(v,row) => true\|string` \| pole pravidel. |
| `width` / `minWidth` | number | Šířka v px (uživatel může měnit tažením) / minimální šířka. |
| `align` | `'left'\|'center'\|'right'` | Zarovnání (jinak dle typu: čísla/datum/`id` vpravo, boolean na střed). |
| `frozen` | `true\|'left'\|'right'` | Ukotvení sloupce. `'never'` zakáže ukotvení uživatelem. |
| `group` | string | Skupina sloupců (spojí sousední sloupce pod společné záhlaví). |
| `filter` | string | Typ filtru; když se vynechá, odvodí se z typu. |
| `filterValues` | array | Hodnoty pro `select`/`multiselect` filtr (jinak `filterUrl`). |
| `editable` | boolean | Povolí inline editaci buňky. |
| `editor` / `editorParams` | string/object | Vlastní editor (`'select'`, `'multiselect'`, …). |
| `headerSort` | boolean | Řazení klikem na hlavičku (výchozí `true`). |
| `formatter` | function | `(value, col, row) => string \| Node` — vlastní vykreslení buňky (má přednost před `type`). |
| `formatterParams` | object | Parametry formátovače daného typu. |
| `summary` / `rowSummary` | string[] | Souhrnné funkce sloupce (dole) / řádku (vpravo): `['sum','avg','min','max','count']`. |
| `summaryFormula` (+ `summaryFormulaLabel`) | string | **Vážený / poolovaný souhrn** vzorcem z agregací jiných sloupců — např. `sum(spojeno) / sum(vytoceno) * 100`. Viz *Počítané sloupce → agregační funkce*. `summaryFormulaLabel` = název řádku vlevo (sloupce se stejným názvem sdílejí řádek). |
| `condFormat` | object | Barevná škála („semafor"): `{ on:true, levels:3\|5\|7, reverse?, colors?, mode?, thresholds? }`. |
| `cellClass` / `cellStyle` | function | Podmíněné třídy / inline styl buňky dle hodnoty. |
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
| `boolean` / `tick` | Ano/Ne (✓/✕, barvy ze škály) / jen ✓ když pravda. |
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
| `select` / `multiselect` | kdykoli | Výběr jedné / více hodnot (potřebuje `filterValues` nebo `filterUrl`). |
| `boolean` | boolean | Ano / Ne / Vše. |

**Umístění filtrů** řídí `instance.filterLayout`: `'header'` (v záhlaví) \| `'external'` (panel nad
tabulkou) \| `'universal'` (jedno pole Pole/Typ/Hodnota) \| `'none'`. Navíc **rozšířený filtr**
(strom AND/OR pravidel) přes `grid.applyAdvanced(tree)`. Vlastní filtr: `registerFilter(name, def)`.

> **Tree:** filtry i rychlé hledání fungují i ve stromovém zobrazení — zachovají cestu k nálezu
> (rodiče) a větev se shodou se rozbalí.

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
| `summaryRow` | `'none'` \| `'page'` \| `'all'` |
| `groupBy` | seskupení řádků (víceúrovňové): `null`, `field`, nebo pole. Položka je buď název pole (`'region'`), nebo `{ field, part }` pro **datumové úrovně** — `part` ∈ `year, quarter, month, week, weekday, day, hour, minute`. Víc úrovní se zanoří (`[{field:'createdAt',part:'year'},{field:'createdAt',part:'quarter'}]`); datumové skupiny se řadí chronologicky. |
| `groupDisplay` | jak zobrazit úrovně: `'headers'` (vnořené sbalitelné hlavičky, výchozí) \| `'columns'` (ploché řádky). V OBOU režimech se seskupené úrovně vykreslí jako **ukotvené vedoucí sloupce vlevo** (při horizontálním scrollu zůstanou stát, reálné sloupce odjedou za nimi); `'headers'` k tomu navíc přidá sbalitelné lišty skupin. |
| `groupRepeat` | v režimu `'headers'`: opakovat hodnotu seskupení v každém řádku (`true`, výchozí) \| nechat vedoucí sloupce prázdné a hodnotu jen v liště skupiny (`false`). |
| `groupSubtotals` | `true` = mezisoučty za skupiny |
| `actionsLayout` | `'column'` (sloupec) \| `'menu'` (⋮ trojtečkové) |
| `selectRowClick` | `true` = výběr i klikem na řádek (jinak jen checkbox) |
| `resizeGuide` | `true` = vodicí čára při změně šířky |
| `zebra` / `wrapText` / `emptyText` | pruhování / zalamování / placeholder prázdné buňky |
| `linkNewTab` | odkazy (typ `link`) otevírat v nové kartě + ikona externího odkazu. Per-sloupec přebije `formatterParams.target`. |
| `scaleColors` | kotevní barvy semaforu `[low, mid, high]` (ovlivní condFormat i boolean ✓/✕) |
| `cssVars` | vlastní CSS proměnné `{ '--lattice-accent': '#e91e63', … }` |
| `fontSize` / `fontFamily` | velikost / rodina písma |
| `format` | globální formát po druzích: `{ number, money, date, datetime, time }` |

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
| `applyAdvanced(tree)` / `saveAdvanced(name, tree)` | Rozšířený filtr (strom pravidel). |
| `setPage(n)` / `setPageSize(n)` | Stránkování. |
| `setInstance(patch)` | Nastavení tabulky (theme, layout, …). |
| `setFormat(kind, patch)` / `setColumnFormat(field, patch)` | Formát globálně / per-sloupec. |
| `setColumnSummary / setColumnRowSummary(field, fns)` | Souhrny sloupce / řádku. |
| `setColumnSummaryFormula(field, formula, label?)` | Vážený souhrn sloupce vzorcem (`null` zruší). `label` = název řádku. |
| `addComputedColumn({ title, type, formula })` | Přidá **počítaný sloupec** ze vzorce (vrátí jeho `field`). Vyhodí `FormulaError` u neplatného vzorce. |
| `updateComputedColumn(field, { title?, type?, formula? })` | Upraví počítaný sloupec (zachová šířku/pořadí/souhrny/formát). |
| `removeComputedColumn(field)` | Odebere počítaný sloupec (jen sloupce vytvořené vzorcem). |
| `setPinnedRows({ top?, bottom? })` | Připnuté řádky za běhu. |
| `getSelectedRows()` / `getSelectedKeys()` / `clearSelection()` | Výběr. |
| `getColumnLayout()` | Snímek layoutu sloupců. |
| `undo()` / `redo()` / `clearHistory()` | Historie. |
| `exportData(fmt, opts)` / `download(fmt, opts)` / `print(opts)` | Export (`csv \| tsv \| json \| xml \| excel`) / tisk. Excel = SpreadsheetML, bez závislosti. |
| `importFile(file)` / `importFromUrl(url, i, opts)` / `importHTMLTable` / `importXML` | Import. |
| `setLanguage(lang)` | Změna jazyka. |
| `applyPreset(preset)` | Aplikace presetu. |
| `refresh()` | Znovunačtení/překreslení. |
| `destroy()` | Zrušení instance. |
| `hasGlobalDefaults()` / `globalDefaultsAvailable()` | Jsou k dispozici globální výchozí nastavení / je nová verze, kterou uživatel ještě neviděl. |
| `applyGlobalDefaults()` / `dismissGlobalDefaults()` | Použít globální výchozí nastavení teď / potvrdit verzi bez použití. |
| `setGlobalDefaults()` | Uložit aktuální nastavení jako globální výchozí (spustí `onSaveGlobalDefaults`). |

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
  state: {               // = grid.captureState()
    columns,             // pořadí/viditelnost/šířky/ukotvení/filtr-typ/souhrny/formát/vzorce
    sort,                // řazení
    filters,             // hodnoty filtrů
  } }
```

### Globální presety — kontrakt

**Vstup** (aplikace → knihovna) při vytvoření instance:

| Option | Typ | Popis |
|---|---|---|
| `globalPresets` | `Array<{id,name,state}>` | Presety načtené aplikací z DB (`WHERE grid_id = options.id`). Zobrazí se v nabídce s odznakem globusu. |

**Výstup** (knihovna → aplikace) — callbacky, které si aplikace uloží do DB:

| Callback | Kdy se volá | Argument |
|---|---|---|
| `onSaveGlobalPreset(preset)` | uživatel uložil globální preset (tlačítko **globus**) | `{ id, name, state }` |
| `onDeleteGlobalPreset(preset)` | uživatel smazal globální preset (**×**) | `{ id, name }` |

Bez `onSaveGlobalPreset` se tlačítko globus vůbec neukáže (globální ukládání je vypnuté).
Knihovna preset po uložení rovnou přidá do své nabídky — nemusíš překreslovat ani znovu načítat.

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

> **Legacy adaptér** (stále podporovaný): místo `globalPresets` + callbacků lze dodat
> `options.presets = { global: { load(), save(preset), remove(id) } }` (async). Nové kódy
> ať používají `globalPresets` + `onSaveGlobalPreset` / `onDeleteGlobalPreset`.

> **Verze:** globální **presety** i **defaults** (`globalPresets`, `onSaveGlobalPreset`,
> `onDeleteGlobalPreset`, `globalDefaults`, `onSaveGlobalDefaults`) jsou k dispozici **od
> `v1.1.0`** — ve `v1.0.1` a starších je jen `applyPreset` + lokální presety. Přes CDN připni
> `@v1.1.0` (nebo novější).

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
| `onCellEdit({ field, row, oldValue, newValue })` | Po přijetí inline editace. |
| `onCellValidate(ctx) => boolean` | Před přijetím editace (false = zamítnout). |
| `onCellInvalid({ field, row, value, error })` | Deklarativní validace zamítla editaci. |
| `onDataChange(action, rows)` | Po změně dat (add/update/delete/import…). |
| `onRowMove(payload)` / `onRowReceive(row, meta)` | Přesun / příjem řádku. |
| `onRangeCopy(data, tsv)` / `onRangePaste(changed)` / `onFill(changed)` | Rozsah buněk: kopie / vložení / fill. |
| `onSelectionChange(rows, keys)` | Změna výběru řádků. |
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
  VERSION,
} from 'lattice';
```

---

## Themování

Motivy = přemapování CSS proměnných `--lattice-*` (barvy i struktura). Instance je lze přepsat
přes `instance.cssVars` (inline na rootu, vyhraje nad motivem). Klíčové proměnné:

`--lattice-bg`, `--lattice-row-odd`, `--lattice-row-hover`, `--lattice-header-bg`,
`--lattice-border`, `--lattice-text`, `--lattice-muted`, `--lattice-accent`,
`--lattice-accent-soft`, `--lattice-danger`, `--lattice-success`, `--lattice-star-on/off`,
`--lattice-progress-track/fill`, `--lattice-frozen-line`, `--lattice-bool-true/false`,
`--lattice-radius`, `--lattice-font`, `--lattice-font-size`, `--lattice-cell-pad-x/y`.

Tmavý režim: `theme: 'slate'` nebo `theme: 'auto'` (dle `prefers-color-scheme`).

---

## Lokalizace

Vestavěné `cs` / `en`. Vlastní jazyk: `registerLanguage('de', dict)` (stejná struktura jako
`src/i18n/en.js`) nebo rovnou `i18n: dictObject`. Za běhu `grid.setLanguage('en')`.
