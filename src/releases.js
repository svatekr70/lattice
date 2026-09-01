/**
 * Seznam vydání pro záložku „O Lattice" (nastavení tabulky).
 * GENEROVÁNO z CHANGELOG.md — needituj ručně, spusť `npm run releases`.
 */
export const RELEASES = [
  {
    "version": "1.21.0",
    "date": "2026-09-01",
    "text": "Výběrové filtry (Výběr, Více hodnot, Vyloučit více) nově umí filtrovat na prázdné hodnoty. Aditivní změna s novým veřejným exportem EMPTY_FILTER_VALUE; bez breaking changes — sloupec bez prázdných buněk i statický filterValues vypadají a chovají se přesně…",
    "items": [
      "Volba „(prázdné)\" ve výběrových filtrech. Sloupec, který má vyplněnou jen část řádků, se nedal profiltrovat na to, co v něm *chybí* — v nabídce byly jen skutečné hodnoty a k prázdným řádkům se…",
      "Nový veřejný export EMPTY_FILTER_VALUE ('__LATTICE_EMPTY__', i jako statická vlastnost Lattice.EMPTY_FILTER_VALUE) — hodnota filtru pro prázdné buňky. Prázdný řetězec pro tenhle účel použít nešlo: u…",
      "Nová volba sloupce filterEmptyOption — true volbu připne i statickému filterValues nebo filterUrl (kde si číselník určuje aplikace a knihovna do něj sama nesahá), false ji potlačí i u odvozené…",
      "Nový i18n klíč filters.empty ve všech čtyřech jazycích: cs (prázdné), sk (prázdne), pl (puste), en (empty). Závorky odlišují volbu od skutečné hodnoty.",
      "Editor buňky token přeskočí. Číselník filterValues/filterUrl sdílí s filtrem i editor (editor: 'select'/'multiselect'); token se v nabídce editoru nenabízí, protože je to hodnota *filtru*, ne buňky…",
      "Porovnání s vybranou volbou „(prázdné)\": select vrátí právě prázdné řádky; multiselect ji spojuje s ostatními hodnotami přes OR („SK nebo prázdné\"); multiselect-exclude prázdné buňky skryje. Dokud…",
      "Server-side: tvar požadavku se nemění, token jde jako obyčejná hodnota ({ field, type:'=', value:'__LATTICE_EMPTY__' }, resp. in/notIn s tokenem v poli). Backend ho má přeložit na col IS NULL OR col…"
    ]
  },
  {
    "version": "1.20.1",
    "date": "2026-08-31",
    "text": "Drobnost pro práci s víceúrovňovým seskupením: sbalení skupiny sbalí i její podskupiny, takže po rozbalení nadřazené skupiny máš před sebou přehledný seznam podskupin místo záplavy řádků. Bez breaking changes.",
    "items": [
      "Sbalení skupiny řádků sbalí natrvalo i celý její podstrom. Když v režimu „vnořené hlavičky\" sbalíš třeba měsíc, sbalí se s ním i všechny dny pod ním — a zůstanou sbalené. Po opětovném rozbalení…",
      "toggleGroup(key, node?) přijímá volitelný uzel stromu skupin, ze kterého se podstrom vyčte; volání grid.toggleGroup(key) bez uzlu se chová jako dřív (přepne jen tu skupinu)."
    ]
  },
  {
    "version": "1.20.0",
    "date": "2026-08-31",
    "text": "Dvě věci pro uživatele tabulky: tipy nad tabulkou (jednořádkový info pruh, opt-in přes tips) a skupiny ve výběru uložených filtrů a pohledů (<optgroup> podle štítku group). Bez breaking changes — obojí je volitelné a starší data fungují beze změny.",
    "items": [
      "Tipy pro uživatele nad tabulkou. Nová volba tips zapne nad tabulkou úzký info pruh s jednořádkovým tipem pro toho, kdo v tabulce pracuje (ne pro toho, kdo Lattice implementuje): přesun sloupců myší,…",
      "69 vestavěných tipů ve všech čtyřech jazycích (cs/en/pl/sk) pod i18n klíči tips.list.<id> — aplikace je může přebít vlastním slovníkem jako kterýkoli jiný popisek. Nabízejí se jen ty, které na danou…",
      "Uživatel má poslední slovo: křížek v pruhu = instance.showTips: false (persistuje se jako ostatní nastavení a nese se i v presetu), zpět v *Nastavení tabulky → Vzhled → „Zobrazovat tipy nad…",
      "API: grid.nextTip(), grid.hideTips(), grid.tipsVisible(); nové i18n klíče tips.label, tips.next, tips.hide, tips.list.* a instance.showTips.",
      "Skupiny ve výběru uložených filtrů a pohledů. Uložený filtr i pohled může nést volitelný štítek skupiny („Prodeje\", „Faktury\", „Storno\"…). Položky se stejným štítkem se v rozbalovacím výběru v…",
      "Políčko „Skupina…\" v ukládacích řádcích — v panelu uložených filtrů, v patičce rozšířeného filtru i v panelu presetů, vždy hned vedle názvu. Napovídá (<datalist>) už použité skupiny, zapsat jde ale…",
      "API: saveAdvanced(name, tree, scope, display, group), saveFilterSnapshot(name, scope, display, group), renameSavedFilter(id, name, group?), nové setAdvancedGroup(id, group); u pohledů…",
      "Nové i18n klíče groupPlaceholder a groupHint v namespace presets, advanced a saveFilters (cs/en/pl/sk).",
      "Demo server neposílá nic do cache (Cache-Control: no-store) — jinak si prohlížeč držel staré ESM moduly a demo ukazovalo předchozí verzi knihovny i po editaci zdrojáků.",
      "Test relativních datových tokenů počítal očekávaný měsíční posun bez ošetření přetečení, takže 31. dne v měsíci padal (today+1m knihovna správně ořízne na 30. 9., test čekal 1. 10.). Test teď počítá…"
    ]
  },
  {
    "version": "1.19.0",
    "date": "2026-08-27",
    "text": "Paginace nově přizná, že zobrazený počet je po filtrech. Bez breaking changes — pagination.showing se nemění, jen přibyl druhý klíč.",
    "items": [
      "Paginace přizná, že počet je filtrovaný. Text vlevo („Zobrazeno 1-50 z 21 001 řádků\") ukazoval počet po filtrech, ale nijak to nedal najevo — uživatel neměl jak poznat, jestli tabulka opravdu tolik…",
      "Nový i18n klíč pagination.showingFiltered (cs/en/pl/sk). Původní pagination.showing se nemění ani nemizí — v nefiltrovaném stavu je text znak po znaku stejný jako dřív, takže vlastní slovníky…",
      "Server-side (serverSide: true) beze změny — ServerData celou sadu nezná, total mu chodí z backendu jako jediné číslo. Text zůstává původní. (Kdyby to někdo chtěl i tam, patří nefiltrovaný počet do…",
      "Tree režim beze změny — total je počet zploštělých viditelných uzlů, kdežto syrová data jsou hierarchická; čísla by se nepotkala, takže se nic nepřipisuje.",
      "Progresivní režim beze změny — má vlastní patičku („Načteno X z N\").",
      "Filtr, který nic neodfiltruje, i prázdný výsledek (Žádné záznamy) zůstávají beze změny."
    ]
  },
  {
    "version": "1.18.2",
    "date": "2026-08-26",
    "text": "Oprava nabídky hodnot ve filtrech select / multiselect / multiselect-exclude u sloupců bez filterValues a filterUrl. Bez změny API.",
    "items": [
      "Nabídka ve filtru se zúžila na to, co bylo zrovna vyfiltrované — a nešlo se vrátit. Možnosti odvozené z dat se braly z dataSource.allRows(), což je sada po filtrování (slouží souhrnům). Ovládací…",
      "Nabídka odvozená z dat se přenačte při každém otevření panelu, takže odráží i změny dat (setData(), addRow(), deleteRow()) bez překreslení hlavičky. Statický číselník (filterValues) ani filterUrl se…",
      "Při zrušení filtrů (clearAllFilters(), clearColumnFilters()) a přepnutí typu filtru (setColumnFilterType()) se zahodí zapamatovaná filtrovaná sada (ClientData.invalidate()). Hlavička se staví hned,…"
    ]
  },
  {
    "version": "1.18.1",
    "date": "2026-08-26",
    "text": "Oprava automatické šířky sloupce s čísly řádků. Beze změny chování zbytku knihovny.",
    "items": [
      "Sloupec s čísly řádků (#) se neroztáhl podle počtu řádků. Šířka se počítá z délky nejdelšího čísla, jenže při prvním layoutu ještě nejsou načtená data (total = 0), takže vyšla na dvě číslice — a po…",
      "Automatická šířka # sloupce bere v potaz hustotu a velikost písma. Dřív to byl pevný odhad (9 px na číslici), který u prostornějších motivů (např. material) nebo většího písma nestačil. Nově se…"
    ]
  },
  {
    "version": "1.18.0",
    "date": "2026-08-26",
    "text": "Nový typ filtru „Vyloučit více\" (multiselect-exclude) — inverze filtru „Více hodnot\". Bez breaking changes.",
    "items": [
      "Filtr multiselect-exclude („Vyloučit více\") — zaškrtnuté hodnoty se skryjí a v tabulce zůstane všechno ostatní (řádky s prázdnou buňkou se považují za nevyloučené). Prázdný výběr nefiltruje.…",
      "Server-side: filtr se serializuje jako type:'notIn' s hodnotou pole (filter[0][value][0], filter[0][value][1], …) — stejně jako in, jen s opačným významem (NOT IN). Demo servery (demo/server.js,…",
      "Přepínač typu filtru: textové sloupce teď v trychtýři nabízejí čtveřici Text / Výběr / Více hodnot / Vyloučit více (hodnoty si filtr odvodí z dat, když nejsou filterValues/filterUrl). Překlady ve…",
      "Dokumentace: docs/API.md (tabulka filtrů + kontrakt requestu), dokumentace v demu, uživatelská příručka (nová podkapitola „Vyloučit více\") a builder sloupců. V demu filtr používá sloupec Stav v…"
    ]
  },
  {
    "version": "1.17.0",
    "date": "2026-08-23",
    "text": "Polština a slovenština jako vestavěné jazyky. Bez breaking changes — chování v cs/en se nemění.",
    "items": [
      "Polský překlad (i18n: 'pl') — src/i18n/pl.js, kompletních 569 řetězců: nastavení tabulky, filtry (včetně nápovědy k dynamickým obdobím), uložené pohledy a filtry, počítané sloupce i s popisy všech…",
      "Slovenský překlad (i18n: 'sk') — src/i18n/sk.js, tytéž řetězce.",
      "Oba jazyky jsou vestavěné, takže stačí new Lattice('#grid', { i18n: 'pl' }) nebo grid.setLanguage('sk') — bez registerLanguage(). availableLanguages() teď vrací ['cs', 'en', 'pl', 'sk'].",
      "Překladatelské studio v demu nabízí polštinu a slovenštinu jako zdrojový základ pro další jazyky (vedle češtiny a angličtiny)."
    ]
  },
  {
    "version": "1.16.1",
    "date": "2026-08-21",
    "text": "Oprava šířky vedoucích sloupců seskupení. Beze změny chování zbytku knihovny.",
    "items": [
      "Sloupci, podle kterého jsou seskupené řádky, nešla měnit šířka. Vedoucí sloupec seskupení je syntetický a vzniká znovu při každém překreslení, takže šířka zapsaná na objekt sloupce se okamžitě…"
    ]
  },
  {
    "version": "1.16.0",
    "date": "2026-08-21",
    "text": "Výběr řádků dělá to, co slibuje: volby v menu rovnou vybírají, „Všechny záznamy\" berou opravdu všechny filtrované záznamy (i nezobrazené stránky) a počty v popiscích sedí. Bez breaking changes.",
    "items": [
      "Volby „Stránka\" a „Všechny záznamy\" nic nevybraly. Jen přepínaly rozsah pro hlavičkový checkbox, takže po kliknutí se navenek nestalo nic. Nově rovnou vybírají (selectPage() / selectAllRecords()) a…",
      "„Všechny záznamy\" vybíraly jen načtenou stránku. Server-side grid nezná klíče nezobrazených stránek, takže volba vybrala 50 řádků a v popisku ukazovala „(50)\", i když filtru odpovídalo 365 záznamů.…",
      "Popisek „Všechny záznamy (N)\" ukazoval počet načtených řádků. Server-side bere N z total — tedy počet všech filtrovaných záznamů (365), ne velikost stránky.",
      "Popisek „Stránka (N)\" — kolik řádků je opravdu na aktuální stránce (na poslední jich bývá míň než pageSize). Nové metody pageCount(), selectedCount(), getSelection().",
      "Šipka „rozsah a možnosti výběru\" u hlavičkového checkboxu je vidět — místo nenápadné tečky je to chevron 12 px s hover stavem (podbarvení + rámeček), takže je poznat, že se tam něco rozbaluje."
    ]
  },
  {
    "version": "1.15.0",
    "date": "2026-08-21",
    "text": "Verze knihovny na očích: v patičce gridu a v nové záložce „O Lattice\" v nastavení, kde je i changelog — co které vydání přineslo. Bez breaking changes.",
    "items": [
      "Verze knihovny v patičce gridu — Lattice x.y.z pod „Zobrazeno X-Y z N\" (schválně tam, aby neodsunula stránkování z místa, na které jsou uživatelé zvyklí). Ať je hned vidět, s jakou verzí uživatel…",
      "Nastavení tabulky → záložka „O Lattice\" — co Lattice je, autor a licence, odkazy (uživatelská příručka podle options.helpUrl, ukázky a dokumentace, GitHub) a changelog přímo v tabulce: seznam vydání…",
      "instance.showVersion (výchozí true) — přepínač „Verze knihovny v patičce\" v *Nastavení tabulky → Vzhled*; persistuje se a nese se i v presetu. Aplikace může verzi zakázat natvrdo přes features: {…",
      "npm run releases — vygeneruje src/releases.js (seznam vydání pro záložku „O Lattice\") z CHANGELOG.md; test hlídá, že nejnovější položka odpovídá VERSION.",
      "Export metadat — VERSION, HOMEPAGE, HELP_URL, DEMO_URL, GITHUB_URL, AUTHOR, LICENSE z src/version.js (jediný zdroj pravdy; test hlídá shodu VERSION s package.json).",
      "Dialog „Nastavení tabulky\" je širší (880 px), ať se řada záložek včetně „O Lattice\" vejde na jeden řádek."
    ]
  },
  {
    "version": "1.14.0",
    "date": "2026-08-21",
    "text": "Uložené pohledy pod jednou střechou: preset se dá vystavit jako tlačítko stejně jako uložený filtr a nově si u obojího vybíráš, jestli má být tlačítko, výběr, nebo obojí. V záhlaví je poznat, co je co, bez popisků. Bez breaking changes.",
    "items": [
      "Preset jako tlačítko / ve výběru. V panelu presetů („Sloupce\") jsou vedle pole s názvem zaškrtávátka tlačítko a výběr; u každého už uloženého presetu jsou tytéž dva přepínače přímo v jeho řádku,…",
      "Tlačítka rozlišují čtyři druhy položek — globální/lokální preset a globální/lokální filtr — a nezaberou kvůli tomu víc místa: ikona = druh (záložka = preset, trychtýř = filtr), barva = rozsah (šedá…",
      "Rozmístění v záhlaví: tlačítka uložených filtrů jsou v řadě ikon hned vlevo od filtračních ikon, tlačítka presetů o řádek výš — bez presetu jako tlačítka se ten řádek vůbec nevykreslí a záhlaví…",
      "Volba „jako výběr\" u uložených filtrů (panel rozšířeného filtru i „Uložit sloupcové filtry\"). V toolbaru jsou vedle sebe dva výběry: vlevo „— uložené filtry —\", vpravo „— pohledy —\" (každý jen když…",
      "Druhý klik na tlačítko presetu vrátí výchozí zobrazení. Preset se tak přepíná stejně jako uložený filtr. „Výchozí zobrazení\" = sloupce a nastavení tabulky jako po startu bez presetu; filtry, řazení…",
      "Správa uložených položek rovnou z rychlé řady. Pravý klik na pilulku otevře menu: použít / vypnout, Upravit… (otevře příslušný panel s načteným filtrem, resp. panel „Sloupce\" u presetu), Zobrazit…",
      "Panel „Uložené filtry\" (ikona trychtýř + disketa) je teď i správcem: v seznamu jsou všechny uložené filtry (snímky sloupcových filtrů i stromy z rozšířeného filtru). U každého: klik na název ho…",
      "API: grid.overwriteSavedFilter(id) a grid.renameSavedFilter(id, name).",
      "API: grid.togglePreset(preset), grid.resetView(), grid.setAdvancedDisplay(id, key, on), grid.buttonPresets() / grid.selectPresets() / grid.selectAdvanced(), presets.saveLocal(name, parts, display) /…",
      "Presetům se v UI říká „pohledy\". Všechny uživatelské texty (panel v dialogu „Sloupce\", tooltipy, placeholder výběru — pohledy —) mluví o pohledech; v API a dokumentaci pro vývojáře zůstává preset…",
      "saveAdvanced(name, tree, scope, display) a saveFilterSnapshot(name, scope, display) berou místo booleanu asButton objekt { button, select }. Legacy boolean funguje dál se stejným významem jako dosud…",
      "Uložení preset se stejným názvem zachová id (jako u filtrů), takže downstream upsert v aplikaci přepíše tentýž řádek místo zakládání nového."
    ]
  },
  {
    "version": "1.13.1",
    "date": "2026-08-20",
    "text": "Oprava instalačních instrukcí. Beze změny kódu knihovny.",
    "items": [
      "npm i lattice instaloval cizí balíček. Jméno lattice na npmjs.com patří jinému projektu (openlattice/lattice-js) — kdo se řídil dokumentací, stáhl si něco úplně jiného. Napříč README, API…",
      "Zastaralý příklad tagu. README i dokumentace v demu radily připnout @v0.1.0.",
      "package.json má private: true — pojistka proti publikaci pod cizím jménem. Na instalaci z GitHubu to nemá vliv."
    ]
  },
  {
    "version": "1.13.0",
    "date": "2026-08-20",
    "text": "Presety si pamatují i nastavení tabulky — seskupení řádků, souhrnný řádek a mezisoučty skupin — a u ukládání se dá zaškrtnout, které části preset ponese. Bez breaking changes.",
    "items": [
      "Preset nese nastavení tabulky. captureState() nově ukládá i celou instance, takže lokální i globální preset obnoví seskupení řádků (groupBy, groupDisplay, groupRepeat), souhrnný řádek (summaryRow),…",
      "Volba, co se do presetu uloží. V panelu presetů jsou nad polem s názvem tři zaškrtávátka — Sloupce, Filtry a řazení, Nastavení tabulky. Uživatel si tak uloží třeba preset „jen filtry\" nebo „jen…",
      "captureState(parts) — {columns, filters, instance} vybírá, co snímek zachytí (bez argumentu vše). Propsáno i do presets.saveLocal(name, parts) / saveGlobal(name, parts).",
      "captureInstance() — veřejný snímek nastavení tabulky (používá ho preset i globální výchozí nastavení).",
      "presetContents(preset) — které části preset nese (pro UI a aplikaci).",
      "applyPreset() mění jen to, co snímek obsahuje. Chybějící část zůstane, jak ji uživatel má — díky tomu fungují částečné presety i staré presety bez instance.",
      "Snapshot je hluboká kopie. instance v presetu i v globálních výchozích se kopíruje do hloubky — pozdější změna cssVars / format / groupBy už uložený snímek nepřepíše.",
      "Sbalení externího filtračního panelu se nesdílí. externalFiltersCollapsed je přechodný stav UI, ne nastavení: do presetu ani do globálních výchozích nepatří a při jejich použití zůstane uživateli…",
      "„Obnovit výchozí\" v dialogu „Sloupce\" ruší i seskupení řádků. Seskupení se zapíná v tomtéž dialogu u sloupce a sloupce přeskupuje (seskupený sloupec se stěhuje dopředu a ukotví se), takže reset,…",
      "Dialog „Sloupce\" neuteče pod spodní hranu okna. Panel se otevíral vždycky pod kotvícím tlačítkem bez ohledu na to, kolik místa pod ním zbývá — u dlouhého seznamu sloupců, nízko posazeného toolbaru…",
      "Dialog „Sloupce\" už neodskakuje. Preset s nastavením tabulky překreslí toolbar, takže kotvící tlačítko dialogu zmizí — panel se dřív přepočítal z nulového rectu a skončil v levém horním rohu. Teď se…",
      "Starý preset (bez state.instance) nastavení tabulky nemění. Použije se z něj jen pořadí/viditelnost sloupců, řazení a filtry — seskupení, souhrny ani motiv uživateli nezmizí. instance začne nést po…"
    ]
  },
  {
    "version": "1.12.0",
    "date": "2026-08-12",
    "text": "Dynamické období napříč filtry — hranice týdne/měsíce/kvartálu/roku, našeptávač a živé presety v kalendáři. Bez breaking changes.",
    "items": [
      "Tokeny pro hranice období. K today/now přibyly sow/eow (začátek/konec týdne, Po–Ne), som/eom (měsíc), soq/eoq (kvartál), soy/eoy (rok) — s volitelným offsetem (sow-1w, eom-1m, …). Offset se aplikuje…",
      "Našeptávač u dynamického filtru. U pole je tlačítko „?\" s hotovými obdobími (Dnes, Minulý týden, Tento měsíc…) — klik výraz vyplní a rovnou aplikuje; plus stručná reference zápisu.",
      "Dynamická období v date-range pickeru. Přepínač „dynamické období\" v dialogu: zapnutý → klik na preset uloží token ({from:'sow-1w', to:'eow-1w'}) místo pevných dat, takže uložený filtr/preset/snímek…",
      "Demo, příručka a API dokumentace doplněny o hranice období, našeptávač a dynamické date-range presety."
    ]
  },
  {
    "version": "1.11.0",
    "date": "2026-08-12",
    "text": "Dynamický datumový filtr a ukládání „naklikaných\" sloupcových filtrů. Bez breaking changes.",
    "items": [
      "Filtr sloupce – „Dynamické\" (u datumových sloupců). Třetí typ vedle „Datum (rozsah)\" a „Datum (Od / Do)\": do jednoho pole se napíše vlastní výraz s operátory > < >= <= =, spojkami AND/OR (AND váže…",
      "Uložení „naklikaných\" sloupcových filtrů (snímek). Nová ikona v toolbaru (trychtýř + disketa, viditelná jen když nějaký sloupcový filtr platí) uloží aktuální filtry z hlavičky pod názvem — lokálně…",
      "Sjednocení velikosti filtr ikon. Trychtýře „uložit filtry\" a „rozšířený filtr\" měly menší tvar; srovnány na stejný jako „zrušit filtry\".",
      "Demo + příručka + API dokumentace doplněny o obě novinky (dynamický filtr, snímky) a o uživatelské globální presety."
    ]
  },
  {
    "version": "1.10.0",
    "date": "2026-08-12",
    "text": "Uložené rozšířené filtry lze zobrazit jako tlačítka. Bez breaking changes.",
    "items": [
      "Rozšířený filtr – „jako tlačítko\". U uloženého filtru (lokálního i globálního) lze zaškrtnout, že se má vykreslit jako tlačítko v řadě nad ikonami v pravém záhlaví tabulky, místo položky v…"
    ]
  },
  {
    "version": "1.9.0",
    "date": "2026-08-08",
    "text": "Opravný release z hloubkového auditu — správnost napříč vzorci, filtry, výběrem, řazením a exportem. Bez breaking changes.",
    "items": [
      "Vzorce – porovnání datumů. num() parsovalo \"2024-03-15\" přes parseFloat na 2024 (rok) a today()/now() vrací epoch ms → [termin] < today() bylo vždy pravda a [start] < [konec] porovnávalo jen roky.…",
      "Rozšířený filtr – prázdná podskupina pod OR. Prázdná/nedokončená podskupina vracela true a pod OR rodičem propustila všechny řádky. Nyní se neúčinné podskupiny a podmínky bez operátoru ignorují…",
      "Rozšířený filtr – prázdné pole a lt/lte/gt/gte. Prázdné/chybějící pole se řadilo jako „menší než cokoli\" a splnilo lt/lte. Nově prázdné pole žádné ordering nesplní.",
      "Rozšířený filtr – relativní tokeny today±Nm/y. Přetékaly na konci měsíce (31.1 + 1m → 3.3. místo 28.2.). Nově se den ořízne na poslední den cílového měsíce.",
      "Progresivní načítání – race. loadMore() neměl request-id guard; opožděná odpověď mohla přisypat staré řádky na akumulátor resetovaný souběžným refresh(). Doplněn stejný token jako v refresh().",
      "Nastavení – pageSize přes setInstance(). setInstance({ pageSize }) nesynchronizoval this.pageSize (čte ho refresh()/pager) → změna se projevila až po reloadu. Nyní synchronizuje.",
      "Výběr rozsahu vs. připnuté řádky. Připnuté řádky mají string index ('pt0'); klik na ně ukládal do _lastSelIdx string a rozbil následný shift-výběr na normálních řádcích. Ošetřeno (mimo výběr…",
      "Fulltext hledání. Pole se spojovala bez oddělovače (join('')) → hledaný výraz přes hranici dvou polí falešně matchoval. Vloženo oddělení polí.",
      "Datumové seskupení / date-only. YYYY-MM-DD se parsovalo jako UTC a lokální getter posunul den v záporném UTC pásmu; nově se parsuje lokálně.",
      "Preset marker. Sloupcové settery (šířka, barva, formát, titulek, souhrn, otočení, filtr…) i autoFit nerušily „aktivní preset\" → marker visel i po odchylce. Doplněno rušení presetu.",
      "Nastavení sloupců (⚙). Klik na název sloupce skryl/zobrazil sloupec, ale checkbox v panelu se neobnovil (setColumnVisible teď volá gear.refresh()).",
      "Responsive. Vypnuté číslování řádků (rowNumbers: 'none', truthy) rezervovalo 44 px navíc."
    ]
  },
  {
    "version": "1.8.1",
    "date": "2026-08-05",
    "text": "Přepínač „Zvýraznění řádku klikem\" v UI (Nastavení tabulky ⚙ → *Sloupce a řádky*) — instance.rowHighlight (z v1.8.0) šel doteď zapnout jen kódem",
    "items": [
      "Přepínač „Zvýraznění řádku klikem\" v UI (Nastavení tabulky ⚙ → *Sloupce a řádky*) — instance.rowHighlight (z v1.8.0) šel doteď zapnout jen kódem. Nově ho uživatel zapne/vypne přímo z dialogu…"
    ]
  },
  {
    "version": "1.8.0",
    "date": "2026-08-05",
    "text": "Per-sloupcové zalamování textu — column.wrap · Zvýraznění (podbarvení) řádků — nativní feature + API · Server-side: expozice aktuálních serverových parametrů — grid.getServerParams({ paginate? }) a grid.getServerQuery({ paginate? }) · docs/API.md — col.wrap,…",
    "items": [
      "Per-sloupcové zalamování textu — column.wrap. Doteď šlo zalamovat jen globálně (instance.wrapText). Nově col.wrap: true zalomí jen daný sloupec (i při vypnutém globálu), col.wrap: false naopak…",
      "Zvýraznění (podbarvení) řádků — nativní feature + API. Žluté (themeovatelné) podbarvení řádků nezávislé na výběru checkboxy: - API: grid.highlightRow(id, on?), grid.toggleRowHighlight(id),…",
      "Server-side: expozice aktuálních serverových parametrů — grid.getServerParams({ paginate? }) a grid.getServerQuery({ paginate? }). Vrátí filtr/sort/search/advanced (dle paramNames, tokeny…",
      "docs/API.md — col.wrap, sekce *Zvýraznění řádků* (API, instance.rowHighlight, CSS proměnné, UI picker), metody getServerParams/getServerQuery + příklad „vše filtrované\" / export."
    ]
  }
];
