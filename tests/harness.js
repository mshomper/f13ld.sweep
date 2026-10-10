// F13LD.sweep regression harness — runs the SAME seeded sweeps in two builds
// (e.g. the last release and a working copy) in headless Chromium and
// compares everything a user can get out of them:
//   · the results array (every metric of every design, in order)
//   · the results table HTML and the run log (clock times frozen)
//   · the exported results JSON and the per-design F13LD.mesh handoff recipe
//   · console errors / page errors (preview shader compile included)
//
//   node tests/harness.js <oldBuildDir> <newBuildDir> [case,case,...]
//
// Deterministic by construction: Math.random is seeded per case, Date is
// frozen, and the pool runs one worker (hardwareConcurrency = 2), so designs
// are generated and solved in the same order in both builds.
//
// Needs: playwright-core + a Chromium (PLAYWRIGHT_BROWSERS_PATH), acorn not needed.
// Exit code 0 = identical, 1 = differences (listed), 2 = harness failure.

const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { ({ chromium } = require('playwright')); }

const [OLD, NEW, FILTER] = process.argv.slice(2);
if (!OLD || !NEW) { console.error('usage: node tests/harness.js <oldBuildDir> <newBuildDir> [case,...]'); process.exit(2); }
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'));
const names = Object.keys(CASES).filter(k => !k.startsWith('_') && (!FILTER || FILTER.split(',').includes(k)));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serve(dir) {
  dir = path.resolve(dir);
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(path.resolve(dir)) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

// Runs in the page before any app script.
const INIT = `
  (() => {
    let s = 1;
    window.SWEEP_SETTINGS = false;   /* v0.25.0: no remembered settings — every case starts from the defaults */
    window.SWEEP_GPU = false;   /* v0.24.0: compare the CPU solver path (the GPU path has its own checks, bench.html) */
    window.__seed = v => { s = v >>> 0; };
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const FIX = Date.UTC(2026, 0, 1, 12, 0, 0), _D = Date;
    window.Date = class extends _D { constructor(...a) { super(...(a.length ? a : [FIX])); } static now() { return FIX; } };
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    const _c = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { window.__lastBlob = b; return _c(b); };
    window.open = () => null;                         // mesh handoff: don't open tabs
  })();`;

async function runBuild(browser, url, label) {
  const out = {};
  for (const name of names) {
    const c = CASES[name];
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
    await page.addInitScript(INIT);
    await page.goto(url, { waitUntil: 'load' });
    const t0 = Date.now();
    const r = await page.evaluate(async ({ name, c }) => {
      const rep = {};
      __seed(12345);
      const file = new File([JSON.stringify(c.recipe)], name + '.json', { type: 'application/json' });
      loadFile(file);
      for (let i = 0; i < 100 && document.getElementById('runBtn').disabled; i++) await new Promise(r => setTimeout(r, 50));
      rep.loaded = !document.getElementById('runBtn').disabled;
      rep.fileMeta = document.getElementById('fileMeta').textContent;
      if (!rep.loaded) { rep.log = [...document.querySelectorAll('#logBody .log-line')].map(l => l.textContent).join('\n'); return rep; }
      if (c.ui) {
        if (c.ui.domain) { document.getElementById('domainSel').value = c.ui.domain; onDomainChange(); }
        if (c.ui.precision) setPrecisionUI(c.ui.precision);
        if (c.ui.resolution) setResolutionUI(c.ui.resolution);
      }
      const sl = document.getElementById('samplesSlider');
      sl.min = '1'; sl.step = '1'; sl.value = String(c.samples); sl.dispatchEvent(new Event('input'));
      __seed(777);
      await runSweep();
      rep.results = JSON.parse(JSON.stringify(results));
      rep.table = document.getElementById('tableWrap').innerHTML;
      rep.stats = [...document.querySelectorAll('[id^=stat]')].map(e => e.id + '=' + e.textContent).join('|');
      rep.plotInfo = document.getElementById('plotInfo') ? document.getElementById('plotInfo').textContent : '';
      if (results.length) {
        rep.meshRecipe = JSON.parse(JSON.stringify(buildMeshRecipe(results[0])));
        window.__lastBlob = null;
        try { exportResults(); rep.exportJson = window.__lastBlob ? await window.__lastBlob.text() : null; }
        catch (e) { rep.exportErr = String(e); }
        try { showPreview(results[0]); rep.previewBadge = document.getElementById('previewBadge').textContent; }
        catch (e) { rep.previewErr = String(e); }
      }
      /* line by line: innerText drops line breaks once the log sits in a hidden drawer tab (v0.25.0) */
      rep.log = [...document.querySelectorAll('#logBody .log-line')].map(l => l.textContent).join('\n');
      return rep;
    }, { name, c });
    r.secs = Math.round((Date.now() - t0) / 1000);
    r.errors = errors;
    out[name] = r;
    console.log(`  [${label}] ${name}: loaded=${r.loaded} designs=${r.results ? r.results.length : '-'} ${r.secs}s errors=${errors.length}`);
    await page.close();
  }
  return out;
}

// Fields that are SUPPOSED to change between releases.
// v0.24.0: the stiffness flags and the export schema bump are intended additions.
// v0.28.0: meta.solver.target (null without a target) is an intended addition.
const IGNORE = new Set(['tool_version', 'schema_version', 'target', 'stiffness_flag', 'void_limited_axes', 'under_resolved', 'stiffness_flag_reasons', 'stiffness_flag_void_share']);
// …and the flag markers in the table HTML
const stripFlags = h => typeof h === 'string' ? h.replace(/<span class="sflag"[^>]*><\/span>/g, '').replace(/<span class="sflag-val"[^>]*>([\s\S]*?<\/span>)<\/span>/g, '$1').replace(/<td class="td-rank">/g, '<td class="td-rank">') : h;
// v0.25.0: icons are SVG now (no glyphs) and header tooltips carry the
// metric descriptions — markup only, not compared; every cell still is.
const normUi = h => typeof h === 'string' ? h
  .replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<span class="sort-indicator">[^<]*<\/span>/g, '<span class="sort-indicator"></span>')
  .replace(/(<th\b[^>]*?) title="[^"]*"/g, '$1')
  .replace(/<div class="empty-icon">[^<]*<\/div>|<span class="empty-ico">\s*<\/span>/g, '') : h;
const normLog = t => typeof t === 'string' ? t.replace(/\u26a0 /g, '') : t;
function firstDiff(a, b, p = '') {
  if (typeof a !== typeof b) return p + ': type ' + typeof a + ' vs ' + typeof b;
  if (a && b && typeof a === 'object') {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) { if (IGNORE.has(k)) continue; const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
    return null;
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  return a === b ? null : `${p}: ${JSON.stringify(a).slice(0, 120)} vs ${JSON.stringify(b).slice(0, 120)}`;
}

(async () => {
  const [s1, s2] = await Promise.all([serve(OLD), serve(NEW)]);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const u = s => `http://127.0.0.1:${s.address().port}/`;
    console.log(`cases: ${names.join(', ')}`);
    const [A, B] = await Promise.all([runBuild(browser, u(s1), 'old'), runBuild(browser, u(s2), 'new')]);
    let bad = 0;
    for (const n of names) {
      const a = A[n], b = B[n];
      /* v0.25.0: the stat cards are gone (a funnel line replaced them) and
         the preview badge shows the rank — not compared. */
      const fields = ['loaded', 'fileMeta', 'results', 'table', 'plotInfo', 'meshRecipe', 'exportJson', 'exportErr', 'previewErr', 'log'];
      const val = (r, f) => (f === 'exportJson' && typeof r[f] === 'string') ? JSON.parse(r[f]) : f === 'table' ? normUi(stripFlags(r[f])) : f === 'log' ? normLog(r[f]) : r[f];
      const diffs = fields.map(f => firstDiff(val(a, f), val(b, f), f)).filter(Boolean);
      if (b.errors.length) diffs.push('new build errors: ' + b.errors.slice(0, 3).join(' || '));
      if (a.errors.length) console.log(`  note: old build errors in ${n}: ${a.errors.slice(0, 2).join(' || ')}`);
      if (diffs.length) { bad++; console.log(`DIFF ${n}:\n   ` + diffs.slice(0, 6).join('\n   ')); }
      else console.log(`SAME ${n}  (${a.results ? a.results.length : 0} designs, old ${a.secs}s / new ${b.secs}s)`);
    }
    fs.writeFileSync(path.join(process.env.HARNESS_OUT || '.', 'harness-last.json'), JSON.stringify({ old: A, new: B }));
    console.log(bad ? `FAIL: ${bad} of ${names.length} cases differ` : `PASS: all ${names.length} cases identical`);
    process.exitCode = bad ? 1 : 0;
  } catch (e) { console.error(e); process.exitCode = 2; }
  finally { await browser.close(); s1.close(); s2.close(); }
})();
