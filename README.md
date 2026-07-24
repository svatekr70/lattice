# Lattice

Moderní, štíhlá a **framework-agnostická** datová tabulka (grid) ve vanilla JS (ESM).
Bez runtime závislostí, s jedním zdrojem pravdy pro persistenci a deterministickým initem.

## Instalace

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

## Stav vývoje

Rozpracováno — viz [`nova-grid-komponenta-zadani.md`](./nova-grid-komponenta-zadani.md).

## Licence

MIT
