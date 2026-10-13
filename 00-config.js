/* ============================================================
   F13LD.sweep · 00-config.js
   Tool version. Bump F13LD_SWEEP_VERSION and the header label in
   index.html (.fh-ver) on every release. Exports and handoffs record
   it as meta.tool_version.
   ============================================================ */

const F13LD_SWEEP_VERSION = '0.33.0';

/* v0.29.2 — Push to Vault: the shared push file (validation, row builder,
   duplicate check, push window) lives in F13LD.ingest so every tool uses
   one rule set. ?push=<url> tests another copy (raw.githack.com, GitHub
   Pages or a local server only). */
let VAULT_PUSH_JS = 'https://mshomper.github.io/f13ld.ingest/f13ld-vault-push.js';
try {
  const _pushQ = new URLSearchParams(location.search).get('push');
  if (_pushQ && /^(https:\/\/(raw\.githack\.com|mshomper\.github\.io)\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(_pushQ)) VAULT_PUSH_JS = _pushQ;
} catch (e) { /* no location (worker) or no URLSearchParams: keep the default */ }
