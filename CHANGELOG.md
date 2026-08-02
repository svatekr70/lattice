# Changelog

Všechny podstatné změny v tomto projektu. Formát vychází z
[Keep a Changelog](https://keepachangelog.com/cs/1.1.0/); projekt používá
[sémantické verzování](https://semver.org/lang/cs/).

## [Nevydáno]

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
