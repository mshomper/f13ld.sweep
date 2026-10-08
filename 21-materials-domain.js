/* ============================================================
   F13LD.sweep · 21-materials-domain.js
   Material database, application domains, precision / grid pickers, material getters.
   ============================================================ */

// ─── Material database ────────────────────────────────────────────────────────
// E: GPa, nu: Poisson, k: W/m·K (thermal conductivity), rho_mat: kg/m³
// eps_yield_um: linear-elastic strain cap (microstrain). σ_y/E for ductile metals;
//   compressive fracture strain for brittle ceramics; longitudinal failure strain
//   for fiber composites. Past this strain, the linear elastic prediction
//   sig/E_eff is no longer physical and should be flagged.
// linear_cap_kind: 'yield' for ductile (gradual onset), 'fracture' for brittle
//   (sudden failure). Drives downstream interpretation, not the cap value.
//
// Reference: AM-process values used where they diverge significantly from
// wrought (SS316L, Inconel 625) since AM is the dominant fabrication path
// for F13LD scaffolds. Tool Steel = H13 hardened/AM. HSLA = Grade 60 mid-range.
// Copper = half-hard temper (cold-worked, typical for thermal applications).
const MATERIALS = {
  // Biomedical
  'Ti6Al4V':    { E: 114,  nu: 0.33, k: 7.2,   rho_mat: 4430,  eps_yield_um: 8000,  linear_cap_kind: 'yield',    label: 'Ti6Al4V' },
  'PEEK':       { E: 3.6,  nu: 0.40, k: 0.25,  rho_mat: 1320,  eps_yield_um: 25000, linear_cap_kind: 'yield',    label: 'PEEK' },
  'SS316L':     { E: 193,  nu: 0.27, k: 16.0,  rho_mat: 7980,  eps_yield_um: 2850,  linear_cap_kind: 'yield',    label: 'SS316L' },
  'HA':         { E: 80,   nu: 0.28, k: 1.3,   rho_mat: 3160,  eps_yield_um: 1600,  linear_cap_kind: 'fracture', label: 'HA Ceramic' },
  // Aerospace
  'Al7075':     { E: 71,   nu: 0.33, k: 130,   rho_mat: 2810,  eps_yield_um: 6800,  linear_cap_kind: 'yield',    label: 'Al 7075' },
  'Inconel718': { E: 200,  nu: 0.29, k: 11.4,  rho_mat: 8190,  eps_yield_um: 5200,  linear_cap_kind: 'yield',    label: 'Inconel 718' },
  'CFRP':       { E: 70,   nu: 0.10, k: 5.0,   rho_mat: 1600,  eps_yield_um: 15000, linear_cap_kind: 'fracture', label: 'CFRP (UD)' },
  // Oil & Gas
  'Inconel625': { E: 208,  nu: 0.31, k: 9.8,   rho_mat: 8440,  eps_yield_um: 2650,  linear_cap_kind: 'yield',    label: 'Inconel 625' },
  'ToolSteel':  { E: 210,  nu: 0.28, k: 35.0,  rho_mat: 7850,  eps_yield_um: 6200,  linear_cap_kind: 'yield',    label: 'Tool Steel' },
  // Automotive
  'Al6061':     { E: 69,   nu: 0.33, k: 167,   rho_mat: 2700,  eps_yield_um: 4000,  linear_cap_kind: 'yield',    label: 'Al 6061' },
  'HSLA':       { E: 200,  nu: 0.29, k: 50.0,  rho_mat: 7800,  eps_yield_um: 2250,  linear_cap_kind: 'yield',    label: 'HSLA Steel' },
  'PA12':       { E: 1.6,  nu: 0.39, k: 0.23,  rho_mat: 1010,  eps_yield_um: 31000, linear_cap_kind: 'yield',    label: 'Nylon PA12' },
  // Thermal
  'Copper':     { E: 110,  nu: 0.34, k: 401,   rho_mat: 8960,  eps_yield_um: 1800,  linear_cap_kind: 'yield',    label: 'Copper' },
  'Al6061_t':   { E: 69,   nu: 0.33, k: 167,   rho_mat: 2700,  eps_yield_um: 4000,  linear_cap_kind: 'yield',    label: 'Al 6061' },
};

// Agnostic fallback when no material is selected — covers most metals and bone
// (24% of metals, 95% of cortical bone). Linear cap kind defaults to 'yield'
// since most engineering materials yield rather than fracture.
const EPS_YIELD_AGNOSTIC = 25000;
const LINEAR_CAP_KIND_AGNOSTIC = 'yield';
// Per-GPa structural cap — 1e6 με/GPa = 100% strain at unit applied stress.
// Past this, the structure is acting as foam, not scaffold. Material-agnostic.
const MICROSTRAIN_PER_GPA_CAP = 1e6;

const DOMAIN_MATERIALS = {
  general:    [],
  biomedical: ['Ti6Al4V','PEEK','SS316L','HA'],
  aerospace:  ['Ti6Al4V','Al7075','Inconel718','CFRP'],
  oilgas:     ['SS316L','Inconel625','ToolSteel'],
  automotive: ['Al6061','HSLA','PA12','SS316L'],
  thermal:    ['Copper','Al6061_t','Ti6Al4V','SS316L'],
};

let currentMaterial = null; // null = agnostic

// ─── Domain configuration — visible metrics + rank defaults ──────────────────
// 'show' controls which columns appear in the table and metric key.
// All metrics are always computed and exported regardless.
// r1/r2/r3: { metric, dir } — null means leave as-is
const DOMAIN_CONFIG = {
  general:    { sigma_ref: 1,   show: ['anisotropy','Ex_GPa','Ey_GPa','Ez_GPa','stiffness_density','aniso_efficiency','directionality','ortho_contrast','stiff_axis','connect_idx','keff_x','keff_y','keff_z','thermal_anisotropy','k_density','U_strain','microstrain_x','microstrain_y','microstrain_z','microstrain_avg','pore_size','throat_size','throat_ratio','perc_idx','volume_fraction'], r1:null, r2:null, r3:null },
  biomedical: { sigma_ref: 2,   show: ['connect_idx','Ex_GPa','Ey_GPa','Ez_GPa','anisotropy','stiffness_density','U_strain','microstrain_avg','pore_size','throat_size','throat_ratio','perc_idx','volume_fraction'], r1:{metric:'microstrain_avg',dir:'min'}, r2:{metric:'pore_size',dir:'max'}, r3:{metric:'throat_ratio',dir:'max'} },
  aerospace:  { sigma_ref: 100, show: ['directionality','stiffness_density','anisotropy','Ex_GPa','Ey_GPa','Ez_GPa','aniso_efficiency','stiff_axis','connect_idx','volume_fraction'], r1:{metric:'directionality',dir:'max'}, r2:{metric:'anisotropy',dir:'max'}, r3:{metric:'volume_fraction',dir:'min'} },
  oilgas:     { sigma_ref: 50,  show: ['connect_idx','anisotropy','stiffness_density','Ex_GPa','Ey_GPa','Ez_GPa','ortho_contrast','pore_size','throat_size','throat_ratio','perc_idx','volume_fraction'], r1:{metric:'connect_idx',dir:'max'}, r2:{metric:'anisotropy',dir:'min'}, r3:{metric:'stiffness_density',dir:'max'} },
  automotive: { sigma_ref: 50,  show: ['ortho_contrast','stiffness_density','directionality','aniso_efficiency','Ex_GPa','Ey_GPa','Ez_GPa','connect_idx','U_strain','microstrain_x','microstrain_y','microstrain_z','volume_fraction'], r1:{metric:'ortho_contrast',dir:'max'}, r2:{metric:'stiffness_density',dir:'max'}, r3:{metric:'volume_fraction',dir:'min'} },
  thermal:    { sigma_ref: null, show: ['keff_x','keff_y','keff_z','thermal_anisotropy','k_density','connect_idx','pore_size','throat_size','perc_idx','volume_fraction','surface_complexity'], r1:{metric:'k_density',dir:'max'}, r2:{metric:'thermal_anisotropy',dir:'max'}, r3:{metric:'connect_idx',dir:'max'} },
};

// Currently active visible set — starts as general (all)
let activeDomainShow = DOMAIN_CONFIG.general.show;

// v0.16.0: Precision mode toggle handler. Drives _currentPrecisionMode
// (consumed by buildDesignSpec at sweep time) and updates the UI hint.
// Snapshotting happens at spec build, so changing this mid-sweep doesn't
// poison the run — next sweep picks up the new value.
function setPrecisionUI(mode) {
  if (!PRECISION_MODES[mode]) return;
  setPrecisionMode(mode);
  const toggle = document.getElementById('precisionToggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }
  const hint = document.getElementById('precisionHint');
  if (hint) {
    const cfg = PRECISION_MODES[mode];
    const contrastTxt = cfg.contrast.toExponential(0).replace('e+0','e').replace('e-0','e-');
    hint.textContent = mode === 'fast'
      ? `Cv/Cs = ${contrastTxt} · ~3× faster`
      : `Cv/Cs = ${contrastTxt} · publication-grade`;
  }
}

// v0.16.0: Resolution toggle handler. Drives _currentSolverN; buildDesignSpec
// resolves per-design grid via resolveGridN(mode) at spec-build time.
// PI-TPMS and beam stay at ≥32 regardless of picker (family floor in
// resolveGridN). Snapshotting per spec means mid-sweep changes don't
// poison the run.
function setResolutionUI(n) {
  if (n !== 16 && n !== 32 && n !== 64) return;
  setSolverN(n);
  const toggle = document.getElementById('resolutionToggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.n, 10) === n);
    });
  }
  const hint = document.getElementById('resolutionHint');
  if (hint) {
    hint.textContent = n === 16
      ? 'Sweep default · fast'
      : n === 32 ? 'Thin-wall accurate · ~5–10× slower'
      : 'GPU only · fine walls and struts';
  }
}

/* v0.24.0 — the solver line under the Solver label: GPU (adapter) or CPU.
   N = 64 is offered only with the GPU solver. */
function updateSolverStatusUI() {
  const st = gpuSolverStatus();
  const el = document.getElementById('solverStatus');
  if (el) { el.textContent = st.text; el.classList.toggle('gpu', st.gpu === true); }
  const b64 = document.querySelector('#resolutionToggle button[data-n="64"]');
  if (b64) { b64.disabled = st.gpu !== true; b64.title = st.gpu === true ? 'N = 64 (GPU)' : 'N = 64 needs the GPU solver'; }
}

function onDomainChange() {
  const domain = document.getElementById('domainSel').value;
  const matGroup = document.getElementById('materialGroup');
  const matSel = document.getElementById('materialSel');
  const mats = DOMAIN_MATERIALS[domain] || [];
  const cfg = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG.general;
  // Reference stress input — hidden for thermal (not applicable) and general (normalized)
  const sigmaGroup = document.getElementById('sigmaRefGroup');
  const sigmaInput = document.getElementById('sigmaRef');
  if (cfg.sigma_ref === null || domain === 'general') {
    sigmaGroup.style.display = 'none';
  } else {
    sigmaGroup.style.display = 'block';
    sigmaInput.value = cfg.sigma_ref;
  }

  activeDomainShow = cfg.show;

  // Material selector
  if (mats.length === 0) {
    matGroup.style.display = 'none';
    currentMaterial = null;
  } else {
    matGroup.style.display = 'block';
    matSel.innerHTML = mats.map(k =>
      `<option value="${k}">${MATERIALS[k].label}</option>`
    ).join('');
    currentMaterial = MATERIALS[mats[0]];
    updateMaterialProps();
  }

  // Rank filter defaults
  if (cfg.r1) {
    const s = document.getElementById('r1metric');
    if (s) { s.value = cfg.r1.metric; setDirBtn(1, cfg.r1.dir); }
  }
  if (cfg.r2) {
    const s = document.getElementById('r2metric');
    if (s) { s.value = cfg.r2.metric; setDirBtn(2, cfg.r2.dir); }
  }
  if (cfg.r3) {
    const s = document.getElementById('r3metric');
    if (s) { s.value = cfg.r3.metric; setDirBtn(3, cfg.r3.dir); }
  }

  // Update rank filter inactive states (visual gray-out when metric=none)
  updateRankActiveState();

  // Update metric key to reflect visible set
  renderMetricKey();

  // Re-render table if we have results
  if (currentFiltered.length > 0) renderTable(currentFiltered);
}

// Toggle the .inactive class on rank threshold-rows when their metric is "none".
// This is a UX cue — the underlying applyRankFilter() function already correctly
// short-circuits when metric === 'none'; this just makes that state visible.
function updateRankActiveState() {
  [2, 3].forEach(rank => {
    const sel = document.getElementById('r' + rank + 'metric');
    const row = document.getElementById('r' + rank + 'thresholdRow');
    if (!sel || !row) return;
    const inactive = !sel.value || sel.value === 'none';
    row.classList.toggle('inactive', inactive);
  });
}

function setDirBtn(rank, dir) {
  directions[rank] = dir;
  document.querySelectorAll(`[data-rank="${rank}"]`).forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}

// Metric names / symbols / descriptions — metric key, table headers, detail panel.
const METRIC_INFO_LIST = [
  { key:'anisotropy',      sym:'α',    name:'Anisotropy Ratio',    desc:'strongest vs. weakest axis' },
  { key:'Ex_GPa',           sym:'Ex',  name:'Stiffness X',         desc:'effective Young\'s modulus along X (GPa)' },
  { key:'Ey_GPa',           sym:'Ey',  name:'Stiffness Y',         desc:'effective Young\'s modulus along Y (GPa)' },
  { key:'Ez_GPa',           sym:'Ez',  name:'Stiffness Z',         desc:'effective Young\'s modulus along Z (GPa)' },
  { key:'Gyz_GPa',          sym:'Gyz', name:'Shear Modulus YZ',    desc:'effective shear modulus in the YZ plane (GPa) — GPU solver' },
  { key:'Gxz_GPa',          sym:'Gxz', name:'Shear Modulus XZ',    desc:'effective shear modulus in the XZ plane (GPa) — GPU solver' },
  { key:'Gxy_GPa',          sym:'Gxy', name:'Shear Modulus XY',    desc:'effective shear modulus in the XY plane (GPa) — GPU solver' },
  { key:'nu_xy',            sym:'νxy', name:'Poisson XY',          desc:'lateral contraction in Y under load in X — GPU solver' },
  { key:'nu_xz',            sym:'νxz', name:'Poisson XZ',          desc:'lateral contraction in Z under load in X — GPU solver' },
  { key:'nu_yz',            sym:'νyz', name:'Poisson YZ',          desc:'lateral contraction in Z under load in Y — GPU solver' },
  { key:'zener_A',          sym:'A',   name:'Zener Ratio',         desc:'2·C44 / (C11 − C12); 1 = isotropic for a cubic cell — GPU solver' },
  { key:'cell_aspect',      sym:'cell',name:'Cell Aspect',         desc:'physical cell edges X × Y × Z, longest = 1 (stretched cells solve as stretched)' },
  { key:'stiffness_flag',   sym:'⚑',   name:'Stiffness Flag',      desc:'stiffness may read high — see the reasons below' },
  { key:'stiffness_flag_reasons', sym:'⚑', name:'Flag Reasons',      desc:'why the stiffness may read high' },
  { key:'void_limited_axes',sym:'⚑E',  name:'Pore-Stiffness Axes', desc:'axes where the pores\' stand-in stiffness is over 10 % of E (Fast reads them high)' },
  { key:'under_resolved',   sym:'⚑N',  name:'Under-resolved',      desc:'the solver grid is too coarse for this design — try a finer grid or check in F13LD.lab' },
  { key:'stiffness_density',sym:'E/ρ', name:'Stiff / Density',     desc:'mean stiffness per unit material' },
  { key:'aniso_efficiency', sym:'α/ρ', name:'Aniso / Density',     desc:'directional bias per unit material' },
  { key:'directionality',   sym:'Ψ',   name:'Directionality',      desc:'fraction of total stiffness on peak axis (max/sum, all axes)' },
  { key:'ortho_contrast',   sym:'Ω',   name:'Ortho Spread',        desc:'spread across all three axes' },
  { key:'stiff_axis',       sym:'ax',  name:'Stiff Axis',          desc:'X/Y/Z direction of peak stiffness' },
  { key:'connect_idx',      sym:'κ',   name:'Connectivity',        desc:'fraction of axes mechanically connected' },
  { key:'keff_x',           sym:'kx',  name:'Thermal Cond. X',     desc:'effective k in X direction' },
  { key:'keff_y',           sym:'ky',  name:'Thermal Cond. Y',     desc:'effective k in Y direction' },
  { key:'keff_z',           sym:'kz',  name:'Thermal Cond. Z',     desc:'effective k in Z direction' },
  { key:'thermal_anisotropy',sym:'kα', name:'Thermal Aniso.',      desc:'max vs. min directional conductivity' },
  { key:'k_density',        sym:'k/ρ', name:'Thermal / Density',   desc:'mean k per unit material volume' },
  { key:'U_strain',         sym:'U',   name:'Strain Energy',       desc:'mean strain energy density (kJ/m³) under ref stress' },
  { key:'microstrain_x',    sym:'με·X',name:'Microstrain X',       desc:'με under ref load in X' },
  { key:'microstrain_y',    sym:'με·Y',name:'Microstrain Y',       desc:'με under ref load in Y' },
  { key:'microstrain_z',    sym:'με·Z',name:'Microstrain Z',       desc:'με under ref load in Z' },
  { key:'microstrain_avg',  sym:'με̄', name:'Avg Microstrain (Frost)',  desc:'isotropic mean · Frost (1987): <200 disuse · 200–1500 maintenance · 1500–3000 osteogenic ✓ · >3000 overload' },
  { key:'pore_size',        sym:'φ',   name:'Mean Pore Size',      desc:'inscribed sphere diameter (µm)' },
  { key:'throat_size',      sym:'φt',  name:'Min Throat Diam.',    desc:'narrowest pore connection (µm)' },
  { key:'throat_ratio',     sym:'φt/c',name:'Throat Ratio',        desc:'v0.13: throat as fraction of cell — raw, no VF gate (vault composes any gate)' },
  { key:'perc_idx',         sym:'perc',name:'Void Percolation',    desc:'fraction of axes with open pore channels' },
  { key:'surface_complexity',sym:'SA', name:'Surface Complexity',  desc:'SA/V proxy — v0.13: raw, no min(1,…) cap' },
  { key:'volume_fraction',  sym:'ρ%',  name:'Volume Fraction',     desc:'% of unit cell that is solid material' },
];
const METRIC_INFO = Object.fromEntries(METRIC_INFO_LIST.map(e => [e.key, e]));

// Metric key lists what the results table shows (71-results-table.js).
function renderMetricKey(keys) {
  if (!keys) keys = (typeof tableColumnKeys === 'function') ? tableColumnKeys().keys : activeDomainShow;
  const entries = METRIC_INFO_LIST.filter(e => keys.includes(e.key));
  const html = entries.map(e => `
    <div style="display:grid;grid-template-columns:34px 1fr;gap:4px;align-items:baseline">
      <span style="color:var(--accent);font-size:11px;font-family:var(--mono)">${e.sym}</span>
      <span><span style="color:var(--ink)">${e.name}</span> <span style="color:var(--muted)">— ${e.desc}</span></span>
    </div>`).join('') +
    `<div style="color:var(--ink-dim);margin-top:4px">Click a row for every metric of that design.</div>`;
  const container = document.getElementById('metricKeyBody');
  if (container) container.innerHTML = html;
}

function onMaterialChange() {
  const key = document.getElementById('materialSel').value;
  currentMaterial = MATERIALS[key] || null;
  updateMaterialProps();
}

function updateMaterialProps() {
  const el = document.getElementById('materialProps');
  if (!currentMaterial) { el.textContent = ''; return; }
  el.textContent = `E=${currentMaterial.E} GPa · k=${currentMaterial.k} W/m·K`;
}

// Get current Es and ks for solver — falls back to recipe values or agnostic defaults
function getSolverMaterial() {
  if (currentMaterial) {
    return {
      Es: currentMaterial.E,
      nu: currentMaterial.nu,
      ks: currentMaterial.k,
      eps_yield_um:    currentMaterial.eps_yield_um    || EPS_YIELD_AGNOSTIC,
      linear_cap_kind: currentMaterial.linear_cap_kind || LINEAR_CAP_KIND_AGNOSTIC
    };
  }
  // Agnostic: use recipe values if available, else normalized defaults
  return {
    Es: baseRecipe?.homogenization?.E_solid_GPa || 100,
    nu: baseRecipe?.homogenization?.poisson || 0.3,
    ks: 1.0,  // normalized — thermal results are ratios
    eps_yield_um:    EPS_YIELD_AGNOSTIC,
    linear_cap_kind: LINEAR_CAP_KIND_AGNOSTIC
  };
}

// Get reference stress in GPa for strain energy / microstrain computation
// User input is in MPa — convert to GPa to match Es units
function getSigmaRef() {
  const el = document.getElementById('sigmaRef');
  const grp = document.getElementById('sigmaRefGroup');
  /* a hidden input (domain without a reference stress) does not count */
  if (grp && (grp.style.display === 'none' || grp.hidden)) return null;
  if (!el || !el.value) return null;
  return parseFloat(el.value) / 1000; // MPa → GPa
}

// Get voxel size in µm — used as cell size reference for pore analysis
// Returns cell_size_mm for reconstruction inside analyzePores
function getVoxelToUm() {
  const el = document.getElementById('cellSize');
  const mm = (el && el.value) ? parseFloat(el.value) : 2.0;
  return mm * 1000 / 32; // µm per voxel at N=32 — analyzePores recovers mm internally
}
