# Lattice

Moderní, štíhlá a **framework-agnostická** datová tabulka (grid) ve vanilla JS (ESM).
Bez runtime závislostí, s jedním zdrojem pravdy pro persistenci a deterministickým initem.

📖 **[Kompletní API reference → `docs/API.md`](./docs/API.md)** — options, sloupce, typy, filtry, metody, callbacky, features.
📘 **[Uživatelská příručka → `prirucka/`](./prirucka/index.html)** — jak tabulku *ovládat* (pro uživatele aplikace, ne vývojáře): řazení, filtry, seskupení, editace, export… s obrázky.
Živé ukázky ke všemu jsou v demu (`npm run demo` → `demo/index.html`).

## Proč „Lattice"?

Název sedí hned na několika rovinách:

- **Mřížka** — *lattice* je doslova pravidelná mříž křížících se linek: řádky × sloupce protínající se v buňkách. Popisuje produkt bez metafory.
- **Uspořádání** — v matematice je *lattice* (svaz) částečně uspořádaná množina s join/meet operacemi. To je přesně jádro knihovny: **řazení, filtrování (A/NEBO stromy), seskupení a hierarchie**.
- **Lehké, ale pevné** — krystalová i příhradová (*lattice*) konstrukce nesou hodně při minimu materiálu. Doslova filozofie projektu: vanilla JS, **0 závislostí, bez build kroku**, „knihovna počítá, aplikace persistuje".

> Mřížka, která řadí a uspořádává data — a nese hodně při minimu materiálu.

**Výslovnost:** *Lattice* [ˈlætɪs] — zhruba **„LE-tys"** s důrazem na první slabiku (zní skoro jako anglické *lettuce*, hlávkový salát); ne „lat-tajs". Česky se často slyší „letys" i „latis".

## Instalace

**Z CDN — jeden soubor, bez buildu** (nejrychlejší začátek):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/svatekr70/lattice@main/dist/lattice.css">
<div id="grid"></div>
<script type="module">
  import { Lattice } from 'https://cdn.jsdelivr.net/gh/svatekr70/lattice@main/dist/lattice.min.js';
  new Lattice('#grid', { columns, data });
</script>
```

Pro produkci připni verzi místo `@main` (tag `@v0.1.0` nebo konkrétní commit).
Celá knihovna je jeden sbalený ESM soubor — načte se **jedním requestem**.

**Přes npm:**

```bash
npm i lattice
```

## Minimální příklad

```js
import { Lattice } from 'lattice';
import 'lattice/css';

new Lattice('#grid', {
  id: 'campaigns',
  data: [
    { name: 'Jarní akce', createdAt: '2026-03-01', active: true },
    { name: 'Léto',       createdAt: '2026-06-15', active: false },
  ],
  columns: [
    { field: 'name',      title: 'Název',     type: 'text',    filter: 'text' },
    { field: 'createdAt', title: 'Vytvořeno', type: 'date',    filter: 'date-range' },
    { field: 'active',    title: 'Aktivní',   type: 'boolean', filter: 'select' },
  ],
});
```

## Build

Runtime je bez závislostí. Sbalený `dist/` se generuje esbuildem:

```bash
npm install   # dev závislost esbuild
npm run build # → dist/lattice.js, dist/lattice.min.js, dist/lattice.css
```

## Licence

MIT
