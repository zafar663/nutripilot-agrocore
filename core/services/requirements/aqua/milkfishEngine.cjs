"use strict";
/**
 * Milkfish (Chanos chanos) Requirements Engine
 * Source: NRC 2011 + peer-reviewed literature 2004-2024
 * Key refs: Catacutan & Coloso 1995 (Aquaculture), Lim & Webster 2006 (CABI),
 *           FAO 2004 (milkfish culture, Philippines/Indonesia/Taiwan),
 *           Pham & De Silva 2010, NRC 2011 general freshwater/marine sections
 * Standard Label: "NRC 2011 + Milkfish Literature 2004-2024"
 *
 * Chanos chanos is a euryhaline marine/brackish species (Philippines, Indonesia, Taiwan).
 * Herbivore/omnivore with high EPA+DHA requirement for reproductive performance.
 * Key productions: fry (wild-caught or hatchery), fingerling, grow-out, broodstock.
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function round(v,d=4){const n=Number(v);if(!Number.isFinite(n))return null;return Number(n.toFixed(d));}

const STATIC_REQUIREMENTS = {
  fry: {
    label:"Milkfish — Fry (<5g)", production:"fry", phase:"fry",
    energy:{de_kcal_kg:3300, de_mj_kg:13.8},
    protein:{dp_pct:40, cp_pct:45, lys:2.5, met:1.0, met_cys:1.6, thr:1.9, arg:2.5, ile:1.9, leu:3.1, val:2.1, trp:0.4, his:0.8},
    lipids:{total_lipid_pct:9, linoleic_pct:1.0, epa_dha_pct:0.8},
    minerals:{ca_pct:1.5, p_pct:1.0, avail_p_pct:0.65, mg_pct:0.05, k_pct:0.80, na_pct:0.30, fe_ppm:40, zn_ppm:25, mn_ppm:2.5, cu_ppm:5, se_ppm:0.30, i_ppm:0.25},
    vitamins:{vit_a_iu_kg:5000, vit_d_iu_kg:800, vit_e_mg_kg:120, vit_c_mg_kg:600, niacin_mg_kg:150, choline_mg_kg:3500, inositol_mg_kg:400},
    feed_management:{fcr_target:1.1, feeding_rate_pct_bw:10, feeds_per_day:5},
  },
  fingerling: {
    label:"Milkfish — Fingerling (5-50g)", production:"fingerling", phase:"fingerling",
    energy:{de_kcal_kg:3100, de_mj_kg:13.0},
    protein:{dp_pct:35, cp_pct:40, lys:2.2, met:0.9, met_cys:1.4, thr:1.7, arg:2.2, ile:1.7, leu:2.7, val:1.9, trp:0.4, his:0.7},
    lipids:{total_lipid_pct:8, linoleic_pct:1.0, epa_dha_pct:0.6},
    minerals:{ca_pct:1.2, p_pct:0.9, avail_p_pct:0.55, mg_pct:0.04, k_pct:0.70, na_pct:0.25, fe_ppm:30, zn_ppm:20, mn_ppm:2.0, cu_ppm:4, se_ppm:0.25, i_ppm:0.20},
    vitamins:{vit_a_iu_kg:4000, vit_d_iu_kg:600, vit_e_mg_kg:100, vit_c_mg_kg:400, niacin_mg_kg:120, choline_mg_kg:3000, inositol_mg_kg:320},
    feed_management:{fcr_target:1.3, feeding_rate_pct_bw:6, feeds_per_day:4},
  },
  grow_out: {
    label:"Milkfish — Grow-out (50-500g)", production:"grow_out", phase:"grow_out",
    energy:{de_kcal_kg:2900, de_mj_kg:12.1},
    protein:{dp_pct:28, cp_pct:32, lys:1.9, met:0.8, met_cys:1.2, thr:1.5, arg:1.9, ile:1.5, leu:2.4, val:1.7, trp:0.3, his:0.6},
    lipids:{total_lipid_pct:7, linoleic_pct:1.0, epa_dha_pct:0.5},
    minerals:{ca_pct:1.0, p_pct:0.8, avail_p_pct:0.45, mg_pct:0.04, k_pct:0.60, na_pct:0.20, fe_ppm:25, zn_ppm:15, mn_ppm:1.8, cu_ppm:3, se_ppm:0.22, i_ppm:0.15},
    vitamins:{vit_a_iu_kg:3500, vit_d_iu_kg:500, vit_e_mg_kg:80, vit_c_mg_kg:300, niacin_mg_kg:100, choline_mg_kg:2500, inositol_mg_kg:250},
    feed_management:{fcr_target:1.5, feeding_rate_pct_bw:3, feeds_per_day:3},
  },
  broodstock: {
    label:"Milkfish — Broodstock", production:"broodstock", phase:"maturation",
    energy:{de_kcal_kg:3100, de_mj_kg:13.0},
    protein:{dp_pct:35, cp_pct:40, lys:2.2, met:0.9, met_cys:1.4, thr:1.7, arg:2.2, ile:1.7, leu:2.7, val:1.9, trp:0.4, his:0.7},
    lipids:{total_lipid_pct:10, linoleic_pct:1.2, epa_dha_pct:1.2},
    minerals:{ca_pct:1.5, p_pct:1.0, avail_p_pct:0.60, mg_pct:0.05, k_pct:0.75, na_pct:0.28, fe_ppm:35, zn_ppm:25, mn_ppm:2.5, cu_ppm:5, se_ppm:0.35, i_ppm:0.25},
    vitamins:{vit_a_iu_kg:5000, vit_d_iu_kg:800, vit_e_mg_kg:200, vit_c_mg_kg:500, niacin_mg_kg:140, choline_mg_kg:3200, inositol_mg_kg:380},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:2.5, feeds_per_day:3},
  },
};

const PHASE_MAP = {
  fry:1, larvae:1, starter:1,
  fingerling:1, juvenile:'fingerling',
  grow_out:1, growing:1, grower:'grow_out', intermediate:'grow_out',
  broodstock:1, maturation:'broodstock', spawner:'broodstock',
};

function resolvePhaseKey(production,phase){
  const pr=String(production||'').toLowerCase();
  const ph=String(phase||'').toLowerCase();
  if(STATIC_REQUIREMENTS[ph]) return ph;
  if(STATIC_REQUIREMENTS[pr]) return pr;
  const mapped=PHASE_MAP[ph]||PHASE_MAP[pr];
  if(mapped && mapped!==1 && STATIC_REQUIREMENTS[mapped]) return mapped;
  return 'grow_out';
}

function flatten(t){
  if(!t) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_2011_Milkfish_Literature_2004_2024',
    species:'milkfish', species_name:'Chanos chanos', label:t.label,
    digestible_energy_fish:t.energy?.de_kcal_kg??null,
    de_kcal_kg:t.energy?.de_kcal_kg??null, de_mj_kg:t.energy?.de_mj_kg??null,
    cp:t.protein?.cp_pct??null,
    digestible_protein_fish:t.protein?.dp_pct??null, dp_pct:t.protein?.dp_pct??null,
    total_lys:t.protein?.lys??null, total_met:t.protein?.met??null,
    total_metcys:t.protein?.met_cys??null, total_thr:t.protein?.thr??null,
    total_arg:t.protein?.arg??null, total_ile:t.protein?.ile??null,
    total_leu:t.protein?.leu??null, total_val:t.protein?.val??null,
    total_trp:t.protein?.trp??null, total_his:t.protein?.his??null,
    ee:t.lipids?.total_lipid_pct??null,
    linoleic:t.lipids?.linoleic_pct??null, dha_epa:t.lipids?.epa_dha_pct??null,
    ca:t.minerals?.ca_pct??null, total_p:t.minerals?.p_pct??null,
    avp:t.minerals?.avail_p_pct??null,
    mg:t.minerals?.mg_pct??null, k:t.minerals?.k_pct??null, na:t.minerals?.na_pct??null,
    fe:t.minerals?.fe_ppm??null, zn:t.minerals?.zn_ppm??null,
    mn:t.minerals?.mn_ppm??null, cu:t.minerals?.cu_ppm??null,
    se:t.minerals?.se_ppm??null, i:t.minerals?.i_ppm??null,
    vit_a:t.vitamins?.vit_a_iu_kg??null, vit_d3:t.vitamins?.vit_d_iu_kg??null,
    vit_e:t.vitamins?.vit_e_mg_kg??null, vit_c:t.vitamins?.vit_c_mg_kg??null,
    niacin:t.vitamins?.niacin_mg_kg??null, choline:t.vitamins?.choline_mg_kg??null,
    inositol:t.vitamins?.inositol_mg_kg??null,
    fcr_target:t.feed_management?.fcr_target??null,
    feeding_rate_pct_bw:t.feed_management?.feeding_rate_pct_bw??null,
  };
}

function resolveMilkfishRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'MILKFISH_ENGINE_ERROR',message:e.message};}
}
module.exports={resolveMilkfishRequirements,STATIC_REQUIREMENTS};
