<?php
/**
 * api.php — PHP náhrada Node `demo/server.js` pro sdílené hostingy (Wedos apod.),
 * kde neběží Node. Drží globální PRESETY a globální VÝCHOZÍ NASTAVENÍ tabulky
 * ve dvou JSON souborech (bez databáze). Kontrakt je shodný s Node serverem,
 * takže klientský kód Lattice/dema se NEMĚNÍ.
 *
 * Routuje se sem přes .htaccess (Apache) nebo router.php (php -S). Endpoint se
 * pozná z cesty požadavku (/api/presets | /api/defaults).
 *
 * Úložiště: složka ./data (vytvoří se sama), soubory presets.json a defaults.json.
 *
 * ⚠️ Bez autentizace — kdokoli může zapsat. Pro veřejné/produkční nasazení
 *    přidej ověření (token/session). Pro interní demo/sdílení stačí takto.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$DATA_DIR = __DIR__ . '/data';
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Který endpoint (z cesty, ať funguje s .htaccess i router.php beze změny klienta).
if (strpos($uri, '/api/defaults') !== false) {
    handle_defaults($DATA_DIR, $method);
} elseif (strpos($uri, '/api/presets') !== false) {
    handle_presets($DATA_DIR, $method);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'unknown endpoint']);
}

/* ------------------------------------------------------------------ presety */
// GET  ?grid=ID            → pole presetů daného gridu
// POST ?grid=ID {preset}   → uloží (stejný název přepíše), vrátí preset
// DELETE ?grid=ID&id=PID   → smaže preset, vrátí {ok:true}
function handle_presets($dir, $method) {
    $file = $dir . '/presets.json';
    $grid = isset($_GET['grid']) ? (string) $_GET['grid'] : 'default';
    $store = read_json($file);           // { gridId: [ {preset}, ... ] }
    if (!isset($store[$grid]) || !is_array($store[$grid])) $store[$grid] = [];

    if ($method === 'GET') {
        echo json_encode(array_values($store[$grid]));
        return;
    }
    if ($method === 'POST') {
        $body = read_body();
        $preset = isset($body['preset']) ? $body['preset'] : $body;
        if (!$preset || empty($preset['name'])) { echo json_encode(['error' => 'missing preset']); return; }
        // stejný název přepíše
        $store[$grid] = array_values(array_filter($store[$grid], fn($p) => ($p['name'] ?? null) !== $preset['name']));
        $store[$grid][] = $preset;
        write_json($file, $store);
        echo json_encode($preset);
        return;
    }
    if ($method === 'DELETE') {
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $store[$grid] = array_values(array_filter($store[$grid], fn($p) => ($p['id'] ?? null) !== $id));
        write_json($file, $store);
        echo json_encode(['ok' => true]);
        return;
    }
    http_response_code(405);
    echo json_encode(['error' => 'method not allowed']);
}

/* ------------------------------------------- globální výchozí nastavení tabulky */
// GET                       → celá mapa { gridId: {version, state} }
// POST {grid, defaults}     → uloží defaulty gridu, vrátí {ok:true}
function handle_defaults($dir, $method) {
    $file = $dir . '/defaults.json';
    $store = read_json($file);           // { gridId: {version, state} }

    if ($method === 'GET') {
        echo json_encode((object) $store); // vždy objekt (i prázdný)
        return;
    }
    if ($method === 'POST') {
        $body = read_body();
        $grid = $body['grid'] ?? ($_GET['grid'] ?? null);
        $defaults = $body['defaults'] ?? null;
        if (!$grid || !$defaults) { echo json_encode(['error' => 'missing grid/defaults']); return; }
        $store[$grid] = $defaults;
        write_json($file, $store);
        echo json_encode(['ok' => true]);
        return;
    }
    http_response_code(405);
    echo json_encode(['error' => 'method not allowed']);
}

/* ------------------------------------------------------------------ pomocné */
function read_body() {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function read_json($file) {
    if (!is_file($file)) return [];
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function write_json($file, $data) {
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
        // Zabraň přímému stažení JSON úložiště přes web.
        @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    // atomický zápis s zámkem (základní ochrana proti souběhu)
    $fp = @fopen($file, 'c+');
    if ($fp) {
        if (flock($fp, LOCK_EX)) {
            ftruncate($fp, 0);
            fwrite($fp, $json);
            fflush($fp);
            flock($fp, LOCK_UN);
        }
        fclose($fp);
    } else {
        @file_put_contents($file, $json, LOCK_EX);
    }
}
