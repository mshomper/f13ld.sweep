// v0.29.2 Push to Vault, end to end in headless Chromium (CPU solver, database mocked).
//   node tests/vault-push.js <f13ld.ingest folder> [case,…] [--shots <folder>]
// For each recipes.json case: runs a seeded sweep, presses Push to Vault,
// fills the push window and pushes. The rows POSTed must equal the rows
// F13LD.ingest builds from this run's Export results file (same checks,
// same hashes, same columns), with provenance_kind 'sweep'. Design #1 is
// "already in Vault" in the mock and must be skipped. Also checks the
// header at phone width (no horizontal scroll) and that Push to Vault is
// off before a run. Nothing leaves the machine.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('playwright')); }

const argv = process.argv.slice(2);
const shotsAt = argv.indexOf('--shots');
const SHOTS = shotsAt >= 0 ? path.resolve(argv[shotsAt + 1]) : null;
if (shotsAt >= 0) argv.splice(shotsAt, 2);
const INGEST = path.resolve(argv[0] || '');
const PUSH_JS = path.join(INGEST, 'f13ld-vault-push.js');
if (!argv[0] || !fs.existsSync(PUSH_JS)) { console.error('usage: node tests/vault-push.js <f13ld.ingest folder> [case,…] [--shots dir]'); process.exit(2); }
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'));
const names = (argv[1] ? argv[1].split(',') : ['tpms-gyroid-sheet', 'foam-open-lloyd', 'wave-schwarzp-solid']);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serve(dir) {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}
const INIT = `
  (() => {
    let s = 1;
    window.SWEEP_SETTINGS = false; window.SWEEP_GPU = false; window.SWEEP_PREFLIGHT = false;
    window.__seed = v => { s = v >>> 0; };
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    /* clock frozen, as in harness.js: exported_at is the time the payload is
       built, so a push and an export only match when the clock stands still */
    const FIX = Date.UTC(2026, 0, 1, 12, 0, 0), _D = Date;
    window.Date = class extends _D { constructor(...a) { super(...(a.length ? a : [FIX])); } static now() { return FIX; } };
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    const _c = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { window.__lastBlob = b; return _c(b); };
    window.open = () => null;
  })();`;

let bad = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) bad++; }

(async () => {
  const srv = await serve(path.resolve(__dirname, '..'));
  const base = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch();

  for (const name of names) {
    const c = CASES[name];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], posts = [];
    let existing = new Set();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(INIT);
    await page.route(/f13ld\.ingest\/f13ld-vault-push\.js/, (r) => r.fulfill({ path: PUSH_JS, contentType: 'text/javascript' }));
    await page.route(/supabase\.co\/rest\/v1\//, async (route) => {
      const req = route.request(), url = new URL(req.url());
      const cors = { 'access-control-allow-origin': '*' };
      if (req.method() === 'POST') {
        JSON.parse(req.postData() || '[]').forEach((row) => posts.push(row));
        return route.fulfill({ status: 201, headers: cors, body: '' });
      }
      const inq = url.searchParams.get('content_hash') || '';
      const want = inq.startsWith('in.(') ? inq.slice(4, -1).split(',') : [];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors,
        body: JSON.stringify(want.filter((h) => existing.has(h)).map((h) => ({ content_hash: h }))) });
    });
    await page.goto(base, { waitUntil: 'load' });
    const offBefore = await page.evaluate(() => document.getElementById('pushVaultBtn').disabled);

    const run = await page.evaluate(async ({ name, c }) => {
      __seed(12345);
      loadFile(new File([JSON.stringify(c.recipe)], name + '.json', { type: 'application/json' }));
      for (let i = 0; i < 100 && document.getElementById('runBtn').disabled; i++) await new Promise((r) => setTimeout(r, 50));
      const sl = document.getElementById('samplesSlider');
      sl.min = '1'; sl.step = '1'; sl.value = String(c.samples); sl.dispatchEvent(new Event('input'));
      __seed(777);
      await runSweep();
      window.__lastBlob = null;
      exportResults();
      const fileText = window.__lastBlob ? await window.__lastBlob.text() : null;
      return { n: results.length, fileText, pushOn: !document.getElementById('pushVaultBtn').disabled };
    }, { name, c });

    // the mock database already holds design #1 of this run
    const file = JSON.parse(run.fileText);
    require(PUSH_JS);
    const V = globalThis.F13LDVault;
    if (file.designs[1]) existing = new Set([await V.contentHash(file.designs[1].design)]);

    await page.click('#pushVaultBtn');
    await page.waitForSelector('#f13vp-name', { timeout: 60000 });
    await page.fill('#f13vp-name', 'Sweep Tester');
    await page.fill('#f13vp-contact', 'sweep@example.com');
    await page.fill('#f13vp-notes', 'vault-push test');
    if (!(await page.isChecked('#f13vp-cc'))) await page.check('#f13vp-cc');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '-window.png') });
    const domain = await page.inputValue('#f13vp-domain');
    await page.click('.f13vp-ft .f13vp-btn');
    await page.waitForSelector('[data-close]', { timeout: 60000 });
    const doneText = await page.textContent('.f13vp-bd');
    await page.click('[data-close]');
    const logText = await page.evaluate(() => [...document.querySelectorAll('#logBody .log-line')].map((l) => l.textContent).join('\n'));

    // what F13LD.ingest builds from this run's exported file
    const a = await V.analyze(file, { existingHashes: existing });
    const b = V.buildRows(a, { contributor: { name: 'Sweep Tester', contact: 'sweep@example.com', notes: 'vault-push test' },
                               domain: domain, provenanceKind: 'sweep' });
    const diffKeys = new Set();
    posts.forEach((r, i) => { const e = b.rows[i] || {};
      Object.keys(Object.assign({}, r, e)).forEach((k) => { if (JSON.stringify(r[k]) !== JSON.stringify(e[k])) diffKeys.add(k); }); });
    const same = posts.length === b.rows.length && diffKeys.size === 0;
    if (diffKeys.size) console.log('     differing columns: ' + Array.from(diffKeys).join(', '));
    check(name + ': Push to Vault is off before a run, on after', offBefore && run.pushOn);
    check(name + ': rows pushed = rows Ingest builds from the exported file', same,
          posts.length + ' pushed · ' + b.rows.length + ' from file · ' + a.counts.valid + ' valid, ' + a.counts.dupe + ' already in Vault, ' + a.counts.invalid + ' failed');
    check(name + ': design #1 skipped as already in Vault', !posts.some((r) => existing.has(r.content_hash)) && a.counts.dupe >= 1);
    check(name + ': rows marked sweep with the contributor', posts.length > 0 && posts.every((r) => r.provenance_kind === 'sweep' && r.contributor_name === 'Sweep Tester'));
    check(name + ': result shown and logged', /added/.test(doneText) && /Pushed to F13LD\.vault/.test(logText), doneText.trim().slice(0, 80));
    check(name + ': no page errors', !errors.length, errors.join(' | '));
    await page.close();
  }

  // header at phone width and narrow desktop: buttons fit, no horizontal scroll
  for (const w of [390, 900, 1280]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } });
    await page.addInitScript(INIT);
    await page.goto(base, { waitUntil: 'load' });
    const r = await page.evaluate(() => {
      const b = document.getElementById('pushVaultBtn').getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth > window.innerWidth, inView: b.right <= window.innerWidth && b.left >= 0, label: document.getElementById('pushVaultBtn').textContent };
    });
    check('header at ' + w + ' px: Push to Vault fits, no horizontal scroll', !r.scroll && r.inView && r.label === 'Push to Vault', JSON.stringify(r));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'header-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 140 } });
    await page.close();
  }

  await browser.close(); srv.close();
  console.log(bad ? 'FAIL: ' + bad + ' problem(s)' : 'PASS: Push to Vault checks');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
