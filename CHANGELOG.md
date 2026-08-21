# Changelog

Všechny podstatné změny v tomto projektu. Formát vychází z
[Keep a Changelog](https://keepachangelog.com/cs/1.1.0/); projekt používá
[sémantické verzování](https://semver.org/lang/cs/).

## [1.15.0] – 2026-08-21

Verze knihovny na očích: v patičce gridu a v nové záložce „O Lattice" v nastavení, kde je
i changelog — co které vydání přineslo. Bez breaking changes.

### Přidáno
- **Verze knihovny v patičce gridu** — `Lattice x.y.z` pod „Zobrazeno X-Y z N" (schválně tam,
  aby neodsunula stránkování z místa, na které jsou uživatelé zvyklí). Ať je hned vidět, s jakou
  verzí uživatel pracuje a v jaké verzi je hlášený problém.
- **Nastavení tabulky → záložka „O Lattice"** — co Lattice je, autor a licence, odkazy
  (uživatelská příručka podle `options.helpUrl`, ukázky a dokumentace, GitHub) a **changelog
  přímo v tabulce**: seznam vydání se shrnutím, každé se dá **rozkliknout** na body změn
  (aktuální vydání je zvýrazněné a rovnou rozbalené), dole odkaz na úplný CHANGELOG.
  Verze je v patičce dialogu vidět **vždy**, i když si ji uživatel v tabulce vypne.
- **`instance.showVersion`** (výchozí `true`) — přepínač „Verze knihovny v patičce" v *Nastavení
  tabulky → Vzhled*; persistuje se a nese se i v presetu. Aplikace může verzi zakázat natvrdo
  přes `features: { version: false }` — pak se volba v nastavení ani nenabídne.
- **`npm run releases`** — vygeneruje `src/releases.js` (seznam vydání pro záložku „O Lattice")
  z `CHANGELOG.md`; test hlídá, že nejnovější položka odpovídá `VERSION`.
- **Export metadat** — `VERSION`, `HOMEPAGE`, `HELP_URL`, `DEMO_URL`, `GITHUB_URL`, `AUTHOR`,
  `LICENSE` z `src/version.js` (jediný zdroj pravdy; test hlídá shodu `VERSION` s `package.json`).

### Změněno
- **Dialog „Nastavení tabulky" je širší** (880 px), ať se řada záložek včetně „O Lattice" vejde
  na jeden řádek.

## [1.14.0] – 2026-08-21

Uložené pohledy pod jednou střechou: **preset se dá vystavit jako tlačítko** stejně jako uložený
filtr a nově si u obojího vybíráš, jestli má být **tlačítko**, **výběr**, nebo obojí. V záhlaví
je poznat, co je co, bez popisků. Bez breaking changes.

### Přidáno
- **Preset jako tlačítko / ve výběru.** V panelu presetů („Sloupce") jsou vedle pole s názvem
  zaškrtávátka **tlačítko** a **výběr**; u každého už uloženého presetu jsou tytéž dva přepínače
  přímo v jeho řádku, takže se kvůli změně nemusí ukládat znovu. Klik na pilulku preset použije.
- **Tlačítka rozlišují čtyři druhy položek** — globální/lokální preset a globální/lokální filtr —
  a nezaberou kvůli tomu víc místa: **ikona = druh** (záložka = preset, trychtýř = filtr),
  **barva = rozsah** (šedá na bílé = jen moje, modrá na světle modré = globální); aktivní položka
  je vyplněná akcentem. Tooltip říká druh i rozsah slovy, u presetu i to, které části nese.
- **Rozmístění v záhlaví:** tlačítka **uložených filtrů** jsou v řadě ikon hned **vlevo od
  filtračních ikon**, tlačítka **presetů** o **řádek výš** — bez presetu jako tlačítka se ten
  řádek vůbec nevykreslí a záhlaví zůstane jednořádkové.
- **Volba „jako výběr" u uložených filtrů** (panel rozšířeného filtru i „Uložit sloupcové filtry").
  V toolbaru jsou vedle sebe **dva výběry**: vlevo **„— uložené filtry —"**, vpravo **„— pohledy —"**
  (každý jen když v něm něco je); globální položky nesou glóbus 🌐. Filtrů i pohledů tak může být
  hodně, aniž by zaplavily záhlaví. Vyprázdnění výběru presetů vrátí výchozí zobrazení.
- **Druhý klik na tlačítko presetu vrátí výchozí zobrazení.** Preset se tak přepíná stejně jako
  uložený filtr. „Výchozí zobrazení" = sloupce a nastavení tabulky jako po startu bez presetu;
  **filtry, řazení i rychlé hledání zůstávají v platnosti**, protože to není součást zobrazení.
- **Správa uložených položek rovnou z rychlé řady.** Pravý klik na pilulku otevře menu:
  použít / vypnout, **Upravit…** (otevře příslušný panel s načteným filtrem, resp. panel
  „Sloupce" u presetu), **Zobrazit jako tlačítko** / **Zobrazit ve výběru** a **Smazat**.
- **Panel „Uložené filtry"** (ikona trychtýř + disketa) je teď i správcem: v seznamu jsou
  **všechny** uložené filtry (snímky sloupcových filtrů i stromy z rozšířeného filtru).
  U každého: klik na název ho zapne/vypne, **tužka (nebo dvojklik na název) ho přejmenuje**,
  **disketa u položky ho přepíše tím, co je právě naklikané v hlavičce** (tak se mění obsah
  uloženého filtru — žádné zvláštní „režimy úprav"), dva přepínače řídí zobrazení a **×** maže.
  U stromového filtru je místo diskety ikona query-builderu → otevře ho k úpravě podmínek. Ikona je dostupná i bez aktivního
  sloupcového filtru (jakmile je co spravovat); řádek pro uložení se ukáže, jen když je co ukládat.
- **API:** `grid.overwriteSavedFilter(id)` a `grid.renameSavedFilter(id, name)`.
- **API:** `grid.togglePreset(preset)`, `grid.resetView()`, `grid.setAdvancedDisplay(id, key, on)`,
  `grid.buttonPresets()` / `grid.selectPresets()` / `grid.selectAdvanced()`,
  `presets.saveLocal(name, parts, display)` / `saveGlobal(name, parts, display)` /
  `setDisplay(preset, key, on)`, kde `display` je `{ button, select }`.

### Změněno
- **Presetům se v UI říká „pohledy".** Všechny uživatelské texty (panel v dialogu „Sloupce",
  tooltipy, placeholder výběru `— pohledy —`) mluví o **pohledech**; v API a dokumentaci pro
  vývojáře zůstává `preset` beze změny.
- **`saveAdvanced(name, tree, scope, display)` a `saveFilterSnapshot(name, scope, display)`**
  berou místo booleanu `asButton` objekt `{ button, select }`. **Legacy boolean funguje dál**
  se stejným významem jako dosud (`true` = jen tlačítko, `false` = jen výběr) a uložené položky
  bez `asSelect` (z verzí do 1.13.1) se chovají postaru — co není tlačítko, je ve výběru.
- **Uložení preset se stejným názvem zachová `id`** (jako u filtrů), takže downstream upsert
  v aplikaci přepíše tentýž řádek místo zakládání nového.
- **Callback `onSaveGlobalPreset` nese i `asButton` / `asSelect`** (a volá se i při přepnutí
  zobrazení u už uloženého globálního presetu) — aplikace si volbu uloží k presetu. Totéž
  `onSaveGlobalAdvancedFilter` s `asSelect`. Doporučené sloupce v DB: `as_button`, `as_select`.
- **Panel „Uložit sloupcové filtry" je o kus širší** (390 px), aby se název, obě volby zobrazení
  i tlačítka vešly na jeden řádek.

## [1.13.1] – 2026-08-20

Oprava instalačních instrukcí. Beze změny kódu knihovny.

### Opraveno
- **`npm i lattice` instaloval cizí balíček.** Jméno `lattice` na npmjs.com patří jinému projektu
  (`openlattice/lattice-js`) — kdo se řídil dokumentací, stáhl si něco úplně jiného. Napříč
  README, API dokumentací, webem i dokumentací v demu je teď správný postup
  `npm i github:svatekr70/lattice#v1.13.1` (importy `from 'lattice'` zůstávají stejné, `dist/` je
  v repu, takže se nic nebuilduje) a výslovné varování před `npm i lattice`.
- **Zastaralý příklad tagu.** README i dokumentace v demu radily připnout `@v0.1.0`.

### Změněno
- `package.json` má `private: true` — pojistka proti publikaci pod cizím jménem. Na instalaci
  z GitHubu to nemá vliv.

## [1.13.0] – 2026-08-20

Presety si pamatují i nastavení tabulky — seskupení řádků, souhrnný řádek a mezisoučty skupin —
a u ukládání se dá zaškrtnout, které části preset ponese. Bez breaking changes.

### Přidáno
- **Preset nese nastavení tabulky.** `captureState()` nově ukládá i celou `instance`, takže
  lokální i globální preset obnoví **seskupení řádků** (`groupBy`, `groupDisplay`, `groupRepeat`),
  **souhrnný řádek** (`summaryRow`), **mezisoučty skupin** (`groupSubtotals`) a zbytek nastavení
  tabulky (stránkování, vzhled, formát hodnot, vlastní CSS proměnné). Preset tak drží úplně
  všechno, co si uživatel naklikal v nastavení sloupců i v nastavení tabulky.
- **Volba, co se do presetu uloží.** V panelu presetů jsou nad polem s názvem tři zaškrtávátka —
  **Sloupce**, **Filtry a řazení**, **Nastavení tabulky**. Uživatel si tak uloží třeba preset
  „jen filtry" nebo „jen rozvržení sloupců"; aspoň jedna část musí zůstat zaškrtnutá. Volba drží
  mezi otevřeními panelu a tooltip u tlačítek i u uloženého presetu říká, co nese.
- **`captureState(parts)`** — `{columns, filters, instance}` vybírá, co snímek zachytí (bez
  argumentu vše). Propsáno i do `presets.saveLocal(name, parts)` / `saveGlobal(name, parts)`.
- **`captureInstance()`** — veřejný snímek nastavení tabulky (používá ho preset i globální
  výchozí nastavení).
- **`presetContents(preset)`** — které části preset nese (pro UI a aplikaci).

### Změněno
- **`applyPreset()` mění jen to, co snímek obsahuje.** Chybějící část zůstane, jak ji uživatel má
  — díky tomu fungují částečné presety i staré presety bez `instance`.
- **Snapshot je hluboká kopie.** `instance` v presetu i v globálních výchozích se kopíruje do
  hloubky — pozdější změna `cssVars` / `format` / `groupBy` už uložený snímek nepřepíše.
- **Sbalení externího filtračního panelu se nesdílí.** `externalFiltersCollapsed` je přechodný
  stav UI, ne nastavení: do presetu ani do globálních výchozích nepatří a při jejich použití
  zůstane uživateli tak, jak si ho nastavil.

### Opraveno
- **„Obnovit výchozí" v dialogu „Sloupce" ruší i seskupení řádků.** Seskupení se zapíná v tomtéž
  dialogu u sloupce a sloupce přeskupuje (seskupený sloupec se stěhuje dopředu a ukotví se), takže
  reset, který ho nechal zapnuté, výchozí stav ve skutečnosti neobnovil. Nově se vrací i
  `groupBy`/`groupDisplay`/`groupRepeat` (na hodnoty z `options.instance`, ne natvrdo na prázdno)
  a zahodí se sbalené skupiny řádků i sloupců. Zbytek nastavení tabulky reset nemění.
- **Dialog „Sloupce" neuteče pod spodní hranu okna.** Panel se otevíral vždycky pod kotvícím
  tlačítkem bez ohledu na to, kolik místa pod ním zbývá — u dlouhého seznamu sloupců, nízko
  posazeného toolbaru nebo malého okna mu pak konec visel mimo obrazovku. Nově se v takovém
  případě posadí výš, tak akorát nad spodní okraj (výšku dál drží `max-height: 70vh`). Platí i pro
  pod-nabídky (seskupení, souhrn, formát).
- **Dialog „Sloupce" už neodskakuje.** Preset s nastavením tabulky překreslí toolbar, takže kotvící
  tlačítko dialogu zmizí — panel se dřív přepočítal z nulového rectu a skončil v levém horním rohu.
  Teď se v takovém případě prostě zavře. Týkalo se i „Použít globální výchozí nastavení".

### Zpětná kompatibilita
- **Starý preset (bez `state.instance`) nastavení tabulky nemění.** Použije se z něj jen
  pořadí/viditelnost sloupců, řazení a filtry — seskupení, souhrny ani motiv uživateli
  nezmizí. `instance` začne nést po přeuložení presetu.

## [1.12.0] – 2026-08-12

Dynamické období napříč filtry — hranice týdne/měsíce/kvartálu/roku, našeptávač a živé presety
v kalendáři. Bez breaking changes.

### Přidáno
- **Tokeny pro hranice období.** K `today`/`now` přibyly `sow`/`eow` (začátek/konec týdne, Po–Ne),
  `som`/`eom` (měsíc), `soq`/`eoq` (kvartál), `soy`/`eoy` (rok) — s volitelným offsetem
  (`sow-1w`, `eom-1m`, …). Offset se aplikuje nejdřív, pak zarovnání na hranici, takže `eom-1m` =
  poslední den minulého měsíce i u kratších měsíců. Funguje v dynamickém i rozšířeném filtru.
- **Našeptávač u dynamického filtru.** U pole je tlačítko **„?"** s hotovými obdobími (Dnes,
  Minulý týden, Tento měsíc…) — klik výraz vyplní a rovnou aplikuje; plus stručná reference zápisu.
- **Dynamická období v `date-range` pickeru.** Přepínač **„dynamické období"** v dialogu: zapnutý →
  klik na preset uloží token (`{from:'sow-1w', to:'eow-1w'}`) místo pevných dat, takže uložený
  filtr/preset/snímek **zůstane živý** (za týden „Minulý týden" = zase minulý týden). V poli to
  značí `↻` + název období; ruční výběr v kalendáři zůstává pevný. `match`/`toServer` date-range
  filtru tokeny rozvíjejí (pevná data beze změny).

### Změněno
- **Demo, příručka a API dokumentace** doplněny o hranice období, našeptávač a dynamické date-range presety.

## [1.11.0] – 2026-08-12

Dynamický datumový filtr a ukládání „naklikaných" sloupcových filtrů. Bez breaking changes.

### Přidáno
- **Filtr sloupce – „Dynamické" (u datumových sloupců).** Třetí typ vedle „Datum (rozsah)" a
  „Datum (Od / Do)": do jednoho pole se napíše vlastní výraz s operátory `>` `<` `>=` `<=` `=`,
  spojkami `AND`/`OR` (AND váže těsněji) a pevnými i relativními datumy (`today±N[dwmy]`, `now`).
  Např. `>today-14 AND <today+14`. Relativní datum se přepočítává podle dneška; chybný výraz se
  tiše ignoruje (nápověda syntaxe v tooltipu). Server-side: AND klauzule se posílají jako běžné
  `>=`/`<=` parametry s konkrétními datumy.
- **Uložení „naklikaných" sloupcových filtrů (snímek).** Nová ikona v toolbaru (trychtýř + disketa,
  viditelná jen když nějaký sloupcový filtr platí) uloží aktuální filtry z hlavičky pod názvem —
  **lokálně nebo globálně**, volitelně **jako tlačítko**. Snímky žijí ve stejném seznamu (select +
  řada tlačítek) i callbacku jako uložené rozšířené filtry; načtení je vrátí zpět do políček hlavičky.
  Nové API: `saveFilterSnapshot(name, scope?, asButton?)`, `applyFiltersSnapshot(snap)`,
  `clearColumnFilters()`, `hasColumnFilters()`. Globální callback `onSaveGlobalAdvancedFilter`
  dostane u snímku payload `{ id, name, kind:'columns', filters, filterTypes, asButton }`.

### Změněno
- **Sjednocení velikosti filtr ikon.** Trychtýře „uložit filtry" a „rozšířený filtr" měly menší
  tvar; srovnány na stejný jako „zrušit filtry".
- **Demo + příručka + API dokumentace** doplněny o obě novinky (dynamický filtr, snímky) a o
  uživatelské globální presety.

## [1.10.0] – 2026-08-12

Uložené rozšířené filtry lze zobrazit jako tlačítka. Bez breaking changes.

### Přidáno
- **Rozšířený filtr – „jako tlačítko".** U uloženého filtru (lokálního i globálního) lze
  zaškrtnout, že se má vykreslit jako **tlačítko v řadě nad ikonami** v pravém záhlaví tabulky,
  místo položky v rozbalovacím selectu. Klik na tlačítko funguje jako **přepínač** (zapnout/
  vypnout); aktivní filtr je zvýrazněný. Filtry označené jako tlačítko se ze selectu vynechají
  (nezdvojují se). Nové API: `saveAdvanced(name, tree, scope, asButton)`, `buttonAdvanced()`,
  `toggleSavedAdvanced(id)`. U globálních filtrů dostane `asButton` i callback
  `onSaveGlobalAdvancedFilter` k perzistenci na straně aplikace.

## [1.9.0] – 2026-08-08

Opravný release z hloubkového auditu — správnost napříč vzorci, filtry, výběrem,
řazením a exportem. Bez breaking changes.

### Opraveno
- **Vzorce – porovnání datumů.** `num()` parsovalo `"2024-03-15"` přes `parseFloat` na
  `2024` (rok) a `today()`/`now()` vrací epoch ms → `[termin] < today()` bylo **vždy pravda**
  a `[start] < [konec]` porovnávalo jen roky. Nově se datumy (Date i `YYYY-MM-DD[ HH:MM]`)
  porovnávají jako datumy (lokální čas, konzistentně s `today()`/`now()`).
- **Rozšířený filtr – prázdná podskupina pod `OR`.** Prázdná/nedokončená podskupina vracela
  `true` a pod `OR` rodičem **propustila všechny řádky**. Nyní se neúčinné podskupiny a podmínky
  bez operátoru ignorují (neutrální prvek).
- **Rozšířený filtr – prázdné pole a `lt/lte/gt/gte`.** Prázdné/chybějící pole se řadilo jako
  „menší než cokoli" a splnilo `lt/lte`. Nově prázdné pole žádné ordering nesplní.
- **Rozšířený filtr – relativní tokeny `today±Nm/y`.** Přetékaly na konci měsíce
  (`31.1 + 1m` → `3.3.` místo `28.2.`). Nově se den ořízne na poslední den cílového měsíce.
- **Progresivní načítání – race.** `loadMore()` neměl request-id guard; opožděná odpověď mohla
  přisypat staré řádky na akumulátor resetovaný souběžným `refresh()`. Doplněn stejný token jako v `refresh()`.
- **Nastavení – `pageSize` přes `setInstance()`.** `setInstance({ pageSize })` nesynchronizoval
  `this.pageSize` (čte ho `refresh()`/pager) → změna se projevila až po reloadu. Nyní synchronizuje.
- **Výběr rozsahu vs. připnuté řádky.** Připnuté řádky mají string index (`'pt0'`); klik na ně
  ukládal do `_lastSelIdx` string a rozbil následný shift-výběr na normálních řádcích. Ošetřeno
  (mimo výběr rozsahu). Připnuté řádky navíc nezobrazí nesmyslné pořadové číslo (`"pt01"`).
- **Fulltext hledání.** Pole se spojovala bez oddělovače (`join('')`) → hledaný výraz přes hranici
  dvou polí falešně matchoval. Vloženo oddělení polí.
- **Datumové seskupení / date-only.** `YYYY-MM-DD` se parsovalo jako UTC a lokální getter posunul
  den v záporném UTC pásmu; nově se parsuje lokálně.
- **Preset marker.** Sloupcové settery (šířka, barva, formát, titulek, souhrn, otočení, filtr…) i
  `autoFit` nerušily „aktivní preset" → marker visel i po odchylce. Doplněno rušení presetu.
- **Nastavení sloupců (⚙).** Klik na název sloupce skryl/zobrazil sloupec, ale checkbox v panelu
  se neobnovil (`setColumnVisible` teď volá `gear.refresh()`).
- **Responsive.** Vypnuté číslování řádků (`rowNumbers: 'none'`, truthy) rezervovalo 44 px navíc.
- **Menu.** Opětovný klik na spouštěč (např. otočení hlavičky) stohoval druhé menu přes první.
- **Editor barvy.** Cyan spinner měl `max=255` místo `100`.
- **Formulářová pole vzorců.** `spellcheck` zůstával zapnutý (řetězec `'false'` byl truthy).
- **Výběr rozsahu.** `field` se skládal do CSS selektoru bez escapování (rozbití u polí s `"`/`.`/`[]`);
  helper `cssEscape` sjednocen s `resize.js` v `util/dom.js`.

### Přidáno
- **Otevřený rozsah v date-range filtru.** Jeden klik = „od X dál" (`to: null`); jeden den = klik
  na týž den dvakrát. Model, zobrazení i vyhodnocení to už podporovaly, jen picker to srážel na jeden den.

### Bezpečnost
- **Export CSV/TSV – ochrana proti formula-injection.** Buňky začínající `= + - @` (a nejsou číslo)
  se neutralizují prefixem apostrofu, aby je Excel/Calc nespustily jako vzorec.

### Demo
- **Klientský fallback-mock API** (`demo/mock-api.js`) pro statický hosting — server-side příklady
  (progresivní načítání, řazení/filtry na serveru, presety) fungují i bez Node backendu; lokální
  `npm run demo` běží dál proti reálnému `demo/server.js`.

## [1.8.1] – 2026-08-05

### Přidáno
- **Přepínač „Zvýraznění řádku klikem" v UI** (Nastavení tabulky ⚙ → *Sloupce a řádky*) —
  `instance.rowHighlight` (z v1.8.0) šel doteď zapnout jen kódem. Nově ho uživatel zapne/vypne
  přímo z dialogu nastavení (persistuje se jako ostatní volby instance).

## [1.8.0] – 2026-08-05

### Přidáno
- **Per-sloupcové zalamování textu — `column.wrap`.** Doteď šlo zalamovat jen globálně
  (`instance.wrapText`). Nově `col.wrap: true` zalomí jen daný sloupec (i při vypnutém globálu),
  `col.wrap: false` naopak přebije zapnutý globál. Nezadáno = řídí se globálem.
- **Zvýraznění (podbarvení) řádků — nativní feature + API.** Žluté (themeovatelné) podbarvení
  řádků nezávislé na výběru checkboxy:
  - API: `grid.highlightRow(id, on?)`, `grid.toggleRowHighlight(id)`, `grid.clearHighlights()`,
    getter `grid.highlightedRows` (pole klíčů). Stav přežije re-render/řazení/filtr a **persistuje
    se** do `lattice:<id>`. Změna překreslí **jen dotčený řádek** (bez plného re-renderu).
  - Klik na řádek přepíná zvýraznění přes `instance.rowHighlight: true` (nebo `'click'`); ignoruje
    klik do editovatelných buněk, akčních tlačítek a checkboxu výběru. Callback `onHighlightChange(keys)`.
  - Barva přes CSS proměnné `--lattice-row-highlight-bg` / `-hover` (světlá i tmavá varianta),
    aplikované tak, aby přebily i ukotvené/číslovací/souhrnné buňky **bez `!important`**. Barvu lze
    měnit i z UI (**Nastavení tabulky → Vlastní úpravy**, swatche „Zvýraznění řádku / …při najetí").
- **Server-side: expozice aktuálních serverových parametrů — `grid.getServerParams({ paginate? })`
  a `grid.getServerQuery({ paginate? })`.** Vrátí filtr/sort/search/advanced (dle `paramNames`,
  tokeny rozvinuté), jaký má grid aplikovaný, jako objekt / hotový urlencoded querystring. Aplikace
  tak volá vlastní endpointy („ID všech filtrovaných řádků" pro výběr napříč stránkami, export)
  s identickým filtrem — bez ruční duplikace serializace a paralelního stavu. Client-side vrací
  prázdno. `advanced` je v querystringu vždy JSON string (funguje i u `POST`-mode gridu).

### Dokumentace
- `docs/API.md` — `col.wrap`, sekce *Zvýraznění řádků* (API, `instance.rowHighlight`, CSS proměnné,
  UI picker), metody `getServerParams`/`getServerQuery` + příklad „vše filtrované" / export.

## [1.7.0] – 2026-08-05

### Přidáno
- **Server-side režim posílá rozšířený filtr (`advanced`) na backend nativně** — stejně jako už
  posílá `sort`/`filter`/`search`. Doteď se `advanced` (strom AND/OR pravidel) v server-side
  neposílal a aplikace to musela obcházet (wrap `refresh()` + ruční injektování parametru). Nově:
  - `ServerData` skládá `advanced` do request parametrů; **prázdný strom se neposílá** (aditivní —
    backendy, které parametr ignorují, fungují dál).
  - **Serializace:** celý strom jako **JSON** — GET jako jeden urlencoded parametr
    (`advanced=<JSON>`), POST jako vnořený objekt v těle. Přejmenovatelné přes
    `ajax.paramNames.advanced` (default `advanced`).
  - **Relativní datové tokeny** (`today+14`, `now`, …) se **rozvinou na konkrétní ISO datum už
    při skládání requestu**, takže backend zůstává „hloupý". Opt-out `ajax.resolveTokens: false`.
  - Nová exportovaná funkce `resolveTreeTokens(tree)` v `advancedEval.js` (hluboká kopie stromu
    s rozvinutými tokeny, včetně `in`/`nin` seznamů).
  - Do defaultů `ajax.paramNames` doplněny klíče `search` a `advanced`.
- Důsledek: **globální uložené rozšířené filtry na server-side gridech „prostě fungují"** — jejich
  výběr jen nastaví `grid.advanced` a spustí refetch, který teď nese parametr `advanced`.

### Dokumentace
- `docs/API.md` — sekce *Server-side režim* doplněna o parametr `advanced` (formát JSON, GET/POST,
  rozvinuté tokeny, `resolveTokens`, příklad payloadu a doporučené zpracování na serveru);
  opravena dřívější tvrzení, že se rozšířený filtr na server neposílá.

## [1.6.2] – 2026-08-05

### Opraveno
- **Rychlý select uložených filtrů v toolbaru (`.lattice-adv-quick`) ořezával název a nativní
  chevron překrýval poslední znaky.** Pravý padding byl jen `6px`, což je méně než šířka
  chevronu → text se plazil pod šipku. Nastaven `padding-right: 24px` (vlastní prostor pro
  chevron), `text-overflow: ellipsis` a `max-width` z 200 na 220 px — dlouhý název se teď
  úhledně zkrátí tečkami a nepřekrývá se se šipkou.

## [1.6.1] – 2026-08-05

### Opraveno
- **Panel rozšířeného filtru odskakoval do levého horního rohu.** Po výběru uloženého filtru
  (nebo jakékoli akci překreslující toolbar) se toggle tlačítko vytvořilo znovu a panel se
  přepočítal proti odpojenému elementu (rect `{0,0,0,0}`) → skok na `{4,8}`. `renderToolbar()`
  nyní při otevřeném panelu přesměruje kotvu na živě vytvořené tlačítko; panel zůstává ukotven.
- **Únik „klik mimo" listeneru (`onOutside`).** Listener se navazuje přes `setTimeout(…,0)`;
  když se panel zavřel dřív, než timer stihl navázat, disposer odebral ještě neexistující
  listener a timer ho pak navázal „naprázdno" s odkazem na odpojený panel — takový zbloudilý
  listener pak zavíral nově otevřený panel (např. hned po kliknutí do selectu uložených filtrů).
  Disposer nyní timer ruší (`clearTimeout`) a `AdvancedFilter.open()` má pojistku proti dvojímu
  otevření bez zavření.
- **Přepis globálního filtru pod stejným názvem generoval nové `id`** při každém uložení →
  aplikace (perzistence klíčovaná na `id`/`ext_id`) zakládala nový DB řádek a po reloadu vznikla
  duplicita. `saveAdvanced` teď při přepisu (stejný `name` + `scope`) **znovu použije `id`
  existující položky** — pro local i global.

### Přidáno
- **Předvyplnění názvu v panelu rozšířeného filtru.** Po výběru uloženého filtru se jeho název
  zkopíruje do pole „Název filtru"; při otevření panelu s aktivním uloženým filtrem se název
  předvyplní hned. Uživatel tak snadno upraví a uloží filtr pod stejným názvem.

## [1.6.0] – 2026-08-05

### Přidáno
- **Relativní datové tokeny v rozšířeném filtru** — v hodnotě podmínky lze místo pevného data
  napsat token, který se dopočítá až při každém vyhodnocení filtru (uložený filtr tak „posouvá
  okno" s časem, ideální pro globálně sdílené filtry):
  - `today`, `today+14`, `today-7` (± N dní), jednotky `today+2w` / `+1m` / `+1y`
    (den/týden/měsíc/rok) a `now` (s časem).
  - Case-insensitive, toleruje mezery (`today + 14 d`); funguje i uvnitř `in`/`nin` seznamu.
  - Token je **řetězec** (JSON-safe) — žádný spustitelný kód se neukládá, bezpečné pro sdílení.
  - Nová exportovaná funkce `resolveToken(value)` v `advancedEval.js`; nápověda (tooltip) u pole
    hodnoty v panelu rozšířeného filtru.
- Dokumentace (`docs/API.md`), uživatelská příručka a demo ukázka „Rozšířený filtr" doplněny
  o relativní datum.

## [1.5.1] – 2026-08-03

### Dokumentace
- **`docs/API.md` — rozsáhlé doplnění a opravy** (jen dokumentace, chování knihovny beze změny):
  - Nová sekce **Server-side režim (`serverSide` / `ajax`)**: plný objekt `ajax`
    (`url, method, params, headers, paramNames, requestBuilder, responseParser`), skládání
    `ajax.params` při každém dotazu (externí stav + `refresh()`), přesná struktura request
    parametrů (`page` 1-based, `size`, `sort[]`, `filter[]` s typy `like/!like/=/!=/in/>=/>/<=/</dateRange`,
    `search`), tvar odpovědi (`data/total/last_page/last_row` + fallbacky) a **auto-refetch**.
  - Sloupec **`visible: false`** (skrytý po startu, zapnutelný v dialogu Sloupce).
  - **Rozšířený filtr** — schéma stromu (`applyAdvanced(tree)`) + 14 operátorů; poznámka, že
    neexistuje externí row-predikát a že se v server-side na server neposílá.
  - Opravy signatur: `onCellEdit({field,row,rowIndex,oldValue,newValue})`, řádkové `actions`
    (`title` ne `label`, `onClick(row,index,e)`), rozdělení `rowContextMenu` `(row,index)` vs.
    `cellContextMenu` `(ctx)`, `select`/`multiselect` editor bere možnosti z `col.filterValues`.
  - Upřesnění: `summaryRow:'all'` v server-side agreguje jen z načtené stránky; výběr napříč
    stránkami (`setSelectScope`, `selectKeys`, chování `getSelectedKeys`/`getSelectedRows`).

## [1.5.0] – 2026-08-03

### Přidáno
- **Globální (sdílené) rozšířené filtry** — uložené rozšířené filtry (strom pravidel) lze
  teď ukládat nejen lokálně (per-uživatel, localStorage), ale i **globálně** pro všechny.
  Stejný vzor jako globální presety: aplikace dodá filtry při startu
  (`options.globalAdvancedFilters: [{id,name,tree}]`) a persistuje je přes callbacky
  `onSaveGlobalAdvancedFilter({id,name,tree})` / `onDeleteGlobalAdvancedFilter({id,name})`.
  V UI přibyl v panelu rozšířeného filtru zelený **„Uložit globálně"** (jen když aplikace
  dodá callback); globální filtry se v nabídce (panel i quick-select v toolbaru) odlišují
  glóbem (🌐). Nové/rozšířené metody: `saveAdvanced(name, tree, scope)`
  (`'local'` | `'global'`), `listAdvanced()` (vrací položky se `scope`),
  `deleteAdvanced(id)` (routuje dle scope), `canSaveGlobalAdvanced()`.

## [1.4.0] – 2026-08-02

### Přidáno
- **Zalamování názvů sloupců** (`wrapHeader`) — nezávislé na zalamování dat v buňkách
  (`wrapText`). Když je zapnuté, auto-fit (dvojklik na oddělovač) změří šířku podle názvu
  složeného do **2 řádků** (nikdy neužší než nejdelší slovo + ikony), ale zároveň **nikdy
  neužší než nejširší nezalomená data** na zobrazené stránce — data se tak neořežou.
  Netýká se otočených hlaviček. Přepínač v „Nastavení tabulky → Rozvržení".

## [1.3.0] – 2026-08-01

### Přidáno
- **Generátor stylů** (`demo/styler.html`) — naklikatelný vzhled: všechny theming
  proměnné `--lattice-*` (barvy s alfa kanálem, písmo, tvary, rozestupy, okraje), živý náhled a export
  hotového `lattice-custom.css` (ke stažení i kopírování) vč. návodu na použití.
  Změněné položky jsou zvýrazněné a jdou vrátit na výchozí jednotlivě (↺) i všechny naráz.
- **Alfa kanál v color pickeru** — `openColorPicker` má nově volitelný jezdec
  průhlednosti (`opts.alpha`); vrací pak `rgba(...)`.
- **Paměť naposledy použitých barev** — picker si pamatuje posledních 12 vlastních
  barev (kolo/vlastní vstup) a nabízí je k výběru (persistováno v `localStorage`).
- **Okraje sloupců v generátoru stylů** — barva i šířka pro obyčejné svislé linky
  (`--lattice-cell-vborder-color`/`-width`), hrany skupin (`--lattice-group-border-width`)
  a dělící linku ukotvených sloupců (`--lattice-frozen-line-width`). Platí hierarchie:
  **ukotvený okraj > skupinový > obyčejný**.
- **Spodní okraje záhlaví** — samostatná barva i šířka pod řádkem skupin
  (`--lattice-group-border-bottom-*`), pod řádkem záhlaví (`--lattice-header-border-*`)
  a pod řádkem filtrů (`--lattice-filter-border-*`).
- Sidebar generátoru stylů skládá volby do **2 sloupců** (dle šířky) — méně rolování.

### Změněno
- **Palety v color pickeru** nabízejí obě varianty Bootstrapu 5 — plné (sytá barva +
  kontrastní písmo) i jemné „alert" tóny (světlé pozadí + tmavý text). 16 kombinací.
- **Nastavení tabulky** — „Barvy škály (semafor)" i barvy ve „Vlastních úpravách"
  otevírají šestiúhelníkový picker (kolo + palety) místo nativního výběru barvy.

### Opraveno
- **Šířka/barva svislých linek buněk jde přepsat** na úrovni gridu — `--lattice-cell-vborder`
  se už nedefinuje napevno v `:root` (vnořený `var()` se vyhodnocoval moc brzy a přepis
  na potomkovi se neprojevil); buňky ho berou přes fallback, takže `--lattice-cell-vborder-width`
  i `-color` fungují. Svislé linky nově respektují nastavení i v **záhlaví, filtr řádku
  a skupinovém řádku** (dřív měly barvu/šířku napevno). Motivy ho dál můžou nastavit na `none`.
- **Color picker se zobrazuje nad modálem** Nastavení tabulky (dřív se schoval pod něj).
- **Sbalení skupin sloupců se persistuje** i po reloadu — `Store` nově načítá klíč
  `colGroups` (dosud se ukládal, ale při načtení se zahazoval, takže skupiny byly
  po obnovení stránky zase rozbalené).

## [1.2.0] – 2026-08-01

### Přidáno
- **Sbalitelné skupiny sloupců** — v záhlaví skupiny ikona **−/+**; sbalená skupina se schová
  do úzkého proužku. Stav se persistuje. API: `toggleColGroup`, `isColGroupCollapsed`.
- **Barvy záhlaví** sloupce i skupiny — color picker s **barevným kolem** (výchozí tab),
  jezdcem jasu a **Bootstrap presety**. Sloupec bez vlastní barvy **zdědí barvu skupiny**;
  písmo se dopočítá kontrastně. API: `setColumnHeaderColor`, `setColGroupHeaderColor`; options
  `headerBackground`/`headerColor`/`groupHeaderBackground`/`groupHeaderColor` (i nested def skupiny).
- **Formát buňky** — vzhled těla sloupce v UI: zarovnání, tučné/kurzíva/podtržené/přeškrtnuté,
  barva písma i pozadí. API: `setColumnCellFormat`; option `cellFormat`.
- **Přejmenování sloupce** — dvojklik na název v dialogu Sloupce (persistuje se). API: `setColumnTitle`.
- **Vážený souhrn** se sloučí do řádku standardního souhrnu, když ho pojmenuješ stejně
  (např. „Průměr") — ikona **ƒ** ho odliší.
- **Demo**: hledání ukázek v postranním menu; generátor kódu doplněn o poznámku k runtime vzhledu.

### Změněno
- Barva a zrušení skupiny se nastavují v **nabídce skupiny** (dialog Sloupce), ne přímo v gridu
  (ať se na zrušení neklikne omylem). „Nová skupina" se nabízí jen sloupci bez skupiny.
- Dialog Sloupce se rozšíří, aby se vešly ikony i delší názvy.
- Demo: kategorie „Novinky" pročištěna (Skupiny sloupců, Počítané sloupce, Souhrny).

### Opraveno
- Σ ikona je aktivní i při zapnutém váženém souhrnu.
- Dialog Sloupce zůstává otevřený při práci s jeho pod-popovery (souhrn/formát/skupina/barva/vzorec).
- Editor vzorce/souhrnu se neobjeví v rohu, když se překreslením utrhne kotva.

### Dokumentace
- Uživatelská příručka: nová sekce **„Skupiny a vzhled sloupců"**, aktualizovaný dialog Sloupce
  (nové ikony), výslovnost názvu. `docs/API.md` a dokumentace v demu doplněny.

## [1.1.0] – 2026-08-01

### Přidáno
- **Počítané sloupce z UI** — nový sloupec definovaný **vzorcem** (`formula`): aritmetika,
  spojování textu, podmínky (`if`, ternár), datumové výpočty. Bezpečné vyhodnocení vlastním
  parserem (**bez `eval`/`new Function`**). Vytvoření/úprava v dialogu „Sloupce" tlačítkem
  „＋ Přidat počítaný sloupec"; pole i funkce se vkládají klikáním, **živý náhled**, **typ**
  se sám odvodí z výsledku. Persistuje se (localStorage i presety). API:
  `addComputedColumn`, `updateComputedColumn`, `removeComputedColumn`.
- **Reference funkcí** v editoru vzorce — prohledávatelný seznam v kategoriích
  (Čísla / Text / Logika / Datum) se zápisem a popisem; klik funkci vloží do vzorce.
- **Vážený / poolovaný souhrn** sloupce vzorcem z agregací jiných sloupců (`summaryFormula`) —
  funkce `sum/avg/count/min/max/median` nad výrazem. Umožní matematicky správné **poměry
  součtů** (Σa/Σb) i **vážené průměry** (Σ(a×b)/Σb) místo prostého průměru poměrů. Volitelný
  **název řádku** (`summaryFormulaLabel`); sloupce se stejným názvem sdílejí řádek. Nastavení
  přes Σ → „Vzorec (vážený souhrn)". API: `setColumnSummaryFormula`.

### Dokumentace
- **Presety a globální nastavení** — nová vyčerpávající sekce v `docs/API.md`: kompletní
  kontrakt globálních presetů (`globalPresets`, `onSaveGlobalPreset`, `onDeleteGlobalPreset`)
  i globálních výchozích nastavení (`globalDefaults`, `onSaveGlobalDefaults`), tok dat a
  příklad s MySQL. *Tyto callbacky byly v kódu už dříve — v1.1.0 je poprvé vydává v tagu.*
- Uživatelská příručka: sekce „Počítaný sloupec (vlastní vzorec)" a „Vážený souhrn vzorcem"
  s obrázky.

### Změněno
- Demo: příklad „Computed (odvozené) sloupce" přejmenován na „Počítané sloupce"
  (sjednocení s příručkou i aplikací).

## [1.0.1] – 2026-07-30
### Přidáno
- **Ikona nápovědy** (**?**) v toolbaru vpravo od ⚙ „Nastavení tabulky" — otevře
  uživatelskou příručku v nové kartě. Konfigurovatelné přes `helpUrl`
  (výchozí je oficiální příručka; `helpUrl: null` ikonu skryje).
- README: sekce **„Proč Lattice"** (zdůvodnění názvu).

## [1.0.0] – 2026-07-30

První **stabilní** vydání. Veřejné API (options, sloupce, typy, filtry, metody,
callbacky) se od této verze považuje za stabilní a dále se řídí semverem.

### Přidáno
- **Uživatelská příručka** (`prirucka/`) – jak tabulku *ovládat* z pohledu
  koncového uživatele aplikace (řazení, filtry, seskupení, přesouvání řádků,
  detail řádku, číslování, souhrny, formáty, presety, export…), s obrázky.
  Odkaz je v záhlaví dema, v navigaci i CTA landing page.
- **Seskupení řádků**: volba *„opakovat hodnoty skupin v řádcích"*
  (`groupRepeat`) – hodnota skupiny buď u každého řádku, nebo jen v liště.
- **Seskupení řádků**: ukotvené *vedoucí sloupce* úrovní i v režimu vnořených
  hlaviček (zůstávají vlevo při horizontálním scrollu).
- **Demo**: serverová **PHP proxy** (`demo/api/fetch.php`) pro import z URL –
  příklad „Z URL" funguje i na statickém (PHP) hostingu; obsahuje ochranu
  proti SSRF. Same-origin zdroje se načítají přímo bez proxy.
- **LICENSE** (MIT).

### Opraveno
- Demo: z postranní kategorie „Novinky" odebrán duplicitní odkaz „Datové typy".

## [0.5.0] – 2026-07-29
### Přidáno
- Datumové **seskupování podle úrovní** (rok / kvartál / měsíc / týden /
  den v týdnu / den v měsíci / hodina / minuta), i víceúrovňově.
- Řadicí šipka ve skupinové hlavičce – řadí skupiny i podle skrytého
  seskupeného pole; pořadí datumových skupin následuje směr řazení sloupce.

## [0.4.1] – 2026-07-29
### Opraveno
- Auto-fit šířky sloupců měří **reálný vykreslený obsah** buňky (DOM), ne jen text.

## [0.4.0] – 2026-07-29
### Přidáno
- Odkazové sloupce: `urlField` + *url builder* – odkaz může vést přes jiné
  pole než zobrazený text.

## [0.3.0] – 2026-07-28
### Změněno
- Verzované URL v dokumentaci (připnutí konkrétní verze místo `@main`).

## [0.2.0] – 2026-07-26
- Údržbové vydání.

## [0.1.0] – 2026-07-24
- První veřejná verze.

[1.13.1]: https://github.com/svatekr70/lattice/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/svatekr70/lattice/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/svatekr70/lattice/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/svatekr70/lattice/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/svatekr70/lattice/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/svatekr70/lattice/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/svatekr70/lattice/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/svatekr70/lattice/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/svatekr70/lattice/compare/v1.6.2...v1.7.0
[1.6.2]: https://github.com/svatekr70/lattice/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/svatekr70/lattice/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/svatekr70/lattice/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/svatekr70/lattice/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/svatekr70/lattice/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/svatekr70/lattice/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/svatekr70/lattice/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/svatekr70/lattice/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/svatekr70/lattice/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/svatekr70/lattice/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/svatekr70/lattice/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/svatekr70/lattice/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/svatekr70/lattice/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/svatekr70/lattice/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/svatekr70/lattice/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/svatekr70/lattice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/svatekr70/lattice/releases/tag/v0.1.0
