# Changelog

Všechny podstatné změny v tomto projektu. Formát vychází z
[Keep a Changelog](https://keepachangelog.com/cs/1.1.0/); projekt používá
[sémantické verzování](https://semver.org/lang/cs/).

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
