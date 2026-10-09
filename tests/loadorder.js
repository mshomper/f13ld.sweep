// Static check: for the page's classic scripts (index.html order) and the
// worker's importScripts list, flag top-level code that, at LOAD time, reads a
// binding declared in a LATER file (function declarations don't hoist across
// files). Also flags worker files with load-time DOM access.
//   node tests/loadorder.js [buildDir]
const fs = require('fs'), path = require('path'), acorn = require('acorn');
const OUT = process.argv[2] || path.join(__dirname, '..');
const idx = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const main = [...idx.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const wsrc = fs.readFileSync(path.join(OUT, 'worker/sweep-worker.js'), 'utf8');
const wk = [...wsrc.matchAll(/'\.\.\/([^']+\.js)'/g)].map(m => m[1]);

function loadRefs(stmt) {
  const refs = [], guarded = new Set();
  (function visit(n, parentIsCall) {
    if (!n || typeof n.type !== 'string') return;
    if (/Function/.test(n.type) && !parentIsCall) return;   // deferred bodies (IIFEs still run)
    if (n.type === 'Identifier') refs.push(n.name);
    /* typeof X guards X (e.g. a Lab file's  if (typeof KERNELS !== 'undefined') KERNELS.foam = …) */
    if (n.type === 'UnaryExpression' && n.operator === 'typeof' && n.argument.type === 'Identifier') guarded.add(n.argument.name);
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'loc') continue;
      if (n.type === 'MemberExpression' && k === 'property' && !n.computed) continue;
      if (n.type === 'Property' && k === 'key' && !n.computed) continue;
      const v = n[k], pc = (n.type === 'CallExpression' || n.type === 'NewExpression') && k === 'callee';
      if (Array.isArray(v)) v.forEach(c => visit(c, false)); else if (v && typeof v.type === 'string') visit(v, pc);
    }
  })(stmt, false);
  return new Set(refs.filter(r => !guarded.has(r)));
}

function check(group, label, domFree) {
  const decl = {}, asts = {};
  group.forEach((f, i) => {
    const ast = acorn.parse(fs.readFileSync(path.join(OUT, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    asts[f] = ast;
    for (const s of ast.body) {
      if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') {
        if (decl[s.id.name] !== undefined) { console.log(label, 'DUPLICATE', s.id.name, f); bad++; }
        decl[s.id.name] = i;
      }
      if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier') {
        if (decl[d.id.name] !== undefined) { console.log(label, 'DUPLICATE', d.id.name, f); bad++; }
        decl[d.id.name] = i;
      }
    }
  });
  group.forEach((f, i) => {
    for (const s of asts[f].body) {
      if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') continue;
      for (const r of loadRefs(s)) {
        if (decl[r] !== undefined && decl[r] > i) { bad++; console.log(label, f, 'line', s.loc.start.line, 'uses', r, 'from later file', group[decl[r]]); }
        if (domFree && (r === 'document' || r === 'window' || r === 'localStorage')) { bad++; console.log(label, f, 'line', s.loc.start.line, 'touches', r, 'at load (worker has no DOM)'); }
      }
    }
  });
  console.log(label + ': ' + group.length + ' files, ' + Object.keys(decl).length + ' top-level names');
}
let bad = 0;
check(main, 'PAGE', false);
check(wk, 'WORKER', true);
const missing = wk.filter(f => !main.includes(f));
if (missing.length) { bad++; console.log('WORKER loads files the page does not:', missing); }
console.log(bad ? `FAIL (${bad})` : 'OK — no forward references at load time');
process.exit(bad ? 1 : 0);
