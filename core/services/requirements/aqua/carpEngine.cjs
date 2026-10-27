"use strict";
/**
 * Common/Grass Carp Requirements Engine
 * Source: NRC 2011 + peer-reviewed literature 2011-2024
 * Species: Common carp (Cyprinus carpio), Grass carp (Ctenopharyngodon idellus)
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function round(v,d=4){const n=Number(v);if(!Number.isFinite(n))return null;return Number(n.toFixed(d));}

const STATIC_REQUIREMENTS = {
  fry:{
    label:"Carp — Fry (<2g)", production:"fry", phase:"fry",
    energy:{de_kcal_kg:3000, de_mj_kg:12.6},
    protein:{dp_pct:40, cp_pct:45, lys:2.5, met:0.9, met_cys:1.4, thr:1.8, arg:2.5, ile:1.8, leu:3.0, val:2.0, trp:0.4, his:0.8},
    lipids:{total_lipid_pct:8, linoleic_pct:1.0, epa_dha_pct:0.3},
    minerals:{ca_pct:0.6, p_pct:0.8, avail_p_pct:0.45, mg_pct:0.05, k_pct:0.70, na_pct:0.20, fe_ppm:50, zn_ppm:25, mn_ppm:13, cu_ppm:4, se_ppm:0.25, i_ppm:0.10},
    vitamins:{vit_a_iu_kg:4000, vit_d_iu_kg:1000, vit_e_mg_kg:100, vit_c_mg_kg:400, niacin_mg_kg:100, choline_mg_kg:3000, inositol_mg_kg:440},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:8, feeds_per_day:5},
  },
  fingerling:{
    label:"Carp — Fingerling (2-50g)", production:"fingerling", phase:"fingerling",
    energy:{de_kcal_kg:2800, de_mj_kg:11.7},
    protein:{dp_pct:35, cp_pct:38, lys:2.1, met:0.8, met_cys:1.2, thr:1.5, arg:2.1, ile:1.5, leu:2.6, val:1.8, trp:0.3, his:0.7},
    lipids:{total_lipid_pct:7, linoleic_pct:1.0, epa_dha_pct:0.2},
    minerals:{ca_pct:0.5, p_pct:0.7, avail_p_pct:0.40, mg_pct:0.05, k_pct:0.60, na_pct:0.18, fe_ppm:40, zn_ppm:20, mn_ppm:12, cu_ppm:3, se_ppm:0.22, i_ppm:0.10},
    vitamins:{vit_a_iu_kg:3000, vit_d_iu_kg:800, vit_e_mg_kg:80, vit_c_mg_kg:300, niacin_mg_kg:80, choline_mg_kg:2500, inositol_mg_kg:300},
    feed_management:{fcr_target:1.5, feeding_rate_pct_bw:4, feeds_per_day:3},
  },
  grow_out:{
    label:"Carp — Grow-out (50g-1kg)", production:"grow_out", phase:"grow_out",
    energy:{de_kcal_kg:2600, de_mj_kg:10.9},
    protein:{dp_pct:28, cp_pct:32, lys:1.7, met:0.7, met_cys:1.0, thr:1.3, arg:1.7, ile:1.3, leu:2.2, val:1.5, trp:0.3, his:0.6},
    lipids:{total_lipid_pct:6, linoleic_pct:1.0, epa_dha_pct:0.2},
    minerals:{ca_pct:0.4, p_pct:0.6, avail_p_pct:0.35, mg_pct:0.04, k_pct:0.55, na_pct:0.15, fe_ppm:30, zn_ppm:15, mn_ppm:10, cu_ppm:3, se_ppm:0.18, i_ppm:0.08},
    vitamins:{vit_a_iu_kg:2500, vit_d_iu_kg:600, vit_e_mg_kg:60, vit_c_mg_kg:200, niacin_mg_kg:70, choline_mg_kg:2000, inositol_mg_kg:200},
    feed_management:{fcr_target:1.8, feeding_rate_pct_bw:2, feeds_per_day:2},
  },
  market:{
    label:"Carp — Market size (>1kg)", production:"market", phase:"market",
    energy:{de_kcal_kg:2500, de_mj_kg:10.5},
    protein:{dp_pct:25, cp_pct:28, lys:1.5, met:0.6, met_cys:0.9, thr:1.2, arg:1.5, ile:1.2, leu:2.0, val:1.4, trp:0.2, his:0.5},
    lipids:{total_lipid_pct:6, linoleic_pct:1.0, epa_dha_pct:0.2},
    minerals:{ca_pct:0.4, p_pct:0.55, avail_p_pct:0.30, mg_pct:0.04, k_pct:0.50, na_pct:0.14, fe_ppm:30, zn_ppm:15, mn_ppm:10, cu_ppm:3, se_ppm:0.15, i_ppm:0.08},
    vitamins:{vit_a_iu_kg:2000, vit_d_iu_kg:500, vit_e_mg_kg:50, vit_c_mg_kg:150, niacin_mg_kg:60, choline_mg_kg:1800, inositol_mg_kg:150},
    feed_management:{fcr_target:2.0, feeding_rate_pct_bw:1.5, feeds_per_day:2},
  },
};

function resolvePhaseKey(p,ph){
  const k=String(ph||p||'').toLowerCase();
  if(STATIC_REQUIREMENTS[k]) return k;
  if(k.includes('fry')||k.includes('larv')) return 'fry';
  if(k.includes('finger')||k.includes('juven')) return 'fingerling';
  if(k.includes('market')||k.includes('finish')) return 'market';
  return 'grow_out';
}

function flatten(t){
  if(!t) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_2011_Carp_plus_Literature_2011_2024',
    species:'carp', label:t.label,
    // Energy — use workspace key (digestible_energy_fish) AND keep de_kcal_kg for LP compatibility
    digestible_energy_fish: t.energy?.de_kcal_kg??null,
    de_kcal_kg: t.energy?.de_kcal_kg??null,
    de_mj_kg:   t.energy?.de_mj_kg??null,
    // Protein — cp matches; digestible protein needs workspace key
    cp: t.protein?.cp_pct??null,
    digestible_protein_fish: t.protein?.dp_pct??null,
    dp_pct: t.protein?.dp_pct??null,
    // Amino acids — workspace uses total_* keys
    total_lys:   t.protein?.lys??null,
    total_met:   t.protein?.met??null,
    total_metcys:t.protein?.met_cys??null,
    total_thr:   t.protein?.thr??null,
    total_arg:   t.protein?.arg??null,
    total_ile:   t.protein?.ile??null,
    total_leu:   t.protein?.leu??null,
    total_val:   t.protein?.val??null,
    total_trp:   t.protein?.trp??null,
    total_his:   t.protein?.his??null,
    // Lipids
    ee:      t.lipids?.total_lipid_pct??null,
    linoleic:t.lipids?.linoleic_pct??null,
    dha_epa: t.lipids?.epa_dha_pct??null,  // workspace key
    // Macro minerals
    ca:     t.minerals?.ca_pct??null,
    total_p:t.minerals?.p_pct??null,
    avp:    t.minerals?.avail_p_pct??null,  // workspace key (avP)
    mg:     t.minerals?.mg_pct??null,
    k:      t.minerals?.k_pct??null,
    na:     t.minerals?.na_pct??null,
    // Trace minerals — workspace uses unprefixed keys (fe, zn, etc.)
    fe: t.minerals?.fe_ppm??null,
    zn: t.minerals?.zn_ppm??null,
    mn: t.minerals?.mn_ppm??null,
    cu: t.minerals?.cu_ppm??null,
    se: t.minerals?.se_ppm??null,
    i:  t.minerals?.i_ppm??null,
    // Vitamins — vit_d3 is the workspace key
    vit_a:   t.vitamins?.vit_a_iu_kg??null,
    vit_d3:  t.vitamins?.vit_d_iu_kg??null,  // workspace key
    vit_e:   t.vitamins?.vit_e_mg_kg??null,
    vit_c:   t.vitamins?.vit_c_mg_kg??null,
    niacin:  t.vitamins?.niacin_mg_kg??null,
    choline: t.vitamins?.choline_mg_kg??null,
    inositol:t.vitamins?.inositol_mg_kg??null,
    fcr_target:          t.feed_management?.fcr_target??null,
    feeding_rate_pct_bw: t.feed_management?.feeding_rate_pct_bw??null,
  };
}

function resolveCarpRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'CARP_ENGINE_ERROR',message:e.message};}
}
module.exports={resolveCarpRequirements,STATIC_REQUIREMENTS};
