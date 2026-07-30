<?php
/**
 * Demo proxy pro Lattice `importFromUrl` — stáhne cizí URL serverově a vrátí ji,
 * čímž obejde CORS v prohlížeči. Toto NENÍ součást knihovny: v reálné aplikaci
 * (EverFLOW / Nette) by stejnou práci dělal její vlastní backend endpoint. Soubor
 * je tu jen proto, aby příklad „Z URL" fungoval i na statickém (PHP) hostingu dema.
 *
 * Bezpečnost (jde o veřejně dostupnou proxy):
 *   - povolené jen http(s) URL,
 *   - blokace privátních / rezervovaných IP (ochrana proti SSRF),
 *   - bez následování přesměrování (aby redirect neobešel kontrolu IP),
 *   - limit velikosti odpovědi a timeout.
 */

header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

const MAX_BYTES = 5242880; // 5 MB
const TIMEOUT   = 12;      // s

$target = isset($_GET['url']) ? trim((string) $_GET['url']) : '';

if ($target === '' || !preg_match('#^https?://#i', $target)) {
    http_response_code(400);
    echo 'missing/invalid url';
    exit;
}

$parts = parse_url($target);
if ($parts === false || empty($parts['host'])) {
    http_response_code(400);
    echo 'invalid url';
    exit;
}

// --- SSRF guard: odmítni localhost a privátní/rezervované adresy ---
$host = $parts['host'];
if (strcasecmp($host, 'localhost') === 0) {
    deny();
}
$ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
if (!$ips) {
    http_response_code(502);
    echo 'cannot resolve host';
    exit;
}
foreach ($ips as $ip) {
    if (is_blocked_ip($ip)) {
        deny();
    }
}

// --- stažení ---
$body = null;
$code = 200;

if (function_exists('curl_init')) {
    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false, // bez přesměrování (jinak by šlo obejít IP kontrolu)
        CURLOPT_TIMEOUT        => TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 LatticeDemo',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*'],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        http_response_code(502);
        echo 'fetch failed: ' . $err;
        exit;
    }
} else {
    // fallback bez cURL
    $ctx = stream_context_create([
        'http' => ['timeout' => TIMEOUT, 'user_agent' => 'Mozilla/5.0 LatticeDemo', 'follow_location' => 0, 'ignore_errors' => true],
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $body = @file_get_contents($target, false, $ctx, 0, MAX_BYTES);
    if ($body === false) {
        http_response_code(502);
        echo 'fetch failed';
        exit;
    }
}

if (strlen($body) > MAX_BYTES) {
    $body = substr($body, 0, MAX_BYTES);
}
if ($code >= 400) {
    http_response_code($code);
}
echo $body;

/* ------------------------------------------------------------------ */

function deny(): void
{
    http_response_code(403);
    echo 'blocked host (private/reserved address)';
    exit;
}

/** true = adresa je privátní/rezervovaná → zakázat. */
function is_blocked_ip(string $ip): bool
{
    return !filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    );
}
