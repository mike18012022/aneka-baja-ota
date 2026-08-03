/*
 * Auto-sync OTA bundle dari situs live.
 * Ambil index.html live -> transform (PB absolut + inject cap-shims.js & ota-update.js)
 * -> kalau berubah (hash beda), bikin aneka-<versi>.zip + latest.json + last.sha256.
 * Dipanggil oleh workflow terjadwal; commit/push ditangani workflow.
 */
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const SITE = 'https://sales.anekabajabekasi.com';
const OTA_BASE = 'https://raw.githubusercontent.com/mike18012022/aneka-baja-ota/main';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ota-sync' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return resolve(get(r.headers.location));
      }
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

(async () => {
  let html = await get(SITE + '/');
  if (!html || html.length < 1000) { console.log('fetch gagal / kosong, skip'); process.exit(0); }

  html = html.replace("const PB = '';", "const PB = '" + SITE + "';");
  if (!/src="cap-shims\.js"/.test(html)) {
    const i = html.lastIndexOf('</body>');
    const inj = '<script src="cap-shims.js"></script>\n<script src="ota-update.js"></script>\n';
    html = i >= 0 ? html.slice(0, i) + inj + html.slice(i) : html + inj;
  }

  const hash = crypto.createHash('sha256').update(html).digest('hex');
  const last = fs.existsSync('last.sha256') ? fs.readFileSync('last.sha256', 'utf8').trim() : '';
  if (hash === last) { console.log('tidak ada perubahan konten, skip'); process.exit(0); }

  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const version = `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;

  fs.writeFileSync('index.html', html);
  const zip = `aneka-${version}.zip`;
  // buang zip lama
  for (const f of fs.readdirSync('.')) { if (/^aneka-.*\.zip$/.test(f)) fs.unlinkSync(f); }
  execSync(`zip -j ${zip} index.html cap-shims.js ota-update.js`, { stdio: 'inherit' });
  fs.writeFileSync('latest.json', JSON.stringify({ version, url: `${OTA_BASE}/${zip}` }));
  fs.writeFileSync('last.sha256', hash);
  console.log('published', version);
})();
