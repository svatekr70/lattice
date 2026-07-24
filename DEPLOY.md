# Nasazení dema na sdílený hosting (Wedos apod.) — bez Node, bez databáze

Grid je celý client-side, takže na statickém hostingu jede sám. Server (PHP) je
potřeba jen pro **sdílené** věci: globální presety a globální výchozí nastavení
tabulky. Řeší je `api.php` (flat-file JSON, žádná DB). Kontrakt je shodný s Node
`demo/server.js`, takže klientský kód se nemění.

## Co nahrát do kořene webu (public_html / www)

```
/  (kořen domény nebo subdomény)
├── api.php          ← PHP endpoint (presety + defaulty)
├── .htaccess        ← routing /api/* → api.php (Apache/Wedos)
├── src/             ← knihovna Lattice (+ lattice.css)
└── demo/            ← statické demo (index.html, app.js, …)
```

Složka `data/` se vytvoří sama při prvním uložení (musí být zapisovatelná —
na běžném PHP hostingu je). `router.php` a `demo/server.js` na Wedos nenahrávej,
nejsou tam potřeba.

Otevři pak: **`https://tvojedomena/demo/`**

> Musí to být v **kořeni** domény/subdomény, protože klient volá absolutní cesty
> `/api/presets` a `/api/defaults`. Když to dáš do podsložky, uprav v `.htaccess`
> `RewriteBase` a případně cesty.

## Lokální vyzkoušení (máš PHP)

Z kořene projektu:

```bash
php -S localhost:8000 router.php
```

`router.php` dělá totéž co `.htaccess` (routuje `/api/*` na `api.php`), zbytek
servíruje staticky. Otevři **http://localhost:8000/demo/**. Uložení globálního
presetu / „Nastavit výchozí pro všechny" zapíše do `data/presets.json` resp.
`data/defaults.json` — a jiný prohlížeč mířící na stejný server to uvidí.

## Co na čistě statickém řešení (bez api.php) fungovat NEbude
- globální presety (globus) a globální výchozí nastavení („pro všechny")
- demo příklady napojené na server: **Server-side (mock API)**, **Progresivní
  načítání** (volají `/api/campaigns`) a XML-feed import (`/api/fetch`) —
  `api.php` je záměrně neřeší (nejsou potřeba pro sdílení konfigurace).

Vše ostatní (tabulka, filtry, editace, motivy, formáty, **lokální** presety a
veškeré nastavení přes localStorage) jede i bez serveru.

## ⚠️ Bezpečnost
`api.php` nemá autentizaci — kdokoli může zapsat globální preset/konfiguraci.
Pro interní/soukromé demo to stačí. Pro veřejné nasazení přidej ověření
(token/session) nebo to nech jen pro přihlášené. `data/` je přes `.htaccess`
chráněná proti přímému stažení.
