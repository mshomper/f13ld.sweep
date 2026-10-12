// v0.32.0 — Preflight's fix search (64-preflight.js pfFixes) with mocked test
// solves: which fix it confirms, and what the popup says it tried, under a
// shortened time limit (1.5 s, solves scaled to match). Node built-ins only.
//   node tests/preflight-fixes.js
const fs=require('fs'),vm=require('vm');
const src0=fs.readFileSync(require('path').join(__dirname,'..','64-preflight.js'),'utf8');
function make(passFn, msFn){
  const ctx={console,performance,Map,Set,Promise,JSON,Math,setTimeout,
    document:{addEventListener(){}},window:{},location:{search:''},
    resolveGridNFor:(m,n)=>n, PRECISION_MODES:{fast:{},rigorous:{}}, log(){}, baseDensity:0.30};
  vm.createContext(ctx); vm.runInContext(src0.replace('const PF_FIX_BUDGET_MS = 15000;','var PF_FIX_BUDGET_MS = 15000;'),ctx);
  ctx.pfSolve=async(S,pool,p,vf,N)=>{const ms=msFn(S,vf,N);await new Promise(r=>setTimeout(r,ms));return {built:true,flagged:!passFn(S,vf,N,p),iss:[{k:'trim'}],own:null,E:[1,1,1],ms};};
  ctx.pfJudge=(S,r)=>r;
  return ctx;
}
async function scen(name,passFn,msFn,nFlag,budget){
  const c=make(passFn,msFn); if(budget) vm.runInContext('PF_FIX_BUDGET_MS='+budget,c);
  const S={dens:{lo:0.181,hi:0.40,auto:true},gridN:32,pick:32,gpu:true,precMode:'rigorous',mode:'grain-sheet'};
  vm.runInContext('PF.gen=1',c); const R={time:{},cancelled:false};
  const flagged=[...Array(nFlag)].map((_,i)=>({idx:i,res:{ms:1000,slice:null,iss:[{k:'trim'}]}}));
  const t=Date.now(); await c.pfFixes(S,1,R,null,flagged);
  const got={floor:R.floorFix?+R.floorFix.floor.toFixed(3):null,set:R.setFix?R.setFix.N:null,capped:!!R.fixCapped};
  console.log(name.padEnd(46),JSON.stringify(got),'|',c.pfTriedText(R));
  return got;
}
let bad=0;const expect=(g,w)=>{for(const k in w)if(g[k]!==w[k]){bad++;console.log('   FAIL',k,'got',g[k],'want',w[k]);}};
(async()=>{
 // budget scaled: 1500 ms instead of 15 s; solve ms scaled /10
 expect(await scen('slow: floor clears at cap, time runs out', (S,vf,N)=>vf>=0.25, ()=>500, 1, 1500), {set:null,capped:true});
 expect(await scen('grid 64 clears, floor fails', (S,vf,N)=>N>=64, (S,vf,N)=>N>=64?800:300, 1, 1500), {floor:null,set:64});
 expect(await scen('nothing clears', ()=>false, ()=>300, 1, 1500), {floor:null,set:null});
 expect(await scen('two flagged, floor clears others too', (S,vf,N)=>vf>=0.22, ()=>200, 2, 1500), {floor:0.23});
 expect(await scen('very slow: nothing finishes in time', (S,vf,N)=>N>=64, ()=>2000, 2, 1500), {floor:null,set:null,capped:true});
 console.log(bad?bad+' check(s) failed':'all checks passed'); process.exit(bad?1:0);
})();
