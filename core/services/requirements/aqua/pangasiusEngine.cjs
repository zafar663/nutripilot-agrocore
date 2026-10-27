"use strict";
/**
 * Pangasius / Basa (Pangasianodon hypophthalmus) Requirements Engine
 * Source: NRC 2011 + peer-reviewed literature 2007-2024
 * Key refs: Hung et al. 2007 (Aquaculture), De Silva & Ingram 2008,
 *           NRC 2011, FAO 2004 (pangasius aquaculture), Pham et al. 2021
 * Standard Label: "NRC 2011 + Pangasius Literature 2007-2024"
 *
 * Note: Pangasius is more herbivorous/omnivorous than channel catfish.
 * Grow-out CP requirement (~26%) is meaningfully lower than catfish (~32%).
 * Starch utilization is high; EPA/DHA requirement is lower (freshwater).
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function round(v,d=4){const n=Number(v);if(!Number.isFinite(n))return null;return Number(n.toFixed(d));}

const STATIC_REQUIREMENTS = {
  fry: {
    label:"Pangasius — Fry (<2g)", production:"fry", phase:"fry",
    energy:{de_kcal_kg:3100, de_mj_kg:13.0},
    protein:{dp_pct:36, cp_pct:40, lys:2.3, met:0.8, met_cys:1.3, thr:1.7, arg:2.3, ile:1.7, leu:2.8, val:2.0, trp:0.4, his:0.7},
    lipids:{total_lipid_pct:7, linoleic_pct:0.8, epa_dha_pct:0.2},
    minerals:{ca_pct:1.2, p_pct:0.9, avail_p_pct:0.55, mg_pct:0.04, k_pct:0.70, na_pct:0.20, fe_ppm:25, zn_ppm:18, mn_ppm:2.0, cu_ppm:3, se_ppm:0.22, i_ppm:0.10},
    vitamins:{vit_a_iu_kg:3500, vit_d_iu_kg:400, vit_e_mg_kg:80, vit_c_mg_kg:400, niacin_mg_kg:120, choline_mg_kg:2800, inositol_mg_kg:280},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:8, feeds_per_day:4},
  },
  fingerling: {
    label:"Pangasius — Fingerling (2-50g)", production:"fingerling", phase:"fingerling",
    energy:{de_kcal_kg:2900, de_mj_kg:12.1},
    protein:{dp_pct:31, cp_pct:35, lys:2.0, met:0.7, met_cys:1.2, thr:1.5, arg:2.0, ile:1.5, leu:2.5, val:1.8, trp:0.3, his:0.6},
    lipids:{total_lipid_pct:6, linoleic_pct:0.8, epa_dha_pct:0.2},
    minerals:{ca_pct:1.0, p_pct:0.8, avail_p_pct:0.45, mg_pct:0.04, k_pct:0.60, na_pct:0.18, fe_ppm:20, zn_ppm:15, mn_ppm:1.8, cu_ppm:3, se_ppm:0.20, i_ppm:0.08},
    vitamins:{vit_a_iu_kg:3000, vit_d_iu_kg:350, vit_e_mg_kg:60, vit_c_mg_kg:300, niacin_mg_kg:100, choline_mg_kg:2400, inositol_mg_kg:240},
    feed_management:{fcr_target:1.4, feeding_rate_pct_bw:5, feeds_per_day:3},
  },
  grow_out: {
    label:"Pangasius — Grow-out (50-500g)", production:"grow_out", phase:"grow_out",
    energy:{de_kcal_kg:2700, de_mj_kg:11.3},
    protein:{dp_pct:22, cp_pct:26, lys:1.6, met:0.6, met_cys:1.0, thr:1.3, arg:1.6, ile:1.3, leu:2.2, val:1.6, trp:0.3, his:0.5},
    lipids:{total_lipid_pct:5, linoleic_pct:0.8, epa_dha_pct:0.1},
    minerals:{ca_pct:0.9, p_pct:0.65, avail_p_pct:0.35, mg_pct:0.04, k_pct:0.55, na_pct:0.15, fe_ppm:18, zn_ppm:12, mn_ppm:1.5, cu_ppm:3, se_ppm:0.18, i_ppm:0.08},
    vitamins:{vit_a_iu_kg:2500, vit_d_iu_kg:300, vit_e_mg_kg:50, vit_c_mg_kg:200, niacin_mg_kg:80, choline_mg_kg:2000, inositol_mg_kg:200},
    feed_management:{fcr_target:1.5, feeding_rate_pct_bw:2.5, feeds_per_day:2},
  },
  market: {
    label:"Pangasius — Market (>500g, pre-harvest)", production:"market", phase:"market",
    energy:{de_kcal_kg:2500, de_mj_kg:10.5},
    protein:{dp_pct:18, cp_pct:22, lys:1.3, met:0.5, met_cys:0.9, thr:1.1, arg:1.3, ile:1.1, leu:1.9, val:1.4, trp:0.2, his:0.4},
    lipids:{total_lipid_pct:5, linoleic_pct:0.7, epa_dha_pct:0.1},
    minerals:{ca_pct:0.8, p_pct:0.60, avail_p_pct:0.30, mg_pct:0.03, k_pct:0.50, na_pct:0.14, fe_ppm:15, zn_ppm:10, mn_ppm:1.2, cu_ppm:2, se_ppm:0.15, i_ppm:0.07},
    vitamins:{vit_a_iu_kg:2000, vit_d_iu_kg:250, vit_e_mg_kg:40, vit_c_mg_kg:150, niacin_mg_kg:70, choline_mg_kg:1700, inositol_mg_kg:150},
    feed_management:{fcr_target:1.7, feeding_rate_pct_bw:2, feeds_per_day:2},
  },
};

const PHASE_MAP = {
  fry:1, larvae:1, starter:1,
  fingerling:1, juvenile:'fingerling',
  grow_out:1, growing:1, grower:'grow_out', intermediate:'grow_out',
  market:1, finishing:'market', pre_harvest:'market',
};

function resolvePhaseKey(production,phase){
  const pr=String(production||'').toLowerCase();
  const ph=String(phase||'').toLowerCase();
  if(STATIC_REQUIREMENTS[ph]) return ph;
  if(STATIC_REQUIREMENTS[pr]) return pr;
  const mapped=PHASE_MAP[ph]||PHASE_MAP[pr];
  if(mapped && mapped!==1 && STATIC_REQUIREMENTS[mapped]) return mapped;
  if(mapped===1 && STATIC_REQUIREMENTS[ph||pr]) return ph||pr;
  return 'grow_out';
}

function flatten(t){
  if(!t) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_2011_Pangasius_Literature_2007_2024',
    species:'pangasius', species_name:'Pangasianodon hypophthalmus', label:t.label,
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

function resolvePangasiusRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'PANGASIUS_ENGINE_ERROR',message:e.message};}
}
module.exports={resolvePangasiusRequirements,STATIC_REQUIREMENTS};
