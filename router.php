<?php
/**
 * router.php — směrovací skript pro vestavěný PHP server (lokální testování):
 *
 *     php -S localhost:8000 router.php
 *
 * Emuluje to, co na Wedosu dělá .htaccess: požadavky na /api/presets a
 * /api/defaults pošle do api.php, vše ostatní servíruje jako statický soubor.
 * Otevři pak: http://localhost:8000/demo/
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// /api/presets a /api/defaults → api.php (query string ?grid=…/&id=… se zachová)
if (preg_match('#^/api/(presets|defaults)$#', $uri)) {
    require __DIR__ . '/api.php';
    return true;
}

// Statické soubory necháme obsloužit vestavěný server (return false).
return false;
